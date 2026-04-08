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

## 命令支持

- `/openlogos:status`
- `/openlogos:next`（当前兼容映射到 `openlogos status`）
- `/openlogos:init [name]`
- `/openlogos:sync`
- `/openlogos:change <slug>`
- `/openlogos:merge <slug>`
- `/openlogos:archive <slug>`
- `/openlogos:verify`
- `/openlogos:launch`

## 示例配置

查看 `examples/opencode.json` 与 `examples/.opencode/plugins/openlogos-local.js`。

## 分发策略（单包）

- 不单独发布 OpenCode 插件 npm 包
- 插件模板由 `@miniidealab/openlogos` 一并发布
- 用户执行 `openlogos init --ai-tool opencode` 或 `openlogos sync` 时自动部署到：
  - `.opencode/plugins/openlogos.js`
  - `opencode.json`（补齐推荐权限默认值）

