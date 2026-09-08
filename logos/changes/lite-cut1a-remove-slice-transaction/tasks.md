# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：删除切片事务权威集中化、终态自校验与恢复入口、终态守门三分支、已完成规划受控重划等验收要求整节；新增 slice plan 单条受控写入口的验收要求
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：删除 §2.53、§2.55、§2.56；新增「slice plan 单条受控写入口」功能小节，并声明 slice-checkpoint 增量验收与结构化事实源保留
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：删除「S09 切片事务命令面与归档只读」时序节
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md`：移除「写入权转移后 verify 消费」中对事务相位的依赖；切片 checkpoint 与 final verify 时序逐字保留
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S28-next-node.md`：删除「恢复节点由建议改为创建事务」与「initial-plan 事务的问即建与投影输出」节
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md`：删除事务原子落盘 / 受控重划 / 问即建时序；新增 slice plan 单条写入口时序
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：删除 slice transaction 命令族 JSON envelope 合同段；新增 slice plan 输出契约
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：整节删除切片事务命令面用例（2 个）
- [x] [MODIFY] `deltas/test/core-S13-test-cases.md`：删除写入权转移的事务相位用例（1 个）；切片验收用例逐条保留
- [x] [MODIFY] `deltas/test/core-S28-test-cases.md`：整节删除恢复节点创建事务、重划入口与问即建用例（7 个）
- [x] [MODIFY] `deltas/test/core-S32-test-cases.md`：整节删除切片事务用例（24 个，含事务创建时机前移消费回归）；新增 slice plan 回归锚（新 ID 自 UT-S32-90 / ST-S32-40 起）

## [code] 代码实现

- [ ] 实现代码变更