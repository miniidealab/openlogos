---
title: "openlogos init"
description: Initialize a new OpenLogos project with directory structure, configuration, AI Skills, and spec files.
---

Create the standard OpenLogos project structure in the current directory. This is the first command you run when starting a new project.

## Synopsis

```bash
openlogos init [name] [--locale <en|zh>] [--ai-tool <claude-code|opencode|codex|cursor|other|all>]
```

对于已经初始化过的 OpenLogos 项目，显式传入 `--ai-tool` 会让 `init` 进入目标工具补齐模式：

```bash
openlogos init --ai-tool codex
```

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `name` | Project name | Auto-detected from `package.json`, `Cargo.toml`, `pyproject.toml`, or directory name |

## Options

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--locale` | `en`, `zh` | Interactive prompt | Set the document language (skips prompt) |
| `--ai-tool` | `claude-code`, `opencode`, `codex`, `cursor`, `other`, `all` | Interactive prompt | 为新项目设置 AI 编码工具，或为已初始化项目补齐目标工具 |
| `--aitool` | Same as `--ai-tool` | Same as `--ai-tool` | `--ai-tool` 的等价别名 |

## Interactive mode

When run in a TTY (terminal), `init` presents two interactive prompts:

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

## Non-interactive mode (CI)

In non-TTY environments (CI pipelines, scripts), `--locale` is **required**:

```bash
openlogos init my-project --locale en --ai-tool claude-code
```

If `--locale` is omitted in non-TTY mode, the command exits with an error. If `--ai-tool` is omitted, it auto-detects:
- If `CLAUDE_PLUGIN_ROOT` or `CLAUDE_CODE` env vars are set → `claude-code`
- Otherwise → `claude-code` (default)

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

## What it creates

### Directories

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

Each directory contains a `.gitkeep` file so empty directories are tracked by Git.

### Configuration files

| File | Description |
|------|-------------|
| `logos/logos.config.json` | Project name, locale, AI tool, lifecycle state, document paths |
| `logos/logos-project.yaml` | AI-readable project resource index |

### AI instruction files

| File | Description |
|------|-------------|
| `AGENTS.md` | Universal AI instruction file (read by Cursor, OpenCode, and other tools) |
| `CLAUDE.md` | Claude Code-specific instruction file |

### Skills deployment

The deployment target depends on the chosen AI tool:

| AI Tool | Skills target | Count |
|---------|--------------|-------|
| Claude Code | `logos/skills/` (13 subdirectories with `SKILL.md`) | 13 |
| OpenCode | `logos/skills/` (13 subdirectories with `SKILL.md`) | 13 |
| Codex | `.agents/skills/` (13 subdirectories with `SKILL.md`) | 13 |
| Cursor | `.cursor/rules/` (13 `.mdc` rule files + 1 policy file) | 14 |
| Other | `logos/skills/` (13 subdirectories with `SKILL.md`) | 13 |

When `--ai-tool all` is selected, OpenLogos deploys every concrete target: Claude Code, OpenCode, Codex, and Cursor. Shared instruction files (`AGENTS.md` and `CLAUDE.md`) are generated with multi-tool Skill path semantics.

### Spec files

13 specification files are deployed to `logos/spec/`:

- `test-results.md` — JSONL format specification for test results
- `sql-comment-convention.md` — SQL comment conventions
- And 11 additional methodology specifications

### Tool-specific extras

**Claude Code** — When `--ai-tool` is `claude-code` or `all`, automatically deploys the Claude Code plugin:
- `.claude/commands/openlogos/` — slash commands (status, next, change, merge, archive, verify, sync, launch, init, index)
- `.claude/agents/change-reviewer.md` — change proposal reviewer sub-agent
- `.claude/openlogos/bin/openlogos-phase` — SessionStart hook script
- `.claude/settings.json` — registers the SessionStart hook (merged, not overwritten)

Idempotent: if `.claude/commands/openlogos/` already has files, the deployment is skipped to preserve user customizations.

**OpenCode** — Additionally deploys:
- `.opencode/plugins/openlogos.js` — OpenCode plugin
- `opencode.json` — Permission defaults (`bash: "ask"`, `skill: "allow"`)
- `.opencode/commands/` — 10 slash command files

**Codex** — When `--ai-tool` is `codex` or `all`, additionally deploys:
- `.codex-plugin/plugin.json` — Codex plugin manifest
- `.codex-plugin/hooks/session-start.sh` — SessionStart hook script
- `.codex/config.toml` — plugin and hook configuration, merged without removing existing settings

**Cursor** — Additionally deploys:
- `.cursor/rules/openlogos-policy.mdc` — Always-applied policy rule

## Project name resolution

The project name is resolved in this order:

1. Explicit `name` argument (e.g., `openlogos init my-project`)
2. `name` field from `package.json` (with `@scope/` prefix stripped)
3. `name` field from `Cargo.toml` (`[package]` section)
4. `name` field from `pyproject.toml` (`[project]` section)
5. Current directory name (basename of `cwd`)

If both an explicit name and a config file name exist and they differ, the CLI prompts you to choose.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `logos/logos.config.json already exists` | 目录已初始化且没有请求目标工具 | 使用 `openlogos init --ai-tool <tool>` 补齐目标工具，或使用 `openlogos sync` 刷新当前配置 |
| `--locale is required in non-interactive mode` | Running in CI without `--locale` | Add `--locale en` or `--locale zh` |

## Related commands

- [`sync`](/cli/sync) — Update AI instructions and Skills after configuration changes
- [`status`](/cli/status) — Check project phase progression
