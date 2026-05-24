# 变更提案：website-release-feed

> module: core | created: 2026-05-24

## 变更原因
官网当前在信息架构中已经规划“发布：版本说明和兼容性信息”，但实际官网没有发布动态入口。用户无法从官网确认 npm 最新版本、历史发布时间、安装命令和对应的发布归档链接。

近期发布链路已经统一为 tag 驱动的 npm + GitHub Release 同步发布，本次需要把官网发布动态补齐，避免 npm 已发布但官网不可见，或官网发布信息依赖手工维护后再次失真。

## 变更类型
设计级

## 变更范围
- 影响的需求文档：无新增核心业务场景；沿用官网负责“发布信息”的既有目标。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-00-information-architecture.md`、`logos/resources/prd/2-product-design/2-page-design/core-02-docs-website-experience.md`
- 影响的业务场景：无 CLI 场景变更；官网展示作为文档站体验补充。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 影响的 smoke 测试：`logos/resources/test/smoke/core-smoke-test-cases.md`
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无

## 部署影响
- 是否需要部署：是
- 部署原因：本次会修改官网 Astro 源码、构建期发布数据生成脚本和静态页面，需要重新构建并部署 Cloudflare Pages 才能对用户可见。
- 影响环境：官网 staging / production（Cloudflare Pages）
- 是否涉及数据迁移：否
- 是否需要回滚预案：是
- 是否需要 smoke：是

## 变更概述
新增官网发布动态能力。发布数据来源限定为 npm registry 中 `@miniidealab/openlogos` 的真实发布信息，包括 `latest` dist-tag、版本列表、发布时间、npm 包链接和 GitHub Release 链接。npm registry 不提供逐版本详细变更正文，因此官网不得伪造“npm 发布日志正文”；详细变更只允许跳转到 GitHub Release 或仓库 changelog。

官网交互上新增独立 `/releases` 页面展示发布动态时间线，并在首页增加最近发布入口。页面保持现有 OpenLogos 官网的深色、克制、工程化风格，优先帮助用户确认最新版本、复制安装命令、跳转 npm / GitHub，而不是营销式长页。

实现上增加构建期数据生成脚本，从 npm registry 读取发布元数据并写入官网源码可导入的 JSON 数据；官网页面在构建时读取静态 JSON，不在浏览器端实时请求 npm，保证 Cloudflare Pages 静态部署稳定。
