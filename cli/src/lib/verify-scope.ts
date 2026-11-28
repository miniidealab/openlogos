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
import { isMap, parseDocument } from 'yaml';
import { readProjectYaml, type ProjectYamlModule } from './project-yaml.js';
import { resolveProposalModuleContext } from './change-lint.js';
import { classifyRootRelativePath } from './impact-classify.js';
import { readTestChangeSet } from './test-change-set.js';
import { SPEC_MERGED_MARKER } from './proposal-markers.js';
import { moduleFromGuard } from './merge-direct.js';

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

/**
 * 共享验收配置（review F2）。自 verify-scope-fields-and-slice-module 起按顶层字段判断（功能规格 §2.96.3.1），
 * 不再「被改动即回落全量」。数组顺序同时是 `detail` 中两个文件的先后顺序。
 */
export const SHARED_VERIFY_CONFIG_PATHS = Object.freeze(['logos/logos.config.json', 'logos/logos-project.yaml']);

/**
 * 共享验收配置的顶层字段清单（§2.96.3.1；由 CLI 固定，项目不可配置）。
 * `related` 变化即回落；`unrelated` 变化不回落；两者都没有列出的顶层键按 related 处理——清单漏更新时多跑，不会少跑。
 */
export const SHARED_VERIFY_CONFIG_FIELDS: Readonly<Record<string, { related: readonly string[]; unrelated: readonly string[] }>> = Object.freeze({
  'logos/logos.config.json': {
    related: ['verify', 'smoke', 'sourceRoots', 'guard'],
    unrelated: ['name', 'description', 'locale', 'aiTool', 'agents', 'driver', 'branch_sync', 'maxOpenTabs', 'modules', 'fileModules'],
  },
  'logos/logos-project.yaml': {
    related: ['modules'],
    unrelated: [
      'project', 'tech_stack', 'scenario_counter', 'feature_counter', 'decision_counter', 'features', 'scenarios',
      'release_workflows', 'deployment_gates', 'resource_index', 'conventions', 'baseline_index',
    ],
  },
});

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

/** 一侧原文无法用于字段比较的原因（`detail` 中的原文）。 */
type SharedConfigSideProblem = '不存在' | '读取失败' | '无法解析' | '顶层不是对象';
type SharedConfigSide = { ok: true; value: Record<string, unknown> } | { ok: false; problem: SharedConfigSideProblem };

/** 共享验收配置文件的字段比较结论：只有无关字段变化（或没有变化）→ unrelated；否则 related 并带 `detail`。 */
export type SharedConfigVerdict =
  | { file: string; kind: 'unrelated' }
  | { file: string; kind: 'related'; detail: string };

/**
 * 严格解析：JSON / YAML 没有任何语法错误才算通过（YAML 重复键同样算错误）。
 * 不使用 `readProjectYaml` 的恢复解析结果——那只用于判断模块范围是否启用（§2.96.3.1）。
 */
function parseSharedConfigStrict(file: string, text: string): SharedConfigSide {
  let value: unknown;
  try {
    if (file.endsWith('.json')) {
      value = JSON.parse(text);
    } else {
      const doc = parseDocument(text, { uniqueKeys: true });
      if (doc.errors.length > 0) return { ok: false, problem: '无法解析' };
      // 顶层按 YAML 映射节点判定：`!!timestamp` 等标量解析后也是 object（Date），不能靠 typeof 区分
      if (!isMap(doc.contents)) return { ok: false, problem: '顶层不是对象' };
      value = doc.toJS();
    }
  } catch {
    return { ok: false, problem: '无法解析' };
  }
  if (!isPlainRecord(value)) return { ok: false, problem: '顶层不是对象' };
  return { ok: true, value };
}

/** 提案起点（baseRef）中该文件的原文；路径按项目根相对（`./`），项目根在仓库子目录时不会读到仓库根下的同名文件。 */
function readSharedConfigAtBase(root: string, baseRef: string, file: string, git: GitRunner): SharedConfigSide {
  const listed = git(root, ['ls-tree', '-z', '--name-only', baseRef, '--', file]);
  if (listed.error || listed.status !== 0) return { ok: false, problem: '读取失败' };
  if (listed.stdout.split('\0').filter(Boolean).length === 0) return { ok: false, problem: '不存在' };
  const shown = git(root, ['show', `${baseRef}:./${file}`]);
  if (shown.error || shown.status !== 0) return { ok: false, problem: '读取失败' };
  return parseSharedConfigStrict(file, shown.stdout);
}

function readSharedConfigInWorktree(root: string, file: string): SharedConfigSide {
  const path = join(root, file);
  if (!existsSync(path)) return { ok: false, problem: '不存在' };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { ok: false, problem: '读取失败' };
  }
  return parseSharedConfigStrict(file, text);
}

/** 映射解析出的普通对象（JSON 对象 / YAML 映射）；Date、二进制等标量的宿主对象不算。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 解析后取值的深度比较：映射不看键顺序，数组看元素顺序，标量按解析后的值、按类型比较（§2.96.3.1）。
 *
 * 标量不能当作「没有可枚举键的对象」比较：YAML 的 `!!timestamp` 解析为 Date、`!!binary` 解析为字节数组，
 * 两个不同的 Date 可枚举键都为空，按映射比较会被判相同而漏掉真实变化；`.nan` 解析为 NaN，NaN !== NaN，
 * 按 === 比较会把只改注释判成变化。类型无法识别的宿主对象一律按不同处理（多跑，不少跑）。
 *
 * YAML 的锚点与别名可以构成循环引用（`a: &x { self: *x }`），严格解析会保留回指；两侧各自解析得到两份独立的对象图，
 * 引用相等不会成立。`seen` 记录正在比较或已比较过的左右对象对：再次遇到同一对时结束该分支（这一对的结论由首次
 * 进入时的比较给出，任何差异都会在那里被检出），继续检查其余键和值——否则只改注释也会递归到耗尽调用栈。
 */
export function sameParsedValue(a: unknown, b: unknown, seen: WeakMap<object, WeakSet<object>> = new WeakMap()): boolean {
  if (Object.is(a, b)) return true;
  // +0 与 -0 在 JSON / YAML 的取值语义下相同
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  }
  const isArrayPair = Array.isArray(a) && Array.isArray(b);
  if (!isArrayPair && (Array.isArray(a) || Array.isArray(b))) return false;
  if (!isArrayPair && (!isPlainRecord(a) || !isPlainRecord(b))) return false;
  // 容器（数组 / 映射）：同一对左右对象只展开一次
  let partners = seen.get(a);
  if (partners?.has(b)) return true;
  if (!partners) { partners = new WeakSet(); seen.set(a, partners); }
  partners.add(b);
  if (isArrayPair) {
    const left = a as unknown[];
    const right = b as unknown[];
    return left.length === right.length && left.every((item, index) => sameParsedValue(item, right[index], seen));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameParsedValue(left[key], right[key], seen));
}

/**
 * 对改动文件集合中的一个共享验收配置文件做字段比较（§2.96.3.1）。
 *
 * 调用前提由调用方保证：该范围机制已取得改动文件集合，且集合包含 `file`。本函数只贡献这一个文件的结论，
 * 不读取、不改写其他原因。任一侧原文不存在、读取失败、不能严格解析或顶层不是对象 → 按整文件变化处理。
 */
export function compareSharedVerifyConfig(root: string, baseRef: string, file: string, git: GitRunner = defaultGitRunner): SharedConfigVerdict {
  const fields = SHARED_VERIFY_CONFIG_FIELDS[file];
  const base = readSharedConfigAtBase(root, baseRef, file, git);
  if (!base.ok) return { file, kind: 'related', detail: `${file}（提案起点中的内容${base.problem}）` };
  const work = readSharedConfigInWorktree(root, file);
  if (!work.ok) return { file, kind: 'related', detail: `${file}（工作区中的内容${work.problem}）` };
  const unrelated = new Set(fields?.unrelated ?? []);
  const changed = Array.from(new Set([...Object.keys(base.value), ...Object.keys(work.value)]))
    .filter(key => {
      const inBase = Object.prototype.hasOwnProperty.call(base.value, key);
      const inWork = Object.prototype.hasOwnProperty.call(work.value, key);
      return inBase !== inWork || !sameParsedValue(base.value[key], work.value[key]);
    })
    // 只列相关字段与未列出的字段；同时变化的无关字段不列
    .filter(key => !unrelated.has(key))
    .sort();
  if (changed.length === 0) return { file, kind: 'unrelated' };
  return { file, kind: 'related', detail: `${file}（${changed.join('、')}）` };
}

/** 两个共享验收配置文件在 `detail` 中的先后：`logos/logos.config.json` 在前。 */
export function sharedConfigOrder(file: string): number {
  return SHARED_VERIFY_CONFIG_PATHS.indexOf(file);
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
  const sharedChanged: SharedConfigVerdict[] = [];
  const unmapped: string[] = [];
  for (const file of changed.files) {
    if (classifyRootRelativePath(file) === 'lifecycle') continue;
    if (SHARED_VERIFY_CONFIG_PATHS.includes(file)) {
      // 按字段判断（§2.96.3.1）：相关变化或无法判断 → 回落；只有无关变化 → 该文件不参与后续分类
      const verdict = compareSharedVerifyConfig(root, changed.baseRef, file, git);
      if (verdict.kind === 'related') sharedChanged.push(verdict);
      continue;
    }
    if (file.startsWith('logos/resources/')) {
      const mod = prefixModule(basename(file), allIds);
      if (mod) { addReason(mod, 'spec', file); continue; }
    }
    const hits = matchers.filter(m => m.res.some(re => re.test(file))).map(m => m.id);
    if (hits.length === 0) { unmapped.push(file); continue; }
    for (const id of hits) addReason(id, 'path', file);
  }
  if (sharedChanged.length > 0) {
    const details = sharedChanged
      .sort((a, b) => sharedConfigOrder(a.file) - sharedConfigOrder(b.file))
      .map(v => (v.kind === 'related' ? v.detail : v.file));
    return fallback(allIds, 'shared_config_changed', details.join('、'));
  }
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
      // 模块期望值与合并侧、slice plan 同一取值规则（§2.110.2），不直接用 guard 的原始字符串
      change: slug, module: moduleFromGuard(root, slug),
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
