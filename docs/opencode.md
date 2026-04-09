# OpenCode 用户使用 OpenLogos 指南

本文说明在 **OpenCode** 终端 AI 编码工具中，如何配合 **OpenLogos** CLI 与本地插件完成方法论驱动的研发。适用于当前单包策略：`npm install -g @miniidealab/openlogos`，`openlogos init` 选择 **OpenCode** 后的默认布局。

---

## 1. 前置条件

- **Node.js** ≥ 18
- 全局安装 CLI：`npm install -g @miniidealab/openlogos`
- 已安装 **OpenCode**，终端可执行 `opencode`（若提示找不到命令，执行 `source ~/.zshrc` 或新开终端）
- 始终在**项目根目录**操作（该目录下存在 `logos/logos.config.json`）

---

## 2. 新建项目：初始化

在空目录或新项目根目录执行：

```bash
cd /path/to/your-project
openlogos init --ai-tool opencode --locale zh your-project-name
```

交互式 `openlogos init` 时，在「选择 AI 编码工具」中选 **3. OpenCode**。

### 与 OpenCode 相关会生成或合并的内容

| 路径 | 作用 |
|------|------|
| `AGENTS.md` | OpenCode 会读取；含 Phase 检测、Active Skills、变更管理与语言策略 |
| `CLAUDE.md` | 同方法论说明的备份；OpenCode 模式下 **Active Skills 以 `AGENTS.md` 为准** |
| `logos/skills/*/` | 各阶段 Skill 的 `SKILL.md` |
| `logos/spec/` | 方法论规范（如测试结果格式等），由 init/sync 部署 |
| `logos/resources/`、`logos/changes/` | 研发文档与变更提案工作区 |
| `.opencode/plugins/openlogos.js` | OpenLogos 本地插件：会话注入 + `/openlogos:` 命令桥接 CLI |
| `opencode.json` | OpenCode 配置；若不存在则创建，并**合并**默认 `permission`（不覆盖你已有字段） |

默认 `opencode.json` 中会包含类似权限（仅作参考，以你仓库实际生成为准）：

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

**会话创建时**：若项目已初始化（存在 `logos/logos.config.json`），插件会自动执行一次 `openlogos status`，将当前阶段摘要注入上下文，便于模型识别「当前处于哪一 Phase」。

---

## 4. 插件命令：`/openlogos:`

插件将输入转发到本机 `openlogos` 可执行文件，前缀为 **`/openlogos:`**：

| 输入示例 | 说明 |
|----------|------|
| `/openlogos:status` | 当前 Phase 与下一步建议 |
| `/openlogos:next` | 当前实现映射为 `status`（与 CLI 行为一致） |
| `/openlogos:sync` | 重新生成 `AGENTS.md` / Skills；若为 OpenCode 会同步插件并合并 `opencode.json` |
| `/openlogos:verify` | 测试验收 |
| `/openlogos:launch` | 首轮开发完成后激活变更管理 |
| `/openlogos:change my-feature` | 创建变更提案（`slug` 为小写字母、数字与连字符） |
| `/openlogos:merge my-feature` | 生成合并说明（MERGE_PROMPT） |
| `/openlogos:archive my-feature` | 归档变更 |
| `/openlogos:init [name]` | 调用 CLI 初始化（**新项目更推荐先在普通终端执行 `openlogos init`**） |

**注意**：

- 系统 **PATH** 中必须能解析到 `openlogos`，否则会报未找到命令。
- 命令在 **当前工作目录** 执行，请保证该目录为项目根（含 `logos/`）。

---

## 5. 与 AI 协作的推荐节奏

1. 让模型优先阅读 **`AGENTS.md`**，按其中 Phase 检测逻辑判断当前缺哪些文档。
2. 每个阶段让模型打开 **`logos/skills/<对应 skill>/SKILL.md`**，按步骤在 `logos/resources/` 下产出文档。
3. 不确定下一步时：在对话中使用 **`/openlogos:status`**，或在终端项目根执行 `openlogos status`。
4. 修改了 `logos.config.json`、升级了 `@miniidealab/openlogos` 或需要刷新指令文件时：执行 **`/openlogos:sync`** 或 `openlogos sync`（须在项目根）。

---

## 6. 变更管理（`lifecycle: active` 之后）

- 修改源代码或方法论文档前：先 `openlogos change <slug>` 或 **`/openlogos:change <slug>`**。
- 项目可能使用 `logos/.openlogos-guard` 等机制；具体约束以 **`AGENTS.md`** 与 `logos/spec/` 为准。
- 实施完成后按流程执行 `merge` → `archive`。

---

## 7. 与 Cursor、Claude Code 的差异（简要）

| 维度 | OpenCode |
|------|----------|
| 主指令入口 | `AGENTS.md` |
| Skills 物理位置 | `logos/skills/` |
| 插件 | 本地 `.opencode/plugins/openlogos.js`（随 init/sync 部署），非 Claude 插件市场 |
| 会话增强 | `session.created` 钩子注入 `openlogos status` 摘要 |

---

## 8. 常见问题

**Q：提示找不到 `logos.config.json`？**  
A：请在含 `logos/logos.config.json` 的目录启动 OpenCode，或在子目录中先 `cd` 到项目根再运行 CLI。

**Q：插件里执行 openlogos 失败？**  
A：确认全局 `openlogos` 已安装且 `which openlogos` 有输出；必要时重装：`npm install -g @miniidealab/openlogos`。

**Q：升级 OpenLogos 后插件仍是旧逻辑？**  
A：在项目根执行 `openlogos sync`（配置中 `aiTool` 为 `opencode` 时会更新 `.opencode/plugins/openlogos.js` 并合并 `opencode.json`）。

**Q：只想用文档、不用插件可以吗？**  
A：可以依赖 `AGENTS.md` + `logos/skills/` 手动推进；插件用于自动注入状态与快捷命令，属于增强体验。

---

## 相关链接

- 仓库根目录 [README.md](../README.md) — AI 工具总览与 Claude Code 插件说明
- OpenLogos CLI：`openlogos --help`
- OpenCode 官方文档：<https://opencode.ai/docs>
