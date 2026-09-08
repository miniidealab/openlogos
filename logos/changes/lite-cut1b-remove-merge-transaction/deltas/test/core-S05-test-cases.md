# Delta: core-S05-test-cases.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/test/core-S05-test-cases.md`

## REMOVED — S05 消费者动作与终态投影测试用例

`next` 携带事务 canonical 投影与 `allowed_actions` 指派动作的用例随合并事务删除。

## REMOVED — S05 Preflight Reopen Next 动作回归

preflight reopen 后的 next 权威动作依附于事务相位与 `missing_slot_ids`，随事务删除。

## REMOVED — merge 事务相位下的 next 引导测试用例

事务相位机随事务删除，不存在按相位分支的 next 引导。`next` 回归以 `SPEC_MERGED` 在场判定 spec-complete。

## REMOVED — S05 合并事务动作权威测试用例

`next` 的事务动作权威投影（collecting/waiting、allowed_actions、next_action、completion 命名空间隔离与 RunLogos 轮询分流）整节依附于合并事务相位机。事务删除后 `next` 在 merge 节点只有一个动作——`openlogos merge <slug>` 一次调用——不再有动作集合可投影，本节 12 条用例失去验证对象。`next` 对 merge 完成的判定回归 `SPEC_MERGED` 在场单一判据，其覆盖见既有 flow 派生用例。
