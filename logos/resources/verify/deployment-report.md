# 部署报告

> 生成时间：2026-05-28 12:10 CST  
> 提案：`release-website-sync-on-tag`  
> 目标环境：Cloudflare Pages（staging + production）  
> 状态：SUCCESS

## 摘要

- 发布链路演练：已完成 staging 预览分支部署（`staging.openlogos.pages.dev`）
- 生产部署：已完成 production 分支部署（`openlogos.ai`）
- npm latest：`0.9.31`
- GitHub Release：`v0.9.31`（非 draft / 非 prerelease）
- 官网 `/releases`：latest = `v0.9.31`，版本数 `66`，发布时间与链接可访问

## 执行步骤

1. 修复发布数据污染防护：
   - `website/scripts/generate-releases.mjs` 支持 `outputPath`，测试不再写入真实 `website/src/data/releases.json`
   - `website/test/generate-releases.test.mjs` 改为写临时目录并清理
2. 重新生成真实发布数据：`cd website && npm run generate:releases -- --strict`
3. 构建站点：`cd website && npm run build`
4. staging 演练部署：`cd website && npx wrangler pages deploy dist --project-name openlogos --branch staging`
5. production 部署：`cd website && npx wrangler pages deploy dist --project-name openlogos --branch master`
6. 一致性校验：
   - `npm view @miniidealab/openlogos version` = `0.9.31`
   - `gh release view v0.9.31 --json ...` 返回已发布版本
   - `https://staging.openlogos.pages.dev/releases/` 与 `https://openlogos.ai/releases/` 均显示 `v0.9.31`

## 结果

- 发布数据生成：PASS（strict 模式成功）
- 网站构建：PASS
- staging 演练：PASS
- production 部署：PASS
- npm / GitHub / 官网三方一致性：PASS

## 回滚点

- Cloudflare Pages 上一生产部署：`d9e63d0c-95a5-4963-926a-2149c20af158`（master，约 17 小时前）
- 当前生产部署：`5d2658eb-fcae-4b19-b086-6e6b81cfb99f`（master）
- 回滚路径：Cloudflare Pages 控制台选择 `openlogos` 项目，将生产别名切回上一生产部署 ID

## 未解决风险

- `website` 构建存在既有 Astro 路由冲突告警（`/404` 重复定义），本次不影响部署成功，但建议后续单独清理。
