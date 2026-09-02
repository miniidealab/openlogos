import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 提案生命周期 marker 名称与 spec-complete 判定的**唯一权威**（架构 §四十一.4 不变量 C：一个判据只能有一个实现）。
 *
 * 本模块刻意只依赖 node 内置模块——marker 名与其判定是叶子事实，任何消费方都能安全引用而不制造循环依赖
 * （`proposal-lifecycle` 反向依赖 `test-slice-manifest`，判据若留在前者，后者就无法引用）。
 * `proposal-lifecycle.ts` 原样再导出，`hasSpecCompleteMarker` 的既有引用路径不变。
 *
 * 禁止在消费方内联 marker 名字面量（无论用于拼路径还是写进诊断文案）：那正是本次修复退休的影子来源，
 * 它把「保持一致」从编译期保障降级成人工纪律。回归锁见 UT-S35-126。
 */

export const PLAN_APPROVED_MARKER = 'PLAN_APPROVED';
export const SPEC_MERGED_MARKER = 'SPEC_MERGED';
/** 0.9 之前的规格完成 marker；`hasSpecCompleteMarker` 至今接受它，全部消费方须读法一致。 */
export const LEGACY_MERGED_MARKER = 'MERGED';
export const VERIFY_PASS_MARKER = 'VERIFY_PASS';
export const SLICES_APPROVED_MARKER = 'SLICES_APPROVED';

/**
 * 「该提案已越过某个历史阶段」的 marker 集合——用于对 legacy 提案省略结构校验。
 * 此前 `plan-package.ts` 与 `authority-closure.ts` 各列一份，新增 marker 时只会改到其中一处。
 */
export const HISTORICAL_MARKERS = [
  PLAN_APPROVED_MARKER, SPEC_MERGED_MARKER, LEGACY_MERGED_MARKER, VERIFY_PASS_MARKER,
] as const;

/**
 * 「该提案是否已完成规格阶段」的**唯一判定**：接受 `SPEC_MERGED`，并向后兼容 legacy `MERGED`。
 *
 * 全部消费方（plan-package、test-slice-manifest、change-lint、proposal-lifecycle）一律调用它。
 * 此前 change-lint 自行只认 `SPEC_MERGED`，对持 legacy `MERGED` 的提案判「未 merge」并重放 L8 条目守恒——
 * 而 change-lint 自身的注释已写明那会制造假阳性。回归锁见 UT-S35-125 / ST-S35-23。
 */
export function hasSpecCompleteMarker(proposalDir: string): boolean {
  return existsSync(join(proposalDir, SPEC_MERGED_MARKER)) || existsSync(join(proposalDir, LEGACY_MERGED_MARKER));
}
