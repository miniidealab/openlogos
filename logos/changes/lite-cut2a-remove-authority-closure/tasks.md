# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：删除 Authority Closure 权威闭包的验收要求整节；change-lint 检查项要求由 11 项改为 10 项。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：删除 Authority Closure（L10）功能小节与其分阶段校验小节；change-lint 级别表收敛为 L0–L9。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S04-scenario-architect.md`：scenario-architect 的 Authority Closure 场景建模节随 L10 删除；场景建模回归业务时序本身。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`：删除「新建 authority fact 提案的 proposal_step 可达性」与「围栏多命中致 authority CREATE 容错失效」两节——两者的验证对象都是 L10 的 plan 阶段容错。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S06-test-design.md`：test-writer 的 Authority Closure 八维测试矩阵节随 L10 删除。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：删除 authority_impact 生命周期时序节；merge 准入判定的表述由「L1–L10」改为「L0–L9」。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`：删除 Authority Closure JSON 合同节；change-lint envelope 的 issue 码表不再含 authority_closure_* 族。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：删除 Authority Closure candidate/回滚的安装态覆盖节。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md`：删除 L10 权威闭包检查节与分阶段校验节；change-lint 检查项由 11 项收敛为 10 项（L0–L9）。
- [x] [MODIFY] `deltas/spec/authority-closure.md`：Authority Closure 规范整体废止，正文收敛为废止说明与替代判据指引（0.15.0 打包时移除该文件）。
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：删除 change-lint envelope 的 authority_closure_* issue 码族与 evaluation schema（按子节锚删除，绕开重名标题）。
- [x] [MODIFY] `deltas/spec/change-management.md`：删除变更流程中 authority_impact 块的填写与门禁描述。
- [x] [MODIFY] `deltas/test/core-S04-test-cases.md`：整份删除 Authority Closure 场景建模用例（UT-S04-01～04、ST-S04-01 共 5 个）。
- [x] [MODIFY] `deltas/test/core-S05-test-cases.md`：整节删除 authority fact 可达性与围栏容错归因用例（7 个）。
- [x] [MODIFY] `deltas/test/core-S06-test-cases.md`：整份删除 Authority Closure 测试设计用例（UT-S06-01～06、ST-S06-01～02 共 8 个）。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：整节删除 authority_impact 生命周期用例（7 个）；merge 同源节的「L1–L9」表述改为「L0–L9」。
- [x] [MODIFY] `deltas/test/core-S16-test-cases.md`：整节删除 Authority Closure JSON 用例（4 个）。
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：整节删除 Authority Closure candidate/回滚用例（4 个）。
- [x] [MODIFY] `deltas/test/core-S35-test-cases.md`：删除 L10 两节（20 个）与围栏节中依附 L10 的 2 个用例；保留并改写与 L10 无关的围栏/诊断/ID 语法用例；新增 UT-S35-134/135、ST-S35-26。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S07-code-generation.md`：code-implementor / code-reviewer 的 Shadow Authority 实现与审查扩展节随 L10 删除。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S12-architecture-designer.md`：architecture-designer 的 Authority Registry 架构设计节随 L10 删除。
- [x] [MODIFY] `deltas/test/core-S07-test-cases.md`：整份删除 Shadow Authority 代码审查用例（8 个）。
- [x] [MODIFY] `deltas/test/core-S12-test-cases.md`：整份删除 Authority Registry 架构用例（7 个）。

## [code] 代码实现

- [x] 切片1：删除 L10 权威闭包——删除 `cli/src/lib/authority-closure.ts`(419)、`authority-candidate.ts`(100)、`authority-design-gates.ts`(219)，摘除其在 `change-lint.ts` / `plan-package.ts` / `plan-package-contract.ts` / `proposal-markers.ts` / `commands/change-lint.ts` / `i18n.ts` 的接线，change-lint 检查项由 11 项收敛为 10 项（L0～L9）；`change` 命令的提案模板不再生成 `## Authority Impact` 小节；存量 `authority_impact` 块一律忽略而非报错。删除 5 个 L10 专属测试文件（authority-closure / authority-candidate / authority-role-gates / s35-staged-authority-closure / s35-fence-scan-attribution，共 1165 行）。
- [x] 切片2：围栏与诊断用例脱离 authority 语境——`s35-fence-scan-attribution.test.ts` 随切片1 删除后，把其中与 L10 无关的两条（UT-S35-127 围栏提取同源、UT-S35-130 诊断点名具体对象）按已合并规格改写并迁入新的 `s35-fence-and-diagnostics.test.ts`：提取器对照组由 `authority-closure` 换为 `baseline-closure`/`clarification`/`ui-first`/`plan-package`，诊断断言对象由 fact_id 换为测试 ID / 文件路径 / 字段名 / 章节锚。