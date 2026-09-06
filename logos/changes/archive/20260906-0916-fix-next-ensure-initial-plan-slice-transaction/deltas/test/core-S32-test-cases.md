# Delta: core-S32-test-cases.md（fix-next-ensure-initial-plan-slice-transaction）

## ADDED — 事务创建时机前移消费回归

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S32-71 | next 已建后 submit-content 幂等续用 | `next` 问即建创建事务 X 后执行 `submit-content --slot slot_codesection`：不重建（`transaction_id` 仍为 X）、slot 正常受理、phase 推进语义与懒创建路径逐项一致；后续 seal/apply 合同零变化 |
| UT-S32-72 | 懒创建路径零回归 | 无 `next` 前置（事务文件不存在）直接 `submit-content`：用即建照旧创建 initial-plan 事务并受理内容——行为与 0.14.22 逐项一致；终态事务在场时新一轮 `submit-content` 的归档让位语义不变 |

### 追溯与覆盖

- 前移后续用：UT-S32-71；懒创建兜底零回归：UT-S32-72。
- 场景：S32 initial-plan 事务创建时机前移；功能规格：§2.65.2 / §2.65.3；根规范：`spec/test-slice-manifest.md`（创建时机合同）。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S32"`；失败不得写 pass。
