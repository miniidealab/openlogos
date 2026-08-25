# 变更提案：Qoder 原生 Adapter 与真实 CLI 验收

> module: core | created: 2026-08-25

## 变更原因

OpenLogos 已通过 ZCode 提案建立能力驱动的 `AiToolAdapterRegistry`、宿主无关 SessionContext/GuardDecision runtime、托管资产事务与真实 tarball 验收路径，但 Qoder 尚未进入稳定工具枚举、`all` 展开、init/adopt/sync/launch、插件打包与 guard 闭环。用户在 Qoder 中使用 OpenLogos 时，当前无法获得与 ZCode 同等级的原生插件发现、Skills/Commands/Agents、SessionStart 阶段上下文和 PreToolUse 写入硬门禁。

本次以加法方式实现 Qoder 薄 Adapter，复用既有 Registry 与共享 runtime，只在宿主边界处理 `.qoder-plugin/plugin.json`、Qoder 资产布局、环境变量和 Hook stdin/stdout/退出码映射。最终必须用本提案构建的真实 npm tarball 安装 OpenLogos CLI，并由真实 Qoder CLI 验证插件发现、上下文注入、允许/阻断、同步、launch、回滚与既有宿主回归；不执行任何公开发布。

## 变更类型

需求级变更

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 中 P02、S01、S08、S09、S14、S20 的宿主选择、资产部署、同步刷新、生命周期与 guard 验收条件。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` 中 Adapter capability、托管资产、Qoder 插件和 Hook 行为；`logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md` 中工具选择、执行反馈和错误提示。
- 影响的技术架构：`logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md` 中 Qoder 薄 Adapter、共享 runtime 复用、插件打包边界及 IDE/CLI 协议隔离；`logos/resources/decisions/core-D06-ai-tool-adapter-boundary.md` 中后续宿主落地证据与不变量。
- 影响的业务场景：S01、S08、S09、S14、S20；不新增场景编号。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 中真实 tarball、真实 Qoder CLI、隔离配置、证据和回滚。
- 影响的 API：无 HTTP、RPC 或消息 API；Qoder Hook stdin/stdout 是本地宿主插件协议，写入 Qoder 根规范。
- 影响的 DB 表：无。
- 影响的编排测试：无 API 编排测试；由 CLI 场景测试、Hook runtime 测试和真实 Qoder CLI smoke 覆盖。
- 影响的根规范：`logos/spec/agents-md.md`、`logos/spec/pretooluse-guard.md`，并新增 `logos/spec/qoder-plugin.md`。
- 明确非目标：不实现 TRAE/TraeCode、WorkBuddy 或其它新宿主；不改变未选择 Qoder 的历史配置语义；不承诺 Qoder IDE 与 Qoder CLI 使用完全相同的输出结构；不执行 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。

## 部署影响

- 是否需要部署：是
- 部署原因：CLI、Adapter、Qoder 插件模板和 npm 随包资产都会变化，必须以真实 tarball 安装并使用真实 Qoder CLI 验证插件与 hard guard 协议。
- 影响环境：staging（真实 tarball 安装 + 真实 Qoder CLI 验证）
- 是否涉及数据迁移：否
- 是否需要回滚预案：是
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

本案只修改 CLI 文本交互、本地插件资产与 Hook 行为，不触及网站、桌面 GUI 或移动界面；`core-01-cli-experience.md` 是 CLI 体验文本规格，不需要 UI 原型。

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
  touched_scenario_ids: [S01, S08, S09, S14, S20]
  targets:
    - category: decision
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: MODIFY
      delta_path: "deltas/decisions/core-D06-ai-tool-adapter-boundary.md"
      reason: "D06 已预留 Qoder 独立薄 Adapter，本案需记录实际协议映射、共享 runtime 复用与宿主不变量的落地结论。"
      evidence: ["target_exists: logos/resources/decisions/core-D06-ai-tool-adapter-boundary.md", "decision:D06#演进"]
      missing_evidence: []
    - category: requirement
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "Qoder 成为新的完整宿主目标，改变初始化、接入、同步、launch 与 guard 的用户可观察验收条件。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md", "requirements:P02,S01,S08,S09,S14,S20"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "既有 Adapter Registry 功能规格需加入 Qoder capability、原生插件布局、SessionStart 与 PreToolUse 行为。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md", "feature:2.38-public-adapter-registry"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S01, S08, S14, S20]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md"
      reason: "init/adopt 的 Qoder 选择、sync/launch 的资产反馈与错误提示属于 CLI 交互体验变更。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md", "artifact_type: CLI markdown without pages declaration"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "公共底座已存在，本案需定义 Qoder 薄 Adapter、插件 owner、Hook 协议映射、CLI/IDE 差异隔离和打包边界。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md", "architecture:28-AI-Tool-Adapter-Registry"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S01]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md"
      reason: "S01 需表达 Registry 解析 Qoder、原子部署原生插件/Skills/Commands/Agents/Hooks 与保护用户资产的完整时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md", "scenario:S01"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S08]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md"
      reason: "S08 需表达通过 Registry 幂等刷新 Qoder 托管资产、保持用户 settings 与插件、失败回滚及版本戳提交顺序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md", "scenario:S08"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "S09 需补充 Qoder SessionStart 上下文与 PreToolUse hard guard 随 proposal_step 收敛、每次调用重读状态的宿主链路。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md", "official:qoder-cli-hooks:https://docs.qoder.com/cli/hooks"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S14]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S14-launch-lifecycle.md"
      reason: "S14 launch 刷新需由 Registry 驱动并包含 Qoder launched 指令与插件资产，且只在全部 Adapter 成功后提交 lifecycle。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S14-launch-lifecycle.md", "scenario:S14"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S20]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md"
      reason: "S20 需支持选择 Qoder，并在不覆盖既有 AGENTS、Qoder settings 和非 OpenLogos 插件的前提下完成同等级接入。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md", "scenario:S20"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "CLI 与随包 Qoder 插件资产变化需要真实 tarball 安装、真实 Qoder CLI 验证、失败回滚和证据留存。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "module_policy: deployment_required=true", "user_decision: staging-real-tarball-real-qoder-cli-no-public-release"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S01, S08, S14, S20]
      mode: MODIFY
      delta_path: "deltas/spec/agents-md.md"
      reason: "Qoder 可读取项目指令和插件 Skills，需明确 AGENTS 托管片段、宿主技能路径、语言策略及用户内容保留规则。"
      evidence: ["target_exists: logos/spec/agents-md.md", "official:qoder-cli-plugin-reference:https://docs.qoder.com/cli/plugins-reference"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/pretooluse-guard.md"
      reason: "Qoder PreToolUse 必须复用既有写入门禁，定义工具名/输入字段归一化、permissionDecision、exit 2 与异常 fail-closed。"
      evidence: ["target_exists: logos/spec/pretooluse-guard.md", "official:qoder-cli-hooks:https://docs.qoder.com/cli/hooks"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: CREATE
      delta_path: "deltas/spec/qoder-plugin.md"
      reason: "现有根规范没有 Qoder `.qoder-plugin/plugin.json`、目录布局、Skills/Commands/Agents/Hooks、安装同步、CLI 协议与兼容契约。"
      evidence: ["target_absent: logos/spec/qoder-plugin.md", "official:qoder-cli-plugin-reference:https://docs.qoder.com/cli/plugins-reference", "proposal_scope: full Qoder CLI integration"]
      missing_evidence: []
    - category: test
      scenario_ids: [S01]
      mode: MODIFY
      delta_path: "deltas/test/core-S01-test-cases.md"
      reason: "补充 Qoder 参数解析、all 展开、capability、模板布局、打包、用户资产保护与幂等初始化 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S01-test-cases.md", "scenario:S01"]
      missing_evidence: []
    - category: test
      scenario_ids: [S08]
      mode: MODIFY
      delta_path: "deltas/test/core-S08-test-cases.md"
      reason: "补充 Qoder 同步刷新、旧配置兼容、用户 settings/插件保留、失败回滚、版本戳与重复执行 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S08-test-cases.md", "scenario:S08"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "补充 Qoder SessionStart、PreToolUse 字段映射、proposal_step allowlist、exit 2 阻断、每次调用重读与异常 fail-closed UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md", "scenario:S09", "official:qoder-hooks:SessionStart,PreToolUse"]
      missing_evidence: []
    - category: test
      scenario_ids: [S14]
      mode: MODIFY
      delta_path: "deltas/test/core-S14-test-cases.md"
      reason: "补充 launch 经 Registry 刷新 Qoder launched 资产、提交顺序、幂等与既有宿主回归 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S14-test-cases.md", "scenario:S14"]
      missing_evidence: []
    - category: test
      scenario_ids: [S20]
      mode: MODIFY
      delta_path: "deltas/test/core-S20-test-cases.md"
      reason: "补充存量项目选择 Qoder、settings/未知插件保护、配置持久化、事务回滚和后续 change 可达性 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S20-test-cases.md", "scenario:S20"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "部署后必须以真实 tarball 与真实 Qoder CLI 验证插件发现、Skills/Commands/Agents、SessionStart、PreToolUse allow/deny、幂等与既有宿主回归。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "proposal: smoke_required=true", "user_decision: real-Qoder-CLI-staging"]
      missing_evidence: []
    - category: api
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: SKIP
      delta_path: null
      reason: "本案只改变本地 CLI、文件资产和宿主 Hook 协议，不引入 HTTP、RPC 或消息 API。"
      evidence: ["architecture: local CLI and filesystem boundary", "proposal_scope: Qoder local plugin protocol"]
      missing_evidence: []
    - category: database
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: SKIP
      delta_path: null
      reason: "Qoder Adapter、插件模板和共享 runtime 不新增持久化实体、数据库查询或数据迁移。"
      evidence: ["architecture: static registry and filesystem assets", "deployment:data_migration=false"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: SKIP
      delta_path: null
      reason: "API 维度为 SKIP，因此不需要 API 编排测试；跨进程行为由 CLI ST、Hook runtime 测试和真实 Qoder CLI smoke 覆盖。"
      evidence: ["api_disposition: SKIP", "test_strategy: CLI-ST-and-real-Qoder-CLI-smoke"]
      missing_evidence: []
```

## 已确定的设计决策

- 延续 D06：Qoder 作为独立薄 Adapter 接入，Registry 拥有选择/capability 事实，共享 runtime 拥有 lifecycle、active change、`proposal_step` 和 guard 决策，Qoder Adapter 仅拥有 `.qoder-plugin` 布局、Qoder 环境变量、事件字段与输出/退出码映射。
- Qoder CLI 是本提案真实验收的权威宿主。若 Qoder IDE 与 CLI 的 Hook 输出结构存在差异，必须在宿主边界显式区分，不允许让共享 runtime 感知产品特有字段，也不以 IDE 合同测试替代真实 CLI smoke。
- `SessionStart` 成功时通过 `hookSpecificOutput.hookEventName="SessionStart"` 与 `additionalContext` 注入上下文；`PreToolUse` allow/deny 使用 Qoder 规定的 `permissionDecision`/`permissionDecisionReason`，安全阻断同时满足可观察 deny 与 exit 2，不把其它非零错误当作阻断成功。

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: "本案只新增静态 Adapter、插件模板和本地 Hook 映射，不迁移、覆盖或删除用户业务数据。"
  compatibility:
    status: none
    reason: "Qoder 以加法方式加入；未选择 Qoder 的历史单值/数组配置不变，all 扩展和既有宿主行为必须由回归测试证明。"
  security_privacy:
    status: none
    reason: "Qoder Hook 只读取项目内 OpenLogos 状态并调用既有 guard 决策，不新增 Secret、个人数据、网络访问或超出宿主项目信任模型的权限。"
  public_release:
    status: none
    reason: "本提案只授权规格、实现、staging 部署与 smoke，不授权 npm publish、Git tag、GitHub Release、官网部署或 git push。"
  external_commitment:
    status: none
    reason: "不引入付费服务、供应商 SLA、法律承诺或不可逆外部影响；真实 Qoder CLI 由 staging 环境按后续独立部署授权提供。"
decisions:
  - id: C01
    category: deployment
    question: "本案实现完成后，是否采用 staging 真实 tarball 安装，并使用真实 Qoder CLI 完成插件与 hard guard smoke，同时不执行任何公开发布？"
    answer: "确认用 staging 真实 tarball + 真实 Qoder CLI 验证，不执行公开发布。"
    rationale: "用户在创建提案时明确给出该边界；它能验证 npm 随包内容与真实宿主协议，失败时可卸载测试资产并恢复上一 tarball，同时不形成 npm、GitHub、官网或 git push 承诺。"
    source: user
    affects:
      - "staging 真实 tarball 部署方案"
      - "真实 Qoder CLI 插件与 hard guard smoke"
      - "制品、安装状态与回滚证据"
      - "公开发布非目标"
    rejected_options:
      - "仅执行本地合同测试，不使用真实 Qoder CLI"
unresolved: []
defaults:
  - id: DFLT-01
    category: compatibility
    choice: "保留现有 Claude Code、OpenCode、Codex、Cursor、ZCode 的标识、资产路径和用户可观察行为。"
    reason: "这是加法集成的兼容基线，可由现有回归测试与新增 all 展开测试验证。"
  - id: DFLT-02
    category: ownership
    choice: "共享 runtime 只拥有 OpenLogos 上下文与 guard 决策；Qoder Adapter 只负责协议转换和资产布局。"
    reason: "延续 D06 的单一事实源，避免 Qoder 包装器复制方法论状态机。"
  - id: DFLT-03
    category: compatibility
    choice: "本案以 Qoder CLI 协议和真实 CLI smoke 为验收权威，不推断 IDE 与 CLI 的产品特有输出结构完全相同。"
    reason: "Qoder 官方文档明确不同入口的 Hook 能力与部分输出结构可能不同，显式隔离可防止误复用。"
```

## 变更概述

本案在现有公共 Adapter 底座上新增稳定 id `qoder`、交互/参数解析、`all` 展开、capability manifest 与 Qoder 原生插件模板。`init`、`adopt`、`sync`、`launch` 继续只经 Registry 和托管资产事务编排；Qoder 资产包含 `.qoder-plugin/plugin.json`、OpenLogos Skills、Commands、必要 Agents、Hooks 和共享 Node.js runtime，并保留项目级 settings、用户插件、未知文件及 AGENTS 托管片段外内容。

Qoder SessionStart/PreToolUse 入口复用现有 SessionContextService/GuardDecisionService，每次 Hook 调用重新读取磁盘状态。Qoder Adapter 负责将 `session_id`、`cwd`、`tool_name`、`tool_input` 等字段归一化，并把共享结果映射为 Qoder `hookSpecificOutput`、`additionalContext`、`permissionDecision`、reason 与 exit 2；解析异常、未知写工具、路径逃逸或状态矛盾必须 fail-closed。

交付通过真实 npm tarball 和真实 Qoder CLI 在隔离 staging 中验收，覆盖插件安装/启用、资产发现、新 session 上下文、允许写入、阶段外写入阻断、sync/launch 幂等、用户资产保护、回滚和既有宿主回归。公开发布及 TRAE/WorkBuddy 兼容均不在本案范围内。
