# Delta: core-S39-test-cases.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/test/core-S39-test-cases.md`

## REMOVED — S39 canonical closure 单一事务测试用例

canonical closure 经单一合并事务提交的用例随事务删除。闭包 apply 回归由 `openlogos merge` 直接完成，`applyBaselineClosureBatch` 原子落盘原语保留。

## REMOVED — S39 completed 提交闭包与 Git 白名单测试用例

completed receipt 的 `commit_paths` 与 Git 白名单依附于 receipt，随事务删除。

## REMOVED — S39 Seal-bound Preflight 与 Test-change-set 归因测试

seal 绑定 preflight 与归因依附于事务相位。`test_change_set` 结构化事实源本身保留，由 merge 直接构建并写入 `SPEC_MERGED`。
