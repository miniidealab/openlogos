# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/spec/flow-spec.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S05-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S11-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S20-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S33-test-cases.md`：见 proposal 变更范围。

## [code] 代码实现

- [x] 切片1：决策澄清由判定改为文档（O5）——删除 `lib/clarification.ts`(431) 及其在 plan-package / change-lint / proposal-lifecycle / plan-package-contract / commands/change-lint 的接线；`proposal_clarification_invalid` 与 `clarification_contract_invalid` 两码从码表移除（39→37）；status/next 不再发射 `plan_state.clarification`，`contractVersion` 摘掉 clarification 版本位；`isProposalTemplateFilled` 不再以澄清完成为条件。提案模板的「## 决策澄清」小节与 change-writer 填写约定逐字保留。
- [x] 切片2：UI provenance 与 seed 恢复门降警告（O6/O7）——merge 的 provenance 前置门与模块归属 fail-closed 改为打印告警后继续，原型落盘失败改为「跳过落盘并告警」（绝不静默写入未经批准的字节）；`spec/flow/overlays/gui-ui-first.yaml` 与项目实例 flow 移除 `verify-ui-provenance` overlay 节点，`GUI_OVERLAY_NODE_IDS` 收敛为单节点；`withRecoveredReadLocks` 对不可恢复 journal 改为隔离留存（重命名 `<run>.commit-journal.corrupt-<时间戳>.json`）后继续，可恢复路径与读锁竞争语义逐字不变。顺带修复 lite-cut2b 引入的回归：原型 `.html` 资产不得进入 merge 的 canonical target 派生集合。