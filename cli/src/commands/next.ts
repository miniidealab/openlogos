import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readLocale, t, type Locale } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import { collectStatusData, deriveActiveOverlay } from './status.js';
import type { ProposalStep } from './status.js';
import { isAdoptedBootstrap } from '../lib/project-yaml.js';
import { gateForProposalStep } from '../lib/flow-derive.js';
import type { CurrentNode, CmdEval } from '../lib/flow-overlay-derive.js';
import type { LoopState } from '../lib/flow-loop-derive.js';
import { loopExhaustedGateId, isLoopBlocking } from '../lib/flow-loop-derive.js';
import { FlowError } from '../lib/flow.js';
import { runFlowCmd, CmdSpawnError } from '../lib/flow-cmd.js';

export interface NextModuleItem {
  id: string;
  name: string;
  lifecycle: 'initial' | 'launched';
  bootstrap?: 'normal' | 'adopted';
  action: string;
  command: string | null;
  detail: string;
  active_change: string | null;
  proposal_step: ProposalStep | null;
  deployment_decision_conflict?: boolean;
  deployment_decision_conflict_reason?: string | null;
  deployment_warnings?: string[];
  current_node?: CurrentNode;
  loop_state?: LoopState;
}

export interface NextData {
  action: string;
  command: string | null;
  detail: string;
  active_change: string | null;
  proposal_step: string | null;
  modules?: NextModuleItem[];
  // M2 切片 1a：base data 的 current_node（仅当前为 overlay-added 时附带）
  current_node?: CurrentNode;
  // M2 切片 2：loop 真迭代派生（仅 overlay 激活时附带）
  loop_state?: LoopState;
  // 切片 C：仅 --auto 模式附带，默认 next 省略（保持 1:1）
  auto?: boolean;
  gate_id?: string | null;
  skippable?: boolean | null;
  gate_auto_passed?: boolean;
  // M2 切片 1b：本次 next 执行了 cmd: 节点求值时附带（budget=1，transient，不写 marker）
  cmd_node_id?: string;
  cmd_predicate_field?: 'done_when' | 'fail_when';
  cmd_exit_code?: number | null;
  cmd_timed_out?: boolean;
  cmd_satisfied?: boolean;
}

/** 在活跃提案目录追加一行 GATE_AUTO_PASSED JSONL 审计（总是追加、不去重）。 */
function appendGateAutoPassed(root: string, slug: string, gateId: string, step: string): void {
  const path = join(root, 'logos', 'changes', slug, 'GATE_AUTO_PASSED');
  const line = JSON.stringify({ gate_id: gateId, proposal_step: step, timestamp: new Date().toISOString() });
  appendFileSync(path, line + '\n');
}

/** auto 放行时的建议文案（仅 ready-to-merge 这类可跳 gate 会用到）。 */
function autoPassMessage(locale: Locale, gateId: string, step: string, slug: string): { action: string; command: string | null; detail: string } {
  const command = step === 'ready-to-merge' ? `openlogos merge ${slug}` : null;
  if (locale === 'zh') {
    return {
      action: `auto：可跳人类确认点已放行（gate: ${gateId}）`,
      command,
      detail: 'gate 已自动放行，宿主可直接执行、无需人类授权；审计已追加 GATE_AUTO_PASSED。',
    };
  }
  return {
    action: `auto: skippable human gate passed (gate: ${gateId})`,
    command,
    detail: 'Gate auto-passed; host may proceed without human authorization. GATE_AUTO_PASSED audit appended.',
  };
}

function buildModuleNextItem(
  mod: {
    id: string;
    name: string;
    lifecycle: 'initial' | 'launched';
    bootstrap?: 'normal' | 'adopted';
    suggestion: string;
    active_change: {
      slug: string;
      proposal_step: ProposalStep;
      deployment_decision_conflict?: boolean;
      deployment_decision_conflict_reason?: string | null;
      deployment_warnings?: string[];
    } | null;
  },
  guardActiveChange: string | null,
  guardModule: string | null,
  locale: string,
): NextModuleItem {
  if (mod.lifecycle === 'launched') {
    if (mod.active_change) {
      if (mod.active_change.deployment_decision_conflict) {
        return {
          id: mod.id, name: mod.name, lifecycle: 'launched',
          action: locale === 'zh' ? '修正部署决策冲突' : 'Fix deployment decision conflict',
          command: null,
          detail: mod.active_change.deployment_warnings?.join(' ') || mod.suggestion,
          active_change: mod.active_change.slug,
          proposal_step: mod.active_change.proposal_step,
          deployment_decision_conflict: true,
          deployment_decision_conflict_reason: mod.active_change.deployment_decision_conflict_reason ?? null,
          ...(mod.active_change.deployment_warnings ? { deployment_warnings: mod.active_change.deployment_warnings } : {}),
        };
      }
      const step = mod.active_change.proposal_step;
      const { action, command } = actionForProposalStep(locale, step);
      return {
        id: mod.id, name: mod.name, lifecycle: 'launched',
        action, command, detail: mod.suggestion,
        active_change: mod.active_change.slug, proposal_step: step,
      };
    }

    // No active change on this module
    if (guardActiveChange && guardModule !== mod.id) {
      // Blocked by another module's guard
      const detail = locale === 'zh'
        ? `当前活跃提案 ${guardActiveChange}（归属 ${guardModule ?? '?'}）未完成，请先完成后再为此模块创建新提案`
        : `Active proposal ${guardActiveChange} (module: ${guardModule ?? '?'}) is in progress — finish it before creating a new proposal for this module`;
      return {
        id: mod.id, name: mod.name, lifecycle: 'launched',
        action: 'blocked', command: null, detail,
        active_change: null, proposal_step: null,
      };
    }

    if (isAdoptedBootstrap(mod.bootstrap)) {
      return {
        id: mod.id, name: mod.name, lifecycle: 'launched',
        bootstrap: mod.bootstrap,
        action: locale === 'zh' ? '先补充项目基线文档' : 'Fill in baseline docs first',
        command: 'openlogos change add-baseline-docs',
        detail: locale === 'zh'
          ? '建议先创建补文档提案，再开始业务迭代。'
          : 'Create a baseline-docs change proposal before starting feature work.',
        active_change: null, proposal_step: null,
      };
    }

    return {
      id: mod.id, name: mod.name, lifecycle: 'launched',
      bootstrap: mod.bootstrap,
      action: t(locale as Parameters<typeof t>[0], 'next.createChange'),
      command: 'openlogos change <slug>',
      detail: mod.suggestion,
      active_change: null, proposal_step: null,
    };
  }

  // initial lifecycle — not affected by guard
  return {
    id: mod.id, name: mod.name, lifecycle: 'initial',
    bootstrap: mod.bootstrap,
    action: mod.suggestion,
    command: null,
    detail: '',
    active_change: null, proposal_step: null,
  };
}

function actionForProposalStep(locale: string, step: ProposalStep | null): { action: string; command: string | null; detailKey: string } {
  switch (step) {
    case 'writing':
      return { action: t(locale as Parameters<typeof t>[0], 'next.fillProposal'), command: null, detailKey: 'next.fillProposalDetail' };
    case 'delta-writing':
    case 'implementing':
    case 'in-progress':
      return { action: t(locale as Parameters<typeof t>[0], 'next.writeDeltas'), command: null, detailKey: 'next.writeDeltasDetail' };
    case 'ready-to-merge':
      return { action: t(locale as Parameters<typeof t>[0], 'next.merge'), command: null, detailKey: 'next.mergeDetail' };
    case 'merge-generated':
      return { action: t(locale as Parameters<typeof t>[0], 'next.executeMerge'), command: null, detailKey: 'next.executeMergeDetail' };
    case 'coding':
      return { action: t(locale as Parameters<typeof t>[0], 'next.startCoding'), command: null, detailKey: 'next.startCodingDetail' };
    case 'ready-to-verify':
      return { action: t(locale as Parameters<typeof t>[0], 'next.runVerify'), command: null, detailKey: 'next.runVerifyDetail' };
    case 'verify-passed':
    case 'deploy-done':
    case 'smoke-passed':
      return { action: t(locale as Parameters<typeof t>[0], 'next.archive'), command: null, detailKey: 'next.archiveDetail' };
    case 'ready-to-deploy':
      return { action: t(locale as Parameters<typeof t>[0], 'next.authorizeDeploy'), command: null, detailKey: 'next.authorizeDeployDetail' };
    case 'ready-to-smoke':
      return { action: t(locale as Parameters<typeof t>[0], 'next.runSmoke'), command: null, detailKey: 'next.runSmokeDetail' };
    case 'smoke-failed':
      return { action: t(locale as Parameters<typeof t>[0], 'next.fixAndSmoke'), command: null, detailKey: 'next.fixAndSmokeDetail' };
    case 'verify-failed':
      return { action: t(locale as Parameters<typeof t>[0], 'next.fixAndVerify'), command: null, detailKey: 'next.fixAndVerifyDetail' };
    default:
      return { action: t(locale as Parameters<typeof t>[0], 'next.fillProposal'), command: null, detailKey: 'next.fillProposalDetail' };
  }
}

export async function next(format: OutputFormat = 'text', moduleId?: string, auto: boolean = false) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'next', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.',
      )));
      process.exit(1);
    }
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  // Validate --module if provided
  if (moduleId) {
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    if (existsSync(yamlPath)) {
      try {
        const yaml = parseYaml(readFileSync(yamlPath, 'utf-8'));
        const mods = Array.isArray(yaml?.modules) ? yaml.modules as Array<{ id: string }> : [];
        if (!mods.find(m => m.id === moduleId)) {
          console.error(`Error: Module '${moduleId}' not found in logos-project.yaml.`);
          console.error('Run `openlogos module list` to see available modules.');
          process.exit(1);
        }
      } catch { /* ignore */ }
    }
  }

  const locale = readLocale(root);

  // M2 切片 1b：cmd: 谓词求值（仅 next）。当前节点是待执行 cmd 节点 → 执行一次（budget=1，transient，不写 marker），
  // 结果回灌派生（cmdEval），让本次 next 输出反映 done/failed/active 续推态。status/watch 不走此路径。
  let cmdEval: CmdEval | undefined;
  let cmdResult: { node_id: string; predicate_field: 'done_when' | 'fail_when'; exit_code: number | null; timed_out: boolean; satisfied: boolean } | undefined;
  try {
    const observe = deriveActiveOverlay(root, moduleId);
    const pc = observe?.pending_cmd;
    if (pc) {
      let runRes: Awaited<ReturnType<typeof runFlowCmd>>;
      try {
        runRes = await runFlowCmd(pc.command, root, pc.timeout_seconds);
      } catch (e) {
        if (e instanceof CmdSpawnError) {
          // 契约（cli-json-output.md §6.1）：message 须含节点 id + 命令名 + errno
          const msg = locale === 'zh'
            ? `cmd 节点 \`${pc.node_id}\` 命令无法启动：${pc.command}（${e.errno}）`
            : `cmd node \`${pc.node_id}\` command failed to spawn: ${pc.command} (${e.errno})`;
          if (format === 'json') {
            console.error(JSON.stringify(makeErrorEnvelope('next', 'FLOW_CMD_SPAWN_FAILED', msg)));
          } else {
            console.error(`✖ ${msg}`);
          }
          process.exit(1);
        }
        throw e;
      }
      const satisfied = runRes.exitCode === 0 && !runRes.timedOut;
      cmdEval = { node_id: pc.node_id, satisfied };
      cmdResult = {
        node_id: pc.node_id, predicate_field: pc.predicate_field,
        exit_code: runRes.exitCode, timed_out: runRes.timedOut, satisfied,
      };
    }
  } catch (e) {
    if (e instanceof FlowError) {
      if (format === 'json') {
        console.error(JSON.stringify(makeErrorEnvelope('next', e.code, e.message)));
      } else {
        console.error(`✖ flow 配置错误（${e.code}）：${e.message}`);
      }
      process.exit(1);
    }
    throw e;
  }

  let data: ReturnType<typeof collectStatusData>;
  try {
    data = collectStatusData(root, moduleId, cmdEval);
  } catch (e) {
    if (e instanceof FlowError) {
      if (format === 'json') {
        console.error(JSON.stringify(makeErrorEnvelope('next', e.code, e.message)));
      } else {
        console.error(`✖ flow 配置错误（${e.code}）：${e.message}`);
      }
      process.exit(1);
    }
    throw e;
  }

  // Read guard module
  let guardModule: string | null = null;
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      guardModule = guard.module || null;
    } catch { /* ignore */ }
  }

  // Build per-module next items if modules exist
  let moduleItems: NextModuleItem[] | undefined;
  if (data.modules && data.modules.length > 0) {
    moduleItems = data.modules.map(m => buildModuleNextItem(
      {
        id: m.id, name: m.name, lifecycle: m.lifecycle, bootstrap: m.bootstrap,
        suggestion: m.suggestion,
        active_change: m.active_change ? {
          slug: m.active_change.slug,
          proposal_step: m.active_change.proposal_step,
          deployment_decision_conflict: m.active_change.deployment_decision_conflict,
          deployment_decision_conflict_reason: m.active_change.deployment_decision_conflict_reason,
          deployment_warnings: m.active_change.deployment_warnings,
        } : null,
      },
      data.active_change,
      guardModule,
      locale,
    ));
    // M2 切片 1a：透传 overlay current_node，并在卡住时把 action 指向该节点（Review F3）
    moduleItems = moduleItems.map((item, i) => {
      const cn = data.modules![i].current_node;
      const ls = data.modules![i].loop_state;
      const withFields: NextModuleItem = { ...item, ...(cn ? { current_node: cn } : {}), ...(ls ? { loop_state: ls } : {}) };
      if (cn) {
        return {
          ...withFields,
          action: locale === 'zh'
            ? `先完成 overlay 节点「${cn.name}」（${cn.id}）${cn.state === 'failed' ? '（失败，需修复）' : ''}`
            : `Finish overlay node "${cn.name}" (${cn.id})${cn.state === 'failed' ? ' (failed — fix it)' : ''}`,
          command: null,
          detail: locale === 'zh' ? '当前流程卡在 overlay 节点，完成其判定后再推进后续步骤。'
            : 'Flow is at an overlay node; finish it before later steps.',
        };
      }
      // M2 切片 2：loop 阻塞时模块项指向 loop（前沿到 verify、跑过≥1 轮、未收敛、未被 overlay 节点抢占，F1）
      const m = data.modules![i];
      const mAtVerify = m.active_change?.proposal_step === 'ready-to-verify'
        || m.active_change?.proposal_step === 'verify-failed' || m.current_phase === 'phase.3-6';
      if (ls && isLoopBlocking(ls, mAtVerify)) {
        return {
          ...withFields,
          action: ls.escalated
            ? (locale === 'zh' ? `loop 已达迭代上限 ${ls.max_iters} 轮仍未绿 → 升级人类确认` : `Loop hit max_iters=${ls.max_iters} — human decision needed`)
            : (locale === 'zh' ? `loop 第 ${ls.iteration}/${ls.max_iters} 轮未绿 → 修复后重跑 openlogos verify` : `Loop round ${ls.iteration}/${ls.max_iters} not green — fix and rerun openlogos verify`),
          command: null,
          detail: locale === 'zh' ? '修复后重跑 verify；测试绿即出环续推。' : 'Fix and rerun verify; loop exits once green.',
        };
      }
      return withFields;
    });
  }

  // Global action (legacy / no-modules path)
  let action: string;
  let command: string | null = null;
  let detail: string;

  if (data.lifecycle === 'launched') {
    if (!data.active_change) {
      const bootstrapModule = data.modules?.find(m => m.lifecycle === 'launched' && isAdoptedBootstrap(m.bootstrap));
      if (bootstrapModule) {
        action = locale === 'zh'
          ? '先补充项目基线文档'
          : 'Fill in the project baseline documents first';
        command = 'openlogos change add-baseline-docs';
        detail = locale === 'zh'
          ? '建议先创建补文档提案，再开始业务迭代。'
          : 'Create a baseline-docs change proposal before starting feature work.';
      } else {
        action = t(locale, 'next.createChange');
        command = 'openlogos change <slug>';
        detail = t(locale, 'next.createChangeDetail');
      }
    } else {
      const slug = data.active_change;
      const activeModule = data.modules?.find(m => m.active_change?.slug === slug);
      if (activeModule?.active_change?.deployment_decision_conflict) {
        action = locale === 'zh' ? '修正部署决策冲突' : 'Fix deployment decision conflict';
        command = null;
        detail = activeModule.active_change.deployment_decision_conflict_reason
          || activeModule.active_change.deployment_warnings?.join(' ')
          || (locale === 'zh'
            ? 'proposal.md 与 tasks.md 的部署决策不一致，请先修正。'
            : 'proposal.md and tasks.md disagree on deployment decisions — fix them first.');
      } else {
        const nextAction = actionForProposalStep(locale, data.proposal_step);
        action = nextAction.action;
        command = nextAction.command;
        detail = t(locale, nextAction.detailKey, { slug });
      }
    }
  } else if (data.all_done) {
    action = t(locale, 'next.launch');
    command = 'openlogos launch';
    detail = t(locale, 'launch.suggest');
  } else {
    const firstModule = data.modules?.find(m => isAdoptedBootstrap(m.bootstrap) || m.lifecycle === 'initial');
    const bootstrapAdopted = isAdoptedBootstrap(firstModule?.bootstrap)
      || firstModule?.phase_progress?.['phase.1']?.skip_reason === 'bootstrap-adopted'
      || firstModule?.phase_progress?.['phase.2']?.skip_reason === 'bootstrap-adopted'
      || firstModule?.phase_progress?.['phase.3-0']?.skip_reason === 'bootstrap-adopted'
      || firstModule?.phase_progress?.['phase.1']?.skip_reason === 'bootstrap-skipped'
      || firstModule?.phase_progress?.['phase.2']?.skip_reason === 'bootstrap-skipped'
      || firstModule?.phase_progress?.['phase.3-0']?.skip_reason === 'bootstrap-skipped';

    if (bootstrapAdopted && !data.active_change) {
      action = locale === 'zh'
        ? '先补充项目基线文档'
        : 'Fill in the project baseline documents first';
      command = 'openlogos change add-baseline-docs';
      detail = locale === 'zh'
        ? '建议先创建补文档提案，再开始业务迭代。'
        : 'Create a baseline-docs change proposal before starting feature work.';
    } else {
      action = data.suggestion;
      command = null;
      detail = data.current_phase
        ? t(locale, 'next.phaseDetail', { phase: data.current_phase })
        : '';
    }
  }

  // 切片 C：--auto skip-gate（最小 A 方案，仅作用于现有 launched 停顿点）。默认（无 --auto）行为 1:1 不变。
  let autoGateId: string | null = null;
  let autoSkippable: boolean | null = null;
  let gateAutoPassed = false;
  // M2 切片 1a（R2 安全）：当前节点为未完成的 overlay-added 节点时，gate 未到达 → 不得 auto-pass。
  const activeStatusMod = data.modules?.find(m => m.active_change?.slug === data.active_change);
  const blockedByOverlayNode = Boolean(activeStatusMod?.current_node || data.current_node);
  // M2 切片 2：loop 阻塞仅当前沿已到 verify、跑过≥1 轮、未收敛（F1：不抢占 ready-to-merge 等前序停顿点）
  const loopState = activeStatusMod?.loop_state ?? data.loop_state;
  const loopAtVerify = data.proposal_step === 'ready-to-verify' || data.proposal_step === 'verify-failed'
    || data.current_phase === 'phase.3-6';
  const blockedByLoop = isLoopBlocking(loopState, loopAtVerify);
  if (auto) {
    if (blockedByLoop && loopState?.escalated) {
      // R1：达上限 → loop 退出 human gate，固定不可跳、照常阻塞、不写 GATE_AUTO_PASSED
      autoGateId = loopExhaustedGateId(loopState.subflow_id);
      autoSkippable = false;
    } else {
      // Review F3：卡在未完成 overlay-added 节点 / loop 未收敛时还没到 gate 边界 → gate_id/skippable 置 null
      const blocked = blockedByOverlayNode || blockedByLoop;
      const gate = (data.proposal_step && !blocked) ? gateForProposalStep(data.proposal_step) : null;
      autoGateId = gate ? gate.gate_id : null;
      autoSkippable = gate ? gate.skippable : null;
      if (gate && gate.skippable && data.active_change && !blocked) {
        appendGateAutoPassed(root, data.active_change, gate.gate_id, data.proposal_step!);
        gateAutoPassed = true;
        const passed = autoPassMessage(locale, gate.gate_id, data.proposal_step!, data.active_change);
        action = passed.action; command = passed.command; detail = passed.detail;
        const mi = moduleItems?.find(m => m.active_change === data.active_change);
        if (mi) { mi.action = passed.action; mi.command = passed.command; mi.detail = passed.detail; }
      }
    }
  }

  // Review F3：当前卡在未完成 overlay 节点 → 顶层 action/detail 指向该节点，不再提示后续 builtin gate/merge/verify
  const overlayCur = activeStatusMod?.current_node ?? data.current_node;
  if (overlayCur) {
    action = locale === 'zh'
      ? `先完成 overlay 节点「${overlayCur.name}」（${overlayCur.id}）${overlayCur.state === 'failed' ? '（失败，需修复）' : ''}`
      : `Finish overlay node "${overlayCur.name}" (${overlayCur.id})${overlayCur.state === 'failed' ? ' (failed — fix it)' : ''}`;
    command = null;
    detail = locale === 'zh' ? '当前流程卡在 overlay 节点，完成其判定后再推进后续步骤。'
      : 'Flow is at an overlay node; finish it before later steps.';
  }

  // M2 切片 2：loop 阻塞时顶层 action/detail 指向 loop（未被 overlay 节点抢占、且前沿已到 verify 时，F1）
  if (blockedByLoop && loopState && !overlayCur) {
    if (loopState.escalated) {
      action = locale === 'zh'
        ? `loop 已达迭代上限 ${loopState.max_iters} 轮仍未绿 → 升级人类确认（继续迭代 / 调整 / 放弃）`
        : `Loop hit max_iters=${loopState.max_iters} without green — human decision needed (continue / adjust / abandon)`;
      detail = locale === 'zh'
        ? `达迭代上限是人类确认点（gate: ${loopExhaustedGateId(loopState.subflow_id)}）；可调大 max_iters 续跑或修到测试绿。`
        : `Reaching max_iters is a human gate (gate: ${loopExhaustedGateId(loopState.subflow_id)}).`;
    } else {
      action = locale === 'zh'
        ? `loop 第 ${loopState.iteration}/${loopState.max_iters} 轮未绿 → 修复后重跑 openlogos verify（继续迭代）`
        : `Loop round ${loopState.iteration}/${loopState.max_iters} not green — fix and rerun openlogos verify`;
      detail = locale === 'zh'
        ? '让 working_agent 修复后重跑 verify；测试绿即出环续推。'
        : 'Fix and rerun verify; the loop exits once tests are green.';
    }
    command = null;
  }

  // base data 的 current_node：契约规定有 modules[] 时挂 modules[].current_node，仅 legacy 无 modules[] 才回退顶层（Review F4）
  const baseCurrentNode = data.modules === undefined ? data.current_node : undefined;
  // loop_state：有 modules[] 时挂 modules[].loop_state（透传），legacy 才回退顶层
  const baseLoopState = data.modules === undefined ? data.loop_state : undefined;

  // M2 切片 1b：cmd 执行后，顶层 action/detail 反映命令结果（done 续推 / 未通过重试 / 超时）
  if (cmdResult) {
    const r = cmdResult;
    if (r.satisfied) {
      // 命令通过：done_when:cmd → 节点完成续推；fail_when:cmd 通过 → 命中失败（节点 failed，由 overlayCur 接管）。
      // 若续推后落到未收敛 loop / 其它 overlay 节点，detail 应由其接管，不覆盖（避免 action=loop 而 detail=cmd 不一致，F2）；cmd 结果仍在机器字段。
      if (r.predicate_field === 'done_when' && !blockedByLoop && !overlayCur) {
        detail = locale === 'zh'
          ? `命令通过（exit 0），cmd 节点已完成，继续后续步骤。`
          : `Command passed (exit 0); cmd node done — proceeding.`;
      }
    } else {
      const reason = r.timed_out
        ? (locale === 'zh' ? '命令超时' : 'command timed out')
        : (locale === 'zh' ? `命令未通过（exit ${r.exit_code ?? '?'}）` : `command did not pass (exit ${r.exit_code ?? '?'})`);
      detail = locale === 'zh'
        ? `${reason}；cmd 节点判定未满足，修复后重新运行 openlogos next 再次求值。`
        : `${reason}; cmd predicate not satisfied — fix and run openlogos next to re-evaluate.`;
    }
  }

  const result: NextData = {
    action,
    command,
    detail,
    active_change: data.active_change,
    proposal_step: data.proposal_step,
    ...(moduleItems !== undefined ? { modules: moduleItems } : {}),
    ...(baseCurrentNode ? { current_node: baseCurrentNode } : {}),
    ...(baseLoopState ? { loop_state: baseLoopState } : {}),
    ...(auto ? { auto: true, gate_id: autoGateId, skippable: autoSkippable, gate_auto_passed: gateAutoPassed } : {}),
    ...(cmdResult ? {
      cmd_node_id: cmdResult.node_id,
      cmd_predicate_field: cmdResult.predicate_field,
      cmd_exit_code: cmdResult.exit_code,
      cmd_timed_out: cmdResult.timed_out,
      cmd_satisfied: cmdResult.satisfied,
    } : {}),
  };

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('next', result)));
    return;
  }

  console.log(`\n💡 ${t(locale, 'next.title')}\n`);

  if (moduleItems && moduleItems.length > 0) {
    for (const m of moduleItems) {
      const icon = m.lifecycle === 'initial' ? '🔄' : (m.action === 'blocked' ? '⏸️ ' : '✅');
      console.log(`  ${icon}  ${m.id} (${m.name})`);
      console.log(`       ${m.action}`);
      if (m.command) console.log(`       → ${m.command}`);
      if (m.detail) console.log(`       ${m.detail}`);
    }
  } else {
    console.log(`   ${action}`);
    if (command) console.log(`\n   → ${command}`);
    if (detail) console.log(`\n   ${detail}`);
  }
  console.log();
}
