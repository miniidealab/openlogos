---
title: "openlogos sync"
description: 按当前 CLI 版本与项目配置，刷新 AI 指令文件、Skills、宿主插件、hooks、guard 脚本和 specs。
---

把项目中所有 OpenLogos 托管的文件更新到与已安装 CLI 和当前 `logos/logos.config.json` 一致。升级 CLI 后、手动编辑配置后、或更换 AI 工具后运行此命令。

:::caution[升级 CLI 之后]
安装新版本 CLI 后，请**在每个已有项目的根目录**执行一次 `openlogos sync`。不执行 sync，该项目仍运行旧版 guard 脚本与 hooks。详见[从 0.13.x 升级](/zh/getting-started/upgrade-from-0-13)。
:::

## 命令格式

```bash
openlogos sync
```

无参数或选项。必须在项目根目录下运行（即存在 `logos/logos.config.json` 的位置）。

## 刷新范围

| 范围 | `sync` 做什么 |
|------|------------------|
| guard 脚本与事后检查引擎 | 用 CLI 随包字节重写托管 guard 资产：Claude Code 的 `.claude/openlogos/bin/guard-check` 与 `guard-post-check.cjs`，Cursor 的 `.cursor/hooks/openlogos-runtime.cjs` 与 `openlogos-guard-post.cjs`，以及 ZCode / Qoder / WorkBuddy 插件内的 hook runtime |
| Claude Code hooks | 向 `.claude/settings.json` 合并 `SessionStart`、`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`Stop`；旧版 OpenLogos hook 条目就地迁移，其他 hooks 不动 |
| 回复语言 | 按项目 locale 写入 `.claude/settings.json` 顶层 `language`（`"chinese"` / `"english"`）；你设置的自定义值保留并提示 |
| Skills | 向每个已配置宿主的目标位置重新部署 Skills（见下表） |
| 宿主插件 | 为每个已配置工具重新部署 OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy 资产 |
| `.gitignore` 托管区块 | 按 `guard.unversioned` 重新渲染 `# >>> openlogos managed >>>` 区块（固定包含 `logos/.openlogos-runtime/`），区块外内容不动 |
| `.gitattributes` 托管区块 | 让 `logos/**` 与托管 hook 文件的换行保持字节一致；已被转成 CRLF 的文件按 git 索引恢复并报告 |
| 指令文件 | 按当前 locale、工具集合和 lifecycle 重新生成 `AGENTS.md`、`CLAUDE.md` 中的 OpenLogos 托管片段 |
| Specs | 把随包方法论规格复制到 `logos/spec/` |
| 项目数据 | 同步 `logos-project.yaml` 的项目名称、回填缺失的 `scenarios[].module`、补录缺失的 `resource_index` 条目，并在 `logos.config.json` 中补齐 `documents.changes`、`sourceRoots` 和 `verify.pre_run_command` |

成功后写入 `logos/.openlogos-sync.json`，记录项目已同步到哪一份随包资产清单。

### 各宿主目标

`aiTool` 可以是单个值、数组或 `all`。`sync` 会展开它并刷新每一个具体目标：

| 工具 | Skills 目标 | 其他资产 |
|------|---------------|--------------|
| Claude Code | `logos/skills/` | `.claude/commands/openlogos/`、`.claude/agents/`、`.claude/openlogos/bin/`、`.claude/settings.json` |
| OpenCode | `logos/skills/` | `.opencode/plugins/openlogos.js`、`.opencode/commands/`、`opencode.json` |
| Codex | `.agents/plugins/openlogos/skills/` | `.agents/plugins/openlogos/`、`.agents/plugins/marketplace.json`、`.codex/config.toml` |
| Cursor | `.cursor/skills/` | `.cursor/agents/`、`.cursor/hooks.json`（仅托管条目）、`.cursor/hooks/` |
| ZCode | `.zcode/plugins/openlogos/skills/` | `.zcode/plugins/openlogos/` |
| Qoder | `.qoder/plugins/openlogos/skills/` | `.qoder/plugins/openlogos/` |
| WorkBuddy | `.workbuddy/plugins/openlogos/skills/` | `.workbuddy/plugins/openlogos/` |
| Other | `logos/skills/` | 无 |

配置了多个工具时，`AGENTS.md` 和 `CLAUDE.md` 以多工具 Skill 路径生成，使 Active Skills 章节与实际部署位置一致。

各宿主补充说明：

- **Codex**：Skills 会以 Codex 要求的 YAML frontmatter（`name`、`description`）重写；`.agents/plugins/marketplace.json` 中只改 `openlogos` 条目。Codex 可能仍需要对 `.agents/plugins/openlogos/hooks/session-start.sh` 做一次 `/hooks` 审查。
- **Cursor**：`sync` 会补齐缺失的托管 hook 条目（例如早于 `afterShellExecution` 创建的项目），重复执行零 diff。
- **ZCode / Qoder / WorkBuddy**：插件目录整体替换，失败时回滚；你放在插件目录里的额外文件会保留。请新建宿主 session 以加载刷新后的插件。

## 从旧版迁移

用旧版 OpenLogos 搭建的项目，`sync` 还会自动完成以下一次性迁移，无需另行操作：

- **Cursor 规则 → Skills**：OpenLogos 托管的 `.cursor/rules/` 规则文件（每个 OpenLogos Skill 一个 `<skill>.mdc`，外加 `openlogos-policy.mdc`）迁移为 `.cursor/skills/<name>/SKILL.md`。只删除这份清单里的确切文件名，且只在新 Skills 与 hook 条目写入成功之后才删除；`.cursor/rules/` 下你自己的规则文件永远不动。CLI 会逐项列出删除与保留的文件。
- **旧版 guard → 现行 guard**：替换旧版 guard 脚本与 hook 注册，并补上事后检查 hooks（Claude Code 的 `PostToolUse` / `PostToolUseFailure` / `Stop`，Cursor 的 `afterShellExecution`）。
- **项目 lifecycle**：旧的项目级 `lifecycle: "active"` 迁移为模块级 `launched`。

升级后请**在每个已有项目**执行一次。完整升级步骤见[从 0.13.x 升级](/zh/getting-started/upgrade-from-0-13)。

## 输出示例

```
Syncing project files... (openlogos v0.16.0)

  ✓ logos-project.yaml resource_index 已是最新，无需补录
  ✓ AGENTS.md updated
  ✓ CLAUDE.md updated
  ✓ <n> 个 Skills 已同步到 logos/skills/
  ✓ Claude Code 插件已同步：<n> 个命令，<n> 个 agent → .claude/
  ✓ <n> specs synced to logos/spec/
  ✓ .gitignore OpenLogos 托管区块已更新

Sync complete.
```

实际输出取决于已配置的工具和本次真正变化的内容。`scenario 已补全 module 字段` 这类行只在确有需要回填时出现。

## 使用时机

- 升级 `openlogos` CLI 之后，在每个已有项目执行一次
- 编辑 `logos/logos.config.json` 之后（名称、locale、AI 工具、`guard.unversioned`）
- 项目中途切换 AI 工具，或把 `aiTool` 改为数组或 `all` 之后
- 运行 `openlogos launch` 后，如需强制重新生成文件

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `logos/logos.config.json not found` | 不在项目根目录，或项目未初始化 | `cd` 到项目根目录，或先运行 `openlogos init` |
| `未知的 AI Adapter id：<value>` | 配置中的 `aiTool` 含不支持的取值 | 把 `aiTool` 改为 `claude-code`、`opencode`、`codex`、`cursor`、`zcode`、`qoder`、`workbuddy`、`other`、`all` 之一；此时没有写入任何内容 |
| `baseline_commit_in_progress` | 某模块的 `baseline-seed` 提交正在进行 | 等提交完成后重试 `openlogos sync`；此时没有写入任何内容 |
| `sync 部分完成：.gitignore 托管区块未更新。`（退出码 1） | `.gitignore` 托管区块损坏，或 `guard.unversioned` 含非法条目 | 按提示修复标记或条目后重试；其余内容已同步 |
| 随包缺少 guard 事后检查引擎 | 已安装的包不完整 | 重新安装 `openlogos` 后再运行 `openlogos sync` |

## 相关命令

- [`init`](/zh/cli/init)：首次项目搭建，或用 `--ai-tool` 补齐目标工具
- [`launch`](/zh/cli/launch)：激活变更管理（也会在内部重新生成文件）
- [`ignore` / `exempt`](/zh/cli/ignore-exempt)：调整渲染进 `.gitignore` 托管区块的条目
