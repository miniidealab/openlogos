/**
 * S36 — 生命周期变更影响分类（ci-change-impact-contract）纯函数层。
 *
 * 路径语义契约 v1 的机器常量（`PATH_CLASSES_V1`）与分类器（`classifyImpact`）。
 * 权威文字声明见根 `spec/change-impact.md`；JSON data 契约登记于 `spec/cli-json-output.md` §3.16。
 * 三处同源维护：任何一处变更必须同轮同步其余两处。
 *
 * 判定红线（全部 fail-closed）：
 * - 只按路径前缀分类（路径段边界），完全不依赖 rename 配对结果 / 时间戳目录名 / marker 文件名；
 * - R/C 必须新旧路径双侧均为 lifecycle 才算 lifecycle，`files[].class` 取双侧中更不安全一侧；
 * - 未知状态字母、字节流解析失败、空 diff、空输入 → 判定完成且 `lifecycle_only: false`；
 * - 分类坐标 = 剥除项目前缀后的项目根相对路径；输出坐标 = 原始输入路径（不剥前缀）；
 * - 项目前缀外路径不静默丢弃：直接归 external 并照常计入 files[] 与 non_lifecycle_paths。
 */

export const IMPACT_SCHEMA_VERSION = 'openlogos-change-impact.v1';

export type PathClass = 'lifecycle' | 'project' | 'external';

/**
 * 路径语义契约 v1（版本化冻结常量）：只声明「确定安全」的 lifecycle 集合，其余不背书。
 * v1 集合冻结；扩集合须升 v2 并保留 v1 过渡期（spec/change-impact.md §6）。
 */
export const PATH_CLASSES_V1 = Object.freeze({
  version: 'v1' as const,
  /** 精确文件匹配（非目录前缀） */
  guardFile: 'logos/.openlogos-guard',
  /** 目录集合，按路径段边界匹配（含其下全部子路径） */
  lifecycleDirs: Object.freeze(['logos/changes', 'logos/resources/verify', 'logos/.runtime']),
  /** logos/** 下非 lifecycle 的一切 → project（项目自决，不背书） */
  projectDir: 'logos',
});

export interface ImpactFile {
  status: string;
  path: string;
  old_path: string | null;
  class: PathClass;
}

export interface ImpactResult {
  lifecycle_only: boolean;
  files: ImpactFile[];
  non_lifecycle_paths: string[];
  operations: string[];
  changes: string[];
  reasons: string[];
}

/**
 * 修订参数词法校验（三层防线第一层）：值为空或以 `-` 开头（option-like）即拒绝，
 * 不把该值传给任何 git 进程（映射 IMPACT_INPUT_INVALID）。
 */
export function isRevArgLexicallyValid(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('-');
}

/** 目录前缀匹配，按路径段边界：`logos/changes/x` 命中，`logos/changes-evil/x` 不命中。 */
function matchesDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir + '/');
}

/**
 * Git top-level 相对路径语法校验：合法 git 树路径不会产生绝对路径、空段、`.` / `..` 段。
 * 在 `--stdin` 边界收到此类字节流即畸形输入（如 `logos/changes/../logos.config.json`
 * 可用点段先命中 lifecycle 前缀、归一化后却指向 project 文件），必须 fail-closed；
 * 禁止用会改写合法特殊文件名的文件系统归一化代替本校验。
 */
export function isValidGitTopLevelPath(path: string): boolean {
  if (!path || path.startsWith('/')) return false;
  return path.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..');
}

/** `--prefix` / `git rev-parse --show-prefix` 同段级不变量：空前缀合法；非空剥尾 `/` 后须为合法 top-level 相对路径。 */
export function isValidPrefixArg(prefix: string): boolean {
  if (prefix === '') return true;
  const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return isValidGitTopLevelPath(bare);
}

/** 前缀规范化：空前缀原样返回；非空保证以 `/` 结尾（git show-prefix 原生形态）。 */
export function normalizePrefix(prefix: string): string {
  if (!prefix) return '';
  return prefix.endsWith('/') ? prefix : prefix + '/';
}

/**
 * 按路径段边界剥除项目前缀。返回剥除后的项目根相对路径；
 * 路径不在前缀下 → null（调用方归 external，不静默丢弃）。
 */
export function stripProjectPrefix(path: string, prefix: string): string | null {
  const p = normalizePrefix(prefix);
  if (p === '') return path;
  if (!path.startsWith(p)) return null;
  return path.slice(p.length);
}

/** 分类项目根相对路径（契约 v1 查表）。 */
export function classifyRootRelativePath(rel: string): PathClass {
  if (rel === PATH_CLASSES_V1.guardFile) return 'lifecycle';
  for (const dir of PATH_CLASSES_V1.lifecycleDirs) {
    if (matchesDir(rel, dir)) return 'lifecycle';
  }
  if (matchesDir(rel, PATH_CLASSES_V1.projectDir)) return 'project';
  return 'external';
}

/** 分类原始输入路径：剥前缀失败（前缀外）直接 external。 */
export function classifyInputPath(path: string, prefix: string): PathClass {
  const rel = stripProjectPrefix(path, prefix);
  if (rel === null) return 'external';
  return classifyRootRelativePath(rel);
}

const CLASS_SAFETY: Record<PathClass, number> = { lifecycle: 0, project: 1, external: 2 };

/** R/C 双侧取更不安全一侧。 */
function worstClass(a: PathClass, b: PathClass): PathClass {
  return CLASS_SAFETY[a] >= CLASS_SAFETY[b] ? a : b;
}

function failResult(reason: string): ImpactResult {
  return {
    lifecycle_only: false,
    files: [],
    non_lifecycle_paths: [],
    operations: [],
    changes: [],
    reasons: [reason],
  };
}

/**
 * 分类器主入口（纯函数，两输入模式共用的唯一判据）：
 * 输入 `git diff --no-relative --name-status -z` 字节流（utf-8 字符串形态）与项目前缀，
 * 输出 §3.16 data 契约的全部字段（snake_case）。不抛未捕获异常。
 */
export function classifyImpact(stream: string, prefix: string): ImpactResult {
  const reasons: string[] = [];
  const files: ImpactFile[] = [];
  const nonLifecycle = new Set<string>();
  let parseFailed = false;

  // `--prefix` 段级不变量（与路径同一套校验）：非法前缀直接毒化整批结论
  if (!isValidPrefixArg(prefix ?? '')) {
    return failResult(`invalid project prefix ${JSON.stringify(prefix)} (fail-closed)`);
  }

  const raw = stream ?? '';
  const tokens = raw.split('\0');
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop();

  if (tokens.length === 0 || tokens.every(tk => tk === '')) {
    return failResult('empty input: no change records (fail-closed, empty range treated as unsafe)');
  }

  // 状态族闭合文法：A/M/D 只接受裸单字母；R/C 必须携 1–3 位、值域 0–100 的相似度分值。
  // 交叉形态（A100 / M1 / D000 / 裸 R / R101 等）不属于任何合法状态族 → 解析失败（fail-closed）。
  let i = 0;
  while (i < tokens.length) {
    const statusToken = tokens[i];
    if (statusToken === 'A' || statusToken === 'M' || statusToken === 'D') {
      const path = tokens[i + 1];
      if (!path) {
        parseFailed = true;
        reasons.push(`parse failure: truncated ${statusToken} record (fail-closed)`);
        break;
      }
      if (!isValidGitTopLevelPath(path)) {
        parseFailed = true;
        reasons.push(`parse failure: invalid git path ${JSON.stringify(path)} (fail-closed)`);
        break;
      }
      files.push({ status: statusToken, path, old_path: null, class: classifyInputPath(path, prefix) });
      if (classifyInputPath(path, prefix) !== 'lifecycle') nonLifecycle.add(path);
      i += 2;
    } else if (statusToken.startsWith('R') || statusToken.startsWith('C')) {
      const rc = /^([RC])(\d{1,3})$/.exec(statusToken);
      if (!rc || Number(rc[2]) > 100) {
        parseFailed = true;
        reasons.push(`parse failure: invalid status token ${JSON.stringify(statusToken)} (fail-closed)`);
        break;
      }
      const letter = rc[1];
      const oldPath = tokens[i + 1];
      const newPath = tokens[i + 2];
      if (!oldPath || !newPath) {
        parseFailed = true;
        reasons.push(`parse failure: truncated ${letter} record (fail-closed)`);
        break;
      }
      if (!isValidGitTopLevelPath(oldPath) || !isValidGitTopLevelPath(newPath)) {
        parseFailed = true;
        reasons.push(
          `parse failure: invalid git path ${JSON.stringify(!isValidGitTopLevelPath(oldPath) ? oldPath : newPath)} (fail-closed)`,
        );
        break;
      }
      const oldClass = classifyInputPath(oldPath, prefix);
      const newClass = classifyInputPath(newPath, prefix);
      files.push({ status: letter, path: newPath, old_path: oldPath, class: worstClass(oldClass, newClass) });
      if (oldClass !== 'lifecycle') nonLifecycle.add(oldPath);
      if (newClass !== 'lifecycle') nonLifecycle.add(newPath);
      i += 3;
    } else if (/^[A-Z]$/.test(statusToken)) {
      // 未知状态字母（T / U / X 等）：不猜语义、不跳过——直接毒化结论（fail-closed）。
      parseFailed = true;
      const path = tokens[i + 1];
      reasons.push(
        `unknown status ${JSON.stringify(statusToken)}${path ? ` for path ${JSON.stringify(path)}` : ''} (fail-closed)`,
      );
      i += path === undefined ? 1 : 2;
    } else {
      parseFailed = true;
      reasons.push(`parse failure: invalid status token ${JSON.stringify(statusToken)} (fail-closed)`);
      break;
    }
  }

  const nonLifecyclePaths = [...nonLifecycle].sort();
  for (const p of nonLifecyclePaths) {
    reasons.push(`non-lifecycle path: ${p}`);
  }

  const lifecycleOnly =
    !parseFailed && files.length > 0 && files.every(f => f.class === 'lifecycle');

  let operations: string[] = [];
  let changes: string[] = [];
  if (lifecycleOnly) {
    const inferred = inferArchiveOperation(files, prefix);
    operations = inferred.operations;
    changes = inferred.changes;
  }

  return {
    lifecycle_only: lifecycleOnly,
    files,
    non_lifecycle_paths: nonLifecyclePaths,
    operations,
    changes,
    reasons,
  };
}

/**
 * 辅助字段推断（仅展示，不参与 lifecycle_only 判定）：
 * 纯 archive 提交形态 = guard `D` + 全部其余记录为 `logos/changes/<slug>/** → logos/changes/archive/**` 的 R/C 组。
 * 混合 / 不可推断形态 → 两字段空数组。
 */
function inferArchiveOperation(
  files: ImpactFile[],
  prefix: string,
): { operations: string[]; changes: string[] } {
  const none = { operations: [], changes: [] };
  const slugs = new Set<string>();
  let guardDeletes = 0;
  for (const f of files) {
    const rel = stripProjectPrefix(f.path, prefix);
    if (f.status === 'D' && rel === PATH_CLASSES_V1.guardFile) {
      guardDeletes++;
      continue;
    }
    if ((f.status === 'R' || f.status === 'C') && f.old_path !== null) {
      const oldRel = stripProjectPrefix(f.old_path, prefix);
      const slugMatch = oldRel === null ? null : /^logos\/changes\/([^/]+)\//.exec(oldRel);
      if (
        slugMatch && slugMatch[1] !== 'archive' &&
        rel !== null && rel.startsWith('logos/changes/archive/')
      ) {
        slugs.add(slugMatch[1]);
        continue;
      }
    }
    return none;
  }
  if (guardDeletes !== 1 || slugs.size === 0) return none;
  return { operations: ['archive'], changes: [...slugs].sort() };
}
