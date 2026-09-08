# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：删除 on-touch 基线闭包的验收要求整节；change-lint 检查项要求由 10 项改为 9 项；merge 目标集改由 delta 文件派生。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：删除 L9 基线闭包功能小节与 P==T==D 对账小节；新增「merge 目标集由 delta 文件派生」功能小节。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：删除闭包接入 change 生命周期的时序节；merge 准入时序改述为「目标集来自 deltas/ 枚举」。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md`：adopt→change 流程中「按触达场景建立 S39 闭包」的步骤与 AMBIGUOUS 阻断异常随 L9 删除；三处宿主段的闭包引用一并订正。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md`：删除 L9 闭包求值时序节；change-lint 检查项收敛为 L0～L8 共 9 项。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md`：场景主体由「按触达规格闭包」改写为「delta→canonical target 派生与 non-Markdown delta 协议」——保留的是路径映射与整文件 marker 协议，删除的是人工闭包规划。
- [x] [MODIFY] `deltas/spec/baseline-closure.md`：按触达目标规格闭包规范整体废止，正文收敛为废止说明与替代判据指引。
- [x] [MODIFY] `deltas/spec/change-management.md`：删除「按触达目标规格闭包（S39 / on-touch-v1）」整节。
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：删除 change-lint envelope 的 baseline_closure 摘要合同。
- [x] [MODIFY] `deltas/spec/logos-project.md`：删除「S39 元数据语义：按触达闭包不新增状态」整节。
- [x] [MODIFY] `deltas/spec/tasks-spec.md`：删除「on-touch-v1 的 delta 目标模式与唯一性」整节（含 proposal 权威闭包声明子节）。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：整节删除 S39 闭包接入 change 生命周期用例（8 个）；merge 同源节的闭包表述改为 delta 派生。
- [x] [MODIFY] `deltas/test/core-S20-test-cases.md`：删除依赖闭包的 UT-S20-17 与 ST-S20-12；其余 adopt/seed/journal 用例逐条保留。
- [x] [MODIFY] `deltas/test/core-S35-test-cases.md`：整节删除 L9 按触达规格闭包用例（44 个）；检查项收敛断言由 10 项改为 9 项。
- [x] [MODIFY] `deltas/test/core-S39-test-cases.md`：删除闭包规划与 CREATE 完整度、勘误通道用例；保留路径映射、整文件 marker 协议、change set 对账与 SQL 分层四组；新增 UT-S39-68/69、ST-S39-30。

## [code] 代码实现

- [x] 切片1：merge 目标集改由 delta 文件派生 + 删 L9——把 `lib/baseline-closure.ts`(1518) 拆分：路径映射迁入新模块 `lib/canonical-target.ts`、non-Markdown（OpenAPI/SQL）整文件协议迁入 `lib/non-markdown-delta.ts`，两者逐行保留；计划解析与闭包求值（parseBaselineClosurePlan / evaluateBaselineClosure / effectiveTargetView / scanCommittedEvidenceFiles / hasBaselineClosureSignal / parseBaselineClosureTaskTargets）整体删除。`mergeDirect.planDirectTargets` 改为对 `classifyProposalDeltas` 的可 merge 结果逐个映射 canonical target，模式按目标是否存在即时判定，不读 proposal 任何 YAML；同目标双 delta 与不可映射路径均在写入前 fail-closed。change-lint 摘除 L9（检查项收敛为 L0～L8 共 9 项），`non_markdown_delta_invalid` 由 L9 迁挂 L4，SQL 降级留痕改由 L4 的 degradations 汇集；违规码表由 47 收敛为 39。
- [x] 切片2：保留能力迁座与断言同步——`s39-baseline-on-touch.test.ts` 按存活集合裁剪并改名为 `s39-canonical-target-and-non-markdown.test.ts`（保留 UT-S39-03～06、UT-S39-26～27、ST-S39-13，删除 L9 闭包用例与 CREATE 完整度段）；`s39-errata-prose-channel.test.ts` 随勘误通道删除；SQL/OpenAPI 测试与 `frontier-fixture` 的导入与夹具同步去闭包化；UT-S35-134 的收敛断言由「上界 9」改为「上界 8」，ST-S20-10 的闭包表述随之订正。