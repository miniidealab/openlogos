---
title: AGENTS.md 规格
description: AI 指令文件的内容结构、生成规则与多平台适配。
---

`AGENTS.md` 是放置在项目根目录的 AI 指令文件。当 AI 编码工具（Cursor、Claude Code、OpenCode、Codex、ZCode、Qoder、WorkBuddy 等）打开项目时，会读取此文件来理解项目的方法论、规则和工作流。

## 内容结构

生成的 `AGENTS.md` 遵循以下标准模板：

```markdown
# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`
- Tech Stack: [read from logos-project.yaml]

## Methodology Rules
[6 fixed rules — see below]

## Interaction Guidelines
[Phase detection logic + Step 4 batch execution rules]

## Document Edit Verification
[Fixed locale-specific paragraph: after each Markdown/text spec write, re-read from disk and show actual excerpts; no prose-only delivery; typo exception]

## Active Skills
[Dynamically generated based on aiTool setting]

## Change Management
[Varies by lifecycle: initial vs launched]

## Conventions
[Read from logos-project.yaml conventions field]
```

## 固定方法论规则

这些规则在所有 OpenLogos 项目中保持一致，不可自定义：

1. 在完成设计文档之前绝不写代码
2. 遵循 Why → What → How 推进
3. 所有 API 设计必须源自场景时序图
4. 所有代码变更必须有对应的 API 编排测试
5. 迭代使用 Delta 变更工作流
6. 所有生成的测试代码必须包含 OpenLogos reporter（见[测试结果格式](/zh/specs/test-results)）
7. 修改 Markdown 或文本规格后，从磁盘重新读取并向用户展示可验证的原文片段（生成的 **Document Edit Verification** 章节）

## 阶段检测逻辑

Interaction Guidelines 章节包含阶段检测逻辑，帮助 AI 判断当前项目阶段并建议下一步：

| 条件 | 建议阶段 | Skill |
|-----------|----------------|-------|
| `prd/1-product-requirements/` 为空 | Phase 1 | prd-writer |
| 需求存在，`2-product-design/` 为空 | Phase 2 | product-designer |
| 设计存在，`3-technical-plan/1-architecture/` 为空 | Phase 3 Step 0 | architecture-designer |
| 架构存在，`2-scenario-implementation/` 为空 | Phase 3 Step 1 | scenario-architect |
| 场景存在，`api/` 为空 | Phase 3 Step 2 | api-designer + db-designer |
| API 存在，`test/` 为空 | Phase 3 Step 3a | test-writer |
| 测试用例存在，`scenario/` 为空 | Phase 3 Step 3b | test-orchestrator |
| 以上全部完成 | Phase 3 Step 4 | code-implementor |
| 代码存在，`verify/` 为空 | Phase 3 Step 5 | 运行测试 → `openlogos verify` |

## Active Skills 章节

Active Skills 章节根据 `logos.config.json` 中的 `aiTool` 字段动态生成：

| aiTool 取值 | Skill 列表来源 | 路径格式 |
|-------------|-------------------|-------------|
| `cursor` | `.cursor/skills/*/SKILL.md` | `.cursor/skills/{name}/SKILL.md` |
| `claude-code` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |
| `opencode` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |
| `codex` | `.agents/plugins/openlogos/skills/*/SKILL.md` | `$openlogos:{name}` → `.agents/plugins/openlogos/skills/{name}/SKILL.md` |
| `zcode` | `.zcode/plugins/openlogos/skills/*/SKILL.md` | `.zcode/plugins/openlogos/skills/{name}/SKILL.md` |
| `qoder` | `.qoder/plugins/openlogos/skills/*/SKILL.md` | `.qoder/plugins/openlogos/skills/{name}/SKILL.md` |
| `workbuddy` | `.workbuddy/plugins/openlogos/skills/*/SKILL.md` | `.workbuddy/plugins/openlogos/skills/{name}/SKILL.md` |
| `other` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |
| `all` 或数组 | 共享的多工具列表 | `logos/skills/{name}/SKILL.md`（只含 Codex 与 Cursor 的数组使用 Codex 格式） |

全部 17 个内置 Skill 均带描述列出。

对于 Codex，Active Skills 章节按命名空间分组。OpenLogos 方法论技能展示为 `$openlogos:<skill>`，并指向 `.agents/plugins/openlogos/skills/`。项目专属 Skills 保持在 OpenLogos 命名空间之外：项目插件技能使用 `.agents/plugins/<plugin>/skills/` 中的 `$<plugin>:<skill>`，历史或 repo-scoped local Skills 保留在 `.agents/skills/` 并归入项目专属分组。

对于 Claude Code，OpenLogos 方法论 Skills 仍位于 `logos/skills/`；`.claude/skills/<skill>/SKILL.md` 下的项目技能单独作为项目专属分组保留，不会复制进 OpenLogos 官方插件。

项目只配置了单一宿主时，`AGENTS.md` 还会附带该宿主的专属段落：

- **Cursor**：说明 Skills（`.cursor/skills/`，显式命令以 `/openlogos-<command>` 触发）与 change-reviewer subagent 的位置，并带一行固定的 guard 强度说明：Cursor 下写入门禁为部分强度，shell 命令经 `beforeShellExecution` 事前轻判并经 `afterShellExecution` 事后检查，文件编辑只经 `afterFileEdit` 事后报告。OpenLogos 未接入 Cursor 的 `preToolUse`，因此 Cursor 不会被表述为与 Claude Code 等价。
- **ZCode**：直接读取根 `AGENTS.md` 与插件 Skills，不依赖子目录 AGENTS、include 指令或 `CLAUDE.md`。
- **Qoder**：直接读取根 `AGENTS.md` 与插件 Skills，关键流程约束不依赖 `AGENTS.local.md`、`.qoder/rules` 或其它用户资产。
- **WorkBuddy**：方法论上下文来自插件 Skills / 命令与 SessionStart；原生记忆不构成授权，写入权限只由 `PreToolUse` hook 从磁盘重读项目状态后决定。

对于支持 Skill 绑定的工具（Claude Code、Cursor），阶段检测章节会包含直接文件路径，使 AI 能立即读取并执行 Skill 文件。

## 托管片段

`AGENTS.md` 和 `CLAUDE.md` 是用户可编辑的文件。OpenLogos 只维护固定 marker 之间的内容：

```markdown
<!-- OPENLOGOS:BEGIN -->
[OpenLogos generated instructions]
<!-- OPENLOGOS:END -->
```

- 文件不存在 → 新建，内容只有托管片段。
- 已有完整 marker → 只替换 marker 之间的内容，marker 外内容保持原样。
- 没有 marker，但内容与旧版 OpenLogos 生成模板等价 → 迁移为带 marker 的托管格式。
- 没有 marker，且有你自己的内容 → 保留原文，在文件末尾追加托管片段。
- marker 不完整（只有 begin 或只有 end）→ 写入直接报错；请修复或备份文件后重试。
- 已存在 `agents.md`、`Claude.md` 等大小写变体时，复用该文件，不会另建第二份。

## 数据来源

| 章节 | 来源 |
|---------|--------|
| Tech Stack | `logos-project.yaml` → `tech_stack` |
| Active Skills | `logos.config.json` → `aiTool` + 已部署 Skill 扫描 |
| Conventions | `logos-project.yaml` → `conventions` |
| Methodology Rules | 固定内容（不可自定义） |

## 生成时机

| 事件 | 触发条件 |
|-------|---------|
| `openlogos init` | 项目初始化时首次生成 |
| `openlogos init --ai-tool <tool>` | 为已初始化项目补齐目标工具后刷新 |
| `openlogos adopt` | 接入已有代码库时生成（launched 规则） |
| `openlogos sync` | 升级 CLI 或项目配置变更后重新生成 |
| `openlogos launch` | 切换到 launched 变更管理规则后刷新 |
| `project-init` Skill | AI 发起的项目初始化 |

所有入口都使用同一套托管片段合并逻辑，marker 之外的内容始终保留。

## 多平台适配

不同 AI 工具使用不同的指令文件名，但内容一致：

| 工具 | 指令文件 | Skill 位置 | 部署 |
|------|-----------------|----------------|------------|
| **Cursor** | `AGENTS.md`（原生支持） | `.cursor/skills/<name>/SKILL.md`（原生 Agent Skills，另含命令 Skills 与 change-reviewer subagent） | `init` / `sync` 部署 Skills，并向 `.cursor/hooks.json` 合并托管条目；你自己的 Skills、rules 与 hook 条目保留。见 [Cursor 插件](/zh/specs/cursor-plugin) |
| **Claude Code** | `CLAUDE.md` | `logos/skills/*/SKILL.md` | 由 `init` / `sync` 自动部署 |
| **OpenCode（兼容）** | `AGENTS.md` | `logos/skills/*/SKILL.md` | 由 `init` / `sync` 自动部署 |
| **OpenCode（插件）** | `opencode.json` + `.opencode/plugins/` | 插件加载 | 插件处理命令桥接，`AGENTS.md` 作为回退 |
| **Codex** | `AGENTS.md` + `.codex/config.toml` + `.agents/plugins/marketplace.json` | `$openlogos:<skill>` 使用 `.agents/plugins/openlogos/skills/*`；项目插件或 `.agents/skills/*` 单独保留 | `init` / `sync` 只刷新 marketplace 的 `openlogos` 条目并保留项目 Skills |
| **ZCode** | 根 `AGENTS.md` | `.zcode/plugins/openlogos/skills/` | `init` / `adopt` / `sync` / `launch` 安装插件；不修改 `.zcode/config.json`。见 [ZCode 插件](/zh/specs/zcode-plugin) |
| **Qoder** | 根 `AGENTS.md`（Qoder CLI 静态记忆） | `.qoder/plugins/openlogos/skills/` | `init` / `adopt` / `sync` / `launch` 安装插件；不修改 `AGENTS.local.md`、`.qoder/rules/` 与 Qoder 设置。见 [Qoder 插件](/zh/specs/qoder-plugin) |
| **WorkBuddy** | 根 `AGENTS.md` | `.workbuddy/plugins/openlogos/skills/` | `init` / `adopt` / `sync` / `launch` 安装插件；不修改 WorkBuddy 设置，不读写原生记忆。见 [WorkBuddy 插件](/zh/specs/workbuddy-plugin) |
| **GitHub Copilot** | `.github/copilot-instructions.md` | 计划中 | 未来版本 |

`openlogos sync` 会同时生成所有需要的指令文件，确保各 AI 工具间指令一致。

## 与 logos-project.yaml 的关系

| 文件 | 格式 | 受众 | 内容 |
|------|--------|----------|---------|
| `logos-project.yaml` | 结构化 YAML | AI + 工具 | 资源索引、技术栈、约定 |
| `AGENTS.md` | 自然语言 Markdown | AI 助手 | 行为指令、规则、Skill 列表 |

二者互补：`AGENTS.md` 指引 AI 去读 `logos-project.yaml`；`logos-project.yaml` 为 AI 提供可消费的结构化数据。
