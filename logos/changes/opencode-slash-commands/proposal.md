# 变更提案：OpenCode TUI 可发现的斜杠命令

## 背景

OpenCode 1.x 中，输入 `/` 时的补全来自内置命令与 `.opencode/commands/*.md`（或 `opencode.json` 的 `command`）。`tui.command.execute` 插件钩子**不会**把 `/openlogos:*` 注册进该列表，故用户看到「No matching items」。

## 目标

在 `openlogos init` / `sync`（`aiTool: opencode`）时，除部署 `plugins/openlogos.js` 外，同步部署 `.opencode/commands/*.md`，使用 OpenCode 文档中的 `!`bash` 注入 CLI 输出。

## 命令命名

文件名即 TUI 命令名：`openlogos-status.md` → **`/openlogos-status`**（不宜使用冒号文件名）。

## 影响

- `plugin-opencode/template/commands/*.md`（新建）
- `deployOpenCodePlugin` 复制 `commands/` 目录
- `docs/opencode.md` 与测试断言更新
