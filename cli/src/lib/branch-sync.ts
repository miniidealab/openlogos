/**
 * 提案分支同步主分支（spec/branch-sync.md；来源变更 branch-sync-generated-files，场景 S44）。
 *
 * 本文件承载 `openlogos branch` 两个子命令：主分支的确定（§3）、共同起点与落后 / 领先计数（§10），
 * 以及 `branch sync` 的同步处置清单（§4）、登记表合并的接入（§5）、合并方式（§7.5）、剩余冲突（§8）
 * 与标记失效（§9）。全部通过调用本机 git 完成，不引入 git 库、不联网；`branch status` 不写任何文件。
 */
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, writeFileSync, type Stats,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { t, type Locale } from '../i18n.js';
import { acquireLock, findUnfinalizedJournal, isSafeModuleId, releaseLock } from './baseline-seed-txn.js';
import { removeTree } from './fs-remove.js';
import { exemptEntryInvalidReason, exemptEntryMatches } from './guard-scope-config.js';
import { AMEND_INVALIDATED_MARKERS } from './merge-baseline.js';
import { moduleReportPath, normalizeRelPath, registeredModules, SHARED_REPORT_PATHS, VERIFY_REPORT_DIR } from './module-phase-report.js';
import { readProjectYaml } from './project-yaml.js';
import {
  assertRenderedRegistry, mergeRegistry, parseRegistry, registryShapeSupported, renderMergedRegistry,
  type RegistryConflict, type RegistryCounter, type RegistryMergeOutcome, type RegistryRecord,
} from './registry-merge.js';
import { syncResourceIndex } from './sync-resource-index.js';
import { normalizeVerifyConfig, readVerifyConfig } from './verify-config.js';

export type BaseSource = 'flag' | 'config' | 'remote-default';

export interface BaseBranch {
  /** 解析所用的引用原文 */
  ref: string;
  source: BaseSource;
  /** 40 位 commit */
  commit: string;
}

export interface BranchStatusData {
  /** HEAD 分离时为 null */
  branch: string | null;
  head: string;
  base: BaseBranch;
  merge_base: string;
  /** 主分支有而本分支没有的提交数 */
  behind: number;
  /** 本分支有而主分支没有的提交数 */
  ahead: number;
  up_to_date: boolean;
}

/** 稳定错误码 + i18n 文案键；文案由命令层按 locale 渲染。 */
export class BranchError extends Error {
  constructor(
    readonly code: string,
    readonly messageKey: string,
    readonly vars: Record<string, string> = {},
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

const SHA_RE = /^[0-9a-f]{40}$/;

export function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string; spawnFailed: boolean } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return {
    ok: r.status === 0,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
    spawnFailed: r.error !== undefined,
  };
}

/** 引用解析为 40 位 commit；拒绝空值与以 `-` 开头的值（不让引用被 git 当作选项解析）。 */
export function resolveCommit(cwd: string, ref: string): string | null {
  if (ref.trim() === '' || ref.startsWith('-')) return null;
  const r = git(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  return r.ok && SHA_RE.test(r.stdout) ? r.stdout : null;
}

/** §7.3 前两项：项目已初始化、在 git 仓库内且 git 可用。 */
export function assertProjectAndRepo(root: string): void {
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) {
    throw new BranchError('PROJECT_NOT_INITIALIZED', 'branch.error.projectNotInitialized');
  }
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout !== 'true') {
    throw new BranchError('BRANCH_NOT_GIT_REPO', 'branch.error.notGitRepo');
  }
}

/** 读取 `branch_sync.base_branch` 的原值；配置缺失或不可解析时为 undefined（未给出该来源）。 */
function readConfiguredBaseBranch(root: string): unknown {
  try {
    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8')) as Record<string, unknown> | null;
    const section = config?.branch_sync;
    if (section === null || typeof section !== 'object' || Array.isArray(section)) return undefined;
    return (section as Record<string, unknown>).base_branch;
  } catch {
    return undefined;
  }
}

/** 远端 origin 的默认分支（`refs/remotes/origin/HEAD` 指向的远端跟踪分支），如 `origin/main`。 */
function remoteDefaultRef(root: string): string | null {
  const r = git(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  const prefix = 'refs/remotes/';
  if (!r.ok || !r.stdout.startsWith(prefix)) return null;
  const short = r.stdout.slice(prefix.length);
  return short === '' ? null : short;
}

/**
 * 主分支的确定（§3）：`--base` → `branch_sync.base_branch` → 远端 origin 的默认分支。
 * 排在前面的来源一旦给出就不再回落：它解析不到提交时直接报错。
 */
export function resolveBaseBranch(root: string, flagBase: string | undefined): BaseBranch {
  let ref: string;
  let source: BaseSource;
  const configured = readConfiguredBaseBranch(root);
  if (flagBase !== undefined) {
    ref = flagBase;
    source = 'flag';
  } else if (configured !== undefined) {
    // 写出了该字段即视为给出了来源；非字符串或空串按「解析不到提交」处理，不回落到远端默认分支
    ref = typeof configured === 'string' ? configured : '';
    source = 'config';
  } else {
    const remote = remoteDefaultRef(root);
    if (remote === null) throw new BranchError('BRANCH_BASE_UNRESOLVED', 'branch.error.baseUndetermined');
    ref = remote;
    source = 'remote-default';
  }
  const commit = resolveCommit(root, ref);
  if (commit === null) {
    throw new BranchError('BRANCH_BASE_UNRESOLVED', 'branch.error.baseRefUnresolved', { ref, source });
  }
  return { ref, source, commit };
}

/** 共同起点（`git merge-base`）；HEAD 无提交或两条分支没有共同起点时报 BRANCH_NO_MERGE_BASE。 */
export function resolveHeadAndMergeBase(root: string, base: BaseBranch): { head: string; mergeBase: string } {
  const head = resolveCommit(root, 'HEAD');
  if (head === null) throw new BranchError('BRANCH_NO_MERGE_BASE', 'branch.error.noMergeBase', { ref: base.ref });
  const mb = git(root, ['merge-base', head, base.commit]);
  if (!mb.ok || !SHA_RE.test(mb.stdout)) {
    throw new BranchError('BRANCH_NO_MERGE_BASE', 'branch.error.noMergeBase', { ref: base.ref });
  }
  return { head, mergeBase: mb.stdout };
}

/** 当前分支名；HEAD 分离时为 null。 */
export function currentBranch(root: string): string | null {
  const r = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return r.ok && r.stdout !== '' ? r.stdout : null;
}

/**
 * `branch status`（§10）：只读。不检查工作区是否干净、不取锁、不过恢复门、不预测冲突。
 */
export function readBranchStatus(root: string, flagBase: string | undefined): BranchStatusData {
  assertProjectAndRepo(root);
  const base = resolveBaseBranch(root, flagBase);
  const { head, mergeBase } = resolveHeadAndMergeBase(root, base);
  const counts = git(root, ['rev-list', '--left-right', '--count', `${head}...${base.commit}`]);
  const m = /^(\d+)\s+(\d+)$/.exec(counts.stdout);
  if (!counts.ok || !m) throw new BranchError('BRANCH_NO_MERGE_BASE', 'branch.error.noMergeBase', { ref: base.ref });
  const ahead = Number(m[1]);
  const behind = Number(m[2]);
  return {
    branch: currentBranch(root),
    head,
    base,
    merge_base: mergeBase,
    behind,
    ahead,
    up_to_date: behind === 0,
  };
}

/* ─────────────────────────── branch sync（§4～§9） ─────────────────────────── */

export const REGISTRY_REL = 'logos/logos-project.yaml';
const CONFIG_REL = 'logos/logos.config.json';
const VERIFY_DIR_PREFIX = `${VERIFY_REPORT_DIR}/`;
const CHANGES_REL = 'logos/changes';

export type ReplaceAction = 'took-base' | 'deleted';
export type RegistryStatus = 'merged' | 'not-needed' | 'skipped' | 'conflict';
export type RegistrySkipReason = 'missing' | 'unparsable' | 'shape-unsupported';
export type ConflictCategory = 'registry' | 'config' | 'spec' | 'verify-record' | 'proposal' | 'other';
export type ConflictReason = 'git-conflict' | 'registry-entry-conflict' | 'baseline-run-diverged';
export type ConfigInvalidReason = 'syntax' | 'outside-verify-dir' | 'protected-path' | 'type';

export interface ConfigInvalidEntry { config_key: string; value: string; reason: ConfigInvalidReason }

export interface ReplaceListItem {
  /** 文件路径，或 `branch_sync.replace_paths` 的条目（可含目录与 `*` 段） */
  path: string;
  source: 'builtin' | 'config';
  /** 该路径取自哪个配置项；固定内置项为 null */
  config_key: string | null;
}

export interface BranchSyncData {
  result: 'synced' | 'up-to-date' | 'conflicts';
  branch: string | null;
  base: BaseBranch;
  merge_base: string;
  head_before: string;
  head_after: string;
  fast_forward: boolean;
  replaced: Array<{ path: string; action: ReplaceAction }>;
  registry: {
    path: string;
    status: RegistryStatus;
    reason: RegistrySkipReason | null;
    counters: RegistryCounter[];
    index_backfilled: number;
    conflicts: RegistryConflict[];
  };
  remaining_conflicts: Array<{ path: string; category: ConflictCategory; reason: ConflictReason }>;
  invalidated_markers: Array<{ slug: string; markers: string[] }>;
  diagnostics: Array<{ code: string; message: string; counter?: string }>;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/* —— 保护路径（§4.4）—— */

type ProtectedShape = { kind: 'dir' | 'file'; segments: string[]; last?: (segment: string) => boolean };
const VERIFY_SEGMENTS = VERIFY_REPORT_DIR.split('/');
const isDeploymentReportName = (name: string): boolean => name === 'deployment-report.md' || name.endsWith('-deployment-report.md');
const PROTECTED_SHAPES: readonly ProtectedShape[] = [
  { kind: 'dir', segments: [...VERIFY_SEGMENTS, 'baseline-seed-runs'] },
  { kind: 'file', segments: [...VERIFY_SEGMENTS, 'baseline-events.jsonl'] },
  // 共用部署报告与各模块部署报告（<m>-deployment-report.md）
  { kind: 'file', segments: [...VERIFY_SEGMENTS, ''], last: isDeploymentReportName },
];

/** 具体路径是否落在保护路径上（基线运行目录、基线事件账本、部署报告）。 */
export function isProtectedPath(rel: string): boolean {
  const rs = rel.split('/');
  return PROTECTED_SHAPES.some(shape => {
    if (shape.kind === 'dir') return rs.length > shape.segments.length && shape.segments.every((s, i) => s === rs[i]);
    if (rs.length !== shape.segments.length) return false;
    return shape.segments.every((s, i) => (i === rs.length - 1 && shape.last ? shape.last(rs[i]) : s === rs[i]));
  });
}

/**
 * 清单条目是否与保护路径重叠（等于、覆盖或落在其内部，§4.5）。
 * 条目中的 `*` 段不按「可能匹配到保护路径」判重叠——它命中的具体文件若落在保护路径上，
 * 由处置阶段的 `isProtectedPath` 逐文件排除，同样不会被替换或删除。
 */
function overlapsProtected(entry: string): boolean {
  const isDir = entry.endsWith('/');
  const segs = (isDir ? entry.slice(0, -1) : entry).split('/');
  return PROTECTED_SHAPES.some(shape => {
    const n = Math.min(segs.length, shape.segments.length);
    for (let i = 0; i < n; i++) {
      const literal = i === shape.segments.length - 1 && shape.last ? shape.last(segs[i]) : shape.segments[i] === segs[i];
      if (!literal) return false;
    }
    if (segs.length === shape.segments.length) return true; // 等于
    if (segs.length < shape.segments.length) return isDir; // 条目是上级目录：覆盖
    return shape.kind === 'dir'; // 条目落在保护目录内部
  });
}

function readRawConfig(root: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(join(root, CONFIG_REL), 'utf-8')) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const show = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value));

/**
 * 同步处置清单（§4）：内置项只读复用 verify 既有的路径解析，加上校验后的 `branch_sync.replace_paths`，
 * 再对合成后的整份清单统一做保护路径校验（不区分来源）。不合法时抛 BRANCH_SYNC_CONFIG_INVALID。
 * 清单只供同步使用，不是 verify 沙箱的写入授权。
 */
export function computeReplaceList(root: string): ReplaceListItem[] {
  const invalid: ConfigInvalidEntry[] = [];
  const items: ReplaceListItem[] = [];
  const push = (path: string, source: 'builtin' | 'config', config_key: string | null): void => {
    if (!items.some(i => i.path === path)) items.push({ path, source, config_key });
  };

  // —— 内置项（§4.2）——
  push(SHARED_REPORT_PATHS.acceptance, 'builtin', null);
  const modules = registeredModules(readProjectYaml(root).data?.modules);
  if (modules.length >= 2) for (const m of modules) push(moduleReportPath(m.id, 'acceptance'), 'builtin', null);
  const raw = readRawConfig(root);
  // 保护路径校验看配置原值：readVerifyConfig 会把落在模块报告保留路径上的结果路径改写掉，改写后的值不代表用户写了什么
  const configured = normalizeVerifyConfig(raw.verify);
  for (const [key, value] of [
    ['verify.result_path', configured.resultPath],
    ['verify.regression_result_path', configured.regressionResultPath],
    ['verify.incremental_result_path', configured.incrementalResultPath],
  ] as Array<[string, string | undefined]>) {
    if (typeof value === 'string' && overlapsProtected(normalizeRelPath(value))) invalid.push({ config_key: key, value, reason: 'protected-path' });
  }
  const effective = readVerifyConfig(root);
  push(normalizeRelPath(effective.resultPath), 'builtin', 'verify.result_path');
  if (effective.regressionResultPath) push(normalizeRelPath(effective.regressionResultPath), 'builtin', 'verify.regression_result_path');
  if (effective.incrementalResultPath) push(normalizeRelPath(effective.incrementalResultPath), 'builtin', 'verify.incremental_result_path');

  // —— 项目追加项（§4.3）——
  const section = raw.branch_sync;
  if (section !== undefined) {
    if (section === null || typeof section !== 'object' || Array.isArray(section)) {
      invalid.push({ config_key: 'branch_sync', value: show(section), reason: 'type' });
    } else {
      const { base_branch: baseBranch, replace_paths: replacePaths } = section as Record<string, unknown>;
      if (baseBranch !== undefined && (typeof baseBranch !== 'string' || baseBranch === '')) {
        invalid.push({ config_key: 'branch_sync.base_branch', value: show(baseBranch), reason: 'type' });
      }
      if (replacePaths !== undefined) {
        if (!Array.isArray(replacePaths) || replacePaths.some(e => typeof e !== 'string')) {
          invalid.push({ config_key: 'branch_sync.replace_paths', value: show(replacePaths), reason: 'type' });
        } else {
          for (const entry of replacePaths as string[]) {
            const key = 'branch_sync.replace_paths';
            if (exemptEntryInvalidReason(entry) !== null) invalid.push({ config_key: key, value: entry, reason: 'syntax' });
            else if (!entry.startsWith(VERIFY_DIR_PREFIX)) invalid.push({ config_key: key, value: entry, reason: 'outside-verify-dir' });
            else if (overlapsProtected(entry)) invalid.push({ config_key: key, value: entry, reason: 'protected-path' });
            else push(entry, 'config', key);
          }
        }
      }
    }
  }

  if (invalid.length > 0) {
    invalid.sort((x, y) => byString(x.config_key, y.config_key) || byString(x.value, y.value));
    const first = invalid[0];
    throw new BranchError('BRANCH_SYNC_CONFIG_INVALID', 'branch.error.configInvalid',
      { config_key: first.config_key, value: first.value, reason: first.reason }, { entries: invalid });
  }
  return items;
}

/** 清单是否命中具体路径；命中保护路径的具体文件一律不算（纵深防线）。 */
function listMatches(list: ReplaceListItem[], rel: string): boolean {
  if (isProtectedPath(rel)) return false;
  return list.some(item => item.path === rel || (item.source === 'config' && exemptEntryMatches(item.path, rel)));
}

/* —— git 事实读取 —— */

function lstatOrNull(path: string): Stats | null {
  try { return lstatSync(path); } catch { return null; }
}

function gitRaw(cwd: string, args: string[]): { ok: boolean; stdout: Buffer; stderr: string } {
  const r = spawnSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout ?? Buffer.alloc(0), stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf-8').trim() };
}

/** 提交的树中全部文件：路径 → blob id。 */
function treeBlobs(root: string, commit: string): Map<string, string> {
  const out = new Map<string, string>();
  const r = gitRaw(root, ['ls-tree', '-r', '-z', commit]);
  if (!r.ok) throw new Error(`git ls-tree ${commit}: ${r.stderr}`);
  for (const record of r.stdout.toString('utf-8').split('\0')) {
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    out.set(record.slice(tab + 1), record.slice(0, tab).split(' ')[2] ?? '');
  }
  return out;
}

function blobBytes(root: string, id: string): Buffer {
  const r = gitRaw(root, ['cat-file', 'blob', id]);
  if (!r.ok) throw new Error(`git cat-file ${id}: ${r.stderr}`);
  return r.stdout;
}

const blobText = (root: string, id: string): string => blobBytes(root, id).toString('utf-8');

/** 提交的树中全部文件：路径 → 文件模式（100644 / 100755 / 120000 / 160000）。 */
function treeModes(root: string, commit: string): Map<string, string> {
  const out = new Map<string, string>();
  const r = gitRaw(root, ['ls-tree', '-r', '-z', commit]);
  if (!r.ok) throw new Error(`git ls-tree ${commit}: ${r.stderr}`);
  for (const record of r.stdout.toString('utf-8').split('\0')) {
    const tab = record.indexOf('\t');
    if (tab !== -1) out.set(record.slice(tab + 1), record.slice(0, tab).split(' ')[0] ?? '');
  }
  return out;
}

const isRegularMode = (mode: string | undefined): boolean => mode === '100644' || mode === '100755';

/**
 * 让索引的 stat 信息与工作区对齐。按原始字节写回并以 --cacheinfo 登记的条目没有 stat 信息，
 * 不刷新的话 `git merge --abort` 会以「Entry not uptodate」拒绝恢复。
 * 存在未合并路径时该命令以非零退出，属正常情况，不看退出码。
 */
function refreshIndex(root: string): void {
  git(root, ['update-index', '-q', '--refresh']);
}

/** 把索引中该路径的条目指向给定 blob（同时清掉未合并的各阶段条目）。 */
function stageBlob(root: string, path: string, blobId: string, mode: string): void {
  const idx = git(root, ['update-index', '--add', '--cacheinfo', `${mode},${blobId},${path}`]);
  if (!idx.ok) throw new Error(`git update-index ${path}: ${idx.stderr}`);
}

/**
 * 把工作区文件恢复为给定 blob 的**原始字节**并复验（§4.7「取主分支的内容」是逐字节的）。
 * 不走 `git checkout`：签出会做换行与 smudge 过滤转换（core.autocrlf、eol=crlf、自定义过滤器），
 * 写出的字节可能与提交里的不同，而命令照样成功。返回是否改写了工作区。
 */
function writeBlobBytes(root: string, path: string, blobId: string, mode: string): boolean {
  const abs = join(root, path);
  const bytes = blobBytes(root, blobId);
  const st = lstatOrNull(abs);
  if (st !== null && st.isFile() && readFileSync(abs).equals(bytes)) return false;
  if (st !== null && !st.isFile()) removeTree(abs);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  chmodSync(abs, mode === '100755' ? 0o755 : 0o644);
  if (!readFileSync(abs).equals(bytes)) throw new Error(`${path}: 写回后的字节与主分支提交中的 blob ${blobId} 不一致`);
  return true;
}

function gitPathExists(root: string, name: string): boolean {
  const r = git(root, ['rev-parse', '--git-path', name]);
  return r.ok && r.stdout !== '' && existsSync(isAbsolute(r.stdout) ? r.stdout : join(root, r.stdout));
}

/** 进行中的合并、变基、拣选、回退或二分查找；没有时为 null。 */
export function operationInProgress(root: string): 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect' | null {
  if (gitPathExists(root, 'MERGE_HEAD')) return 'merge';
  if (gitPathExists(root, 'rebase-merge') || gitPathExists(root, 'rebase-apply')) return 'rebase';
  if (gitPathExists(root, 'CHERRY_PICK_HEAD')) return 'cherry-pick';
  if (gitPathExists(root, 'REVERT_HEAD')) return 'revert';
  if (gitPathExists(root, 'BISECT_LOG')) return 'bisect';
  return null;
}

/** 已被跟踪且有未提交改动的文件（未跟踪的文件不算）。 */
function dirtyTrackedFiles(root: string): string[] {
  const r = gitRaw(root, ['status', '--porcelain', '-z', '--untracked-files=no']);
  if (!r.ok) throw new Error(`git status: ${r.stderr}`);
  const records = r.stdout.toString('utf-8').split('\0').filter(Boolean);
  const files: string[] = [];
  for (let i = 0; i < records.length; i++) {
    files.push(records[i].slice(3));
    if (/^[RC]/.test(records[i])) i++; // 重命名 / 复制记录后跟原路径
  }
  return files.sort(byString);
}

/** §7.3：进行中的操作与工作区干净检查。 */
function assertRepoReady(root: string): void {
  const op = operationInProgress(root);
  if (op !== null) throw new BranchError('BRANCH_OPERATION_IN_PROGRESS', 'branch.error.operationInProgress', { operation: op });
  const dirty = dirtyTrackedFiles(root);
  if (dirty.length > 0) {
    const shown = dirty.slice(0, 10).map(f => `  ${f}`);
    if (dirty.length > 10) shown.push(`  … (+${dirty.length - 10})`);
    throw new BranchError('BRANCH_WORKTREE_DIRTY', 'branch.error.worktreeDirty', { files: shown.join('\n') });
  }
}

/* —— 登记表（§5）—— */

interface RegistryPlan {
  status: RegistryStatus;
  reason: RegistrySkipReason | null;
  outcome: RegistryMergeOutcome | null;
  oursText: string | null;
}

/** 读取登记表在共同起点、本分支、主分支三个提交中的版本并预先求出合并结果（发起合并之前）。 */
function planRegistry(root: string, trees: { base: Map<string, string>; ours: Map<string, string>; theirs: Map<string, string> }): RegistryPlan {
  const o = trees.base.get(REGISTRY_REL);
  const a = trees.ours.get(REGISTRY_REL);
  const b = trees.theirs.get(REGISTRY_REL);
  const plan = (status: RegistryStatus, reason: RegistrySkipReason | null = null): RegistryPlan => ({ status, reason, outcome: null, oursText: null });
  if (o === undefined || a === undefined || b === undefined) return plan('skipped', 'missing');
  // 只有一边有改动，或两边都没有改动：沿用 git 的结果
  if (a === o || b === o || a === b) return plan('not-needed');
  const oursText = blobText(root, a);
  const versions = [blobText(root, o), oursText, blobText(root, b)].map(parseRegistry);
  if (versions.some(v => v === null)) return plan('skipped', 'unparsable');
  const [vo, va, vb] = versions as RegistryRecord[];
  if (![vo, va, vb].every(registryShapeSupported)) return plan('skipped', 'shape-unsupported');
  const outcome = mergeRegistry(vo, va, vb);
  return { status: outcome.conflicts.length > 0 ? 'conflict' : 'merged', reason: null, outcome, oursText };
}

/* —— 标记（§9）—— */

/** 未归档提案目录（`logos/changes/<slug>/`，不含 `archive/`）下的验收与交付标记路径。 */
function markerSlugOf(rel: string): { slug: string; marker: string } | null {
  const parts = rel.split('/');
  if (parts.length !== 4 || `${parts[0]}/${parts[1]}` !== CHANGES_REL || parts[2] === 'archive') return null;
  return (AMEND_INVALIDATED_MARKERS as readonly string[]).includes(parts[3]) ? { slug: parts[2], marker: parts[3] } : null;
}

/** 是真实目录（不是符号链接），且其真实路径位于项目根之内。 */
function isRealDirInside(root: string, dir: string): boolean {
  const st = lstatOrNull(dir);
  if (st === null || st.isSymbolicLink() || !st.isDirectory()) return false;
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(dir);
    return real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
  } catch {
    return false;
  }
}

/** 清除工作区中每个未归档提案的验收与交付标记；被跟踪的标记其删除进入索引。 */
function clearMarkers(root: string): Array<{ slug: string; markers: string[] }> {
  const changesDir = join(root, CHANGES_REL);
  // 只在本工作区内的真实目录里清除：changes 根或提案目录是符号链接时一律不进入——
  // statSync 会跟随链接，链接指向项目外时 rmSync 会经由它删掉外部文件，而 git 不会替 rmSync 检查路径归属
  if (!isRealDirInside(root, changesDir)) return [];
  const out: Array<{ slug: string; markers: string[] }> = [];
  for (const slug of readdirSync(changesDir).sort(byString)) {
    if (slug === 'archive' || !isRealDirInside(root, join(changesDir, slug))) continue;
    const cleared: string[] = [];
    for (const marker of [...AMEND_INVALIDATED_MARKERS].sort(byString)) {
      const rel = `${CHANGES_REL}/${slug}/${marker}`;
      // lstat：标记本身是悬空链接时也算存在，rmSync 只删除链接本身
      if (lstatOrNull(join(root, rel)) === null) continue;
      const rm = git(root, ['rm', '-q', '-f', '--ignore-unmatch', '--', rel]);
      if (!rm.ok) throw new Error(`git rm ${rel}: ${rm.stderr}`);
      rmSync(join(root, rel), { force: true });
      cleared.push(marker);
    }
    if (cleared.length > 0) out.push({ slug, markers: cleared });
  }
  return out;
}

/* —— 剩余冲突（§8）—— */

export function conflictCategory(rel: string): ConflictCategory {
  if (rel === REGISTRY_REL) return 'registry';
  if (rel === CONFIG_REL) return 'config';
  if (rel.startsWith(VERIFY_DIR_PREFIX)) return 'verify-record';
  if (rel.startsWith('logos/resources/')) return 'spec';
  if (rel.startsWith(`${CHANGES_REL}/`)) return 'proposal';
  return 'other';
}

function unmergedPaths(root: string): string[] {
  const r = gitRaw(root, ['diff', '--name-only', '--diff-filter=U', '-z']);
  if (!r.ok) throw new Error(`git diff: ${r.stderr}`);
  return r.stdout.toString('utf-8').split('\0').filter(Boolean);
}

/* —— 基线事务协同（§6）—— */

/** 本分支登记表中的模块 id（升序）；没有模块登记或登记表读不出时按单个模块 core。 */
function lockModuleIds(root: string): string[] {
  const ids = registeredModules(readProjectYaml(root).data?.modules).map(m => m.id).filter(isSafeModuleId);
  return ids.length > 0 ? [...new Set(ids)].sort(byString) : ['core'];
}

/**
 * 先取锁、后检查：按模块 id 升序取得全部模块事务锁，持锁之后才检查未终结的基线提交记录。
 * 检查若排在取锁之前，基线进程可以在两者之间取得锁、写下未终结的记录并释放锁，那次检查就过期了。
 * 拿不到锁、存在未终结或损坏的记录：释放已取得的锁并以 baseline_commit_in_progress 拒绝；不执行恢复。
 */
function acquireModuleLocks(root: string): string[] {
  const held: string[] = [];
  const refuse = (moduleId: string): never => {
    for (const id of held) releaseLock(root, id);
    throw new BranchError('baseline_commit_in_progress', 'branch.error.baselineInProgress', { module: moduleId });
  };
  for (const id of lockModuleIds(root)) {
    let ok = false;
    try { ok = acquireLock(root, id); } catch { ok = false; }
    if (!ok) refuse(id);
    held.push(id);
  }
  for (const id of held) {
    let pending: unknown;
    try {
      pending = findUnfinalizedJournal(root, id);
    } catch {
      refuse(id); // 记录损坏或无法判定
    }
    if (pending) refuse(id);
  }
  return held;
}

/* —— 未入库文件的占用检查（§7.4）—— */

/**
 * 主分支提交中存在、本分支提交中不存在的路径里，在工作区已被占用的那些（升序）。
 * 「占用」＝该位置已有文件、目录或链接（未跟踪或被忽略都算），或其某一级上级目录的位置上不是目录。
 * git 在真正的合并中会直接覆盖被忽略的本地文件（`--no-overwrite-ignore` 只在快进时生效），
 * 未入库的内容被覆盖后中止合并也找不回来，所以由 CLI 在发起合并之前自行检查。
 */
function untrackedCollisions(root: string, ours: Map<string, string>, theirs: Map<string, string>): string[] {
  const occupied: string[] = [];
  const dirIsFree = new Map<string, boolean>();
  /** 上级目录链是否畅通：每一级要么不存在，要么是真实目录。 */
  const parentsFree = (segments: string[]): boolean => {
    for (let n = 1; n < segments.length; n++) {
      const dir = segments.slice(0, n).join('/');
      let free = dirIsFree.get(dir);
      if (free === undefined) {
        const st = lstatOrNull(join(root, dir));
        free = st === null || st.isDirectory();
        dirIsFree.set(dir, free);
      }
      if (!free) return false;
    }
    return true;
  };
  for (const path of theirs.keys()) {
    if (ours.has(path)) continue;
    if (!parentsFree(path.split('/')) || lstatOrNull(join(root, path)) !== null) occupied.push(path);
  }
  return occupied.sort(byString);
}

/* —— 基线运行目录（§4.4）—— */

const BASELINE_RUNS_PREFIX = `${VERIFY_REPORT_DIR}/baseline-seed-runs/`;

/**
 * 同一次基线运行的同一个被跟踪文件，两条分支相对共同起点都做了改动且结果不同（含一边修改一边删除）。
 * 无论 git 是否自动合并成功都报告为剩余冲突：提交记录与恢复材料被文本合并后不再可信。
 */
function divergedBaselineRunFiles(trees: { base: Map<string, string>; ours: Map<string, string>; theirs: Map<string, string> }): string[] {
  const out: string[] = [];
  for (const path of new Set([...trees.ours.keys(), ...trees.theirs.keys(), ...trees.base.keys()])) {
    if (!path.startsWith(BASELINE_RUNS_PREFIX) || path.slice(BASELINE_RUNS_PREFIX.length).indexOf('/') === -1) continue;
    const o = trees.base.get(path);
    const a = trees.ours.get(path);
    const b = trees.theirs.get(path);
    if (a !== o && b !== o && a !== b) out.push(path);
  }
  return out.sort(byString);
}

/* —— 主流程（§7.1）—— */

export type BranchSyncStep = 'replace' | 'registry' | 'markers' | 'commit';
type GitResult = { ok: boolean; stdout: string; stderr: string };

/** 测试注入点；生产路径不传。 */
export interface BranchSyncHooks {
  /** 取锁之前（构造「检查与取锁之间写下未终结记录」的确定交错） */
  beforeAcquireLocks?: () => void;
  /** 取锁并通过持锁检查之后、持锁重验与发起合并之前 */
  afterAcquireLocks?: () => void;
  /** 各处置步骤开始之前；抛错即模拟该步骤失败 */
  beforeStep?: (step: BranchSyncStep) => void;
  /** 写回前篡改登记表文本（验证写回前自检） */
  tamperRegistryText?: (text: string) => string;
  /** 替身 git：对发起合并（`merge`）与中止恢复（`merge --abort` / `reset`）的调用返回结果；返回 undefined 时走真实 git */
  git?: (args: string[]) => GitResult | undefined;
}

/**
 * `branch sync`（§7.1）。发起合并之前的任何拒绝都不产生改动；合并发起之后任一步失败都中止合并回到同步前（§7.2）。
 */
export function runBranchSync(root: string, flagBase: string | undefined, locale: Locale, hooks: BranchSyncHooks = {}): BranchSyncData {
  // 1. 前置条件（§7.3）
  assertProjectAndRepo(root);
  assertRepoReady(root);

  // 2. 主分支与共同起点；本分支已包含主分支时直接结束（不取锁）
  const base = resolveBaseBranch(root, flagBase);
  const { head, mergeBase } = resolveHeadAndMergeBase(root, base);
  const branch = currentBranch(root);
  const emptyRegistry = (status: RegistryStatus, reason: RegistrySkipReason | null = null): BranchSyncData['registry'] => (
    { path: REGISTRY_REL, status, reason, counters: [], index_backfilled: 0, conflicts: [] });
  if (mergeBase === base.commit) {
    return {
      result: 'up-to-date', branch, base, merge_base: mergeBase, head_before: head, head_after: head, fast_forward: false,
      replaced: [], registry: emptyRegistry('not-needed'), remaining_conflicts: [], invalidated_markers: [], diagnostics: [],
    };
  }

  // 3. 同步处置清单（发起合并之前按本分支的配置与登记表计算一次）
  const list = computeReplaceList(root);

  // 4. 取得模块锁，持锁检查基线提交记录（§6）；锁持有到命令结束
  hooks.beforeAcquireLocks?.();
  // 取锁会创建基线运行目录；它原本不存在时，结束后把空目录一并收走，不在没有基线事务的项目里留下痕迹
  const runsDir = join(root, BASELINE_RUNS_PREFIX);
  const runsDirExisted = existsSync(runsDir);
  let locks: string[] = [];
  try {
    locks = acquireModuleLocks(root); // 拒绝时已自行释放取得的锁
    hooks.afterAcquireLocks?.();
    // 持锁重验：取锁之前做过的仓库检查没有过期
    assertRepoReady(root);
    if (resolveCommit(root, 'HEAD') !== head || resolveCommit(root, base.ref) !== base.commit) {
      throw new BranchError('BRANCH_OPERATION_IN_PROGRESS', 'branch.error.repoChanged');
    }
    return syncUnderLocks(root, locale, hooks, { base, head, mergeBase, branch, list, emptyRegistry });
  } finally {
    for (const id of locks) releaseLock(root, id);
    if (!runsDirExisted) { try { rmdirSync(runsDir); } catch { /* 非空或已不存在：保持原样 */ } }
  }
}

interface SyncContext {
  base: BaseBranch;
  head: string;
  mergeBase: string;
  branch: string | null;
  list: ReplaceListItem[];
  emptyRegistry: (status: RegistryStatus, reason?: RegistrySkipReason | null) => BranchSyncData['registry'];
}

function syncUnderLocks(root: string, locale: Locale, hooks: BranchSyncHooks, ctx: SyncContext): BranchSyncData {
  const { base, head, mergeBase, branch, list } = ctx;
  const gitVia = (args: string[]): GitResult => hooks.git?.(args) ?? git(root, args);

  // 5. 登记表的三个版本
  const trees = { base: treeBlobs(root, mergeBase), ours: treeBlobs(root, head), theirs: treeBlobs(root, base.commit) };
  const registryPlan = planRegistry(root, trees);
  const divergedRuns = divergedBaselineRunFiles(trees);

  // 6. 发起合并：先做未入库文件的占用检查（§7.4），再选择合并方式（§7.5）
  const occupied = untrackedCollisions(root, trees.ours, trees.theirs);
  if (occupied.length > 0) {
    const shown = occupied.slice(0, 10).map(f => `  ${f}`);
    if (occupied.length > 10) shown.push(`  … (+${occupied.length - 10})`);
    throw new BranchError('BRANCH_UNTRACKED_COLLISION', 'branch.error.untrackedCollision', { files: shown.join('\n') }, { paths: occupied });
  }
  const baseHasTrackedMarkers = [...trees.theirs.keys()].some(p => markerSlugOf(p) !== null);
  const fastForward = mergeBase === head && !baseHasTrackedMarkers;
  // 合并的输入固定为已确认的提交 base.commit，与树读取、登记表计划、清单处置和输出身份是同一个版本。
  // 引用是可移动的（另一个工作目录里的提交或 fetch 可以在持锁重验之后推进它，模块事务锁管不到 git 引用），
  // 按引用名合并会让 git 在执行时重新解析，从而出现「合并了新提交、却按旧提交处置文件」的混用。
  // 引用原文只用于合并提交说明；冲突标记里显示的是提交哈希。
  // --no-overwrite-ignore 只在快进时生效，是占用检查之外的第二道保险。
  const mergeArgs = fastForward
    ? ['-c', 'core.editor=true', 'merge', '--ff-only', '--no-overwrite-ignore', base.commit]
    : ['-c', 'core.editor=true', 'merge', '--no-ff', '--no-commit', '--no-overwrite-ignore',
      '-m', `Merge ${base.ref} into ${branch ?? 'HEAD'}`, base.commit];
  const started = gitVia(mergeArgs);
  if (fastForward ? !started.ok : !gitPathExists(root, 'MERGE_HEAD')) {
    throw new BranchError('BRANCH_SYNC_MERGE_FAILED', 'branch.error.mergeFailed', { detail: started.stderr || started.stdout });
  }
  const baseModes = treeModes(root, base.commit);

  // 合并已经发起：此后任一步失败都中止合并回到同步前（§7.2）
  let step: BranchSyncStep = 'replace';
  try {
    const replaced: BranchSyncData['replaced'] = [];
    const registry = ctx.emptyRegistry(fastForward ? 'not-needed' : registryPlan.status, fastForward ? null : registryPlan.reason);
    if (!fastForward) {
      // 7. 清单内的文件：主分支有则取其内容，主分支没有而本分支有则删除（§4.7）
      hooks.beforeStep?.('replace');
      const candidates = new Set([...trees.ours.keys(), ...trees.theirs.keys()].filter(p => listMatches(list, p)));
      for (const path of [...candidates].sort(byString)) {
        const inBase = trees.theirs.get(path);
        const inHead = trees.ours.get(path);
        if (inBase !== undefined) {
          if (inHead === inBase) continue; // 两边内容本就相同
          const mode = baseModes.get(path);
          if (isRegularMode(mode)) {
            // 普通文件：按原始 blob 字节写回并复验，再把索引指向同一个 blob
            writeBlobBytes(root, path, inBase, mode!);
            stageBlob(root, path, inBase, mode!);
          } else {
            // 符号链接等非普通文件没有换行与过滤转换，交给 git 恢复
            const co = git(root, ['checkout', base.commit, '--', path]);
            if (!co.ok) throw new Error(`git checkout ${path}: ${co.stderr}`);
          }
          replaced.push({ path, action: 'took-base' });
        } else {
          const rm = git(root, ['rm', '-q', '-f', '--ignore-unmatch', '--', path]);
          if (!rm.ok) throw new Error(`git rm ${path}: ${rm.stderr}`);
          rmSync(join(root, path), { force: true });
          replaced.push({ path, action: 'deleted' });
        }
      }

      refreshIndex(root);

      // 8. 登记表（§5.5）：没有冲突才写回，写回前自检，写回后补录资源索引并加入索引
      step = 'registry';
      hooks.beforeStep?.('registry');
      if (registryPlan.outcome !== null) {
        registry.counters = registryPlan.outcome.counters;
        registry.conflicts = registryPlan.outcome.conflicts;
        if (registryPlan.status === 'merged') {
          let text = renderMergedRegistry(registryPlan.oursText!, registryPlan.outcome);
          if (hooks.tamperRegistryText) text = hooks.tamperRegistryText(text);
          assertRenderedRegistry(text, registryPlan.outcome.merged!);
          writeFileSync(join(root, REGISTRY_REL), text);
          registry.index_backfilled = syncResourceIndex(root, locale).added;
          const add = git(root, ['add', '--', REGISTRY_REL]);
          if (!add.ok) throw new Error(`git add ${REGISTRY_REL}: ${add.stderr}`);
        }
      }
    }

    if (fastForward) {
      // 纯快进由 git 签出文件，同样可能做换行与过滤转换：清单内被本次快进改动的普通文件按原始字节复原。
      // 索引已指向主分支的 blob，只需修正工作区。
      for (const [path, inBase] of trees.theirs) {
        if (trees.ours.get(path) === inBase || !listMatches(list, path) || !isRegularMode(baseModes.get(path))) continue;
        // 改写了工作区的文件要重登索引条目：否则索引里留着签出时的 stat 信息，git status 会把它显示为已修改
        if (writeBlobBytes(root, path, inBase, baseModes.get(path)!)) stageBlob(root, path, inBase, baseModes.get(path)!);
      }
    }
    refreshIndex(root);

    // 9. 清除验收与交付标记（§9）
    step = 'markers';
    hooks.beforeStep?.('markers');
    const invalidated = clearMarkers(root);

    // 10. 剩余冲突（§8）；没有则完成合并提交
    step = 'commit';
    const remaining = new Map<string, ConflictReason>();
    if (!fastForward) {
      for (const path of unmergedPaths(root)) remaining.set(path, 'git-conflict');
      for (const path of divergedRuns) remaining.set(path, 'baseline-run-diverged');
      if (registry.status === 'conflict') remaining.set(REGISTRY_REL, 'registry-entry-conflict');
    }
    const remaining_conflicts = [...remaining.entries()]
      .sort((x, y) => byString(x[0], y[0]))
      .map(([path, reason]) => ({ path, category: conflictCategory(path), reason }));
    if (!fastForward && remaining_conflicts.length === 0) {
      hooks.beforeStep?.('commit');
      const commit = git(root, ['-c', 'core.editor=true', 'commit', '-q', '--no-edit']);
      if (!commit.ok) throw new Error(`git commit: ${commit.stderr || commit.stdout}`);
    }
    const headAfter = remaining_conflicts.length === 0 ? resolveCommit(root, 'HEAD') ?? head : head;

    const diagnostics = registry.counters.filter(c => c.both_advanced).map(c => ({
      code: 'counter_both_advanced',
      message: t(locale, 'branch.sync.counterBothAdvanced', { counter: c.name, ours: String(c.ours), theirs: String(c.theirs), merged: String(c.merged) }),
      counter: c.name,
    }));
    return {
      result: remaining_conflicts.length === 0 ? 'synced' : 'conflicts',
      branch, base, merge_base: mergeBase, head_before: head, head_after: headAfter, fast_forward: fastForward,
      replaced, registry, remaining_conflicts, invalidated_markers: invalidated, diagnostics,
    };
  } catch (error) {
    // 中止本次合并，使工作区、索引与分支指向回到同步前；纯快进路径上回到同步前的提交
    // （占用检查已保证这两条恢复路径都不涉及未入库的文件）
    refreshIndex(root);
    const undo = fastForward ? gitVia(['reset', '-q', '--keep', head]) : gitVia(['merge', '--abort']);
    const restored = undo.ok && resolveCommit(root, 'HEAD') === head && !gitPathExists(root, 'MERGE_HEAD');
    const detail = error instanceof Error ? error.message : String(error);
    throw new BranchError('BRANCH_SYNC_FAILED', restored ? 'branch.error.syncFailedRestored' : 'branch.error.syncFailedNotRestored',
      { step, detail }, { step, restored });
  }
}
