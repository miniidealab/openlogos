## MODIFIED — 四、构建与发布命令
- CLI 构建：`cd cli && npm run build`
- CLI 测试：`cd cli && npm test`
- CLI 打包验证：`cd cli && npm pack`
- 官网发布数据生成：`cd website && npm run generate:releases`
- 官网构建：`cd website && npm run build`
- 官网部署：`cd website && npm run deploy`
- CLI 发布入口：更新 `cli/package.json`、`plugin/.claude-plugin/plugin.json`、`CHANGELOG.md` 后提交代码，创建并推送 `vX.Y.Z` tag；GitHub Actions 自动执行 npm publish、创建 GitHub Release，并串联官网 release 数据同步与站点部署。

## MODIFIED — 七、部署后检查清单
- `openlogos --version` 可用。
- `openlogos init --locale zh --ai-tool all` 可生成资产。
- 官网核心页面可访问。
- 官网 `/releases` 页面可访问，并展示 npm latest 版本、发布时间和安装命令。
- 官网 `/releases` 页面可访问，并展示英文主摘要、中文原文次级内容，以及英文摘要缺失时的固定回退提示。
- 官网首页存在最近发布动态入口，并能跳转 `/releases`。
- 插件模板包含 Claude Code、OpenCode、Codex 资产。
- **tag 发版一致性检查**：发布完成后，`/releases` 的 latest 版本必须等于本次 tag 版本（去掉 `v` 前缀后的语义化版本号）；不一致则判定本次发布未完成。

## MODIFIED — 十一、官网发布动态构建策略
- 官网构建前必须执行发布数据生成脚本，从 npm registry 读取 `@miniidealab/openlogos` 的 `dist-tags`、`versions` 和 `time`。
- 生成结果写入官网源码可导入的静态 JSON 文件，Astro 页面在构建时读取该文件。
- **正式发版约束**：由 tag 触发的发布流程中，发布数据生成失败必须直接失败，不允许回退到历史缓存继续发布。
- 发布数据生成失败时应保留已提交的缓存数据；若缓存不存在，构建应失败，避免官网展示空白或伪造数据。
- 英文 release summary 数据必须与仓库内维护的 bilingual summary 数据同步生成；构建过程中不得临时调用外部翻译服务或 AI 生成英文摘要。
- 中文原文摘要继续从 `CHANGELOG.md` 结构化提取，作为 secondary content 和追溯依据。
- Cloudflare Pages 部署仍以 `website/dist/` 为部署产物，不引入运行时服务端依赖。
- 回滚时通过 Cloudflare Pages 回滚到上一部署；如发布数据异常，可回滚到上一份静态 JSON 产物对应的部署版本。
