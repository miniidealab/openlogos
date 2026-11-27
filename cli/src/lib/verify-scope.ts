/**
 * module-scoped-verify：按模块限定 verify 范围的计算（功能规格 §2.96.2～§2.96.3；
 * spec/test-results.md「按模块限定 verify 范围的运行约定（module-scoped-verify）」）。
 *
 * 只读：读取 logos-project.yaml、guard、活跃提案的 delta 与 git 差异，不写任何文件。
 * - 未启用（单模块或没有任何模块声明非空 paths，且未传 --all）→ 返回 null，调用方走现有全量流程；
 * - `--all` → mode=all；
 * - 其余进入范围计算 → mode=module，或任一回落条件成立时 mode=fallback-full。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readProjectYaml, type ProjectYamlModule } from './project-yaml.js';
import { resolveProposalModuleContext } from './change-lint.js';
import { classifyRootRelativePath } from './impact-classify.js';
import { readTestChangeSet } from './test-change-set.js';
import { SPEC_MERGED_MARKER } from './proposal-markers.js';

export type VerifyScopeMode = 'module' | 'all' | 'fallback-full';
export type VerifyScopeSource = 'proposal' | 'delta' | 'spec' | 'path';
export type VerifyScopeFallbackCode =
  | 'no_active_change'
  | 'base_ref_missing'
  | 'not_git_repository'
  | 'base_ref_unreachable'
  | 'diff_failed'
  | 'shared_config_changed'
  | 'unmapped_file'
  | 'module_paths_invalid';

export interface VerifyScopeReason {
  module: string;
  source: VerifyScopeSource;
  ref: string;
}

/** verify JSON `data.scope`（spec/cli-json-output.md「verify `scope` 按模块限定范围字段」）。 */
export interface VerifyScopeData {
  mode: VerifyScopeMode;
  modules: string[];
  reasons: VerifyScopeReason[];
  fallback_reason: { code: VerifyScopeFallbackCode; detail: string } | null;
  out_of_scope_result_count: number;
}

/** 共享验收配置：被改动即回落全量（review F2）。 */
export const SHARED_VERIFY_CONFIG_PATHS = Object.freeze(['logos/logos.config.json', 'logos/logos-project.yaml']);

const TEST_CASES_DIR = 'logos/resources/test';

export interface GitRunResult { status: number | null; stdout: string; error?: unknown }
/** git 调用接缝（测试可注入以模拟差异计算失败）。 */
export type GitRunner = (root: string, args: string[]) => GitRunResult;

export const defaultGitRunner: GitRunner = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', error: r.error };
};

export interface ResolveVerifyScopeOptions {
  all?: boolean;
  git?: GitRunner;
}

/** 模块 id 按长度降序，供 `<module>-` 前缀最长匹配。 */
function prefixModule(fileName: string, moduleIds: string[]): string | null {
  const sorted = [...moduleIds].sort((a, b) => b.length - a.length);
  return sorted.find(id => fileName.startsWith(`${id}-`)) ?? null;
}

/** 测试规格文件（相对 logos/resources/test 或任意路径）归属的模块；无已登记前缀 → null（全局）。 */
export function testFileModule(filePath: string, moduleIds: string[]): string | null {
  return prefixModule(basename(filePath), moduleIds);
}

/** `paths` 条目是否合法：字符串、非空、不以 `/` 开头、不含 `..` 段。 */
export function isValidModulePath(entry: unknown): entry is string {
  if (typeof entry !== 'string' || entry.trim() === '') return false;
  if (entry.startsWith('/')) return false;
  return !entry.split('/').some(seg => seg === '..');
}

/** glob → 正则：`**` 跨段、`*` 段内、`?` 单个非 `/` 字符；整串匹配。 */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const prevSlash = i === 0 || glob[i - 1] === '/';
        const nextSlash = glob[i + 2] === '/';
        if (prevSlash && nextSlash) { out += '(?:.*/)?'; i += 2; continue; }
        out += '.*'; i += 1; continue;
      }
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** 已声明（非空）paths 的模块。 */
function declaresPaths(mod: ProjectYamlModule): boolean {
  return Array.isArray(mod.paths) && mod.paths.length > 0;
}

/** 启用条件中的「未启用」判定（§2.96.2 第 2 条）。 */
export function moduleScopeEnabled(modules: ProjectYamlModule[]): boolean {
  return modules.length > 1 && modules.some(declaresPaths);
}

function readGuard(root: string): Record<string, unknown> | null {
  const path = join(root, 'logos', '.openlogos-guard');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function walkFiles(dir: string, rel = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkFiles(join(dir, entry.name), childRel));
    else if (entry.isFile()) out.push(childRel);
  }
  return out.sort();
}

/** `git diff --name-status -z` 输出解析：重命名 / 复制取旧、新两端，其余取路径。 */
export function parseNameStatusZ(stdout: string): string[] {
  const parts = stdout.split('\0').filter(part => part.length > 0);
  const files: string[] = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i];
    if (/^[RC]/.test(status)) {
      files.push(parts[i + 1], parts[i + 2]);
      i += 3;
    } else {
      files.push(parts[i + 1]);
      i += 2;
    }
  }
  return files.filter(Boolean);
}

/** baseRef 到工作区的改动文件集合（已提交、未提交、未跟踪且未忽略），路径相对项目根。 */
export function collectChangedFiles(root: string, baseRef: string, git: GitRunner = defaultGitRunner): { ok: true; files: string[] } | { ok: false; detail: string } {
  const diff = git(root, ['diff', '--name-status', '-z', '-M', '--relative', baseRef, '--']);
  if (diff.error || diff.status !== 0) return { ok: false, detail: `git diff 失败（exit ${diff.status ?? 'n/a'}）` };
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (untracked.error || untracked.status !== 0) return { ok: false, detail: `git ls-files 失败（exit ${untracked.status ?? 'n/a'}）` };
  const files = new Set<string>([
    ...parseNameStatusZ(diff.stdout),
    ...untracked.stdout.split('\0').filter(Boolean),
  ]);
  return { ok: true, files: [...files].sort() };
}

export type ProposalBaseFailureCode = 'no_active_change' | 'not_git_repository' | 'base_ref_missing' | 'base_ref_unreachable' | 'diff_failed';

export type ProposalChangedFiles =
  | { ok: true; guard: Record<string, unknown>; slug: string; proposalDir: string; baseRef: string; files: string[] }
  | { ok: false; code: ProposalBaseFailureCode; detail: string; slug: string | null; proposalDir: string | null };

/**
 * 活跃提案起点（guard.baseRef）到工作区的改动文件集合及其不可用判定（§2.96.3、§2.96.6）。
 * 模块范围计算与分层验收的扩大规则（§2.109.7）共用这一份判定：没有活跃提案、不是 git 仓库、缺 baseRef、
 * baseRef 不可达、差异计算失败，依次判断。
 */
export function resolveProposalChangedFiles(root: string, git: GitRunner = defaultGitRunner): ProposalChangedFiles {
  const guard = readGuard(root);
  const slug = typeof guard?.activeChange === 'string' ? guard.activeChange : null;
  const proposalDir = slug ? join(root, 'logos', 'changes', slug) : null;
  if (!guard || !slug || !proposalDir || !existsSync(proposalDir)) {
    return { ok: false, code: 'no_active_change', detail: '没有活跃提案', slug: null, proposalDir: null };
  }
  const fail = (code: ProposalBaseFailureCode, detail: string): ProposalChangedFiles => ({ ok: false, code, detail, slug, proposalDir });
  const inRepo = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inRepo.error || inRepo.status !== 0 || inRepo.stdout.trim() !== 'true') return fail('not_git_repository', '项目不是 git 仓库');
  const baseRef = typeof guard.baseRef === 'string' && guard.baseRef ? guard.baseRef : null;
  if (!baseRef) return fail('base_ref_missing', 'guard 缺 baseRef（旧版 CLI 创建的提案）');
  const reachable = git(root, ['cat-file', '-e', `${baseRef}^{commit}`]);
  if (reachable.error || reachable.status !== 0) return fail('base_ref_unreachable', `baseRef ${baseRef} 不可达`);
  const changed = collectChangedFiles(root, baseRef, git);
  if (!changed.ok) return fail('diff_failed', changed.detail);
  return { ok: true, guard, slug, proposalDir, baseRef, files: changed.files };
}

function fallback(modules: string[], code: VerifyScopeFallbackCode, detail: string): VerifyScopeData {
  return { mode: 'fallback-full', modules, reasons: [], fallback_reason: { code, detail }, out_of_scope_result_count: 0 };
}

/**
 * 计算本次 verify 的模块范围。返回 null 表示未启用（调用方不得输出 scope、不得过滤）。
 */
export function resolveVerifyScope(root: string, opts: ResolveVerifyScopeOptions = {}): VerifyScopeData | null {
  const modules = readProjectYaml(root).data?.modules ?? [];
  const allIds = modules.map(m => m.id);
  if (opts.all) {
    return { mode: 'all', modules: allIds, reasons: [], fallback_reason: null, out_of_scope_result_count: 0 };
  }
  if (!moduleScopeEnabled(modules)) return null;
  const git = opts.git ?? defaultGitRunner;

  const invalid = modules.flatMap(m => (m.paths ?? []).filter(entry => !isValidModulePath(entry)).map(entry => `${m.id}: ${JSON.stringify(entry)}`));
  if (invalid.length > 0) return fallback(allIds, 'module_paths_invalid', invalid.join('；'));

  const base = resolveProposalChangedFiles(root, git);
  if (!base.ok) return fallback(allIds, base.code, base.detail);
  const { guard, slug, proposalDir } = base;
  const changed = base;

  const inScope = new Set<string>();
  const reasons: VerifyScopeReason[] = [];
  const addReason = (module: string, source: VerifyScopeSource, ref: string) => {
    inScope.add(module);
    if (!reasons.some(r => r.module === module && r.source === source && r.ref === ref)) reasons.push({ module, source, ref });
  };

  const owner = resolveProposalModuleContext(root, proposalDir, slug);
  const ownerModule = owner.ok ? owner.moduleId : (typeof guard?.module === 'string' ? guard.module : null);
  if (ownerModule && allIds.includes(ownerModule)) addReason(ownerModule, 'proposal', slug);

  for (const rel of walkFiles(join(proposalDir, 'deltas'))) {
    const mod = prefixModule(basename(rel), allIds);
    if (mod) addReason(mod, 'delta', `deltas/${rel}`);
  }

  const matchers = modules.map(m => ({ id: m.id, res: (m.paths ?? []).filter(isValidModulePath).map(globToRegExp) }));
  const sharedChanged: string[] = [];
  const unmapped: string[] = [];
  for (const file of changed.files) {
    if (classifyRootRelativePath(file) === 'lifecycle') continue;
    if (SHARED_VERIFY_CONFIG_PATHS.includes(file)) { sharedChanged.push(file); continue; }
    if (file.startsWith('logos/resources/')) {
      const mod = prefixModule(basename(file), allIds);
      if (mod) { addReason(mod, 'spec', file); continue; }
    }
    const hits = matchers.filter(m => m.res.some(re => re.test(file))).map(m => m.id);
    if (hits.length === 0) { unmapped.push(file); continue; }
    for (const id of hits) addReason(id, 'path', file);
  }
  if (sharedChanged.length > 0) return fallback(allIds, 'shared_config_changed', sharedChanged.join('、'));
  if (unmapped.length > 0) {
    return fallback(allIds, 'unmapped_file', `${unmapped[0]} 等 ${unmapped.length} 个文件`);
  }

  const order = (id: string) => allIds.indexOf(id);
  const sourceOrder: VerifyScopeSource[] = ['proposal', 'delta', 'spec', 'path'];
  reasons.sort((a, b) => order(a.module) - order(b.module) || sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source));
  return {
    mode: 'module',
    modules: allIds.filter(id => inScope.has(id)),
    reasons,
    fallback_reason: null,
    out_of_scope_result_count: 0,
  };
}

/** 本提案变更测试集合 C（SPEC_MERGED.test_change_set）；不可读时为空集。 */
export function readChangedTestIdsForScope(root: string): string[] {
  const guard = readGuard(root);
  const slug = typeof guard?.activeChange === 'string' ? guard.activeChange : null;
  if (!slug) return [];
  const proposalDir = join(root, 'logos', 'changes', slug);
  if (!existsSync(join(proposalDir, SPEC_MERGED_MARKER))) return [];
  try {
    const set = readTestChangeSet(root, proposalDir, {
      change: slug, module: typeof guard?.module === 'string' ? guard.module : 'core',
    });
    return set.valid ? set.value.changed_test_ids : [];
  } catch {
    return [];
  }
}

/**
 * 范围内的测试规格文件判定：带已登记模块前缀且该模块在范围内，或不带已登记前缀（全局）。
 * `mode` 为 all / fallback-full 时恒为 true。
 */
export function testFileInScope(filePath: string, scope: VerifyScopeData, moduleIds: string[]): boolean {
  if (scope.mode !== 'module') return true;
  const mod = testFileModule(filePath, moduleIds);
  return mod === null || scope.modules.includes(mod);
}

/** 范围内用例集 S 的构造器：S = D_M ∪ C（spec/test-slice-manifest.md §7.1）。 */
export interface ScopedTestIds {
  scope: VerifyScopeData;
  /** 范围内的用例 ID（含 C）；mode 非 module 时为 null（不过滤）。 */
  inScope: Set<string> | null;
}

export function moduleIdsOf(root: string): string[] {
  return (readProjectYaml(root).data?.modules ?? []).map(m => m.id);
}

export { TEST_CASES_DIR as VERIFY_SCOPE_TEST_CASES_DIR };
