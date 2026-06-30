/**
 * flow-derive — M1 切片 B1：initial 模块的 phase 派生引擎。
 *
 * 把硬编码的 PHASE_KEYS / PHASE_SUBPATHS / SCENARIO_PHASES / SKIP_PHASE_MAP 改为从 **builtin**
 * initial flow（spec/flow/initial.yaml）派生，再经 code 侧 node-id→phase-key 映射产出与现状
 * 逐字节一致的 phase_progress / 顶层 phases[] / current_phase。
 *
 * 规则（见 docs/orchestratable-flow-design.md、spec/flow-spec.md §12，与 status.ts 原逻辑 1:1）：
 * - 只用 builtin flow，**不应用项目 overlay**（overlay 驱动留后续切片）。
 * - 两套 legacy done 语义由消费端决定：顶层 phases[] = any-present、per-module = all-present（场景覆盖）。
 * - 场景文件保留 legacy `includes()` 子串匹配（非 glob）。
 *
 * 切片 B2：新增 `detectProposalStepViaFlow`——launched 模块的 ProposalStep 改由 builtin
 * launched flow 派生。launched.yaml 提供节点序列与 done_when/fail_when 的 marker/section 名；
 * marker 非对称优先级与提案级部署决策（resolveProposalDeploymentDecision）作为引擎规则保留，
 * 逐分支镜像旧 detectProposalStep（1:1 不改行为）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAdoptedBootstrap } from './project-yaml.js';
import { loadBuiltinFlow, loadFlow, FlowError, fanoutDone, readProjectCmdTimeout } from './flow.js';
import { listFiles } from './list-files.js';
import {
  resolveProposalDeploymentDecision,
  getDeploySectionSummary,
  parseTaskSections,
  isProposalTemplateFilled,
  isTasksTemplateFilled,
  countMergeableDeltaFiles,
  allTasksChecked,
  hasSmokeCasesForProposal,
  PLAN_APPROVED_MARKER,
  SLICES_APPROVED_MARKER,
} from './proposal-lifecycle.js';
import type { ProposalStep } from './proposal-lifecycle.js';
import type { ModuleInfo, PhaseProgressItem } from '../commands/status.js';

/** node id → 原 PHASE_KEYS（13 个 1:1）。维护在 code 侧以保持 spec/flow/*.yaml 纯净。 */
export const NODE_TO_PHASE_KEY: Record<string, string> = {
  'prd': 'phase.1',
  'product-design': 'phase.2',
  'architecture': 'phase.3-0',
  'scenario-modeling': 'phase.3-1',
  'api-design': 'phase.3-2-api',
  'db-design': 'phase.3-2-db',
  'deployment-design': 'phase.3-3-deployment',
  'test-cases': 'phase.3-4a',
  'orchestration-test': 'phase.3-4b',
  'code': 'phase.3-5',
  'verify': 'phase.3-6',
  'deploy': 'phase.3-7-deploy',
  'smoke': 'phase.3-8-smoke',
};

/**
 * S28：phase key → builtin node id 的**显式正向映射**（next_node 解析 initial 当前节点用）。
 * 故意独立成表而非反查 `NODE_TO_PHASE_KEY`，避免实现误用反向查找。
 */
export const PHASE_KEY_TO_NODE_ID: Record<string, string> = {
  'phase.1': 'prd',
  'phase.2': 'product-design',
  'phase.3-0': 'architecture',
  'phase.3-1': 'scenario-modeling',
  'phase.3-2-api': 'api-design',
  'phase.3-2-db': 'db-design',
  'phase.3-3-deployment': 'deployment-design',
  'phase.3-4a': 'test-cases',
  'phase.3-4b': 'orchestration-test',
  'phase.3-5': 'code',
  'phase.3-6': 'verify',
  'phase.3-7-deploy': 'deploy',
  'phase.3-8-smoke': 'smoke',
};

const BOOTSTRAP_WHEN = 'bootstrap != adopted';

export interface FlowPhasePlanItem {
  phaseKey: string;
  subpath: string;        // node.produces，已去除末尾斜杠（== 原 PHASE_SUBPATHS[i]）
  isScenario: boolean;    // node.for_each 存在
  whenExpr: string | null;
  nodeId: string;
  overlaySkipped?: boolean; // M2 切片 1a：overlay op:skip / when=false 在 resolved 中标记的跳过
  coverageThreshold?: number; // S29：fan-out 聚合阈值（0<x<=1）；仅 done_when:all_present 节点；未设置则省略
}

/**
 * 构建有序 phase plan（顺序 == 原 PHASE_KEYS）。
 * 默认读 builtin；传入 root 时读 **resolved flow（含 overlay）**——使 initial 的 overlay
 * skip/modify/reorder 真正驱动派生（无 overlay 时 resolved==builtin，逐字节不变）。
 */
export function buildInitialPhasePlan(root?: string): FlowPhasePlanItem[] {
  const flow = root ? loadFlow(root, { lifecycle: 'initial', resolved: true }).flow : loadBuiltinFlow('initial');
  const items: FlowPhasePlanItem[] = [];
  for (const sub of flow.subflows) {
    for (const node of sub.nodes) {
      const phaseKey = NODE_TO_PHASE_KEY[node.id];
      if (!phaseKey) continue;
      const produces = node.produces ?? '';
      // fan-out 节点的 produces 是文件模式（含 {scenario}），扫描路径取其目录；
      // 其余为目录（去末尾斜杠）或报告文件路径（原样，listFiles 支持文件）。
      const subpath = node.for_each
        ? produces.slice(0, produces.lastIndexOf('/'))
        : produces.replace(/\/+$/, '');
      items.push({
        phaseKey,
        subpath,
        isScenario: Boolean(node.for_each),
        whenExpr: node.when ?? null,
        nodeId: node.id,
        overlaySkipped: node.skipped === true,
        // S29：仅 done_when:all_present 的 fan-out 节点带阈值（校验已保证合法挂载）；未设置则 undefined
        ...(node.coverage_threshold != null ? { coverageThreshold: node.coverage_threshold } : {}),
      });
    }
  }
  return items;
}

interface WhenContext {
  api_enabled: boolean;
  db_enabled: boolean;
  scenario_enabled: boolean;
  deployment_required: boolean;
  smoke_required: boolean;
}

function whenContext(mod: ModuleInfo): WhenContext {
  const skip = mod.skip_phases ?? [];
  const deployment_required = mod.deployment_required !== false && !skip.includes('deployment');
  return {
    api_enabled: !skip.includes('api'),
    db_enabled: !skip.includes('database'),
    scenario_enabled: !skip.includes('scenario'),
    deployment_required,
    smoke_required: deployment_required && mod.smoke_required !== false,
  };
}

/**
 * 求值 node.when。支持最小表达式集：`flag` / `not flag` / `bootstrap != adopted`。
 * 返回 true = 节点参与流程；false = 该节点被跳过。
 */
function evalWhen(expr: string, mod: ModuleInfo, ctx: WhenContext): boolean {
  const e = expr.trim();
  if (e === BOOTSTRAP_WHEN) return !isAdoptedBootstrap(mod.bootstrap);
  if (e.startsWith('not ')) {
    const flag = e.slice(4).trim() as keyof WhenContext;
    return !ctx[flag];
  }
  return Boolean(ctx[e as keyof WhenContext]);
}

/** 求值单个节点的 `when`：无 when 视为参与；用于 overlay 节点走查（flow-overlay-derive）。 */
export function evalNodeWhen(when: string | null | undefined, mod: ModuleInfo): boolean {
  if (!when) return true;
  return evalWhen(when, mod, whenContext(mod));
}

/**
 * 复现 deriveExplicitSkipPhaseKeys：返回因显式 `when`（非 bootstrap）为假而跳过的 phase key 集合。
 * 用于多模块全局 skip 交集。
 */
export function flowExplicitSkipPhaseKeys(
  mod: ModuleInfo,
  plan: FlowPhasePlanItem[] = buildInitialPhasePlan(),
): Set<string> {
  const ctx = whenContext(mod);
  const skip = new Set<string>();
  for (const item of plan) {
    if (!item.whenExpr || item.whenExpr === BOOTSTRAP_WHEN) continue;
    if (!evalWhen(item.whenExpr, mod, ctx)) skip.add(item.phaseKey);
  }
  return skip;
}

/**
 * 复现 deriveModulePhaseProgress：per-module 派生（场景阶段 all-present 覆盖度）。
 * 与 status.ts 原算法 1:1（仅数据来源改为 builtin flow plan）。
 */
export function deriveModulePhaseProgressViaFlow(
  root: string,
  mod: ModuleInfo,
  scenarios: Array<{ id: string }>,
  isMultiModule: boolean = false,
  plan: FlowPhasePlanItem[] = buildInitialPhasePlan(root),
): { progress: Record<string, PhaseProgressItem>; currentPhase: string | null } {
  const progress: Record<string, PhaseProgressItem> = {};
  const ctx = whenContext(mod);

  for (const item of plan) {
    const key = item.phaseKey;
    const dir = join(root, item.subpath);

    // overlay op:skip 标记的内置节点 → skipped（M2 切片 1a：initial overlay skip 生效）
    if (item.overlaySkipped) {
      progress[key] = { done: false, skipped: true };
      continue;
    }

    // bootstrap-adopted：phase.1/2/3-0 的 when 为 `bootstrap != adopted`，adopted 时跳过并标 reason
    if (item.whenExpr === BOOTSTRAP_WHEN && isAdoptedBootstrap(mod.bootstrap)) {
      progress[key] = { done: false, skipped: true, skip_reason: 'bootstrap-adopted' };
      continue;
    }

    // 其余显式 when 为假 → 跳过（== deriveExplicitSkipPhaseKeys）
    if (item.whenExpr && item.whenExpr !== BOOTSTRAP_WHEN && !evalWhen(item.whenExpr, mod, ctx)) {
      progress[key] = { done: false, skipped: true };
      continue;
    }

    if (item.isScenario) {
      // 场景阶段：per-module 全覆盖才 done（legacy includes 子串匹配）
      const suffix = key === 'phase.3-1' ? '' : '-test-cases';
      const covered: string[] = [];
      const missing: string[] = [];
      for (const s of scenarios) {
        const pattern = `${mod.id}-${s.id}`;
        const files = listFiles(dir);
        const found = files.some(f => f.includes(pattern) && (suffix === '' || f.includes(suffix)));
        if (found) covered.push(s.id);
        else missing.push(s.id);
      }
      // S29：fan-out 聚合阈值。复用共享 fanoutDone（缺省=全覆盖 all_present；设阈值时 covered/total>=阈值；total==0 维持现状）。
      const total = scenarios.length;
      progress[key] = {
        done: fanoutDone(covered.length, total, item.coverageThreshold),
        skipped: false,
        scenario_coverage: { total, covered: covered.length, missing },
      };
    } else {
      // 非场景阶段：多模块按 {module}- 前缀过滤，单模块任意文件
      const allFiles = listFiles(dir);
      const files = isMultiModule
        ? allFiles.filter(f => (f.split('/').pop() ?? f).startsWith(`${mod.id}-`))
        : allFiles;
      progress[key] = { done: files.length > 0, skipped: false };
    }
  }

  // fallback-skip：已完成 phase 之前的空 phase 标 skipped（NON_FALLBACK 除外）
  const keys = plan.map(p => p.phaseKey);
  const lastDoneIdx = keys.reduce((acc, k, i) => (progress[k].done ? i : acc), -1);
  for (let i = 0; i < lastDoneIdx; i++) {
    if (!progress[keys[i]].done && !NON_FALLBACK_SKIP_PHASE_KEYS.has(keys[i])) progress[keys[i]].skipped = true;
  }

  const currentPhase = keys.find(k => !progress[k].done && !progress[k].skipped) ?? null;
  return { progress, currentPhase };
}

/** 与 status.ts NON_FALLBACK_SKIP_PHASES 对齐（免于 fallback-skip 的 phase）。 */
export const NON_FALLBACK_SKIP_PHASE_KEYS = new Set([
  'phase.3-3-deployment',
  'phase.3-7-deploy',
  'phase.3-8-smoke',
]);

// ── 切片 B2：launched 模块 ProposalStep 派生 ──

/** S30：cmd gate 的 marker 占位——永不存在的文件名 → status/watch 下该 gate 恒「未满足、停门前」。 */
const CMD_GATE_SENTINEL = '.__openlogos_cmd_gate_never__';

/** S30：cmd gate 描述符（供 next 求值 + cmd_gate 字段输出）。 */
export interface CmdGateDesc {
  node_id: string;          // 'verify' | 'deploy' | 'smoke'
  field: 'done_when' | 'fail_when';
  command: string;          // cmd: 之后已 trim
}
/** S30：next 求值某 builtin gate cmd 后回灌 detect 的结果（budget=1，至多一个）。 */
export interface CmdGateEval {
  node_id: string;
  field: 'done_when' | 'fail_when';
  satisfied: boolean;
}

interface LaunchedMarkers {
  verifyFail: string;
  verifyPass: string;
  mergePrompt: string[];
  merged: string[];
  deployDone: string;
  smokeFail: string;
  smokePass: string;
  // S30：launched gate 的 cmd 字段（overlay-modify 时），键 = `${node_id}.${field}`
  cmdGates: Record<string, CmdGateDesc>;
}

function markerName(pred: string | null | undefined): string {
  // S30：cmd: 字段不抽 marker 名，返回永不存在的占位（status/watch 停门前；next 走 cmd 回灌）
  if (typeof pred === 'string' && pred.startsWith('cmd:')) return CMD_GATE_SENTINEL;
  if (!pred || !pred.startsWith('marker:')) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `launched flow 期望 marker: 谓词，实际为 ${pred}`);
  }
  return pred.slice('marker:'.length).trim();
}

function anyPresentList(pred: string | null | undefined): string[] {
  if (!pred || !pred.startsWith('any_present:')) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `launched flow 期望 any_present: 谓词，实际为 ${pred}`);
  }
  const inner = pred.slice('any_present:'.length).trim().replace(/^\[|\]$/g, '');
  return inner.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 提取生命周期 marker/section 名（flow 声明，引擎据此判定）。
 * 默认 builtin；传入 root 时读 **resolved flow（含 overlay）**——使 launched 的
 * `modify`（改 marker 名）经 flow 流入检测（无 overlay 时 resolved==builtin）。
 */
function extractLaunchedMarkers(root?: string): LaunchedMarkers {
  const flow = root ? loadFlow(root, { lifecycle: 'launched', resolved: true }).flow : loadBuiltinFlow('launched');
  const byId: Record<string, { done_when?: string | null; fail_when?: string | null }> = {};
  for (const sub of flow.subflows) for (const n of sub.nodes) byId[n.id] = n;
  const need = (id: string) => {
    const n = byId[id];
    if (!n) throw new FlowError('FLOW_SCHEMA_INVALID', `launched flow 缺少节点 ${id}`);
    return n;
  };
  // S30：收集 launched gate 上的 cmd 字段（overlay-modify 时）→ cmdGates
  const cmdGates: Record<string, CmdGateDesc> = {};
  const collectCmd = (nodeId: string, field: 'done_when' | 'fail_when') => {
    const pred = byId[nodeId]?.[field];
    if (typeof pred === 'string' && pred.startsWith('cmd:')) {
      cmdGates[`${nodeId}.${field}`] = { node_id: nodeId, field, command: pred.slice('cmd:'.length).trim() };
    }
  };
  for (const id of ['verify', 'deploy', 'smoke']) {
    collectCmd(id, 'done_when');
    collectCmd(id, 'fail_when');
  }
  return {
    verifyFail: markerName(need('verify').fail_when),
    verifyPass: markerName(need('verify').done_when),
    mergePrompt: anyPresentList(need('generate-merge-prompt').done_when),
    merged: anyPresentList(need('apply-merge').done_when),
    deployDone: markerName(need('deploy').done_when),
    smokeFail: markerName(need('smoke').fail_when),
    smokePass: markerName(need('smoke').done_when),
    cmdGates,
  };
}

/**
 * 复现 detectProposalStep：launched 模块 ProposalStep 改由 builtin launched flow 派生。
 * marker/section 名来自 launched.yaml；分支优先级（VERIFY_FAIL 全局最先、SMOKE 仅在 deploy 完成子块内）
 * 与提案级部署决策（resolveProposalDeploymentDecision）为引擎规则，1:1 镜像旧逻辑。
 */
export function detectProposalStepViaFlow(
  proposalDir: string,
  moduleDefaults: Pick<ModuleInfo, 'deployment_required' | 'smoke_required'> = {},
  cmdEval?: CmdGateEval | null,
): ProposalStep {
  // proposalDir = <root>/logos/changes/<slug> → root 上溯三级（读 resolved launched flow 含 overlay）
  const root = join(proposalDir, '..', '..', '..');
  const m = extractLaunchedMarkers(root);
  const exists = (name: string) => existsSync(join(proposalDir, name));
  const anyExists = (names: string[]) => names.some(exists);
  // S30：cmd gate 满足判定——marker 字段走 existsSync；cmd 字段仅当 next 回灌 cmdEval 命中时为真（status/watch 恒 false → 停门前）
  const cmdMet = (nodeId: string, field: 'done_when' | 'fail_when') =>
    Boolean(cmdEval && cmdEval.node_id === nodeId && cmdEval.field === field && cmdEval.satisfied);
  const gateMet = (nodeId: string, field: 'done_when' | 'fail_when', marker: string) =>
    (`${nodeId}.${field}` in m.cmdGates) ? cmdMet(nodeId, field) : exists(marker);
  const tasksContent = existsSync(join(proposalDir, 'tasks.md'))
    ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';

  // verify.fail_when（VERIFY_FAIL / cmd）—— 全局最先
  if (gateMet('verify', 'fail_when', m.verifyFail)) return 'verify-failed';

  // verify.done_when（VERIFY_PASS / cmd）—— 进入 deliver/deploy 子块
  if (gateMet('verify', 'done_when', m.verifyPass)) {
    const deploy = getDeploySectionSummary(tasksContent);
    const hasDeployTasks = Boolean(deploy && deploy.total > 0);
    const deploymentDecision = resolveProposalDeploymentDecision(proposalDir, moduleDefaults);

    if (deploymentDecision.deployment_decision_conflict) return 'verify-passed';
    if (deploymentDecision.deployment_required !== true) return 'verify-passed';
    if (!hasDeployTasks) return 'ready-to-deploy';

    // S30：deploy.done_when 为 cmd-gate 时，cmd 是「deploy 是否 done」的唯一裁判——
    // 不再被 deployTasksChecked（人类勾选 [deploy]）拦住（cmd exit 0 即过门，否则停门前）。marker deploy 行为不变。
    const deployIsCmdGate = 'deploy.done_when' in m.cmdGates;
    const deployDone = gateMet('deploy', 'done_when', m.deployDone);
    const deployTasksChecked = deploy!.checked === deploy!.total;
    if (!deployDone || (!deployIsCmdGate && !deployTasksChecked)) return 'ready-to-deploy';

    // smoke.fail_when/done_when —— 仅在 deploy 完成子块内评估（非全局优先）
    if (gateMet('smoke', 'fail_when', m.smokeFail)) return 'smoke-failed';
    if (gateMet('smoke', 'done_when', m.smokePass)) return 'smoke-passed';
    if (deploymentDecision.smoke_required === false) return 'deploy-done';
    if (deploymentDecision.smoke_required === true) return 'ready-to-smoke';
    if (hasSmokeCasesForProposal(proposalDir)) return 'ready-to-smoke';
    return 'deploy-done';
  }

  // apply-merge.done_when（SPEC_MERGED | MERGED）
  if (anyExists(m.merged)) {
    const sections = parseTaskSections(tasksContent);
    if (sections !== null) {
      const code = sections['code'];
      // section_complete legacy 语义：present-but-empty（total=0）不算完成
      if (!code || (code.total > 0 && code.checked === code.total)) return 'ready-to-verify';
      // split-slice-planner-stage：[code] 有未完成切片，slice-exit 门未放行（无 SLICES_APPROVED）→ ready-to-implement；放行后 → coding。
      if (!exists(SLICES_APPROVED_MARKER)) return 'ready-to-implement';
      return 'coding';
    }
    return 'ready-to-verify';
  }

  // generate-merge-prompt.done_when（MERGE_PROMPT_GENERATED | MERGE_PROMPT.md）
  if (anyExists(m.mergePrompt)) return 'merge-generated';

  // write-proposal.done_when（proposal_package_filled = proposal.md + tasks.md 均脱模板）
  const proposalContent = existsSync(join(proposalDir, 'proposal.md'))
    ? readFileSync(join(proposalDir, 'proposal.md'), 'utf-8') : '';
  if (!isProposalTemplateFilled(proposalContent) || !isTasksTemplateFilled(tasksContent)) {
    return 'writing';
  }

  // write-delta.done_when（section_complete:delta）/ code（section_complete:code）
  const sections = parseTaskSections(tasksContent);
  if (sections !== null) {
    const delta = sections['delta'];
    const code = sections['code'];
    if (!delta) {
      // 无 [delta] section = 纯代码提案（区别于 present-but-empty 的 [delta]）
      if (!code || (code.total > 0 && code.checked === code.total)) return 'ready-to-verify';
      return 'coding';
    }
    if (delta.total > 0 && delta.checked === delta.total) return 'ready-to-merge';
    // change-flow-redesign：delta 尚未启动且 plan 门未消费 → ready-to-delta（plan 出口驻留态）。
    // PLAN_APPROVED 是 plan-exit 被 --auto 消费后的状态源；GATE_AUTO_PASSED 仅为审计，不参与派生。
    if (delta.checked === 0 && countMergeableDeltaFiles(proposalDir) === 0 && !exists(PLAN_APPROVED_MARKER)) return 'ready-to-delta';
    return 'delta-writing';
  }

  // 旧格式兜底
  const mergeableDeltaCount = countMergeableDeltaFiles(proposalDir);
  if (mergeableDeltaCount > 0 && allTasksChecked(tasksContent)) return 'ready-to-merge';
  return 'delta-writing';
}

/**
 * S30：proposal_step → 其前沿 gate 节点 id（仅「停门前」三步）。
 * **不含 *-failed**：节点已被非 cmd 字段（或 cmd 命中）解析为 failed → 非 pending 前沿，
 * 不输出 cmd_gate、next 也不再求值 cmd（B3 frontier；如 done_when:cmd + fail_when:marker:VERIFY_FAIL 命中失败）。
 */
const STEP_TO_GATE_NODE: Record<string, string> = {
  'ready-to-verify': 'verify',
  'ready-to-deploy': 'deploy',
  'ready-to-smoke': 'smoke',
};

/**
 * S30：派生当前前沿 builtin gate 的 cmd_gate 描述符（含生效超时）；非 cmd-gate / 非相关 step → null。
 * fail_when 优先于 done_when（前沿 next 先评 fail）。供 status/watch/next 输出 cmd_gate + next 求值取命令。
 */
export function deriveLaunchedCmdGate(
  root: string,
  proposalStep: string,
): (CmdGateDesc & { timeout_seconds: number }) | null {
  const nodeId = STEP_TO_GATE_NODE[proposalStep];
  if (!nodeId) return null;
  const m = extractLaunchedMarkers(root);
  const desc = m.cmdGates[`${nodeId}.fail_when`] ?? m.cmdGates[`${nodeId}.done_when`];
  if (!desc) return null;
  // timeout：节点级 cmd_timeout_seconds > 项目级 flow.cmd_timeout_seconds > 60s。
  // 项目级用校验版 readProjectCmdTimeout——非法值 fail loud（FLOW_SCHEMA_INVALID），与执行路径一致。
  const flow = loadFlow(root, { lifecycle: 'launched', resolved: true }).flow;
  let nodeTimeout: number | null = null;
  for (const s of flow.subflows) for (const n of s.nodes) if (n.id === nodeId) nodeTimeout = n.cmd_timeout_seconds ?? null;
  const projectTimeout = readProjectCmdTimeout(root);
  return { ...desc, timeout_seconds: nodeTimeout ?? projectTimeout ?? 60 };
}

// ── 切片 C：next --auto skip-gate 的 gate 查询助手 ──

export interface GateInfo {
  /** gate_id 派生值 = `<subflow.id>-<gate.position>`（见 spec/cli-json-output.md）。 */
  gate_id: string;
  /** 该人类 gate 是否允许 auto 跳过。 */
  skippable: boolean;
}

/**
 * proposal_step → 其所处的 launched subflow gate 的映射（引擎规则）。
 * change-flow-redesign 后三个可跳人类停顿点：ready-to-delta（plan 出口）、
 * ready-to-merge（spec 出口，由原 propose 改）、ready-to-deploy（deliver 入口）。
 * gate_id 由 gateForProposalStep 按 `<subflow.id>-<position>` 派生 → plan-exit / spec-exit / deliver-entry。
 */
const STEP_TO_GATE_SUBFLOW: Record<string, string> = {
  'ready-to-delta': 'plan',
  'ready-to-merge': 'spec',
  'ready-to-implement': 'slice', // split-slice-planner-stage：gate_id 派生为 slice-exit
  'ready-to-deploy': 'deliver',
};

/**
 * 取某 proposal_step 对应 launched gate 的 `{gate_id, skippable}`；无对应 human gate 时返回 null。
 * gate_id 与 skippable 均从 builtin launched flow 派生（flow 漂移由 S24 守卫测试兜底）。
 */
export function gateForProposalStep(step: string): GateInfo | null {
  const subflowId = STEP_TO_GATE_SUBFLOW[step];
  if (!subflowId) return null;
  const flow = loadBuiltinFlow('launched');
  const sub = flow.subflows.find(s => s.id === subflowId);
  if (!sub || !sub.gate || sub.gate.type !== 'human') return null;
  const position = sub.gate.position ?? 'exit';
  return { gate_id: `${subflowId}-${position}`, skippable: Boolean(sub.gate.skippable) };
}
