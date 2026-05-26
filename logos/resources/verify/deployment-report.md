# 部署报告

> 生成时间：2026-05-26 15:00:58 UTC  
> 提案：`releases-version-value-clarity`  
> 目标环境：生产 / Cloudflare Pages  
> 状态：SUCCESS

## 摘要

- 部署地址：`https://862e6ee3.openlogos.pages.dev`
- 部署命令：`cd website && npm run deploy`
- 构建命令：`cd website && npm run build`
- 发布数据生成：`cd website && npm run generate:releases`
- 数据迁移：无

## 执行步骤

1. 生成官网发布数据：`cd website && npm run generate:releases`
2. 构建官网：`cd website && npm run build`
3. 发布到 Cloudflare Pages：`cd website && npm run deploy`

## 结果

- 官网构建：PASS
- Cloudflare Pages 上传：PASS
- Cloudflare Pages 部署：PASS
- `/releases` 页面内容：PASS（构建产物与线上页面均包含版本摘要与回退提示）

## 回滚点

- 通过 Cloudflare Pages 回滚到上一成功部署。

## 风险

- 构建过程中仍存在既有 Astro `/404` 路由冲突 warning，但未影响本次部署结果。
- 当前工作区还存在与本提案无关的 `logos/changes/homepage-release-summary-relocation/SPEC_MERGED` 删除状态，未纳入本次部署。
