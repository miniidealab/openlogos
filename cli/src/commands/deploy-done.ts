import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t, type Locale } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import { readProjectYaml } from '../lib/project-yaml.js';
import { detectProposalStepViaFlow, type CmdGateEval } from '../lib/flow-derive.js';
import { loadFlow, isCmdPred, FlowError, readProjectCmdTimeout } from '../lib/flow.js';
import { runFlowCmd, CmdSpawnError } from '../lib/flow-cmd.js';
import {
  parseTaskSections,
  resolveProposalDeploymentDecision,
  type ModuleInfo,
} from './status.js';

const DEPLOYMENT_REPORT_PATH = 'logos/resources/verify/deployment-report.md';

/**
 * S30·决策 G：verify 判定结果。
 * 通过时若经 done_when:cmd 求值 → 带 `cmdEval`（回灌 detectProposalStepViaFlow，使 next_step 正确推进到 deploy/smoke）。
 * 未通过时带 cmd 上下文（供错误 envelope message）。
 */
type VerifyForDeploy =
  | { passed: true; cmdEval?: CmdGateEval }
  | { passed: false; cmd?: { field: 'done_when' | 'fail_when'; command: string; exit_code: number | null; timed_out: boolean } };

/**
 * S30·决策 G：按 resolved verify 节点 per-field 谓词判定「verify 是否通过」。
 * marker verify（默认）= 现状逐字节等价（VERIFY_FAIL 存在→否；VERIFY_PASS 存在→是）。
 * cmd-gate verify（overlay modify）= 就地求值（fail>done）。
 * FlowError（含非法 overlay / 非法项目级 timeout）与 CmdSpawnError **向上抛**，由 deployDone fail loud（绝不吞错）。
 */
async function isVerifyPassedForDeploy(root: string, proposalDir: string): Promise<VerifyForDeploy> {
  const flow = loadFlow(root, { lifecycle: 'launched', resolved: true }).flow; // FlowError 传播
  let verify;
  for (const s of flow.subflows) for (const n of s.nodes) if (n.id === 'verify') verify = n;
  // 理论不可达（builtin launched 必有 verify 节点）：退回默认 marker 名
  if (!verify) return (existsSync(join(proposalDir, 'VERIFY_PASS')) && !existsSync(join(proposalDir, 'VERIFY_FAIL'))) ? { passed: true } : { passed: false };
  const done = verify.done_when, fail = verify.fail_when;
  // S30·#3（Medium）：与 status 派生（flow-derive markerName）一致——resolved verify 谓词只允许 cmd:/marker:。
  // 其它（如 file:logos/X）是配置错误：fail loud FLOW_SCHEMA_INVALID，绝不落到「未通过」误报 VERIFY_NOT_PASSED
  //（否则同一非法 flow，status 与 deploy-done 错误码不一致，自动化会把配置错当成验收未通过）。
  const assertVerifyPred = (field: 'done_when' | 'fail_when', pred: unknown) => {
    if (typeof pred === 'string' && (pred.startsWith('cmd:') || pred.startsWith('marker:'))) return;
    throw new FlowError('FLOW_SCHEMA_INVALID', `launched flow verify.${field} 期望 cmd:/marker: 谓词，实际为 ${pred}`);
  };
  assertVerifyPred('fail_when', fail);
  assertVerifyPred('done_when', done);
  // S30·#2（High）：marker 命中按 **resolved verify 节点的 marker 名**判定——
  // 支持 S25 overlay modify verify.done_when:marker:CUSTOM_VERIFY；默认 builtin（VERIFY_PASS/VERIFY_FAIL）逐字节等价。
  const markerHit = (pred: unknown): boolean =>
    typeof pred === 'string' && pred.startsWith('marker:') && existsSync(join(proposalDir, pred.slice('marker:'.length).trim()));
  // 仅当存在 cmd 谓词时才读项目级 timeout（marker-only verify 不应被无关的 timeout 配置卡住，保持现状）。
  // 非法项目级 timeout → FLOW_SCHEMA_INVALID 向上抛，在跑 cmd / 写 marker 前 fail loud。
  const timeout = (isCmdPred(done) || isCmdPred(fail)) ? (verify.cmd_timeout_seconds ?? readProjectCmdTimeout(root) ?? 60) : 60;
  const evalCmd = async (field: 'done_when' | 'fail_when', pred: string) => {
    const command = pred.slice('cmd:'.length).trim();
    let r;
    try {
      r = await runFlowCmd(command, root, timeout);
    } catch (e) {
      // CmdSpawnError：补上 field（契约：message 须含 verify.<field> + 命令 + errno），向上抛
      if (e instanceof CmdSpawnError) { (e as CmdSpawnError & { field?: string }).field = field; }
      throw e;
    }
    return { satisfied: r.exitCode === 0 && !r.timedOut, field, command, exit_code: r.exitCode, timed_out: r.timedOut };
  };
  // fail_when 优先（cmd / resolved marker 名）
  if (isCmdPred(fail)) { const r = await evalCmd('fail_when', fail!); if (r.satisfied) return { passed: false, cmd: r }; }
  else if (markerHit(fail)) return { passed: false };
  // done_when（cmd / resolved marker 名）
  if (isCmdPred(done)) {
    const r = await evalCmd('done_when', done!);
    // 通过：带 cmdEval 回灌（detect 据此推进过 verify → deploy/smoke），磁盘无 done marker 也不会误判停门前
    return r.satisfied ? { passed: true, cmdEval: { node_id: 'verify', field: 'done_when', satisfied: true } } : { passed: false, cmd: r };
  }
  if (typeof done === 'string' && done.startsWith('marker:')) return markerHit(done) ? { passed: true } : { passed: false };
  return { passed: false };
}

export interface ActiveProposalGuard {
  slug: string;
  proposalDir: string;
  moduleId: string | null;
}

export interface DeployDoneData {
  slug: string;
  environment: string | null;
  marker_path: string;
  deployment_report_path: string;
  deploy_tasks_checked: number;
  deploy_tasks_total: number;
  cleared_smoke_markers: string[];
  next_step: 'ready-to-smoke' | 'deploy-done';
}

interface SectionCheckResult {
  content: string;
  checked: number;
  total: number;
}

export function readActiveProposalGuard(root: string): ActiveProposalGuard | null {
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (!existsSync(guardPath)) return null;

  try {
    const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
    const slug = typeof guard.activeChange === 'string' ? guard.activeChange.trim() : '';
    if (!slug) return null;
    return {
      slug,
      proposalDir: join(root, 'logos', 'changes', slug),
      moduleId: typeof guard.module === 'string' && guard.module.trim() ? guard.module.trim() : null,
    };
  } catch {
    return null;
  }
}

export function checkTaskSection(content: string, tag: string): SectionCheckResult {
  const lines = content.split(/\r?\n/);
  const sectionPattern = /^## \[([a-z][a-z0-9-]*)\]/i;
  let inSection = false;
  let total = 0;

  const checkedLines = lines.map(line => {
    const sectionMatch = line.match(sectionPattern);
    if (sectionMatch) {
      inSection = sectionMatch[1].toLowerCase() === tag.toLowerCase();
      return line;
    }

    if (!inSection) return line;
    if (/^- \[[ x]\]/i.test(line)) {
      total += 1;
      return line.replace(/^- \[[ x]\]/i, '- [x]');
    }
    return line;
  });

  return {
    content: checkedLines.join('\n'),
    checked: total,
    total,
  };
}

function resolveModuleDefaults(root: string, moduleId: string | null): Pick<ModuleInfo, 'deployment_required' | 'smoke_required'> {
  const project = readProjectYaml(root).data;
  const modules = project?.modules ?? [];
  const selectedModule = moduleId
    ? modules.find(mod => mod.id === moduleId)
    : modules.length === 1 ? modules[0] : undefined;
  const gates = selectedModule ? project?.deployment_gates?.[selectedModule.id] : undefined;

  return {
    deployment_required: typeof gates?.deployment_required === 'boolean'
      ? gates.deployment_required
      : selectedModule?.deployment_required,
    smoke_required: typeof gates?.smoke_required === 'boolean'
      ? gates.smoke_required
      : selectedModule?.smoke_required,
  };
}

function fail(format: OutputFormat, locale: Locale, code: string, messageKey: string, vars?: Record<string, string>): never {
  const message = t(locale, messageKey, vars);
  failRaw(format, code, message);
}

/** S30：format 感知的原始 message 错误退出（json → envelope，否则 `Error: …`）。 */
function failRaw(format: OutputFormat, code: string, message: string): never {
  if (format === 'json') {
    console.error(JSON.stringify(makeErrorEnvelope('deploy-done', code, message)));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

function readDeploySummary(proposalDir: string): { checked: number; total: number } | null {
  const tasksPath = join(proposalDir, 'tasks.md');
  if (!existsSync(tasksPath)) return null;
  const sections = parseTaskSections(readFileSync(tasksPath, 'utf-8'));
  return sections?.deploy ?? null;
}

function clearSmokeMarkers(proposalDir: string): string[] {
  const cleared: string[] = [];
  for (const marker of ['SMOKE_PASS', 'SMOKE_FAIL']) {
    const markerPath = join(proposalDir, marker);
    if (existsSync(markerPath)) {
      rmSync(markerPath, { force: true });
      cleared.push(marker);
    }
  }
  return cleared;
}

function normalizeNextStep(step: string): DeployDoneData['next_step'] {
  return step === 'ready-to-smoke' ? 'ready-to-smoke' : 'deploy-done';
}

/** S30：verify 节点 done_when/fail_when 是否为 cmd-gate（读 resolved launched flow；FlowError 向上抛）。 */
function checkVerifyIsCmdGate(root: string): boolean {
  const flow = loadFlow(root, { lifecycle: 'launched', resolved: true }).flow;
  for (const s of flow.subflows) for (const n of s.nodes) if (n.id === 'verify') return isCmdPred(n.done_when) || isCmdPred(n.fail_when);
  return false;
}

/** S30：执行 verify 判定；FlowError/CmdSpawnError/未通过一律 fail loud；通过则返回结果（带 cmdEval 回灌用）。 */
async function verifyOrFail(root: string, proposalDir: string, format: OutputFormat, locale: Locale): Promise<{ passed: true; cmdEval?: CmdGateEval }> {
  let verifyResult: VerifyForDeploy;
  try {
    verifyResult = await isVerifyPassedForDeploy(root, proposalDir);
  } catch (e) {
    if (e instanceof FlowError) failRaw(format, e.code, e.message);
    if (e instanceof CmdSpawnError) {
      const field = (e as CmdSpawnError & { field?: string }).field ?? 'done_when';
      failRaw(format, 'FLOW_CMD_SPAWN_FAILED', `verify.${field} cmd gate 命令无法启动：${e.command}（${e.errno}）`);
    }
    throw e;
  }
  if (!verifyResult.passed) {
    const c = verifyResult.cmd;
    if (c) {
      const baseMsg = t(locale, 'deployDone.error.verifyNotPassed');
      failRaw(format, 'VERIFY_NOT_PASSED', `${baseMsg}：verify.${c.field} = cmd:${c.command}（${c.timed_out ? '超时' : `exit ${c.exit_code ?? '?'}`}）`);
    }
    fail(format, locale, 'VERIFY_NOT_PASSED', 'deployDone.error.verifyNotPassed');
  }
  return verifyResult;
}

export async function deployDone(format: OutputFormat = 'text', environment?: string) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');
  const locale = readLocale(root);

  if (!existsSync(configPath)) {
    fail(format, locale, 'PROJECT_NOT_INITIALIZED', 'deployDone.error.projectNotInitialized');
  }

  const active = readActiveProposalGuard(root);
  if (!active) {
    fail(format, locale, 'NO_ACTIVE_CHANGE', 'deployDone.error.noActiveChange');
  }

  if (!existsSync(active.proposalDir)) {
    fail(format, locale, 'CHANGE_NOT_FOUND', 'deployDone.error.changeNotFound', { slug: active.slug });
  }

  // S30·#2：verify 求值顺序按 verify 类型分流——
  //  · marker verify（默认）：保持 S21 旧顺序，verify marker 先于部署决策/报告校验（逐字节等价现状）；
  //  · cmd-gate verify：命令可有副作用，纯读前置（决策/section/报告）全过后再执行 cmd（无需部署/缺报告时绝不跑外部命令）。
  let verifyIsCmdGate: boolean;
  try {
    verifyIsCmdGate = checkVerifyIsCmdGate(root);
  } catch (e) {
    if (e instanceof FlowError) failRaw(format, e.code, e.message);
    throw e;
  }

  let verifyResult: { passed: true; cmdEval?: CmdGateEval } | undefined;
  if (!verifyIsCmdGate) {
    verifyResult = await verifyOrFail(root, active.proposalDir, format, locale); // marker：verify 先
  }

  const moduleDefaults = resolveModuleDefaults(root, active.moduleId);
  const deploymentDecision = resolveProposalDeploymentDecision(active.proposalDir, moduleDefaults);
  if (deploymentDecision.deployment_decision_conflict) {
    fail(format, locale, 'DEPLOYMENT_DECISION_CONFLICT', 'deployDone.error.decisionConflict', {
      reason: deploymentDecision.deployment_decision_conflict_reason ?? '',
    });
  }

  if (deploymentDecision.deployment_required !== true) {
    fail(format, locale, 'DEPLOYMENT_NOT_REQUIRED', 'deployDone.error.notRequired');
  }

  const deploySummary = readDeploySummary(active.proposalDir);
  if (!deploySummary || deploySummary.total === 0) {
    fail(format, locale, 'DEPLOY_TASKS_MISSING', 'deployDone.error.deployTasksMissing');
  }

  const deploymentReportFullPath = join(root, DEPLOYMENT_REPORT_PATH);
  if (!existsSync(deploymentReportFullPath)) {
    fail(format, locale, 'DEPLOYMENT_REPORT_MISSING', 'deployDone.error.deploymentReportMissing', {
      path: DEPLOYMENT_REPORT_PATH,
    });
  }

  if (verifyIsCmdGate) {
    verifyResult = await verifyOrFail(root, active.proposalDir, format, locale); // cmd-gate：纯读前置之后执行 cmd
  }

  const tasksPath = join(active.proposalDir, 'tasks.md');
  const checkedTasks = checkTaskSection(readFileSync(tasksPath, 'utf-8'), 'deploy');
  writeFileSync(tasksPath, checkedTasks.content);

  const markerRelativePath = `logos/changes/${active.slug}/DEPLOY_DONE`;
  writeFileSync(join(root, markerRelativePath), '');
  const clearedSmokeMarkers = clearSmokeMarkers(active.proposalDir);
  // S30·#1：cmd-gate verify 通过后磁盘无 VERIFY_PASS，必须把 cmdEval 回灌 detect，否则会误判停在 ready-to-verify
  //（→ 错误地把需 smoke 的提案报成可归档）。marker verify 时 cmdEval 为空、行为不变。
  const nextStep = normalizeNextStep(detectProposalStepViaFlow(active.proposalDir, moduleDefaults, verifyResult?.cmdEval));

  const data: DeployDoneData = {
    slug: active.slug,
    environment: environment ?? null,
    marker_path: markerRelativePath,
    deployment_report_path: DEPLOYMENT_REPORT_PATH,
    deploy_tasks_checked: checkedTasks.checked,
    deploy_tasks_total: checkedTasks.total,
    cleared_smoke_markers: clearedSmokeMarkers,
    next_step: nextStep,
  };

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('deploy-done', data)));
    return;
  }

  console.log(`\n${t(locale, 'deployDone.title')}\n`);
  console.log(`  ${t(locale, 'deployDone.proposal', { slug: data.slug })}`);
  if (data.environment) console.log(`  ${t(locale, 'deployDone.environment', { environment: data.environment })}`);
  console.log(`  ${t(locale, 'deployDone.marker', { path: data.marker_path })}`);
  console.log(`  ${t(locale, 'deployDone.deployTasks', {
    checked: String(data.deploy_tasks_checked),
    total: String(data.deploy_tasks_total),
  })}`);
  console.log(`  ${t(locale, 'deployDone.clearedSmokeMarkers', {
    markers: data.cleared_smoke_markers.length > 0 ? data.cleared_smoke_markers.join(', ') : '-',
  })}`);
  const nextCommand = data.next_step === 'ready-to-smoke'
    ? `openlogos smoke${data.environment ? ` --env ${data.environment}` : ''}`
    : `openlogos archive ${data.slug}`;
  console.log(`\n${t(locale, data.next_step === 'ready-to-smoke' ? 'deployDone.nextSmoke' : 'deployDone.nextArchive', {
    command: nextCommand,
  })}\n`);
}
