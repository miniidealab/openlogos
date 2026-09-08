# 变更提案：lite-cut1b-remove-merge-transaction

> module: core | created: 2026-09-08
> 来源：`logos/resources/reference/openlogos-lite-simplification-plan.md`（2026-09-07 定稿）第四章「第一刀」+ 第十二章 O1/O3。
> 本提案是 Lite 减法序列的第二个，与已归档的 `lite-cut1a-remove-slice-transaction` 合为完整第一刀。

## 变更原因

减法方案第四章把合并事务列为「收益最大的一刀」，理由三条，本仓均有实证：

1. **三向死锁的直接成因。** 2026-09-07 现场：某提案的合并事务在 0.14.24 下 `completed`，CLI 升到 0.14.25 后 `reopen` 被合同兼容门拒、`abort` 被终态相位拒、`merge` 认为已完成——三个守卫各自正确，合起来是没有出口的房间。该分析已留存于 commit `af98384`；**事务删除后该死锁面整体消失，无需单独修复**。
2. **为不存在的并发写付费。** 事务用 content slot、staging、双哈希、seal preflight、receipt 保证「多方并发写同一批文件的原子性」，而实际写入方只有一个顺序执行的 AI，且 `logos/resources/` 受 git 跟踪——合并到一半失败 `git checkout logos/resources/` 一键回滚。
3. **成本可观测。** 一个 11 目标的提案要走 11×3 + 3 = 36 次 CLI 往返。本提案自身的前序（1a）实测：一次补删遗漏章节需要 `reopen` → `abort` → 恢复合并前 → 重新 `merge` → 重新提交 10 个 slot → seal → apply，仅为了改一节。

**合并引擎与事务外壳是分离的**（1a 已验证同构结论）：`cli/src/lib/markdown-section-authority.ts`（287 行，`composeOpenLogosMarkdown` / `verifyAgentMaterialOutcome`）才是真正执行 ADDED/MODIFIED/REMOVED 应用、章节锚唯一定位、标题层级 rebase 与物质结果复验的引擎；`cli/src/lib/merge-transaction.ts`（1,214 行）只是 slot / staging / sha256 / seal / apply / receipt / 相位机外壳。因此 O3「merge 改直接合并」**不是重写合并器，而是让 `merge` 命令直接循环调用已有引擎**——该引擎已被本仓多次真实合并验证（含 1a 自身的三轮合并）。

**范围边界（承 1a 的教训：先问「这东西还有用吗」，再问「它引用了将删的 API 吗」）**：本提案明确保留三类**能力与结构化事实源**，只删外壳：

| 保留项 | 为什么不能删 |
|---|---|
| `lib/markdown-section-authority.ts` | 合并引擎本体，含 `verifyAgentMaterialOutcome` 物质结果复验——它是「delta 是否真被正确应用」的判据，不是审计 |
| `lib/test-change-set.ts`(421) 与 `SPEC_MERGED` 中的 `test_change_set` | **结构化事实源**：由 `buildTestChangeSet` + `forwardMergeTestChangeSets` 构建，被 `verify`、`change-lint`、`test-slice-manifest` 三处消费。删事务不得连带删它，新 merge 必须逐字段复现该 marker 结构 |
| `lib/baseline-apply.ts` 的 `applyBaselineClosureBatch` | 原子落盘原语（temp + fsync + rename + 失败整批回滚），是「合并到一半失败不留半新半旧」的实现，直接复用 |

**seal preflight 的能力补偿**：seal preflight 承担了规格结构检查（重复 ID、表格列数）——减法方案 B 类第二项明确要求为其提供廉价替代，否则「这类污染会无声累积」。故本提案同时落地 **O8：`openlogos lint-specs` 独立命令**（重复 ID / 表格列数 / ID 格式，**不参与任何门**，用户主动跑或在 verify 输出为警告段），避免删除与补偿之间出现能力真空窗口。

**范围边界**：change-lint 的 L9 / L10 / L8 不在本提案内，归 2a/2b。

## 变更类型

设计级变更（功能规格 / 场景 / 根规范 / 测试规格 + 代码实现；无部署）

## 变更范围
- 影响的需求文档：`core-01-requirements.md`（合并事务单一权威、preflight/reopen、嵌套锚、终态出路、flow 契约自洽、canonical closure 单一事务等验收要求）
- 影响的功能规格：`core-01-feature-specs.md`（§2.44、§2.44.10、§2.46、§2.58、§2.60；新增「merge 直接合并」与「lint-specs」小节）
- 影响的业务场景：S05（merge 前沿事务事实）、S09（合并事务生命周期 / staging-abort-receipt / seal preflight / 嵌套锚 slot）、S11（status 事务投影）、S16（事务机器输出）、S19（事务安装态覆盖）、S39（canonical closure 单一事务）
- 影响的根规范：`spec/cli-json-output.md`（merge transaction envelope）、`spec/change-management.md`（事务化合并流程）、`spec/flow-spec.md`（事务前沿映射与兼容优先级）、`spec/tasks-spec.md`（Driver 完成证据中的 submit-content）
- 影响的 API / DB 表 / 编排测试：无
- 影响的 smoke 测试：无（本提案不发版、不部署）

## 部署影响
- 是否需要部署：否
- 部署原因：只改仓内代码与规格。按减法方案第十三章保险条款，**全局 CLI 保持 0.14.25 不动**直到 runlogos 侧改造完成；0.15.0 打包与发布归本序列最后一个提案。
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否（git 工作区即回滚点）
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
  applicability: required
  trigger_reasons:
    - ownership_or_cutover
    - derived_projection
  facts:
    - fact_id: merge-transaction.spec-mutability
      change: modify
      authority_ref: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md#authority-registry
      authority_owner: openlogos CLI merge 命令
      canonical_state: "logos/changes/<slug>/SPEC_MERGED（含 test_change_set 结构化字段）"
      sole_writer: openlogos merge <slug>（直接合并路径，一次调用完成）
      mutation_entry: cli/src/commands/merge.ts
      decision_api: "detectProposalStepViaFlow（spec-complete 判据）"
      freshness_proof: "SPEC_MERGED 每次读盘即时解析，无缓存、无相位机中间态；test_change_set 由同一次 merge 调用即时构建并写入"
      rebuild_rule: "合并中途失败即 git checkout logos/resources/ 回到合并前，重跑 openlogos merge 重建"
      recovery_source: "logos/changes/<slug>/deltas/ 原始 delta 文件与 git 工作区"
      projections: [status, next]
      retired_shadow_sources:
        - MERGE_TRANSACTION.json
        - MERGE_RECEIPT.json
        - merge-content/
        - merge-staging/
        - target_set_sha256
        - seal_sha256
        - 事务相位机与 allowed_actions 准入矩阵
      forbidden_fallbacks:
        - scan-merge-receipt-existence
        - scan-merge-transaction-phase
      cutover:
        old_writer_stop: 删除 merge transaction 命令族、lib/merge-transaction.ts 与 commands/merge-apply.ts；CLI 入口不再路由 merge transaction / merge-apply
        new_writer_start: merge.ts 直接循环调用 composeOpenLogosMarkdown 逐目标合成，交 applyBaselineClosureBatch 原子落盘，末步写含 test_change_set 的 SPEC_MERGED
        rollback_boundary: 合并失败即 git checkout logos/resources/ 回滚；0.15.0 全局安装前（最后一个提案）随时可回退到 0.14.25
        exit_evidence: openlogos verify 全绿；status/next 输出不再含 merge_transaction 字段；SPEC_MERGED 的 test_change_set 结构与消费方读取逐字段不变
      tests: [UT-S05-49, UT-S11-40]
    - fact_id: merge-transaction.terminal-outcome
      change: retire
      authority_ref: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md#authority-registry
      authority_owner: openlogos CLI merge 命令
      canonical_state: "logos/changes/<slug>/SPEC_MERGED 的在场"
      sole_writer: openlogos merge <slug>
      mutation_entry: cli/src/commands/merge.ts
      decision_api: "hasSpecCompleteMarker（spec-complete 判据）"
      freshness_proof: "marker 在场性每次读盘即时判定，无终态相位需要恢复"
      rebuild_rule: "删除 SPEC_MERGED 后重跑 openlogos merge 即重建"
      recovery_source: "logos/changes/<slug>/deltas/ 与 git 工作区"
      projections: [status, next]
      retired_shadow_sources:
        - 事务终态 completed/failed/aborted
        - reopen 通道与 MERGE_REOPENS.jsonl
        - recover/abort 终态动作
      forbidden_fallbacks:
        - scan-transaction-phase-for-merge-completeness
      cutover:
        old_writer_stop: 删除事务相位机与 reopen/recover/abort 终态动作
        new_writer_start: 合并完成度直接由 SPEC_MERGED 在场判定；重新合并即 git checkout 回滚后重跑 merge
        rollback_boundary: 无不可逆写入；0.15.0 全局安装前随时可回退
        exit_evidence: 不存在任何终态死锁面（reopen/abort/merge 三向互斥随事务一并消失）
      tests: [UT-S05-15, UT-S05-16]
  unresolved: []
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data:
    status: none
    reason: 无业务数据面；删除的是提案目录内的 CLI 私有运行态文件（MERGE_TRANSACTION.json / MERGE_RECEIPT.json / merge-staging / merge-content），结构化事实源 SPEC_MERGED 与其 test_change_set 字段保留
  compatibility:
    status: none
    reason: 破坏性变更本身即既定目标且已由用户拍板（直接发 0.15.0、不做兼容层）；本提案不发版
  security_privacy:
    status: none
    reason: 不新增权限、凭据或网络行为；删除的是流程门而非安全边界，guard 硬闸与人类授权点逐项保留
  public_release:
    status: none
    reason: 本提案不发版、不 npm publish、不 tag、不全局安装
  external_commitment:
    status: none
    reason: 消费方 runlogos 的适配归其自身改造（方案第十二章 R1），由用户按阶段 2 推进
decisions:
  - id: C01
    category: product
    source: user
    question: 第一刀拆分后先做 1a，1b 是否继续？
    answer: 是——用户 2026-09-08 指示「继续做 1b」
    rationale: 1a 已验证「删外壳保能力」的边界方法可行且 verify 全绿；两族命令彼此独立，1b 与 1a 无耦合
    affects: ['merge 事务命令族', 'merge 改直接合并', 'lint-specs 补偿']
    rejected_options: ['继续为事务加自愈（方案第一章已判定此路不通）']
  - id: C02
    category: product
    source: user
    question: seal preflight 的规格结构检查（重复 ID / 表格列数）随事务删除后如何补偿？
    answer: 同批落地 O8 独立命令 openlogos lint-specs，不参与任何门
    rationale: 承 1a 教训——删除能力必须同批给出替代，否则出现真空窗口。方案 B 类第二项明确要求：seal preflight 曾发现 UT-S48-30 被两个用例共用，删掉后这类污染会无声累积
    affects: ['新增 lint-specs 命令', 'verify 输出增加规格结构警告段']
    rejected_options: ['先删后补（留下能力真空窗口）', '把结构检查并入 change-lint（那是门，与「不参与任何门」冲突）']
  - id: C03
    category: acceptance
    source: user
    question: 本提案是否需要部署与 smoke？
    answer: 否——按方案第十三章保险条款，全局保持 0.14.25 直到 runlogos 改完
    rationale: 若此刻全局安装，runlogos 会立刻找不到命令而全面失效
    affects: ['部署影响声明', 'tasks.md 无 [deploy] section']
    rejected_options: ['本提案即发版并全局安装（违反保险条款）']
unresolved: []
defaults:
  - 'merge 直接合并复用 composeOpenLogosMarkdown 与 applyBaselineClosureBatch，不新写合并器与落盘原语——可逆实现细节'
  - 'SPEC_MERGED 的 marker 结构去掉 transaction_id / seal_sha256 / receipt_sha256 三个事务字段，保留 type / completed_at / test_change_set——可逆实现细节'
  - 'lint-specs 置于 cli/src/commands/lint-specs.ts，只读不写、不参与门——可逆实现细节'
```

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
  touched_scenario_ids: [S05, S09, S11, S16, S19, S39]
  targets:
    - category: requirement
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "删除合并事务单一权威、Preflight 与可修复 reopen、嵌套章节锚、终态出路与二次 merge 通道、merge 流程契约自洽等验收要求整节；新增 merge 直接合并与 lint-specs 的验收要求。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "删除 §2.44 合并事务单一权威、§2.44.10 Preflight 与局部 Reopen、§2.46 嵌套章节锚同源解析、§2.58 终态出路、§2.60 merge 流程契约自洽；新增「merge 直接合并」与「lint-specs 独立结构检查」功能小节。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"
      reason: "删除 merge 前沿事务事实相关时序节，next 回归以 SPEC_MERGED 在场判定 spec-complete。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "删除合并事务生命周期、公共 staging/abort/receipt、Seal Preflight 与 Legacy Reopen、嵌套锚 Slot、前沿推进等时序节；新增 merge 直接合并时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md"
      reason: "删除 status 的 merge_transaction 投影时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"
      reason: "删除 merge-transaction@1 机器输出、消费者 JSON 合同、投影必挂与失败路径结构化错误码等时序节。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "删除合并事务的安装态覆盖要求节。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"
      reason: "删除「canonical closure 进入单一 merge transaction」节，闭包 apply 回归直接由 merge 命令一次性提交。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "删除事务化合并流程段，merge 回归一次性直接合并描述。"
      evidence: ["target_exists: spec/change-management.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/spec/cli-json-output.md"
      reason: "删除 merge transaction 命令族 JSON envelope 合同；新增 merge 直接合并与 lint-specs 的输出契约。"
      evidence: ["target_exists: spec/cli-json-output.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S09]
      mode: MODIFY
      delta_path: "deltas/spec/flow-spec.md"
      reason: "删除事务前沿映射与兼容优先级段，merge 节点完成回归以 SPEC_MERGED 在场判定。"
      evidence: ["target_exists: spec/flow-spec.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/tasks-spec.md"
      reason: "删除 Driver 完成证据中依赖 submit-content 的段落。"
      evidence: ["target_exists: spec/tasks-spec.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/test/core-S05-test-cases.md"
      reason: "整节删除 merge 前沿事务事实用例（12 个）。"
      evidence: ["target_exists: logos/resources/test/core-S05-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "整节删除合并事务用例（47 个）；新增 merge 直接合并与 lint-specs 回归锚（新 ID 自 UT-S09-340 / ST-S09-140 起）。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/test/core-S11-test-cases.md"
      reason: "整节删除 status 的 merge_transaction 投影用例（8 个）。"
      evidence: ["target_exists: logos/resources/test/core-S11-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/test/core-S16-test-cases.md"
      reason: "整节删除事务机器输出用例（10 个）。"
      evidence: ["target_exists: logos/resources/test/core-S16-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "整节删除事务安装态覆盖用例（18 个）。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/test/core-S39-test-cases.md"
      reason: "整节删除 canonical closure 单一事务、completed 提交闭包与 seal-bound preflight 用例（12 个）。"
      evidence: ["target_exists: logos/resources/test/core-S39-test-cases.md"]
      missing_evidence: []
    - category: api
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "无 HTTP/RPC 接口。"
      evidence: ["项目 logos/resources/api/ 为空"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "不引入新组件或新边界；Registry 两个 fact 的变更由 authority_impact 承载。"
      evidence: ["先例：lite-cut1a 同类纯删除变更 architecture=SKIP"]
      missing_evidence: []
    - category: database
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "无业务数据。"
      evidence: ["项目 logos/resources/database/ 为空"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "本提案不部署；0.15.0 发版归后续提案。"
      evidence: ["proposal 声明 是否需要部署：否"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "无 API 编排测试。"
      evidence: ["api disposition=SKIP"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "不部署即无 smoke 用例变更。"
      evidence: ["deployment disposition=SKIP"]
      missing_evidence: []
```

## 变更概述

删除合并事务外壳，`openlogos merge <slug>` 回归**一次性直接合并**，并同批补上 seal preflight 被删后的能力替代。

**删**（约 1,870 行 + 5 个测试文件 2,101 行 / 107 个 ID）：`lib/merge-transaction.ts`(1,214)、`lib/merge-transaction-candidate.ts`(128)、`commands/merge-transaction.ts`(164)、`commands/merge-apply.ts`(364) —— content slot 与 staging、`submit-content` 逐 slot 提交与重读校验、`seal`/`seal_sha256`/seal preflight、`apply` 事务提交、`recover`/`abort`/`reopen` 终态动作、相位机与准入矩阵、receipt、`target_set_sha256`。

**改**：`commands/merge.ts` 改为直接合并——读 `deltas/` → 逐目标调 `composeOpenLogosMarkdown` 合成最终字节（内含 `verifyAgentMaterialOutcome` 物质结果复验）→ 交 `applyBaselineClosureBatch` 原子落盘 → 末步写含 `test_change_set` 的 `SPEC_MERGED`；失败提示 `git checkout logos/resources/` 回滚。

**加**：`commands/lint-specs.ts` —— `openlogos lint-specs` 独立结构检查（重复 ID、表格列数、ID 格式），**不参与任何门**，补偿 seal preflight 删除后的能力空缺。

**明确保留（不得触碰）**：`lib/markdown-section-authority.ts`（合并引擎与物质结果复验）、`lib/test-change-set.ts` 与 `SPEC_MERGED` 的 `test_change_set` 结构化字段（被 verify / change-lint / test-slice-manifest 三处消费）、`lib/baseline-apply.ts` 的 `applyBaselineClosureBatch`（原子落盘原语）、guard 硬闸、人类授权点、loop engineering、部署/smoke 命令族、1a 已确立的 `slice plan` 与 slice-checkpoint 增量验收。
