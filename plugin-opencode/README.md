# OpenLogos OpenCode Plugin (MVP)

OpenLogos 的 OpenCode 原生插件 MVP，实现以下能力：

- 会话启动时注入 OpenLogos 当前状态（`session.created`）
- 解析并执行 `/openlogos:*` 命令（`tui.command.execute`）
- 桥接到已有 CLI（`openlogos status/next/change/...`）

## 本地开发

```bash
cd plugin-opencode
npm test
```

## TUI 斜杠命令（OpenCode `/` 补全）

OpenCode 的 `/` 列表来自 `.opencode/commands/*.md`，**不是**插件里的 `tui.command.execute` 字符串。init/sync 会部署：

- `/openlogos-status`、`/openlogos-next`、`/openlogos-sync`、`/openlogos-verify`、`/openlogos-launch`
- `/openlogos-change <slug>`、`/openlogos-merge <slug>`、`/openlogos-archive <slug>`
- `/openlogos-init`（说明文档，建议在终端用带 `--locale` 的 init）

## 插件钩子（补充）

- `session.created`：注入 `openlogos status`
- `tui.command.execute`：若 OpenCode 仍向插件转发部分输入，可解析旧式 `/openlogos:*`（**TUI 补全请以 `commands/` 为准**）

## 示例配置

查看 `examples/opencode.json` 与 `examples/.opencode/plugins/openlogos-local.js`。

## 分发策略（单包）

- 不单独发布 OpenCode 插件 npm 包
- 插件模板由 `@miniidealab/openlogos` 一并发布
- 用户执行 `openlogos init --ai-tool opencode` 或 `openlogos sync` 时自动部署到：
  - `.opencode/plugins/openlogos.js`
  - `.opencode/commands/*.md`（TUI 斜杠命令）
  - `opencode.json`（补齐推荐权限默认值）

