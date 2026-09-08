# Delta: core-S27-test-cases.md

> change: lite-cut2c-spec-hygiene-and-anchors
> 目标：`logos/resources/test/core-S27-test-cases.md`

`openlogos lint-specs` 报告的 `table_column_mismatch`：UT-S27-32 行有 6 格而表头只有 5 列——「构造两例…」与「`status --format json` + schema」被多切了一刀。两格合回「输入」列，文字一字不改。

## MODIFIED — 单元测试用例补充

| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S27-26 | writing 驻留态不挂 loop_state | launched 提案刚创建（proposal_step=writing）、无 `SPEC_MERGED` | `status`/`next --format json` | 输出**不含** `loop_state` key；`facts.spec_complete:false` |
| UT-S27-27 | spec 阶段（delta 已写、未 merge）不挂 loop_state | `[delta]` 全勾、无 `SPEC_MERGED`（ready-to-merge / delta-writing 各一构造） | `status --format json` | 两驻留态均不含 `loop_state`；`step_meta`/`facts` 照常输出 |
| UT-S27-28 | ready-to-implement（已规划、待 slice-exit 批准）不挂 loop_state | `SPEC_MERGED` + `[code]` 脱模板、无 `SLICES_APPROVED` | `status`/`next --format json` | 不含 `loop_state`；`facts.slices_planned:true`、`facts.slices_approved:false`；`slice_state` 照常输出（常驻口径不变） |
| UT-S27-29 | 四事实齐备后挂出、activated_at 读自结构化 marker | `code_required=true` + `SPEC_MERGED` + `[code]` 脱模板 + 结构化 `SLICES_APPROVED`（JSON 单行、含 `approved_at`） | `status --format json` | `loop_state` 存在；`loop_state.activated_at` == marker 的 `approved_at`（ISO 8601）；同一磁盘状态重复派生结果逐字节一致（确定性） |
| UT-S27-30 | 旧空 SLICES_APPROVED marker → loop_state 挂出但省略 activated_at | 四事实齐备、`SLICES_APPROVED` 为旧格式空文件 | `status --format json` | `loop_state` 存在（旧空 marker 兼容视为已批准）；输出**不含** `activated_at` 字段 |
| UT-S27-31 | docs-only 提案永不挂 loop_state | 纯 `[delta]` 提案（`code_required=false`）、`SPEC_MERGED` 在场；launched flow 恒含 loop 定义 | 全流程各步 `status`/`next --format json` | 任一步骤均不含 `loop_state`；不因 launched flow 含 loop 定义而挂出 |
|  UT-S27-32 | until 闭合双值与 converged 分支求值（code_slices_green 不提前出环） | 四事实齐备（loop_state 已挂出） | 构造两例：(a) `[code]` 尚有未勾切片、末轮 verify 绿；(b) `[code]` 全勾、末轮绿。另以 schema 校验 until 值域；随后执行 `status --format json` + `spec/schema/status.schema.json` | (a) `converged:false`（`code_slices_green` = `section_complete:code ∧ tests_green`，切片未全勾时即便末轮绿也不出环，S31 FAIL-safe）；(b) `converged:true`；schema 锁定 `until ∈ {"tests_green","code_slices_green"}` 闭合双值，builtin launched 输出 `"code_slices_green"` 合法过校验  |

