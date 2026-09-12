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
import { VERIFY_PASS_MARKER } from '../lib/proposal-markers.js';
import { TABLE_CELL_ID_RE, VERIFICATION_ID_RE, MANUAL_MARKER_RE } from '../lib/test-id.js';

export interface TestResult {
  id: string;
  status: 'pass' | 'fail' | 'skip';
  duration_ms?: number;
  timestamp?: string;
  error?: string;
  scenario?: string;
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
const CHECKLIST_PATTERN = /^- \[([ x])\] (.+)$/gm;
const AC_TABLE_HEADER = /^## 四、验收条件追溯$/m;
const AC_ROW_PATTERN = /^\|\s*(S\d{2}-AC-\d{2,3})\s*\|([^|]*)\|([^|]*)\|/gm;

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
}

export interface VerifyPreRunData {
  mode: VerifyPreRunMode;
  commands: Array<VerifyPreRunCommandResult & {
    sandbox?: SandboxData;
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
  return merged;
}

export function runVerifyPreRunWithSandbox(root: string, config: NormalizedVerifyConfig, format: OutputFormat): RunVerifyPreRunResult {
  const preRun = buildInitialPreRunData(config);
  const sandboxConfig = config.sandbox ?? normalizeSandboxConfig({ sandbox_mode: 'auto' });
  let sandbox = buildInitialSandboxData(sandboxConfig);
  const allowPaths = new Set<string>([
    config.resultPath,
    'logos/resources/verify/acceptance-report.md',
  ]);
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
    const stageResult = executeVerifyCommand(root, 'pre_run', config.preRunCommand, format, sandboxConfig, allowedWritePaths);
    const normalized = toPreRunCommandResult('pre_run', config.preRunCommand, stageResult.command, stageResult.sandbox);
    preRun.commands.push(normalized);
    sandbox = mergeSandboxStatus(sandbox, stageResult.sandbox);
    if (normalized.status === 'fail' && format !== 'json') {
      console.warn('\n⚠️  verify pre_run command exited with non-zero status. Continuing verify with existing results.');
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
    const stageResult = executeVerifyCommand(root, stage, command, format, sandboxConfig, allowedWritePaths);
    const normalized = toPreRunCommandResult(stage, command, stageResult.command, stageResult.sandbox);
    preRun.commands.push(normalized);
    sandbox = mergeSandboxStatus(sandbox, stageResult.sandbox);
    if (normalized.status === 'fail' && format !== 'json') {
      console.warn(`\n⚠️  verify ${stage} command exited with non-zero status. Continuing verify with existing results.`);
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

function applySmokePrecheck(root: string, data: VerifyData): VerifyData {
  const smokeConfig = readSmokeCommandConfig(root);
  const check = checkSmokeCoverage(root, {
    command: smokeConfig.command,
    resultPath: smokeConfig.resultPath,
  });
  data.smoke_precheck = check;
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
): string {
  const now = new Date().toISOString().slice(0, 10);
  let md = `# Acceptance Report\n\n> Generated by \`openlogos verify\` on ${now}\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
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
  if (sliceVerification?.verify_mode) {
    md += `## Slice Verification\n\n`;
    md += `- Mode: \`${sliceVerification.verify_mode}\`\n`;
    md += `- Attempted slice: ${sliceVerification.attempted_slice_id ? `\`${sliceVerification.attempted_slice_id}\`` : '`null`'}\n`;
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

export function collectVerifyData(
  root: string,
  preRun?: VerifyPreRunData,
  sliceVerification?: SliceVerificationState | null,
): VerifyData {
  const config = readVerifyConfig(root);
  const resultPath = config.resultPath;

  const fullResultPath = join(root, resultPath);
  const parsedResults = parseJsonlWithDiagnostics(readFileSync(fullResultPath, 'utf-8'));
  const allResults = parsedResults.results;
  const fullIndex = extractDefinedIndex(root);
  const defined = sliceVerification?.manifest_status === 'valid' && sliceVerification.verify_mode
    ? sliceVerification.eligible_test_ids
    : fullIndex.ids;
  const utCount = defined.filter(id => id.startsWith('UT-')).length;
  const stCount = defined.filter(id => id.startsWith('ST-')).length;
  const { manualCount, manualIds } = fullIndex;
  const definedSet = new Set(defined);
  const fullDefinedSet = new Set(fullIndex.ids);
  const manualSet = new Set(manualIds);
  const unknownResultIds: string[] = [];
  const manualResultIds: string[] = [];
  const outsideEligibleResultIds: string[] = [];
  for (const result of allResults) {
    if (definedSet.has(result.id)) continue;
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

  const resultIds = new Set(results.map(r => r.id));
  const passed = results.filter(r => r.status === 'pass');
  const failed = results.filter(r => r.status === 'fail');
  const skipped = results.filter(r => r.status === 'skip');
  const uncovered = defined.filter(id => !resultIds.has(id));
  const coveredCount = defined.filter(id => resultIds.has(id)).length;

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
    executed_count: allResults.filter(result => !manualSet.has(result.id)).length,
    passed_count: passed.length,
    failed_count: failed.length,
    skipped_count: skipped.length,
    uncovered_count: uncovered.length,
    coverage_pct: coveragePct,
    pass_rate_pct: passRatePct,
  };
  const countMismatches = buildVerifyCountMismatches(summary, { covered_count: coveredCount, results_count: results.length });
  const consistency = buildVerifyConsistency({
    invalidResults: parsedResults.invalidResults,
    unknownResultIds,
    manualResultIds,
    outsideEligibleResultIds,
    countMismatches: countMismatches,
    countMismatchDetails: buildCountMismatchDetails(summary, countMismatches, { covered_count: coveredCount, results_count: results.length }),
  });


  // §2.75.1：Gate 判据收敛为三项——账本一致性、零失败、零未覆盖。
  // 设计时覆盖度清单（Layer1）与 AC 追溯矩阵（Layer3）是「人声称覆盖了」，不再参与放行；
  // 「规格声明的 ID 集合 ⊆ 结果 ID 集合」（uncovered）是不可替代的那一条，完整保留。
  const isPass = consistency.ok && failed.length === 0 && uncovered.length === 0;
  const gateResult = isPass ? 'PASS' as const : 'FAIL' as const;

  let gateReason: string | null = null;
  if (!isPass) {
    if (!consistency.ok) gateReason = 'result_ledger_inconsistent';
    else if (failed.length > 0) gateReason = 'failed_cases';
    else gateReason = 'incomplete_coverage';
  }

  const reportPath = join(root, REPORT_DIR, 'acceptance-report.md');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, generateReport(
    defined, results, passed, failed, skipped, uncovered,
    String(coveragePct), String(passRatePct), gateResult, resultIds, manualCount,
    sliceVerification,
  ));

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
  });
  applySmokePrecheck(root, data);

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

function activeSliceVerification(root: string): {
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
    });
    return state ? { proposalDir, state } : null;
  } catch {
    return null;
  }
}

function stopForSliceManifestState(
  format: OutputFormat,
  state: SliceVerificationState,
): never {
  const reason = state.reason ?? 'test-slice-manifest-invalid';
  const data = { reason, slice_verification_state: state };
  if (format === 'json') console.log(JSON.stringify(makeEnvelope('verify', data)));
  else {
    console.error(`✖ verify 暂停：${reason}`);
    for (const item of state.violations ?? []) console.error(`  - [${item.code}] ${item.path}: ${item.message}`);
  }
  process.exit(reason === 'test-slice-manifest-unsupported' || reason === 'test-slice-assignment-ambiguous' ? 1 : 2);
  throw new Error('unreachable');
}

export function verify(format: OutputFormat = 'text') {
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

  const sliceContext = activeSliceVerification(root);
  if (sliceContext && (sliceContext.state.manifest_status !== 'valid' || !sliceContext.state.verify_mode)) {
    stopForSliceManifestState(format, sliceContext.state);
  }
  const sliceVerification = sliceContext?.state ?? null;

  const config = readVerifyConfig(root);
  const resultPath = config.resultPath;
  const previousEligible = process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS;
  if (sliceVerification?.eligible_test_ids) {
    process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS = JSON.stringify(sliceVerification.eligible_test_ids);
  }
  let preRunResult: RunVerifyPreRunResult;
  try {
    preRunResult = runVerifyPreRunWithSandbox(root, config, format);
  } finally {
    if (previousEligible === undefined) delete process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS;
    else process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS = previousEligible;
  }
  const preRun = preRunResult.preRun;
  const sandbox = preRunResult.sandbox;

  const fullResultPath = join(root, resultPath);
  ensureResultFileWhenPreRunFailed(fullResultPath, preRun);

  if (!existsSync(fullResultPath)) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'verify', 'NO_TEST_RESULTS', `No test results found at ${resultPath}.`,
      )));
      process.exit(1);
    }
    console.error(`\nError: ${t(locale, 'verify.noResults', { path: resultPath })}`);
    process.exit(1);
  }

  const { ids: defined } = extractDefinedIds(root);
  if (defined.length === 0) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'verify', 'NO_TEST_CASES', 'No test case specs found in logos/resources/test/.',
      )));
      process.exit(1);
    }
    console.error(`\nError: ${t(locale, 'verify.noCases')}`);
    process.exit(1);
  }

  const data = collectVerifyData(root, preRun, sliceVerification);
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

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('verify', data)));
    if (data.gate.result !== 'PASS') {
      process.exit(1);
    }
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

  if (gate.result === 'PASS') {
    console.log(`\n✅ ${t(locale, 'verify.gatePass')}`);
  } else if (gate.reason === 'result_ledger_inconsistent') {
    console.log('\n❌ Gate 3.5: FAIL (result ledger inconsistent)');
  } else if (gate.reason === 'failed_cases') {
    console.log(`\n❌ ${t(locale, 'verify.gateFail')}`);
  } else {
    // §2.75.1：收敛后仅剩 incomplete_coverage 一种未列举原因
    console.log(`\n❌ ${t(locale, 'verify.gateFailCoverage')}`);
  }

  console.log(`\n📄 ${t(locale, 'verify.reportPath', { path: data.report_path })}\n`);

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
}
