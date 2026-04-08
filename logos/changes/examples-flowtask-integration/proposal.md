# 变更提案：examples-flowtask-integration

## 变更原因

- 原 HTTP API 可运行示例目录已从仓库移除，根 `README`、`examples/README` 等仍指向旧路径，对外文档不一致。
- `examples/flowtask`（Tauri 桌面 Demo）纳入 monorepo，需作为**当前可运行示例**统一说明，并修正 OpenLogos GitHub 链接（与主仓 `miniidealab/openlogos` 一致）。
- Rust 构建目录 `src-tauri/target/` 与 Claude Code 本地配置 `.claude/settings.local.json` 不应进入版本库，需在仓库级 `.gitignore` 加固。
- 示例内 `AGENTS.md` / `CLAUDE.md` 含本机绝对路径，公开推送前需脱敏。

## 变更类型

文档级 + 仓库配置（`.gitignore`），不涉及 OpenLogos 规范 `spec/` 或 CLI 行为变更。

## 变更范围

- 影响的需求文档：无
- 影响的功能规格：无
- 影响的业务场景 / API / DB / 编排测试：无

## 变更概述

1. 在仓库根 `.gitignore` 增加 `**/src-tauri/target/` 与 `**/.claude/settings.local.json`；将原 `/logos/` 调整为 `/logos/*` 并对 `logos/changes/**` 取反，使本仓库内新建变更提案可被 `git add`（原规则会忽略整个 `logos/`，新目录无法入库）。
2. 更新 [README.md](README.md)「方式三」与仓库结构说明、[examples/README.md](examples/README.md)、[examples/demo-saas-project/README.md](examples/demo-saas-project/README.md)，以 FlowTask 替代 TaskFlow API 叙事。
3. 更新 [examples/flowtask/README.md](examples/flowtask/README.md) 中 OpenLogos 链接；更新 [examples/flowtask/AGENTS.md](examples/flowtask/AGENTS.md) 与 [examples/flowtask/CLAUDE.md](examples/flowtask/CLAUDE.md) 中 `openlogos` 工作目录说明为 monorepo 路径。
4. 合并 [examples/flowtask/.gitignore](examples/flowtask/.gitignore) 中重复的 `src-tauri/target/` 行。
