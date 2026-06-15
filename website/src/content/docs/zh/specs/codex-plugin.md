---
title: Codex 插件
description: OpenLogos 在 OpenAI Codex CLI 上的原生插件规格——SessionStart hook、阶段上下文注入与双模式架构。
---

OpenLogos 为 OpenAI Codex CLI 提供原生插件，从基础的「AGENTS.md 兼容模式」升级为「插件优先 + 文档回退」的双轨机制。

## 运行模式

### 模式 A：兼容模式（始终可用）

- **输入**：`AGENTS.md` + `logos/skills/*/SKILL.md`
- **何时**：插件未安装或插件失败
- **体验**：零额外安装，基础功能

### 模式 B：原生插件模式（推荐）

- **输入**：自动生成的 `.codex-plugin/plugin.json`、`.codex-plugin/hooks/session-start.sh`、`.codex/config.toml`
- **何时**：完整体验，含 SessionStart 阶段注入、自动加载 Skill、统一工作流控制
- **体验**：增强，易于分发和版本管理

## 插件结构

执行 `openlogos init --ai-tool codex` 或 `openlogos init --ai-tool all` 之后：

```
project-root/
├── .codex-plugin/
│   ├── plugin.json              # Plugin manifest
│   └── hooks/
│       └── session-start.sh     # SessionStart hook script
├── .codex/
│   └── config.toml              # Plugin and hook configuration
├── .agents/
│   └── skills/                  # Codex-native Skill files
│       ├── prd-writer/SKILL.md
│       ├── scenario-architect/SKILL.md
│       └── ...                  # 16 Skills total
└── AGENTS.md                    # Fallback instructions
```

## 插件清单

`.codex-plugin/plugin.json`：

```json
{
  "name": "openlogos",
  "version": "0.10.3",
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
2. 审查 `.codex-plugin/hooks/session-start.sh`
3. 批准以启用 OpenLogos 阶段上下文注入

## 配置

`.codex/config.toml` 在部署期间是合并（而非覆盖）的：

```toml
[plugins]
openlogos = { path = ".codex-plugin" }

[hooks]
session-start = ".codex-plugin/hooks/session-start.sh"
```

## 与其他平台的对比

| 维度 | Claude Code | OpenCode | Codex |
|-----------|-------------|----------|-------|
| 插件机制 | `.claude/` 原生插件 | `.opencode/plugins/` JS | `.codex-plugin/` + hooks |
| SessionStart | settings.json hook | 插件 JS hook | shell hook 脚本 |
| Skill 位置 | `logos/skills/` | `logos/skills/` | `.agents/skills/` |
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
