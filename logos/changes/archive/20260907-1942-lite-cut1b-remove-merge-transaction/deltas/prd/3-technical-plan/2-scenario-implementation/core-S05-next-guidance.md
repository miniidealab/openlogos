# Delta: core-S05-next-guidance.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`

## REMOVED — 合并事务动作权威的 next 时序

`next` 携带事务 canonical 投影、由 `allowed_actions` 指派下一动作的时序，随合并事务删除。`next` 回归只读派生：spec-complete 与否直接由 `SPEC_MERGED` 在场判定，建议文案为「执行 `openlogos merge <slug>`」。

## REMOVED — S05 Preflight Reopen 后的 Next 权威动作

preflight reopen 后的权威动作指派依附于事务相位与 `missing_slot_ids`，随事务删除。

## REMOVED — S05 merge 事务各相位的 next 引导时序

事务相位机（collecting/ready/sealed/applying/completed/failed）随事务删除，不存在按相位分支的引导。
