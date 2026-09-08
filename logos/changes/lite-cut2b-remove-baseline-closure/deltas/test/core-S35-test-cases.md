# Delta: core-S35-test-cases.md

> change: lite-cut2b-remove-baseline-closure
> 目标：`logos/resources/test/core-S35-test-cases.md`

## REMOVED — 五、L9 按触达规格闭包测试（S39）

本节 44 个用例验证 L9 的全部判据：targets 严格解析与排序、canonical target 重复检测、touched 场景四维完备、SKIP/AMBIGUOUS 证据组合、P/T/D 集合对账、CREATE 完整度、effective view 叠加与非权威输入排除。L9 删除后整节失去验证对象。

change-lint 检查项收敛为 L0～L8 共 9 项，该收敛由本文件既有的 UT-S35-134 覆盖（其断言由「上界为 9」改为「上界为 8」）。

## MODIFIED — S35 change-lint 检查项收敛与存量 authority_impact 兼容测试


> 覆盖 L10 删除后 change-lint 的检查项集合、其余级别结论零漂移，以及存量提案中已写的 `authority_impact` 块被忽略而非报错（提案决策 C01）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-134 | 检查项集合收敛且其余级别零漂移 | 取一组既有提案夹具（含 legacy、含 required fact 历史块、含完整 delta 三类） | 对每个夹具求 `runChangeLint` 结论 | 检查项编号上界为 8（L0～L8，总数随 L7 等条件在场而变），不含任何 L9/L10 条目；`AUTHORITY_CLOSURE_ISSUE_CODES` 与 `BASELINE_CLOSURE_VIOLATION_CODES` 均不再出现在码表中；每个夹具在保留级别上的 violation 集合与各自变更前**逐条相同**（同 code、同 path、同 message） |
| UT-S35-135 | 存量 authority_impact 块被忽略而非报错 | 提案含形态各异的历史 `authority_impact` 块：完整 required、not_applicable、字段残缺、YAML 语法非法 | 求 `runChangeLint` 结论 | 四种形态**一律不产生任何 violation 或 warning**；块内容不被解析（断言不出现 fact_id/字段名相关诊断）；提案照常通过并可继续 merge |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S35-26 | 真实 CLI 下无 authority_impact 的提案全链通过 | 真实 CLI；一个 `proposal.md` **完全不含** `## Authority Impact` 小节的合规提案 | ① 跑 `change-lint --format json` 与文本形态；② 跑 `merge <slug>`；③ 用 `change` 新建一个提案并读其模板 | ① PASS，`data.violations` 为空，envelope 中不出现 `authority_closure_*` 码、无 authority 维度；文本形态列出的检查项编号上界为 9、无 L10 行（总数随 L7/L9 条件在场而变，最多 10 项）；② merge 成功并写 `SPEC_MERGED`，全程无「缺声明」类诊断；③ 模板不含 `Authority Impact` 小节与 `authority_impact` 字段 |

### 追溯与覆盖

- AC-CUT2A-01 检查项收敛且其余结论零漂移：UT-S35-134、ST-S35-26。
- AC-CUT2A-02 存量声明块忽略而非报错：UT-S35-135。
- 场景：S35 提案计划产物左移硬检查；功能规格：§2.51.2。

