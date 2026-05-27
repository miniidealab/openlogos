# 合并指令

## 变更提案
- 提案名称：releases-bilingual-release-notes
- 提案目录：logos/changes/releases-bilingual-release-notes/

## 提案内容

# 变更提案：releases-bilingual-release-notes

> module: core | created: 2026-05-26

## 变更原因
OpenLogos 官网主体文案面向海外用户，当前 `/releases` 页面 UI 已为英文，但版本价值摘要与问题修复摘要直接来自中文 `CHANGELOG.md`，导致海外用户无法快速理解每个版本带来的价值和解决的问题。

本变更来自官网发布日志页面的语言一致性反馈：release note 内容需要在保持中文原文可追溯的同时，优先提供英文说明，避免整站英文体验中混入大量中文版本摘要。

## 变更类型
设计级变更

## 变更范围
- 影响的需求文档：无新增需求场景；沿用官网发布日志“展示版本价值 / 修复摘要”的既有目标。
- 影响的功能规格：
  - `logos/resources/prd/2-product-design/2-page-design/core-02-docs-website-experience.md` — 调整 `/releases` 页面语言策略、数据字段和展示规则。
  - `logos/resources/prd/2-product-design/2-page-design/core-03-release-page-prototype.html` — 更新原型中的双语摘要展示形态。
- 影响的业务场景：无新增 CLI 业务场景；属于官网发布日志页面体验变更。
- 影响的部署方案：
  - `logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 官网页面与静态数据产物变化后需要重新部署网站。
- 影响的 API：无。
- 影响的 DB 表：无。
- 影响的编排测试：无。
- 影响的 smoke 测试：
  - `logos/resources/test/smoke/core-smoke-test-cases.md` — `SMOKE-core-07` 需要验证 release 页面同时呈现英文摘要和中文原文 / 中文展开内容。

## 部署影响
- 是否需要部署：是
- 部署原因：官网 `/releases` 页面渲染逻辑、发布数据产物和静态构建内容会变化，需要重新构建并发布网站。
- 影响环境：本地 / staging / 生产
- 是否涉及数据迁移：否
- 是否需要回滚预案：是
- 是否需要 smoke：是

## 变更概述
`/releases` 页面改为英文优先的双语版本摘要：英文摘要作为主内容展示，中文原文作为次级内容保留，用于可追溯和服务中文用户。页面固定英文 UI 不变，但每个版本的“价值摘要 / 修复摘要”不再直接只展示中文 changelog 条目。

数据层需要为每个版本提供双语摘要字段，例如英文价值摘要、英文修复摘要、中文价值摘要、中文修复摘要，并保留摘要来源与回退原因。英文摘要必须来自维护的确定性映射或结构化规则，不允许在构建或页面运行时由 AI 临时生成虚构说明；缺失时显示固定英文回退文案，并可显示中文原文或完整 CHANGELOG 链接。

smoke 需要覆盖 release 页面双语能力：页面至少展示一个版本的英文价值 / 修复摘要，同时保留中文原文入口或中文内容；当英文摘要缺失时展示固定英文回退提示，不破坏 GitHub Release / CHANGELOG 外链。


## 需要合并的 Delta 文件

### 1. deltas/prd/2-product-design/2-page-design/core-02-docs-website-experience.md

- Delta 文件：`logos/changes/releases-bilingual-release-notes/deltas/prd/2-product-design/2-page-design/core-02-docs-website-experience.md`
- 目标目录：`logos/resources/prd/2-product-design/2-page-design/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/2-page-design/core-03-release-page-prototype.html

- Delta 文件：`logos/changes/releases-bilingual-release-notes/deltas/prd/2-product-design/2-page-design/core-03-release-page-prototype.html`
- 目标目录：`logos/resources/prd/2-product-design/2-page-design/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/releases-bilingual-release-notes/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/releases-bilingual-release-notes/deltas/test/smoke/core-smoke-test-cases.md`
- 目标目录：`logos/resources/test/smoke/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(releases-bilingual-release-notes): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive releases-bilingual-release-notes`。
