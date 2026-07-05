# 部署报告

## 基本信息
- 提案：`codex-claude-skill-namespace-separation`
- 模块：`core`
- 部署时间：2026-07-04 18:54:23 PDT
- 目标环境：production
- 结果：成功，存在观察项

## 执行命令摘要
- `cd cli && npm test -- --cache false`：通过，31 个测试文件、1068 个测试。
- `cd cli && npm run build`：通过。
- `cd cli && npm pack`：通过，包版本 `0.13.2`，打包产物包含 Codex marketplace、Codex 插件模板、Claude 插件模板、spec 与构建产物。
- `cd website && npm test`：通过，3 个测试。
- `cd website && npm run build`：通过。
- `git commit -m "release: v0.13.2"`：提交 `182f37d`。
- `git tag v0.13.2`：创建发布 tag。
- `git push origin master && git push origin v0.13.2`：通过，触发 GitHub Actions 发布流水线。
- `gh run watch 28726112726`：发布流水线成功。

## 发布结果
- GitHub Actions run：`28726112726`，结论 `success`。
- npm latest：`@miniidealab/openlogos@0.13.2`。
- 发布后 CLI 版本：`npx -y @miniidealab/openlogos@0.13.2 --version` 输出 `0.13.2`。
- GitHub Release：`https://github.com/miniidealab/openlogos/releases/tag/v0.13.2`。
- npm tarball：`https://registry.npmjs.org/@miniidealab/openlogos/-/openlogos-0.13.2.tgz`。
- Cloudflare Pages 部署 URL：`https://c1f827e4.openlogos.pages.dev`。
- Cloudflare Pages alias：`https://head.openlogos.pages.dev`。

## 迁移结果
无业务数据库迁移。

## 服务启动与部署后检查
- GitHub Actions 已完成 npm publish、GitHub Release 创建、严格 release data 生成、官网构建和 Cloudflare Pages 部署。
- Actions 内 `Verify website latest version matches tag` 已通过，构建产物 `latestVersion` 与 `v0.13.2` 一致。
- `https://c1f827e4.openlogos.pages.dev/releases/` 已可检索到 `v0.13.2`、`openlogos-0.13.2.tgz` 和 npm 版本链接。
- `https://head.openlogos.pages.dev/releases/` 已可检索到 `v0.13.2`、`openlogos-0.13.2.tgz` 和 npm 版本链接。

## 回滚点
- npm：如发布版本存在阻断问题，按既有策略发布新的 patch 版本回滚或修复。
- GitHub Release：可在 GitHub Release 页面标注或撤下异常版本，并以新 tag 发布修复版本。
- 官网：可在 Cloudflare Pages 回滚到上一成功部署。

## 未解决风险
- `https://openlogos.ai/releases/` 在部署后短时间内尚未检索到 `v0.13.2`；Pages 版本 URL 与 alias 已展示新版本，判断为自定义域缓存或传播延迟观察项。后续 smoke 应继续验证自定义域。
- GitHub Actions 日志包含 Node.js 20 deprecation annotation，不影响本次发布结果，但后续可将 workflow action/runtime 配置升级以消除警告。
