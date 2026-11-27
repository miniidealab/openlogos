/**
 * verify-flaky-rerun：失败用例复跑与偶发判定（功能规格 §2.108；spec/test-results.md「失败用例复跑与偶发」）。
 *
 * 预跑命令全部执行完、结果读取之后、门禁计算之前：
 * 1. 按 §2.108.3 的顺序判断是否复跑（命中第一条即不复跑，并给出 skipped_reason）；
 * 2. 复跑集合 R = 失败 ∩ 规格内 UT/ST ∩ 本轮应执行集合（§2.108.4）；
 * 3. 首跑快照：每个 ID 的生效记录及其来源（产生它的命令组与阶段），以及首跑的非法行（§2.108.5 第 1 条）；
 * 4. 每个用例只分派给其生效记录的来源，在首跑保留的同一执行环境内复跑一次；复跑前清空该来源结果路径、结束后立即采集；
 * 5. 以快照为底合并：R 外取快照，R 内只采信其来源本次采集（不比较 timestamp）；非法行按原文保留到最终门禁（§2.108.6）；
 * 6. 命令组改判（§2.108.7）。
 */
import { existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { removeTree } from './fs-remove.js';
import { join } from 'node:path';
import { t, type Locale } from '../i18n.js';
import type { OutputFormat } from './json-output.js';
import {
  releaseRetainedExecution,
  rerunInRetainedExecution,
  safeWriteResultFile,
  type NormalizedSandboxConfig,
  type RetainedExecution,
  type SandboxData,
} from './sandbox.js';
import type { NormalizedRerunFailedConfig } from './verify-config.js';
import { DEFAULT_RERUN_FAILED_ENABLED, DEFAULT_RERUN_FAILED_MAX_CASES } from './verify-config.js';
import { moduleIdsOf, testFileModule } from './verify-scope.js';
import { readStrictSkipSet } from './verify-skip-classification.js';
import { TABLE_CELL_ID_RE, MANUAL_MARKER_RE } from './test-id.js';
import {
  parseJsonlWithDiagnostics,
  selectEffectiveResult,
  type TestResult,
  type VerifyPreRunData,
  type VerifyPreRunStage,
} from '../commands/verify.js';

export type RerunSkippedReason =
  | 'precheck_failed'
  | 'disabled'
  | 'no_command'
  | 'gate_blocked'
  | 'no_failed_cases'
  | 'too_many_failures'
  | 'sandbox_unavailable';

export interface VerifyRerunCommandData {
  stage: VerifyPreRunStage;
  modules: string[] | null;
  ids: string[];
  first_exit_code: number | null;
  rerun_exit_code: number | null;
  skipped_reason: 'sandbox_unavailable' | null;
  status_after: 'pass' | 'fail';
}

export interface VerifyRerunData {
  attempted: boolean;
  skipped_reason: RerunSkippedReason | null;
  max_cases: number;
  requested_ids: string[];
  commands: VerifyRerunCommandData[];
}

export interface VerifyFlakyCase {
  id: string;
  module: string | null;
  first_error: string | null;
}

/** 首跑的一个结果来源：一个命令组的一段（单阶段 pre_run，或两阶段的一段）。 */
export interface RerunSource {
  stage: VerifyPreRunStage;
  command: string;
  modules: string[] | null;
  /** 在 pre_run.commands[] 中的下标。 */
  commandIndex: number;
  /** 该来源写入的结果路径（项目根相对）。 */
  resultPath: string;
  /** 首跑结束时立即采集的该来源输出。 */
  content: string;
  /** 首跑所用执行环境（verify-flaky-rerun：保留到复跑决策结束）。 */
  retained?: RetainedExecution;
  /** 首跑时注入的附加变量（如 OPENLOGOS_VERIFY_MODULES），复跑保持首跑取值。 */
  extraEnv?: Record<string, string>;
}

export interface RerunOutcome {
  rerun: VerifyRerunData;
  flaky: VerifyFlakyCase[];
  /** 复跑后改判为通过的命令组在 pre_run.commands[] 中的下标（§2.108.7）。 */
  overriddenCommandIndexes: Set<number>;
  /** 复跑执行产生的沙箱数据（未执行时为空数组），由调用方并入本次沙箱状态。 */
  sandboxResults: SandboxData[];
  /**
   * code-r2 F1：结果路径的受保护写回被拒绝时，门禁改用的账本内容（首跑快照：首跑生效记录 + 首跑非法行原文）；
   * 正常写回或未进入执行阶段时不出现，门禁照常读取 result_path。
   */
  ledgerOverride?: string;
}

const RERUN_ENV = 'OPENLOGOS_VERIFY_RERUN';
const ELIGIBLE_ENV = 'OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS';
/** 测试替身：复跑开始前丢弃首跑保留的沙箱副本，模拟「首跑执行环境无法继续使用」（UT-S13-216）。 */
const TEST_DISCARD_ENV = 'OPENLOGOS_TEST_RERUN_DISCARD_SANDBOX';
const CASE_ID_RE = /^(UT|ST)-/;

/**
 * 测试替身（只在设置对应环境变量时生效）：在复跑开始前篡改首跑保留的副本，模拟 EX-13.27 的各类「无法继续使用」——
 * OPENLOGOS_TEST_RERUN_DISCARD_SANDBOX=1 删除副本；OPENLOGOS_TEST_RERUN_SANDBOX_TAMPER=escape 在副本内放一条逃逸链接；
 * =unsafe-result-path 把副本内的结果路径换成指向 OPENLOGOS_TEST_RERUN_TAMPER_TARGET 的链接；
 * =unsafe-workspace-result-path 把工作区内的结果路径换成指向该目标的链接；=not-a-directory 把副本目录换成普通文件；
 * =old-writer 由 sandbox 模拟旧写入者仍在。
 */
function applyTestTamper(root: string, source: RerunSource): void {
  const tamper = process.env.OPENLOGOS_TEST_RERUN_SANDBOX_TAMPER;
  const target = process.env.OPENLOGOS_TEST_RERUN_TAMPER_TARGET;
  if (tamper === 'unsafe-workspace-result-path' && target) {
    try {
      const at = join(root, source.resultPath);
      removeTree(at);
      symlinkSync(target, at);
    } catch { /* 测试替身 */ }
  }
  const handle = source.retained;
  if (!handle || (handle.kind !== 'one-off' && handle.kind !== 'persistent')) return;
  try {
    if (process.env[TEST_DISCARD_ENV]) removeTree(handle.projectRoot);
    if (tamper === 'not-a-directory') {
      removeTree(handle.projectRoot);
      writeFileSync(handle.projectRoot, 'not a directory');
    }
    if (tamper === 'escape') symlinkSync('/', join(handle.projectRoot, 'rr-escape-link'));
    if (tamper === 'unsafe-result-path' && target) {
      const at = join(handle.projectRoot, source.resultPath);
      removeTree(at);
      symlinkSync(target, at);
    }
  } catch { /* 测试替身 */ }
}

export function rerunConfigOf(config: { rerunFailed?: NormalizedRerunFailedConfig }): NormalizedRerunFailedConfig {
  return config.rerunFailed ?? { enabled: DEFAULT_RERUN_FAILED_ENABLED, maxCases: DEFAULT_RERUN_FAILED_MAX_CASES, invalid: [] };
}

export function skippedRerun(reason: RerunSkippedReason, maxCases: number, requested: string[] = []): VerifyRerunData {
  return { attempted: false, skipped_reason: reason, max_cases: maxCases, requested_ids: requested, commands: [] };
}

interface LedgerRow { result: TestResult; raw: string; line: number }

export interface ParsedLedger {
  /** 每个 ID 的生效记录（既有去重规则），按首次出现顺序。 */
  effective: Map<string, LedgerRow>;
  /** 非法行原文（按行序）。 */
  invalidRaw: string[];
  /** 全部合法记录的 ID 集合（含被去重覆盖的）。 */
  ids: Set<string>;
}

/** 解析结果账本并保留每行原文：合法性判定与去重沿用 verify 的既有实现（parseJsonlWithDiagnostics / selectEffectiveResult）。 */
export function parseLedger(content: string): ParsedLedger {
  const groups = new Map<string, Array<LedgerRow & { timestamp?: string }>>();
  const invalidRaw: string[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const parsed = parseJsonlWithDiagnostics(raw);
    if (parsed.results.length !== 1) {
      invalidRaw.push(raw);
      continue;
    }
    const result = parsed.results[0];
    const rows = groups.get(result.id) ?? [];
    rows.push({ result, raw, line: i + 1, timestamp: result.timestamp });
    groups.set(result.id, rows);
  }
  const effective = new Map<string, LedgerRow>();
  for (const [id, rows] of groups) {
    const best = selectEffectiveResult(rows);
    effective.set(id, { result: best.result, raw: best.raw, line: best.line });
  }
  return { effective, invalidRaw, ids: new Set(groups.keys()) };
}

/** 用例 ID → 所属模块（测试规格文件名前缀，已登记模块 id 最长匹配；不带前缀的为 null）。 */
export function caseModuleIndex(root: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const dir = join(root, 'logos/resources/test');
  if (!existsSync(dir)) return out;
  const moduleIds = moduleIdsOf(root);
  const files = readdirSync(dir, { recursive: true }).map(f => String(f)).filter(f => f.endsWith('-test-cases.md')).sort();
  for (const file of files) {
    const owner = testFileModule(file, moduleIds);
    for (const line of readFileSync(join(dir, file), 'utf-8').split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      const firstCell = (line.split('|').map(cell => cell.trim())[1]) ?? '';
      if (!TABLE_CELL_ID_RE.test(firstCell)) continue;
      const id = firstCell.replace(MANUAL_MARKER_RE, '').replace(/\s+/g, ' ').trim();
      if (!out.has(id)) out.set(id, owner);
    }
  }
  return out;
}

/**
 * 来源归属（§2.108.5 第 2 条）：按来源顺序（即合并后文件的行序）把每个来源采集中的合法记录连同来源下标排成一列，
 * 按 ID 分组后用既有去重规则（selectEffectiveResult）选出胜出记录，返回 ID → { 来源下标, 原文 }。
 */
export function attributeSources(sources: Array<{ content: string }>): Map<string, { source: number; raw: string }> {
  const groups = new Map<string, Array<{ source: number; raw: string; timestamp?: string }>>();
  sources.forEach((source, index) => {
    for (const line of source.content.split('\n')) {
      const raw = line.trim();
      if (!raw) continue;
      const parsed = parseJsonlWithDiagnostics(raw);
      if (parsed.results.length !== 1) continue;
      const result = parsed.results[0];
      const rows = groups.get(result.id) ?? [];
      rows.push({ source: index, raw, timestamp: result.timestamp });
      groups.set(result.id, rows);
    }
  });
  const out = new Map<string, { source: number; raw: string }>();
  for (const [id, rows] of groups) {
    const best = selectEffectiveResult(rows);
    out.set(id, { source: best.source, raw: best.raw });
  }
  return out;
}

export interface PerformRerunParams {
  root: string;
  config: { resultPath: string; rerunFailed?: NormalizedRerunFailedConfig; sandbox: NormalizedSandboxConfig };
  preRun: VerifyPreRunData;
  sources: RerunSource[];
  /** 规格中定义的自动化用例（不含人工用例）。 */
  definedIds: string[];
  /** 本轮应执行集合；null 表示全部规格内用例。 */
  roundIds: Set<string> | null;
  locale: Locale;
  format: OutputFormat;
  allowedWritePaths: string[];
}

function pushDiagnostic(preRun: VerifyPreRunData, line: string): void {
  if (!preRun.diagnostics.includes(line)) preRun.diagnostics.push(line);
}

/**
 * 判断是否复跑、执行复跑并合并结果（§2.108.3～§2.108.7）。无论是否复跑，返回前都会释放全部来源保留的执行环境。
 * 合并结果（复跑执行过时）写回 result_path：合并后的有效记录 + 首跑与复跑中的非法行原文。
 */
export function performFailedRerun(params: PerformRerunParams): RerunOutcome {
  const { root, config, preRun, sources, locale } = params;
  const cfg = rerunConfigOf(config);
  const outcome: RerunOutcome = {
    rerun: skippedRerun('disabled', cfg.maxCases),
    flaky: [],
    overriddenCommandIndexes: new Set(),
    sandboxResults: [],
  };
  try {
    // §2.108.3 第 2 条
    if (!cfg.enabled) return outcome;
    // 第 3 条：本次没有执行任何预跑命令（未配置、只读取既有结果，或命令未能执行）
    const executed = preRun.commands.some(cmd => cmd.status !== 'skipped' && cmd.duration_ms !== undefined);
    if (!executed) {
      outcome.rerun = skippedRerun('no_command', cfg.maxCases);
      return outcome;
    }
    // 第 4 条：test_change_set_invalid
    if (readStrictSkipSet(root).state === 'invalid') {
      outcome.rerun = skippedRerun('gate_blocked', cfg.maxCases);
      return outcome;
    }
    // 第 5 条：归一化结果中没有 fail 的规格内 UT/ST（含测试入口回滚了账本）
    const fullPath = join(root, config.resultPath);
    const ledger = parseLedger(existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : '');
    const defined = new Set(params.definedIds);
    const requested = Array.from(ledger.effective.values())
      .filter(row => row.result.status === 'fail')
      .map(row => row.result.id)
      .filter(id => CASE_ID_RE.test(id) && defined.has(id) && (params.roundIds === null || params.roundIds.has(id)))
      .sort();
    if (requested.length === 0) {
      outcome.rerun = skippedRerun('no_failed_cases', cfg.maxCases);
      return outcome;
    }
    // 第 6 条
    if (requested.length > cfg.maxCases) {
      outcome.rerun = skippedRerun('too_many_failures', cfg.maxCases, requested);
      return outcome;
    }

    // §2.108.5 第 2 条：每个用例只分派给其生效记录的来源
    // code-r1 F5：来源随每条原始有效记录保留，在全部来源的记录上一次完成既有去重（与合并后文件同一行序、同一全序规则），
    // 直接使用胜出记录的来源——不再用各来源各自去重后的原文反查（局部去重与全局去重可以选出不同的记录）
    const winners = attributeSources(sources);
    const assignment = new Map<number, string[]>();
    const unattributed: string[] = [];
    for (const id of requested) {
      const winner = winners.get(id);
      const owner = winner && winner.raw === ledger.effective.get(id)!.raw ? winner.source : -1;
      if (owner < 0) { unattributed.push(id); continue; }
      const list = assignment.get(owner) ?? [];
      list.push(id);
      assignment.set(owner, list);
    }
    if (unattributed.length > 0) pushDiagnostic(preRun, t(locale, 'verify.rerunUnattributed', { ids: unattributed.join(', ') }));
    if (assignment.size === 0) {
      outcome.rerun = skippedRerun('no_command', cfg.maxCases, requested);
      return outcome;
    }

    // 执行：按命令顺序逐个来源复跑一次
    const merged = new Map(ledger.effective);
    const flakyIds = new Set<string>();
    const noPass: string[] = [];
    const notNarrowed = new Set<string>();
    const rerunInvalid: string[] = [];
    const commands: VerifyRerunCommandData[] = [];
    const commandIndexOf = new Map<VerifyRerunCommandData, number>();
    let anyExecuted = false;
    const order = Array.from(assignment.keys()).sort((a, b) => sources[a].commandIndex - sources[b].commandIndex);
    for (const index of order) {
      const source = sources[index];
      const ids = assignment.get(index)!;
      const first = preRun.commands[source.commandIndex];
      const firstStatus: 'pass' | 'fail' = first?.status === 'fail' ? 'fail' : 'pass';
      const entry: VerifyRerunCommandData = {
        stage: source.stage,
        modules: source.modules ? [...source.modules] : null,
        ids: [...ids],
        first_exit_code: first?.exit_code ?? null,
        rerun_exit_code: null,
        skipped_reason: null,
        status_after: firstStatus,
      };
      commandIndexOf.set(entry, source.commandIndex);
      applyTestTamper(root, source);
      let ran: ReturnType<typeof rerunInRetainedExecution>;
      try {
        ran = rerunInRetainedExecution(source.retained, {
          root,
          command: source.command,
          format: params.format,
          sandbox: config.sandbox,
          allowedWritePaths: params.allowedWritePaths,
          extraEnv: { ...(source.extraEnv ?? {}), [ELIGIBLE_ENV]: JSON.stringify(ids), [RERUN_ENV]: '1' },
          resetPaths: [source.resultPath],
        });
      } catch (error) {
        // code-r2 F2：复跑执行环境的任何异常都按该来源不可用处理，不中断验收（用例维持失败）
        ran = { ok: false, reason: `rerun execution environment error: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (!ran.ok) {
        // §2.108.5 第 4 条：同一副本确实无法继续使用——不复跑、不新建副本、不退回工作区；用例维持失败
        entry.skipped_reason = 'sandbox_unavailable';
        pushDiagnostic(preRun, t(locale, 'verify.rerunSandboxUnavailable', { reason: ran.reason, ids: ids.join(', ') }));
        commands.push(entry);
        continue;
      }
      anyExecuted = true;
      outcome.sandboxResults.push(ran.result.sandbox);
      entry.rerun_exit_code = ran.result.command.exit_code ?? null;
      // §2.108.5 第 5 条：本次采集即该来源的复跑输出；新记录以采集边界判定，不比较 timestamp
      const capturePath = join(root, source.resultPath);
      const capture = parseLedger(existsSync(capturePath) ? readFileSync(capturePath, 'utf-8') : '');
      rerunInvalid.push(...capture.invalidRaw);
      const idSet = new Set(ids);
      for (const id of capture.ids) if (!idSet.has(id)) notNarrowed.add(id);
      for (const id of ids) {
        const row = capture.effective.get(id);
        if (row && row.result.status === 'pass') {
          merged.set(id, row);
          flakyIds.add(id);
        } else if (row && row.result.status === 'fail') {
          merged.set(id, row);
        } else {
          noPass.push(id);
        }
      }
      // §2.108.7：首跑非零退出、子集非空、复跑零退出且子集全部偶发 → 改判为通过；其余取首跑状态
      const commandPassed = ran.result.command.status === 'pass' && entry.rerun_exit_code === 0;
      if (firstStatus === 'fail' && ids.length > 0 && commandPassed && ids.every(id => flakyIds.has(id))) {
        entry.status_after = 'pass';
        outcome.overriddenCommandIndexes.add(source.commandIndex);
      }
      commands.push(entry);
    }

    if (noPass.length > 0) pushDiagnostic(preRun, t(locale, 'verify.rerunNoPass', { ids: noPass.join(', ') }));
    if (notNarrowed.size > 0) pushDiagnostic(preRun, t(locale, 'verify.rerunNotNarrowed', { ids: Array.from(notNarrowed).sort().join(', ') }));
    if (rerunInvalid.length > 0) pushDiagnostic(preRun, t(locale, 'verify.rerunInvalidLines', { count: String(rerunInvalid.length) }));

    {
      // §2.108.6：写回合并后的有效记录，并按原文保留首跑与复跑中的非法行。进入执行阶段即写回（不论是否真正执行）：
      // 复跑准备阶段可能已清空过结果路径，未执行时合并结果就是首跑快照，保证首跑记录不因被拒绝的复跑而丢失
      // code-r2 F1：与清空共用受保护的原子写入；路径或父链被拒绝时不经该路径写盘，复跑结果一律不采信，
      // 门禁改用已采集的首跑快照完成判定
      const lines = [...Array.from(merged.values()).map(row => row.raw), ...ledger.invalidRaw, ...rerunInvalid];
      try {
        safeWriteResultFile(root, config.resultPath, lines.length > 0 ? `${lines.join('\n')}\n` : '');
      } catch (error) {
        const snapshot = [...Array.from(ledger.effective.values()).map(row => row.raw), ...ledger.invalidRaw];
        outcome.ledgerOverride = snapshot.length > 0 ? `${snapshot.join('\n')}\n` : '';
        flakyIds.clear();
        outcome.overriddenCommandIndexes.clear();
        for (const entry of commands) {
          const first = preRun.commands[commandIndexOf.get(entry) ?? -1];
          entry.status_after = first?.status === 'fail' ? 'fail' : 'pass';
        }
        pushDiagnostic(preRun, t(locale, 'verify.rerunWriteBackRefused', {
          path: config.resultPath, reason: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    const modules = flakyIds.size > 0 ? caseModuleIndex(root) : new Map<string, string | null>();
    outcome.flaky = Array.from(flakyIds).sort().map(id => ({
      id,
      module: modules.get(id) ?? null,
      first_error: ledger.effective.get(id)?.result.error ?? null,
    }));
    outcome.rerun = {
      attempted: anyExecuted,
      skipped_reason: anyExecuted ? null : 'sandbox_unavailable',
      max_cases: cfg.maxCases,
      requested_ids: requested,
      commands,
    };
    return outcome;
  } finally {
    for (const source of sources) releaseRetainedExecution(source.retained);
  }
}
