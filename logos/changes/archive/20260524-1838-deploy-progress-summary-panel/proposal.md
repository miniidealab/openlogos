# 变更提案：deploy-progress-summary-panel

> module: core | created: 2026-05-24

## 变更原因
RunLogos 目前在部署相关状态展示上仍偏向“查看提案是否需要部署”，但用户真正需要的是一个可快速判断进度的摘要面板：当前提案是否需要部署、`tasks.md` 的 `[deploy]` 任务完成到哪一步、是否可以继续进入 smoke 或归档。

如果 CLI 继续把部署说明文档当作展示入口，RunLogos 面板会继续承载过多部署细节，导致用户无法快速判断当前是否已经进入可执行部署阶段，也不利于提示“下一步该做什么”。

## 变更类型
设计级

## 变更范围
- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md`
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`
- 影响的业务场景：`S11`（查看阶段进度与活跃变更）、`S19`（执行部署后 smoke 门禁）
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无

## 部署影响
- 是否需要部署：是
- 部署原因：本次会修改 `openlogos status --format json` 的结构化字段契约和 CLI 状态判定逻辑，RunLogos 依赖这些字段渲染部署进度摘要面板，因此需要发布新的 CLI 版本让客户端消费新契约。
- 影响环境：本地 / 测试 / 生产
- 是否涉及数据迁移：否
- 是否需要回滚预案：是
- 是否需要 smoke：是

## 变更概述
本次变更将把 OpenLogos CLI 的部署展示能力拆成两部分：提案级部署决策和部署进度摘要。`proposal.md` 继续决定是否需要部署、是否需要 smoke；`tasks.md` 的 `[deploy]` section 只决定部署任务做到了哪一步。

CLI 需要在 `openlogos status --format json` 中稳定输出 `deployment_progress` 和 `deployment_document`，其中 `deployment_progress` 只统计当前提案 `tasks.md` 的 `[deploy]` 任务，`deployment_document` 也必须指向 `tasks.md`，供 RunLogos 面板直接展示部署任务入口和完成进度。

RunLogos 则可以基于这些结构化字段，把部署相关 UI 收缩成一个“摘要 + 任务入口”的面板：显示当前是否需要部署、已完成多少部署任务、任务文档入口是否可用，以及冲突/降级状态下的可诊断提示。
