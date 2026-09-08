# Delta: core-S39-baseline-on-touch.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md`

## REMOVED — S39 canonical closure 进入单一 merge transaction

canonical closure 经单一合并事务提交的时序随事务删除。闭包 apply 回归由 `openlogos merge` 一次调用直接完成——`applyBaselineClosureBatch` 原子落盘原语保留，只是不再包在事务相位机里。

## REMOVED — S39 Test-change-set Seal Preflight 与目标归因

seal 绑定的 test-change-set preflight 与归因依附于事务相位，随之删除。**注意**：`test_change_set` 本身作为结构化事实源保留，由 merge 直接构建并写入 `SPEC_MERGED`，消费方读取零改动。
