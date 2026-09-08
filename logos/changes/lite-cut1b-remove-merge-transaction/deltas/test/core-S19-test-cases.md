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

## REMOVED — S19 环境不具备显式 skip 与一次性用例终态重放测试

本节混装两组语义：环境不具备的显式 skip（与事务无关）与一次性用例的终态重放（UT-S19-32，判据是「目标事务已 completed 并随提案归档」）。事务删除后后者失去验证对象且节标题不再成立，故整节删除，前者三条单测与一条场景测原样迁至下一节，ID 沿用不变。

## ADDED — S19 环境不具备的显式 skip 测试

> 覆盖 runner 在环境不具备时的留痕义务、账本三态不混用、门禁判据不放宽。
>
> 这些规则**并非新语义**：已合并的「runner 接入要求」与「smoke skip 统计口径」早已规定 runner 对每个用例写 `pass|fail|skip`、skip 表示环境缺少外部依赖。本节的用例是把该规格**变成可执行的强制判据**——此前它只是文字，实现可以静默违反而不被发现。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-29 | 环境不具备时为全部 owned ID 写 skip，不静默零记录 | Step 3b→5b | 取一个依赖第三方宿主的 runner，清空其必需 env | 执行该 runner 并读账本 | 退出码 0；账本中该 runner 的**每个** owned ID 都有一条 `status:"skip"` 记录；记录数等于 owned ID 数，不多不少；**不得出现零记录退出** |
| UT-S19-30 | skip 记录携带机器可读的不适用原因 | §2.48.4 第 2 点 | 同上 | 读 skip 记录 | 每条记录含可读的缺失项标识（具体 env 名或制品名），能据其归因到「缺什么」；不得只有 `skip` 而无原因字段 |
| UT-S19-31 | 三态不混用：真实失败仍 fail，不得降级为 skip | EX-S19-NA-2 | env 齐备但注入一处真实断言失败 | 执行 runner 并判 Gate | 该用例记为 `fail`；Gate FAIL；**不得**因「环境相关」而被写成 skip；伪造 `pass` 填补覆盖同样被拒 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-18 | 账本从「同形沉默」变为「可审计不适用」，门禁判据未放宽 | Step 1→8 | 真实 CLI；同时存在环境具备与不具备的 runner | 清空账本 → 执行 smoke.command → 读 JSON 与 `smoke-report.md` | 不具备环境的用例全部以 skip 出现在 `skipped_cases` 并带原因，且**不再计入 uncovered**；具备环境的用例照常 pass/fail；`isPass` 公式未被修改——存在 fail 仍 FAIL、存在 uncovered 仍 FAIL；账本中不存在任何零记录退出的 runner |

### 追溯与覆盖

- AC-SMOKE-NA-01 全部 owned ID 留痕：UT-S19-29、ST-S19-18。
- AC-SMOKE-NA-02 不适用可审计且不计 uncovered：UT-S19-30、ST-S19-18。
- AC-SMOKE-NA-03 三态不混用、判据不放宽：UT-S19-31、ST-S19-18。
- 场景：S19 环境不具备的显式 skip；功能规格：§2.48.4～§2.48.5；架构：§三十九.2。
