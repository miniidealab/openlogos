# Delta: core-S19-test-cases.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/test/core-S19-test-cases.md`

## REMOVED — S19 OpenLogos 0.14.0 全局 candidate 测试用例

该组用例经合并事务命令面驱动 0.14.0 候选的安装态验收，随事务删除而失去驱动入口。

## REMOVED — S19 修正后 0.14.0 candidate 测试用例

同上，随事务命令面删除。

## REMOVED — S19 OpenLogos 0.14.2 候选与回滚测试

0.14.2 候选的验收对象是事务 preflight/reopen，随事务删除而失去验证对象。

**保留不变**：发布身份 tripwire（UT-S19-22 当前候选、UT-S19-40/41 历史锚、UT-S19-45 当前身份与回滚制品）与其 runner 接线逐条保留——它们不依赖事务命令面。
