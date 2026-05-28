# 合并指令

## 变更提案
- 提案名称：release-website-sync-on-tag
- 提案目录：logos/changes/release-website-sync-on-tag/

## 提案内容

# 变更提案：release-website-sync-on-tag

> module: core | created: 2026-05-27

## 变更原因
用户在完成一次标准部署后反馈：npm 包和 GitHub Release 已更新，但官网 `/releases` 页面未及时反映最新版本，导致“已发版但官网不可见”的体验断层。

根因是当前发版链路中，tag 驱动流程主要覆盖 `npm publish + GitHub Release`，而官网发布动态依赖网站构建与部署动作；当发布提案未显式执行官网同步步骤时，release 页面会停留在旧数据。

## 变更类型
部署级（含发布自动化代码改造）

## 变更范围
- 影响的需求文档：无新增需求场景，沿用“发布动态必须反映真实发布状态”的既有目标。
- 影响的功能规格：
  - `logos/resources/prd/2-product-design/1-feature-specs/core-00-information-architecture.md`（官网发布动态同步约束）
  - `logos/resources/prd/2-product-design/2-page-design/core-02-docs-website-experience.md`（`/releases` 页面发布可见性约束）
- 影响的业务场景：
  - `S19`（部署后 smoke 门禁，需覆盖“发版后官网 release 可见”）
- 影响的部署方案：
  - `logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`（tag 发版后官网同步成为标准步骤）
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无
- 影响的 smoke 测试：
  - `logos/resources/test/smoke/core-smoke-test-cases.md`（补强 release 同步验证）

## 部署影响
- 是否需要部署：是
- 部署原因：需要改造发布自动化链路与网站发布流程，变更只有在真实发版/官网部署后才可验证闭环。
- 影响环境：测试 / 生产
- 是否涉及数据迁移：否
- 是否需要回滚预案：是
- 是否需要 smoke：是

## 变更概述
本次变更把“官网 release 页面同步”纳入标准发版闭环：当执行 tag 发版时，发布链路必须明确触发官网发布数据刷新与站点部署，避免出现 npm/GitHub Release 已完成但官网版本列表滞后的状态。

实现层面会补齐发布工作流编排与失败反馈机制，确保官网同步步骤可观测、可重试、可回滚。文档层面会同步更新部署方案与 smoke 门禁，明确“每次发版后必须校验 `/releases` 展示最新版本和发布时间”。


## 需要合并的 Delta 文件

### 1. deltas/prd/2-product-design/1-feature-specs/core-00-information-architecture.md

- Delta 文件：`logos/changes/release-website-sync-on-tag/deltas/prd/2-product-design/1-feature-specs/core-00-information-architecture.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/2-page-design/core-02-docs-website-experience.md

- Delta 文件：`logos/changes/release-website-sync-on-tag/deltas/prd/2-product-design/2-page-design/core-02-docs-website-experience.md`
- 目标目录：`logos/resources/prd/2-product-design/2-page-design/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/release-website-sync-on-tag/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/release-website-sync-on-tag/deltas/test/smoke/core-smoke-test-cases.md`
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
   git add -A && git commit -m "docs(release-website-sync-on-tag): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive release-website-sync-on-tag`。
