import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadFlow, findActivatedLoop, inferLifecycle, FlowError } from '../lib/flow.js';
import { loopLedgerPath, readLoopIters, deriveSliceState } from '../lib/flow-loop-derive.js';
import { readProjectYaml } from '../lib/project-yaml.js';
import { readLocale, t } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import {
  readVerifyConfig,
  type NormalizedVerifyConfig,
} from '../lib/verify-config.js';
import {
  buildInitialSandboxData,
  normalizeSandboxConfig,
  runSandboxedCommand,
  type SandboxCommandResult,
  type SandboxData,
} from '../lib/sandbox.js';
import { getDeployTasks } from './status.js';
import { checkSmokeCoverage, resolveSmokeCommand, type SmokeCoverageCheck } from '../lib/smoke-coverage.js';
import { deriveAutomationDiagnostic, type AutomationDiagnostic } from '../lib/automation-diagnostic.js';
import {
  appendSliceCheckpoint,
  deriveSliceVerificationState,
  type SliceVerificationState,
} from '../lib/test-slice-manifest.js';
import { contractVersion } from '../lib/step-registry.js';
import { acquireResultPathLocks, ResultPathBusyError, type ResultPathLockHandle } from '../lib/result-path-lock.js';
import {
  startHistoryRun, writeHistoryRun, historyTextLine, testPauseAfterReport, captureResultBytes,
  type HistoryMeta, type HistoryRunContext, type HistoryFinish,
} from '../lib/verification-history.js';
import { VERIFY_PASS_MARKER } from '../lib/proposal-markers.js';
import { TABLE_CELL_ID_RE, MANUAL_MARKER_RE } from '../lib/test-id.js';
import {
  moduleIdsOf,
  readChangedTestIdsForScope,
  resolveVerifyScope,
  testFileInScope,
  testFileModule,
  type VerifyScopeData,
} from '../lib/verify-scope.js';
import { MODULE_ROW_LABEL, moduleReportPath, publishReportAtomically, registeredModules } from '../lib/module-phase-report.js';
import { readStrictSkipSet, classifySkips, type SkipClassification } from '../lib/verify-skip-classification.js';
import {
  runVerifyPrecheck, readRawVerifyConfig, describeMissing,
  type PrecheckOutcome, type VerifyRequirementsData,
} from '../lib/verify-requirements.js';

export interface TestResult {
  id: string;
  status: 'pass' | 'fail' | 'skip';
  duration_ms?: number;
  timestamp?: string;
  error?: string;
  scenario?: string;
  /** verify-self-sufficient-cases（§2.106.6）：跳过原因；平台跳过为 platform-unavailable。 */
  reason_code?: string;
  detail?: string;
}

export interface VerifyInvalidResult {
  line: number;
  id?: string;
  status?: string;
  reason: string;
}

export interface VerifyConsistencyData {
  ok: boolean;
  reasons: string[];
  unknown_result_ids: string[];
  manual_result_ids: string[];
  outside_eligible_result_ids: string[];
  invalid_results: VerifyInvalidResult[];
  count_mismatches: string[];
  /** additive：每条计数矛盾点名两个相互矛盾的计数器取值与来源（S13 不变量 6）。 */
  count_mismatch_details?: Array<{ code: string; left: string; right: string }>;
}

const TEST_CASES_DIR = 'logos/resources/test';
const REPORT_DIR = 'logos/resources/verify';
// 标记语法取自 test-id.ts 的唯一权威（`[manual]` / `[manual/<平台>]`），不在此另写一份。
const MANUAL_SUFFIX = MANUAL_MARKER_RE;

const LINE = '─'.repeat(50);



export type VerifyPreRunMode = 'none' | 'pre_run_command' | 'two_phase';
export type VerifyPreRunStage = 'pre_run' | 'regression' | 'incremental';

export interface VerifyPreRunCommandResult {
  stage: VerifyPreRunStage;
  command: string;
  status: 'pass' | 'fail' | 'skipped';
  exit_code?: number;
  duration_ms?: number;
  error?: string;
  /** 仅 `--format json` 且实际执行的条目：有界输出尾部（功能规格 §2.7，`spec/cli-json-output.md` §4.5）。 */
  stdout_tail?: string;
  stderr_tail?: string;
}

export interface VerifyPreRunData {
  mode: VerifyPreRunMode;
  commands: Array<VerifyPreRunCommandResult & {
    sandbox?: SandboxData;
    /** module-scoped-verify：该命令组服务的模块 id（仅启用模块范围或 --all 时输出）。 */
    modules?: string[];
  }>;
  result_paths: {
    final: string;
    regression: string | null;
    incremental: string | null;
  };
  merge_strategy: 'last-write-wins' | null;
  diagnostics: string[];
  suggestions: string[];
}

export interface VerifyData {
  contract: { version: string };
  summary: {
    defined_count: number;
    ut_count: number;
    st_count: number;
    manual_count: number;
    executed_count: number;
    passed_count: number;
    failed_count: number;
    skipped_count: number;
    uncovered_count: number;
    coverage_pct: number;
    pass_rate_pct: number;
  };
  gate: {
    result: 'PASS' | 'FAIL';
    reason: string | null;
  };
  failed_cases: Array<{ id: string; error: string }>;
  uncovered_cases: string[];
  skipped_cases: string[];
  consistency: VerifyConsistencyData;
  pre_run: VerifyPreRunData;
  smoke_precheck: SmokeCoverageCheck;
  sandbox: SandboxData;
  report_path: string;
  verify_mode?: 'slice-checkpoint' | 'final';
  attempted_slice_id?: string | null;
  eligible_test_ids?: string[];
  pending_test_ids?: string[];
  manifest?: SliceVerificationState['manifest'];
  checkpoint?: SliceVerificationState['checkpoint'];
  test_change_set?: SliceVerificationState['test_change_set'];
  automation_diagnostic?: AutomationDiagnostic;
  /** verification-history（§2.104.10）：本次运行写入的历史元数据；进入执行前被拒绝时不出现。 */
  history?: HistoryMeta;
  /** module-scoped-verify（§2.96.7）：只在启用模块范围或传 --all 时输出。 */
  scope?: VerifyScopeData;
  /** verify-self-sufficient-cases（§2.106.5）：声明了环境要求或验收标准列出条目时输出。 */
  requirements?: VerifyRequirementsData;
  /** §2.106.6：严格判定集合内的平台跳过（非空时输出）。 */
  platform_skipped_cases?: Array<{ id: string; detail: string }>;
  /** §2.106.6：严格判定集合内的非平台跳过——用例分层错误（非空时输出）。 */
  tier_mismatch_cases?: Array<{ id: string; reason_code?: string; detail?: string; fix_hint: string }>;
  /** §2.106.6：已有 SPEC_MERGED 但测试变更集校验失败（门禁原因 test_change_set_invalid）。 */
  change_set_diagnostic?: { code: 'test_change_set_invalid'; detail: string };
  /** 不改门禁结论的提醒（非空时输出）：存量与无提案时的非平台跳过。 */
  warnings?: Array<{ code: 'unclassified_skipped_cases'; ids: string[] }>;
}

function safeReadFile(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function writeMergedResults(root: string, resultPath: string, contents: string[]): void {
  const fullResultPath = join(root, resultPath);
  mkdirSync(dirname(fullResultPath), { recursive: true });
  const joined = contents
    .map(content => content.trim())
    .filter(Boolean)
    .join('\n');
  writeFileSync(fullResultPath, joined ? `${joined}\n` : '');
}

export function buildInitialPreRunData(config: NormalizedVerifyConfig): VerifyPreRunData {
  const hasTwoPhase = Boolean(config.regressionCommand || config.incrementalCommand);
  const mode: VerifyPreRunMode = hasTwoPhase
    ? 'two_phase'
    : config.preRunCommand ? 'pre_run_command' : 'none';
  return {
    mode,
    commands: [],
    result_paths: {
      final: config.resultPath,
      regression: config.regressionResultPath ?? null,
      incremental: config.incrementalResultPath ?? null,
    },
    merge_strategy: mode === 'two_phase' ? config.mergeStrategy : null,
    diagnostics: [],
    suggestions: [],
  };
}

function skippedCompatPreRunCommand(config: NormalizedVerifyConfig): VerifyPreRunCommandResult | null {
  if (!config.preRunCommand || !(config.regressionCommand || config.incrementalCommand)) return null;
  return {
    stage: 'pre_run',
    command: config.preRunCommand,
    status: 'skipped',
  };
}

export interface RunVerifyPreRunResult {
  preRun: VerifyPreRunData;
  sandbox: SandboxData;
}

function ensureRelativePath(path: string): string {
  return path.replace(/^\/+/, '');
}

function appendSandboxDiagnostics(preRun: VerifyPreRunData, sandbox: SandboxData): void {
  for (const line of sandbox.diagnostics) {
    if (!preRun.diagnostics.includes(line)) preRun.diagnostics.push(line);
  }
  for (const line of sandbox.suggestions) {
    if (!preRun.suggestions.includes(line)) preRun.suggestions.push(line);
  }
}

function executeVerifyCommand(
  root: string,
  stage: VerifyPreRunStage,
  command: string,
  format: OutputFormat,
  sandboxConfig: NormalizedVerifyConfig['sandbox'],
  allowedWritePaths: string[],
  freshSandbox = false,
  extraEnv?: Record<string, string>,
): { command: SandboxCommandResult; sandbox: SandboxData } {
  if (format !== 'json') {
    console.log(`\n⚙️  Running verify.${stage === 'pre_run' ? 'pre_run_command' : `${stage}_command`}: ${command}`);
  }
  return runSandboxedCommand({
    root,
    command,
    format,
    sandbox: sandboxConfig,
    allowedWritePaths,
    freshSandbox,
    ...(extraEnv ? { extraEnv } : {}),
  });
}

function toPreRunCommandResult(
  stage: VerifyPreRunStage,
  command: string,
  result: SandboxCommandResult,
  sandbox: SandboxData,
): VerifyPreRunCommandResult & { sandbox: SandboxData } {
  return {
    stage,
    command,
    status: result.status,
    exit_code: result.exit_code,
    duration_ms: result.duration_ms,
    error: result.error,
    ...(result.stdout_tail !== undefined ? { stdout_tail: result.stdout_tail } : {}),
    ...(result.stderr_tail !== undefined ? { stderr_tail: result.stderr_tail } : {}),
    sandbox,
  };
}

function mergeSandboxStatus(current: SandboxData, next: SandboxData): SandboxData {
  const rank: Record<SandboxData['status'], number> = {
    fail: 4,
    warn: 3,
    pass: 2,
    skipped: 1,
  };
  const status = rank[next.status] > rank[current.status] ? next.status : current.status;
  const diagnostics = Array.from(new Set([...current.diagnostics, ...next.diagnostics]));
  const suggestions = Array.from(new Set([...current.suggestions, ...next.suggestions]));
  const infos = Array.from(new Set([...(current.infos ?? []), ...(next.infos ?? [])]));
  const merged: SandboxData = {
    mode: current.mode,
    root: next.isolated ? next.root : current.root,
    isolated: current.isolated || next.isolated,
    workspace_write_denied: current.workspace_write_denied,
    status,
    diagnostics,
    suggestions,
  };
  if (infos.length > 0) merged.infos = infos;
  // §2.91.8：多阶段时 reuse 取最后一次执行阶段的值
  const reuse = next.reuse ?? current.reuse;
  if (reuse) merged.reuse = reuse;
  return merged;
}

/** verify 侧运行选项（§2.91.7）。 */
export interface VerifyRunOptions {
  freshSandbox?: boolean;
  /** module-scoped-verify（§2.96.5）：`openlogos verify --all` 手动全量。 */
  all?: boolean;
}

/**
 * verify 沙箱写入白名单：结果文件、共用验收报告，以及多模块项目中 initial 模块的模块验收报告（§2.99.9）。
 */
export function verifyReportAllowPaths(root: string, config: NormalizedVerifyConfig): Set<string> {
  const allowPaths = new Set<string>([config.resultPath, 'logos/resources/verify/acceptance-report.md']);
  const modules = registeredModules(readProjectYaml(root).data?.modules);
  if (modules.length >= 2) {
    for (const m of modules) if (m.lifecycle === 'initial') allowPaths.add(moduleReportPath(m.id, 'acceptance'));
  }
  return allowPaths;
}

/**
 * 结果路径命中模块报告保留路径时的预跑替代（code-r3 F3）：不执行任何已配置的预跑 / 两阶段 / 模块命令，
 * 每条命令记为未归属模块的 fail（error 写明原因），由既有 Gate 判据给出 pre_run_failed。没有已配置命令时返回 null
 *（CLI 不调用 runner，只读写改写后的默认路径）。
 */
export function blockedPreRunForReservedPaths(root: string, config: NormalizedVerifyConfig, locale = readLocale(root)): RunVerifyPreRunResult | null {
  const commands: Array<{ stage: VerifyPreRunStage; command: string }> = [];
  const add = (stage: VerifyPreRunStage, command: string | undefined) => {
    if (command && !commands.some(c => c.stage === stage && c.command === command)) commands.push({ stage, command });
  };
  const sources = [
    { preRunCommand: config.preRunCommand, regressionCommand: config.regressionCommand, incrementalCommand: config.incrementalCommand },
    ...Object.values(config.moduleCommands),
  ];
  for (const src of sources) {
    if (src.regressionCommand || src.incrementalCommand) {
      add('regression', src.regressionCommand);
      add('incremental', src.incrementalCommand);
    } else {
      add('pre_run', src.preRunCommand);
    }
  }
  if (commands.length === 0) return null;
  const preRun = buildInitialPreRunData(config);
  const keys = (config.reservedRedirects ?? []).map(r => `${r.config_key} → ${r.path}`).join('; ');
  const error = t(locale, 'verify.resultPathReservedBlocked', { keys });
  for (const c of commands) preRun.commands.push({ stage: c.stage, command: c.command, status: 'fail', error });
  const sandboxConfig = config.sandbox ?? normalizeSandboxConfig({ sandbox_mode: 'auto' });
  return { preRun, sandbox: buildInitialSandboxData(sandboxConfig) };
}

export function runVerifyPreRunWithSandbox(
  root: string,
  config: NormalizedVerifyConfig,
  format: OutputFormat,
  runOptions: VerifyRunOptions = {},
): RunVerifyPreRunResult {
  // --fresh-sandbox 只作用于第一个实际执行的阶段，后续阶段复用其新建的世代
  let freshPending = runOptions.freshSandbox === true;
  const takeFresh = (): boolean => {
    const value = freshPending;
    freshPending = false;
    return value;
  };
  const preRun = buildInitialPreRunData(config);
  const sandboxConfig = config.sandbox ?? normalizeSandboxConfig({ sandbox_mode: 'auto' });
  let sandbox = buildInitialSandboxData(sandboxConfig);
  const allowPaths = verifyReportAllowPaths(root, config);
  if (config.regressionResultPath) allowPaths.add(config.regressionResultPath);
  if (config.incrementalResultPath) allowPaths.add(config.incrementalResultPath);
  const allowedWritePaths = Array.from(allowPaths).map(ensureRelativePath);

  if (preRun.mode === 'none') {
    return { preRun, sandbox };
  }

  if (preRun.mode === 'pre_run_command' && config.preRunCommand) {
    const resultPath = join(root, config.resultPath);
    mkdirSync(dirname(resultPath), { recursive: true });
    writeFileSync(resultPath, '');
    const stageResult = executeVerifyCommand(root, 'pre_run', config.preRunCommand, format, sandboxConfig, allowedWritePaths, takeFresh());
    const normalized = toPreRunCommandResult('pre_run', config.preRunCommand, stageResult.command, stageResult.sandbox);
    preRun.commands.push(normalized);
    sandbox = mergeSandboxStatus(sandbox, stageResult.sandbox);
    if (normalized.status === 'fail' && format !== 'json') {
      // 功能规格 §2.7：预跑失败进入门禁，不再「沿用旧结果继续」。
      console.warn(`\n⚠️  verify pre_run command exited with non-zero status${normalized.exit_code !== undefined ? ` (exit ${normalized.exit_code})` : ''}; verify gate will FAIL.`);
    }
    appendSandboxDiagnostics(preRun, sandbox);
    return { preRun, sandbox };
  }

  const compatSkipped = skippedCompatPreRunCommand(config);
  if (compatSkipped) {
    preRun.commands.push(compatSkipped);
    preRun.diagnostics.push(t(readLocale(root), 'verify.preRunCompatSkipped'));
  }

  const stageContents: string[] = [];
  const runStage = (
    stage: Extract<VerifyPreRunStage, 'regression' | 'incremental'>,
    command: string | undefined,
    stageResultPath: string | undefined,
  ) => {
    if (!command) return;
    const effectiveStagePath = stageResultPath ?? config.resultPath;
    const fullStagePath = join(root, effectiveStagePath);
    mkdirSync(dirname(fullStagePath), { recursive: true });
    writeFileSync(fullStagePath, '');
    const stageResult = executeVerifyCommand(root, stage, command, format, sandboxConfig, allowedWritePaths, takeFresh());
    const normalized = toPreRunCommandResult(stage, command, stageResult.command, stageResult.sandbox);
    preRun.commands.push(normalized);
    sandbox = mergeSandboxStatus(sandbox, stageResult.sandbox);
    if (normalized.status === 'fail' && format !== 'json') {
      console.warn(`\n⚠️  verify ${stage} command exited with non-zero status${normalized.exit_code !== undefined ? ` (exit ${normalized.exit_code})` : ''}; verify gate will FAIL.`);
    }

    const content = safeReadFile(fullStagePath);
    if (content.trim()) stageContents.push(content);
  };

  runStage('regression', config.regressionCommand, config.regressionResultPath);
  runStage('incremental', config.incrementalCommand, config.incrementalResultPath);
  writeMergedResults(root, config.resultPath, stageContents);
  appendSandboxDiagnostics(preRun, sandbox);
  return { preRun, sandbox };
}

/** 模块范围下的一个命令组：三字段取值完全相同的模块合并为一组（§2.96.4）。 */
export interface VerifyCommandGroup {
  modules: string[];
  preRunCommand?: string;
  regressionCommand?: string;
  incrementalCommand?: string;
}

/**
 * 命令选择与去重（功能规格 §2.96.4，spec/test-results.md「执行哪些命令」）：按 logos-project.yaml 中的模块顺序，
 * 范围内每个模块有 `verify.modules.<id>` 就用它，否则用项目级命令；三字段取值完全相同的合并、按首次出现顺序。
 */
export function selectVerifyCommandGroups(config: NormalizedVerifyConfig, modules: string[]): VerifyCommandGroup[] {
  const groups: VerifyCommandGroup[] = [];
  for (const id of modules) {
    const own = config.moduleCommands[id];
    const triple = own
      ? { preRunCommand: own.preRunCommand, regressionCommand: own.regressionCommand, incrementalCommand: own.incrementalCommand }
      : { preRunCommand: config.preRunCommand, regressionCommand: config.regressionCommand, incrementalCommand: config.incrementalCommand };
    if (!triple.preRunCommand && !triple.regressionCommand && !triple.incrementalCommand) continue;
    const same = groups.find(g => g.preRunCommand === triple.preRunCommand
      && g.regressionCommand === triple.regressionCommand && g.incrementalCommand === triple.incrementalCommand);
    if (same) same.modules.push(id);
    else groups.push({ modules: [id], ...triple });
  }
  return groups;
}

/**
 * 模块范围已启用（或 --all）时的预跑：逐命令组执行，组内两阶段优先，每阶段先清空结果文件后收集，
 * 全部内容按同 ID 去重全序规则合并（与两阶段同一机制）。每条命令注入 OPENLOGOS_VERIFY_MODULES。
 * 未启用模块范围时不调用本函数（现有 runVerifyPreRunWithSandbox 逐字不变）。
 */
export function runVerifyModulePreRunWithSandbox(
  root: string,
  config: NormalizedVerifyConfig,
  scope: VerifyScopeData,
  format: OutputFormat,
  runOptions: VerifyRunOptions = {},
): RunVerifyPreRunResult {
  let freshPending = runOptions.freshSandbox === true;
  const takeFresh = (): boolean => { const value = freshPending; freshPending = false; return value; };
  const groups = selectVerifyCommandGroups(config, scope.modules);
  const anyTwoPhase = groups.some(g => g.regressionCommand || g.incrementalCommand);
  const preRun = buildInitialPreRunData(config);
  preRun.mode = groups.length === 0 ? 'none' : anyTwoPhase ? 'two_phase' : 'pre_run_command';
  preRun.merge_strategy = anyTwoPhase || groups.length > 1 ? config.mergeStrategy : null;
  const locale = readLocale(root);
  const registered = new Set(moduleIdsOf(root));
  for (const id of config.moduleCommandIds) {
    if (!registered.has(id)) preRun.diagnostics.push(t(locale, 'verify.moduleUnknown', { module: id }));
  }
  const sandboxConfig = config.sandbox ?? normalizeSandboxConfig({ sandbox_mode: 'auto' });
  let sandbox = buildInitialSandboxData(sandboxConfig);
  const allowPaths = verifyReportAllowPaths(root, config);
  if (config.regressionResultPath) allowPaths.add(config.regressionResultPath);
  if (config.incrementalResultPath) allowPaths.add(config.incrementalResultPath);
  const allowedWritePaths = Array.from(allowPaths).map(ensureRelativePath);
  if (groups.length === 0) return { preRun, sandbox };

  const contents: string[] = [];
  let compatNoted = false;
  const runStage = (group: VerifyCommandGroup, stage: VerifyPreRunStage, command: string, stageResultPath: string) => {
    const fullStagePath = join(root, stageResultPath);
    mkdirSync(dirname(fullStagePath), { recursive: true });
    writeFileSync(fullStagePath, '');
    const stageResult = executeVerifyCommand(root, stage, command, format, sandboxConfig, allowedWritePaths, takeFresh(),
      { OPENLOGOS_VERIFY_MODULES: group.modules.join(',') });
    const normalized = toPreRunCommandResult(stage, command, stageResult.command, stageResult.sandbox);
    preRun.commands.push({ ...normalized, modules: [...group.modules] });
    sandbox = mergeSandboxStatus(sandbox, stageResult.sandbox);
    if (normalized.status === 'fail') {
      const message = t(locale, 'verify.moduleCommandFailed', { modules: group.modules.join(', '), stage, exit: String(normalized.exit_code ?? 'n/a') });
      if (!preRun.diagnostics.includes(message)) preRun.diagnostics.push(message);
      if (format !== 'json') console.warn(`\n⚠️  ${message}`);
    }
    const content = safeReadFile(fullStagePath);
    if (content.trim()) contents.push(content);
  };
  for (const group of groups) {
    if (group.regressionCommand || group.incrementalCommand) {
      if (group.preRunCommand) {
        preRun.commands.push({ stage: 'pre_run', command: group.preRunCommand, status: 'skipped', modules: [...group.modules] });
        if (!compatNoted) { preRun.diagnostics.push(t(locale, 'verify.preRunCompatSkipped')); compatNoted = true; }
      }
      if (group.regressionCommand) runStage(group, 'regression', group.regressionCommand, config.regressionResultPath ?? config.resultPath);
      if (group.incrementalCommand) runStage(group, 'incremental', group.incrementalCommand, config.incrementalResultPath ?? config.resultPath);
    } else if (group.preRunCommand) {
      runStage(group, 'pre_run', group.preRunCommand, config.resultPath);
    }
  }
  writeMergedResults(root, config.resultPath, contents);
  appendSandboxDiagnostics(preRun, sandbox);
  return { preRun, sandbox };
}

export function runVerifyPreRun(root: string, config: NormalizedVerifyConfig, format: OutputFormat): VerifyPreRunData {
  return runVerifyPreRunWithSandbox(root, config, format).preRun;
}

function addCoverageDiagnostics(root: string, data: VerifyData): VerifyData {
  if (data.gate.reason === 'incomplete_coverage' && data.pre_run.mode === 'none') {
    const locale = readLocale(root);
    data.pre_run.diagnostics.push(t(locale, 'verify.coverageLocalDiag'));
    data.pre_run.suggestions.push(
      t(locale, 'verify.coverageLocalSuggestionPreRun'),
      t(locale, 'verify.coverageLocalSuggestionTwoPhase'),
    );
  }
  return data;
}

function readSmokeCommandConfig(root: string): { command: string | null; resultPath: string } {
  const configPath = join(root, 'logos', 'logos.config.json');
  let command: string | null = null;
  let resultPath = 'logos/resources/verify/smoke-results.jsonl';
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (typeof config.smoke?.command === 'string') command = config.smoke.command;
    if (typeof config.smoke?.result_path === 'string') resultPath = config.smoke.result_path;
  } catch {
    // 使用默认 smoke 配置。
  }
  return { command: resolveSmokeCommand(root, command), resultPath };
}

/**
 * smoke 覆盖预检门禁。直接使用 collectVerifyData 已算出的 `data.smoke_precheck`（同一根目录、同一 smoke 配置），
 * 不再重新发现 runner：一次 verify 只扫描一次项目根（fix-smoke-runner-discovery-overflow，S19 遍历规则第 6 条）。
 */
function applySmokePrecheck(_root: string, data: VerifyData): VerifyData {
  const check = data.smoke_precheck;
  if (check.changed_case_ids.length === 0 || check.result === 'PASS') return data;

  // 多切片 checkpoint 只要求当前片及既往片闭环。未来切片拥有的 smoke 用例仍是 pending，
  // 不得提前让 smoke runner 缺失阻断当前片；当 smoke owning slice 成为 attempted 后，这些 ID
  // 会从 pending 移除，既有 smoke 覆盖硬门随即生效。
  const pending = new Set(data.pending_test_ids ?? []);
  if (data.verify_mode === 'slice-checkpoint'
    && check.changed_case_ids.every(id => pending.has(id))) return data;

  const blockingDiagnostics = check.diagnostics.filter(item => item.code !== 'smoke_cases_uncovered');
  if (blockingDiagnostics.length === 0) return data;

  data.gate.result = 'FAIL';
  data.gate.reason = blockingDiagnostics[0]?.code ?? 'smoke_runner_missing';
  for (const item of blockingDiagnostics) {
    const cases = item.case_ids?.length ? `：${item.case_ids.join(', ')}` : '';
    data.pre_run.diagnostics.push(`${item.code}${cases} - ${item.message}`);
  }
  data.pre_run.suggestions.push(
    '为本提案新增的 SMOKE-* 用例实现 scripts/smoke-*.sh 或等效 runner。',
    '确保 smoke runner 写入 logos/resources/verify/smoke-results.jsonl 或 smoke.result_path。',
    '将 smoke.command 指向 scripts/run-smoke.js 统一 dispatcher，或显式执行新增 runner。',
  );
  return data;
}

function ensureResultFileWhenPreRunFailed(fullResultPath: string, preRun: VerifyPreRunData): void {
  if (existsSync(fullResultPath)) return;
  const failedPreRun = preRun.commands.some(cmd => cmd.status === 'fail');
  if (!failedPreRun) return;
  mkdirSync(dirname(fullResultPath), { recursive: true });
  writeFileSync(fullResultPath, '');
}

// ── contract-self-description 切片4（C6/D7）：同 ID timestamp 去重全序规则 ──

// 严格解析迁至共享 lib（proposal-lifecycle 的 marker 读取与 verify 去重同一实现，code review F1/F6）；
// re-export 保持既有 import 路径不变。
import { parseStrictTimestampMs, parseStrictTimestampParts, compareStrictTimestamps } from '../lib/timestamp.js';
export { parseStrictTimestampMs };

/**
 * 同 ID 去重全序（spec/test-results.md「归一化规则」第 5 条，单文件与两阶段合并共用同一实现）：
 * 1. 该 ID 全部记录时间戳均合法 → 绝对时刻最新优先；同刻（含异时区同刻）→ 文件行序后者优先；
 * 2. 存在任一缺失/非法时间戳 → 该 ID 整组退回文件行序 last-wins（等价旧行为，不对不完整证据做时间猜测）。
 * rows 按文件行序传入；按 ID 分组独立进行。
 */
export function selectEffectiveResult<T extends { timestamp?: string }>(rows: T[]): T {
  const times = rows.map(r => parseStrictTimestampParts(r.timestamp));
  if (times.some(t => t == null)) return rows[rows.length - 1];
  let best = 0;
  for (let i = 1; i < rows.length; i++) {
    // 全精度比较（code review r2-F1：亚毫秒不截断）；同一绝对时刻（=0）→ 行序后者优先
    if (compareStrictTimestamps(times[i]!, times[best]!) >= 0) best = i;
  }
  return rows[best];
}

export function parseJsonl(content: string): TestResult[] {
  const groups = new Map<string, TestResult[]>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as TestResult;
      if (obj.id && obj.status) {
        const rows = groups.get(obj.id) ?? [];
        rows.push(obj);
        groups.set(obj.id, rows);
      }
    } catch { /* skip malformed lines */ }
  }
  return Array.from(groups.values()).map(selectEffectiveResult);
}

function asResultRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function consistencyReasonForInvalid(reason: string): string {
  if (reason === 'invalid_status') return 'invalid_test_result_status';
  if (reason === 'invalid_json') return 'invalid_test_result_json';
  return 'invalid_test_result_schema';
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) items.push(item);
}

export function parseJsonlWithDiagnostics(content: string): { results: TestResult[]; invalidResults: VerifyInvalidResult[] } {
  // C6/D7：合法记录按 ID 分组（保留行序），末尾经 selectEffectiveResult 做 timestamp 全序去重；
  // 非法行进入诊断集合、不参与去重（去重只在合法记录之间进行，不吞非法行）。
  const groups = new Map<string, TestResult[]>();
  const invalidResults: VerifyInvalidResult[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (!trimmed) continue;
    const line = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      invalidResults.push({ line, reason: 'invalid_json' });
      continue;
    }

    const obj = asResultRecord(parsed);
    if (!obj) {
      invalidResults.push({ line, reason: 'invalid_record' });
      continue;
    }

    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    const status = typeof obj.status === 'string' ? obj.status.trim() : '';
    const base = {
      line,
      ...(id ? { id } : {}),
      ...(status ? { status } : {}),
    };
    if (!id) {
      invalidResults.push({ ...base, reason: 'missing_id' });
      continue;
    }
    if (!status) {
      invalidResults.push({ ...base, reason: 'missing_status' });
      continue;
    }
    if (status !== 'pass' && status !== 'fail' && status !== 'skip') {
      invalidResults.push({ ...base, reason: 'invalid_status' });
      continue;
    }
    if (status === 'fail' && (typeof obj.error !== 'string' || obj.error.trim() === '')) {
      invalidResults.push({ ...base, reason: 'missing_error' });
      continue;
    }

    const rows = groups.get(id) ?? [];
    rows.push({
      id,
      status,
      ...(typeof obj.duration_ms === 'number' ? { duration_ms: obj.duration_ms } : {}),
      ...(typeof obj.timestamp === 'string' ? { timestamp: obj.timestamp } : {}),
      ...(typeof obj.error === 'string' ? { error: obj.error } : {}),
      ...(typeof obj.scenario === 'string' ? { scenario: obj.scenario } : {}),
      ...(typeof obj.reason_code === 'string' ? { reason_code: obj.reason_code } : {}),
      ...(typeof obj.detail === 'string' ? { detail: obj.detail } : {}),
    });
    groups.set(id, rows);
  }
  return { results: Array.from(groups.values()).map(selectEffectiveResult), invalidResults };
}

interface DefinedIndex {
  ids: string[];
  utCount: number;
  stCount: number;
  manualCount: number;
  manualIds: string[];
}

function extractDefinedIndex(root: string): DefinedIndex {
  const dir = join(root, TEST_CASES_DIR);
  if (!existsSync(dir)) return { ids: [], utCount: 0, stCount: 0, manualCount: 0, manualIds: [] };

  const idSet = new Set<string>();
  const manualSet = new Set<string>();
  try {
    const files = readdirSync(dir, { recursive: true })
      .map(f => String(f))
      .filter(f => f.endsWith('-test-cases.md'));

    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim().startsWith('|')) continue;

        const cells = line.split('|').map(cell => cell.trim());
        const firstCell = cells[1] ?? '';
        if (!TABLE_CELL_ID_RE.test(firstCell)) continue;

        const id = firstCell.replace(MANUAL_SUFFIX, '').replace(/\s+/g, ' ').trim();
        const isManual = isManualDeclaration(firstCell);
        if (isManual) {
          manualSet.add(id);
          idSet.delete(id);
          continue;
        }

        if (!manualSet.has(id)) {
          idSet.add(id);
        }
      }
    }
  } catch { /* directory read error */ }

  const ids = Array.from(idSet).sort();
  const manualIds = Array.from(manualSet).sort();
  const utCount = ids.filter(id => id.startsWith('UT-')).length;
  const stCount = ids.filter(id => id.startsWith('ST-')).length;
  return { ids, utCount, stCount, manualCount: manualIds.length, manualIds };
}

/**
 * 人工用例判定的**单一事实源**（S13 不变量 1/2；AC-VERIFY-MANUAL-01～03）。
 *
 * 标记的**声明位只在表格首格**（ID 之后）。描述列、断言列、备注列里出现的标记字面量是
 * **叙述文本**，一律不参与判定——与 change-lint「散文里提及 ID 不算保留」同一原则。
 *
 * 此前判据还对整行做子串匹配，于是一条描述列写了裸标记字面量的自动化用例
 *（典型即「manual 标记排除」这条能力自己的元用例）被判成人工用例：从 `defined` 删除、
 * 从 `executed_count` 的过滤中排除，而 `passed` / `skipped` 不经该过滤——同一屏两个计数器
 * 取自不同集合，下游一个零失败、100% 覆盖的提案因此被 Gate 3.5 拒收（EX-7.6）。
 *
 * 收敛方向**只收不放**：判定结果是收敛前人工集合的子集，真人工用例逐字不变（EX-7.8）。
 */
export function isManualDeclaration(firstCell: string): boolean {
  return MANUAL_SUFFIX.test(String(firstCell ?? ''));
}

export function extractDefinedIds(root: string): { ids: string[]; utCount: number; stCount: number; manualCount: number } {
  const { ids, utCount, stCount, manualCount } = extractDefinedIndex(root);
  return { ids, utCount, stCount, manualCount };
}

/** 模块范围上下文：scope 为 null 表示未启用；inScope 为 null 表示不过滤（all / fallback-full）。 */
export interface VerifyScopeContext {
  scope: VerifyScopeData | null;
  inScope: Set<string> | null;
}

/**
 * 范围内用例集 S = D_M ∪ C（功能规格 §2.96.4，spec/test-slice-manifest.md §7.1）：
 * 测试规格文件按文件名 `<module>-` 前缀（已登记模块 id 最长匹配）归属模块，前缀在范围内或不带已登记前缀（全局）的
 * 文件中的用例计入；本提案变更测试 C 一律计入。只在 mode=module 时计算，其余模式不过滤。
 */
export function resolveVerifyScopeContext(root: string, opts: { all?: boolean } = {}): VerifyScopeContext {
  const scope = resolveVerifyScope(root, { all: opts.all });
  if (!scope || scope.mode !== 'module') return { scope, inScope: null };
  return { scope, inScope: computeInScopeIds(root, scope) };
}

/** 给定 mode=module 的范围，计算范围内用例集 S = D_M ∪ C（verify 与切片两侧共用这一份成员判定）。 */
export function computeInScopeIds(root: string, scope: VerifyScopeData): Set<string> {
  const moduleIds = moduleIdsOf(root);
  const dir = join(root, TEST_CASES_DIR);
  const inScope = new Set<string>();
  if (existsSync(dir)) {
    const files = readdirSync(dir, { recursive: true }).map(f => String(f)).filter(f => f.endsWith('-test-cases.md'));
    for (const file of files) {
      if (!testFileInScope(file, scope, moduleIds)) continue;
      for (const line of readFileSync(join(dir, file), 'utf-8').split('\n')) {
        if (!line.trim().startsWith('|')) continue;
        const firstCell = (line.split('|').map(cell => cell.trim())[1]) ?? '';
        if (!TABLE_CELL_ID_RE.test(firstCell)) continue;
        inScope.add(firstCell.replace(MANUAL_SUFFIX, '').replace(/\s+/g, ' ').trim());
      }
    }
  }
  for (const id of readChangedTestIdsForScope(root)) inScope.add(id);
  return inScope;
}

/** 验收报告 Summary「范围」行的取值（§2.96.7）。 */
export function scopeReportValue(scope: VerifyScopeData): string {
  if (scope.mode === 'module') return `module（${scope.modules.join(', ')}）`;
  if (scope.mode === 'all') return 'all';
  const reason = scope.fallback_reason;
  return reason ? `fallback-full（${reason.code}：${reason.detail}）` : 'fallback-full';
}



export function generateReport(
  defined: string[],
  results: TestResult[],
  passed: TestResult[],
  failed: TestResult[],
  skipped: TestResult[],
  uncovered: string[],
  coveragePct: string,
  passRatePct: string,
  gateResult: 'PASS' | 'FAIL',
  _resultIds: Set<string>,
  manualCount: number,
  sliceVerification?: SliceVerificationState | null,
  preRunFailures: Array<{ stage: VerifyPreRunStage; exit_code?: number }> = [],
  scope: VerifyScopeData | null = null,
  moduleReport: { moduleId: string; runLevelRejections: string[] } | null = null,
  skipInfo: { classification: SkipClassification; changeSetInvalid: string | null } | null = null,
): string {
  const now = new Date().toISOString().slice(0, 10);
  let md = `# Acceptance Report\n\n> Generated by \`openlogos verify\` on ${now}\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  // §2.99.2：模块验收报告的「模块」行（共用报告不出现，字节不变）
  if (moduleReport) md += `| ${MODULE_ROW_LABEL} | ${moduleReport.moduleId} |\n`;
  // §2.96.7：只在启用模块范围或 --all 时出现，未启用时报告字节不变。
  if (scope) md += `| Scope | ${scopeReportValue(scope).replace(/\|/g, '\\|')} |\n`;
  md += `| Defined cases | ${defined.length} |\n`;
  md += `| Manual cases (excluded) | ${manualCount} |\n`;
  md += `| Executed cases | ${results.length} |\n`;
  md += `| Passed | ${passed.length} |\n`;
  md += `| Failed | ${failed.length} |\n`;
  md += `| Skipped | ${skipped.length} |\n`;
  md += `| Uncovered | ${uncovered.length} |\n`;
  md += `| Coverage | ${coveragePct}% |\n`;
  md += `| Pass rate | ${passRatePct}% |\n`;
  md += `| **Gate 3.5** | **${gateResult}** |\n\n`;
  // §2.7：报告只记失败阶段与退出码，不写命令输出（报告会进 git）。无失败时本节不出现，报告字节不变。
  if (preRunFailures.length > 0) {
    md += `## Pre-run Command Failures\n\n| Stage | Exit code |\n|-------|-----------|\n`;
    for (const failure of preRunFailures) md += `| ${failure.stage} | ${failure.exit_code ?? 'unknown'} |\n`;
    md += '\n';
  }
  // §2.99.5：模块报告中无法按用例归属、但计入本模块 Gate 的运行级拒绝
  if (moduleReport && moduleReport.runLevelRejections.length > 0) {
    md += `## Run-level Rejections\n\n`;
    for (const reason of moduleReport.runLevelRejections) md += `- ${reason}\n`;
    md += '\n';
  }
  if (sliceVerification?.verify_mode) {
    md += `## Slice Verification\n\n`;
    md += `- Mode: \`${sliceVerification.verify_mode}\`\n`;
    md += `- Attempted slice: ${sliceVerification.attempted_slice_id ? `\`${sliceVerification.attempted_slice_id}\`` : '`null`'}\n`;
    // slice-verify-efficient-mode：checkpoint 摘要标明冻结的验收范围（spec/test-results.md「checkpoint/final 报告」）
    if (sliceVerification.verify_mode === 'slice-checkpoint' && sliceVerification.verify_scope) {
      md += sliceVerification.verify_scope === 'owned'
        ? '- 验收范围 / Verify scope: `owned`（基线回归由 final 承担 / baseline regression is deferred to the final verify）\n'
        : '- 验收范围 / Verify scope: `baseline`\n';
    }
    md += `- Confirmed slices: ${sliceVerification.confirmed_slice_ids.length > 0 ? sliceVerification.confirmed_slice_ids.map(id => `\`${id}\``).join(', ') : '(none)'}\n`;
    md += `- Eligible tests: ${sliceVerification.eligible_test_ids.length}\n`;
    md += `- Pending tests: ${sliceVerification.pending_test_ids.length}\n`;
    md += `- Final: ${sliceVerification.verify_mode === 'final' ? 'true' : 'false'}\n\n`;
  }

  if (failed.length > 0) {
    md += `## Failed Cases\n\n`;
    md += `| ID | Error |\n|----|-------|\n`;
    for (const r of failed) {
      const error = (r.error ?? 'unknown').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      md += `| ${r.id} | ${error} |\n`;
    }
    md += '\n';
  }

  if (uncovered.length > 0) {
    md += `## Uncovered Cases\n\n`;
    for (const id of uncovered) {
      md += `- ${id}\n`;
    }
    md += '\n';
  }

  if (skipped.length > 0) {
    md += `## Skipped Cases\n\n`;
    for (const r of skipped) {
      md += `- ${r.id}\n`;
    }
    md += '\n';
  }

  // verify-self-sufficient-cases（§2.106.6）：只在有内容时出现，未涉及时报告字节不变
  if (skipInfo?.changeSetInvalid) {
    md += `## 测试变更集无效 / Test Change Set Invalid\n\n- \`test_change_set_invalid\`：${skipInfo.changeSetInvalid.replace(/\n/g, ' ')}\n- 已合并提案的测试变更集无法采信，本次不得产生最终 PASS / the merged change set cannot be trusted; this run cannot PASS\n\n`;
  }
  if (skipInfo && skipInfo.classification.tier.length > 0) {
    md += `## 用例分层错误 / Case Tier Mismatch\n\n| ID | Reason code | Fix |\n|----|-------------|-----|\n`;
    for (const c of skipInfo.classification.tier) md += `| ${c.id} | ${c.reason_code ?? '(none)'} | ${c.fix_hint.replace(/\|/g, '\\|')} |\n`;
    md += '\n';
  }
  if (skipInfo && skipInfo.classification.platform.length > 0) {
    md += `## 平台跳过 / Platform Skips\n\n| ID | Detail |\n|----|--------|\n`;
    for (const c of skipInfo.classification.platform) md += `| ${c.id} | ${c.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |\n`;
    md += '\n';
  }
  if (skipInfo && skipInfo.classification.unclassified.length > 0) {
    md += `## 未分类跳过（警告）/ Unclassified Skips (warning)\n\n> 存量用例或无活跃提案时的非平台跳过：口径不变、不改门禁，建议补平台原因或改标 \`[manual]\`。\n\n`;
    for (const id of skipInfo.classification.unclassified) md += `- ${id}\n`;
    md += '\n';
  }

  return md;
}

export interface VerifyCountSummary {
  defined_count: number;
  executed_count: number;
  passed_count: number;
  failed_count: number;
  skipped_count: number;
  uncovered_count: number;
  coverage_pct: number;
  pass_rate_pct: number;
}

/**
 * 精确计数入口（S13 不变量 4；AC-VERIFY-COUNT-01～03）。
 *
 * 一致性判据**只消费精确计数**，`coverage_pct` / `pass_rate_pct` 仅用于展示。
 * 此前判据拿 `Math.round` 后的百分比与 100 做等值比较：`defined` 足够大时
 * （实测 6427）少 1 条未覆盖的真实覆盖率 99.98% 被舍入成 100，于是
 * 「99.98% 覆盖 + 1 条未覆盖」这一**完全自洽**的状态被判成账本矛盾（EX-7.7）。
 *
 * 缺省时按既有精确计数推导（`covered = defined - uncovered`、
 * `results = passed + failed + skipped`），因此不传该参数的既有调用方
 * 也**不再**依赖舍入值——判据不会因入参缺省而退回旧口径。
 */
export interface VerifyExactCounts {
  covered_count?: number;
  results_count?: number;
}

export function buildVerifyCountMismatches(summary: VerifyCountSummary, exact: VerifyExactCounts = {}): string[] {
  const mismatches: string[] = [];
  const coveredCount = Number.isFinite(Number(exact.covered_count))
    ? Number(exact.covered_count)
    : summary.defined_count - summary.uncovered_count;
  if (summary.passed_count + summary.failed_count + summary.skipped_count !== summary.executed_count) {
    mismatches.push('passed_failed_skipped_ne_executed');
  }
  if (summary.executed_count > summary.defined_count) {
    mismatches.push('executed_exceeds_defined');
  }
  if (coveredCount === summary.defined_count && summary.uncovered_count !== 0) {
    mismatches.push('coverage_full_with_uncovered');
  }
  if (summary.uncovered_count === 0 && coveredCount !== summary.defined_count && summary.defined_count > 0) {
    mismatches.push('coverage_incomplete_without_uncovered');
  }
  const effectivePassedCount = summary.passed_count + summary.skipped_count;
  if (summary.failed_count === 0 && effectivePassedCount !== summary.executed_count) {
    mismatches.push('effective_passed_ne_executed_without_fail');
  }
  if (summary.failed_count === 0 && effectivePassedCount !== summary.executed_count && summary.executed_count > 0) {
    mismatches.push('pass_rate_below_100_without_fail');
  }
  return mismatches;
}

/**
 * 计数矛盾的**可自证明细**（S13 不变量 6；AC 诊断可自证）。
 *
 * 只给一句 `result ledger is inconsistent` 会把 CLI 自身的算术分叉归咎于下游账本——
 * 实测导致下游约 40 分钟的误方向排查。每条矛盾必须点名**两个相互矛盾的计数器**的取值与来源，
 * 使复盘能直接定位到哪一侧算错。明细只含计数与来源名，不含用例正文。
 */
export function buildCountMismatchDetails(
  summary: VerifyCountSummary,
  mismatches: string[],
  exact: VerifyExactCounts = {},
): Array<{ code: string; left: string; right: string }> {
  const covered = Number.isFinite(Number(exact.covered_count))
    ? Number(exact.covered_count)
    : summary.defined_count - summary.uncovered_count;
  const effectivePassed = summary.passed_count + summary.skipped_count;
  const byCode: Record<string, { left: string; right: string }> = {
    passed_failed_skipped_ne_executed: {
      left: `passed+failed+skipped=${summary.passed_count + summary.failed_count + summary.skipped_count}（来源：defined 内的结果行分桶）`,
      right: `executed_count=${summary.executed_count}（来源：结果行去人工用例过滤）`,
    },
    executed_exceeds_defined: {
      left: `executed_count=${summary.executed_count}（来源：结果行去人工用例过滤）`,
      right: `defined_count=${summary.defined_count}（来源：已合并测试规格首列提取）`,
    },
    coverage_full_with_uncovered: {
      left: `covered_count=${covered}（来源：defined ∩ 结果 ID）`,
      right: `defined_count=${summary.defined_count} 且 uncovered_count=${summary.uncovered_count}（来源：defined 差集）`,
    },
    coverage_incomplete_without_uncovered: {
      left: `covered_count=${covered}（来源：defined ∩ 结果 ID）`,
      right: `defined_count=${summary.defined_count} 且 uncovered_count=0（来源：defined 差集）`,
    },
    effective_passed_ne_executed_without_fail: {
      left: `passed+skipped=${effectivePassed}（来源：defined 内的结果行分桶）`,
      right: `executed_count=${summary.executed_count}（来源：结果行去人工用例过滤）`,
    },
    pass_rate_below_100_without_fail: {
      left: `passed+skipped=${effectivePassed}（来源：defined 内的结果行分桶）`,
      right: `executed_count=${summary.executed_count}（来源：结果行去人工用例过滤）`,
    },
  };
  return mismatches
    .filter(code => byCode[code] != null)
    .map(code => ({ code, left: byCode[code].left, right: byCode[code].right }));
}

function buildVerifyConsistency(params: {
  invalidResults: VerifyInvalidResult[];
  unknownResultIds: string[];
  manualResultIds: string[];
  outsideEligibleResultIds: string[];
  countMismatches: string[];
  countMismatchDetails?: Array<{ code: string; left: string; right: string }>;
}): VerifyConsistencyData {
  const reasons: string[] = [];
  for (const invalid of params.invalidResults) {
    pushUnique(reasons, consistencyReasonForInvalid(invalid.reason));
  }
  if (params.unknownResultIds.length > 0) pushUnique(reasons, 'unknown_test_result_id');
  if (params.manualResultIds.length > 0) pushUnique(reasons, 'manual_test_result_id');
  if (params.outsideEligibleResultIds.length > 0) pushUnique(reasons, 'result_outside_eligible_scope');
  if (params.countMismatches.length > 0) pushUnique(reasons, 'result_count_mismatch');
  return {
    ok: reasons.length === 0,
    reasons,
    unknown_result_ids: params.unknownResultIds,
    manual_result_ids: params.manualResultIds,
    outside_eligible_result_ids: params.outsideEligibleResultIds,
    invalid_results: params.invalidResults,
    count_mismatches: params.countMismatches,
    // additive：矛盾自证明细（旧消费方忽略该字段即保持现状）
    count_mismatch_details: params.countMismatchDetails ?? [],
  };
}

/**
 * verification-history（§2.104.5）：共用验收报告由最终数据只渲染一次。collectVerifyData 记下渲染所需的参数，
 * 调用方在全部门禁（smoke 覆盖预检、沙箱裁决）之后以最终 gate 渲染；渲染结果的字节同时写共用报告与报告快照。
 */
const acceptanceReportRenderers = new WeakMap<VerifyData, (gate: 'PASS' | 'FAIL') => string>();

/** 以最终门禁渲染共用验收报告的字节（不写盘）。 */
export function renderAcceptanceReport(data: VerifyData): string | null {
  const render = acceptanceReportRenderers.get(data);
  return render ? render(data.gate.result) : null;
}

/** 写共用验收报告并返回写入的字节（供报告快照复用，不从共用路径回读）。 */
export function writeAcceptanceReport(root: string, data: VerifyData): string | null {
  const bytes = renderAcceptanceReport(data);
  if (bytes === null) return null;
  const reportPath = join(root, REPORT_DIR, 'acceptance-report.md');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, bytes);
  return bytes;
}

/** 预检类原因的人读标题（报告与终端共用）。 */
const PRECHECK_REASON_TITLES: Record<string, string> = {
  verify_requirements_invalid: 'verify.requirements 配置结构非法 / verify requirements are invalid',
  acceptance_requirement_undeclared: '验收标准条目未写入配置 / acceptance requirements not declared in verify.requirements',
  verify_env_not_ready: '环境未就绪 / verification environment not ready',
};

/** 预检失败时的共用验收报告（§2.106.5）：计数显示「未执行」，写明原因与缺失项，不写任何变量值或命令输出。 */
function renderPrecheckReport(reason: string, req: VerifyRequirementsData, sliceVerification: SliceVerificationState | null | undefined): string {
  const now = new Date().toISOString().slice(0, 10);
  let md = `# Acceptance Report\n\n> Generated by \`openlogos verify\` on ${now}\n\n`;
  md += `## Summary\n\n| Metric | Value |\n|--------|-------|\n`;
  for (const metric of ['Defined cases', 'Executed cases', 'Passed', 'Failed', 'Skipped', 'Uncovered']) {
    md += `| ${metric} | 未执行 / not executed |\n`;
  }
  md += `| **Gate 3.5** | **FAIL** |\n\n`;
  md += `## Verify Precheck\n\n- Reason: \`${reason}\` — ${PRECHECK_REASON_TITLES[reason] ?? reason}\n`;
  md += '- 本次未执行任何预跑命令，也未读取结果文件 / no pre-run command was executed and no result file was read\n\n';
  if (req.invalid && req.invalid.length > 0) {
    md += `### Invalid Configuration\n\n`;
    for (const line of req.invalid) md += `- ${line}\n`;
    md += '\n';
  }
  if (req.missing_declarations.length > 0) {
    md += `### 验收标准条目未写入配置 / Undeclared Acceptance Requirements\n\n`;
    for (const entry of req.missing_declarations) md += `- \`${entry}\`\n`;
    md += '\n';
  }
  if (req.missing_environment.length > 0) {
    md += `### 环境未就绪 / Missing Environment\n\n`;
    for (const m of req.missing_environment) md += `- ${describeMissing(m)}\n`;
    md += '\n';
  }
  if (req.isolation === 'unisolated') md += '> 本次检查未隔离 / checks ran without sandbox isolation\n\n';
  if (sliceVerification?.verify_mode) {
    md += `## Slice Verification\n\n- Mode: \`${sliceVerification.verify_mode}\`\n`;
    md += `- Attempted slice: ${sliceVerification.attempted_slice_id ? `\`${sliceVerification.attempted_slice_id}\`` : '`null`'}\n\n`;
  }
  return md;
}

/** 未执行的 smoke 覆盖预检：只读取配置中的命令与结果路径，不访问 smoke 账本。 */
function notExecutedSmokePrecheck(root: string): SmokeCoverageCheck {
  const cfg = readSmokeCommandConfig(root);
  return { result: 'PASS', changed_case_ids: [], executed_case_ids: [], uncovered_case_ids: [], diagnostics: [], runners: [], command: cfg.command, result_path: cfg.resultPath };
}

/**
 * 预检类原因判 FAIL 时的 verify 数据（§2.106.5）：不读取结果文件，计数为 0 且在报告中显示「未执行」，
 * gate.reason 为预检原因；requirements 给出缺失明细。
 */
export function buildPrecheckFailureData(
  root: string,
  config: NormalizedVerifyConfig,
  preRun: VerifyPreRunData,
  sandbox: SandboxData,
  outcome: PrecheckOutcome,
  sliceVerification: SliceVerificationState | null | undefined,
  scopeContext: VerifyScopeContext,
): VerifyData {
  const req = outcome.data!;
  const reason = outcome.reason!;
  const data: VerifyData = {
    contract: { version: contractVersion(false, Boolean(sliceVerification?.verify_mode)) },
    summary: {
      defined_count: 0, ut_count: 0, st_count: 0, manual_count: 0, executed_count: 0, passed_count: 0,
      failed_count: 0, skipped_count: 0, uncovered_count: 0, coverage_pct: 0, pass_rate_pct: 0,
    },
    gate: { result: 'FAIL', reason },
    failed_cases: [],
    uncovered_cases: [],
    skipped_cases: [],
    consistency: {
      ok: true, reasons: [], unknown_result_ids: [], manual_result_ids: [], outside_eligible_result_ids: [],
      invalid_results: [], count_mismatches: [],
    },
    pre_run: preRun,
    // 评审 code-r1 F2：预检失败时不读取任何结果文件——smoke 预检同样不执行，只给出未执行的空集合与配置中的命令/路径，
    // 不访问 smoke 账本（读取失败不得中断本轮 FAIL 报告与历史落盘，旧账本也不得进入本轮输出）
    smoke_precheck: notExecutedSmokePrecheck(root),
    sandbox,
    report_path: 'logos/resources/verify/acceptance-report.md',
    requirements: req,
    ...(sliceVerification?.manifest_status === 'valid' && sliceVerification.verify_mode ? {
      verify_mode: sliceVerification.verify_mode,
      attempted_slice_id: sliceVerification.attempted_slice_id,
      eligible_test_ids: sliceVerification.eligible_test_ids,
      pending_test_ids: sliceVerification.pending_test_ids,
      manifest: sliceVerification.manifest,
      checkpoint: sliceVerification.checkpoint,
      test_change_set: sliceVerification.test_change_set,
    } : {}),
    ...(scopeContext.scope ? { scope: { ...scopeContext.scope } } : {}),
  };
  acceptanceReportRenderers.set(data, () => renderPrecheckReport(reason, req, sliceVerification));
  void config;
  return data;
}

export function collectVerifyData(
  root: string,
  preRun?: VerifyPreRunData,
  sliceVerification?: SliceVerificationState | null,
  scopeContext: VerifyScopeContext = { scope: null, inScope: null },
  opts: { deferReport?: boolean } = {},
): VerifyData {
  const inScope = scopeContext.inScope;
  const config = readVerifyConfig(root);
  const resultPath = config.resultPath;

  const fullResultPath = join(root, resultPath);
  const parsedResults = parseJsonlWithDiagnostics(readFileSync(fullResultPath, 'utf-8'));
  const allResults = parsedResults.results;
  const fullIndex = extractDefinedIndex(root);
  const defined = sliceVerification?.manifest_status === 'valid' && sliceVerification.verify_mode
    ? sliceVerification.eligible_test_ids
    : (inScope ? fullIndex.ids.filter(id => inScope.has(id)) : fullIndex.ids);
  const utCount = defined.filter(id => id.startsWith('UT-')).length;
  const stCount = defined.filter(id => id.startsWith('ST-')).length;
  const { manualCount, manualIds } = fullIndex;
  const definedSet = new Set(defined);
  const fullDefinedSet = new Set(fullIndex.ids);
  const manualSet = new Set(manualIds);
  const unknownResultIds: string[] = [];
  const manualResultIds: string[] = [];
  const outsideEligibleResultIds: string[] = [];
  // §2.96.4：属于范围外模块用例的结果行忽略——不判 unknown / outside_eligible、不计入统计，只计数。
  // 未定义 ID（不在任何测试规格中）不在此列，照旧按账本一致性判定。
  const isOutOfScope = (id: string) => inScope !== null && fullDefinedSet.has(id) && !inScope.has(id);
  let outOfScopeResultCount = 0;
  for (const result of allResults) {
    if (definedSet.has(result.id)) continue;
    if (isOutOfScope(result.id)) { outOfScopeResultCount += 1; continue; }
    if (fullDefinedSet.has(result.id) && sliceVerification?.verify_mode === 'slice-checkpoint') {
      pushUnique(outsideEligibleResultIds, result.id);
      continue;
    }
    if (manualSet.has(result.id)) {
      pushUnique(manualResultIds, result.id);
    } else {
      pushUnique(unknownResultIds, result.id);
    }
  }
  const results = allResults.filter(result => definedSet.has(result.id));
  // review code-r1 F1：ID 可识别且属于范围外已定义用例的**非法**记录（缺 error / 缺 status / 非法 status 等）与合法范围外行
  // 同口径忽略并计数；范围内、未定义 ID 与无法识别 ID 的非法记录保持既有严格门禁。未启用 / all / fallback-full 时 inScope 为 null，不过滤。
  const invalidResults = parsedResults.invalidResults.filter(invalid => {
    if (invalid.id !== undefined && isOutOfScope(invalid.id)) { outOfScopeResultCount += 1; return false; }
    return true;
  });

  const resultIds = new Set(results.map(r => r.id));
  const passed = results.filter(r => r.status === 'pass');
  const failed = results.filter(r => r.status === 'fail');
  const skipped = results.filter(r => r.status === 'skip');
  const uncovered = defined.filter(id => !resultIds.has(id));
  const coveredCount = defined.filter(id => resultIds.has(id)).length;
  // verify-self-sufficient-cases（§2.106.6）：严格判定集合取经正式读取器校验的测试变更集；
  // 切片 checkpoint 下与可计入集合（eligible = defined）求交，pending 用例没有结果仍合法
  const strictSet = readStrictSkipSet(root);
  const strictIds = new Set([...strictSet.ids].filter(id => definedSet.has(id)));
  const skipClassification = classifySkips(skipped, strictIds);
  const changeSetInvalid = strictSet.state === 'invalid' ? strictSet.detail : null;
  const tierMismatch = skipClassification.tier.length > 0;

  const coveragePct = defined.length > 0
    ? Math.round((coveredCount / defined.length) * 100)
    : 0;
  const passRatePct = results.length > 0
    ? Math.round(((passed.length + skipped.length) / results.length) * 100)
    : 0;
  const summary = {
    defined_count: defined.length,
    ut_count: utCount,
    st_count: stCount,
    manual_count: manualCount,
    // 账本统计保留所有自动化结果行的有效 ID 数量；未知/越界 ID 不参与 pass/fail，
    // 但必须通过 executed>defined / 守恒诊断留下可审计的不一致证据。
    executed_count: allResults.filter(result => !manualSet.has(result.id) && !isOutOfScope(result.id)).length,
    passed_count: passed.length,
    failed_count: failed.length,
    skipped_count: skipped.length,
    uncovered_count: uncovered.length,
    coverage_pct: coveragePct,
    pass_rate_pct: passRatePct,
  };
  const countMismatches = buildVerifyCountMismatches(summary, { covered_count: coveredCount, results_count: results.length });
  const consistency = buildVerifyConsistency({
    invalidResults,
    unknownResultIds,
    manualResultIds,
    outsideEligibleResultIds,
    countMismatches: countMismatches,
    countMismatchDetails: buildCountMismatchDetails(summary, countMismatches, { covered_count: coveredCount, results_count: results.length }),
  });


  // §2.75.1：Gate 判据收敛为三项——账本一致性、零失败、零未覆盖。
  // 设计时覆盖度清单（Layer1）与 AC 追溯矩阵（Layer3）是「人声称覆盖了」，不再参与放行；
  // 「规格声明的 ID 集合 ⊆ 结果 ID 集合」（uncovered）是不可替代的那一条，完整保留。
  // verify-smoke-guard-fixes-0-15-20（§2.75.1 第一项、决策 C01）：预跑命令任一段非零退出即 FAIL——
  // 结果文件可能是运行器回滚出的旧完好账本，也可能恰好完整全通过，都不能证明本次测试跑通。
  const preRunFailures = (preRun?.commands ?? []).filter(cmd => cmd.status === 'fail');
  const preRunFailed = preRunFailures.length > 0;
  const isPass = !preRunFailed && consistency.ok && failed.length === 0 && uncovered.length === 0
    && !changeSetInvalid && !tierMismatch;
  const gateResult = isPass ? 'PASS' as const : 'FAIL' as const;

  // 原因优先级按预跑是否失败分两支（delta r1 F1）：失败时 failed_cases → pre_run_failed；
  // 成功或未配置时保持既有顺序逐字不变（账本不自洽时账本本身不可信，仍以它为主原因）。
  let gateReason: string | null = null;
  // §2.106.7：test_change_set_invalid 排在预跑分支之前；case_tier_mismatch 紧随 failed_cases
  if (!isPass) {
    if (changeSetInvalid) gateReason = 'test_change_set_invalid';
    else if (preRunFailed) gateReason = failed.length > 0 ? 'failed_cases' : tierMismatch ? 'case_tier_mismatch' : 'pre_run_failed';
    else if (!consistency.ok) gateReason = 'result_ledger_inconsistent';
    else if (failed.length > 0) gateReason = 'failed_cases';
    else if (tierMismatch) gateReason = 'case_tier_mismatch';
    else gateReason = 'incomplete_coverage';
  }

  const renderReport = (finalGate: 'PASS' | 'FAIL') => generateReport(
    defined, results, passed, failed, skipped, uncovered,
    String(coveragePct), String(passRatePct), finalGate, resultIds, manualCount,
    sliceVerification,
    preRunFailures.map(cmd => ({ stage: cmd.stage, exit_code: cmd.exit_code })),
    scopeContext.scope ? { ...scopeContext.scope, out_of_scope_result_count: outOfScopeResultCount } : null,
    null,
    { classification: skipClassification, changeSetInvalid },
  );

  const relReportPath = 'logos/resources/verify/acceptance-report.md';

  const data = addCoverageDiagnostics(root, {
    contract: { version: contractVersion(false, Boolean(sliceVerification?.verify_mode)) },
    summary,
    gate: {
      result: gateResult,
      reason: gateReason,
    },
    failed_cases: failed.map(r => ({ id: r.id, error: r.error ?? 'unknown' })),
    uncovered_cases: uncovered,
    skipped_cases: skipped.map(r => r.id),
    consistency,
    pre_run: preRun ?? buildInitialPreRunData(config),
    smoke_precheck: checkSmokeCoverage(root, readSmokeCommandConfig(root)),
    sandbox: buildInitialSandboxData(config.sandbox ?? normalizeSandboxConfig({ sandbox_mode: 'auto' })),
    report_path: relReportPath,
    ...(sliceVerification?.manifest_status === 'valid' && sliceVerification.verify_mode ? {
      verify_mode: sliceVerification.verify_mode,
      attempted_slice_id: sliceVerification.attempted_slice_id,
      eligible_test_ids: sliceVerification.eligible_test_ids,
      pending_test_ids: sliceVerification.pending_test_ids,
      manifest: sliceVerification.manifest,
      checkpoint: sliceVerification.checkpoint,
      test_change_set: sliceVerification.test_change_set,
    } : {}),
    ...(scopeContext.scope ? { scope: { ...scopeContext.scope, out_of_scope_result_count: outOfScopeResultCount } } : {}),
    ...(skipClassification.platform.length > 0 ? { platform_skipped_cases: skipClassification.platform } : {}),
    ...(skipClassification.tier.length > 0 ? { tier_mismatch_cases: skipClassification.tier } : {}),
    ...(changeSetInvalid ? { change_set_diagnostic: { code: 'test_change_set_invalid' as const, detail: changeSetInvalid } } : {}),
    ...(skipClassification.unclassified.length > 0 ? { warnings: [{ code: 'unclassified_skipped_cases' as const, ids: skipClassification.unclassified }] } : {}),
  });
  applySmokePrecheck(root, data);
  acceptanceReportRenderers.set(data, renderReport);
  // 直接调用方（未延迟）在 smoke 覆盖预检之后以最终 gate 写共用报告；verify 主流程延迟到沙箱裁决之后写（§2.104.5）
  if (!opts.deferReport) writeAcceptanceReport(root, data);

  let proposalDir: string | null = null;
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      if (guard.activeChange) proposalDir = join(root, 'logos', 'changes', String(guard.activeChange));
    } catch {
      proposalDir = null;
    }
  }
  const automationDiagnostic = deriveAutomationDiagnostic(root, {
    proposalDir,
    verifyGate: data.gate.result,
    failedTests: data.failed_cases.map(item => item.id),
  });
  if (automationDiagnostic) data.automation_diagnostic = automationDiagnostic;
  return data;
}

const PRECHECK_REASONS = new Set(['verify_requirements_invalid', 'acceptance_requirement_undeclared', 'verify_env_not_ready']);

const EMPTY_REQUIREMENTS: VerifyRequirementsData = { declared: { env: [], commands: [], checks: [] }, acceptance_entries: [], missing_declarations: [], missing_environment: [] };

/** 本轮未读取任何结果文件的 FAIL 数据（预检失败之外：变更集无效且没有结果账本）。模块报告据此整份改写为「未执行」。 */
const NOT_EXECUTED_DATA = new WeakSet<VerifyData>();

/**
 * 评审 code-r2 F1 / code-r3 F1：已合并提案的测试变更集已判无效、且本轮没有结果账本或没有用例定义时的 verify 数据——不读取结果文件，
 * gate 为 test_change_set_invalid 并附读取器原因（§2.106.6 第 3 条、§2.106.7 第 1 位）。
 */
export function buildChangeSetInvalidWithoutResultsData(
  root: string,
  preRun: VerifyPreRunData,
  sandbox: SandboxData,
  detail: string,
  scopeContext: VerifyScopeContext,
  /** 本轮原本会早退的原因：没有结果账本，或测试规格中没有任何用例定义。 */
  cause: 'no-results' | 'no-cases' = 'no-results',
): VerifyData {
  const data: VerifyData = {
    contract: { version: contractVersion(false, false) },
    summary: {
      defined_count: 0, ut_count: 0, st_count: 0, manual_count: 0, executed_count: 0, passed_count: 0,
      failed_count: 0, skipped_count: 0, uncovered_count: 0, coverage_pct: 0, pass_rate_pct: 0,
    },
    gate: { result: 'FAIL', reason: 'test_change_set_invalid' },
    failed_cases: [],
    uncovered_cases: [],
    skipped_cases: [],
    consistency: {
      ok: true, reasons: [], unknown_result_ids: [], manual_result_ids: [], outside_eligible_result_ids: [],
      invalid_results: [], count_mismatches: [],
    },
    pre_run: preRun,
    smoke_precheck: notExecutedSmokePrecheck(root),
    sandbox,
    report_path: 'logos/resources/verify/acceptance-report.md',
    change_set_diagnostic: { code: 'test_change_set_invalid', detail },
    ...(scopeContext.scope ? { scope: { ...scopeContext.scope } } : {}),
  };
  NOT_EXECUTED_DATA.add(data);
  acceptanceReportRenderers.set(data, () => {
    const now = new Date().toISOString().slice(0, 10);
    let md = `# Acceptance Report\n\n> Generated by \`openlogos verify\` on ${now}\n\n## Summary\n\n| Metric | Value |\n|--------|-------|\n`;
    for (const metric of ['Defined cases', 'Executed cases', 'Passed', 'Failed', 'Skipped', 'Uncovered']) md += `| ${metric} | 未执行 / not executed |\n`;
    md += `| **Gate 3.5** | **FAIL** |\n\n`;
    md += `## 测试变更集无效 / Test Change Set Invalid\n\n- Reason: \`test_change_set_invalid\` — ${detail}\n`;
    md += cause === 'no-cases'
      ? '- 测试规格中没有任何用例定义，未读取结果文件 / no test case definitions were found and no result file was read\n\n'
      : '- 本轮没有结果账本，未读取任何结果文件 / no result ledger was present and no result file was read\n\n';
    return md;
  });
  return data;
}

/** 预检失败时的模块验收报告（§2.106.7A）：「模块」行与 Gate 行照常，计数「未执行」，写明原因与本模块相关的缺失项。 */
function renderModulePrecheckReport(moduleId: string, reason: string, req: VerifyRequirementsData, detail?: string): string {
  const now = new Date().toISOString().slice(0, 10);
  let md = `# Acceptance Report\n\n> Generated by \`openlogos verify\` on ${now}\n\n## Summary\n\n| Metric | Value |\n|--------|-------|\n`;
  md += `| ${MODULE_ROW_LABEL} | ${moduleId} |\n`;
  for (const metric of ['Defined cases', 'Executed cases', 'Passed', 'Failed', 'Skipped', 'Uncovered']) md += `| ${metric} | 未执行 / not executed |\n`;
  md += `| **Gate 3.5** | **FAIL** |\n\n## Run-level Rejections\n\n`;
  md += `- ${reason}: ${detail ? `${detail} (not attributable to a module)` : (PRECHECK_REASON_TITLES[reason] ?? reason)}\n`;
  const own = req.missing_environment.filter(mm => mm.modules?.includes(moduleId));
  for (const mm of own) md += `- missing: ${describeMissing(mm)}\n`;
  for (const mm of req.missing_environment.filter(x => !x.modules || x.modules.length === 0)) md += `- missing: ${describeMissing(mm)}\n`;
  for (const entry of req.missing_declarations) md += `- undeclared: \`${entry}\`\n`;
  for (const line of req.invalid ?? []) md += `- invalid: ${line}\n`;
  md += '- 本次未执行测试 / no test was executed in this run\n\n';
  return md;
}

/**
 * 多模块项目为本次覆盖的每个 initial 模块写模块验收报告（功能规格 §2.99.5，spec/test-results.md
 * 「多模块项目的模块验收报告与模块冒烟报告」）。必须在全部门禁裁决之后调用；返回写入的相对路径。
 *
 * - 覆盖的模块：范围未启用 / all / fallback-full 为全部已登记模块，module 模式为范围 M；只写 initial 模块。
 * - U(m)：m 前缀测试规格 ∪ 不带已登记模块前缀的测试规格中的用例（与 M={m} 的 testFileInScope 同判据），
 *   始终按完整集合统计（切片核验模式也不与 eligible 求交）；为空时不写，已有报告不动。
 * - 模块 Gate：U(m) 零失败、零未覆盖，且无计入本模块的运行级拒绝——带 `modules` 的预跑失败只计入其模块，
 *   不带 `modules` 的预跑失败、账本不自洽、沙箱失败计入每个被覆盖模块。
 */
export function writeModuleAcceptanceReports(
  root: string,
  data: VerifyData,
  preRun: VerifyPreRunData,
  sandbox: SandboxData,
  scopeContext: VerifyScopeContext,
  // 切片核验状态不参与模块报告统计：写出的模块报告恒按完整 U(m)（code-r1 F2）；它只决定 owned checkpoint 是否跳过写入
  sliceVerification: SliceVerificationState | null,
): string[] {
  // slice-verify-efficient-mode（功能规格 §2.37.4）：owned 范围的 checkpoint 不写、不改模块验收报告——
  // 模块报告按完整 U(m) 统计，只验收 owned 时会把基线误报为未覆盖；baseline 范围与 final 照旧写。
  if (sliceVerification?.verify_mode === 'slice-checkpoint' && sliceVerification.verify_scope === 'owned') return [];
  const modules = registeredModules(readProjectYaml(root).data?.modules);
  if (modules.length < 2) return [];
  const coveredIds = scopeContext.scope?.mode === 'module' ? new Set(scopeContext.scope.modules) : new Set(modules.map(m => m.id));
  const targets = modules.filter(m => m.lifecycle === 'initial' && coveredIds.has(m.id)).map(m => m.id);
  if (targets.length === 0) return [];

  const moduleIds = moduleIdsOf(root);
  const fullIndex = extractDefinedIndex(root);
  const manual = new Set(fullIndex.manualIds);
  // 测试规格文件 → 模块（null = 不带已登记模块前缀）
  const idsByModule = new Map<string | null, { ids: string[]; manual: number }>();
  const dir = join(root, TEST_CASES_DIR);
  if (existsSync(dir)) {
    const files = readdirSync(dir, { recursive: true }).map(f => String(f)).filter(f => f.endsWith('-test-cases.md')).sort();
    for (const file of files) {
      const owner = testFileModule(file, moduleIds);
      const bucket = idsByModule.get(owner) ?? { ids: [], manual: 0 };
      for (const line of readFileSync(join(dir, file), 'utf-8').split('\n')) {
        if (!line.trim().startsWith('|')) continue;
        const firstCell = (line.split('|').map(cell => cell.trim())[1]) ?? '';
        if (!TABLE_CELL_ID_RE.test(firstCell)) continue;
        const id = firstCell.replace(MANUAL_SUFFIX, '').replace(/\s+/g, ' ').trim();
        if (manual.has(id)) bucket.manual += 1;
        else bucket.ids.push(id);
      }
      idsByModule.set(owner, bucket);
    }
  }

  // verify-self-sufficient-cases（§2.106.7A）：预检类原因判 FAIL 时没有执行任何测试，不读取结果文件；
  // 本次覆盖的每个 initial 模块报告整份改写为 FAIL（计数「未执行」），从而撤销旧的 PASS 报告
  const precheckRejection = Boolean(data.requirements && data.gate.result === 'FAIL' && PRECHECK_REASONS.has(data.gate.reason ?? ''));
  if (precheckRejection || NOT_EXECUTED_DATA.has(data)) {
    const written: string[] = [];
    for (const m of targets) {
      const own = idsByModule.get(m) ?? { ids: [], manual: 0 };
      const global = idsByModule.get(null) ?? { ids: [], manual: 0 };
      if (own.ids.length + global.ids.length === 0) continue;
      const rel = moduleReportPath(m, 'acceptance');
      // 变更集无效且无账本（评审 code-r2 F1）：运行级拒绝不可归属到模块，计入每个被覆盖模块
      const body = precheckRejection
        ? renderModulePrecheckReport(m, data.gate.reason!, data.requirements!)
        : renderModulePrecheckReport(m, 'test_change_set_invalid', EMPTY_REQUIREMENTS, data.change_set_diagnostic?.detail);
      publishReportAtomically(join(root, rel), body);
      written.push(rel);
    }
    return written;
  }

  const config = readVerifyConfig(root);
  const results = parseJsonlWithDiagnostics(readFileSync(join(root, config.resultPath), 'utf-8')).results;
  const failedPreRun = preRun.commands.filter(cmd => cmd.status === 'fail');
  const unattributed: string[] = [];
  for (const cmd of failedPreRun) {
    if (!cmd.modules || cmd.modules.length === 0) unattributed.push(`pre_run_failed: ${cmd.stage} exited ${cmd.exit_code ?? 'unknown'} (not attributable to a module)`);
  }
  if (!data.consistency.ok) unattributed.push('result_ledger_inconsistent: the result ledger is inconsistent (not attributable to a module)');
  if (sandbox.status === 'fail') unattributed.push(`sandbox_failed: ${sandbox.diagnostics[0] ?? 'verify sandbox failed'}`);
  // §2.106.7A：测试变更集无效无法按用例归属，计入每个被覆盖模块
  if (data.change_set_diagnostic) unattributed.push(`test_change_set_invalid: ${data.change_set_diagnostic.detail} (not attributable to a module)`);
  const tierIds = new Set((data.tier_mismatch_cases ?? []).map(c => c.id));

  const written: string[] = [];
  for (const m of targets) {
    const own = idsByModule.get(m) ?? { ids: [], manual: 0 };
    const global = idsByModule.get(null) ?? { ids: [], manual: 0 };
    // 完整 U(m)：不与切片 eligible 求交——未执行的用例保留为 uncovered，切片的局部 PASS 只留在切片记录中（code-r1 F2）
    const subset = Array.from(new Set([...own.ids, ...global.ids])).sort();
    if (subset.length === 0) continue;
    const subsetSet = new Set(subset);
    const moduleResults = results.filter(r => subsetSet.has(r.id));
    const resultIds = new Set(moduleResults.map(r => r.id));
    const passed = moduleResults.filter(r => r.status === 'pass');
    const failed = moduleResults.filter(r => r.status === 'fail');
    const skipped = moduleResults.filter(r => r.status === 'skip');
    const uncovered = subset.filter(id => !resultIds.has(id));
    const coveragePct = Math.round(((subset.length - uncovered.length) / subset.length) * 100);
    const passRatePct = moduleResults.length > 0 ? Math.round(((passed.length + skipped.length) / moduleResults.length) * 100) : 0;
    const ownPreRun = failedPreRun.filter(cmd => cmd.modules?.includes(m));
    // §2.106.7A：用例分层错误按用例归属——只计入其 ID 属于 U(m) 的模块
    const ownTier = subset.filter(id => tierIds.has(id));
    const rejections = [
      ...ownPreRun.map(cmd => `pre_run_failed: ${cmd.stage} exited ${cmd.exit_code ?? 'unknown'} (module command group: ${cmd.modules!.join(', ')})`),
      ...(ownTier.length > 0 ? [`case_tier_mismatch: ${ownTier.join(', ')}（准备好环境并声明到 verify.requirements，或改标 \`[manual]\`）`] : []),
      ...unattributed,
    ];
    const gate = failed.length === 0 && uncovered.length === 0 && rejections.length === 0 ? 'PASS' as const : 'FAIL' as const;
    const rel = moduleReportPath(m, 'acceptance');
    publishReportAtomically(join(root, rel), generateReport(
      subset, moduleResults, passed, failed, skipped, uncovered,
      String(coveragePct), String(passRatePct), gate, resultIds, own.manual + global.manual,
      null,
      [...ownPreRun, ...failedPreRun.filter(cmd => !cmd.modules || cmd.modules.length === 0)].map(cmd => ({ stage: cmd.stage, exit_code: cmd.exit_code })),
      null,
      { moduleId: m, runLevelRejections: rejections },
    ));
    written.push(rel);
  }
  return written;
}

/**
 * M2 切片 2：loop 激活时追加 `LOOP_ITERS` 账本（不依赖 guard 的共享路径，由主进程写）。
 * launched=guard.module/提案目录；initial 单模块=该模块/resources-verify；initial 多模块=不写（R7）。
 * 未激活（builtin max_iters:1）/无法定位 → 不写（零副作用）。
 */
function appendLoopIter(
  root: string,
  gatePass: boolean,
  sliceVerification?: SliceVerificationState | null,
): void {
  let activeChange: string | null = null;
  let guardModule: string | null = null;
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const g = JSON.parse(readFileSync(guardPath, 'utf-8'));
      activeChange = g.activeChange || null;
      guardModule = g.module || null;
    } catch { /* ignore */ }
  }

  let lifecycle: 'initial' | 'launched';
  let moduleId: string;
  let proposalDir: string | null;
  if (activeChange && guardModule) {
    lifecycle = 'launched';
    moduleId = guardModule;
    proposalDir = join(root, 'logos', 'changes', activeChange);
  } else {
    // 无活跃提案：launched 项目的账本只在提案目录、此处无提案 → 不写
    // （launch 后历史 logos/flow/initial.yaml 即便含 set-loop 也不得写 initial 账本，spec/cli-json-output.md §13）
    if (inferLifecycle(root) === 'launched') return;
    lifecycle = 'initial';
    proposalDir = null;
    const yaml = readProjectYaml(root);
    const mods = Array.isArray(yaml.data?.modules) ? yaml.data.modules : [];
    if (mods.length > 1) return; // initial 多模块：无法归属、不写（R7）
    moduleId = mods.length === 1 ? mods[0].id : 'core';
  }

  let resolved;
  try { resolved = loadFlow(root, { lifecycle, resolved: true }).flow; } catch { return; }
  const act = findActivatedLoop(resolved);
  if (!act) return; // 未激活 → 不写
  // 切片感知模式只把真实 Gate FAIL 计入 repair budget；checkpoint PASS/pending/final PASS 均不计次。
  if (sliceVerification && gatePass) return;

  const path = loopLedgerPath(root, proposalDir);
  const iter = readLoopIters(path, moduleId).length + 1;
  const rowObj: Record<string, unknown> = {
    iter, node: 'verify', result: gatePass ? 'pass' : 'fail', module: moduleId,
    timestamp: new Date().toISOString(),
  };
  if (sliceVerification?.verify_mode) {
    rowObj.verify_mode = sliceVerification.verify_mode;
    rowObj.attempted_slice_id = sliceVerification.attempted_slice_id;
  }
  // change-flow-redesign：切片循环激活且有当前切片 → 记录本轮尝试的切片（每片尝试历史；完成仍以 [code] 勾选为准）
  if (proposalDir && act.until === 'code_slices_green') {
    const cur = sliceVerification?.attempted_slice_id ?? deriveSliceState(proposalDir).current;
    if (cur != null) rowObj.slice = cur;
  }
  const row = JSON.stringify(rowObj);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, row + '\n');
}

function activeSliceVerification(root: string, inScope: Set<string> | null = null): {
  proposalDir: string;
  state: SliceVerificationState;
} | null {
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (!existsSync(guardPath)) return null;
  try {
    const guard = JSON.parse(readFileSync(guardPath, 'utf8')) as { activeChange?: string; module?: string };
    if (!guard.activeChange) return null;
    const proposalDir = join(root, 'logos', 'changes', guard.activeChange);
    if (!existsSync(proposalDir)) return null;
    const state = deriveSliceVerificationState(root, proposalDir, {
      change: guard.activeChange,
      module: guard.module ?? 'core',
    }, inScope ? { inScope: id => inScope.has(id) } : undefined);
    return state ? { proposalDir, state } : null;
  } catch {
    return null;
  }
}

function stopForSliceManifestState(
  format: OutputFormat,
  state: SliceVerificationState,
): void {
  const reason = state.reason ?? 'test-slice-manifest-invalid';
  const data = { reason, slice_verification_state: state };
  const code = reason === 'test-slice-manifest-unsupported' || reason === 'test-slice-assignment-ambiguous' ? 1 : 2;
  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('verify', data)));
    // 仅 JSON 分支设 exitCode 而非 process.exit：stdout 为管道时须等缓冲排空，否则大 envelope 被截断（S16 EX-2.6）
    process.exitCode = code;
    return;
  }
  console.error(`✖ verify 暂停：${reason}`);
  for (const item of state.violations ?? []) console.error(`  - [${item.code}] ${item.path}: ${item.message}`);
  process.exit(code);
}

export function verify(format: OutputFormat = 'text', runOptions: VerifyRunOptions = {}) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'verify', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.',
      )));
      process.exit(1);
    }
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  const locale = readLocale(root);

  // M2 切片 2：尽早校验 resolved flow（overlay 含非法 set-loop 等）→ fail loud，
  // 避免静默退化为「不写 LOOP_ITERS、却仍写验收报告与 VERIFY_PASS/FAIL marker」。无 overlay 项目不触发（golden 零漂移）。
  try {
    loadFlow(root, { lifecycle: inferLifecycle(root), resolved: true });
  } catch (e) {
    if (e instanceof FlowError) {
      if (format === 'json') {
        console.error(JSON.stringify(makeErrorEnvelope('verify', e.code, e.message)));
      } else {
        console.error(`✖ flow 配置错误（${e.code}）：${e.message}`);
      }
      process.exit(1);
    }
    throw e;
  }

  // §2.96.2：启用条件与范围先于切片集合与结果过滤计算；未启用时 scopeContext 为空、全部行为逐字不变。
  const scopeContext = resolveVerifyScopeContext(root, { all: runOptions.all });
  const sliceContext = activeSliceVerification(root, scopeContext.inScope);
  // 多切片提案的测试变更集不可信时保持人工边界、零副作用（S32 UT-S32-48 / ST-S32-16，EX-13.14「副作用：无」）：
  // 由切片清单暂停分支返回 human_action_required，不写、不推进 Gate、loop、checkpoint 或 VERIFY 标记。
  // 非切片路径的 test_change_set_invalid 由下方完整性收尾处理（§2.106.6 第 3 条）。
  if (sliceContext && (sliceContext.state.manifest_status !== 'valid' || !sliceContext.state.verify_mode)) {
    return stopForSliceManifestState(format, sliceContext.state);
  }
  const sliceVerification = sliceContext?.state ?? null;

  const config = readVerifyConfig(root);
  const resultPath = config.resultPath;
  const previousEligible = process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS;
  const previousSliceScope = process.env.OPENLOGOS_VERIFY_SLICE_SCOPE;
  if (sliceVerification?.eligible_test_ids) {
    process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS = JSON.stringify(sliceVerification.eligible_test_ids);
  }
  // slice-verify-efficient-mode（spec/test-results.md「三个集合」）：只有 slice-checkpoint 注入验收范围；
  // final 与非切片 verify 不注入，且不让父进程的同名变量泄漏给预跑命令。
  const checkpointScope = sliceVerification?.verify_mode === 'slice-checkpoint' ? sliceVerification.verify_scope : null;
  if (checkpointScope) process.env.OPENLOGOS_VERIFY_SLICE_SCOPE = checkpointScope;
  else delete process.env.OPENLOGOS_VERIFY_SLICE_SCOPE;
  // verification-history（§2.104.4 / §2.104.6）：通过前置检查后、首个预跑命令或结果读取之前开启运行，
  // 一次性获取全部有效结果路径的锁；冲突时以 RESULT_PATH_BUSY 拒绝，不截断任何结果文件、不写历史。
  let resultLocks: ResultPathLockHandle;
  try {
    resultLocks = acquireResultPathLocks(root, [resultPath, config.regressionResultPath, config.incrementalResultPath]);
  } catch (e) {
    if (e instanceof ResultPathBusyError) {
      if (format === 'json') {
        console.error(JSON.stringify(makeErrorEnvelope('verify', e.code, e.message, { details: { paths: e.paths } })));
      } else {
        console.error(`\nError: ${e.message}`);
      }
      process.exit(2);
    }
    throw e;
  }
  // 锁在任何退出路径上都释放（含进程内调用时被拦截的 process.exit 抛出）
  try {
  const historyRun: HistoryRunContext = startHistoryRun(root, 'verify');
  const historyBase = (): Pick<HistoryFinish, 'moduleScope' | 'verifyMode' | 'attemptedSliceId'> => ({
    moduleScope: scopeContext.scope ? [...scopeContext.scope.modules] : null,
    verifyMode: sliceVerification?.manifest_status === 'valid' && sliceVerification.verify_mode ? sliceVerification.verify_mode : null,
    attemptedSliceId: sliceVerification?.manifest_status === 'valid' && sliceVerification.verify_mode
      ? (sliceVerification.attempted_slice_id ?? null) : null,
  });
  let preRunResult: RunVerifyPreRunResult;
  // verify-self-sufficient-cases（§2.106.5）：任何预跑命令之前依次做结构校验 → 验收标准对账 → 环境预检；
  // 任一失败即不执行预跑、不截断也不读取结果文件。未声明要求且无对账条目时零变化。
  let precheck: PrecheckOutcome = { ok: true, reason: null, data: null, sandbox: null };
  try {
    const sandboxConfig = config.sandbox ?? normalizeSandboxConfig({ sandbox_mode: 'auto' });
    // 生效集合只对实际执行的命令组服务的模块求 E(m)（§2.106.4 第 2、4 条）；未启用模块范围时为项目级
    const servedModules = scopeContext.scope
      ? selectVerifyCommandGroups(config, scopeContext.scope.modules).flatMap(g => g.modules)
      : null;
    precheck = runVerifyPrecheck({ root, format, sandbox: sandboxConfig, rawVerify: readRawVerifyConfig(root), servedModules });
    if (!precheck.ok) {
      preRunResult = { preRun: buildInitialPreRunData(config), sandbox: precheck.sandbox ?? buildInitialSandboxData(sandboxConfig) };
    } else {
      // module-scoped-phase-reports（code-r3 F3）：结果路径落在模块报告保留路径上时，runner 可能按原配置写入保留路径，
      // 而 verify 没有可交接给 runner 的结果路径——不调用任何预跑命令，按既有 pre_run_failed 失败契约收尾（不新增错误码）
      const blocked = config.reservedRedirects?.length ? blockedPreRunForReservedPaths(root, config, locale) : null;
      preRunResult = blocked
        ?? (scopeContext.scope
          ? runVerifyModulePreRunWithSandbox(root, config, scopeContext.scope, format, runOptions)
          : runVerifyPreRunWithSandbox(root, config, format, runOptions));
    }
  } finally {
    if (previousEligible === undefined) delete process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS;
    else process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS = previousEligible;
    if (previousSliceScope === undefined) delete process.env.OPENLOGOS_VERIFY_SLICE_SCOPE;
    else process.env.OPENLOGOS_VERIFY_SLICE_SCOPE = previousSliceScope;
  }
  const preRun = preRunResult.preRun;
  const sandbox = preRunResult.sandbox;
  // module-scoped-phase-reports：已改写到默认路径的保留结果路径（readVerifyConfig 已改写，CLI 不读写保留路径）
  for (const r of config.reservedRedirects ?? []) {
    preRun.diagnostics.push(t(locale, 'verify.resultPathReserved', { key: r.config_key, path: r.path, fallback: r.fallback }));
  }

  const precheckFailed = !precheck.ok;
  const fullResultPath = join(root, resultPath);
  if (!precheckFailed) ensureResultFileWhenPreRunFailed(fullResultPath, preRun);
  // 评审 code-r2 F1（§2.106.6、§2.106.7、§2.106.7A）：已合并提案的测试变更集已判无效而本轮没有结果账本时，
  // 不以 NO_TEST_RESULTS / NO_TEST_CASES 早退——完整性拒绝照常进入门禁：记录 test_change_set_invalid 与读取器原因，
  // 改判覆盖的 initial 模块报告、撤销旧 VERIFY_PASS，并写 result_source=none 的 completed 历史。
  // 评审 code-r3 F1：缺用例定义（NO_TEST_CASES）的早退同理——两类早退之前都先确认变更集状态，已知无效时优先交给 FAIL 收尾。
  const abortKind: 'no-results' | 'no-cases' | null = precheckFailed
    ? null
    : !existsSync(fullResultPath) ? 'no-results'
      : extractDefinedIds(root).ids.length === 0 ? 'no-cases' : null;
  const strictWithoutLedger = abortKind ? readStrictSkipSet(root) : null;
  const changeSetInvalidWithoutLedger = strictWithoutLedger?.state === 'invalid' ? strictWithoutLedger.detail : null;
  /** 本轮未读取任何结果文件：预检失败，或变更集无效且本轮即将因缺结果账本 / 缺用例定义早退。 */
  const noResultsRead = precheckFailed || changeSetInvalidWithoutLedger !== null;
  // 结果来源（§2.104.3）：本次调用执行了任一预跑 / 两阶段命令为 executed，只读取既有结果为 reused；
  // 预检类原因判 FAIL 时既未执行也未读取，为 none（verify-self-sufficient-cases）
  const resultSource: 'executed' | 'reused' | 'none' = noResultsRead
    ? 'none'
    : preRun.commands.some(cmd => cmd.status !== 'skipped') ? 'executed' : 'reused';

  /** 进入执行后的既有早退（§2.104.4）：写 aborted 历史，沿用既有错误信封、错误码与退出码，附 error.details.history。 */
  const abortWithHistory = (code: 'NO_TEST_RESULTS' | 'NO_TEST_CASES', jsonMessage: string, textMessage: string): never => {
    const meta = writeHistoryRun(historyRun, {
      ...historyBase(),
      outcome: 'aborted',
      gate: { result: null, reason: null },
      errorCode: code,
      counts: {},
      resultSource,
      resultPath: existsSync(fullResultPath) ? resultPath : null,
      resultCapture: captureResultBytes(root, resultPath),
      reportBytes: null,
    });
    resultLocks.release();
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope('verify', code, jsonMessage, { details: { history: meta } })));
      process.exit(1);
    }
    console.error(`\nError: ${textMessage}`);
    console.error(historyTextLine(meta, locale));
    process.exit(1);
  };

  if (!noResultsRead && !existsSync(fullResultPath)) {
    abortWithHistory('NO_TEST_RESULTS', `No test results found at ${resultPath}.`, t(locale, 'verify.noResults', { path: resultPath }));
  }

  if (!noResultsRead && extractDefinedIds(root).ids.length === 0) {
    abortWithHistory('NO_TEST_CASES', 'No test case specs found in logos/resources/test/.', t(locale, 'verify.noCases'));
  }

  let data: VerifyData;
  let resultCapture: ReturnType<typeof captureResultBytes>;
  if (precheckFailed) {
    data = buildPrecheckFailureData(root, config, preRun, sandbox, precheck, sliceVerification, scopeContext);
    resultCapture = null;
  } else if (changeSetInvalidWithoutLedger !== null) {
    data = buildChangeSetInvalidWithoutResultsData(root, preRun, sandbox, changeSetInvalidWithoutLedger, scopeContext, abortKind === 'no-cases' ? 'no-cases' : 'no-results');
    resultCapture = null;
  } else {
    data = collectVerifyData(root, preRun, sliceVerification, scopeContext, { deferReport: true });
    // 采集当时的结果字节（code-r1 F3）：历史写入不再二次读取结果文件
    resultCapture = captureResultBytes(root, resultPath);
    data.sandbox = sandbox;
    if (sandbox.status === 'fail' && data.gate.result === 'PASS') {
      data.gate.result = 'FAIL';
      data.gate.reason = 'failed_cases';
      if (data.failed_cases.length === 0) {
        data.failed_cases.push({
          id: 'sandbox',
          error: sandbox.diagnostics[0] ?? 'verify sandbox failed',
        });
      }
    }
    if (precheck.data) data.requirements = precheck.data;
  }

  // verification-history（§2.104.5）：全部门禁（smoke 覆盖预检、沙箱改判）裁决之后由最终数据渲染一次共用报告，
  // 同一份字节稍后用作报告快照，不从共用路径回读
  const reportBytes = writeAcceptanceReport(root, data);
  testPauseAfterReport();

  // module-scoped-phase-reports：全部门禁（含沙箱改判）裁决之后写模块验收报告（§2.99.5）
  writeModuleAcceptanceReports(root, data, preRun, sandbox, scopeContext, sliceVerification);

  // M2 切片 2：loop 激活时追加迭代账本（共享路径、取最终 data.gate.result；配置类早退已在上面 process.exit、不会到此）
  if (sliceVerification?.verify_mode === 'slice-checkpoint') {
    appendSliceCheckpoint(sliceContext!.proposalDir, sliceVerification, data.gate.result);
    if (data.checkpoint) {
      data.checkpoint.result = data.gate.result;
      if (data.gate.result === 'PASS' && sliceVerification.attempted_slice_id) {
        data.checkpoint.confirmed_slice_ids = [
          ...sliceVerification.confirmed_slice_ids,
          sliceVerification.attempted_slice_id,
        ];
      }
    }
  } else if (data.checkpoint) {
    data.checkpoint.result = data.gate.result;
  }
  appendLoopIter(root, data.gate.result === 'PASS', sliceVerification);

  // 写入提案目录标记文件（如果有活跃提案）
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      const slug = guard.activeChange;
      if (slug) {
        const proposalDir = join(root, 'logos', 'changes', slug);
        if (existsSync(proposalDir)) {
          if (data.gate.result === 'PASS') {
            if (sliceVerification?.verify_mode !== 'slice-checkpoint') {
              writeFileSync(join(proposalDir, VERIFY_PASS_MARKER), '');
            }
            for (const marker of ['VERIFY_FAIL']) {
              const markerPath = join(proposalDir, marker);
              if (existsSync(markerPath)) rmSync(markerPath, { force: true });
            }
          } else {
            writeFileSync(join(proposalDir, 'VERIFY_FAIL'), '');
            for (const marker of [VERIFY_PASS_MARKER, 'DEPLOY_DONE', 'SMOKE_PASS', 'SMOKE_FAIL']) {
              const markerPath = join(proposalDir, marker);
              if (existsSync(markerPath)) rmSync(markerPath, { force: true });
            }
          }
        }
      }
    } catch { /* guard 文件读取失败时静默跳过 */ }
  }

  // verification-history（§2.104.4）：最终门禁处写 completed 历史；写入失败只体现在 history 元数据
  data.history = writeHistoryRun(historyRun, {
    ...historyBase(),
    outcome: 'completed',
    gate: { result: data.gate.result, reason: data.gate.reason },
    errorCode: null,
    // 预检类原因判 FAIL：计数为 null、ID 数组为空，不采集也不复制任何结果文件（§2.104.3 修改）
    counts: noResultsRead ? {} : {
      defined: data.summary.defined_count,
      executed: data.summary.executed_count,
      passed: data.summary.passed_count,
      failed: data.summary.failed_count,
      skipped: data.summary.skipped_count,
      uncovered: data.summary.uncovered_count,
    },
    failedIds: data.failed_cases.map(item => item.id).filter(id => id !== 'sandbox'),
    skippedIds: data.skipped_cases,
    uncoveredIds: data.uncovered_cases,
    resultSource,
    resultPath: noResultsRead ? null : resultPath,
    resultCapture,
    reportBytes,
  });
  resultLocks.release();

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('verify', data)));
    // 设 exitCode 后自然退出，保证管道消费方读到完整 envelope（S16 EX-2.6）
    if (data.gate.result !== 'PASS') process.exitCode = 1;
    return;
  }

  // Human-readable output (preserving original behavior)
  console.log(`\n🔍 ${t(locale, 'verify.title')}\n`);
  console.log(t(locale, 'verify.readingResults', { path: resultPath }));
  console.log(t(locale, 'verify.readingCases'));

  const { summary, gate, failed_cases, uncovered_cases, consistency, pre_run } = data;

  console.log(`\n${LINE}`);
  console.log(`📊 ${t(locale, 'verify.summary')}`);
  console.log(LINE);
  if (data.scope) console.log(`  Scope: ${scopeReportValue(data.scope)}`);
  console.log(`  ${t(locale, 'verify.totalDefined', { count: String(summary.defined_count), ut: String(summary.ut_count), st: String(summary.st_count) })}`);
  if (summary.manual_count > 0) {
    console.log(`  🔵 ${t(locale, 'verify.manual', { count: String(summary.manual_count) })}`);
  }
  console.log(`  ${t(locale, 'verify.totalExecuted', { count: String(summary.executed_count) })}`);
  console.log(`  ✅ ${t(locale, 'verify.passed', { count: String(summary.passed_count) })}`);
  console.log(`  ❌ ${t(locale, 'verify.failed', { count: String(summary.failed_count) })}`);
  console.log(`  ⏭️  ${t(locale, 'verify.skipped', { count: String(summary.skipped_count) })}`);
  console.log(LINE);
  console.log(`  ${t(locale, 'verify.coverage', { pct: String(summary.coverage_pct), covered: String(summary.defined_count - summary.uncovered_count), total: String(summary.defined_count) })}`);
  console.log(`  ${t(locale, 'verify.passRate', { pct: String(summary.pass_rate_pct), passed: String(summary.passed_count + summary.skipped_count), total: String(summary.executed_count) })}`);
  console.log(LINE);

  for (const c of data.platform_skipped_cases ?? []) console.log(`  ⏭️  platform skip: ${c.id}  ${c.detail}`);
  for (const w of data.warnings ?? []) console.log(`  ⚠️  ${w.code}: ${w.ids.join(', ')}`);

  if (failed_cases.length > 0) {
    console.log(`\n❌ ${t(locale, 'verify.failedCases')}`);
    for (const r of failed_cases) {
      console.log(`  ${r.id}  ${r.error}`);
    }
  }

  if (uncovered_cases.length > 0) {
    console.log(`\n⚠️  ${t(locale, 'verify.uncoveredCases', { count: String(uncovered_cases.length) })}`);
    for (const id of uncovered_cases) {
      console.log(`  ${id}`);
    }
  }

  if (!consistency.ok) {
    console.log('\n❌ verify result ledger is inconsistent');
    for (const reason of consistency.reasons) {
      console.log(`  ${reason}`);
    }
    if (consistency.unknown_result_ids.length > 0) {
      console.log(`  unknown_result_ids: ${consistency.unknown_result_ids.join(', ')}`);
    }
    if (consistency.manual_result_ids.length > 0) {
      console.log(`  manual_result_ids: ${consistency.manual_result_ids.join(', ')}`);
    }
    for (const invalid of consistency.invalid_results) {
      const id = invalid.id ? ` id=${invalid.id}` : '';
      const status = invalid.status ? ` status=${invalid.status}` : '';
      console.log(`  invalid line ${invalid.line}:${id}${status} reason=${invalid.reason}`);
    }
    if (consistency.count_mismatches.length > 0) {
      console.log(`  count_mismatches: ${consistency.count_mismatches.join(', ')}`);
      for (const detail of consistency.count_mismatch_details ?? []) {
        console.log(`    ${detail.code}: ${detail.left} ≠ ${detail.right}`);
      }
    }
  }

  if (data.requirements && (gate.reason === 'verify_requirements_invalid' || gate.reason === 'acceptance_requirement_undeclared' || gate.reason === 'verify_env_not_ready')) {
    const req = data.requirements;
    console.log(`\n❌ verify precheck: ${gate.reason}`);
    for (const line of req.invalid ?? []) console.log(`  ${line}`);
    for (const entry of req.missing_declarations) console.log(`  undeclared: ${entry}`);
    for (const m of req.missing_environment) console.log(`  missing: ${describeMissing(m)}`);
    console.log('  （本次未执行任何预跑命令 / no pre-run command was executed）');
  }
  if (gate.result === 'PASS') {
    console.log(`\n✅ ${t(locale, 'verify.gatePass')}`);
  } else if (gate.reason === 'verify_requirements_invalid' || gate.reason === 'acceptance_requirement_undeclared' || gate.reason === 'verify_env_not_ready') {
    console.log(`\n❌ Gate 3.5: FAIL (${gate.reason})`);
  } else if (gate.reason === 'case_tier_mismatch') {
    console.log('\n❌ Gate 3.5: FAIL (case_tier_mismatch)');
    for (const c of data.tier_mismatch_cases ?? []) console.log(`  ${c.id}  ${c.fix_hint}`);
  } else if (gate.reason === 'test_change_set_invalid') {
    console.log(`\n❌ Gate 3.5: FAIL (test_change_set_invalid) ${data.change_set_diagnostic?.detail ?? ''}`);
  } else if (gate.reason === 'result_ledger_inconsistent') {
    console.log('\n❌ Gate 3.5: FAIL (result ledger inconsistent)');
  } else if (gate.reason === 'pre_run_failed') {
    console.log('\n❌ Gate 3.5: FAIL (pre-run command exited with non-zero status)');
  } else if (gate.reason === 'failed_cases') {
    console.log(`\n❌ ${t(locale, 'verify.gateFail')}`);
  } else {
    // §2.75.1：收敛后仅剩 incomplete_coverage 一种未列举原因
    console.log(`\n❌ ${t(locale, 'verify.gateFailCoverage')}`);
  }

  console.log(`\n📄 ${t(locale, 'verify.reportPath', { path: data.report_path })}`);
  console.log(`${historyTextLine(data.history, locale)}\n`);

  if (pre_run.mode !== 'none' || pre_run.diagnostics.length > 0 || pre_run.suggestions.length > 0) {
    if (pre_run.mode === 'pre_run_command') {
      console.log(`⚙️  ${t(locale, 'verify.preRunModeSingle')}`);
    } else if (pre_run.mode === 'two_phase') {
      console.log(`⚙️  ${t(locale, 'verify.preRunModeTwoPhase')}`);
    } else {
      console.log(`⚙️  ${t(locale, 'verify.preRunModeNone')}`);
    }
    for (const cmd of pre_run.commands) {
      const exit = cmd.exit_code === undefined ? 'n/a' : String(cmd.exit_code);
      const duration = cmd.duration_ms === undefined ? 'n/a' : `${cmd.duration_ms}ms`;
      console.log(`  ${t(locale, 'verify.preRunStageLine', {
        status: cmd.status,
        stage: cmd.stage,
        command: cmd.command,
        exit,
        duration,
      })}`);
      if (cmd.error) {
        console.log(`    ${cmd.error}`);
      }
    }
    for (const line of pre_run.diagnostics) {
      console.log(`  ⚠️  ${line}`);
    }
    for (const line of pre_run.suggestions) {
      console.log(`  💡 ${line}`);
    }
  }

  if (data.sandbox.mode !== 'off' || data.sandbox.status !== 'skipped') {
    console.log('\n🧪 verify sandbox');
    console.log(`  ${t(locale, 'verify.sandboxSummary', {
      mode: data.sandbox.mode,
      status: data.sandbox.status,
      isolated: String(data.sandbox.isolated),
      writeDenied: String(data.sandbox.workspace_write_denied),
    })}`);
    if (data.sandbox.diagnostics.length > 0) {
      for (const line of data.sandbox.diagnostics) {
        console.log(`  ⚠️  ${line}`);
      }
    }
    if (data.sandbox.infos && data.sandbox.infos.length > 0) {
      for (const line of data.sandbox.infos) {
        console.log(`  ℹ️  ${line}`);
      }
    }
    if (data.sandbox.suggestions.length > 0) {
      for (const line of data.sandbox.suggestions) {
        console.log(`  💡 ${line}`);
      }
    }
  }

  if (gate.result !== 'PASS') {
    process.exit(1);
  }

  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      const slug = guard.activeChange;
      if (slug) {
        const proposalDir = join(root, 'logos', 'changes', slug);
        const deployTasks = existsSync(proposalDir) ? getDeployTasks(proposalDir) : [];
        if (deployTasks.length > 0) {
          console.log(`📦 ${t(locale, 'verify.deployTasksTitle')}`);
          for (const task of deployTasks) {
            const icon = task.checked ? 'x' : ' ';
            console.log(`  - [${icon}] ${task.text}`);
          }
          console.log(`\n⚠️  ${t(locale, 'verify.deployHumanGate')}`);
          console.log(`${t(locale, 'verify.deployAiHint')}\n`);
        }
      }
    } catch { /* guard 文件读取失败时静默跳过 */ }
  }
  } finally {
    resultLocks.release();
  }
}
