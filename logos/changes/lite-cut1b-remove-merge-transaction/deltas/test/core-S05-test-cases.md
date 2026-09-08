# Delta: core-S05-test-cases.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/test/core-S05-test-cases.md`

## REMOVED — S05 消费者动作与终态投影测试用例

`next` 携带事务 canonical 投影与 `allowed_actions` 指派动作的用例随合并事务删除。

## REMOVED — S05 Preflight Reopen Next 动作回归

preflight reopen 后的 next 权威动作依附于事务相位与 `missing_slot_ids`，随事务删除。

## REMOVED — merge 事务相位下的 next 引导测试用例

事务相位机随事务删除，不存在按相位分支的 next 引导。`next` 回归以 `SPEC_MERGED` 在场判定 spec-complete。
