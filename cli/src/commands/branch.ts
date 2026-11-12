/**
 * `openlogos branch`（spec/branch-sync.md；来源变更 branch-sync-generated-files，场景 S44）。
 *
 * 命令组：
 * - `sync`：把主分支同步进当前分支——同步处置清单内的文件取主分支版本，登记表对照共同起点逐条合并，
 *   剩余冲突如实列出（结果 conflicts 时退出码 2，合并现场保留）。
 * - `status`：只读输出当前分支、主分支及其来源、共同起点、落后与领先的提交数。
 * 文案见交互设计「S44: 提案分支同步主分支 — 交互规格」，JSON 形态见 spec/cli-json-output.md
 * 「`openlogos branch sync|status --format json`」。
 */
import { readLocale, t, type Locale } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope, type OutputFormat } from '../lib/json-output.js';
import {
  BranchError, readBranchStatus, runBranchSync, type BaseSource, type BranchStatusData, type BranchSyncData, type BranchSyncHooks,
} from '../lib/branch-sync.js';

export interface BranchCliOptions {
  /** `--base <ref>`；出现但缺值时为空串（按解析不到提交拒绝，不折叠成「未传」） */
  base?: string;
}

const USAGE = 'Usage: openlogos branch <sync|status> [--base <ref>]';
const sha8 = (commit: string): string => commit.slice(0, 8);

function sourceLabel(locale: Locale, source: BaseSource | string): string {
  return t(locale, `branch.source.${source}`);
}

/** 文案变量中的结构化取值（来源、原因、进行中的操作）以当前语言展示；JSON 的结构化字段不受影响。 */
function localizedVars(locale: Locale, vars: Record<string, string>): Record<string, string> {
  const out = { ...vars };
  for (const key of ['source', 'reason', 'operation'] as const) {
    if (out[key] !== undefined) out[key] = t(locale, `branch.${key}.${out[key]}`);
  }
  return out;
}

export async function branchCommand(
  action: string | undefined, format: OutputFormat, opts: BranchCliOptions, hooks: BranchSyncHooks = {},
): Promise<void> {
  const root = process.cwd();
  const locale = readLocale(root);
  if (action !== 'status' && action !== 'sync') {
    console.error(`Error: ${action === undefined ? t(locale, 'branch.error.missingAction') : t(locale, 'branch.error.unknownAction', { action })}`);
    console.error(USAGE);
    process.exit(1);
  }
  const command = `branch ${action}`;
  try {
    if (action === 'status') {
      outputStatus(format, locale, readBranchStatus(root, opts.base));
      return;
    }
    const data = runBranchSync(root, opts.base, locale, hooks);
    outputSync(format, locale, data);
    // 仍有冲突：命令本身执行成功，结果在 stdout，退出码 2
    if (data.result === 'conflicts') process.exit(2);
  } catch (error) {
    if (!(error instanceof BranchError)) throw error;
    const message = t(locale, error.messageKey, localizedVars(locale, error.vars));
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(command, error.code, message, error.details ? { details: error.details } : undefined)));
    } else {
      console.error(`Error: [${error.code}] ${message}`);
    }
    process.exit(1);
  }
}

function outputStatus(format: OutputFormat, locale: Locale, data: BranchStatusData): void {
  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('branch status', data)));
    return;
  }
  console.log(data.branch === null
    ? t(locale, 'branch.status.currentDetached', { sha: sha8(data.head) })
    : t(locale, 'branch.status.current', { name: data.branch, sha: sha8(data.head) }));
  console.log(t(locale, 'branch.status.base', {
    ref: data.base.ref, sha: sha8(data.base.commit), source: sourceLabel(locale, data.base.source),
  }));
  console.log(t(locale, 'branch.status.mergeBase', { sha: sha8(data.merge_base) }));
  console.log(t(locale, 'branch.status.counts', { behind: String(data.behind), ahead: String(data.ahead) }));
  console.log(data.up_to_date
    ? t(locale, 'branch.status.upToDate', { ref: data.base.ref })
    : t(locale, 'branch.status.syncHint'));
}

function outputSync(format: OutputFormat, locale: Locale, data: BranchSyncData): void {
  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('branch sync', data)));
    return;
  }
  const say = (key: string, vars?: Record<string, string>): void => console.log(t(locale, key, vars));
  say('branch.sync.title', { ref: data.base.ref, sha: sha8(data.base.commit), source: sourceLabel(locale, data.base.source) });
  if (data.branch === null) say('branch.sync.branchDetached', { sha: sha8(data.merge_base) });
  else say('branch.sync.branch', { name: data.branch, sha: sha8(data.merge_base) });
  if (data.result === 'up-to-date') {
    say('branch.sync.upToDate', { ref: data.base.ref });
    return;
  }

  console.log('');
  say('branch.sync.listHeading');
  if (data.replaced.length === 0) say('branch.sync.listNone');
  for (const item of data.replaced) say(item.action === 'took-base' ? 'branch.sync.tookBase' : 'branch.sync.deleted', { path: item.path });

  say('branch.sync.registryHeading', { path: data.registry.path });
  switch (data.registry.status) {
    case 'merged': say('branch.sync.registryMerged'); break;
    case 'not-needed': say('branch.sync.registryNotNeeded'); break;
    case 'skipped': say('branch.sync.registrySkipped', { reason: t(locale, `branch.skip.${data.registry.reason}`) }); break;
    case 'conflict':
      say('branch.sync.registryConflict');
      for (const c of data.registry.conflicts) {
        console.log(`      ${c.key === null ? c.field : `${c.field} / ${c.key}`}${t(locale, 'branch.sync.colon')}${t(locale, `branch.kind.${c.kind}`)}`);
      }
      break;
  }
  if (data.registry.index_backfilled > 0) say('branch.sync.indexBackfilled', { n: String(data.registry.index_backfilled) });
  for (const c of data.registry.counters) {
    if (c.both_advanced) console.log(`  ⚠ ${t(locale, 'branch.sync.counterBothAdvanced', { counter: c.name, ours: String(c.ours), theirs: String(c.theirs), merged: String(c.merged) })}`);
  }

  say('branch.sync.markersHeading');
  if (data.invalidated_markers.length === 0) say('branch.sync.markersNone');
  for (const m of data.invalidated_markers) say('branch.sync.markersCleared', { slug: m.slug, markers: m.markers.join(', ') });

  console.log('');
  if (data.result === 'synced') {
    say(data.fast_forward ? 'branch.sync.syncedFastForward' : 'branch.sync.synced', { sha: sha8(data.head_after) });
    say('branch.sync.reverifyHint');
    return;
  }
  say('branch.sync.conflictsRemain', { n: String(data.remaining_conflicts.length) });
  for (const c of data.remaining_conflicts) {
    say('branch.sync.conflictLine', { category: t(locale, `branch.category.${c.category}`), path: c.path, reason: t(locale, `branch.conflictReason.${c.reason}`) });
  }
  say('branch.sync.conflictsNext');
  if (data.remaining_conflicts.some(c => c.reason !== 'git-conflict')) say('branch.sync.trustThisCommand');
}
