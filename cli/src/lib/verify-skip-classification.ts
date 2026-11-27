/**
 * verify 跳过分类（verify-self-sufficient-cases，功能规格 §2.106.6，spec/test-results.md「verify 跳过分类」）。
 *
 * - 严格判定集合：活跃提案 SPEC_MERGED.test_change_set.changed_test_ids（经正式读取器校验）中的 UT/ST；
 * - 严格集合内：平台跳过（reason_code=platform-unavailable 且 detail 非空）放行，其余 skip 为用例分层错误；
 * - 严格集合外（存量）或无活跃提案：非平台 skip 口径不变，只出提醒。
 * 判据与 smoke §2.48 的平台跳过逐字同源。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTestChangeSet } from './test-change-set.js';
import { SPEC_MERGED_MARKER } from './proposal-markers.js';

export const PLATFORM_SKIP_REASON = 'platform-unavailable';
export const TIER_MISMATCH_FIX_HINT = '准备好环境并声明到 verify.requirements，或改标 `[manual]`';

export type StrictSkipSet =
  | { state: 'unmerged'; ids: Set<string> }
  | { state: 'valid'; ids: Set<string> }
  | { state: 'invalid'; ids: Set<string>; detail: string };

/**
 * 读取严格判定集合，三种状态（§2.106.6 第 3 条）：
 * - unmerged：无活跃提案，或活跃提案没有 SPEC_MERGED——空集，只提醒不收紧；
 * - valid：读取器判有效，取其 changed_test_ids 中的 UT/ST（含读取器认可的合法空集）；
 * - invalid：已有 SPEC_MERGED 但读取器判无效——拒绝采信、不推导为空集。
 */
export function readStrictSkipSet(root: string): StrictSkipSet {
  let slug: string | null = null;
  let module = 'core';
  try {
    const guard = JSON.parse(readFileSync(join(root, 'logos', '.openlogos-guard'), 'utf8')) as { activeChange?: unknown; module?: unknown };
    if (typeof guard.activeChange === 'string' && guard.activeChange) slug = guard.activeChange;
    if (typeof guard.module === 'string' && guard.module) module = guard.module;
  } catch { /* 无活跃提案 */ }
  if (!slug) return { state: 'unmerged', ids: new Set() };
  const proposalDir = join(root, 'logos', 'changes', slug);
  if (!existsSync(join(proposalDir, SPEC_MERGED_MARKER))) return { state: 'unmerged', ids: new Set() };
  let read: ReturnType<typeof readTestChangeSet>;
  try {
    read = readTestChangeSet(root, proposalDir, { change: slug, module });
  } catch (e) {
    return { state: 'invalid', ids: new Set(), detail: `test-slice-change-set-unreadable: ${(e as Error).message}` };
  }
  if (!read.valid) return { state: 'invalid', ids: new Set(), detail: `${read.code}: ${read.message}` };
  return { state: 'valid', ids: new Set(read.value.changed_test_ids.filter(id => /^(UT|ST)-/.test(id))) };
}

export interface SkipLike { id: string; reason_code?: string; detail?: string }

export function isPlatformSkip(r: SkipLike): boolean {
  return r.reason_code === PLATFORM_SKIP_REASON && typeof r.detail === 'string' && r.detail.trim() !== '';
}

export interface SkipClassification {
  platform: Array<{ id: string; detail: string }>;
  tier: Array<{ id: string; reason_code?: string; detail?: string; fix_hint: string }>;
  unclassified: string[];
}

/** 对已归一化的 skip 结果分类；三个子集都是 skipped_cases 的子集。 */
export function classifySkips(skipped: SkipLike[], strict: Set<string>): SkipClassification {
  const out: SkipClassification = { platform: [], tier: [], unclassified: [] };
  for (const r of skipped) {
    if (strict.has(r.id)) {
      if (isPlatformSkip(r)) out.platform.push({ id: r.id, detail: r.detail!.trim() });
      else {
        out.tier.push({
          id: r.id,
          ...(r.reason_code !== undefined ? { reason_code: r.reason_code } : {}),
          ...(r.detail !== undefined ? { detail: r.detail } : {}),
          fix_hint: TIER_MISMATCH_FIX_HINT,
        });
      }
    } else if (!isPlatformSkip(r)) {
      out.unclassified.push(r.id);
    }
  }
  return out;
}
