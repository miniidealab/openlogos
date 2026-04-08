# OpenLogos examples

## FlowTask（`flowtask/`）

**可运行的桌面端 Demo** — Tauri 2 + React + TypeScript + Vite，本地 SQLite，完整 `logos/resources/`（PRD → 场景 → OpenAPI 规格 → DDL → 测试与编排 → verify）。

用于：

- 对照方法论在**非 HTTP 服务**项目中的落地方式（Tauri Commands 替代 REST）。
- 本地运行应用与阅读设计文档。

环境要求：Node.js ≥ 18、pnpm、Rust/cargo 及 [Tauri 前置依赖](https://tauri.app/start/prerequisites/)。

从这里开始：[flowtask/README.md](./flowtask/README.md)。

若希望单独分享一个更小克隆体积的仓库，可自行将 `examples/flowtask` 拆出为独立 GitHub 仓库（与本 monorepo 需自行保持同步）。

## Demo SaaS project（`demo-saas-project/`）

轻量 **占位**（配置 + `AGENTS.md`），虚构 Next.js/SaaS 技术栈。完整可运行示例请使用上方的 **FlowTask**。
