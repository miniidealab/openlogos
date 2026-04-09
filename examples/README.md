# OpenLogos examples

本目录提供两个**小型桌面应用**示例，分别侧重不同 AI 编码工具与 OpenLogos 的集成方式：

| 示例 | 技术栈 | 推荐对照的 AI 工具 | 说明 |
|------|--------|-------------------|------|
| [flowtask](./flowtask/README.md) | Tauri 2 + React + Rust + SQLite | **Claude Code**（插件 / `CLAUDE.md`） | 本地优先任务管理；Tauri Commands 替代 REST。 |
| [money-log](./money-log/README.md) | Electron + React + sql.js | **OpenCode**（插件 + TUI 斜杠命令） | 轻记账；`.opencode/plugins/` 与 `.opencode/commands/` 与官方指南一致。 |

二者均包含完整 `logos/resources/`（PRD → 场景 → 规格/DDL → 测试 → verify），可用于对照方法论在桌面端项目中的落地。

---

## FlowTask（`flowtask/`）

**Claude Code 集成演示（推荐）** — Tauri 2 + React + TypeScript + Vite，本地 SQLite，完整 `logos/resources/`。

环境要求：Node.js ≥ 18、pnpm、Rust/cargo 及 [Tauri 前置依赖](https://tauri.app/start/prerequisites/)。

从这里开始：[flowtask/README.md](./flowtask/README.md)。

若希望单独分享一个更小克隆体积的仓库，可自行将 `examples/flowtask` 拆出为独立 GitHub 仓库（与本 monorepo 需自行保持同步）。

---

## 轻记账 Money Log（`money-log/`）

**OpenCode 集成演示（推荐）** — Electron + React + TypeScript + Vite，本地 sql.js，含 `.opencode/plugins/openlogos.js`、`.opencode/commands/openlogos-*.md` 与 `opencode.json`。

环境要求：Node.js ≥ 18、npm；使用 OpenCode 时请配合全局 `openlogos` CLI（建议 ≥ 0.5.6）。详见 [docs/opencode.md](../docs/opencode.md)。

从这里开始：[money-log/README.md](./money-log/README.md)。
