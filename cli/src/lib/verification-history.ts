/**
 * 验收历史留存与读取（verification-history，功能规格 §2.104，spec/test-results.md「验收历史留存（verification-history）」）。
 *
 * 三层数据：
 * ① 中央索引 `logos/resources/verify/history/<run_id>.json`：只含结构化白名单字段（显式构造，不透传任意对象，不含自由文本）；
 * ② 有活跃提案时的提案运行目录 `logos/changes/<slug>/verify-runs/<run_id>/`：record.json、results.jsonl、report.md；
 * ③ `verify.history.raw_in_proposal: false` 时的本机原文 `logos/.openlogos-runtime/verify-runs/<run_id>/`：report.md、results-raw.jsonl。
 *
 * 写入由 CLI 主进程在结果采集之后完成，不经过沙箱；写入失败只体现在返回的 history 元数据（write_status / write_error），
 * 不抛出、不改变调用方的门禁与退出码。CLI 不执行任何 git 写操作（只读取 HEAD 与工作区是否有改动）。
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from './json-output.js';

export const HISTORY_SCHEMA = 'openlogos/verification-run@1' as const;
export const HISTORY_INDEX_DIR = 'logos/resources/verify/history';
export const PROPOSAL_RUNS_DIR = 'verify-runs';
export const LOCAL_RAW_DIR = 'logos/.openlogos-runtime/verify-runs';

/** 结果行中保留在「去掉自由文本」视图里的结构化字段（§2.104.2）。 */
export const STRUCTURED_RESULT_FIELDS = ['id', 'status', 'scenario', 'timestamp', 'duration_ms', 'environment', 'target_environment'] as const;

export type HistoryKind = 'verify' | 'smoke';
export type HistoryOutcome = 'completed' | 'aborted';
export type RawLocation = 'proposal' | 'local' | 'none';

export type HistoryLevel = 'proposal' | 'release';

/** 运行所在平台标识：`<process.platform>-<process.arch>`（如 darwin-arm64）。 */
export function currentPlatform(): string {
  return `${process.platform}-${process.arch}`;
}

export interface HistoryCounts {
  defined: number | null;
  executed: number | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  uncovered: number | null;
}

/** 中央索引记录（闭合字段，§2.104.3）。 */
export interface VerificationRun {
  schema: typeof HISTORY_SCHEMA;
  run_id: string;
  kind: HistoryKind;
  started_at: string;
  finished_at: string;
  outcome: HistoryOutcome;
  gate: { result: 'PASS' | 'FAIL' | null; reason: string | null };
  error_code: string | null;
  proposal: { slug: string; run_dir: string } | null;
  module_scope: string[] | null;
  verify_mode: 'slice-checkpoint' | 'final' | null;
  attempted_slice_id: string | null;
  environment: string | null;
  deploy_id: string | null;
  counts: HistoryCounts;
  failed_ids: string[];
  skipped_ids: string[];
  uncovered_ids: string[];
  /**
   * verify-flaky-rerun（§2.104.3）：verify 判为偶发的用例 ID（字典序）。0.16.26 起的 verify 记录恒写入（无偶发为空数组），
   * smoke 记录不写；读取时缺失的 verify 记录按空数组补齐，存在但不是字符串数组时整条按损坏记录跳过。
   */
  flaky_ids?: string[];
  /**
   * layered-verification（§2.104.3）：verify 的验收级别与运行所在平台（`<process.platform>-<process.arch>`）。
   * 0.16.27 起的 verify 记录恒写入，smoke 记录不写；读取时缺少 `level` 的 verify 记录按 "proposal"、缺少 `platform` 的按 null 补齐，
   * 存在但取值非法时整条按损坏记录跳过。
   */
  level?: HistoryLevel;
  platform?: string | null;
  /** verify-self-sufficient-cases（§2.104.3 修改）：none = 环境预检类原因判 FAIL，既未执行命令也未读取结果。 */
  result_source: 'executed' | 'reused' | 'none';
  commit: { head: string | null; dirty: boolean | null };
  cli_version: string;
  raw_location: RawLocation;
}

export interface HistoryWriteError { code: 'verification_history_write_failed'; layer: 'index' | 'proposal' | 'local'; path: string }

/** verify / smoke 输出中的 history 元数据（`data.history` 或 `error.details.history`）。 */
export interface HistoryMeta {
  run_id: string;
  index_path: string;
  run_dir: string | null;
  raw_location: RawLocation;
  write_status: 'written' | 'failed';
  write_error?: HistoryWriteError;
}

export interface HistoryRunContext {
  root: string;
  runId: string;
  kind: HistoryKind;
  startedAt: string;
  proposal: { slug: string; dir: string } | null;
  rawInProposal: boolean;
}

/** 本次运行的结束事实（由调用方从结构化数据取值）。 */
export interface HistoryFinish {
  outcome: HistoryOutcome;
  gate: { result: 'PASS' | 'FAIL' | null; reason: string | null };
  errorCode: string | null;
  moduleScope: string[] | null;
  verifyMode: 'slice-checkpoint' | 'final' | null;
  attemptedSliceId: string | null;
  environment?: string | null;
  deployId?: string | null;
  counts: Partial<HistoryCounts>;
  failedIds?: string[];
  skippedIds?: string[];
  uncoveredIds?: string[];
  /** verify-flaky-rerun：偶发用例 ID（只对 verify 记录写入）。 */
  flakyIds?: string[];
  /** layered-verification：验收级别（只对 verify 记录写入；缺省 proposal）。 */
  level?: HistoryLevel;
  /** layered-verification：发布级验收在执行前固定的提交身份；给出时不在写入时重新读取 HEAD。 */
  commit?: { head: string | null; dirty: boolean | null };
  resultSource: 'executed' | 'reused' | 'none';
  /** 本次实际采集的结果文件（项目根相对）；不存在或未采集时为 null。 */
  resultPath: string | null;
  /**
   * 采集时取得的结果字节（code-r1 F3）：调用方在结果采集当时读取并传入，历史写入不再二次读取。
   * `{ bytes }` 为本轮结果；`{ error }` 为读取失败（不发布冒充完整结果的空文件，并报告 write_error）；
   * 省略或 null 表示本轮已知没有结果文件。
   */
  resultCapture?: ResultCapture | null;
  /** 本次最终报告的字节（渲染时保留在内存中的同一份，不从共用路径回读）；早退时为 null。 */
  reportBytes: string | null;
}

export type ResultCapture = { bytes: string } | { error: string };

/** 在结果采集当时读取结果文件字节；读取失败返回 error（区分「已知无结果」与「读取失败」）。 */
export function captureResultBytes(root: string, resultPath: string | null): ResultCapture | null {
  if (!resultPath) return null;
  const abs = join(root, resultPath);
  if (!existsSync(abs)) return null;
  try { return { bytes: readFileSync(abs, 'utf-8') }; } catch (e) { return { error: (e as Error).message }; }
}

function pad(n: number, w = 2): string { return String(n).padStart(w, '0'); }

/** `<YYYYMMDDTHHMMSSmmmZ>-<kind>-<6 位小写十六进制>`。 */
export function generateRunId(kind: HistoryKind, now: Date = new Date()): string {
  const ts = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}${pad(now.getUTCMilliseconds(), 3)}Z`;
  return `${ts}-${kind}-${randomBytes(3).toString('hex')}`;
}

export function readRawInProposal(root: string): boolean {
  try {
    const cfg = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8')) as { verify?: { history?: { raw_in_proposal?: unknown } } };
    const v = cfg.verify?.history?.raw_in_proposal;
    return typeof v === 'boolean' ? v : true;
  } catch {
    return true;
  }
}

export function readActiveProposal(root: string): { slug: string; dir: string } | null {
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (!existsSync(guardPath)) return null;
  try {
    const slug = (JSON.parse(readFileSync(guardPath, 'utf-8')) as { activeChange?: unknown }).activeChange;
    if (typeof slug !== 'string' || !slug) return null;
    const dir = join(root, 'logos', 'changes', slug);
    return existsSync(dir) ? { slug, dir } : null;
  } catch {
    return null;
  }
}

/**
 * 开启一次运行（通过前置检查之后、首个截断或读取之前调用）。`opts.withoutProposal` 为 true 时不归属活跃提案
 * （smoke 版本上下文不读写任何提案文件，§14.3），只写中央索引。
 */
export function startHistoryRun(root: string, kind: HistoryKind, opts: { withoutProposal?: boolean } = {}): HistoryRunContext {
  return {
    root,
    runId: generateRunId(kind),
    kind,
    startedAt: new Date().toISOString(),
    proposal: opts.withoutProposal ? null : readActiveProposal(root),
    rawInProposal: readRawInProposal(root),
  };
}

/** 只读取 HEAD 与工作区是否有改动；非 git 项目或 git 不可用时为 null。 */
function readCommit(root: string): { head: string | null; dirty: boolean | null } {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8', timeout: 10_000 });
  if (head.status !== 0 || !head.stdout.trim()) return { head: null, dirty: null };
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf-8', timeout: 30_000 });
  return { head: head.stdout.trim(), dirty: status.status === 0 ? status.stdout.trim().length > 0 : null };
}

/** 只保留合法的字符串用例 ID（code-r1 F5：reporter 行的类型错误值不进入随 Git 共享的中央索引）。 */
const sortedIds = (ids: unknown[] | undefined): string[] =>
  [...new Set((ids ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0))].sort();

function rawLocationOf(ctx: HistoryRunContext): RawLocation {
  if (!ctx.proposal) return 'none';
  return ctx.rawInProposal ? 'proposal' : 'local';
}

/** 显式构造中央索引记录：只从白名单字段取值，不透传任意对象。 */
export function buildRunRecord(ctx: HistoryRunContext, finish: HistoryFinish, commit = readCommit(ctx.root)): VerificationRun {
  const c = finish.counts;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    schema: HISTORY_SCHEMA,
    run_id: ctx.runId,
    kind: ctx.kind,
    started_at: ctx.startedAt,
    finished_at: new Date().toISOString(),
    outcome: finish.outcome,
    gate: {
      result: finish.gate.result === 'PASS' || finish.gate.result === 'FAIL' ? finish.gate.result : null,
      reason: typeof finish.gate.reason === 'string' ? finish.gate.reason : null,
    },
    error_code: typeof finish.errorCode === 'string' ? finish.errorCode : null,
    proposal: ctx.proposal ? { slug: ctx.proposal.slug, run_dir: `${PROPOSAL_RUNS_DIR}/${ctx.runId}` } : null,
    module_scope: finish.moduleScope ? sortedIds(finish.moduleScope) : null,
    verify_mode: finish.verifyMode === 'slice-checkpoint' || finish.verifyMode === 'final' ? finish.verifyMode : null,
    attempted_slice_id: typeof finish.attemptedSliceId === 'string' ? finish.attemptedSliceId : null,
    environment: typeof finish.environment === 'string' ? finish.environment : null,
    deploy_id: typeof finish.deployId === 'string' ? finish.deployId : null,
    counts: {
      defined: num(c.defined), executed: num(c.executed), passed: num(c.passed),
      failed: num(c.failed), skipped: num(c.skipped), uncovered: num(c.uncovered),
    },
    failed_ids: sortedIds(finish.failedIds),
    skipped_ids: sortedIds(finish.skippedIds),
    uncovered_ids: sortedIds(finish.uncoveredIds),
    ...(ctx.kind === 'verify' ? { flaky_ids: sortedIds(finish.flakyIds) } : {}),
    ...(ctx.kind === 'verify' ? { level: finish.level === 'release' ? 'release' as const : 'proposal' as const, platform: currentPlatform() } : {}),
    result_source: finish.resultSource === 'executed' ? 'executed' : finish.resultSource === 'none' ? 'none' : 'reused',
    commit: { head: commit.head, dirty: commit.dirty },
    cli_version: VERSION,
    raw_location: rawLocationOf(ctx),
  };
}

/** 结构化字段的值类型契约：id / status / scenario / timestamp 为字符串，duration_ms 为有限数，环境字段为字符串或 null。 */
function structuredValueOk(key: string, value: unknown): boolean {
  switch (key) {
    case 'id': case 'status': case 'scenario': case 'timestamp': return typeof value === 'string';
    case 'duration_ms': return typeof value === 'number' && Number.isFinite(value);
    case 'environment': case 'target_environment': return value === null || typeof value === 'string';
    default: return false;
  }
}

/** 把结果文件拆为「结构化视图」与「自由文本」两份（按用例 ID 对应）。无法解析的行只进入自由文本份。 */
export function splitResultLines(content: string): { structured: string; raw: string } {
  const structured: string[] = [];
  const raw: string[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let row: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(line) as unknown;
      row = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch { row = null; }
    if (!row) { raw.push(JSON.stringify({ raw_line: line })); continue; }
    const keep: Record<string, unknown> = {};
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      // 白名单字段还须值类型合法（code-r1 F5）；类型不符的值连同自由文本一起归入本机原文层
      if ((STRUCTURED_RESULT_FIELDS as readonly string[]).includes(k) && structuredValueOk(k, v)) keep[k] = v;
      else rest[k] = v;
    }
    structured.push(JSON.stringify(keep));
    if (Object.keys(rest).length > 0) raw.push(JSON.stringify({ id: typeof row.id === 'string' ? row.id : null, ...rest }));
  }
  return { structured: structured.length ? `${structured.join('\n')}\n` : '', raw: raw.length ? `${raw.join('\n')}\n` : '' };
}

/**
 * 写一次运行的全部历史层。永不抛出：任一层失败记入 write_error（取第一处失败），其余层照常尝试。
 */
export function writeHistoryRun(ctx: HistoryRunContext, finish: HistoryFinish): HistoryMeta {
  const indexRel = `${HISTORY_INDEX_DIR}/${ctx.runId}.json`;
  const runDirRel = ctx.proposal ? `logos/changes/${ctx.proposal.slug}/${PROPOSAL_RUNS_DIR}/${ctx.runId}` : null;
  const meta: HistoryMeta = {
    run_id: ctx.runId,
    index_path: indexRel,
    run_dir: runDirRel,
    raw_location: rawLocationOf(ctx),
    write_status: 'written',
  };
  const fail = (layer: HistoryWriteError['layer'], path: string) => {
    if (meta.write_status === 'failed') return;
    meta.write_status = 'failed';
    meta.write_error = { code: 'verification_history_write_failed', layer, path };
  };
  let record: VerificationRun;
  try {
    record = finish.commit ? buildRunRecord(ctx, finish, finish.commit) : buildRunRecord(ctx, finish);
  } catch {
    fail('index', indexRel);
    return meta;
  }
  const recordJson = `${JSON.stringify(record, null, 2)}\n`;

  try {
    mkdirSync(join(ctx.root, HISTORY_INDEX_DIR), { recursive: true });
    writeFileSync(join(ctx.root, indexRel), recordJson, { flag: 'wx' });
  } catch {
    fail('index', HISTORY_INDEX_DIR);
  }

  if (!ctx.proposal || !runDirRel) return meta;
  // 结果字节取自采集当时（code-r1 F3）：读取失败不发布空的 results.jsonl 冒充完整结果，并报告 write_error；
  // 已知无结果文件时不写 results.jsonl
  const capture = finish.resultCapture ?? null;
  const captureFailed = capture !== null && 'error' in capture;
  const resultsContent = capture !== null && 'bytes' in capture ? capture.bytes : null;
  const split = ctx.rawInProposal || resultsContent === null ? null : splitResultLines(resultsContent);
  try {
    const dir = join(ctx.root, runDirRel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'record.json'), recordJson);
    if (resultsContent !== null) writeFileSync(join(dir, 'results.jsonl'), split ? split.structured : resultsContent);
    if (ctx.rawInProposal && finish.reportBytes !== null) writeFileSync(join(dir, 'report.md'), finish.reportBytes);
  } catch {
    fail('proposal', runDirRel);
  }
  if (captureFailed) fail('proposal', `${runDirRel}/results.jsonl`);
  if (!ctx.rawInProposal) {
    const localRel = `${LOCAL_RAW_DIR}/${ctx.runId}`;
    try {
      const dir = join(ctx.root, localRel);
      mkdirSync(dir, { recursive: true });
      if (split) writeFileSync(join(dir, 'results-raw.jsonl'), split.raw);
      if (finish.reportBytes !== null) writeFileSync(join(dir, 'report.md'), finish.reportBytes);
    } catch {
      fail('local', localRel);
    }
  }
  return meta;
}

/**
 * 测试专用暂停点（UT-S19-107、UT-S13-147）：只有设置 OPENLOGOS_TEST_HISTORY_PAUSE_AFTER_REPORT 时生效——写完共用报告后创建
 * `<值>.paused`，等待 `<值>` 出现（最长 60 秒）后再写报告快照与历史。生产路径不设置该变量，零开销。
 */
export function testPauseAfterReport(): void {
  const flag = process.env.OPENLOGOS_TEST_HISTORY_PAUSE_AFTER_REPORT;
  if (!flag) return;
  try { writeFileSync(`${flag}.paused`, ''); } catch { return; }
  const deadline = Date.now() + 60_000;
  const cell = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(flag) && Date.now() < deadline) Atomics.wait(cell, 0, 0, 50);
}

/** history 元数据的一行文本提示（verify / smoke 文本输出）。 */
export function historyTextLine(meta: HistoryMeta, locale: string): string {
  const zh = locale === 'zh';
  if (meta.write_status === 'failed') {
    const where = meta.write_error ? `${meta.write_error.layer}: ${meta.write_error.path}` : meta.index_path;
    return zh ? `⚠️  验收历史写入失败（${where}），门禁结论不受影响` : `⚠️  Failed to write verification history (${where}); the gate result is unaffected`;
  }
  return zh ? `🗂  验收历史：${meta.index_path}` : `🗂  Verification history: ${meta.index_path}`;
}

// ── 读取 ─────────────────────────────────────────────────────────────────────

export interface HistoryWarning { code: 'verification_history_corrupt'; path: string; message: string }

const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';
const isNumOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStrArray = (v: unknown) => Array.isArray(v) && v.every(isStr);

/** 按 §2.104.3 校验全部必填字段及其类型（含嵌套对象与数组元素，code-r1 F2）；不合格即视为损坏。 */
function validRecord(value: unknown, fileRunId: string): value is VerificationRun {
  if (!isObj(value)) return false;
  const v = value;
  if (v.schema !== HISTORY_SCHEMA || v.run_id !== fileRunId) return false;
  if (v.kind !== 'verify' && v.kind !== 'smoke') return false;
  if (!isStr(v.started_at) || !isStr(v.finished_at)) return false;
  if (v.outcome !== 'completed' && v.outcome !== 'aborted') return false;
  if (!isObj(v.gate) || !(v.gate.result === 'PASS' || v.gate.result === 'FAIL' || v.gate.result === null) || !isStrOrNull(v.gate.reason)) return false;
  if (!isStrOrNull(v.error_code)) return false;
  if (!(v.proposal === null || (isObj(v.proposal) && isStr(v.proposal.slug) && isStr(v.proposal.run_dir)))) return false;
  if (!(v.module_scope === null || isStrArray(v.module_scope))) return false;
  if (!(v.verify_mode === null || v.verify_mode === 'slice-checkpoint' || v.verify_mode === 'final')) return false;
  if (!isStrOrNull(v.attempted_slice_id) || !isStrOrNull(v.environment) || !isStrOrNull(v.deploy_id)) return false;
  if (!isObj(v.counts) || !['defined', 'executed', 'passed', 'failed', 'skipped', 'uncovered'].every(k => isNumOrNull((v.counts as Record<string, unknown>)[k]))) return false;
  if (!isStrArray(v.failed_ids) || !isStrArray(v.skipped_ids) || !isStrArray(v.uncovered_ids)) return false;
  // verify-flaky-rerun：flaky_ids 可选；存在时必须是字符串数组
  if ('flaky_ids' in v && !isStrArray(v.flaky_ids)) return false;
  // layered-verification：level / platform 可选；存在时取值必须合法
  if ('level' in v && v.level !== 'proposal' && v.level !== 'release') return false;
  if ('platform' in v && !isStrOrNull(v.platform)) return false;
  if (v.result_source !== 'executed' && v.result_source !== 'reused' && v.result_source !== 'none') return false;
  if (!isObj(v.commit) || !isStrOrNull(v.commit.head) || !(v.commit.dirty === null || typeof v.commit.dirty === 'boolean')) return false;
  if (!isStr(v.cli_version)) return false;
  return v.raw_location === 'proposal' || v.raw_location === 'local' || v.raw_location === 'none';
}

/** 读取全部中央索引记录（started_at 倒序，同刻按 run_id 倒序）；损坏文件跳过并给出警告。 */
export function readAllRuns(root: string): { runs: VerificationRun[]; warnings: HistoryWarning[] } {
  const dir = join(root, HISTORY_INDEX_DIR);
  const runs: VerificationRun[] = [];
  const warnings: HistoryWarning[] = [];
  if (!existsSync(dir)) return { runs, warnings };
  let names: string[] = [];
  try {
    if (!statSync(dir).isDirectory()) return { runs, warnings };
    names = readdirSync(dir).filter(n => n.endsWith('.json')).sort();
  } catch { return { runs, warnings }; }
  for (const name of names) {
    const rel = `${HISTORY_INDEX_DIR}/${name}`;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as unknown;
      if (validRecord(parsed, name.slice(0, -'.json'.length))) {
        // verify-flaky-rerun：0.16.26 之前的 verify 记录没有 flaky_ids，读取时按空数组补齐
        if (parsed.kind === 'verify' && parsed.flaky_ids === undefined) parsed.flaky_ids = [];
        // layered-verification：0.16.27 之前的 verify 记录没有 level / platform，读取时按 proposal / null 补齐
        if (parsed.kind === 'verify' && parsed.level === undefined) parsed.level = 'proposal';
        if (parsed.kind === 'verify' && parsed.platform === undefined) parsed.platform = null;
        runs.push(parsed);
      }
      else warnings.push({ code: 'verification_history_corrupt', path: rel, message: 'missing or invalid required fields' });
    } catch {
      warnings.push({ code: 'verification_history_corrupt', path: rel, message: 'not valid JSON' });
    }
  }
  runs.sort((a, b) => (a.started_at === b.started_at ? b.run_id.localeCompare(a.run_id) : b.started_at.localeCompare(a.started_at)));
  return { runs, warnings };
}

export interface FullRecordLocation { path: string; results_path: string; report_path: string | null }

/** 按 run_id 在活动提案与归档提案的运行目录中精确查找完整记录。 */
export function locateFullRecord(root: string, run: VerificationRun): FullRecordLocation | null {
  if (!run.proposal) return null;
  const slug = run.proposal.slug;
  const candidates: string[] = [`logos/changes/${slug}/${PROPOSAL_RUNS_DIR}/${run.run_id}`];
  const archiveDir = join(root, 'logos', 'changes', 'archive');
  if (existsSync(archiveDir)) {
    try {
      for (const name of readdirSync(archiveDir).sort().reverse()) {
        if (name.endsWith(`-${slug}`)) candidates.push(`logos/changes/archive/${name}/${PROPOSAL_RUNS_DIR}/${run.run_id}`);
      }
    } catch { /* 归档目录不可读 */ }
  }
  for (const rel of candidates) {
    const abs = join(root, rel);
    if (!existsSync(join(abs, 'results.jsonl')) && !existsSync(join(abs, 'record.json'))) continue;
    return {
      path: rel,
      results_path: `${rel}/results.jsonl`,
      report_path: existsSync(join(abs, 'report.md')) ? `${rel}/report.md` : null,
    };
  }
  return null;
}

export function locateLocalRaw(root: string, run: VerificationRun): { path: string } | null {
  const rel = `${LOCAL_RAW_DIR}/${run.run_id}`;
  return existsSync(join(root, rel)) ? { path: rel } : null;
}
