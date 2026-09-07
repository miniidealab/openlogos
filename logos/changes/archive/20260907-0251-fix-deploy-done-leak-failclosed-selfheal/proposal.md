# 变更提案：fix-deploy-done-leak-failclosed-selfheal

> module: core | created: 2026-09-07

## 变更原因

来源于 20260907 真实事故（runlogos 面板僵死复盘）：`fix-guard-check-bash-write-target-jurisdiction` 提案在部署与 smoke 全部实际完成后，因执行 Agent 漏跑 `openlogos deploy-done`，`DEPLOY_DONE` 标记缺失，导致：

1. `openlogos smoke` 在 deploy 门未过的状态下照常执行并写入 `SMOKE_PASS`——但 `core-S19-smoke-gate.md` 的「smoke 前置依赖 deploy-done」章节**早已强制要求**「`DEPLOY_DONE` 存在 + `[deploy]` 全勾」为 smoke 前置校验，且要求缺标时提示先执行 `openlogos deploy-done`。实现（`cli/src/commands/smoke.ts`）完全没有该校验，属**规格已定、实现缺失**的缺陷。
2. `openlogos archive` 同样没有链条校验（`cli/src/commands/archive.ts` 不检查 `VERIFY_PASS` / `DEPLOY_DONE` / `SMOKE_PASS`），带着缺口的提案被成功归档。
3. `status` / `next` 的 step 派生（`flow-derive.ts`）在 `DEPLOY_DONE` 缺失时永远停在 `ready-to-deploy`，`SMOKE_PASS` 等下游强证据永远不被评估——矛盾状态（smoke 已过、deploy 未落标）**沉默停滞**，宿主面板长期显示「请执行部署任务」的僵死提示，无任何对账建议。
4. 场景总览把 S21（deploy-done 受控落标）标为「进行中」并链接 `core-S21-deploy-done-marker.md`，但该场景文档**不存在**——S21 的时序、异常与追溯从未文档化，是本次事故所涉闭环唯一缺文档的场景。

本提案按「B fail-closed 收口 + C 对账自愈 + A 规格闭包」三层修复：让漏标**造不出来**（B）、即使因历史/旁路存在也**藏不住**（C）、并补齐 S21 场景文档闭包（A）。

## 变更类型

设计级变更（feature-specs / 场景 / 测试 / 根 spec 契约 + 代码实现 + 部署发布）

## 变更范围
- 影响的需求文档：`prd/1-product-requirements/core-01-requirements.md`（S05/S09/S11/S19/S21 验收条件补充）
- 影响的功能规格：`prd/2-product-design/1-feature-specs/core-01-feature-specs.md`（§2.11 deploy-done 增补消费侧收口；新增生命周期 fail-closed 与状态对账功能小节；0.14.25 候选发布清单）
- 影响的业务场景：S19（smoke 前置 fail-closed 错误契约固化）、S09（archive 链条校验）、S05（next 对账建议）、S11（status 不一致投影）、S21（场景文档 CREATE 闭包）
- 影响的部署方案：`prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`（新增 0.14.25 本机全局部署章节）
- 影响的 API：无（CLI 项目，`logos/resources/api/` 为空；CLI JSON 契约变更单列于根 spec）
- 影响的 DB 表：无（`logos/resources/database/` 为空）
- 影响的编排测试：无（`logos/resources/scenario/` 为空，CLI 项目无 API 编排测试）
- 影响的 smoke 测试：`test/smoke/core-smoke-test-cases.md`（新增 0.14.25 安装态 fail-closed 与对账验收用例）
- 影响的根规格：`spec/cli-json-output.md`（smoke/archive fail-closed 错误码 + `state_inconsistency` 投影契约）、`spec/change-management.md`（archive 前置链条语义）
- 影响的决策记录：新增 `decisions/core-D12-*`（生命周期命令 fail-closed 与显式对账不变量）

## 部署影响
- 是否需要部署：是
- 部署原因：修复面为 `openlogos smoke` / `openlogos archive` / `status` / `next` 的 CLI 行为，需发布 0.14.25 候选并覆盖安装本机全局 prefix 才对使用者生效；本机 0.14.24 正带着漏标缺口运行（C01 用户决定：发 0.14.25 并本机部署）
- 影响环境：本地（本机全局 prefix `/opt/homebrew`）
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（0.14.24 tarball 回滚，沿用既有版本 roundtrip 惯例）
- 是否需要 smoke：是

## 已确定的设计决策

- 拟定 D12 — 生命周期命令 fail-closed 与显式对账不变量：**生命周期命令（smoke/archive 等）必须 fail-closed 校验其上游事实标记；status/next 检测到矛盾事实时必须显式输出对账建议，不得沉默停滞**。理由：本次事故证明「下游不设防 + 派生沉默停滞」会把单点遗漏放大为长期僵死状态；被否备选「smoke 检测到缺标时自动补写 DEPLOY_DONE（auto-heal）」因绕过半自动模式下 deploy-done 人类确认点语义、掩盖遗漏事实而被拒。

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: 只新增命令前置校验与只读派生投影，不触碰用户数据、无迁移（database/ 为空）
  compatibility:
    status: none
    reason: fail-closed 收紧即本提案既定目标且为 S19 既有规格的实现对齐（缺陷修复）；用户已在会话中明确选定该方向，无剩余用户选择
  security_privacy:
    status: none
    reason: 不新增权限、凭据、网络行为；校验仅读取提案目录内既有标记与 tasks.md
  public_release:
    status: none
    reason: 本次仅本机全局部署 0.14.25 候选，不含 npm publish / tag / GitHub Release（本地部署与公开发布分离原则）
  external_commitment:
    status: none
    reason: 无对外接口承诺变化；CLI JSON 仅新增可选字段（status schema additionalProperties:true）
decisions:
  - id: C01
    category: deployment
    source: user
    question: 本提案的发布与部署方式？
    answer: 发 0.14.25 并本机部署（推荐）
    rationale: 三处均为状态机守护性修复，早上线早止损；模块默认 deployment_required=true；沿用 0.14.24 部署惯例（候选身份全链同步、隔离矩阵、全局覆盖安装、回滚 tarball 预案、smoke 验证）
    affects:
      - tasks.md [deploy] section 的建立与内容
      - deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md（0.14.25 章节）
      - deltas/test/smoke/core-smoke-test-cases.md（0.14.25 安装态验收用例）
      - 0.14.25 候选身份全链同步（package/lockfile/plugin manifest/asset-manifest）
    rejected_options:
      - 仅合入仓库不部署（本机 0.14.24 将继续带缺口运行）
unresolved: []
defaults:
  - smoke fail-closed 错误码命名（如 SMOKE_DEPLOY_NOT_DONE）与 archive 链条校验错误码命名为可逆实现细节，delta 阶段在 S19/S09 场景与 cli-json-output 契约中定稿
  - state_inconsistency 投影字段形态（kind/evidence/remediation）为可逆实现细节，delta 阶段在 S11/S05 与 cli-json-output 契约中定稿
```

## UI/UX 变更声明

```yaml
ui_impact: false            # CLI 项目，非 GUI，整节不适用
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
    - "「deploy 完成」事实的 authority 零变化：DEPLOY_DONE 标记仍为唯一权威事实，唯一 writer 仍为 openlogos deploy-done 命令（含其 [deploy] 勾选同步与旧 smoke 标记清理职责），不新增、不迁移、不退休任何裁决者"
    - "smoke/archive 的 fail-closed 校验只是新增消费侧只读检查（读既有标记与 tasks.md），不写入任何新事实/marker/cache"
    - "state_inconsistency 为 status/next 每次调用的即时只读派生投影，不落盘、不缓存、无新鲜度问题，无 shadow source，无 cutover"
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
  touched_scenario_ids: [S05, S09, S11, S19, S21]
  targets:
    - category: decision
      scenario_ids: [S05, S09, S11, S19, S21]
      mode: CREATE
      delta_path: "deltas/decisions/core-D12-lifecycle-failclosed-reconciliation.md"
      reason: "沉淀不变量：生命周期命令 fail-closed 校验上游事实标记；status/next 对矛盾事实显式对账。含被否备选 auto-heal 的否决理由。"
      evidence: ["repo_fact: decision_counter.next_id=12，拟定 D12 由 merge-executor 定号"]
      missing_evidence: []
    - category: requirement
      scenario_ids: [S05, S09, S11, S19, S21]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "补充 S19 smoke fail-closed、S09 archive 链条校验、S05/S11 对账投影、S21 场景文档化的验收条件与 0.14.25 发布要求。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S05, S09, S11, S19, S21]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "§2.11 deploy-done 功能规格增补消费侧收口；新增生命周期 fail-closed 与状态对账功能小节；0.14.25 候选内容清单与发布验收。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"
      reason: "next 检测到矛盾事实（如 SMOKE_PASS 存在而 DEPLOY_DONE 缺失）时输出对账建议（补救命令 openlogos deploy-done），不再沉默重复 ready-to-deploy 引导。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "archive 新增链条校验：VERIFY_PASS 必备；需部署提案还须 DEPLOY_DONE + SMOKE_PASS，否则 fail-closed 并给出补救命令。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md"
      reason: "status 在 active_change 上新增可选 state_inconsistency 只读投影（kind/evidence/remediation），供宿主面板呈现对账提示。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "「smoke 前置依赖 deploy-done」既有章节从行为描述升格为可验收契约：固化 fail-closed 错误码、JSON 信封与提示文案。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S21]
      mode: CREATE
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S21-deploy-done-marker.md"
      reason: "场景总览已登记 S21 并链接本文件，但文件缺失；补齐 deploy-done 受控落标的完整场景文档（含时序、异常、追溯）。"
      evidence: ["target_missing: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S21-deploy-done-marker.md", "referenced_by: core-00-scenario-overview.md 第 66/83 行"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S05, S09, S11, S19, S21]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "新增 0.14.25 本机全局部署章节：候选身份全链同步、隔离验证矩阵、覆盖安装、回滚预案（0.14.24 tarball）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "补充 archive 前置链条语义（需部署提案 archive 前必须 DEPLOY_DONE + SMOKE_PASS）。"
      evidence: ["target_exists: spec/change-management.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S09, S11, S19]
      mode: MODIFY
      delta_path: "deltas/spec/cli-json-output.md"
      reason: "固化 smoke/archive fail-closed 错误码信封与 status/next 可选 state_inconsistency 字段契约。"
      evidence: ["target_exists: spec/cli-json-output.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/test/core-S05-test-cases.md"
      reason: "新增 next 对账建议 UT/ST（孤儿 SMOKE_PASS 场景输出补救命令；一致状态零投影）。"
      evidence: ["target_exists: logos/resources/test/core-S05-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "新增 archive 链条校验 UT/ST（缺 VERIFY_PASS / 需部署缺 DEPLOY_DONE / 缺 SMOKE_PASS 各自拒绝；无部署提案零回归）。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/test/core-S11-test-cases.md"
      reason: "新增 status state_inconsistency 投影 UT/ST（矛盾事实输出投影；一致状态不输出该字段）。"
      evidence: ["target_exists: logos/resources/test/core-S11-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "新增 smoke fail-closed 前置校验 UT/ST（缺 DEPLOY_DONE 拒绝并提示、[deploy] 未全勾拒绝、前置满足放行零回归）。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S21]
      mode: MODIFY
      delta_path: "deltas/test/core-S21-test-cases.md"
      reason: "S21 场景文档 CREATE 后补齐其测试维度物质目标：既有 UT-S21-* 覆盖 deploy-done 命令自身行为（零变化），新增消费侧收口与唯一 writer 不变量的回归用例。"
      evidence: ["target_exists: logos/resources/test/core-S21-test-cases.md", "repo_fact: cli/test/s21-deploy-done.test.ts 在套件内"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S05, S09, S11, S19, S21]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "新增 0.14.25 安装态验收用例：缺标 smoke 拒绝、缺链 archive 拒绝、对账投影出现、补标后全链放行、0.14.24↔0.14.25 roundtrip。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md"]
      missing_evidence: []
    - category: api
      scenario_ids: [S05, S09, S11, S19, S21]
      mode: SKIP
      delta_path: null
      reason: "CLI 项目无 HTTP API；CLI JSON 契约变更由根 spec/cli-json-output.md 承载（见 spec 类 target）。"
      evidence: ["repo_fact: logos/resources/api/ 为空目录"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S05, S09, S11, S19, S21]
      mode: SKIP
      delta_path: null
      reason: "不新增组件、流程或依赖；变更面为既有命令内前置校验与既有派生管线内的只读投影。"
      evidence: ["repo_fact: smoke.ts/archive.ts/flow-derive.ts 均为既有模块内改动，无新架构元素"]
      missing_evidence: []
    - category: database
      scenario_ids: [S05, S09, S11, S19, S21]
      mode: SKIP
      delta_path: null
      reason: "无持久化模型变化。"
      evidence: ["repo_fact: logos/resources/database/ 为空目录"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S05, S09, S11, S19, S21]
      mode: SKIP
      delta_path: null
      reason: "CLI 项目无 API 编排测试。"
      evidence: ["repo_fact: logos/resources/scenario/ 为空目录"]
      missing_evidence: []
```

## 变更概述

**B（fail-closed 收口，实现对齐既有规格）**：`openlogos smoke` 落地 S19 既有前置校验——提案声明需 smoke、部署决策无冲突、`DEPLOY_DONE` 存在、`[deploy]` 全勾，任一不满足即 fail-closed 返回错误信封并提示补救命令（缺标时提示先执行 `openlogos deploy-done`），绝不写 `SMOKE_PASS`。`openlogos archive` 新增链条校验：`VERIFY_PASS` 必备；需部署提案还须 `DEPLOY_DONE` + `SMOKE_PASS`。半/全自动两档语义不变——校验只关命令自身的前置事实，不新增人类确认点。

**C（对账自愈投影）**：`status` / `next` 派生停在 `ready-to-deploy` 但发现矛盾下游证据（`SMOKE_PASS` / `SMOKE_FAIL` 存在或 `[deploy]` 已全勾而 `DEPLOY_DONE` 缺失）时，在 `active_change` 上输出可选只读投影 `state_inconsistency`（kind / evidence / remediation），`next` 的引导文案同步给出一条命令的补救建议（`openlogos deploy-done`）。不改 `proposal_step` 派生本身，不写盘、不缓存；一致状态下字段不出现、零漂移。它同时治愈本次事故遗留的历史僵死状态与任何未来旁路。

**A（规格闭包）**：CREATE `core-S21-deploy-done-marker.md`，把 deploy-done 受控落标（verify 校验 → `[deploy]` 勾选同步 → 旧 smoke 标记清理 → 写标）的时序、异常与追溯文档化，接通场景总览已登记的引用；同时在 feature-specs §2.11 补上消费侧收口（smoke/archive/status/next 如何消费 `DEPLOY_DONE`）。随本案发布 0.14.25 候选并本机全局部署（C01），smoke 用例覆盖安装态 fail-closed 与对账行为及版本 roundtrip 回滚演练。
