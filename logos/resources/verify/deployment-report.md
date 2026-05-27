# 部署报告

> 生成时间：2026-05-27 11:45:51 CST  
> 提案：`releases-bilingual-release-notes`  
> 目标环境：生产 / Cloudflare Pages  
> 状态：SUCCESS

## 摘要

- 部署地址：`https://64392121.openlogos.pages.dev`
- 生产域名检查：`https://openlogos.ai/releases/`
- 部署命令：`cd website && npm run deploy`
- 构建命令：`cd website && npm run build`
- 发布数据生成：`cd website && npm run generate:releases`
- 数据迁移：无
- npm 包发布：未执行，本提案仅部署官网。

## 执行步骤

1. 生成官网发布数据：`cd website && npm run generate:releases`
2. 构建官网：`cd website && npm run build`
3. 发布到 Cloudflare Pages：`cd website && npm run deploy`
4. 检查部署预览地址 `/` 与 `/releases/`
5. 检查生产域名 `/releases/`

## 结果

- 官网构建：PASS
- Cloudflare Pages 上传：PASS（上传 2 个文件，190 个文件复用）
- Cloudflare Pages 部署：PASS
- 部署预览 `/releases/`：PASS，HTTP 200
- 生产域名 `/releases/`：PASS，HTTP 200
- release 双语内容：PASS，页面包含英文主摘要、`Chinese original` 次级内容和固定英文回退提示。

## 回滚点

- 通过 Cloudflare Pages 回滚到上一成功部署。
- 若发布数据异常，可回滚到上一份静态 JSON 产物对应的部署版本。

## 风险

- 构建过程中仍存在既有 Astro `/404` 路由冲突 warning，但未影响本次部署结果。
- Wrangler 提示当前 Git 工作区存在未提交变更；该未提交项是与本提案无关的 `logos/changes/homepage-release-summary-relocation/SPEC_MERGED` 删除状态，未纳入本次部署。
