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

当 aiTool = "cursor" 时，列出 `.cursor/rules/` 下部署的 OpenLogos `.mdc` 文件：
- `skills/prd-writer` — `.cursor/rules/prd-writer.mdc`
- `skills/product-designer` — `.cursor/rules/product-designer.mdc`
- ...（共 13 项）

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
| **Cursor** | `AGENTS.md`（原生支持） | `.cursor/rules/*.mdc` | 项目自有 Cursor 规则目录 | `init` / `sync` 自动部署 OpenLogos 规则，并通过 managed block 合并根指令文件 |
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
