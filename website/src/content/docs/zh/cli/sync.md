---
title: "openlogos sync"
description: 重新生成 AI 指令文件、Skills 和 specs，以反映当前的项目配置。
---

将所有生成的文件（`AGENTS.md`、`CLAUDE.md`、Skills、specs）与当前的 `logos.config.json` 设置同步。在手动编辑配置或更换 AI 工具后运行此命令。

## 命令格式

```bash
openlogos sync
```

无参数或选项。必须在项目根目录下运行（即存在 `logos/logos.config.json` 的位置）。

## 功能说明

1. **同步项目名称**，使 `logos-project.yaml` 与 `logos.config.json` 保持一致
2. **回填 `scenarios[].module` 字段** 到 `logos-project.yaml` —— 对于任何缺少 `module` 字段的场景条目，从文件系统推断其所属模块（在 scenario-implementation 目录中查找 `<moduleId>-SXX-*.md`），找不到则回退到 `core`。幂等：已有 `module` 字段的条目保持不变。
3. **确保 `documents.changes`** 分节存在于 `logos.config.json` 中（缺失时添加）
4. **重新生成 `AGENTS.md`**，基于当前的 locale、AI 工具和 lifecycle
5. **重新生成 `CLAUDE.md`**，基于当前的 locale、AI 工具和 lifecycle
6. **重新部署 Skills** 到每个已配置的目标目录
7. **重新部署 specs** 到 `logos/spec/`
8. **工具插件**：重新部署已配置的 OpenCode、Codex 和 Claude Code 插件资源

`aiTool` 可以是单个值、数组或 `all`。当它是数组或 `all` 时，`sync` 会展开它并部署每一个具体的工具目标：

| 工具 | Skills 目标 | 额外资源 |
|------|---------------|--------------|
| Claude Code | `logos/skills/` | `.claude/commands/openlogos/`, `.claude/agents/`, `.claude/openlogos/bin/`, `.claude/settings.json` |
| OpenCode | `logos/skills/` | `.opencode/plugins/openlogos.js`, `opencode.json`, `.opencode/commands/` |
| Codex | `.agents/skills/` | `.codex-plugin/`, `.codex/config.toml` |
| Cursor | `.cursor/rules/` | `.cursor/rules/openlogos-policy.mdc` |

当配置了多个工具时，`AGENTS.md` 和 `CLAUDE.md` 会以多工具语义重新生成，使它们的 Active Skills 路径与已部署的目标匹配。

对于 Codex 项目，`sync` 会用原生 Codex Skill 格式重写 `.agents/skills/<name>/SKILL.md`，包括所需的 YAML frontmatter（`name` 和 `description`）。如果较旧的 OpenLogos 版本生成了没有 frontmatter 的无效 Codex Skills，升级后运行 `openlogos sync` 会修复这些文件。

Codex SessionStart hooks 也会被幂等地重新部署。Codex 可能仍需要一次性的 `/hooks` 审查才能运行 `.codex-plugin/hooks/session-start.sh`；这是 Codex 预期的安全行为。

## 输出示例

```
Syncing project files...

  ✓ logos-project.yaml name synced to "my-project"
  ✓ 3 scenario(s) backfilled with module field in logos-project.yaml
  ✓ documents.changes added to logos.config.json
  ✓ AGENTS.md updated
  ✓ CLAUDE.md updated
  ✓ 16 skills synced to logos/skills/
  ✓ 16 skills synced to .agents/skills/
  ✓ 17 skills synced to .cursor/rules/
  ✓ 13 specs synced to logos/spec/

Sync complete.
```

`scenarios backfilled` 这一行只在存在缺少 `module` 字段的场景条目时出现。后续运行时它会保持静默（幂等）。

## 使用时机

- 在编辑 `logos/logos.config.json` 后（修改名称、locale 或 AI 工具）
- 在将 `openlogos` CLI 升级到新版本后（以获取更新的 Skill 内容）
- 在项目中途切换 AI 工具时（例如从 Cursor 切换到 Claude Code）
- 当 `aiTool` 改为数组或 `all`，需要刷新每个工具目标时
- 在运行 `openlogos launch` 后，如果需要强制重新生成文件

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `logos/logos.config.json not found` | 不在项目根目录，或项目未初始化 | `cd` 到项目根目录，或先运行 `openlogos init` |

## 相关命令

- [`init`](/zh/cli/init) — 首次项目搭建（后续更新使用 `sync`）
- [`launch`](/zh/cli/launch) — 激活变更管理（也会在内部重新生成文件）
