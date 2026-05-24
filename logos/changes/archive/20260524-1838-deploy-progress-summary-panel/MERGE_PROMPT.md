# 合并指令

## 变更提案
- 提案名称：deploy-progress-summary-panel
- 提案目录：logos/changes/deploy-progress-summary-panel/

## 提案内容

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


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/deploy-progress-summary-panel/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md

- Delta 文件：`logos/changes/deploy-progress-summary-panel/deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md

- Delta 文件：`logos/changes/deploy-progress-summary-panel/deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md

- Delta 文件：`logos/changes/deploy-progress-summary-panel/deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md

- Delta 文件：`logos/changes/deploy-progress-summary-panel/deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/deploy-progress-summary-panel/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/spec/cli-json-output.md

- Delta 文件：`logos/changes/deploy-progress-summary-panel/deltas/spec/cli-json-output.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/test/core-S11-test-cases.md

- Delta 文件：`logos/changes/deploy-progress-summary-panel/deltas/test/core-S11-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/deploy-progress-summary-panel/deltas/test/smoke/core-smoke-test-cases.md`
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
   git add -A && git commit -m "docs(deploy-progress-summary-panel): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive deploy-progress-summary-panel`。
