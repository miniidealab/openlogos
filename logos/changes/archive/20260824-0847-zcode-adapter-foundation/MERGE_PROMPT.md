# 合并指令

## 变更提案
- 提案名称：zcode-adapter-foundation
- 提案目录：logos/changes/zcode-adapter-foundation/

## 提案内容

# 变更提案：公共 AI Tool Adapter 底座与 ZCode 完整集成

> module: core | created: 2026-08-21

## 变更原因

OpenLogos 当前只为 Claude Code、OpenCode、Codex 和 Cursor 提供 AI 工具资产适配，且工具枚举、资产部署、指令生成、launch 刷新与 npm 打包逻辑分散在命令实现中。继续逐个追加条件分支会放大重复实现、兼容回归和随包遗漏风险，也无法稳定表达不同宿主对 Skills、Commands、插件、SessionStart 与写入 guard 的能力差异。

本次先建设公共 AI Tool Adapter 底座，并完成 ZCode 的端到端集成，使 `init`、`adopt`、`sync`、`launch`、配置合并、`all` 语义、插件打包和运行时 guard 通过同一注册表驱动。Qoder、TraeCode CLI 和 WorkBuddy 明确不在本提案实现范围内，后续分别创建独立变更。

## 变更类型

需求级变更

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 中 P02、S01、S08、S09、S14、S20 的宿主选择、资产部署、同步刷新与 guard 验收条件。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` 中 AI 工具资产、managed instruction、SessionStart/PreToolUse guard 规格；`logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md` 中 AI 工具选择和执行反馈。
- 影响的技术架构：`logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md` 中 AI Tool Adapter 注册表、能力模型、宿主无关 Node.js hook runtime、ZCode 薄适配层和打包边界。
- 影响的业务场景：S01、S08、S09、S14、S20；不新增场景编号。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 中真实 tarball、ZCode 客户端、回滚与 smoke 证据。
- 影响的 API：无 HTTP、RPC 或消息 API；ZCode hook stdin/stdout 属本地宿主插件协议，在 ZCode 专项规范中定义。
- 影响的 DB 表：无。
- 影响的编排测试：无 API 编排测试；由 CLI 场景测试和真实 ZCode smoke 覆盖。
- 影响的根规范：`spec/agents-md.md`、`spec/pretooluse-guard.md`，并新增 `spec/zcode-plugin.md`。
- 明确非目标：不实现 Qoder、TraeCode CLI、WorkBuddy；不改变现有 Claude Code、OpenCode、Codex、Cursor 的用户可观察行为；不在本提案授权 npm publish、Git tag、GitHub Release、官网发布或 git push。

## 部署影响

- 是否需要部署：是
- 部署原因：CLI 运行时代码、插件模板和 npm 随包资产都会变化，必须通过真实打包安装验证 ZCode 插件发现、Skills/Commands、SessionStart 上下文和 PreToolUse 阻断链路。
- 影响环境：staging（真实 tarball 安装 + 真实 ZCode CLI 验证）
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

本案只修改 CLI 文本交互和本地插件资产，不触及网站、桌面界面或移动界面；`core-01-cli-experience.md` 是纯 CLI 体验文本规格，不需要 UI 原型。

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
      mode: CREATE
      delta_path: "deltas/decisions/core-D06-ai-tool-adapter-boundary.md"
      reason: "本案确立所有宿主后续必须遵守的能力驱动适配边界、共享 runtime 所有权与命名空间不变量，需在提案归档后保持可检索。"
      evidence: ["target_absent: logos/resources/decisions/core-D06-ai-tool-adapter-boundary.md", "decision_counter.next_id: 6"]
      missing_evidence: []
    - category: requirement
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "ZCode 成为新的完整宿主目标，并改变初始化、接入、同步、launch 与 guard 的用户可观察验收条件。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md", "requirements:P02,S01,S08,S09,S14,S20"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "公共 Adapter Registry、能力模型、ZCode 资产布局及 hook/guard 行为需要形成统一功能规格。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S01, S08, S14, S20]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md"
      reason: "init/adopt 的 AI 工具选择、sync/launch 的 ZCode 反馈和错误提示属于 CLI 交互体验变更。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md", "artifact_type: CLI markdown without pages declaration"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "分散条件分支将重构为能力驱动 Adapter Registry，并引入宿主无关 Node.js hook runtime 与 ZCode 薄适配层。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md", "code_fact: cli/src/commands/init.ts currently owns hard-coded tool branches"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S01]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md"
      reason: "S01 需表达从注册表解析 ZCode、生成配置、部署插件/Skills/Commands/hooks 和保留用户资产的完整时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S08]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md"
      reason: "S08 需表达通过 Adapter Registry 幂等刷新 ZCode 资产且保留用户配置的时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md", "resource_index: canonical S08 path"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "S09 需补充 ZCode SessionStart 上下文注入与 PreToolUse guard 随 proposal_step 收敛的宿主链路。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md", "resource_index: canonical S09 path"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S14]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S14-launch-lifecycle.md"
      reason: "S14 launch 刷新需由注册表驱动并包含 ZCode launched 指令与插件资产。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S14-launch-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S20]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md"
      reason: "S20 需支持选择 ZCode 并在不覆盖存量资产的前提下完成同等级基础设施接入。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "CLI 与随包插件资产变化需要真实 tarball 安装、ZCode 客户端验证、失败回滚和证据留存。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "module_policy: deployment_required=true"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S01, S08, S14, S20]
      mode: MODIFY
      delta_path: "deltas/spec/agents-md.md"
      reason: "ZCode 原生读取 AGENTS.md，需明确托管片段、语言策略、宿主技能路径与项目自有内容保留规则。"
      evidence: ["target_exists: spec/agents-md.md", "host_capability: ZCode supports AGENTS.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/pretooluse-guard.md"
      reason: "ZCode PreToolUse hook 需复用现有写入门禁语义，并定义宿主字段归一化、阻断退出码和 fail-closed 行为。"
      evidence: ["target_exists: spec/pretooluse-guard.md", "host_capability: ZCode hooks expose Claude-compatible snake_case aliases"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: CREATE
      delta_path: "deltas/spec/zcode-plugin.md"
      reason: "现有根规范没有 ZCode 插件清单、目录布局、Skills/Commands/Agents/hooks、安装同步与兼容契约。"
      evidence: ["target_absent: spec/zcode-plugin.md", "proposal_scope: full ZCode integration"]
      missing_evidence: []
    - category: test
      scenario_ids: [S01]
      mode: MODIFY
      delta_path: "deltas/test/core-S01-test-cases.md"
      reason: "补充 ZCode 参数解析、all 展开、注册表、资产布局、双语指令、打包与幂等初始化 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S01-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S08]
      mode: MODIFY
      delta_path: "deltas/test/core-S08-test-cases.md"
      reason: "补充 ZCode 同步刷新、用户配置保留、旧配置兼容、版本戳与重复执行 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S08-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "补充 ZCode SessionStart、PreToolUse 字段适配、proposal_step allowlist、exit 2 阻断与异常 fail-closed UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S14]
      mode: MODIFY
      delta_path: "deltas/test/core-S14-test-cases.md"
      reason: "补充 launch 通过注册表刷新 ZCode launched 资产并保持现有宿主行为的 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S14-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S20]
      mode: MODIFY
      delta_path: "deltas/test/core-S20-test-cases.md"
      reason: "补充存量项目选择 ZCode、资产冲突保护、配置持久化和后续 change 可达性 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S20-test-cases.md"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "部署后必须以真实 tarball 和真实 ZCode CLI 验证插件发现、Skills/Commands、上下文注入、写入阻断及既有宿主回归。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "proposal: smoke_required=true"]
      missing_evidence: []
    - category: api
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: SKIP
      delta_path: null
      reason: "本案仅改变本地 CLI、文件资产与宿主 hook 协议，不引入 HTTP、RPC 或消息 API。"
      evidence: ["architecture: local CLI and filesystem boundary"]
      missing_evidence: []
    - category: database
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: SKIP
      delta_path: null
      reason: "适配器注册表、插件模板和 hook runtime 不新增持久化实体、数据库查询或迁移。"
      evidence: ["architecture: static registry and filesystem assets"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S01, S08, S09, S14, S20]
      mode: SKIP
      delta_path: null
      reason: "API 维度为 SKIP，因此不需要 API 编排测试；跨进程行为由 CLI ST 与真实 ZCode smoke 覆盖。"
      evidence: ["api_disposition: SKIP"]
      missing_evidence: []
```

## 已确定的设计决策

- 拟定 D06：AI 工具集成统一采用“能力驱动 Adapter Registry + 宿主无关 Node.js hook runtime + 宿主薄适配层”；理由是把工具枚举、部署、指令、生命周期刷新和打包收口到单一注册表，同时保留各宿主协议差异，避免为后续 CLI 继续复制条件分支与 Bash runtime。

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: "本案只新增静态适配器、插件模板和本地 hook runtime，不迁移、覆盖或删除用户业务数据。"
  compatibility:
    status: none
    reason: "ZCode 以加法方式加入；现有四个宿主的标识、单选/数组配置与 all 行为必须通过回归测试保持兼容。"
  security_privacy:
    status: none
    reason: "ZCode hook 只读取项目内 OpenLogos 状态并执行既有 guard 决策，不新增 Secret、个人数据、网络访问或超出宿主项目信任模型的权限。"
  public_release:
    status: none
    reason: "本提案只规划实现、staging 部署与 smoke，不授权 npm publish、Git tag、GitHub Release、官网发布或 git push。"
  external_commitment:
    status: none
    reason: "不引入付费服务、供应商锁定、法律承诺、SLA 或其他不可逆外部影响。"
decisions:
  - id: C01
    category: deployment
    question: "本案实现完成后，是否采用 staging 真实 tarball 安装，并使用真实 ZCode CLI 完成插件与 hard guard smoke，同时不执行任何公开发布？"
    answer: "确认用 staging 真实 tarball + 真实 ZCode CLI 验证，不执行公开发布。"
    rationale: "用户明确确认推荐方案；该方式可验证 npm 随包内容和真实宿主协议，失败时可卸载测试包并恢复前一 tarball，同时不会形成 npm、GitHub、官网或 git push 等公开发布承诺。"
    source: user
    affects:
      - "staging 真实 tarball 部署方案"
      - "真实 ZCode CLI 插件与 hard guard smoke"
      - "制品、安装状态与回滚证据"
      - "公开发布非目标"
    rejected_options:
      - "仅执行本地合同测试，不使用真实 ZCode 客户端"
unresolved: []
defaults:
  - id: DFLT-01
    category: compatibility
    choice: "保留现有 Claude Code、OpenCode、Codex、Cursor 的标识、资产路径和用户可观察行为。"
    reason: "这是加法集成的兼容基线，且可通过现有回归测试验证。"
  - id: DFLT-02
    category: ownership
    choice: "共享 runtime 只拥有 OpenLogos 阶段上下文与 guard 决策；ZCode adapter 只负责协议字段转换和路径部署。"
    reason: "单一 writer 可避免共享逻辑与宿主包装器产生双重事实源。"
```

## 变更概述

公共底座将引入稳定的 AI Tool Adapter 接口、注册表、别名解析和能力声明，以统一驱动 `init`、`adopt`、`sync`、`launch`、配置合并、`all` 展开、指令文件生成与 npm 随包校验。现有四个宿主迁入注册表后必须保持行为兼容；公共 SessionStart/guard 逻辑收敛为 Node.js runtime，各宿主仅保留输入输出转换和安装布局差异。

ZCode 集成目标为完整 L3：提供 ZCode 插件清单、OpenLogos Skills、Commands、必要的 Agents、AGENTS.md 托管指令、SessionStart 上下文注入和 PreToolUse hard guard；支持首次部署、重复同步、launched 刷新、配置冲突保护、双语输出、真实打包安装与真实客户端 smoke。Qoder、TraeCode CLI、WorkBuddy 不在本提案中实现。


## 需要合并的 Delta 文件

### 1. deltas/decisions/core-D06-ai-tool-adapter-boundary.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/decisions/core-D06-ai-tool-adapter-boundary.md`
- 目标目录：`logos/resources/decisions/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md`
- 目标目录：`logos/resources/prd/2-product-design/2-page-design/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/prd/3-technical-plan/2-scenario-implementation/core-S14-launch-lifecycle.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/prd/3-technical-plan/2-scenario-implementation/core-S14-launch-lifecycle.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 10. deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 11. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 12. deltas/spec/agents-md.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/spec/agents-md.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 13. deltas/spec/pretooluse-guard.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/spec/pretooluse-guard.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 14. deltas/spec/zcode-plugin.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/spec/zcode-plugin.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 15. deltas/test/core-S01-test-cases.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/test/core-S01-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 16. deltas/test/core-S08-test-cases.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/test/core-S08-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 17. deltas/test/core-S09-test-cases.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/test/core-S09-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 18. deltas/test/core-S14-test-cases.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/test/core-S14-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 19. deltas/test/core-S20-test-cases.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/test/core-S20-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 20. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/zcode-adapter-foundation/deltas/test/smoke/core-smoke-test-cases.md`
- 目标目录：`logos/resources/test/smoke/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(zcode-adapter-foundation): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive zcode-adapter-foundation`。
