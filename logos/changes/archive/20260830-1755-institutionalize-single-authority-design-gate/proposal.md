# 变更提案：institutionalize-single-authority-design-gate

> module: core | created: 2026-08-30

## 变更原因

`fix-merge-transaction-preflight-reopen` 的跨仓恢复复盘证明：最难彻底修复的不是某个字段写错，而是同一业务事实被多个组件分别保存、解释和裁决。此前 OpenLogos 与 RunLogos 都曾依据各自可见的文件、marker、状态投影或启发式规则判断“是否允许合并 / 是否已经合并”；响应丢失、进程重启、投影滞后或局部写入失败后，各副本会给出不同答案，补丁又容易继续增加 fallback 和影子权威。

现有 `core-D07-merge-transaction-single-authority.md` 已针对 merge transaction 冻结单一权威边界，但该教训仍未成为通用设计门：架构设计不强制盘点业务事实及 owner/writer，提案没有结构化 authority impact，时序图不区分权威读写与投影读取，部署方案不证明切换期无双写，测试缺少滞后/重启/响应丢失矩阵，代码审查也未把影子判据列为 Critical。

本提案把该教训制度化为 **Authority Closure（业务事实权威闭包）**：一个事实可以有多个物理副本，但只能有一个语义权威、一个受控变更入口和一套同源判据；缓存、索引、marker、receipt、状态页与跨进程副本必须是可验证、可重建、不可反向裁决的投影。

## 变更类型

需求级 + 架构级方法论变更，同时新增 Plan Package 机器门、CLI JSON 契约、Skill 行为合同和候选包部署验收。

## 变更范围

- 影响的需求文档：`core-01-requirements.md`，新增 Authority Closure 的用户问题、适用条件、不变量和验收条件。
- 影响的功能规格：`core-01-feature-specs.md`，新增 Authority Registry、`authority_impact`、共享 evaluator、Skill 分工与兼容体验。
- 影响的架构与决策：`core-01-architecture-overview.md`；新增 `core-D08-authority-closure.md`，记录单一语义权威、多投影可重建及拒绝长期双写的取舍。
- 影响的业务场景：S04 场景建模、S06 测试设计、S07 实现与代码审查、S09 变更规划、S12 架构设计、S16 机器输出、S19 部署/smoke、S35 change-lint；不新增场景 ID。
- 影响的方法论规格：新增 `spec/authority-closure.md`；修改 `spec/change-management.md`、`spec/cli-json-output.md`、`spec/flow-spec.md`。
- 重点影响的 Skill：`architecture-designer`、`change-writer`、`scenario-architect`、`deployment-designer`、`test-writer`、`code-reviewer`；已有中英双语文件同步修改，`deployment-designer` 当前只有中文源文件。
- 影响的 API：无 HTTP/RPC/消息 API；新增的是本地 Markdown/YAML 与 CLI JSON 合同。
- 影响的 DB 表：无。
- 影响的编排测试：API orchestration 不适用；由 CLI UT/ST、Skill 产物夹具、安装态 smoke 与 OpenLogos reporter 覆盖。
- 真实测试 ID 规划：S04 `UT-S04-01`～`04` / `ST-S04-01`；S06 `UT-S06-01`～`06` / `ST-S06-01`～`02`；S07 `UT-S07-01`～`06` / `ST-S07-01`～`02`；S09 `UT-S09-266`～`270` / `ST-S09-104`～`105`；S12 `UT-S12-01`～`06` / `ST-S12-01`；S16 `UT-S16-35`～`37` / `ST-S16-11`；S19 `UT-S19-26`～`28` / `ST-S19-17`；S35 `UT-S35-112`～`120` / `ST-S35-19`～`21`；smoke `SMOKE-core-163`～`167`。

## 变更概述

新增 `spec/authority-closure.md` 作为唯一规范源，定义业务事实、语义权威、sole writer、mutation entry、decision API、projection、freshness proof、rebuild/recovery source、shadow authority 和 cutover，以及 `AC-01`～`AC-08` 闭包判据。项目架构文档只保存本项目 Authority Registry 实例；Decision 只保存 why；六个 Skill 只引用规范并执行角色动作，禁止复制整套规则形成六个可独立演进的真相源。包、插件和 cache 中的 Skill 仍是根 `skills/` 的可校验生成投影。

`change-writer` 为新提案持久化唯一 `authority_impact`：`required` 时引用 Registry 的稳定 fact ID，列出投影、被退休的影子来源、切换/回滚边界与测试义务；`not_applicable` 时必须给可核验证据。`change-lint` 的共享 Plan Package evaluator 严格求值并产出同源 summary/violations；status、next、flow 只消费同一 evaluation，不重新解析散文或维护第二套完成判据。

architecture-designer 建立权威清单；scenario-architect 标明 authority read/write、projection refresh 与恢复；deployment-designer 设计单向切换、投影重建、freshness probe 和回滚界线；test-writer 生成滞后投影、冲突旧副本、并发 writer、响应丢失、重启和回滚测试；code-reviewer 将影子判据、绕过 mutation entry、从投影反推权威、无限期双写和启发式恢复列为 Critical。

## Authority Closure 核心合同

满足任一条件即必须声明 `authority_impact.applicability: required`：变更跨组件/进程/仓共享事实或完成谓词；变更 cache/index/marker/receipt/view 等投影；转移 owner/writer/mutation/recovery/cutover；消费者可能通过文件扫描、时间戳、存在性或启发式重算权威决定。纯文案、纯视觉、无事实归属变化的局部实现可 `not_applicable`，但不得以缺省或空区块绕过。

- **AC-01 唯一语义权威**：每个 `fact_id` 恰有一个 owner 与 canonical state；多物理副本不等于多权威。
- **AC-02 单一受控写入口**：sole writer 与 mutation entry 明确；其它组件只能请求变更或读取投影。
- **AC-03 投影血缘**：每个副本声明 authority 来源、生成方向和只读边界。
- **AC-04 新鲜度证明**：用 generation/version/hash/receipt 校验，不以本地 mtime 或文件存在代替。
- **AC-05 决策同源**：消费者调用 authority 的 decision/action 或共享 evaluator，禁止复制谓词、状态机和 fallback。
- **AC-06 恢复同源**：响应丢失、重启和残留场景只从 authority 恢复；投影可丢弃重建，不反向晋升。
- **AC-07 有限切换**：定义旧 writer 关闭、新 writer 开启、投影重建、回滚边界和退出证据；禁止无期限双写/双读裁决。
- **AC-08 可证伪验收**：覆盖冲突旧副本、滞后投影、并发写入、响应丢失/重启、切换回滚和被禁反推，并证明影子来源已删除或失去裁决能力。

每个 Authority Registry row 至少包含 `fact_id`、语义范围、authority owner、canonical state、sole writer、mutation entry、decision/read API、projection consumers、freshness proof、rebuild rule、recovery source、forbidden shadow sources、cutover exit。场景、部署、测试和审查只按 `fact_id` 引用，不复制 owner 表。

## 六个 Skill 的职责边界

- **architecture-designer**：主 producer；识别共享事实/完成谓词，建立或更新 Authority Registry，缺 owner/writer/mutation/recovery/cutover 时不得交付。
- **change-writer**：先查 Registry 与实现，再写唯一 `authority_impact` 并规划权威、投影、影子来源退休及测试 Delta；不得自造第二份 Registry。
- **scenario-architect**：把 command、authority write/read、projection refresh、consumer decision 与异常恢复画入时序；两个参与者都能裁决同一 fact 时回退架构阶段。
- **deployment-designer**：定义单向 writer 切换、停止旧 writer、重建/校验投影、回滚允许点与不可逆边界；长期双写不算完成方案。
- **test-writer**：从 Registry 与场景派生 Authority Closure 负向矩阵，为每个 applicable fact 建立 UT/ST/smoke 追溯。
- **code-reviewer**：验证只经 mutation entry 写权威、消费者不重算 decision、恢复不扫描投影猜状态、旧 writer/影子判据已退出；违反 AC-01～AC-07 定级 Critical。

## 机器门与同源投影

Plan Package evaluator 增加 `openlogos/authority-impact@1` 严格解析，新增稳定 violation：`authority_impact_declaration_missing`、`authority_impact_malformed`、`authority_fact_reference_missing`、`authority_closure_incomplete`、`authority_cutover_unclosed`。`change-lint --format json` 输出 `authority_closure` 摘要，包含 schema、applicability、facts total/closed、projection count、retired shadow source count、unresolved count 与 pass。

summary 只能由共享 evaluator 生成；status、next、flow 与 merge 前消费点引用同一 evaluation，不得另写关键词扫描或状态推断。机器门负责结构、引用、切换/测试义务与同源输出；故障注入和 code-reviewer 负责语义证伪，不声称静态 parser 能完全证明系统只有一个权威。

## 本提案的 Authority Impact（自举）

```yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [shared_business_fact, derived_projection, recovery_and_cutover]
  facts:
    - fact_id: methodology.authority-closure-contract
      change: create
      authority_ref: spec/authority-closure.md
      authority_owner: OpenLogos methodology specification
      canonical_state: root spec/authority-closure.md
      sole_writer: approved OpenLogos Delta merge transaction
      mutation_entry: openlogos merge transaction apply
      decision_api: AuthorityClosureEvaluator
      projections:
        - project architecture Authority Registry
        - six role-specific Skill instructions
        - change-lint/status/next/flow views
        - packaged plugin and synchronized project assets
      freshness_proof: source path plus packaged asset manifest hash
      rebuild_rule: regenerate package and synchronized assets from root spec and root skills
      recovery_source: root spec plus completed merge receipt
      retired_shadow_sources:
        - independently maintained complete authority rules inside each Skill
        - consumer-local plan readiness predicates
      forbidden_fallbacks:
        - infer authority from marker existence, mtime, directory scan, or stale projection
      cutover:
        old_writer_stop: remove role-local normative copies when role references are added
        new_writer_start: merge canonical spec and shared evaluator in one change
        rollback_boundary: before candidate package replaces installed OpenLogos
        exit_evidence: root/source/package hashes agree and smoke negative matrix passes
      tests: [UT-S35-112, UT-S35-120, ST-S35-19, ST-S35-21, SMOKE-core-163, SMOKE-core-167]
  unresolved: []
```

该区块是本次变更的计划输入，不是 `spec/authority-closure.md` 的第二份规范；合并后的根规范、架构 Registry 和 evaluator 分别承担合同、项目实例和判定职责。

## 兼容与非目标

- 新 scaffold 和仍处于 writing 的提案必须包含 `authority_impact`；已经越过 plan 或已归档的历史提案不倒退。
- 既有项目不一次性盘点全部事实；后续 authority-bearing change 按触达事实补齐，未触达事实不伪造历史 Why。
- 多数据库、多副本、缓存、读模型、事件日志和 receipt 仍可存在，但必须闭合派生方向、freshness、重建与不可反向裁决边界。
- 找不到唯一 owner、旧 writer 无法关闭、投影无法证明 freshness 或恢复仍依赖启发式时，plan 保持 blocked，不得写“后续处理”放行。
- 不引入全局 God service，不要求所有模块共用数据库/进程，不自动重构全部历史代码，不修改 HTTP API、DB schema、远程服务或 RunLogos 代码。
- proposal、Decision、Skill、Registry 与根规范分别承担计划、理由、执行角色、项目实例和规范合同，不复制成五份同义规则。

## 部署影响

- 是否需要部署：是
- 部署原因：除方法论文档外还会修改 `change-lint`/共享 evaluator、根 Skill 与打包资产，必须用真实 npm candidate 证明源码、插件/cache 和安装态行为一致。
- 影响环境：隔离 npm prefix 与本机候选 OpenLogos；不触达生产、远程 registry 或其它用户项目。
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；冻结当前版本、入口 realpath、tarball 与 asset manifest/hash，失败时恢复原版本。
- 是否需要 smoke：是
- smoke 范围：required/not_applicable、缺失/畸形声明、影子来源未退休、cutover 未闭合、status/next/flow 同源及六个 Skill/根规范/候选包 hash。

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

本案只修改方法论文档、Skill、CLI 本地输出和测试，不新增页面、面板、交互流程或视觉资产。

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data:
    status: none
    reason: 只新增设计元数据与只读评价结果，不迁移数据库、用户数据或历史 archive。
  compatibility:
    status: none
    reason: 严格门只作用于新 scaffold 和仍在 writing 的提案；历史前沿不倒退，项目按触达事实渐进补齐。
  security_privacy:
    status: none
    reason: 不读取 Secret、个人数据或仓库外内容，沿用项目根路径 containment。
  public_release:
    status: none
    reason: 只规划隔离/本机候选部署；公开 npm 发布、tag、release 和 git push 均未授权。
  external_commitment:
    status: none
    reason: 不新增第三方服务、账号、费用、SLA 或外部时间承诺。
decisions:
  - id: C01
    category: ownership
    question: Authority Closure 的规范、项目实例与角色执行规则分别由谁拥有？
    answer: spec/authority-closure.md 是唯一规范源；架构 Registry 是项目实例；六个 Skill 只引用规范并承担角色动作。
    rationale: 在六个 Skill 复制完整定义会让本次修复本身制造新的多真相源。
    source: user
    affects: [root methodology specification, project Authority Registry, six Skills and packaged projections]
    rejected_options: [只在 architecture-designer 中写规则, 在六个 Skill 复制完整检查表]
  - id: C02
    category: compatibility
    question: 是否要求历史项目和已越过 plan 的提案立即迁移？
    answer: 否；新/仍 writing 提案严格声明，历史前沿不倒退，Registry 按触达事实渐进闭合。
    rationale: 全量回填会伪造历史意图；on-touch 能不放松新门禁地逐步消除影子权威。
    source: user
    affects: [proposal lifecycle, brownfield architecture, change-lint diagnostics]
    rejected_options: [一次性重写历史资源与 archive, 对所有 legacy 永久静默放行]
  - id: C03
    category: deployment
    question: 如何证明根 Skill、候选包与 CLI evaluator 没有漂移？
    answer: 同一 change 交付根规范、根 Skill、共享 evaluator 与打包资产，用 manifest/hash、隔离安装和 smoke 负向矩阵闭环。
    rationale: 只改文档不能形成门，只改 CLI 又会让旧缓存 Skill 继续生效。
    source: user
    affects: [package build, asset manifest, local candidate and smoke]
    rejected_options: [只改 Skill 不改机器门, 只改 CLI 不更新 packaged Skill]
unresolved: []
defaults: []
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
  touched_scenario_ids: [S04, S06, S07, S09, S12, S16, S19, S35]
  targets:
    - category: decision
      scenario_ids: [S04, S06, S07, S09, S12, S16, S19, S35]
      mode: CREATE
      delta_path: "deltas/decisions/core-D08-authority-closure.md"
      reason: "记录单一语义权威、多可重建投影和拒绝长期双写的跨组件取舍。"
      evidence: ["target_absent: logos/resources/decisions/core-D08-authority-closure.md", "decision_counter.next_id: 8"]
      missing_evidence: []
    - category: requirement
      scenario_ids: [S04, S06, S07, S09, S12, S16, S19, S35]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "新增 Authority Closure 的问题、触发、不变量与验收。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S04, S06, S07, S09, S12, S16, S19, S35]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "定义 Registry、authority_impact、Skill 分工、共享 evaluator 与兼容体验。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S04, S06, S07, S09, S12, S16, S19, S35]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "建立项目 Authority Registry、投影血缘、writer/cutover 与共享求值边界。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S04]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S04-scenario-architect.md"
      reason: "时序显式区分 authority write/read、projection refresh 与恢复来源。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S04-scenario-architect.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S06]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S06-test-design.md"
      reason: "测试设计纳入 Authority Closure 故障与切换证伪矩阵。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S06-test-design.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S07]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S07-code-generation.md"
      reason: "实现/审查阻断影子权威、旁路写入、反向推断与长期双写。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S07-code-generation.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "plan 生命周期加入 authority_impact 生产、修复与完成门。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S12]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S12-architecture-designer.md"
      reason: "架构流程新增共享事实盘点和 Authority Registry。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S12-architecture-designer.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"
      reason: "定义 authority_closure summary、violations 与同源投影。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "部署/回滚/smoke 证明 writer 切换、投影重建与资产同源。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S35]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md"
      reason: "PlanPackageEvaluator 增加 Authority Closure 严格解析与唯一完成判据。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S04, S06, S07, S09, S12, S16, S19, S35]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "规划 candidate、asset hash、隔离安装、切换验证与回滚。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "proposal: deployment_required=true"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S12]
      mode: MODIFY
      delta_path: "deltas/skills/architecture-designer/SKILL.en.md"
      reason: "英文 Skill 同步 Authority Registry producer 合同。"
      evidence: ["target_exists: skills/architecture-designer/SKILL.en.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S12]
      mode: MODIFY
      delta_path: "deltas/skills/architecture-designer/SKILL.md"
      reason: "中文 Skill 增加事实盘点与 Authority Registry 门。"
      evidence: ["target_exists: skills/architecture-designer/SKILL.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S09, S35]
      mode: MODIFY
      delta_path: "deltas/skills/change-writer/SKILL.en.md"
      reason: "英文 Skill 同步 authority_impact 生产与闭包检查。"
      evidence: ["target_exists: skills/change-writer/SKILL.en.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S09, S35]
      mode: MODIFY
      delta_path: "deltas/skills/change-writer/SKILL.md"
      reason: "中文 Skill 增加 authority_impact 影响分析与交付门。"
      evidence: ["target_exists: skills/change-writer/SKILL.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S07]
      mode: MODIFY
      delta_path: "deltas/skills/code-reviewer/SKILL.en.md"
      reason: "英文 Skill 同步 shadow authority Critical 规则。"
      evidence: ["target_exists: skills/code-reviewer/SKILL.en.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S07]
      mode: MODIFY
      delta_path: "deltas/skills/code-reviewer/SKILL.md"
      reason: "中文 Skill 将影子判据、旁路写入、反推和长期双写列为 Critical。"
      evidence: ["target_exists: skills/code-reviewer/SKILL.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/skills/deployment-designer/SKILL.md"
      reason: "增加单向 writer 切换、投影重建、freshness probe 与回滚边界。"
      evidence: ["target_exists: skills/deployment-designer/SKILL.md", "counterpart_absent: skills/deployment-designer/SKILL.en.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S04]
      mode: MODIFY
      delta_path: "deltas/skills/scenario-architect/SKILL.en.md"
      reason: "英文 Skill 同步 authority/projection 时序规则。"
      evidence: ["target_exists: skills/scenario-architect/SKILL.en.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S04]
      mode: MODIFY
      delta_path: "deltas/skills/scenario-architect/SKILL.md"
      reason: "中文 Skill 增加 authority 参与方、命令/查询与恢复路径。"
      evidence: ["target_exists: skills/scenario-architect/SKILL.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S06]
      mode: MODIFY
      delta_path: "deltas/skills/test-writer/SKILL.en.md"
      reason: "英文 Skill 同步 Authority Closure 负向矩阵。"
      evidence: ["target_exists: skills/test-writer/SKILL.en.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S06]
      mode: MODIFY
      delta_path: "deltas/skills/test-writer/SKILL.md"
      reason: "中文 Skill 增加滞后、冲突、重启、双写与回滚用例。"
      evidence: ["target_exists: skills/test-writer/SKILL.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S04, S06, S07, S09, S12, S16, S19, S35]
      mode: CREATE
      delta_path: "deltas/spec/authority-closure.md"
      reason: "创建唯一规范源与 openlogos/authority-impact@1 合同。"
      evidence: ["target_absent: spec/authority-closure.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S35]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "把 authority_impact 纳入 proposal、plan 完成与历史兼容。"
      evidence: ["target_exists: spec/change-management.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S16, S35]
      mode: MODIFY
      delta_path: "deltas/spec/cli-json-output.md"
      reason: "定义 violations、summary、排序与同源消费。"
      evidence: ["target_exists: spec/cli-json-output.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S16, S35]
      mode: MODIFY
      delta_path: "deltas/spec/flow-spec.md"
      reason: "让 proposal_filled、status、next 与 flow 消费共享 evaluation。"
      evidence: ["target_exists: spec/flow-spec.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S04]
      mode: CREATE
      delta_path: "deltas/test/core-S04-test-cases.md"
      reason: "覆盖场景 authority 建模与冲突 writer 拒绝。"
      evidence: ["target_absent: logos/resources/test/core-S04-test-cases.md", "allocated: UT-S04-01..04, ST-S04-01"]
      missing_evidence: []
    - category: test
      scenario_ids: [S06]
      mode: CREATE
      delta_path: "deltas/test/core-S06-test-cases.md"
      reason: "覆盖故障矩阵、追溯与漏测拒绝。"
      evidence: ["target_absent: logos/resources/test/core-S06-test-cases.md", "allocated: UT-S06-01..06, ST-S06-01..02"]
      missing_evidence: []
    - category: test
      scenario_ids: [S07]
      mode: CREATE
      delta_path: "deltas/test/core-S07-test-cases.md"
      reason: "覆盖 shadow authority Critical 与修复闭环。"
      evidence: ["target_absent: logos/resources/test/core-S07-test-cases.md", "allocated: UT-S07-01..06, ST-S07-01..02"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "覆盖 authority_impact 生命周期与兼容。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md", "next_after: UT-S09-265, ST-S09-103"]
      missing_evidence: []
    - category: test
      scenario_ids: [S12]
      mode: CREATE
      delta_path: "deltas/test/core-S12-test-cases.md"
      reason: "覆盖 Registry 完整度与唯一 owner/writer。"
      evidence: ["target_absent: logos/resources/test/core-S12-test-cases.md", "allocated: UT-S12-01..06, ST-S12-01"]
      missing_evidence: []
    - category: test
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/test/core-S16-test-cases.md"
      reason: "覆盖 JSON shape、枚举与同源投影。"
      evidence: ["target_exists: logos/resources/test/core-S16-test-cases.md", "next_after: UT-S16-34, ST-S16-10"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "覆盖 candidate、asset hash、切换与回滚。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md", "next_after: UT-S19-25, ST-S19-16"]
      missing_evidence: []
    - category: test
      scenario_ids: [S35]
      mode: MODIFY
      delta_path: "deltas/test/core-S35-test-cases.md"
      reason: "覆盖 parser、五类 violation、排序与共享 evaluator。"
      evidence: ["target_exists: logos/resources/test/core-S35-test-cases.md", "next_after: UT-S35-111, ST-S35-18"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S04, S06, S07, S09, S12, S16, S19, S35]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "验证安装态 Skill/spec/hash、负向门禁、同源投影与回滚。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "next_after: SMOKE-core-162", "proposal: smoke_required=true"]
      missing_evidence: []
    - category: api
      scenario_ids: [S04, S06, S07, S09, S12, S16, S19, S35]
      mode: SKIP
      delta_path: null
      reason: "只修改本地文件/CLI/Skill 合同，不新增 HTTP、RPC 或消息接口。"
      evidence: ["logos-project.yaml: skip_phases includes api", "impact_scan: no API target"]
      missing_evidence: []
    - category: database
      scenario_ids: [S04, S06, S07, S09, S12, S16, S19, S35]
      mode: SKIP
      delta_path: null
      reason: "Registry 与 proposal 区块是文件规格，不新增实体、关系或数据迁移。"
      evidence: ["logos-project.yaml: skip_phases includes database", "proposal: data_migration=false"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S04, S06, S07, S09, S12, S16, S19, S35]
      mode: SKIP
      delta_path: null
      reason: "API 为 SKIP；由本地 CLI ST、安装态 smoke 与 reporter 验收。"
      evidence: ["api disposition: SKIP", "logos-project.yaml: skip_phases includes scenario"]
      missing_evidence: []
```

## 用户确认

本轮只完成影响分析、`proposal.md` 与 `tasks.md`，不产出 Delta。提案批准也不构成 `openlogos merge`、`openlogos verify`、部署、`openlogos smoke`、`openlogos archive`、公开发布或 `git push` 的授权。
