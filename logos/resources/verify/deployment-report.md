# 部署报告

> 生成时间：2026-05-27 18:48:41 CST  
> 提案：`verify-pre-run-regression-and-incremental-tests`  
> 目标环境：生产 / npm registry + Cloudflare Pages  
> 状态：SUCCESS

## 摘要

- CLI/npm 版本：`@miniidealab/openlogos@0.9.30`
- npm latest：`0.9.30`
- Git tag：`v0.9.30`
- GitHub Release：`https://github.com/miniidealab/openlogos/releases/tag/v0.9.30`
- GitHub Actions 发布 run：`https://github.com/miniidealab/openlogos/actions/runs/26506292434`
- 官网部署地址：`https://d9e63d0c.openlogos.pages.dev`
- 生产域名检查：`https://openlogos.ai/releases/`
- 首页检查：`https://openlogos.ai/`
- 部署命令：`cd website && npm run deploy`
- 构建命令：`cd website && npm run build`
- 发布数据生成：`cd website && npm run generate:releases`
- 数据迁移：无
- npm 包发布：通过 `v0.9.30` tag 触发 GitHub Actions 自动发布。

## 执行步骤

1. CLI 发布前检查：`cd cli && npm run build`
2. CLI 发布前测试：`cd cli && npm test`
3. CLI 打包验证：`cd cli && npm pack --cache /private/tmp/openlogos-npm-cache`
4. 推送 `master` 与 `v0.9.30` tag，由 GitHub Actions 发布 npm 包并创建 GitHub Release
5. 生成官网发布数据：`cd website && npm run generate:releases`
6. 构建官网：`cd website && npm run build`
7. 发布到 Cloudflare Pages：`cd website && npm run deploy`
8. 检查 Cloudflare Pages 最新生产部署
9. 检查生产域名 `/` 与 `/releases/`

## 结果

- CLI 构建：PASS
- CLI 测试：PASS
- CLI 打包验证：PASS
- npm latest：PASS，`npm view @miniidealab/openlogos version` 返回 `0.9.30`
- GitHub Release：PASS，`v0.9.30` 已发布，非 draft / prerelease
- GitHub Actions npm 发布：PASS，run `26506292434` 结论为 `success`
- 官网构建：PASS，发布数据从 npm registry 生成 65 个版本
- Cloudflare Pages 上传：PASS（上传 2 个文件，190 个文件复用）
- Cloudflare Pages 部署：PASS，最新生产部署 ID `d9e63d0c-95a5-4963-926a-2149c20af158`
- 部署预览 `/releases/`：PASS，HTTP 200
- 生产域名 `/`：PASS，HTTP 200
- 生产域名 `/releases/`：PASS，HTTP 200

## 回滚点

- CLI/npm：上一 npm 版本为 `0.9.29`，如 `0.9.30` 出现兼容问题，按部署方案通过发布补丁版本回滚客户端推荐版本。
- GitHub Release：当前发布点为 `v0.9.30`，可追溯到提交 `55348ed`。
- 官网：Cloudflare Pages 上一成功生产部署为 `64392121-4e79-4e5f-8dda-1a34399b89b6`，可回滚到 `https://64392121.openlogos.pages.dev`。
- 旧项目降级路径：仍可保留 `verify.pre_run_command` 单阶段配置作为两阶段模型兼容问题的临时降级方案。

## 风险

- 构建过程中仍存在既有 Astro `/404` 路由冲突 warning，但未影响本次部署结果。
- GitHub Pages `Deploy Website` workflow 仍使用 Node `20.20.2`，与 Astro 6 的 Node `>=22.12.0` 要求不匹配；本次正式官网部署按部署方案走 Cloudflare Pages，未受该 workflow 影响。
- Wrangler 提示当前 Git 工作区存在未提交变更；与本提案无关的 `logos/changes/homepage-release-summary-relocation/SPEC_MERGED` 删除状态未纳入本次部署。
