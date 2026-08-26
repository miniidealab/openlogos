# 变更提案：统一 Plan Package 完成合同并修复跨仓收敛缺口

> module: core | created: 2026-08-26 | target version: 0.13.31

## 变更原因

`logos/resources/reference/openlogos-runlogos-plan-package-convergence-cross-repo-fix-plan.md` 记录了一起跨仓事故：Agent 已填写 `proposal.md` 与 `tasks.md`，并把 `openlogos change-lint` PASS 当作 plan 已完成，但 OpenLogos `status/next` 仍派生为 `plan_ready=false`、`proposal_step=writing`，RunLogos 面板因此继续提示完善提案。

直接触发点是 proposal 的机器必需标题 `## 变更概述` 被自由改写，以及 CLI launched tasks scaffold 主动生成了 plan 阶段不应存在的 `- [ ] 实现代码变更`。根因是 CLI 模板、proposal/tasks 完成判断、flow 谓词、change-lint、status、next、change-writer 与插件安装态没有共享同一份完成合同，lint、状态机和宿主交付提示因而可能互相矛盾。

## 变更类型

需求级缺陷修复。它收紧用户可见的 plan 完成语义、CLI JSON 合同、Skill 生产规范与安装态资产一致性，须沿需求、设计、架构、场景、方法论、测试、实现和部署闭环；不涉及 HTTP API 或数据库。

## 变更范围

- 需求：`core-01-requirements.md` 中 S05、S08、S09、S11、S35。
- 功能规格：`core-01-feature-specs.md` 中 plan gate、change-lint、status/next、Skill/plugin 同步与机器契约自描述。
- 架构：`core-01-architecture-overview.md` 中统一 evaluator、locale-aware section registry、共享消费入口与资产 manifest/hash。
- 场景：修改 S05、S08、S09、S11 及场景总览；按 baseline-on-touch 创建当前缺失的 S35 正式场景实现文档。
- 方法论：根权威 `spec/change-management.md`、`spec/tasks-spec.md`、`spec/flow-spec.md`、`spec/cli-json-output.md` 及 status/next JSON Schema。
- Skill：根权威 `skills/change-writer/SKILL.md`、`SKILL.en.md`；插件副本由构建生成，不独立手改。
- 测试：S05、S08、S09、S11、S35 测试规格与 core smoke 规格；实现期同步 UT/ST、fixture/golden、OpenLogos reporter 与 smoke runner。
- 部署：目标候选版本 `0.13.31`，验证 npm tarball、全局 CLI、随包插件、Skill/hash、sync 与回滚；不授权公开发布。
- API：无 HTTP、RPC 或消息 API；CLI JSON 作为本地版本化机器合同更新。
- DB：无。
- API 编排测试：无；本地 CLI 跨命令闭环由 ST 与安装态 smoke 覆盖。
- UI/UX：无；RunLogos 面板改动属于独立 companion 提案。

## 变更概述

新增唯一的 `openlogos/plan-package-evaluation@1` 完成合同。proposal 必需章节、tasks plan/code 三态、澄清、部署一致性、baseline closure 与 UI 声明统一由 locale-aware evaluator 判定，change-lint、status、next 和 flow derive 只消费这一结论。plan 前沿必须满足 `change-lint PASS ⇔ plan_package.ready=true ⇔ plan_ready=true ⇔ proposal_step=ready-to-delta`；失败统一返回稳定的 `completion_issues[]`，包含问题码、文件、语义 section、实际值、期望值与修复提示。

同时修正 launched scaffold，使 plan 阶段的 `[code]` 仅保留空标题。change-writer 必须填充而非重建 CLI scaffold，写后从磁盘读回，并以 change-lint + next 双检查作为交付条件。根 Skill、生成插件、npm 制品、Codex cache 与项目 sync stamp 通过版本、合同版本及 SHA-256 manifest 对账。已存在 `PLAN_APPROVED`、`SPEC_MERGED`、`MERGED` 或 `VERIFY_PASS` 的历史提案不得回退。

OpenLogos 只在 `next_node.dispatch.completion` 中声明完成命令与期望，不实现 RunLogos WorkUnit 重试或 UI。RunLogos 应另建 `enforce-plan-producer-completion-barrier` companion 提案消费该合同，本提案不跨仓修改代码。

## 核心设计

1. 建立共享 `PlanPackageEvaluation` / `CompletionIssue` 类型与 locale section registry；必需章节须唯一、非空、无占位且字段合法。
2. tasks 判定拆为 `tasks_plan_filled`、`tasks_code_required`、`tasks_code_slices_filled`；plan 阶段空 `[code]` 合法，merge 后空 `[code]` 表示仍需 `plan-slices`。
3. change-lint 在 L1～L9 前增加 L0 完整性硬门；现有完成函数只作兼容 wrapper，不再持有独立判据。
4. change-lint/status/next/flow 对同一 fixture 输出同一 ready 与 issue；命令只读，issue 稳定排序。
5. `next_node.dispatch.completion` 自描述检查命令、JSON Pointer 期望与目标 `proposal_step`，宿主无需解析 Markdown。
6. 中英文 change-writer 保留 canonical scaffold、延后 code 切片、写后读回并双检查。
7. 生成 `openlogos/asset-manifest@1`，绑定 package version、plan contract version、模板与 change-writer SHA-256；`.openlogos-sync.json` 增加 `planContractVersion` 与 `managedAssetsHash`。
8. 历史已越过 plan 的提案只给非阻塞 warning；writing 中旧提案按新合同诊断，但只读命令不自动修复、审批或写 marker。

## 部署影响

- 是否需要部署：是
- 部署原因：模板、CLI 派生、Skill/插件制品和 sync 合同均变化，须以真实 0.13.31 tarball 验证安装态一致性。
- 影响环境：隔离临时 HOME/npm prefix/Codex cache，以及另获部署授权后的本机 npm 全局环境；不触达生产、公开 registry 或官网。
- 是否涉及数据迁移：否；sync stamp 仅向后兼容新增字段。
- 是否需要回滚预案：是；固定当前 0.13.30 制品与 SHA-256，验证 `0.13.31 → 0.13.30 → 0.13.31`。
- 是否需要 smoke：是
- 公开发布：不授权 npm publish、dist-tag、Git tag、GitHub Release、官网部署或 git push。

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
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
  touched_scenario_ids: [S05, S08, S09, S11, S35]
  targets:
    - category: requirement
      scenario_ids: [S05, S08, S09, S11, S35]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "统一五场景的 Plan Package 完成、诊断、同步与兼容验收。"
      evidence: ["target_exists: core-01-requirements.md", "scenarios_exist: S05/S08/S09/S11/S35"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S05, S08, S09, S11, S35]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "收敛 plan gate、change-lint、状态派生与资产同步规格。"
      evidence: ["target_exists: core-01-feature-specs.md", "sections_exist: 2.5a/2.28/2.30"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S05, S08, S09, S11, S35]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "定义 evaluator、locale registry、共享入口与资产 hash。"
      evidence: ["target_exists: core-01-architecture-overview.md", "implementation_map_exists: S05/S08/S09/S11"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S05, S08, S09, S11, S35]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-00-scenario-overview.md"
      reason: "登记 S35 并更新五场景依赖追溯。"
      evidence: ["target_exists: core-00-scenario-overview.md", "S35_missing_from_overview: true"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"
      reason: "next 输出统一完成合同与 dispatch completion。"
      evidence: ["target_exists: core-S05-next-guidance.md", "scenario:S05"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S08]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md"
      reason: "sync 写入资产合同版本/hash并诊断过期 Skill。"
      evidence: ["target_exists: core-S08-sync-ai-tools.md", "scenario:S08"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "修正 scaffold 与 plan gate 完成时序。"
      evidence: ["target_exists: core-S09-change-lifecycle.md", "scenario:S09"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md"
      reason: "status 经统一 evaluator 派生 plan_state 与 issues。"
      evidence: ["target_exists: core-S11-status-progress.md", "scenario:S11"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S35]
      mode: CREATE
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md"
      reason: "requirements/test 已定义 S35，但正式场景实现缺失，按 on-touch 补齐。"
      evidence: ["target_missing: core-S35-change-lint.md", "requirement_exists: S35", "test_exists: core-S35-test-cases.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S05, S08, S09, S11, S35]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "定义 0.13.31 制品、安装态核验与 0.13.30 回滚。"
      evidence: ["target_exists: core-01-deployment-plan.md", "proposal_decision: deployment_required"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S09, S35]
      mode: MODIFY
      delta_path: "deltas/skills/change-writer/SKILL.en.md"
      reason: "英文 producer 对齐同一机器合同。"
      evidence: ["target_exists: skills/change-writer/SKILL.en.md", "locale: en"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S09, S35]
      mode: MODIFY
      delta_path: "deltas/skills/change-writer/SKILL.md"
      reason: "中文 producer 保留 scaffold、延后切片并执行双检查。"
      evidence: ["target_exists: skills/change-writer/SKILL.md", "authority_source: root-skills"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S35]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "定义 canonical 章节、evaluator 与 producer/consumer 边界。"
      evidence: ["target_exists: spec/change-management.md", "contract_exists: change-lint"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S08, S11, S35]
      mode: MODIFY
      delta_path: "deltas/spec/cli-json-output.md"
      reason: "定义 plan package、completion issues 与 dispatch JSON。"
      evidence: ["target_exists: spec/cli-json-output.md", "commands: status/next/change-lint"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S09, S11, S35]
      mode: MODIFY
      delta_path: "deltas/spec/flow-spec.md"
      reason: "flow 谓词、plan 前沿与 completion 声明统一消费 evaluator。"
      evidence: ["target_exists: spec/flow-spec.md", "predicates_exist: proposal_filled/tasks_delta_filled"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/spec/schema/next.schema.json"
      reason: "扩展 next JSON Schema。"
      evidence: ["target_exists: spec/schema/next.schema.json", "schema_consumer: next"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/spec/schema/status.schema.json"
      reason: "扩展 status JSON Schema。"
      evidence: ["target_exists: spec/schema/status.schema.json", "schema_consumer: status"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/tasks-spec.md"
      reason: "定义 tasks 三态与空 code 锚点。"
      evidence: ["target_exists: spec/tasks-spec.md", "contract_exists: split-slice-planner-stage"]
      missing_evidence: []
    - category: test
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/test/core-S05-test-cases.md"
      reason: "覆盖 next、completion dispatch 与 ready 等价关系。"
      evidence: ["target_exists: core-S05-test-cases.md", "scenario:S05"]
      missing_evidence: []
    - category: test
      scenario_ids: [S08]
      mode: MODIFY
      delta_path: "deltas/test/core-S08-test-cases.md"
      reason: "覆盖 asset manifest、sync stamp 与缓存漂移。"
      evidence: ["target_exists: core-S08-test-cases.md", "scenario:S08"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "覆盖 scaffold、locale 标题、tasks 三态与历史兼容。"
      evidence: ["target_exists: core-S09-test-cases.md", "scenario:S09"]
      missing_evidence: []
    - category: test
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/test/core-S11-test-cases.md"
      reason: "覆盖 status 四方同源与只读性。"
      evidence: ["target_exists: core-S11-test-cases.md", "scenario:S11"]
      missing_evidence: []
    - category: test
      scenario_ids: [S35]
      mode: MODIFY
      delta_path: "deltas/test/core-S35-test-cases.md"
      reason: "覆盖 L0 issue、排序、exit code 与四方一致性。"
      evidence: ["target_exists: core-S35-test-cases.md", "scenario:S35"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S05, S08, S09, S11, S35]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "验证 0.13.31 tarball、插件/Skill/hash/cache/sync 与回滚。"
      evidence: ["target_exists: core-smoke-test-cases.md", "proposal_decision: smoke_required"]
      missing_evidence: []
    - category: api
      scenario_ids: [S05, S08, S09, S11, S35]
      mode: SKIP
      delta_path: null
      reason: "只改变本地 CLI 与文件合同，不新增网络端点。"
      evidence: ["architecture: local-cli-filesystem"]
      missing_evidence: []
    - category: database
      scenario_ids: [S05, S08, S09, S11, S35]
      mode: SKIP
      delta_path: null
      reason: "不使用数据库，不涉及迁移。"
      evidence: ["data_impact: none"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S05, S08, S09, S11, S35]
      mode: SKIP
      delta_path: null
      reason: "API 为 SKIP；CLI ST 与安装态 smoke 覆盖闭环。"
      evidence: ["api_disposition: SKIP", "test_strategy: cli-st-and-smoke"]
      missing_evidence: []
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: "不迁移业务数据；sync stamp 仅向后兼容新增合同版本与托管资产 hash。"
  compatibility:
    status: none
    reason: "新字段只增不改；已越过 plan 的历史提案不回退，旧消费方可忽略新增字段。"
  security_privacy:
    status: none
    reason: "不新增网络权限、Secret 或个人数据处理；安装态验证使用隔离环境。"
  public_release:
    status: none
    reason: "只规划 0.13.31 候选与本机验证；所有公开发布动作仍需另行授权。"
  external_commitment:
    status: none
    reason: "不修改远端或 RunLogos 仓库，不形成不可逆外部承诺。"
decisions:
  - id: C01
    category: deployment
    question: "本次修复采用什么候选版本、安装验证与发布边界？"
    answer: "按用户提供的跨仓修复计划，以 0.13.31 隔离候选验证真实 tarball、全局 CLI、插件/Skill/hash/cache/sync，并以 0.13.30 回滚；实际部署与 smoke 仍需后续独立授权，禁止公开发布。"
    rationale: "当前仓库版本为 0.13.30；下一 patch 能验证安装态收敛，同时严格保留参考计划声明的独立授权与无公开副作用边界。"
    source: user
    affects:
      - "0.13.31 版本元数据、npm tarball 与资产 manifest"
      - "本机全局安装、部署报告、smoke 与回滚恢复"
      - "npm publish、Git tag、GitHub Release、官网部署和 git push 继续禁止"
    rejected_options:
      - "同版本 0.13.30 原地覆盖不同 Skill/模板字节"
      - "不验证安装态，只运行仓库源码"
      - "在本提案中直接公开发布或修改 RunLogos"
unresolved: []
defaults:
  - id: DFLT-01
    category: architecture
    choice: "Plan Package evaluator 是完成语义的唯一事实源，旧函数只作兼容 wrapper。"
    reason: "确保 lint、status、next 与 flow derive 收敛。"
  - id: DFLT-02
    category: compatibility
    choice: "历史已越过 plan 的提案不回退；writing 中旧提案只诊断、不自动修复。"
    reason: "兼顾升级安全与只读边界。"
  - id: DFLT-03
    category: deployment
    choice: "以 0.13.30 为回滚基线规划 0.13.31 候选，部署与 smoke 等待独立授权。"
    reason: "当前仓库包版本为 0.13.30，patch 候选可隔离验证。"
```

## 验收边界

1. 中英文 scaffold 均含 locale canonical summary；必需章节缺失、重复、空、改名或残留占位时返回精确 issue。
2. launched tasks scaffold 不再生成代码 checkbox；需要代码的 plan 只保留空 `[code]` 标题。
3. plan 前沿满足 change-lint、plan package、status、next 四方 ready 等价。
4. 四个消费者使用同一 evaluator，issue 一致且所有只读命令前后文件集合/hash 不变。
5. change-writer 写后读回并执行 lint + next 双检查，未收敛时不得提示批准或写 Delta。
6. 根 Skill、生成插件、npm tarball、Codex cache 与 sync stamp 的版本、合同版本和 SHA-256 可对账。
7. 已越过 plan 的历史提案不回退；旧 CLI/宿主无法证明完成时保守兼容。
8. S35 正式场景文档包含目标、参与者、Mermaid 时序、步骤、异常与测试追溯并完成登记。
9. 所有新增 UT/ST/smoke 实现均写 OpenLogos reporter；候选制品可完成真实回滚恢复。
10. 不执行任何公开发布、官网部署或 git push。

## 非目标

- 不修改 RunLogos WorkUnit、UI 或自动重试实现；它们属于 companion change。
- 不在宿主新增 Markdown parser、标题表或 proposal_step 影子推导。
- 不让只读命令自动改 proposal/tasks、写审批 marker 或伪造完成。
- 本轮不产出 delta、不修改源代码、不部署、不 smoke、不公开发布。
