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

## npm 分发方案（Phase 4）

- 包名：`@miniidealab/opencode-plugin-openlogos`
- 版本策略：
  - patch：文档/错误提示/兼容修复
  - minor：新增 hook、命令、配置能力
  - major：命令契约或事件行为不兼容变更
- 发布流程（建议）：
  1. 在 `plugin-opencode/` 更新版本号与变更说明
  2. 执行 `npm test`
  3. 执行 `npm publish --access public`
  4. 在仓库 `CHANGELOG.md` 同步发布记录与升级说明

