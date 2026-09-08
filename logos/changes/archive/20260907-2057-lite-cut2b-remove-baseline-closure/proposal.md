# 变更提案：lite-cut2b-remove-baseline-closure

> module: core | created: 2026-09-08

## 变更原因

OpenLogos Lite 减法方案 §4 第二刀的下半：删除 change-lint 的 **L9 on-touch 基线闭包**，`proposal.md` 的 `baseline_closure` YAML 块整体取消。

依据：

1. **它要求人工枚举「这次改动会波及哪些规格」**——让人预测传播范围是错误的分工。方案 §4 记录的实证是两处漏标直接导致主规格自相矛盾；本次减法自身也复现了同一模式：lite-cut1b 因漏标被 verify 逼出**三轮**返工（S09/S16/S19 → S32 → S05，共 204 个用例），lite-cut2a 又漏了 S07/S12 一轮。**四次漏标，全部由「测试是否绿」而非 L9 发现**。
2. **L9 自身是主要的起草期阻力**：targets 排序规范、逐场景四维强制、SKIP/AMBIGUOUS 证据组合，在本次减法的每个提案里都反复拦截作者，且拦下的全是格式问题。
3. **它逼出编造**：触达任一场景就要求 requirement/feature/scenario/test 四维目标齐备。当一处修复只涉及测试规格的表格格式（如 `core-S27-test-cases.md` 的列数缺陷），L9 会要求为该场景编造并不存在的场景文档变更——这是把合规变成了造假的诱因。本提案落地后该类修复无需任何计划。

**替代判据**：merge 的目标集不再来自人工计划，而是 **`deltas/` 目录的无逻辑投影**——每个可 merge 的 delta 经既有的 `canonicalTargetFromDeltaPath` 映射为唯一 canonical target，目标存在即 MODIFY、缺失即 CREATE。这比人工枚举更简单，且天然消除「计划声明 MODIFY 但目标不存在」这一整类失配。

## 变更类型

设计级（删除一道 change-lint 检查项，并改变 merge 目标集的事实来源）。

## 变更范围
- 影响的需求文档：`core-01-requirements.md`
- 影响的功能规格：`core-01-feature-specs.md`
- 影响的业务场景：S09、S20、S35、S39
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无
- 影响的机器合同：`spec/baseline-closure.md`（整体废止）、`spec/change-management.md`、`spec/cli-json-output.md`、`spec/tasks-spec.md`、`spec/logos-project.md`

## 部署影响
- 是否需要部署：否
- 部署原因：减法方案 §13 保险条款——全局 CLI 保持 0.14.25 直到 runlogos 侧改造完成
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data:
    status: none
    reason: 不触及任何持久化数据结构；被删除的是 proposal 文档中的一个 YAML 声明块
  compatibility:
    status: none
    reason: 两处对外面均无在用消费方——存量 baseline_closure 块自本提案起无解析方（忽略而非报错），change-lint envelope 的 baseline_closure 摘要唯一消费方 runlogos 仍锁定全局 0.14.25（减法方案 §13）
  security_privacy:
    status: none
    reason: 无安全或隐私面
  public_release:
    status: none
    reason: 0.15.0 打包但不全局安装，不做公开发布
  external_commitment:
    status: none
    reason: 无外部承诺
decisions:
  - id: C01
    category: compatibility
    source: policy
    question: 存量提案中已写的 baseline_closure 块如何处理
    answer: 忽略而非报错——不解析、不校验、不迁移
    rationale: 与 lite-cut2a 对 authority_impact 的处置一致；该块自本提案起无消费方，报错只会让历史提案在归档链上无谓失败
    affects:
      - logos/changes/**/proposal.md
      - cli/src/lib/change-lint.ts
    rejected_options:
      - 保留解析并对非法块报错
      - 提供一次性迁移命令清理存量块
  - id: C02
    category: compatibility
    source: repository_fact
    question: merge 的目标集改由 delta 派生后，CREATE 与 MODIFY 如何判定
    answer: 目标文件存在即 MODIFY、缺失即 CREATE，在 merge 执行时按磁盘事实即时判定
    rationale: 计划与磁盘事实分离正是「模式漂移」（plan 后目标被外部创建）这类失配的来源；即时判定使该失配在结构上不可能发生，UT-S39-07 因此失去验证对象
    affects:
      - cli/src/lib/merge-direct.ts
      - cli/src/lib/canonical-target.ts
    rejected_options:
      - 保留 proposal 中的 mode 声明并与磁盘事实对账
      - 由 tasks.md 的 [MODIFY]/[CREATE] 标记决定
unresolved: []
defaults: []
```

## 变更概述

删除 change-lint 的 L9 基线闭包检查项，change-lint 由 10 项收敛为 9 项（L0～L8）。`proposal.md` 的 `## 基线闭包计划` 小节与其 `baseline_closure` YAML 块不再被解析——存量块忽略而非报错。

**merge 目标集改由 delta 文件派生**：`mergeDirect` 不再读 proposal 的任何 YAML，改为对 `scanDeltas` 的结果逐个调 `canonicalTargetFromDeltaPath`，模式按目标文件是否存在即时判定。

代码侧把 `lib/baseline-closure.ts`（1518 行）**拆分而非整删**：路径映射与 non-Markdown delta 协议（`canonicalTargetFromDeltaPath` / `resolveCanonicalMergeTarget` / `classifyCanonicalTargetCategory` / `validateAndStripNonMarkdownDelta` / SQL 方言解析）迁入新模块 `lib/canonical-target.ts` 与 `lib/non-markdown-delta.ts` 逐行保留；计划解析与闭包求值（`parseBaselineClosurePlan` / `evaluateBaselineClosure` / `effectiveTargetView` / `scanCommittedEvidenceFiles` / `hasBaselineClosureSignal` / `parseBaselineClosureTaskTargets`）删除。

**保留不变**：`lib/baseline-apply.ts` 的原子落盘原语与恢复 journal（与闭包同名但语义无关——它做的是「主文档基线的原子提交」）、`baseline-seed-txn.ts` 的 adopted 项目 seed 事务。

**明确不做**：L8 降级、verify 层级简化（O9）、以及 lite-cut2a 遗留的三项（S27/S31 表格列数、重复标题可寻址性、SMOKE-core-163～167）——全部留待本提案落地后的 `lite-cut2c`，那时它们不再需要任何计划。

## 基线闭包计划

```yaml
baseline_closure:
  policy: on-touch-v1
  schema_version: 1
  unit: canonical-merge-target-path
  delta_cardinality: exactly-one-per-non-skip-target
  effective_view: merged-resources-plus-current-change-deltas
  ambiguity: block-before-existing-plan-exit
  standalone_baseline_required: false
  jit_confirmation: disabled
  touched_scenario_ids: [S09, S20, S35, S39]
  targets:
    - category: requirement
      scenario_ids: [S09, S20, S35, S39]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "删除 on-touch 基线闭包的验收要求整节；change-lint 检查项要求由 10 项改为 9 项；merge 目标集改由 delta 文件派生。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S09, S20, S35, S39]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "删除 L9 基线闭包功能小节与 P==T==D 对账小节；新增「merge 目标集由 delta 文件派生」功能小节。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "删除闭包接入 change 生命周期的时序节；merge 准入时序改述为「目标集来自 deltas/ 枚举」。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S20]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md"
      reason: "adopt→change 流程中「按触达场景建立 S39 闭包」的步骤与 AMBIGUOUS 阻断异常随 L9 删除；三处宿主段的闭包引用一并订正。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S35]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md"
      reason: "删除 L9 闭包求值时序节；change-lint 检查项收敛为 L0～L8 共 9 项。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"
      reason: "场景主体由「按触达规格闭包」改写为「delta→canonical target 派生与 non-Markdown delta 协议」——保留的是路径映射与整文件 marker 协议，删除的是人工闭包规划。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/spec/baseline-closure.md"
      reason: "按触达目标规格闭包规范整体废止，正文收敛为废止说明与替代判据指引。"
      evidence: ["target_exists: spec/baseline-closure.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "删除「按触达目标规格闭包（S39 / on-touch-v1）」整节。"
      evidence: ["target_exists: spec/change-management.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S35]
      mode: MODIFY
      delta_path: "deltas/spec/cli-json-output.md"
      reason: "删除 change-lint envelope 的 baseline_closure 摘要合同。"
      evidence: ["target_exists: spec/cli-json-output.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/spec/logos-project.md"
      reason: "删除「S39 元数据语义：按触达闭包不新增状态」整节。"
      evidence: ["target_exists: spec/logos-project.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/tasks-spec.md"
      reason: "删除「on-touch-v1 的 delta 目标模式与唯一性」整节（含 proposal 权威闭包声明子节）。"
      evidence: ["target_exists: spec/tasks-spec.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "整节删除 S39 闭包接入 change 生命周期用例（8 个）；merge 同源节的闭包表述改为 delta 派生。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S20]
      mode: MODIFY
      delta_path: "deltas/test/core-S20-test-cases.md"
      reason: "删除依赖闭包的 UT-S20-17 与 ST-S20-12；其余 adopt/seed/journal 用例逐条保留。"
      evidence: ["target_exists: logos/resources/test/core-S20-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S35]
      mode: MODIFY
      delta_path: "deltas/test/core-S35-test-cases.md"
      reason: "整节删除 L9 按触达规格闭包用例（44 个）；检查项收敛断言由 10 项改为 9 项。"
      evidence: ["target_exists: logos/resources/test/core-S35-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/test/core-S39-test-cases.md"
      reason: "删除闭包规划与 CREATE 完整度、勘误通道用例；保留路径映射、整文件 marker 协议、change set 对账与 SQL 分层四组；新增 UT-S39-68/69、ST-S39-30。"
      evidence: ["target_exists: logos/resources/test/core-S39-test-cases.md"]
      missing_evidence: []
    - category: api
      scenario_ids: [S09, S20, S35, S39]
      mode: SKIP
      delta_path: null
      reason: "无 HTTP/RPC 接口。"
      evidence: ["项目 logos/resources/api/ 为空"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S09, S20, S35, S39]
      mode: SKIP
      delta_path: null
      reason: "不引入新组件或新边界；纯删除一道 lint 检查并把目标集改为无逻辑投影。"
      evidence: ["先例：lite-cut1a/1b/2a 同类纯删除变更 architecture=SKIP"]
      missing_evidence: []
    - category: database
      scenario_ids: [S09, S20, S35, S39]
      mode: SKIP
      delta_path: null
      reason: "无业务数据。"
      evidence: ["项目 logos/resources/database/ 为空"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S09, S20, S35, S39]
      mode: SKIP
      delta_path: null
      reason: "不部署；全局 CLI 保持 0.14.25（减法方案 §13 保险条款）。"
      evidence: ["proposal 部署影响声明为否"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S09, S20, S35, S39]
      mode: SKIP
      delta_path: null
      reason: "非 API 项目，无编排测试。"
      evidence: ["项目 logos/resources/scenario/ 为空"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S09, S20, S35, S39]
      mode: SKIP
      delta_path: null
      reason: "无部署即无 smoke。"
      evidence: ["proposal 声明不需要 smoke"]
      missing_evidence: []
```
