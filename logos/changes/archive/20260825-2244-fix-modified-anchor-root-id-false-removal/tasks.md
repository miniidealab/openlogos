# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：更新 S37 的合法根标题 ID 放行条件、真实隐式删除边界与验收条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：修正 §2.33 retained 的形式化定义，明确控制锚、最终章节根标题与正文的关系。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：补充唯一命中后重建根标题的算法、结构化守恒不变量与 fail-closed 边界。
- [x] [CREATE] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S37-delta-conservation.md`：补齐 S37 lint/merge 同源守恒场景的目标、参与者、时序、步骤、异常与追溯。
- [x] [MODIFY] `deltas/spec/change-management.md`：澄清 `MODIFIED` 最终章节结构的 retained 计算合同及安全边界。
- [x] [MODIFY] `deltas/test/core-S37-test-cases.md`：新增 UT-S37-32～UT-S37-36 与 ST-S37-07～ST-S37-08，覆盖三类根 ID 正例、内嵌 ID 删除反例及 lint/merge CLI 闭环。

## [code] 代码实现

> 六维评分：3/12（影响范围 1、行为复杂度 1、契约变化 0、测试规模 1、风险等级 0、不确定性 0），不是大任务，采用单切片。
>
> 删后续自检：只有 1 片，无后续依赖；该片同时交付根标题最终态重建、真实缺失 ID 的 fail-closed 回归、lint/merge CLI 闭环与既有全局 OpenLogos reporter。若把判据、UT 或 ST 横向拆开，任一前片都不能独立证明端到端可观察且全量 verify 可绿，因此合并为单片。

- [x] 单切片：在 `evaluateDeltaConservation()` 唯一命中 `MODIFIED` 锚后，以目标 `hit.level` / `hit.text` 重建 retained 根标题并与正文共同做结构化 ID 对账；保持锚 0/多命中、内嵌 ID 真删除、违规码与排序不变；同步纯函数 UT、真实 CLI lint/merge ST、全局 OpenLogos reporter 与必要 golden（覆盖 UT-S37-32、UT-S37-33、UT-S37-34、UT-S37-35、UT-S37-36、ST-S37-07、ST-S37-08）。
