# 变更提案：lite-cut2a-remove-authority-closure

> module: core | created: 2026-09-08

## 变更原因

OpenLogos Lite 减法方案（`logos/resources/reference/openlogos-lite-simplification-plan.md` §4 第二刀）判定：change-lint 的 **L10 Authority Closure** 属于过度设计，成本高于收益，应整体删除。

具体依据：

1. **它要求人工预测「谁裁决事实」并逐 fact 枚举 15 个闭合字段**（`fact_id` / `authority_ref` / `sole_writer` / `mutation_entry` / `decision_api` / `freshness_proof` / `rebuild_rule` / `recovery_source` / `projections` / `retired_shadow_sources` / `forbidden_fallbacks` / `cutover` 四子字段 / `tests`）。这是让人做机器该做的事——真正可靠的判据是测试是否绿。
2. **它在起草阶段反复拦截作者本身**。本次减法的前两个提案（lite-cut1a / 1b）中，L10 共拦截 5 次，全部是字段名拼写与 YAML 形态问题（`writer` vs `sole_writer`、`projection` vs `projections`、`exit_evidence` 值以 `[` 开头被解析成流式序列），**没有一次拦下真实的权威设计缺陷**。
3. **它自身引入了新的失败面**：为支持「plan 阶段 `authority_ref` 可指向尚未创建的目标」，L10 自建了一份 `baseline_closure` YAML 解析器去收集 CREATE 目标（`collectPlannedAuthorityCreateTargets`），并因嵌套围栏多命中而需要专门的归因诊断（S05 / S35 各一整节测试）。这是「为绕过一道门而造第二道门」。

## 变更类型

设计级（删除一道 change-lint 检查项及其全部规格与测试）。

## 变更范围
- 影响的需求文档：`core-01-requirements.md`（删除权威闭包验收要求整节）
- 影响的功能规格：`core-01-feature-specs.md`（删除 L10 功能小节与分阶段校验小节）
- 影响的业务场景：S04、S05、S06、S09、S16、S19、S35
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无
- 影响的机器合同：`spec/authority-closure.md`（整体废止）、`spec/cli-json-output.md`（authority JSON 契约段）、`spec/change-management.md`（Authority Closure Plan 合同段）

## 部署影响
- 是否需要部署：否
- 部署原因：减法方案 §13 保险条款——全局 CLI 保持 0.14.25 直到 runlogos 侧改造完成，本提案只改仓库源码与规格
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

## Authority Impact

```yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: not_applicable
  evidence:
    - "本提案删除 Authority Closure 机制本身，不新增或转移任何业务事实的归属"
    - "被删除的是一道 lint 检查及其规格，不涉及运行时事实的写者、投影或 cutover"
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
    reason: 两处对外面均无在用消费方——存量 authority_impact 块自本提案起无解析方（改为忽略而非报错，向后兼容），authority_closure_* issue 码族的唯一消费方 runlogos 仍锁定全局 0.14.25（减法方案 §13 保险条款）
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
    question: 存量提案中已写的 authority_impact 块如何处理
    answer: 忽略而非报错——不解析、不校验、不迁移
    rationale: 该块自本提案起无消费方；若改为报错，历史提案在归档链上会无谓失败，且迁移脚本本身又是一处新的过度设计
    affects:
      - logos/changes/**/proposal.md
      - cli/src/lib/change-lint.ts
    rejected_options:
      - 保留解析并对非法块报错
      - 提供一次性迁移命令清理存量块
  - id: C02
    category: compatibility
    source: repository_fact
    question: change-lint envelope 的 authority_closure_* issue 码族如何退场
    answer: 从码表整体移除，spec/cli-json-output.md 与 spec/change-management.md 的对应合同段按**子节锚**逐节删除
    rationale: "runlogos 侧尚未对接 0.15.0（减法方案 §13 保险条款，全局仍为 0.14.25），此刻移除不影响任何在用消费方。两份规格中该节的 `## ` 标题各有两处字节相同的重复（cli-json-output 第 2773/2776 行、change-management 第 947/950 行），章节锚必然 ambiguous；改用各自唯一的 `### ` 子节锚（重名子节用 `父节 > 子节` 路径锚）即可精确删除内容，代价远低于 MODIFY 上级 H1 整节（分别 1675 / 652 行）。两个空标题壳留待后续清理。"
    affects:
      - spec/cli-json-output.md
      - spec/change-management.md
      - cli/src/lib/change-lint.ts
    rejected_options:
      - 保留码族但永不发射
      - MODIFY 上级 H1 整节以绕过重名标题
unresolved: []
defaults: []
```

## 变更概述

删除 change-lint 的 L10 Authority Closure 检查项，change-lint 由 11 项收敛为 10 项（L0–L9）。`proposal.md` 的 `## Authority Impact` 小节与其 `authority_impact` YAML 块不再被解析——存量提案中已存在的块被忽略而非报错。

代码侧删除 `cli/src/lib/authority-closure.ts`（419 行）、`authority-candidate.ts`（100 行）、`authority-design-gates.ts`（219 行）及其在 `change-lint.ts` / `plan-package.ts` / `proposal-markers.ts` / `i18n.ts` 的接线，并删除 5 个 L10 专属测试文件（1165 行）。`change` 命令的提案模板不再生成 Authority Impact 小节。

规格侧删除 7 个场景的 L10 相关章节与 61 个失去验证对象的测试用例；`spec/authority-closure.md` 收敛为废止说明。新增 UT-S35-134/135 与 ST-S35-26 锁定「检查项收敛为 10 项且其余级别结论零漂移」「存量 authority_impact 块被忽略不报错」。

**明确不做**：L9 基线闭包（下一刀）、L8 降级（见决策 C02 上方 D-CUT2A-2 的同源理由，推迟到 L9 之后）、verify 层级简化（O9，下一刀）。

**已发现的通用缺陷（本提案不修）**：`spec/cli-json-output.md`、`spec/change-management.md`、`spec/authority-closure.md` 三份文档各存在一处**字节完全相同的重复 `## ` 标题**（历史 ADDED delta 在正文中重复了控制块标题所致）。重复标题使该章节的锚永远解析为 ambiguous——**以 delta 机制永久不可寻址**。本次靠改锚到唯一子节绕过，但缺陷本身仍在。建议后续提案为 `openlogos lint-specs` 增加「同文件内重复标题」检查项，并清理存量空标题壳。

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
  touched_scenario_ids: [S04, S05, S06, S09, S16, S19, S35]
  targets:
    - category: requirement
      scenario_ids: [S04, S05, S06, S09, S16, S19, S35]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "删除 Authority Closure 权威闭包的验收要求整节；change-lint 检查项要求由 11 项改为 10 项。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S04, S05, S06, S09, S16, S19, S35]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "删除 Authority Closure（L10）功能小节与其分阶段校验小节；change-lint 级别表收敛为 L0–L9。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S04]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S04-scenario-architect.md"
      reason: "scenario-architect 的 Authority Closure 场景建模节随 L10 删除；场景建模回归业务时序本身。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S04-scenario-architect.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"
      reason: "删除「新建 authority fact 提案的 proposal_step 可达性」与「围栏多命中致 authority CREATE 容错失效」两节——两者的验证对象都是 L10 的 plan 阶段容错。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S06]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S06-test-design.md"
      reason: "test-writer 的 Authority Closure 八维测试矩阵节随 L10 删除。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S06-test-design.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "删除 authority_impact 生命周期时序节；merge 准入判定的表述由「L1–L10」改为「L0–L9」。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"
      reason: "删除 Authority Closure JSON 合同节；change-lint envelope 的 issue 码表不再含 authority_closure_* 族。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "删除 Authority Closure candidate/回滚的安装态覆盖节。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S35]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md"
      reason: "删除 L10 权威闭包检查节与分阶段校验节；change-lint 检查项由 11 项收敛为 10 项（L0–L9）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S35]
      mode: MODIFY
      delta_path: "deltas/spec/authority-closure.md"
      reason: "Authority Closure 规范整体废止，正文收敛为废止说明与替代判据指引（0.15.0 打包时移除该文件）。"
      evidence: ["target_exists: spec/authority-closure.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "删除变更流程中 authority_impact 块的填写与门禁描述。"
      evidence: ["target_exists: spec/change-management.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/spec/cli-json-output.md"
      reason: "删除 change-lint envelope 的 authority_closure_* issue 码族与 evaluation schema（按子节锚删除，绕开重名标题）。"
      evidence: ["target_exists: spec/cli-json-output.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S04]
      mode: MODIFY
      delta_path: "deltas/test/core-S04-test-cases.md"
      reason: "整份删除 Authority Closure 场景建模用例（UT-S04-01～04、ST-S04-01 共 5 个）。"
      evidence: ["target_exists: logos/resources/test/core-S04-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/test/core-S05-test-cases.md"
      reason: "整节删除 authority fact 可达性与围栏容错归因用例（7 个）。"
      evidence: ["target_exists: logos/resources/test/core-S05-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S06]
      mode: MODIFY
      delta_path: "deltas/test/core-S06-test-cases.md"
      reason: "整份删除 Authority Closure 测试设计用例（UT-S06-01～06、ST-S06-01～02 共 8 个）。"
      evidence: ["target_exists: logos/resources/test/core-S06-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "整节删除 authority_impact 生命周期用例（7 个）；merge 同源节的「L1–L9」表述改为「L0–L9」。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/test/core-S16-test-cases.md"
      reason: "整节删除 Authority Closure JSON 用例（4 个）。"
      evidence: ["target_exists: logos/resources/test/core-S16-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "整节删除 Authority Closure candidate/回滚用例（4 个）。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S35]
      mode: MODIFY
      delta_path: "deltas/test/core-S35-test-cases.md"
      reason: "删除 L10 两节（20 个）与围栏节中依附 L10 的 2 个用例；保留并改写与 L10 无关的围栏/诊断/ID 语法用例；新增 UT-S35-134/135、ST-S35-26。"
      evidence: ["target_exists: logos/resources/test/core-S35-test-cases.md"]
      missing_evidence: []
    - category: api
      scenario_ids: [S04, S05, S06, S09, S16, S19, S35]
      mode: SKIP
      delta_path: null
      reason: "无 HTTP/RPC 接口。"
      evidence: ["项目 logos/resources/api/ 为空"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S04, S05, S06, S09, S16, S19, S35]
      mode: SKIP
      delta_path: null
      reason: "不引入新组件或新边界；纯删除一道 lint 检查。"
      evidence: ["先例：lite-cut1a/1b 同类纯删除变更 architecture=SKIP"]
      missing_evidence: []
    - category: database
      scenario_ids: [S04, S05, S06, S09, S16, S19, S35]
      mode: SKIP
      delta_path: null
      reason: "无业务数据。"
      evidence: ["项目 logos/resources/database/ 为空"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S04, S05, S06, S09, S16, S19, S35]
      mode: SKIP
      delta_path: null
      reason: "不部署；全局 CLI 保持 0.14.25（减法方案 §13 保险条款）。"
      evidence: ["proposal 部署影响声明为否"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S04, S05, S06, S09, S16, S19, S35]
      mode: SKIP
      delta_path: null
      reason: "非 API 项目，无编排测试。"
      evidence: ["项目 logos/resources/scenario/ 为空"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S04, S05, S06, S09, S16, S19, S35]
      mode: SKIP
      delta_path: null
      reason: "无部署即无 smoke。"
      evidence: ["proposal 声明不需要 smoke"]
      missing_evidence: []
```
