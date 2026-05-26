# 变更提案：releases-version-value-clarity

> module: core | created: 2026-05-26

## 变更原因
用户反馈 `/releases` 页面当前只展示 npm 元数据，无法直接看出每个版本带来的价值、修复了哪些问题，必须逐条跳转外链阅读，信息获取成本高。

本次变更目标是在“内容可验证、不可伪造”的前提下，让用户在 release 页面直接看到每个版本的核心变化摘要与问题修复摘要，并保留外链查看完整说明。

## 变更类型
设计级

## 变更范围
- 影响的需求文档：`prd/2-product-design/1-feature-specs/core-00-information-architecture.md`（官网发布动态数据展示策略）
- 影响的功能规格：`prd/2-product-design/2-page-design/core-02-docs-website-experience.md`（`/releases` 页面版本说明展示规则）
- 影响的业务场景：无新增场景（沿用官网发布动态相关场景）
- 影响的部署方案：`prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`（补充发布后检查项）
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无
- 影响的 smoke 测试：`test/smoke/core-smoke-test-cases.md`（新增 release 版本说明可见性检查）

## 部署影响
- 是否需要部署：是
- 部署原因：涉及官网构建脚本与 `/releases` 页面渲染逻辑，需部署到 Cloudflare Pages 才能生效
- 影响环境：生产
- 是否涉及数据迁移：否
- 是否需要回滚预案：是
- 是否需要 smoke：是

## 变更概述
本次变更将为每个版本补充“版本价值”和“问题修复”信息块。说明内容优先来自仓库 `CHANGELOG.md` 的对应版本章节（例如 Added / Changed / Fixed），确保内容可追溯、可验证，不使用 AI 臆造文案。

当某个版本在 `CHANGELOG.md` 中没有对应条目时，页面必须展示明确的“说明缺失”回退提示，并提供 GitHub Release 与 CHANGELOG 外链。这样既能提高页面信息密度，也能保持数据真实性边界。
