# Codex 原生插件规范（OpenLogos）

> 版本：0.1.0（草案）
>
> 本文档定义 OpenLogos 在 OpenAI Codex CLI 平台上的原生插件方案，目标是把当前"AGENTS 兼容模式"升级为"插件优先 + 文档兜底"的双轨机制。

## 目标

1. 提供与 Claude Code 插件接近的交互体验（SessionStart hook + Phase 上下文注入）
2. 最大化复用现有 CLI（`openlogos *`）与 Skills（`logos/skills/*`）
3. 保留 `AGENTS.md` 兜底，确保插件不可用时流程不中断

## 运行模式

### 模式 A：兼容模式（当前可用）

- 输入：`AGENTS.md` + `logos/skills/*/SKILL.md`
- 适用：未安装插件或插件异常时
- 特点：零额外安装，体验相对基础

### 模式 B：原生插件模式（推荐）

- 输入：`openlogos init/sync` 自动生成的 `.codex-plugin/plugin.json`、`.codex-plugin/hooks/session-start.sh`、`.codex/config.toml`
- 适用：希望获得 SessionStart Phase 注入、技能自动加载、统一工作流控制
- 特点：体验增强，便于分发与版本管理

## 与其他工具的对比

| 维度 | Claude Code | OpenCode | Codex |
|---|---|---|---|
| 指令文件 | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| 技能路径 | `logos/skills/` | `logos/skills/` | `.agents/skills/<name>/SKILL.md` |
| 插件清单 | `plugin/` 目录 | `.opencode/plugins/openlogos.js` | `.codex-plugin/plugin.json` |
| 配置文件 | `.claude/settings.json` | `opencode.json` | `.codex/config.toml` |
| Hook 协议 | stdin/stdout JSON | 事件驱动 JS | stdin/stdout JSON（同 Claude Code） |
| 技能调用语法 | `/skill-name` | `/openlogos:*` | `$skill-name` |
| SessionStart | `hooks.json` | `session.created` | `[[hooks.SessionStart]]` |

## 目录结构

```text
openlogos/
├── plugin-codex/
│   ├── plugin.json            # 插件清单模板
│   └── session-start.sh       # SessionStart hook 脚本模板
└── spec/codex-plugin.md       # 本规范文档
```

用户项目部署后：

```text
<user-project>/
├── .agents/
│   └── skills/
│       ├── prd-writer/SKILL.md
│       ├── scenario-architect/SKILL.md
│       └── ... (全部 13 个 skill)
├── .codex-plugin/
│   ├── plugin.json
│   └── hooks/
│       └── session-start.sh
├── .codex/
│   └── config.toml
└── AGENTS.md                  # 兜底指令（始终保留）
```

## 构建与发布边界

1. 插件模板随 `@miniidealab/openlogos`（CLI 单包）一起发布，不单独发布 Codex 插件包。
2. 插件只负责"Hook 注入 + 上下文注入"，不复制 CLI 业务逻辑。
3. 版本策略：
   - 插件模板版本与 CLI 版本保持同步
   - 当依赖 CLI 新参数/新输出时，在同一 CLI 版本内联动升级
4. 发布产物包含 `codex-plugin-template/`（由构建脚本从 `plugin-codex/` 生成），由 `init/sync` 自动部署到用户项目。

## Hook 事件模型（MVP）

### `SessionStart`

Codex 支持的 SessionStart 输出字段：`systemMessage`、`stopReason`。

执行顺序：

1. 检查项目是否已初始化（`logos/logos.config.json`）
2. 调用 `openlogos status --format json` 获取当前 Phase 和建议
3. 读取 guard 文件检测活跃变更提案
4. 构建 `systemMessage`：包含当前 Phase、变更管理状态、语言策略
5. 注入失败时静默返回 `{}`，不阻断会话

### Hook 脚本降级策略

| 场景 | 行为 |
|---|---|
| `openlogos` CLI 不在 PATH | 静默返回 `{}`，不阻断会话 |
| 项目未初始化（无 logos.config.json） | 静默返回 `{}` |
| `openlogos status` 非 0 退出 | 静默返回 `{}` |
| Python3 和 Node 均不可用 | 输出简化 `systemMessage`（无 JSON 解析） |

## 命令调用

Codex 使用 `$skill-name` 语法调用技能（不同于 Claude Code 的 `/skill-name`）。`AGENTS.md` 中的 Active Skills 章节应使用 `$` 前缀说明。

## 配置格式（`.codex/config.toml`）

```toml
[plugins.openlogos]
enabled = true

[[hooks.SessionStart]]
[[hooks.SessionStart.hooks]]
type = "command"
command = ".codex-plugin/hooks/session-start.sh"
timeout = 5
async = false
statusMessage = "Loading OpenLogos phase context..."
```

## 安全边界

1. **最小权限原则**：hook 脚本只读取项目状态，不修改任何文件
2. **路径约束**：仅在工作区内执行，不允许跨目录写入
3. **错误可观测性**：所有 CLI 失败静默降级，不阻断会话
4. **降级策略**：插件不可用时，回退到 `AGENTS.md` 兼容模式

## 双轨策略

| 模式 | 配置 | 技能来源 | CLI 桥接 |
|---|---|---|---|
| **兼容**（兜底） | `AGENTS.md` only | `logos/skills/` | 无 |
| **原生插件**（推荐） | `.codex-plugin/` + `.codex/config.toml` | `.agents/skills/` | `session-start.sh` → `openlogos status` |

原生插件模式为推荐路径。`AGENTS.md` 始终保留作为降级兜底。

## 验收标准（文档阶段）

- `README.md` 已包含 Codex 原生插件安装说明
- `spec/agents-md.md` 已明确双轨模式包含 Codex
- 本文档定义了插件边界、事件、安全策略与双轨策略
