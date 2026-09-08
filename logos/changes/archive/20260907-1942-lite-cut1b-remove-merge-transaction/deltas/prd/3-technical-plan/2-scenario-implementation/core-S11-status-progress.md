# Delta: core-S11-status-progress.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md`

## REMOVED — S11 合并事务只读状态投影

`status` 携带 `merge_transaction` 只读投影的时序随事务删除。合并完成度直接由 `SPEC_MERGED` 在场派生，`status` 不再输出该字段。
