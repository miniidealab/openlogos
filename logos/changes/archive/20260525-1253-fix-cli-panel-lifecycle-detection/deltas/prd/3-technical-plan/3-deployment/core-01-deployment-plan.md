## MODIFIED — core: 部署方案
# core-01-deployment-plan

## 一、部署目标
- npm 包：发布 `@miniidealab/openlogos`。
- 发布入口：统一采用 `git tag vX.Y.Z`，由 GitHub Actions 在 tag 推送后自动执行 npm publish，并创建对应 GitHub Release。
- 插件模板：随 npm 包打包 Claude Code、OpenCode、Codex 模板。
- 官网：构建 `website/` 并部署到 Cloudflare Pages。

## 四、构建与发布命令
- CLI 构建：`cd cli && npm run build`
- CLI 测试：`cd cli && npm test`
- CLI 打包验证：`cd cli && npm pack`
- 官网发布数据生成：`cd website && npm run generate:releases`
- 官网构建：`cd website && npm run build`
- 官网部署：`cd website && npm run deploy`
- CLI 发布入口：更新 `cli/package.json`、`plugin/.claude-plugin/plugin.json`、`CHANGELOG.md` 后提交代码，创建并推送 `vX.Y.Z` tag；GitHub Actions 自动执行 npm publish 并创建 GitHub Release。
- 本修复的发布前检查：在一个 `logos-project.yaml` 存在局部语法错误、但 `modules` 仍可恢复的 fixture 项目中，复跑 `openlogos detect --format json` 与 `openlogos status --format json`，确认 launched 生命周期与 `modules[]` 仍然可见，再进入发布。

## 六、回滚策略
- npm：通过发布补丁版本回滚。
- 已安装 CLI：如 RunLogos 或本地环境受影响，可临时锁定上一版本 `@miniidealab/openlogos`，或发布更高补丁版本覆盖回滚。
- 官网：通过 Cloudflare Pages 回滚到上一部署。
- 插件模板：随 npm 包版本回滚。

## 七、部署后检查清单
- `openlogos --version` 可用。
- `openlogos init --locale zh --ai-tool all` 可生成资产。
- 官网核心页面可访问。
- 官网 `/releases` 页面可访问，并展示 npm latest 版本、发布时间和安装命令。
- 官网首页存在最近发布动态入口，并能跳转 `/releases`。
- 插件模板包含 Claude Code、OpenCode、Codex 资产。
- `openlogos detect --format json` 与 `openlogos status --format json` 在 launched 项目中可输出 `modules[]` 与 launched 生命周期，即使 `logos-project.yaml` 存在可恢复解析错误也不应回退成 `initial`。

## 九、门禁结论
本项目需要发布与部署方案；CLI 发布由 tag 驱动，npm publish 与 GitHub Release 同步生成。部署执行和 smoke 必须由用户明确授权。

