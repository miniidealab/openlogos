# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/spec/baseline-closure.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S27-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S31-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S33-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S35-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S37-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S38-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：见 proposal 变更范围。

## [code] 代码实现

- [x] 切片1：章节锚序数消歧——`resolveSectionAnchor` 支持可选后缀 `[n]`，在路径锚过滤后的同名候选中按文档序选第 n 处；不带后缀时行为逐字节不变。`verifyAgentMaterialOutcome` 的 REMOVED 后置条件对序数锚改判「同名候选数恰好减一」（原判据「不再存在」对重复标题不成立）。
- [x] 切片2：lint-specs 重复标题检查 + L8 降级——`lint-specs` 增加 `duplicate_heading`，只报「文本与祖先链均相同」的重复（仅文本相同但祖先不同者可用路径锚消歧，不算缺陷）；change-lint 的 `delta_implicit_id_removal` 与 `delta_removed_unknown_id` 改走 warnings，`delta_section_anchor_unresolvable` 保持违规；merge 不再因守恒拒绝，改为打印告警后继续；change-lint 文本渲染按 code 打印告警（告警通道现承载多类）。