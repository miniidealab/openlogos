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

- 输入：`AGENTS.md` + OpenLogos managed block；历史项目可能还存在 `.codex-plugin/` 或 `.agents/skills/*`
- 适用：未安装插件、插件异常或历史项目尚未迁移 repo marketplace 时
- 特点：零额外安装，体验相对基础；不得把项目专属 skill 解释为 OpenLogos 官方 skill

### 模式 B：repo marketplace 原生插件模式（推荐）

- 输入：`openlogos init/sync` 自动生成或维护的 `.agents/plugins/marketplace.json`、`.agents/plugins/openlogos/`、`.codex/config.toml`
- 适用：希望获得 SessionStart Phase 注入、技能自动加载、统一工作流控制，并与项目插件共存
- 特点：OpenLogos 方法论技能处于 `openlogos` 插件命名空间；项目专属技能处于项目自己的插件命名空间或 repo-scoped local skill

## 与其他工具的对比

| 维度 | Claude Code | OpenCode | Codex |
|---|---|---|---|
| 指令文件 | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| 技能路径 | `logos/skills/` / `.claude/skills/` | `logos/skills/` | `.agents/plugins/openlogos/skills/` + 项目插件或 repo-scoped local skill |
| 插件清单 | `plugin/` 目录 | `.opencode/plugins/openlogos.js` | `.agents/plugins/marketplace.json` + `.agents/plugins/openlogos/.codex-plugin/plugin.json` |
| 配置文件 | `.claude/settings.json` | `opencode.json` | `.codex/config.toml` |
| Hook 协议 | stdin/stdout JSON | 事件驱动 JS | stdin/stdout JSON（同 Claude Code） |
| 技能调用语法 | `/skill-name` 或插件命名空间命令 | `/openlogos:*` | `$openlogos:<skill>`；项目技能使用 `$<project-plugin>:<skill>` 或本地 skill 名 |
| SessionStart | `hooks.json` | `session.created` | `[[hooks.SessionStart]]` |

## 目录结构

```text
openlogos/
├── plugin-codex/
│   ├── plugin.json            # OpenLogos 插件清单模板
│   ├── marketplace.json       # repo marketplace 条目模板
│   └── session-start.sh       # SessionStart hook 脚本模板
└── spec/codex-plugin.md       # 本规范文档
```

用户项目部署后：

```text
<user-project>/
├── .agents/
│   ├── plugins/
│   │   ├── marketplace.json
│   │   ├── openlogos/
│   │   │   ├── .codex-plugin/
│   │   │   │   └── plugin.json
│   │   │   ├── hooks/
│   │   │   │   └── session-start.sh
│   │   │   └── skills/
│   │   │       ├── prd-writer/SKILL.md
│   │   │       ├── scenario-architect/SKILL.md
│   │   │       └── ... (OpenLogos 官方 skill)
│   │   └── <project-plugin>/
│   │       └── skills/<project-skill>/SKILL.md
│   └── skills/
│       └── <legacy-or-local-project-skill>/SKILL.md
├── .codex/
│   └── config.toml
└── AGENTS.md                  # 兜底指令（始终保留）
```

## Skill 命名空间边界

Codex 中 `openlogos` 是 OpenLogos 官方方法论命名空间。该命名空间只允许包含 OpenLogos 分发的 Skills，例如 `openlogos:prd-writer`、`openlogos:scenario-architect`、`openlogos:change-writer`。

项目 / 产品 / 仓库专属 Skills 必须满足以下任一条件：
1. 位于项目自己的插件命名空间，例如 `adcn:release-guard`。
2. 位于明确的 repo-scoped local skill 目录，并在 `AGENTS.md` 中以项目专属技能分组说明。
3. 保留在历史 `.agents/skills/*` 时，不被 OpenLogos 同步逻辑重命名或复制到 `openlogos` 插件。

禁止行为：
- 不得把 `.agents/skills/release-guard/SKILL.md` 复制到 `.agents/plugins/openlogos/skills/release-guard/SKILL.md`。
- 不得在 marketplace 中把项目插件条目改名为 `openlogos`。
- 不得在 `AGENTS.md` 中把项目专属技能描述为 OpenLogos 官方方法论技能。

## 兼容迁移策略

`openlogos init/sync --ai-tool codex` 的迁移策略：
1. 若项目没有 Codex 插件资产，生成 repo marketplace 和 `openlogos` 插件。
2. 若项目存在历史 `.codex-plugin/`，保留兼容入口，并优先生成新 marketplace 结构；只有确认属于 OpenLogos 自有模板的文件才可刷新。
3. 若项目存在 `.agents/skills/<name>/SKILL.md`，只有 `<name>` 是 OpenLogos 官方技能且处于 OpenLogos 托管范围内时才可迁移；其它 skill 原样保留并输出项目专属诊断。
4. 若 `.agents/plugins/marketplace.json` 已存在项目插件条目，只更新或插入 `openlogos` 条目，不删除、不排序、不改写项目条目。

迁移完成后，`AGENTS.md` 必须说明 `openlogos:<skill>` 仅代表 OpenLogos 方法论技能，项目专属技能应使用项目命名空间。

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

Codex 使用 `$<skill>` 语法调用技能（不同于 Claude Code 的 `/skill-name`）。OpenLogos 方法论技能必须带 `openlogos` 命名空间，例如 `$openlogos:prd-writer`、`$openlogos:change-writer`。项目插件技能必须使用项目插件命名空间，例如 `$adcn:release-guard`；repo-scoped local skill 可按 Codex 本地 skill 名展示，但必须在 `AGENTS.md` 中归入“项目专属 Skills”。`AGENTS.md` 中的 Active Skills 章节应使用 `$` 前缀并分组说明。

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
| **兼容**（兜底） | `AGENTS.md` only，或历史 `.codex-plugin/` | `logos/skills/` / 历史 OpenLogos skill 路径；项目 skill 仍按项目资产处理 | 无或历史 `session-start.sh` |
| **原生插件**（推荐） | `.agents/plugins/marketplace.json` + `.agents/plugins/openlogos/` + `.codex/config.toml` | OpenLogos 插件内 `skills/`；项目插件或 repo-scoped local skill 单独存在 | `session-start.sh` → `openlogos status` |

原生插件模式为推荐路径。`AGENTS.md` 始终保留作为降级兜底。兼容模式与原生插件模式都必须保持 OpenLogos 方法论命名空间和项目专属 Skill 命名空间分离。

## 验收标准（文档阶段）

- `README.md` 已包含 Codex 原生插件安装说明
- `spec/agents-md.md` 已明确双轨模式包含 Codex
- 本文档定义了插件边界、事件、安全策略与双轨策略
