# OpenCode 用户使用 OpenLogos 指南

本文说明在 **OpenCode** 终端 AI 编码工具中，如何配合 **OpenLogos** CLI、本地插件与 **TUI 斜杠命令**完成方法论驱动的研发。

**推荐 CLI 版本：** `@miniidealab/openlogos` **≥ 0.5.6**。该版本起，npm 包内包含完整的 `opencode-plugin-template`（含 `openlogos.js` 与 **`commands/*.md`**）。低于 0.5.6 的全局安装可能缺少模板目录，导致 `.opencode/plugins/` 或 `.opencode/commands/` 无法自动生成。

```bash
npm install -g @miniidealab/openlogos@latest
openlogos --version   # 确认 ≥ 0.5.6
```

单包策略：只需安装上述 npm 包，无需再装单独的 OpenCode 插件包。

---

## 可运行完整示例（推荐）

仓库内 **[examples/money-log](../examples/money-log/README.md)**（轻记账）为 **OpenCode + OpenLogos** 官方集成演示：已包含 `opencode.json`、`.opencode/plugins/openlogos.js`、`.opencode/commands/openlogos-*.md` 与完整 `logos/resources/`。在 monorepo 中进入该目录后执行 `npm install` 与 `npm run dev` 即可本地运行桌面应用，并在该根目录启动 OpenCode 对照本文操作。

若你使用 **Claude Code** 并希望对照另一类小桌面应用，见 **[examples/flowtask](../examples/flowtask/README.md)**（Tauri）。

---

## 1. 前置条件

| 项 | 说明 |
|----|------|
| Node.js | ≥ 18 |
| OpenLogos CLI | 全局安装：`npm install -g @miniidealab/openlogos` |
| OpenCode | 终端可执行 `opencode`；若提示找不到命令，执行 `source ~/.zshrc` 或新开终端 |
| 工作目录 | 始终在**项目根**启动 OpenCode（该目录下存在 `logos/logos.config.json`） |

---

## 2. 新建项目：初始化

在**空目录**或新项目根执行（非交互、适合脚本 / CI）：

```bash
cd /path/to/your-project
openlogos init --ai-tool opencode --locale zh your-project-name
```

英文项目将 `zh` 改为 `en`。

交互式 `openlogos init` 时，在「选择 AI 编码工具」中选 **3. OpenCode**。

### 与 OpenCode 相关会生成或合并的内容

| 路径 | 作用 |
|------|------|
| `AGENTS.md` | OpenCode 会读取；含 Phase 检测、Active Skills、变更管理与语言策略 |
| `CLAUDE.md` | 方法论说明备份；OpenCode 模式下 **Active Skills 以 `AGENTS.md` 为准** |
| `logos/skills/*/` | 各阶段 Skill 的 `SKILL.md` |
| `logos/spec/` | 方法论规范（如测试结果格式等），由 init/sync 部署 |
| `logos/resources/`、`logos/changes/` | 研发文档与变更提案工作区 |
| `.opencode/plugins/openlogos.js` | 插件：`session.created` 时注入 `openlogos status` 摘要（见 [Plugins](https://opencode.ai/docs/plugins/)） |
| `.opencode/commands/*.md` | **TUI 斜杠命令**定义；见下文第 4 节（[Custom commands](https://opencode.ai/docs/commands/)） |
| `opencode.json` | 若不存在则创建，并**合并**推荐 `permission`（不覆盖你已有字段） |

### 部署后自检（可选）

```bash
ls .opencode/plugins/openlogos.js
ls .opencode/commands/
```

`commands` 下应有多个 `openlogos-*.md`。若缺失，见本文 **§8 常见问题**。

### `opencode.json` 权限示例

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": "ask",
    "edit": "ask",
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "skill": "allow"
  }
}
```

---

## 3. 日常：用 OpenCode 打开项目

```bash
cd /path/to/your-project
opencode
```

**会话创建时**：若存在 `logos/logos.config.json`，插件会尝试执行 `openlogos status`，将阶段摘要注入上下文（便于模型判断当前 Phase）。

**提示：** 界面底部可能出现 `Tip: opencode run --attach ...`，与 OpenLogos 无关；日常本地开发在目录下直接 `opencode` 即可。

---

## 4. TUI 斜杠命令（重要）

### 4.1 为什么输入 `/openlogos` 没有补全？

OpenCode 里输入 **`/`** 后的列表来自：

1. 内置命令（如 `/help`、`/init`）
2. **`.opencode/commands/*.md`**（或 `opencode.json` 里的 `command` 字段）

**不会**根据插件里的 `tui.command.execute` 自动出现 `/openlogos` 这类名字。只输入 `/openlogos` 时出现 **「No matching items」** 是**正常**的。

### 4.2 应使用的命令名

`init` / `sync`（且 `logos.config.json` 中 **`aiTool` 为 `opencode`**）会在项目下部署 **连字符形式** 的命令（文件名即命令名）：

| TUI 输入 | 等价 CLI | 说明 |
|----------|----------|------|
| `/openlogos-status` | `openlogos status` | 当前阶段与下一步建议 |
| `/openlogos-next` | `openlogos status` | CLI 无独立 `next`，与 status 一致 |
| `/openlogos-sync` | `openlogos sync` | 刷新 AGENTS.md、Skills、插件与 **本目录 commands** |
| `/openlogos-verify` | `openlogos verify` | 验收测试 |
| `/openlogos-launch` | `openlogos launch` | 首轮完成后激活变更管理 |
| `/openlogos-change <slug>` | `openlogos change <slug>` | 同一行写 slug，如 `/openlogos-change add-login` |
| `/openlogos-merge <slug>` | `openlogos merge <slug>` | |
| `/openlogos-archive <slug>` | `openlogos archive <slug>` | |
| `/openlogos-init` | （无自动执行） | 文内说明：请在系统终端用带 `--locale` 的 `init` |

各命令的 Markdown 模板内使用 OpenCode 的 `` !`openlogos …` `` 语法，在**项目根**执行 shell，输出进入当前对话上下文。

### 4.3 如何唤起命令

- 在输入框输入 **`/`**，然后输入 **`openlogos`** 或 **`openlogos-status`** 等，从列表选择；或  
- 使用 TUI 提示的 **`ctrl+p`** 打开命令面板，搜索 `openlogos`。

### 4.4 注意

- **`PATH`** 中必须能找到 `openlogos`（与启动 OpenCode 的终端环境一致）。
- 升级 OpenLogos 或修改 `aiTool` 后：在项目根执行 **`openlogos sync`**，然后**完全退出并重新打开 OpenCode**。

---

## 5. 插件与斜杠命令的分工（小结）

| 机制 | 作用 |
|------|------|
| `.opencode/plugins/openlogos.js` | 会话开始时注入状态；可选处理部分 `tui.command.execute`（**不参与 `/` 补全列表**） |
| `.opencode/commands/*.md` | 在 TUI 中注册 **`/openlogos-…`**，通过 `` !`…` `` 调用 CLI |

日常操作建议以 **斜杠命令** 为准调用 OpenLogos CLI。

---

## 6. 与 AI 协作的推荐节奏

1. 让模型优先阅读 **`AGENTS.md`**，按 Phase 检测判断当前缺哪些文档。  
2. 各阶段打开 **`logos/skills/<skill>/SKILL.md`**，在 `logos/resources/` 下按步骤产出。  
3. 不确定下一步：**`/openlogos-status`** 或终端执行 `openlogos status`。  
4. 改配置或升级 CLI 后：**`/openlogos-sync`** 或 `openlogos sync`，必要时重启 OpenCode。

---

## 7. 变更管理（`lifecycle: active` 之后）

- 改代码或方法论文档前：`openlogos change <slug>` 或 **`/openlogos-change <slug>`**。  
- `logos/.openlogos-guard` 等规则以 **`AGENTS.md`** 与 **`logos/spec/`** 为准。  
- 完成后按流程 **`merge`** → **`archive`**。

---

## 8. 常见问题

**Q：找不到 `logos.config.json`？**  
A：在含 `logos/logos.config.json` 的目录启动 OpenCode；子目录中请先 `cd` 到项目根再执行 CLI。

**Q：`openlogos` 在斜杠命令里执行失败？**  
A：执行 `which openlogos`；必要时 `npm install -g @miniidealab/openlogos@latest`。在**同一环境**下启动 OpenCode。

**Q：`/openlogos` 显示 No matching items？**  
A：请使用 **`/openlogos-status`** 等连字符命令，或 `/` / `ctrl+p` 后搜索 **`openlogos`**。

**Q：没有 `.opencode/plugins/openlogos.js` 或 `commands` 为空？**  
A：① 确认 `logos.config.json` 中 **`"aiTool": "opencode"`**；② 全局 **`openlogos --version` ≥ 0.5.6**；③ 项目根执行 **`openlogos sync`**；④ 从仓库开发时，需存在 `opencode-plugin-template`（npm 包内自带，或本地 `cli` 执行过 `npm run pack` / 含 `plugin-opencode/template` 的构建流程）。

**Q：升级后仍是旧插件或旧命令？**  
A：项目根 **`openlogos sync`** → **退出 OpenCode 再进入**。

**Q：不用插件，只用文档可以吗？**  
A：可以。依赖 **`AGENTS.md` + `logos/skills/`**，在终端手动执行 `openlogos` 子命令即可。

---

## 9. 与 Cursor、Claude Code 的差异（简要）

| 维度 | OpenCode |
|------|----------|
| 主指令入口 | `AGENTS.md` |
| Skills | `logos/skills/` |
| 集成方式 | 本地 `.opencode/plugins/` + `.opencode/commands/*.md`（非 Claude 插件市场） |
| 会话增强 | `session.created` 注入 `openlogos status` |

---

## 相关链接

- 仓库 [README.md](../README.md) — AI 工具总览与 Claude Code 插件  
- OpenLogos：`openlogos --help`  
- OpenCode：[文档首页](https://opencode.ai/docs)、[Plugins](https://opencode.ai/docs/plugins/)、[Custom commands](https://opencode.ai/docs/commands/)
