---
title: "openlogos init"
description: 初始化一个新的 OpenLogos 项目，包含目录结构、配置、AI Skills、宿主插件和 spec 文件。
---

在当前目录中创建标准的 OpenLogos 项目结构。这是你启动新项目时运行的第一个命令。

## 命令格式

```bash
openlogos init [name] [--locale <en|zh>] [--ai-tool <claude-code|opencode|codex|cursor|zcode|qoder|workbuddy|other|all>]
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
| `--ai-tool` | `claude-code`, `opencode`, `codex`, `cursor`, `zcode`, `qoder`, `workbuddy`, `other`, `all` | 交互式提示 | 为新项目设置 AI 编码工具，或为已初始化项目补齐目标工具 |
| `--aitool` | 同 `--ai-tool` | 同 `--ai-tool` | `--ai-tool` 的等价别名 |

`all` 展开为全部具体宿主（Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy），不含 `other`。传入未知取值时命令以 `unsupported AI tool` 退出，并列出支持的取值。

## 交互模式

在 TTY（终端）中运行时，`init` 先询问语言，再询问 AI 工具；工具菜单的语言跟随你刚选的语言：

```
Choose language / 选择语言:
  1. English (default)
  2. 中文

Your choice [1/2] (default: 1): 2

选择 AI 编码工具:
  1. Claude Code（默认）
  2. OpenCode
  3. Codex
  4. Cursor
  5. 其他
  6. 全部（为所有工具初始化）

  7. ZCode
  8. Qoder
  9. WorkBuddy

请选择 [1/2/3/4/5/6]（默认: 1）:
```

提示行只写了 `1`～`6`，但输入 `7`、`8`、`9` 同样有效，分别选择 ZCode、Qoder、WorkBuddy。

如果项目根目录有 `package.json`、`pyproject.toml` / `requirements.txt` / `setup.py` 或 `Cargo.toml`，接下来还会按技术栈建议忽略目录，见下文[按技术栈建议忽略目录](#按技术栈建议忽略目录)。

## 非交互模式（CI）

在非 TTY 环境（CI 流水线、脚本）中，`--locale` 是**必需的**：

```bash
openlogos init my-project --locale en --ai-tool claude-code
```

如果在非 TTY 模式下省略 `--locale`，命令会以错误退出。如果省略 `--ai-tool`，按环境变量识别宿主：

- 设置了 `CODEBUDDY_PLUGIN_ROOT` → `workbuddy`
- 设置了 `QODER_PLUGIN_ROOT` → `qoder`
- 设置了 `ZCODE_PLUGIN_ROOT` → `zcode`
- 设置了 `CLAUDE_PLUGIN_ROOT` 或 `CLAUDE_CODE` → `claude-code`
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
- 基于当前工具集合和 lifecycle 状态重新生成 `AGENTS.md` 与 `CLAUDE.md` 中的 OpenLogos 托管片段
- 部署目标工具所需的 Skills、插件、hooks 和斜杠命令
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
logos/resources/prd/3-technical-plan/3-deployment/
logos/resources/api/
logos/resources/database/
logos/resources/test/
logos/resources/test/smoke/
logos/resources/scenario/
logos/resources/implementation/
logos/resources/verify/
logos/resources/reference/   （requirement/、todolist/、code/、image/、temp/、note/）
logos/changes/
logos/changes/archive/
```

每个目录都包含一个 `.gitkeep` 文件，这样空目录也能被 Git 跟踪。

### 配置文件

| 文件 | 说明 |
|------|-------------|
| `logos/logos.config.json` | 项目名称、locale、`aiTool`、文档路径、`sourceRoots`、verify/smoke 设置；接受建议忽略目录时另含 `guard.unversioned` |
| `logos/logos-project.yaml` | AI 可读的项目资源索引 |
| `.gitignore` | OpenLogos 托管区块（固定包含 `logos/.openlogos-runtime/`），区块外内容逐字节保留 |
| `.gitattributes` | OpenLogos 托管区块，让 `logos/**` 与托管 hook / 运行时文件在不同机器签出时字节不变 |

### AI 指令文件

| 文件 | 说明 |
|------|-------------|
| `AGENTS.md` | 通用 AI 指令文件（由 Cursor、OpenCode、Codex、ZCode、Qoder 等工具读取） |
| `CLAUDE.md` | Claude Code 专属指令文件 |

OpenLogos 只写 `<!-- OPENLOGOS:BEGIN -->` 与 `<!-- OPENLOGOS:END -->` 之间的托管片段；文件已存在且有你自己的内容时，这些内容原样保留。详见 [AGENTS.md](/zh/specs/agents-md)。

### Skills 部署

部署位置取决于所选的 AI 工具：

| AI 工具 | Skills 目标 | 其他托管资产 |
|---------|--------------|-------|
| Claude Code | `logos/skills/<name>/SKILL.md` | `.claude/commands/openlogos/`、`.claude/agents/change-reviewer.md`、`.claude/openlogos/bin/`、`.claude/settings.json` |
| OpenCode | `logos/skills/<name>/SKILL.md` | `.opencode/plugins/openlogos.js`、`.opencode/commands/`、`opencode.json` |
| Codex | `.agents/plugins/openlogos/skills/<name>/SKILL.md` | `.agents/plugins/openlogos/`、`.agents/plugins/marketplace.json`、`.codex/config.toml` |
| Cursor | `.cursor/skills/<name>/SKILL.md` | `.cursor/agents/change-reviewer.md`、`.cursor/hooks.json`、`.cursor/hooks/` |
| ZCode | `.zcode/plugins/openlogos/skills/` | 整个 `.zcode/plugins/openlogos/` 插件 |
| Qoder | `.qoder/plugins/openlogos/skills/` | 整个 `.qoder/plugins/openlogos/` 插件 |
| WorkBuddy | `.workbuddy/plugins/openlogos/skills/` | 整个 `.workbuddy/plugins/openlogos/` 插件 |
| Other | `logos/skills/<name>/SKILL.md` | 无 |

多文件 Skill 的附属资产（如 `ui-ux-pro-max` 的脚本与数据）无论哪个宿主都放在 `logos/skills/` 下。

当选择 `--ai-tool all` 时，OpenLogos 会部署上表中除 Other 以外的每一个目标。`AGENTS.md` 和 `CLAUDE.md` 会以多工具 Skill 路径生成。

### Spec 文件

CLI 随包的方法论规格会被复制到 `logos/spec/`，其中包括 `test-results.md`（测试结果的 JSONL 格式规格）与 `sql-comment-convention.md`（SQL 注释约定）。

### 工具专属的额外内容

**Claude Code**：当 `--ai-tool` 为 `claude-code` 或 `all` 时：

- `.claude/commands/openlogos/`：斜杠命令（status、next、change、merge、archive、verify、sync、launch、init、index）
- `.claude/agents/change-reviewer.md`：变更提案审查 sub-agent
- `.claude/openlogos/bin/`：`openlogos-phase`（SessionStart）、`guard-check`（PreToolUse 写入门禁）、`guard-post-check.cjs`（事后检查引擎）
- `.claude/settings.json`：合并写入以下 hooks，不覆盖已有内容：
  - `SessionStart`：注入阶段上下文
  - `PreToolUse`：对 `Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell` 做写入门禁
  - `PostToolUse`、`PostToolUseFailure`、`Stop`：事后检查。shell 命令执行后比对受保护内容，发现未立案改动时报告变化文件并给出恢复命令
- `.claude/settings.json` 还会写入顶层 `language`，取值跟随项目 locale（`zh` → `"chinese"`，`en` → `"english"`），长会话压缩后回复语言不会漂移。你自己设置的自定义值会保留，CLI 只打印提示；顶层不是 JSON 对象的 `settings.json` 不会被改写。

幂等：如果 `.claude/commands/openlogos/` 中已有文件，命令与 agent 的部署会跳过，以保留你的自定义内容；guard 脚本、hooks 注册与 `language` 每次都会刷新。

**OpenCode**：

- `.opencode/plugins/openlogos.js`：OpenCode 插件
- `.opencode/commands/`：`openlogos-*` 斜杠命令文件
- `opencode.json`：合并写入权限默认值（`bash: "ask"`、`edit: "ask"`，`read` / `glob` / `grep` / `skill: "allow"`），已有键保持不变

**Codex**：当 `--ai-tool` 为 `codex` 或 `all` 时：

- `.agents/plugins/openlogos/`：插件清单（`.codex-plugin/plugin.json`）、`hooks/session-start.sh` 与 Skills
- `.agents/plugins/marketplace.json`：repo marketplace，只新增或更新 `openlogos` 条目
- `.codex/config.toml`：插件与 hook 配置，合并写入而不移除已有设置
- 插件还会同步到你的个人 Codex marketplace，CLI 会执行 `codex plugin add openlogos@personal`；失败时请手动执行

每个 Codex Skill 都会补上 Codex 要求的 YAML frontmatter（`name` 和 `description`），避免 Codex 因 `missing YAML frontmatter` 警告而跳过。插件部署后首次启动时，Codex 可能显示 `hook needs review before it can run`，请在 Codex 中打开 `/hooks` 并批准 `.agents/plugins/openlogos/hooks/session-start.sh`。详见 [Codex 插件](/zh/specs/codex-plugin)。

**Cursor**：OpenLogos 方法论 Skills 与命令 Skills（`openlogos-<命令>`，带 `disable-model-invocation: true`）部署到 `.cursor/skills/`，change-reviewer subagent 部署到 `.cursor/agents/`，并向 `.cursor/hooks.json` 合并写入 `sessionStart`、`beforeShellExecution`、`afterShellExecution`、`afterFileEdit` 四条托管 hook 条目，你自己的 hook 条目保持不变。Cursor 下 guard 为**部分强度**：shell 命令有事前轻判和 `afterShellExecution` 事后检查，文件编辑只做事后报告。旧版 OpenLogos 留下的规则文件会自动迁移，见 [`sync`：从旧版迁移](/zh/cli/sync#从旧版迁移)。详见 [Cursor 插件](/zh/specs/cursor-plugin)。

**ZCode / Qoder / WorkBuddy**：在 `.zcode/plugins/openlogos/`、`.qoder/plugins/openlogos/` 或 `.workbuddy/plugins/openlogos/` 安装一个自足的原生插件，内含 Skills、命令、change-reviewer agent 和 `SessionStart` + `PreToolUse` hooks。宿主自己的设置文件（`.zcode/config.json`、`.qoder/settings.json`、`.workbuddy/settings.json`）不会被修改。部署后请在宿主中新建 session 以加载插件。详见 [ZCode 插件](/zh/specs/zcode-plugin)、[Qoder 插件](/zh/specs/qoder-plugin)、[WorkBuddy 插件](/zh/specs/workbuddy-plugin)。

## 按技术栈建议忽略目录

在写入任何文件之前，`init` 会根据项目根目录的清单文件识别技术栈，并列出尚未被 git 忽略的路径：

| 技术栈 | 识别依据 | 建议条目 |
|-------|-------------|-------------------|
| Node | `package.json` | `node_modules/`、`dist/`、`build/`、`coverage/` |
| Python | `pyproject.toml`、`requirements.txt`、`setup.py` | `__pycache__/`、`.venv/`、`*.pyc` |
| Rust | `Cargo.toml` | `target/` |

```
检测到 Node 项目，以下路径尚未被 git 忽略：
  node_modules/
  dist/
是否加入 .gitignore（openlogos 托管区块）？[Y/n]：
```

- 回车或输入 `y` 表示接受：条目写入 `logos.config.json` 的 `guard.unversioned`，并渲染进 `.gitignore` 托管区块；如果这些路径下已有被跟踪的文件，CLI 会给出把它们移出索引的命令。
- 输入 `n` 跳过：CLI 打印之后可以执行的 `openlogos ignore add …` 命令。
- 非交互环境不写入建议条目，只打印 `openlogos ignore add …` 命令。
- `--locale` 和 `--ai-tool` 不会跳过这一问。

`logos/.openlogos-runtime/`（guard 运行时状态）会不经询问直接写入托管区块。被忽略的路径不在 guard 保护范围内，`launch` 之后写入依赖、构建产物、日志或缓存都不需要立案。之后要调整清单，请用 [`openlogos ignore` / `openlogos exempt`](/zh/cli/ignore-exempt)。

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
| `logos/logos.config.json already exists` | 目录已初始化且没有请求目标工具 | 用 `openlogos init --ai-tool <tool>` 补齐目标工具，用 `openlogos sync` 刷新当前配置；已有代码库请用 `openlogos adopt` |
| `--locale is required in non-interactive mode` | 在 CI 中运行但没有 `--locale` | 添加 `--locale en` 或 `--locale zh` |
| `unsupported AI tool "<value>"` | `--ai-tool` 取值不在支持列表中 | 使用上文 9 个取值之一 |
| `.gitignore` 托管区块已损坏 | `# >>> openlogos managed >>>` / `# <<< openlogos managed <<<` 标记重复或缺失 | 手工修复标记后重试；此时没有创建任何文件 |
| `.cursor/hooks.json` 无法解析，或 Skills / 插件目标被其他内容占用 | JSON 非法，或目标路径上是非 OpenLogos 的目录 | 修复或移走该文件 / 目录后重试；此时没有写入任何内容 |

## 相关命令

- [`sync`](/zh/cli/sync)：在配置变更或升级 CLI 后更新 AI 指令、Skills 和 hooks
- [`adopt`](/zh/cli/adopt)：接入已有代码库，而不是从 Phase 1 开始
- [`ignore` / `exempt`](/zh/cli/ignore-exempt)：管理 guard 不保护的路径
- [`status`](/zh/cli/status)：检查项目阶段推进情况
