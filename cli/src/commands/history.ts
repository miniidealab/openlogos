/**
 * `openlogos history list|show`（verification-history，功能规格 §2.104.10，
 * spec/cli-json-output.md「`openlogos history` 命令组与 verify / smoke 的 history 字段（verification-history）」）。
 *
 * 只读：读取中央索引 `logos/resources/verify/history/`，按 run_id 在活动 / 归档提案运行目录与本机原文目录中定位完整记录。
 */
import { readLocale } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope, type OutputFormat } from '../lib/json-output.js';
import {
  locateFullRecord, locateLocalRaw, readAllRuns,
  type HistoryWarning, type VerificationRun,
} from '../lib/verification-history.js';

const USAGE = [
  'Usage:',
  '  openlogos history list [--kind verify|smoke] [--slug <slug>] [--result pass|fail|aborted] [--module <id>] [--limit <n>] [--format json]',
  '  openlogos history show <run_id> [--format json]',
].join('\n');

interface ListOptions { kind?: string; slug?: string; result?: string; module?: string; limit: number }

function usageError(json: boolean, message: string): never {
  if (json) console.error(JSON.stringify(makeErrorEnvelope('history', 'INVALID_ARGUMENT', message)));
  else console.error(`Error: ${message}\n${USAGE}`);
  process.exit(2);
}

function parseListOptions(rest: string[], json: boolean): ListOptions {
  const opts: ListOptions = { limit: 20 };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    const need = () => {
      if (value === undefined || value.startsWith('--')) usageError(json, `${flag} requires a value`);
      i += 1;
      return value;
    };
    if (flag === '--kind') {
      const v = need();
      if (v !== 'verify' && v !== 'smoke') usageError(json, '--kind must be verify or smoke');
      opts.kind = v;
    } else if (flag === '--slug') opts.slug = need();
    else if (flag === '--result') {
      const v = need();
      if (v !== 'pass' && v !== 'fail' && v !== 'aborted') usageError(json, '--result must be pass, fail or aborted');
      opts.result = v;
    } else if (flag === '--module') opts.module = need();
    else if (flag === '--limit') {
      const v = Number(need());
      if (!Number.isInteger(v) || v <= 0) usageError(json, '--limit must be a positive integer');
      opts.limit = v;
    } else usageError(json, `unknown option: ${flag}`);
  }
  return opts;
}

function matches(run: VerificationRun, o: ListOptions): boolean {
  if (o.kind && run.kind !== o.kind) return false;
  if (o.slug && run.proposal?.slug !== o.slug) return false;
  if (o.result === 'pass' && run.gate.result !== 'PASS') return false;
  if (o.result === 'fail' && run.gate.result !== 'FAIL') return false;
  if (o.result === 'aborted' && run.outcome !== 'aborted') return false;
  if (o.module && !(run.module_scope ?? []).includes(o.module)) return false;
  return true;
}

function resultLabel(run: VerificationRun): string {
  return run.outcome === 'aborted' ? `ABORTED(${run.error_code ?? '-'})` : (run.gate.result ?? '-');
}

function printWarnings(warnings: HistoryWarning[]): void {
  for (const w of warnings) console.error(`⚠️  ${w.code}: ${w.path} (${w.message})`);
}

function list(rest: string[], json: boolean, zh: boolean): void {
  const opts = parseListOptions(rest, json);
  const { runs, warnings } = readAllRuns(process.cwd());
  const filtered = runs.filter(run => matches(run, opts));
  const shown = filtered.slice(0, opts.limit);
  if (json) {
    console.log(JSON.stringify(makeEnvelope('history list', { runs: shown, total: filtered.length, warnings })));
    return;
  }
  printWarnings(warnings);
  if (shown.length === 0) {
    console.log(zh ? '没有匹配的验收历史。' : 'No matching verification history.');
    return;
  }
  for (const run of shown) {
    const failed = run.failed_ids.length;
    const slug = run.proposal?.slug ?? '-';
    console.log(`${run.started_at}  ${run.kind.padEnd(6)}  ${slug}  ${resultLabel(run)}  ${zh ? '失败用例' : 'failed'}: ${failed}  ${run.run_id}`);
  }
  if (filtered.length > shown.length) {
    console.log(zh ? `（共 ${filtered.length} 条，已显示 ${shown.length} 条）` : `(${filtered.length} total, showing ${shown.length})`);
  }
}

function show(rest: string[], json: boolean, zh: boolean): void {
  const runId = rest.find(a => !a.startsWith('--'));
  if (!runId) usageError(json, 'history show requires <run_id>');
  const root = process.cwd();
  const { runs, warnings } = readAllRuns(root);
  const run = runs.find(r => r.run_id === runId);
  if (!run) {
    const message = `Verification run not found: ${runId}`;
    if (json) console.error(JSON.stringify(makeErrorEnvelope('history show', 'HISTORY_RUN_NOT_FOUND', message)));
    else console.error(`Error: ${message}`);
    process.exit(1);
  }
  const full = locateFullRecord(root, run);
  const raw = run.raw_location === 'local' ? locateLocalRaw(root, run) : null;
  const unavailableReason = run.proposal ? (full ? null : 'not_found_locally') : 'no_proposal';
  const data = {
    run,
    full_record: full ?? 'unavailable',
    raw: run.raw_location === 'local' ? (raw ?? 'unavailable') : null,
    unavailable_reason: unavailableReason,
    warnings,
  };
  if (json) {
    console.log(JSON.stringify(makeEnvelope('history show', data)));
    return;
  }
  printWarnings(warnings);
  console.log(`run_id: ${run.run_id}`);
  console.log(`${zh ? '类型' : 'kind'}: ${run.kind}  ${zh ? '结论' : 'result'}: ${resultLabel(run)}  ${zh ? '原因' : 'reason'}: ${run.gate.reason ?? '-'}`);
  console.log(`${zh ? '时间' : 'time'}: ${run.started_at} → ${run.finished_at}`);
  console.log(`${zh ? '提案' : 'proposal'}: ${run.proposal?.slug ?? '-'}  ${zh ? '模式' : 'mode'}: ${run.verify_mode ?? '-'}  ${zh ? '结果来源' : 'result source'}: ${run.result_source}`);
  if (run.environment) console.log(`${zh ? '环境' : 'environment'}: ${run.environment}  deploy_id: ${run.deploy_id ?? '-'}`);
  const c = run.counts;
  console.log(`${zh ? '计数' : 'counts'}: defined=${c.defined ?? '-'} executed=${c.executed ?? '-'} passed=${c.passed ?? '-'} failed=${c.failed ?? '-'} skipped=${c.skipped ?? '-'} uncovered=${c.uncovered ?? '-'}`);
  if (run.failed_ids.length) console.log(`${zh ? '失败用例' : 'failed'}: ${run.failed_ids.join(', ')}`);
  if (run.flaky_ids?.length) console.log(`${zh ? '偶发用例' : 'flaky'}: ${run.flaky_ids.join(', ')}`);
  if (run.uncovered_ids.length) console.log(`${zh ? '未覆盖' : 'uncovered'}: ${run.uncovered_ids.join(', ')}`);
  console.log(`${zh ? '提交' : 'commit'}: ${run.commit.head ?? '-'}${run.commit.dirty ? ' (dirty)' : ''}`);
  if (full) {
    console.log(`${zh ? '完整记录' : 'full record'}: ${full.path}`);
    if (full.report_path) console.log(`${zh ? '报告快照' : 'report snapshot'}: ${full.report_path}`);
  } else {
    console.log(zh
      ? `完整记录：不可用（${unavailableReason === 'no_proposal' ? '本次运行没有活跃提案' : '本机找不到提案运行目录'}）`
      : `full record: unavailable (${unavailableReason === 'no_proposal' ? 'no active proposal for this run' : 'proposal run directory not found locally'})`);
  }
  if (run.raw_location === 'local') console.log(`${zh ? '本机原文' : 'local raw'}: ${raw ? raw.path : (zh ? '不可用' : 'unavailable')}`);
}

export function historyCommand(args: string[], format: OutputFormat = 'text'): void {
  const json = format === 'json';
  const zh = readLocale(process.cwd()) === 'zh';
  const sub = args[0];
  const rest = stripFormat(args.slice(1));
  if (sub === 'list') return list(rest, json, zh);
  if (sub === 'show') return show(rest, json, zh);
  usageError(json, sub ? `unknown subcommand: ${sub}` : 'missing subcommand');
}

function stripFormat(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--format') { i += 1; continue; }
    if (args[i].startsWith('--format=')) continue;
    out.push(args[i]);
  }
  return out;
}
