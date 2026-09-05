# AGENTS.md 生成规范

> 版本：0.3.0
>
> 本文档定义 AGENTS.md 的内容结构、生成规则和多平台适配机制。AGENTS.md 是面向 AI 助手的指令文件，让 AI 工具打开项目就知道该遵循什么规范。

## 概述

AGENTS.md 放在项目根目录。当 AI 工具（Cursor、Claude Code、OpenCode 等）打开项目时，自动读取此文件，了解项目遵循的规范和工作方式。

## 内容结构

```markdown
# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`
- Tech Stack: [从 logos-project.yaml 读取]

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see logos/changes/ directory)
6. All generated test code must include an OpenLogos reporter
7. Deployment is a human confirmation point; AI must not deploy without explicit authorization
8. If deployment is required, smoke tests must be designed with the test plan and run via `openlogos smoke` after deployment
9. For launched-project change proposals, deployment and smoke decisions must be made at proposal level. A module-level deployment gate is only a default and must not force deploy/smoke for a proposal that explicitly does not require deployment.

## Document Edit Verification
[Fixed locale-specific paragraph — re-read from disk after Markdown/text spec edits]

## Interaction Guidelines
When the user's request is vague or they ask "what should I do next":
1. Scan `logos/resources/` to determine the current project phase
2. Suggest the specific next step based on what's missing
3. Provide a ready-to-use prompt the user can directly say
4. Never start generating documents without confirming key information

Phase detection logic:
- `logos/resources/prd/1-product-requirements/` is empty → suggest Phase 1 (prd-writer)
- requirements exist but `2-product-design/` is empty → suggest Phase 2 (product-designer)
- design exists but `3-technical-plan/1-architecture/` is empty → suggest Phase 3 Step 0 (architecture-designer)
- architecture exists but `3-technical-plan/2-scenario-implementation/` is empty → suggest Phase 3 Step 1 (scenario-architect)
- scenarios exist but `logos/resources/api/` is empty → suggest Phase 3 Step 2 (api-designer + db-designer)
- API/DB exists but `3-technical-plan/3-deployment/` is empty → suggest Phase 3 Step 3 (deployment-designer)
- deployment plan exists but `logos/resources/test/` is empty → suggest Phase 3 Step 4a (test-writer)
- test cases exist but `logos/resources/scenario/` is empty → suggest Phase 3 Step 4b (test-orchestrator, API projects only)
- orchestration tests exist but `logos/resources/implementation/` is empty → suggest Phase 3 Step 5 (code-implementor)
- code generated but `logos/resources/verify/acceptance-report.md` is missing or verify has not passed → suggest Phase 3 Step 6 (`openlogos verify`)
- verify passed but deployment is required and `deployment-report.md` is missing → suggest Phase 3 Step 7 (deployment-executor, human confirmation required)
- deployment done but `smoke-report.md` / `SMOKE_PASS` is missing → suggest Phase 3 Step 8 (`openlogos smoke`)
- smoke passed → suggest `openlogos launch`

Step 5 execution rules (large tasks):
1. Large implementation can be split by scenario/module, but each batch must be closed-loop
2. Each batch must include business code + UT/ST test code + OpenLogos reporter
3. Before generating code, list the UT/ST case IDs covered in this batch and keep IDs aligned with `logos/resources/test/*.md`
4. Do not postpone all tests to the final batch

Deployment rules:
1. AI must not run deployment commands unless the user explicitly authorizes deployment
2. AI must read `logos/resources/prd/3-technical-plan/3-deployment/` before deployment
3. Deployment completion must be followed by `openlogos smoke`
4. Initial modules can be launched only after verify, deployment, and smoke gates pass, unless explicitly marked as not requiring deployment

## Active Skills
[根据 `logos.config.json` 的 `aiTool` 字段动态生成，并按 OpenLogos 方法论技能与项目专属技能分组]

当 aiTool = "cursor" 时，列出 `.cursor/skills/` 下部署的 OpenLogos 原生 Agent Skills：
- `skills/prd-writer` — `.cursor/skills/prd-writer/SKILL.md`
- `skills/product-designer` — `.cursor/skills/product-designer/SKILL.md`
- ...（共 13 项，另含 `disable-model-invocation: true` 的 OpenLogos 显式命令 Skills 与 change-reviewer subagent）

生成内容必须包含固定的 guard 强度说明行：cursor-agent CLI 下写入门禁为部分强度（shell 写入硬拦 + 编辑事后检测，CLI 无 preToolUse）；Cursor IDE 经同一 `.cursor/hooks.json` 获得完整 preToolUse 硬拦。历史 `.cursor/rules/*.mdc` 托管清单已由 Skills 取代，不再生成。

当 aiTool = "claude-code" 或 "other" 时，列出 `logos/skills/` 下部署的 OpenLogos 方法论 `SKILL.md` 文件：
- `skills/prd-writer` — `logos/skills/prd-writer/SKILL.md`
- `skills/product-designer` — `logos/skills/product-designer/SKILL.md`
- ...（共 13 项）

若项目存在 `.claude/skills/<skill>/SKILL.md`，生成内容必须单独列为“项目专属 Skills”，并说明它们属于当前仓库规则，不属于 OpenLogos 官方方法论插件；不得把它们描述成 `/openlogos:*` 能力。

当 aiTool = "codex" 时：
- **兼容模式**：继续保留 `AGENTS.md` + OpenLogos managed block。
- **原生插件模式（推荐）**：通过 `.agents/plugins/marketplace.json` 加载 `openlogos` 插件；OpenLogos 方法论技能显示为 `openlogos:<skill-name>`；项目专属技能必须位于项目自己的插件命名空间或明确的 repo-scoped local skill 中。

当 aiTool = "opencode" 时：
- **兼容模式**：继续使用 `AGENTS.md` + `logos/skills/*/SKILL.md`
- **原生插件模式（推荐）**：通过 `opencode.json` 的 `plugin` 字段或 `.opencode/plugins/` 加载 OpenLogos 插件；`AGENTS.md` 作为兜底指令保留

## Conventions
- [从 logos-project.yaml 的 conventions 段读取]
- When writing Markdown files that contain triple-backtick code blocks inside other code blocks, use 4-backtick fences (````) for the outer block
```

`createAgentsMd`（`cli/src/commands/init.ts`）在 **Interaction Guidelines** 与 **Active Skills**（若存在）之间插入 **Document Edit Verification** 固定段落：每次写入或修改 Markdown / 文本类规格后，须从磁盘读回修改片段并展示原文；禁止仅以概括性文字作为唯一交付；纯 typo 可仅展示受影响行或等价 diff。文案随 `locale`（`zh` / `en`）切换。

## 生成规则

### 数据来源

AGENTS.md 的内容从以下文件中自动提取：

| 字段 | 来源 |
|------|------|
| Tech Stack | `logos-project.yaml` → `tech_stack` |
| Active Skills | `logos.config.json` → `aiTool` 字段决定路径前缀 + 扫描项目中已部署的 Skills |
| Conventions | `logos-project.yaml` → `conventions` |
| Methodology Rules | 固定内容（OpenLogos 核心规则） |

### 核心规则（固定内容）

以下规则在所有 OpenLogos 项目中一致，不可自定义：

1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations
6. All generated test code must include an OpenLogos reporter (see spec/test-results.md)
7. Deployment is a human confirmation point; AI must not deploy without explicit authorization
8. If deployment is required, smoke tests must be designed and run via `openlogos smoke` after deployment
9. For launched-project change proposals, deployment and smoke decisions must be made at proposal level. A module-level deployment gate is only a default and must not force deploy/smoke for a proposal that explicitly does not require deployment.
10. After editing Markdown / text specs, re-read from disk and show excerpts to the user (see 「文档修改后的验证」生成段)

### Skill 命名空间生成规则

OpenLogos 生成的 AI 指令必须明确区分：

| 类型 | 归属 | Codex 表达 | Claude Code 表达 | 说明 |
|------|------|------------|------------------|------|
| OpenLogos 方法论技能 | OpenLogos 官方 | `openlogos:<skill>` | OpenLogos 官方插件 / `logos/skills/*` | 只表达 OpenLogos 方法论流程 |
| 项目专属技能 | 当前仓库或产品团队 | `<project-plugin>:<skill>` 或 repo-scoped local skill | `.claude/skills/<skill>` 或项目独立插件 | 表达当前仓库工程、发布、业务规则 |

生成规则：
1. `openlogos` 命名空间只用于 OpenLogos 官方方法论技能。
2. 未知来源或用户自建 skill 默认视为项目专属技能。
3. `AGENTS.md` / `CLAUDE.md` 可引用项目专属技能位置，但不得把项目专属技能归入 OpenLogos 官方插件。
4. 若项目技能与 OpenLogos 方法论规则都适用，项目技能可补充更具体的工程约束，但不得绕过 OpenLogos 的设计、Delta、verify、deploy、smoke 门禁。

### 提案级部署门禁生成规则

AGENTS.md / CLAUDE.md 的变更管理段必须强调：
- `proposal.md` 的 `## 部署影响` 是活跃提案的部署决策入口。
- 不需要部署的提案不得创建 `[deploy]` section。
- verify PASS 且无需部署时，应提醒用户明确授权执行 `openlogos archive <slug>`。
- 只有提案级需要部署时，才在 verify PASS 后提醒用户明确授权部署。
- 只有提案级需要 smoke 且部署完成后，才提醒用户明确授权执行 `openlogos smoke`。

### 托管片段合并规则

`AGENTS.md` / `CLAUDE.md` 是项目根目录的用户可编辑指令文件。OpenLogos 只能维护自身生成的托管片段，不得整文件覆盖用户在托管片段之外写入的项目规则、工具偏好、权限约束或团队约定。

OpenLogos 生成内容必须包裹在固定 marker 内：

```markdown
<!-- OPENLOGOS:BEGIN -->
[OpenLogos generated instructions]
<!-- OPENLOGOS:END -->
```

写入规则：

1. 若目标文件不存在，创建文件，内容为 OpenLogos 托管片段。
2. 若目标文件存在且包含完整 marker，只替换 `OPENLOGOS:BEGIN` 与 `OPENLOGOS:END` 之间的内容，保留 marker 外所有用户内容及其相对顺序。
3. 若目标文件存在但没有 marker，且内容与旧版本 OpenLogos 生成模板等价，则迁移为带 marker 的托管文件。
4. 若目标文件存在但没有 marker，且包含任何用户自定义内容，则保留原文，并在文件末尾追加 OpenLogos 托管片段；不得整文件覆盖。
5. 若目标文件存在不完整 marker（只有 begin 或只有 end），写入必须 fail loud，提示用户修复或备份文件；不得猜测边界后覆盖。
6. 写入前必须按大小写不敏感方式查找同目录下的既有变体，例如 `agents.md`、`Agents.md`、`claude.md`、`Claude.md`。若存在大小写变体，应复用既有真实文件路径进行合并，避免在 macOS 默认大小写不敏感文件系统上误覆盖用户文件，或在大小写敏感文件系统上生成重复指令入口。
7. `init`、`init --ai-tool`、`adopt`、`sync`、`launch` 必须复用同一个合并写入 helper，确保所有入口具备一致的保留行为。

### 生成时机

- `openlogos init`：初始化项目时首次生成；若根目录已存在 `AGENTS.md` / `CLAUDE.md` 或大小写变体，必须按「托管片段合并规则」保留用户内容。
- `openlogos init --ai-tool <tool>`：为已初始化项目补齐目标 AI 工具时刷新托管片段；不得覆盖托管片段外用户内容。
- `openlogos adopt`：接入已有项目时生成 OpenLogos 基础设施；若已有项目已经维护 `AGENTS.md` / `CLAUDE.md`，必须合并写入 OpenLogos 托管片段。
- `openlogos sync`：手动触发重新生成（当项目配置变化时，同时重新部署 Skills 并刷新 Active Skills 段）；只替换 OpenLogos 托管片段。
- `openlogos launch`：切换 launched 生命周期后刷新变更管理规则；只替换 OpenLogos 托管片段。
- `project-init` Skill：AI 初始化项目时生成，行为应与 CLI 托管片段策略一致。


## 多平台适配

不同 AI 工具使用不同的指令文件名和 Skill / 插件目录，但 OpenLogos 方法论技能与项目专属技能的边界必须一致：

| 工具 | 指令文件 | OpenLogos Skills 部署位置 | 项目专属 Skills 推荐位置 | 处理方式 |
|------|---------|--------------------------|--------------------------|---------|
| **Cursor** | `AGENTS.md`（原生支持） | `.cursor/skills/<skill>/SKILL.md`（原生 Agent Skills，含 `disable-model-invocation` 显式命令与 change-reviewer subagent） | 用户自有 `.cursor/skills/` 与 `.cursor/rules/` | `init` / `sync` 自动部署 OpenLogos Skills 与 hooks 托管条目，清理历史托管 `.mdc`（用户资产保留），并通过 managed block 合并根指令文件 |
| **Claude Code** | `CLAUDE.md` | `logos/skills/*/SKILL.md` 或 OpenLogos 官方 Claude 插件 | `.claude/skills/<skill>/SKILL.md` 或项目独立 Claude 插件 | `init` / `sync` 自动部署 OpenLogos 托管资产；项目技能单独分组，不归入 `/openlogos:*` |
| **Codex** | `AGENTS.md` | `.agents/plugins/openlogos/skills/*` | `.agents/plugins/<project-plugin>/skills/*` 或 repo-scoped local skill | `init` / `sync` 自动维护 repo marketplace 的 `openlogos` 条目；项目插件条目原样保留 |
| **OpenCode（兼容模式）** | `AGENTS.md` | `logos/skills/*/SKILL.md` | 项目自有 OpenCode 插件或规则 | `init` / `sync` 自动部署，并通过 managed block 合并根指令文件 |
| **OpenCode（原生插件模式）** | `opencode.json` + `.opencode/plugins/` | 插件内置/按需加载 | 项目自有 `.opencode/plugins/` | 由插件负责命令桥接与会话注入，`AGENTS.md` 作为兜底 |
| **GitHub Copilot** | `.github/copilot-instructions.md` | 规划中 | 规划中 | Phase 1.5 |

`openlogos sync` 命令会同时生成所有需要的指令文件，确保不同 AI 工具看到的 OpenLogos 托管片段一致。对于 OpenCode 原生插件模式，`sync` 仍保留 `AGENTS.md` 作为降级路径，避免插件不可用时流程中断。

根目录指令文件可能已存在用户自定义规则。OpenLogos 在任何入口下都只能更新自身 managed block 和自身插件资产，不能覆盖用户在 block 外的内容，也不能把用户项目专属 Skill 吸收到 OpenLogos 官方命名空间。

## 与 logos-project.yaml 的关系

| 文件 | 格式 | 受众 | 内容 |
|------|------|------|------|
| `logos-project.yaml` | 结构化 YAML | AI + 工具 | 资源索引、技术栈、约定 |
| `AGENTS.md` | 自然语言 Markdown | AI 助手 | 行为指令、规则、Skill 列表 |

两者互补：AGENTS.md 引导 AI 去读 logos-project.yaml，logos-project.yaml 提供结构化数据。

## ZCode 指令与 Skill 命名空间生成规则

### ZCode 指令入口

- 当 `aiTool` 为 `zcode`，或 `all` 经 Registry 展开包含 ZCode 时，OpenLogos 必须维护项目根现有大小写真实路径的 `AGENTS.md`。
- ZCode 运行时只以用户级 `~/.zcode/AGENTS.md` 与工作区根 `AGENTS.md` 的组合为前提；OpenLogos 生成内容不得依赖子目录 AGENTS 扫描、include 指令或 CLAUDE.md 持续读取。
- 根 AGENTS 中的 OpenLogos 内容必须自包含：项目索引入口、语言策略、Why→What→How、Delta/guard、测试 reporter、verify/deploy/smoke/archive/push 确认点均在完整 managed block 中表达。

### 托管片段与用户内容保护

1. ZCode 复用既有 `OPENLOGOS:BEGIN` / `OPENLOGOS:END` 合并 helper，不新增第二套 marker。
2. 无 marker 的用户 AGENTS 原文保留，并在末尾追加托管片段；完整 marker 只替换内部；不完整 marker fail loud。
3. `init`、`init --ai-tool zcode`、`adopt`、`sync`、`launch` 必须调用同一合并实现，大小写变体检测和原子回滚语义一致。
4. `.zcode/config.json`、用户级 AGENTS、托管 marker 外内容不是 OpenLogos owner，任何入口不得覆盖。
5. 生成文本语言由 `logos.config.json.locale` 决定；用户原文不翻译、不格式化。

### ZCode Skills/Commands/Agents 分组

| 类型 | OpenLogos 归属与位置 | AGENTS 展示规则 |
|---|---|---|
| 方法论 Skills | OpenLogos ZCode plugin 的 `skills/<name>/SKILL.md` | 列在“OpenLogos 方法论 Skills”，使用插件可发现名称与实际路径 |
| Commands | plugin 的 `commands/<name>.md` | 列出用户可调用名称、用途和所需确认点，不伪装成 Skill |
| Agents | plugin 的 `agents/<name>.md` | 仅列出真实随包 Agent；不得生成不存在的角色 |
| 项目专属能力 | 当前仓库或其它 ZCode plugin | 单独列为“项目专属”，保留原命名空间，不纳入 OpenLogos owner |

`openlogos` identity/命名空间只表示 OpenLogos 随包方法论资产。未知来源、用户创建或其它 plugin 中的 Skill/Command/Agent 一律视为项目/用户资产，sync 不复制、不重命名、不删除。

### 生命周期生成

- initial：说明完成 Why→What→How 设计与测试规格后才能实现，并展示初始化阶段可用的 OpenLogos 能力。
- launched 无 guard：明确禁止修改源码，下一动作是创建 change。
- launched 有 guard：按磁盘 `proposal_step` 输出精确阶段范围；delta-writing 仅允许当前提案 `deltas/**` 和对应 `tasks.md`，ready-to-merge 停止写 delta。
- adopted + launched：与 launched 指令一致，不因存量接入降低 guard；下一主路径仍可直接 change。
- launch/sync 后提示 ZCode 开启新 session 获取新指令和 Hook 配置快照；不得声称现有 session 已热更新。

### 一致性与验证

- Registry 为 ZCode AGENTS 生成的唯一入口，禁止在 init/sync/launch/adopt 各自拼接宿主分支。
- AGENTS 中列出的资产必须与 tarball 内 ZCode plugin 清单一致；缺文件、重复 identity 或非法 frontmatter 阻断部署。
- 自动化测试覆盖用户内容保留、大小写变体、不完整 marker、双语、initial/launched/adopted 与 `all`。
- staging smoke 必须由真实 ZCode 新 session 读取根 AGENTS，并确认方法论资产和项目专属资产没有混入同一 owner。

## Qoder CLI 静态记忆与插件资产生成规则

### Qoder 指令入口

- 当 `aiTool=qoder` 或 `all` 展开包含 Qoder 时，OpenLogos 必须维护工作区根现有大小写真实路径的 `AGENTS.md`。
- Qoder CLI 默认把项目 `AGENTS.md` 作为静态记忆；OpenLogos 托管片段必须自含项目索引、语言策略、Why→What→How、delta/guard、reporter 和人类确认点。
- OpenLogos 不修改用户级 `~/.qoder/AGENTS.md`、项目 `AGENTS.local.md`、`.qoder/rules/**/*.md` 或自定义 `context.fileName` 配置；这些均属于用户/项目 owner。
- 虽然 Qoder 可按访问路径补充加载子目录记忆，OpenLogos 关键方法论约束不得依赖先访问特定子目录才生效。

### 托管片段与用户内容保护

1. 复用既有 `OPENLOGOS:BEGIN` / `OPENLOGOS:END` 合并 helper，不新增 Qoder 专用 marker。
2. 无 marker 时保留用户原文并追加完整片段；完整 marker 只替换内部；残缺、交错或重复 marker fail loud。
3. init/adopt/sync/launch 调用同一合并与事务实现，大小写变体和回滚语义一致。
4. 用户级/本地 AGENTS、Qoder rules、settings、其它插件和 marker 外内容永不进入 OpenLogos 删除/格式化计划。
5. 托管文本语言来自 `logos.config.json.locale`；用户原文不翻译、不重排。

### Qoder Skills、Commands、Agents 分组

| 类型 | OpenLogos 位置 | AGENTS 展示规则 |
|---|---|---|
| 方法论 Skills | Qoder plugin `skills/<name>/SKILL.md` | 列为“OpenLogos 方法论 Skills”，名称/描述与真实资产一致 |
| Commands | plugin `commands/**/*.md` | 列可调用名称、用途和人类确认点，不伪装成 Skill |
| Agents | plugin `agents/*.md` | 只列真实随包 Agent，不生成不存在角色 |
| 项目/用户能力 | `.qoder/rules/**`、其它插件或仓库资产 | 独立分组并保留原 owner，不由 sync 重命名/删除 |

### 生命周期内容

- initial：强调完成 Why→What→How 与测试规格后才能实现。
- launched 无 guard：禁止源码/规格写入，下一主动作是创建 change。
- launched 有 guard：按磁盘 `proposal_step` 给出精确范围；delta-writing 仅当前提案 deltas/tasks，ready-to-merge 停止写 delta。
- adopted + launched：与 launched 一致，不因存量接入降低 guard；可直接进入 change。
- sync/launch 后提示通过新 Qoder CLI session 或受支持的 memory refresh 读取新静态记忆/插件快照；不得声称更新 AGENTS 等同 hard guard。

### 一致性与验证

- Registry 是 Qoder AGENTS/插件资产生成的唯一入口，生命周期命令不拼接 Qoder 分支。
- AGENTS 列表、plugin manifest 与 tarball 实际组件集合必须一致；缺失、额外、重复 identity 或非法 frontmatter 阻断预检。
- 自动化覆盖用户内容保留、大小写、残缺 marker、zh/en、initial/launched/adopted、qoder/all 与规则/本地记忆不被修改。
- staging 由真实 Qoder CLI 新 session 读取根 AGENTS，并证明静态记忆只提供指导，PreToolUse Hook 独立执行硬门禁。

### 权威参考

- Qoder CLI Memory：`https://docs.qoder.com/cli/memory`
- Qoder Plugin Reference：`https://docs.qoder.com/cli/plugins-reference`

## WorkBuddy 静态指令、会话上下文与原生记忆边界

### 指令入口与三层职责

当 `aiTool=workbuddy` 或 `all` 展开包含 WorkBuddy 时，OpenLogos 按 Adapter capability 部署静态项目指令和原生插件资产。三类上下文必须分离：

| 层 | 内容 | 是否可授权写入 |
|---|---|---:|
| 静态项目指令 | 项目索引、语言、Why→What→How、Delta/guard、确认点 | 否 |
| SessionStart | 从磁盘派生的 lifecycle、slug、`proposal_step`、范围与下一动作 | 否 |
| PreToolUse | 每次调用重新读取磁盘并作 allow/deny | 是，唯一 hard guard |

`AGENTS.md`、`CODEBUDDY.md` 或宿主可读取的等价静态指令只能作为指导；任何文件名差异由 WorkBuddy Adapter/能力探测封装，不得改变 OpenLogos 方法论内容或被当作 hard guard。

### 托管片段与用户内容保护

1. 复用既有 `OPENLOGOS:BEGIN` / `OPENLOGOS:END` 合并 helper；完整 marker 只替换内部，无 marker 保留用户原文后追加，残缺/交错/重复 marker fail loud。
2. init/adopt/sync/launch 调用同一事务实现，大小写真实路径、locale 和回滚语义一致。
3. OpenLogos 只维护自身托管片段和插件 identity；WorkBuddy settings、其它插件、项目自有指令/资产和未知文件不得格式化、重命名或删除。
4. sync/launch 后提示启动新 WorkBuddy session 获取插件与 SessionStart 快照，不宣称旧会话已热刷新。

### Skills、Commands 与 Agents 分组

| 类型 | OpenLogos 位置 | 展示规则 |
|---|---|---|
| 方法论 Skills | WorkBuddy plugin `skills/<name>/SKILL.md` | 列真实随包名称与用途，保持 OpenLogos owner |
| Commands | plugin `commands/<name>.md` | 列调用名称和人类确认点，不伪装成 Skill |
| Agents | plugin `agents/<name>.md` | 只列真实随包 Agent，不生成不存在角色 |
| 项目/用户能力 | 其它插件、项目资产 | 单独分组，保留原 owner，不由 sync 吸收 |

### 原生记忆边界

- WorkBuddy 原生记忆由宿主和用户独占。OpenLogos 不读取正文、不生成条目、不清空、迁移、导入或导出记忆。
- 原生记忆不得成为 lifecycle、active slug、`proposal_step` 或 allowlist 的事实源，也不得作为身份、授权或 smoke 成功凭据。
- 自动化与 staging 只能保留不透明的前后证据证明“未触碰”，不得把记忆内容复制进日志、reporter 或提案产物。
- 静态指令或 SessionStart 与原生记忆冲突时，PreToolUse 基于当前磁盘状态的决策优先。

### 一致性与验证

- Registry 是 WorkBuddy 指令与插件资产生成的唯一入口；生命周期命令不得拼接宿主分支。
- 静态清单、plugin manifest 与 `0.13.28` tarball 实际组件必须一致；缺失、重复 identity 或非法 frontmatter/Hook 配置阻断预检。
- UT/ST 覆盖用户内容保留、marker、zh/en、initial/launched/adopted、workbuddy/all 与记忆零写入。
- staging 由真实 WorkBuddy 5.3.5+ 新 session 证明静态指令和组件可用，同时由 PreToolUse 独立证明 hard guard。

### 权威参考

- WorkBuddy Plugins：`https://www.codebuddy.cn/docs/workbuddy/Plugins`
- CodeBuddy Plugin Technical Reference：`https://www.codebuddy.cn/docs/cli/plugins-reference`
- WorkBuddy Memory：`https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Memory`

## Cursor 原生 Skills、hooks 托管条目与部分强度门禁生成规则

当 `aiTool` 含 `cursor` 时，`init` / `adopt` / `sync` / `launch` 除生成 `AGENTS.md` managed block 外，还托管以下资产（完整契约见 `spec/cursor-plugin.md`）：

1. **原生 Agent Skills**：`.cursor/skills/<skill>/SKILL.md`，frontmatter `name` 与目录名一致、`description` 非空；OpenLogos 显式命令 Skills 额外携带 `disable-model-invocation: true`；change-reviewer 以 Cursor subagent 部署。
2. **hooks 托管条目**：向 `.cursor/hooks.json` 合并写入 `sessionStart`、`beforeShellExecution`、`afterFileEdit` 三条 OpenLogos 托管条目；只增改托管条目、保留用户条目与未知字段；文件不可解析时 fail loud 零写入。
3. **托管 `.mdc` 迁移**：历史 `.cursor/rules/<skill>.mdc` 与 `openlogos-policy.mdc` 在 Skills 部署成功后同次执行内清理；清理清单由 OpenLogos Skill 名单静态派生，用户自有 rules 一律保留。
4. **guard 强度如实呈现**：AGENTS.md 托管段与 CLI 反馈必须声明 cursor-agent CLI 下写入门禁为部分强度（`beforeShellExecution` 硬拦 shell 写入 + `afterFileEdit` 事后检测，CLI 无 `preToolUse`）；Cursor IDE 经同一 `hooks.json` 获得完整 `preToolUse` 硬拦。不得把 CLI 侧表述成与 claude-code 等价（capability honesty，D09）。
5. **边界**：OpenLogos 只拥有自身托管 Skills 目录、subagent 文件与 hooks 托管条目；用户 `.cursor/**` 其余内容在任何入口下不读改删。
