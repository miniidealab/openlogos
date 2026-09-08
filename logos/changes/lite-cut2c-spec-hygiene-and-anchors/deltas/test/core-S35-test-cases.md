# Delta: core-S35-test-cases.md

> change: lite-cut2c-spec-hygiene-and-anchors
> 目标：`logos/resources/test/core-S35-test-cases.md`

## ADDED — S35 重复标题检查与 L8 强度测试

> 覆盖 `lint-specs` 的重复标题检查项，以及 change-lint 中 L8 条目守恒由违规降级为警告后的分级行为。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S35-136 | lint-specs 报告同文件内重复标题 | 构造：① 含两处字节相同 `## X` 的文件；② 仅标题级别不同但文本相同（`## X` 与 `### X`）；③ 全文件标题互不相同 | 对三例求 `lintSpecsIn` | ①② 报 `duplicate_heading` 并逐条列出各出现行号；③ 无该项发现。本检查项**不参与任何门**：同一状态下 `merge` 与 `verify` 均不因其结论阻断 |
| UT-S35-137 | L8 守恒码降级为警告且诊断不变 | 构造隐式删除 ID 的 delta 与 REMOVED-ITEMS 点名未知 ID 的 delta | 求 `runChangeLint` 结论 | 两码均出现在 `warnings`、不出现在 `violations`；退出码为 0；诊断的 code / path / message / fix_hint 与降级前**逐字相同**；`delta_section_anchor_unresolvable` 仍在 `violations` |

### 追溯与覆盖

- AC-LINT-DUP-01 重复标题可见且不参与门：UT-S35-136。
- AC-L8-WARN-01 守恒降级且诊断不变：UT-S35-137。
- 功能规格：§2.72.2、§2.73。
