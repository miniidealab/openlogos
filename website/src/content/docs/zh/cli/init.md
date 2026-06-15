---
title: "openlogos init"
description: 初始化一个新的 OpenLogos 项目，包含目录结构、配置、AI Skills 和 spec 文件。
---

在当前目录中创建标准的 OpenLogos 项目结构。这是你启动新项目时运行的第一个命令。

## 命令格式

```bash
openlogos init [name] [--locale <en|zh>] [--ai-tool <claude-code|opencode|codex|cursor|other|all>]
```

对于已经初始化过的 OpenLogos 项目，显式传入 `--ai-tool` 会让 `init` 进入目标工具补齐模式：

```bash
openlogos init --ai-tool codex
```

## 参数

| 参数 | 说明 | 默认值 |
|----------|-------------|---------|
| `name` | 项目名称 | 从 `package.json`、`Cargo.toml`、`pyproject.toml` 或目录名自动检测 |

## 选项

| 选项 | 取值 | 默认值 | 说明 |
|--------|--------|---------|-------------|
| `--locale` | `en`, `zh` | 交互式提示 | 设置文档语言（跳过提示） |
| `--ai-tool` | `claude-code`, `opencode`, `codex`, `cursor`, `other`, `all` | 交互式提示 | 为新项目设置 AI 编码工具，或为已初始化项目补齐目标工具 |
| `--aitool` | 同 `--ai-tool` | 同 `--ai-tool` | `--ai-tool` 的等价别名 |

## 交互模式

在 TTY（终端）中运行时，`init` 会呈现两个交互式提示：

```
Choose language / 选择语言:
  1. English (default)
  2. 中文

Your choice [1/2] (default: 1): 1

Choose AI coding tool / 选择 AI 编码工具:
  1. Claude Code (default)
  2. OpenCode
  3. Codex
  4. Cursor
  5. Other
  6. All (deploy for all tools)

Your choice [1/2/3/4/5/6] (default: 1):
```

## 非交互模式（CI）

在非 TTY 环境（CI 流水线、脚本）中，`--locale` 是**必需的**：

```bash
openlogos init my-project --locale en --ai-tool claude-code
```

如果在非 TTY 模式下省略 `--locale`，命令会以错误退出。如果省略 `--ai-tool`，则会自动检测：
- 如果设置了 `CLAUDE_PLUGIN_ROOT` 或 `CLAUDE_CODE` 环境变量 → `claude-code`
- 否则 → `claude-code`（默认）

## 为已初始化项目补齐 AI 工具目标

如果 `logos/logos.config.json` 已存在，`openlogos init` 默认仍会拒绝重建项目。显式传入 `--ai-tool` 后，命令会改为执行增量补齐：

```bash
# 原本按 Cursor 初始化的项目，可以补齐 Codex 支持
openlogos init --ai-tool codex

# 补齐所有内置部署目标
openlogos init --ai-tool all
```

目标工具补齐模式会：

- 更新 `logos/logos.config.json`，将请求的目标工具合并到 `aiTool`
- 基于当前工具集合和 lifecycle 状态重新生成 `AGENTS.md` 与 `CLAUDE.md`
- 部署目标工具所需的 Skills、插件、hooks、斜杠命令和 rules
- 同步方法论规格到 `logos/spec/`
- 保留 `logos/resources/`、`logos/logos-project.yaml` 和现有项目文档

重复执行是幂等的。例如连续运行两次 `openlogos init --ai-tool codex`，`aiTool` 中只会保留一个 `codex` 条目，也不会重复写入 Codex SessionStart hook。

## 创建内容

### 目录

```
logos/resources/prd/1-product-requirements/
logos/resources/prd/2-product-design/1-feature-specs/
logos/resources/prd/2-product-design/2-page-design/
logos/resources/prd/3-technical-plan/1-architecture/
logos/resources/prd/3-technical-plan/2-scenario-implementation/
logos/resources/api/
logos/resources/database/
logos/resources/test/
logos/resources/scenario/
logos/resources/verify/
logos/changes/
logos/changes/archive/
```

每个目录都包含一个 `.gitkeep` 文件，这样空目录也能被 Git 跟踪。

### 配置文件

| 文件 | 说明 |
|------|-------------|
| `logos/logos.config.json` | 项目名称、locale、AI 工具、lifecycle 状态、文档路径 |
| `logos/logos-project.yaml` | AI 可读的项目资源索引 |

### AI 指令文件

| 文件 | 说明 |
|------|-------------|
| `AGENTS.md` | 通用 AI 指令文件（由 Cursor、OpenCode 和其他工具读取） |
| `CLAUDE.md` | Claude Code 专属指令文件 |

### Skills 部署

部署目标取决于所选的 AI 工具：

| AI 工具 | Skills 目标 | 数量 |
|---------|--------------|-------|
| Claude Code | `logos/skills/`（13 个含 `SKILL.md` 的子目录） | 13 |
| OpenCode | `logos/skills/`（13 个含 `SKILL.md` 的子目录） | 13 |
| Codex | `.agents/skills/`（13 个含 `SKILL.md` 的子目录） | 13 |
| Cursor | `.cursor/rules/`（13 个 `.mdc` 规则文件 + 1 个 policy 文件） | 14 |
| Other | `logos/skills/`（13 个含 `SKILL.md` 的子目录） | 13 |

当选择 `--ai-tool all` 时，OpenLogos 会部署每一个具体目标：Claude Code、OpenCode、Codex 和 Cursor。共享指令文件（`AGENTS.md` 和 `CLAUDE.md`）会以多工具 Skill 路径语义生成。

### Spec 文件

13 个规格文件会被部署到 `logos/spec/`：

- `test-results.md` —— 测试结果的 JSONL 格式规格
- `sql-comment-convention.md` —— SQL 注释约定
- 以及另外 11 个方法论规格

### 工具专属的额外内容

**Claude Code** —— 当 `--ai-tool` 为 `claude-code` 或 `all` 时，自动部署 Claude Code 插件：
- `.claude/commands/openlogos/` —— 斜杠命令（status、next、change、merge、archive、verify、sync、launch、init、index）
- `.claude/agents/change-reviewer.md` —— 变更提案审查 sub-agent
- `.claude/openlogos/bin/openlogos-phase` —— SessionStart hook 脚本
- `.claude/settings.json` —— 注册 SessionStart hook（合并写入，不覆盖）

幂等：如果 `.claude/commands/openlogos/` 中已有文件，则跳过部署以保留用户的自定义内容。

**OpenCode** —— 额外部署：
- `.opencode/plugins/openlogos.js` —— OpenCode 插件
- `opencode.json` —— 权限默认值（`bash: "ask"`、`skill: "allow"`）
- `.opencode/commands/` —— 10 个斜杠命令文件

**Codex** —— 当 `--ai-tool` 为 `codex` 或 `all` 时，额外部署：
- `.codex-plugin/plugin.json` —— Codex 插件清单
- `.codex-plugin/hooks/session-start.sh` —— SessionStart hook 脚本
- `.codex/config.toml` —— 插件和 hook 配置，合并写入而不移除已有设置

OpenLogos 会通过添加所需的 YAML frontmatter（`name` 和 `description`），将 `.agents/skills/<name>/SKILL.md` 中的每个 Codex Skill 转换为原生 Codex Skill 格式。这可以防止 Codex 因 `missing YAML frontmatter` 警告而跳过 Skills。

在插件部署后首次启动时，Codex 可能会显示 `hook needs review before it can run`。这是 Codex 的 hook 安全审查。如果你希望在会话启动时注入 OpenLogos 阶段上下文，请在 Codex 中打开 `/hooks` 并批准 `.codex-plugin/hooks/session-start.sh`。

**Cursor** —— 额外部署：
- `.cursor/rules/openlogos-policy.mdc` —— 始终生效的 policy 规则

## 项目名称解析

项目名称按以下顺序解析：

1. 显式的 `name` 参数（例如 `openlogos init my-project`）
2. `package.json` 中的 `name` 字段（去除 `@scope/` 前缀）
3. `Cargo.toml` 中的 `name` 字段（`[package]` 分节）
4. `pyproject.toml` 中的 `name` 字段（`[project]` 分节）
5. 当前目录名（`cwd` 的 basename）

如果同时存在显式名称和配置文件名称且两者不同，CLI 会提示你做选择。

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `logos/logos.config.json already exists` | 目录已初始化且没有请求目标工具 | 使用 `openlogos init --ai-tool <tool>` 补齐目标工具，或使用 `openlogos sync` 刷新当前配置 |
| `--locale is required in non-interactive mode` | 在 CI 中运行但没有 `--locale` | 添加 `--locale en` 或 `--locale zh` |

## 相关命令

- [`sync`](/zh/cli/sync) — 在配置变更后更新 AI 指令和 Skills
- [`status`](/zh/cli/status) — 检查项目阶段推进情况
