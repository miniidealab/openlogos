/**
 * S45 enterprise-knowledge-base（功能规格 §2.102.10）有意新增的 change-lint 违规码（L10 企业知识）。
 *
 * 与 `deploy-plan-coverage-codes.ts` 同一做法：零回归锚对照「改动前实测基线（golden）+ 本函数追加的码」，
 * 既承认这次有意扩充，又保留「任何其它意外增删改序都会变红」的强度。
 * 追加位置与 `CHANGE_LINT_VIOLATION_CODES` 的登记位置一致：紧跟注册表末尾的 `slice-task-state-inconsistent`。
 * L10 共 8 码：结构 / 引用 / 重号三码与禁止删除 / 退役冻结两码（S45），以及标签判据 / 词表丢失 / 未完成录入事务三码
 * （knowledge-direct-intake，功能规格 §2.103.11）。
 */
export const KNOWLEDGE_L10_CODES = [
  'knowledge_entry_invalid',
  'knowledge_reference_unknown',
  'knowledge_id_duplicate',
  'knowledge_removal_forbidden',
  'knowledge_retired_id_mutated',
  'knowledge_tag_unknown',
  'knowledge_tags_missing',
  'knowledge_apply_incomplete',
] as const;

export function withKnowledgeCodes(codes: readonly string[]): string[] {
  const out: string[] = [];
  for (const code of codes) {
    out.push(code);
    if (code === 'slice-task-state-inconsistent') out.push(...KNOWLEDGE_L10_CODES);
  }
  if (out.length !== codes.length + KNOWLEDGE_L10_CODES.length) {
    throw new Error('golden 违规码基线缺少插入锚 slice-task-state-inconsistent');
  }
  return out;
}
