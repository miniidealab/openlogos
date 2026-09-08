# Delta: tasks-spec.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`spec/tasks-spec.md`（项目根规范，权威）

## REMOVED — Delta closure 与 merge transaction 目标身份

delta 闭包与事务目标身份（`target_ref` / `slot_id` / staging 路径）的绑定随事务删除。Delta 闭包本身（P==T==D 与 canonical target 映射）保留，由 `openlogos merge` 在合并前直接校验；Driver 的完成证据回归「`SPEC_MERGED` 在场」这一单一判据，不再依赖 `submit-content` 与 quiescent 等待。
