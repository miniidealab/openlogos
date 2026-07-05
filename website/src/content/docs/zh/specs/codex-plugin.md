---
title: Codex 插件
description: OpenLogos 在 OpenAI Codex CLI 上的原生插件规格——SessionStart hook、阶段上下文注入与双模式架构。
---

OpenLogos 为 OpenAI Codex CLI 提供原生插件，从基础的「AGENTS.md 兼容模式」升级为「插件优先 + 文档回退」的双轨机制。

## 运行模式

### 模式 A：兼容模式（始终可用）

- **输入**：`AGENTS.md` 以及历史 `logos/skills/*/SKILL.md`、`.codex-plugin/` 或 `.agents/skills/*`
- **何时**：插件未安装、插件失败，或历史项目尚未迁移到 repo marketplace
- **体验**：零额外安装，基础功能

### 模式 B：原生插件模式（推荐）

- **输入**：自动生成的 `.agents/plugins/marketplace.json`、`.agents/plugins/openlogos/` 与 `.codex/config.toml`
- **何时**：完整体验，含 SessionStart 阶段注入、自动加载 Skill、统一工作流控制
- **体验**：增强，易于分发和版本管理

## 插件结构

执行 `openlogos init --ai-tool codex` 或 `openlogos init --ai-tool all` 之后：

```
project-root/
├── .agents/
│   ├── plugins/
│   │   ├── marketplace.json     # repo marketplace，包含 openlogos 条目
│   │   ├── openlogos/
│   │   │   ├── .codex-plugin/
│   │   │   │   └── plugin.json
│   │   │   ├── hooks/
│   │   │   │   └── session-start.sh
│   │   │   └── skills/
│   │   │       ├── prd-writer/SKILL.md
│   │   │       ├── scenario-architect/SKILL.md
│   │   │       └── ...          # OpenLogos 方法论 Skills
│   │   └── <project-plugin>/
│   │       └── skills/<project-skill>/SKILL.md
│   └── skills/                  # 历史或 repo-scoped 项目 Skills
├── .codex/
│   └── config.toml              # Plugin and hook configuration
└── AGENTS.md                    # Fallback instructions
```

## 插件清单

`.agents/plugins/openlogos/.codex-plugin/plugin.json`：

```json
{
  "name": "openlogos",
  "version": "0.12.9",
  "description": "OpenLogos methodology plugin for Codex CLI",
  "hooks": {
    "session-start": "./hooks/session-start.sh"
  }
}
```

## SessionStart Hook

hook 脚本（`session-start.sh`）在每个 Codex 会话开始时运行，并注入：

1. 当前项目阶段（通过 `openlogos detect` 检测）
2. 活跃变更提案状态
3. 下一步建议
4. 语言策略提醒

这让 Codex 获得与 Claude Code 通过其原生插件系统所获得的相同的阶段感知上下文。

## Skill 命名空间边界

Codex 的 OpenLogos 方法论 Skills 使用 `openlogos` 命名空间，例如 `$openlogos:prd-writer`、`$openlogos:scenario-architect`、`$openlogos:change-writer`。这些 Skills 位于 `.agents/plugins/openlogos/skills/`。

项目专属 Skills 必须保留在 OpenLogos 命名空间之外。项目插件使用自己的命名空间，例如 `.agents/plugins/adcn/skills/` 中的 `$adcn:release-guard`。历史或 repo-scoped local Skills 可以继续位于 `.agents/skills/`，并在 `AGENTS.md` 中归入项目专属 Skills，而不是 OpenLogos 官方能力。

`openlogos init` 与 `openlogos sync` 只更新或插入 `.agents/plugins/marketplace.json` 中的 `openlogos` 条目；已有项目插件条目会原样保留。历史 `.codex-plugin/` 目录作为兼容入口保留，新 OpenLogos 资产写入 `.agents/plugins/openlogos/`。

## Codex 的 Skill 格式

Codex 要求 Skill 文件带 YAML frontmatter。OpenLogos 在部署期间自动转换每个 Skill：

```markdown
---
name: prd-writer
description: "Write scenario-driven requirements with GIVEN/WHEN/THEN acceptance criteria"
---
# Skill: PRD Writer
...
```

没有这段 frontmatter，Codex 会显示 `missing YAML frontmatter` 警告并跳过该 Skill。

## Hook 安全审查

插件部署后首次启动时，Codex 可能显示 `hook needs review before it can run`。这是 Codex 的标准 hook 安全审查：

1. 在 Codex 中打开 `/hooks`
2. 审查 `.agents/plugins/openlogos/hooks/session-start.sh`
3. 批准以启用 OpenLogos 阶段上下文注入

## 配置

`.codex/config.toml` 在部署期间是合并（而非覆盖）的：

```toml
[plugins]
openlogos = { path = ".agents/plugins/openlogos" }

[hooks]
session-start = ".agents/plugins/openlogos/hooks/session-start.sh"
```

## 与其他平台的对比

| 维度 | Claude Code | OpenCode | Codex |
|-----------|-------------|----------|-------|
| 插件机制 | `.claude/` 原生插件 | `.opencode/plugins/` JS | repo marketplace + `.agents/plugins/openlogos/` |
| SessionStart | settings.json hook | 插件 JS hook | shell hook 脚本 |
| Skill 位置 | `logos/skills/` 加 `.claude/skills/` 项目 Skills | `logos/skills/` | `$openlogos:<skill>` 使用 `.agents/plugins/openlogos/skills/`；项目 Skills 保持项目命名空间 |
| 斜杠命令 | `.claude/commands/` | `.opencode/commands/` | 无（AGENTS.md） |
| 回退 | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |

## 部署

```bash
# Deploy Codex plugin for an existing project
openlogos init --ai-tool codex

# Deploy all tool targets
openlogos init --ai-tool all

# Refresh after updates
openlogos sync
```

## 相关

- [OpenCode 插件](/zh/specs/opencode-plugin)——OpenCode 集成规格
- [AGENTS.md](/zh/specs/agents-md)——通用 AI 指令文件（所有工具的回退）
- [项目结构](/zh/specs/project-structure)——标准目录布局
