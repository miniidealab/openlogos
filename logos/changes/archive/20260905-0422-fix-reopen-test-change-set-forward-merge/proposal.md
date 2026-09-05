# 变更提案：fix-reopen-test-change-set-forward-merge

> module: core | created: 2026-09-05

## 变更原因

来源：`logos/resources/reference/openlogos-merge-reopen-empty-test-change-set-bug-report.md`（cursor-adapter-parity 提案 0.14.17 现场实测，2026-09-05 记录）。

对 completed 合并事务执行受控 `reopen` 后，若修正 delta 只影响部分目标（其余目标幂等重放，before==after），重合并 apply 写入的 `SPEC_MERGED.test_change_set` 仅由**本次事务**的语义 before/after diff 计算——幂等测试目标全部算作零变化，`changed_test_ids` 为空或严重缺失。下游影响链：

1. `validateTestSliceManifest` 强制 `owned_test_ids ⊆ changed_test_ids`（violation `test-slice-test-id-unknown`），空集下任何切片都不能 own 本提案真实新增的测试 ID；
2. slice-aware verify 失去按切片归属豁免未完成切片 ID 的能力，多切片方案的「删后续证伪门」必然无法成立，切片规划被迫单切；
3. `TEST_SLICE_MANIFEST.json` 的 owned 维度失真（审计价值受损），只能以 `runner_selectors` 侧载真实 ID。

根因：`buildTestChangeSet`（`cli/src/lib/test-change-set.ts`）的 changed 判定只看当前事务快照对；`readTestChangeSet` 权威只认当前 `SPEC_MERGED.test_change_set`，且「归档事务/receipt audit-only、禁作 fallback 真相源」契约（正确地）禁止消费者自行读归档补齐——于是提案级测试变化事实在 reopen 重合并后系统性丢失，且无任何合法恢复通道。

## 变更类型
设计级

## 变更范围
- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 中 S09、S32 的 reopen 重合并与切片归属验收条件。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`（reopen 后 test_change_set 前滚合并语义）。
- 影响的业务场景：S09（merge 事务生命周期——apply 构建 change set 的前滚规则）、S32（切片规划——change set 的提案级语义与消费不变）。
- 影响的技术架构：`core-01-architecture-overview.md`（Authority Registry 新增 `test-change-set.proposal-scope` 行；apply 前滚组件职责）。
- 影响的部署方案：`core-01-deployment-plan.md`（新增 0.14.20 本机全局部署方案章节）。
- 影响的根规范：`spec/test-slice-manifest.md`（test_change_set 语义升格为提案级累计事实 + 前滚规则）、`spec/change-management.md`（reopen 重合并段补前滚合同）。
- 影响的 API：无（CLI 项目，无对外 API）。
- 影响的 DB 表：无。
- 影响的编排测试：无（无 API 编排）。
- 影响的 smoke 测试：`logos/resources/test/smoke/core-smoke-test-cases.md`（新增 SMOKE-core-191：安装态 reopen→幂等重合并→change set 前滚全链 + 0.14.19 对照复现空 change set）。

## 部署影响
- 是否需要部署：是
- 部署原因：缺陷存在于已安装的本机全局 CLI（0.14.19）——不部署则现场任何 reopen 后的提案仍被迫单切、owned 维度持续失真；跨仓 RunLogos driver 消费的也是安装态 CLI。
- 影响环境：本机 npm 全局 prefix（`/opt/homebrew`）
- 是否涉及数据迁移：否（已固化的历史 SPEC_MERGED 不迁移、不重写；新语义只作用于修复后发生的 apply）
- 是否需要回滚预案：是（固定回滚制品：0.14.19 tarball，SHA-256 `ad6575ded72996f9d4bd2b820c96f5358826cc97bd9f1d57f9f08b76bd8109c3`）
- 是否需要 smoke：是（SMOKE-core-191）

## UI/UX 变更声明

```yaml
ui_impact: false            # 纯 CLI 项目，且本次无 CLI 交互文案变化（apply 输出不变）
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## Authority Impact

```yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [shared_business_fact]
  facts:
    - fact_id: test-change-set.proposal-scope
      change: cutover
      authority_ref: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md#test-change-set-proposal-scope
      authority_owner: merge apply 的 test change set 构建器（buildMergePreflight 内唯一构建点，seal 与 apply 同源）
      canonical_state: SPEC_MERGED.test_change_set——「本提案引入/修改/删除了哪些测试 ID」的唯一持久化裁决事实；语义从「最近一次事务的快照 diff」升格为「提案级累计事实」（存在 reopen 留痕时由核心 apply 路径前滚合并归档 receipt 的 change set）
      sole_writer: openlogos merge 事务 apply（applyBaselineClosureBatch 原子落盘 SPEC_MERGED；前滚只发生在该 writer 内部）
      mutation_entry: openlogos merge transaction apply（含 reopen 重建后的二次 apply）
      decision_api: readTestChangeSet / validateTestChangeSet（消费接口与 schema openlogos/test-change-set@1 不变）
      projections: [TEST_SLICE_MANIFEST owned⊆changed 校验, slice-aware verify 的按切片豁免, slice-planner 的 C/R 唯一来源]
      freshness_proof: 消费者每次读取当前 SPEC_MERGED.test_change_set 并校验 payload hash 与 target after hash，无缓存
      rebuild_rule: change set 随 apply 重算重写；归档 receipt 仅在核心 apply 前滚时被受控读取，消费者不可读归档重算
      recovery_source: 提案目录 SPEC_MERGED、MERGE_REOPENS.jsonl 与 merge-transactions/ 归档 receipt（后者仅供核心前滚与审计）
      retired_shadow_sources: [transaction-local-diff-as-proposal-change-set]
      forbidden_fallbacks:
        - consumer-union-archived-receipts-to-adjudicate
        - derive-change-set-from-deltas-or-git
        - hand-edit-spec-merged-test-change-set
        - runner-selectors-as-authoritative-ownership
      cutover:
        old_writer_stop: 旧行为（changed/removed 只取当前事务快照 diff）在无 reopen 留痕的提案上与新行为逐字节一致，无需停写；有 reopen 留痕时旧语义即被前滚取代
        new_writer_start: buildMergePreflight 构建 change set 后，按 MERGE_REOPENS.jsonl 时序前滚合并各归档 receipt 的 test_change_set（changed=(prev∖cur_removed)∪cur_changed、removed=(prev∖cur_changed)∪cur_removed），targets/hash 保持当前快照，sha256 重算；祖先 receipt 身份失配 fail-closed
        rollback_boundary: 无数据迁移；回退即恢复快照 diff 语义，已按新语义写出的 SPEC_MERGED 仍是合法 v1 schema（消费者无感）
        exit_evidence: 安装态 smoke 全链「首次 merge 完整 change set → reopen → 部分幂等重合并 → SPEC_MERGED.changed_test_ids 仍含首轮全部 ID → 多切片 manifest owned 校验通过」（本提案新增 SMOKE-core-191 承载），且固定 0.14.19 对照复现空 change set（防断言空转）；前滚规则 UT/ST 见 deltas/test/ 规划
      tests: [UT-S32-43, UT-S32-44, ST-S32-15, ST-S32-16, SMOKE-core-181]
  unresolved: []
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: 无迁移——历史 SPEC_MERGED 不重写；新语义只作用于修复后发生的 apply，schema openlogos/test-change-set@1 不变
  compatibility:
    status: none
    reason: 消费接口（readTestChangeSet/validateTestChangeSet）与 schema 不变；无 reopen 留痕的提案行为逐字节不变；有留痕提案的 changed 集合只增不减，owned⊆changed 校验单调放宽
  security_privacy:
    status: none
    reason: 全部读写限于提案目录内既有产物，无新增敏感面
  public_release:
    status: none
    reason: 仅本机全局部署；不 npm publish、不 tag、不 GitHub Release、不官网发布、不 git push
  external_commitment:
    status: none
    reason: 无对外承诺变化；归档 audit-only 契约保持（前滚是核心 writer 内部受控读取，不开放消费者通道）
decisions:
  - id: C01
    category: deployment
    source: user
    question: reopen 后 test_change_set 前滚修复落地后，是否随本提案部署 0.14.20 到本机全局并 smoke？
    answer: 部署 0.14.20 + smoke（推荐）
    rationale: 缺陷存在于已安装全局 CLI（0.14.19），不部署则现场 reopen 后仍被迫单切；与既往修复先例一致。目标环境=本机全局 prefix，回滚制品固定 0.14.19 tarball（sha256 ad6575de…109c3），成功证据=隔离矩阵+SMOKE-core-191+Gate 3.8 PASS
    affects: [部署方案 0.14.20 章节, deploy 任务与回滚预案, SMOKE-core-191]
    rejected_options: [仅规格+代码不部署（修复效果推迟到下一部署窗口，现场规避措施继续生效）]
unresolved: []
defaults:
  - 前滚实现位置取 buildMergePreflight（seal/apply 共用的唯一构建点），保证 preflight 的 test_change_set_sha256 与最终 SPEC_MERGED 同源一致——可逆实现细节，不设用户问项
```

## 已确定的设计决策

- D11（拟定）：`SPEC_MERGED.test_change_set` 是**提案级累计事实**，非「最近一次事务的快照 diff」；reopen 重合并时由核心 apply 路径前滚合并归档 receipt（changed 取前滚并集、removed 后写胜出），归档事务/receipt 对**消费者**保持 audit-only——被否方案「消费者自行并集归档 receipt」因打破单一权威与 audit-only 契约被否。

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
  touched_scenario_ids: [S09, S32]
  targets:
    - category: decision
      scenario_ids: [S09, S32]
      mode: CREATE
      delta_path: "deltas/decisions/core-D11-test-change-set-proposal-scope.md"
      reason: "「提案级累计事实 + 归档对消费者 audit-only + 前滚仅在核心 writer 内」是后续 merge/切片/宿主变更必须遵守的不变量，且被否方案（消费者并集归档）将来可能被重新提出。"
      evidence: ["target_absent: logos/resources/decisions/core-D11-test-change-set-proposal-scope.md", "decision_counter.next_id: 11"]
      missing_evidence: []
    - category: requirement
      scenario_ids: [S09, S32]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "S09/S32 验收条件需补「reopen 重合并后 changed_test_ids 保持提案级完整」。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S09, S32]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "需成文 reopen 后 test_change_set 前滚合并的功能规格（触发条件、合并规则、fail-closed 边界）。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S09, S32]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "Authority Registry 需新增 test-change-set.proposal-scope 行（本提案 authority_ref 的 CREATE 目标）；apply 前滚组件职责入图。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md", "registry_fact: 现有 Registry 无 test change set 行"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "S09 需补 reopen 重建事务 apply 时的前滚时序（读 MERGE_REOPENS.jsonl → 受控读归档 receipt → 前滚合并 → 原子落盘）与异常边界。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S32]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md"
      reason: "S32 的 change set 语义描述需升格为提案级累计事实；消费侧（owned⊆changed、按切片豁免）行为不变需明示。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S09, S32]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "新增 0.14.20 本机全局部署方案（隔离矩阵含 reopen 前滚全链与 0.14.19 空 change set 对照，回滚制品固定 0.14.19 tarball）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "「completed reopen 与 SPEC_MERGED 生命周期」段需补前滚合同：重合并 apply 由核心路径前滚归档 receipt 的 change set，归档对消费者仍 audit-only。"
      evidence: ["target_exists: spec/change-management.md", "spec_fact: §1066-1080 现无前滚语义"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S32]
      mode: MODIFY
      delta_path: "deltas/spec/test-slice-manifest.md"
      reason: "test_change_set 权威段需成文提案级语义与前滚规则（schema 不变、合并算法、身份失配 fail-closed）。"
      evidence: ["target_exists: spec/test-slice-manifest.md", "spec_fact: §257 现表述为唯一持久化测试变化事实但未定义 reopen 语义"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "新增 UT-S09-309～312（前滚合并规则/身份失配 fail-closed/无留痕逐字节不变/preflight-SPEC_MERGED 同源）与 ST-S09-118～119（reopen 幂等重合并全链/多次 reopen 链式前滚）。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S32]
      mode: MODIFY
      delta_path: "deltas/test/core-S32-test-cases.md"
      reason: "新增 UT-S32-69～70（前滚后 owned⊆changed 通过/removed 后写胜出的消费行为）与 ST-S32-23（reopen 后多切片规划全链成立）。"
      evidence: ["target_exists: logos/resources/test/core-S32-test-cases.md"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S09, S32]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "新增 SMOKE-core-191：安装态 reopen→部分幂等重合并→change set 前滚→多切片 manifest 校验全链，含固定 0.14.19 对照复现空 change set。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md"]
      missing_evidence: []
    - category: api
      scenario_ids: [S09, S32]
      mode: SKIP
      delta_path: null
      reason: "CLI 项目，无对外 API；本次变更不触及任何 API 面。"
      evidence: ["project_fact: product_type=cli，logos/resources/api/ 无本域目标"]
      missing_evidence: []
    - category: database
      scenario_ids: [S09, S32]
      mode: SKIP
      delta_path: null
      reason: "无数据库；change set 持久化于提案目录 JSON marker。"
      evidence: ["project_fact: 无 logos/resources/database/ 本域目标"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S09, S32]
      mode: SKIP
      delta_path: null
      reason: "无 API 即无编排测试维度。"
      evidence: ["project_fact: API 维度 SKIP，编排随之不适用"]
      missing_evidence: []
```

## 变更概述

让 `SPEC_MERGED.test_change_set` 表达「**本提案**引入/修改/删除了哪些测试 ID」而非「最近一次事务改了哪些」：`buildMergePreflight` 构建 change set 后，若提案存在 reopen 留痕（`MERGE_REOPENS.jsonl`），按重开时序对每个归档 receipt 携带的 `test_change_set` 前滚合并——`changed = (prev_changed ∖ cur_removed) ∪ cur_changed`、`removed = (prev_removed ∖ cur_changed) ∪ cur_removed`，targets 与 before/after hash 保持当前事务快照，sha256 重算。祖先 receipt 身份（change/module/source）失配时 fail-closed 稳定码拒绝；abort 归档的事务无 receipt、天然不参与前滚。前滚发生在 seal/apply 共用的唯一构建点，preflight 的 `test_change_set_sha256` 与最终 `SPEC_MERGED` 同源一致。

消费侧零变化：`readTestChangeSet` 权威仍只认当前 `SPEC_MERGED`，schema `openlogos/test-change-set@1` 不变，归档事务/receipt 对消费者保持 audit-only。无 reopen 留痕的提案行为逐字节不变。

随提案冻结 0.14.20 候选身份并本机全局部署 + smoke（SMOKE-core-191，含固定 0.14.19 对照复现空 change set 死区，防断言空转）；回滚制品固定 0.14.19 tarball。
