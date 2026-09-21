/**
 * canonical target 判据：delta 相对路径 → 唯一 canonical target 的映射，及其路径安全边界。
 *
 * 本模块只读，是 merge 目标集派生（功能规格 §2.71）与 change-lint L6 的共同事实源——
 * 判据只在这里实现一次，调用点禁止复制。
 *
 * 承自已删除的 `baseline-closure.ts`：闭包计划解析与 P/T/D 对账随 change-lint L9 一并删除，
 * 这里保留的是与闭包规划无关的路径映射能力，逐行不变。
 */
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { DELTA_TO_RESOURCE } from './delta-classify.js';

export const CANONICAL_TARGET_CATEGORIES = [
  'requirement', 'feature', 'architecture', 'scenario', 'api', 'database', 'test',
  'orchestration', 'deployment', 'smoke', 'spec', 'skill', 'decision',
] as const;
export type CanonicalTargetCategory = typeof CANONICAL_TARGET_CATEGORIES[number];

/**
 * **整文件（non-Markdown）通道的类别集合——唯一定义点。**
 *
 * 落在本集合内的 canonical target 不是 Markdown 章节文档：其 delta 首行为控制 marker、
 * 正文即最终字节，由 `validateAndStripNonMarkdownDelta` 做标记校验与剥离后整文件落盘；
 * 其余类别走 `composeOpenLogosMarkdown` 章节合成。
 *
 * **判据取语义类别，不取文件后缀、也不取 `deltas/` 一级目录名**——`logos/resources/api/*.json`
 * 与 `logos/resources/scenario/*.json` 同为 `.json` 却属不同类别、走不同的内容校验。
 *
 * **两个消费方必须从这里派生，禁止任一侧复述等价字面量**：merge 合成侧的通道选择
 * （`merge-direct.ts`）与 change-lint 准入侧的 L4 判定（`change-lint.ts`）。S35「语法唯一、
 * 读法具名」不变量 3：只共享最后那次比较、各自决定进入比较的集合，等同于把分裂从判据挪到集合——
 * 类别白名单正是「进入比较的集合」。两份字面量正是 toolstop run `drv-muaq05dn-4qs0` 的成因：
 * lint 报 PASS 而 merge 必炸。
 *
 * **新增类别时须同批评估三处**：本集合的成员、`non-markdown-delta.ts` 入口的受理分支、
 * 该类别的内容校验层级（见 S39「non-Markdown 整文件协议的适用类别与派生结论」）。
 */
export const NON_MARKDOWN_CATEGORIES: ReadonlySet<CanonicalTargetCategory> =
  new Set<CanonicalTargetCategory>(['api', 'database', 'orchestration']);

/**
 * canonical target 是否走整文件通道。
 *
 * 入参放宽到 `string` 是因为 merge 侧的 `DirectTarget.category` 是 `string`（不可解析时落 `'unknown'`）；
 * 不在集合内（含 `null` / `'unknown'` / 未来的未知类别）一律按 Markdown 章节文档处理。
 */
export function isNonMarkdownCategory(category: string | null | undefined): boolean {
  return category != null && NON_MARKDOWN_CATEGORIES.has(category as CanonicalTargetCategory);
}


export interface CanonicalTargetResolution {
  deltaPath: string;
  targetPath: string;
  canonicalTargetPath: string;
  category: string;
  semanticCategory: CanonicalTargetCategory | null;
}

function contained(realChild: string, realBase: string): boolean {
  return realChild === realBase || realChild.startsWith(realBase + sep);
}

/**
 * 校验某一路径现存部分没有通过 symlink 逃逸 base。路径可以尚不存在；此时检查最深现存祖先。
 */
function existingPathContained(base: string, candidate: string): boolean {
  let realBase: string;
  try { realBase = realpathSync(base); } catch { return false; }
  let cursor = candidate;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
  try {
    const realCursor = realpathSync(cursor);
    return contained(realCursor, realBase);
  } catch {
    return false;
  }
}

/**
 * canonical target 的语义类别分类器。所有 plan/L9/apply 调用点必须消费本函数，
 * 禁止相信 proposal 中可伪造的 category 字段或仅相信 deltas 一级目录。
 */
export function classifyCanonicalTargetCategory(targetPath: string): CanonicalTargetCategory | null {
  const path = targetPath.replace(/\\/g, '/');
  if (path.startsWith('logos/resources/prd/1-product-requirements/')) return 'requirement';
  if (path.startsWith('logos/resources/prd/2-product-design/1-feature-specs/')) return 'feature';
  if (path.startsWith('logos/resources/prd/2-product-design/2-page-design/')) return 'feature';
  if (path.startsWith('logos/resources/prd/3-technical-plan/1-architecture/')) return 'architecture';
  if (path.startsWith('logos/resources/prd/3-technical-plan/2-scenario-implementation/')) return 'scenario';
  if (path.startsWith('logos/resources/prd/3-technical-plan/3-deployment/')) return 'deployment';
  if (path.startsWith('logos/resources/api/')) return 'api';
  if (path.startsWith('logos/resources/database/')) return 'database';
  if (path.startsWith('logos/resources/test/smoke/')) return 'smoke';
  if (path.startsWith('logos/resources/test/')) return 'test';
  if (path.startsWith('logos/resources/scenario/')) return 'orchestration';
  if (path.startsWith('logos/resources/decisions/')) return 'decision';
  if (path.startsWith('spec/')) return 'spec';
  if (path.startsWith('skills/')) return 'skill';
  return null;
}

/**
 * delta 路径 → canonical merge target。统一分隔符/安全 `.`，拒绝绝对路径、`..`、未知类别及 symlink escape。
 */
export function resolveCanonicalMergeTarget(
  root: string,
  proposalDir: string,
  rawDeltaPath: string,
): CanonicalTargetResolution | null {
  if (typeof rawDeltaPath !== 'string' || rawDeltaPath.trim() !== rawDeltaPath || rawDeltaPath === '') return null;
  if (rawDeltaPath.includes('\0') || isAbsolute(rawDeltaPath) || /^[A-Za-z]:[\\/]/.test(rawDeltaPath)) return null;
  const slash = rawDeltaPath.replace(/\\/g, '/');
  const rawSegments = slash.split('/');
  if (rawSegments.some(s => s === '..' || s === '')) return null;
  const normalized = posix.normalize(slash);
  const segs = normalized.split('/');
  if (segs.length < 3 || segs[0] !== 'deltas' || segs.some(s => s === '..' || s === '')) return null;
  const category = segs[1];
  const mapped = DELTA_TO_RESOURCE[category];
  if (!mapped) return null;
  const rest = segs.slice(2).join('/');
  if (!rest || rest.endsWith('/')) return null;

  const deltaAbs = join(proposalDir, ...segs);
  const targetPath = posix.join(mapped.replace(/\\/g, '/'), rest);
  const targetAbs = join(root, ...targetPath.split('/'));
  const targetBase = join(root, ...mapped.split('/'));
  if (!existingPathContained(proposalDir, deltaAbs)) return null;
  // CREATE 时类别根本身可以尚不存在；此时以项目根检查现存祖先，待类别根出现后再收紧到该根。
  if (!existingPathContained(existsSync(targetBase) ? targetBase : root, targetAbs)) return null;

  // 已存在目标本身若是逃逸 symlink，最深祖先检查已通过 realpath；显式拒绝非常规目标。
  if (existsSync(targetAbs)) {
    try {
      const st = lstatSync(targetAbs);
      if (!(st.isFile() || st.isSymbolicLink())) return null;
    } catch { return null; }
  }

  const canonicalTargetPath = process.platform === 'win32' ? targetPath.toLocaleLowerCase('en-US') : targetPath;
  return {
    deltaPath: normalized,
    targetPath,
    canonicalTargetPath,
    category,
    semanticCategory: classifyCanonicalTargetCategory(targetPath),
  };
}

/** 兼容既有调用名；无法做 containment 时仍只返回经映射且词法安全的项目路径。 */
export function canonicalTargetFromDeltaPath(rawDeltaPath: string): string | null {
  if (typeof rawDeltaPath !== 'string' || isAbsolute(rawDeltaPath) || /^[A-Za-z]:[\\/]/.test(rawDeltaPath)) return null;
  const slash = rawDeltaPath.replace(/\\/g, '/');
  if (slash.split('/').some(s => s === '..' || s === '')) return null;
  const normalized = posix.normalize(slash);
  const segs = normalized.split('/');
  if (segs.length < 3 || segs[0] !== 'deltas') return null;
  const mapped = DELTA_TO_RESOURCE[segs[1]];
  return mapped ? posix.join(mapped, ...segs.slice(2)) : null;
}

interface ExtractedClosureYaml { present: boolean; yaml?: string; error?: string }

const TASK_CLOSURE_MODE_PREFIX_RE = /^\[(?:MODIFY|CREATE)\](?:\s|$)/;

/** 只认围栏/注释外的准确二级标题，且该节必须恰有一个 YAML fenced block。 */

export function projectRelativePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, '/');
}
