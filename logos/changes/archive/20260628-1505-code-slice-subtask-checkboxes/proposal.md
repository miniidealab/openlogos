# 变更提案：code-slice-subtask-checkboxes

> module: core | created: 2026-06-28

## 变更原因

当前 S31 代码切片循环把 `tasks.md` 的 `[code]` section 中每个 checkbox 行视为切片，并由 `slice_state` / `next_node.slice` 派生当前待实现切片。这对顶层切片可用，但无法表达“一个切片内部还有多个可勾选子任务”的进度。

实际大功能切片常需要在父切片下列出 bridge、adapter、panel、UT/ST/reporter 等子项。若这些子项使用缩进 checkbox，OpenLogos 需要明确它们是切片内部完成项，而不是新的顶层切片；同时父切片只有在自身和所有子任务都勾选后才应计入完成。

本提案只覆盖 OpenLogos 侧需要修改的部分：S31 切片状态派生、机器输出契约、测试用例与实现。RunLogos driver 的派发策略和 Agent 忙碌保护不在本提案实现范围内，只作为外部消费方约束保留在参考需求中。

## 变更类型

需求级变更

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 的 S31 需求与验收条件
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` 的 2.22 / S31 切片循环规格
- 影响的页面/CLI 体验：`logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md` 的 `next --format json` / `slice_state` / `next_node` 输出说明
- 影响的技术架构：`logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md` 的 S31 派生架构与 `next_node` 契约
- 影响的业务场景：`logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S31-code-slice-loop.md`
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无 API 编排测试；需更新 `logos/resources/test/core-S31-test-cases.md`
- 影响的 smoke 测试：无

## 部署影响

- 是否需要部署：否
- 部署原因：本次变更只修改 CLI 本地派生逻辑、规格文档和自动化测试，不涉及服务端部署、数据库迁移或线上环境配置；后续发布到 npm / 官网按既有 release workflow 单独处理。
- 影响环境：本地
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## 变更概述

OpenLogos 需要把 `[code]` section 中的顶层 checkbox 与缩进 checkbox 分层解析：顶层显式切片仍决定 `slice_state.total`；缩进 checkbox 作为当前切片的子任务，只参与该父切片完成判定，不参与顶层切片计数。

`slice_state` 需要扩展当前切片的子任务信息，例如 `current_children` 与 `current_unchecked_children`；`next_node` 需要同步暴露 `slice_children`，让宿主在逐片派发时能携带当前切片内部子任务清单。父切片已勾选但仍有未勾子任务时，该切片不得计为 done，`code_slices_green` 也不得收敛。

实现时需保持向后兼容：没有缩进子任务 checkbox 的既有 `[code]` 切片行为不变；空 `[code]` 仍退化为 `tests_green`；initial 多模块仍不激活切片循环；`verify` 仍跑全量回归，切片和子任务 checkbox 只作为完成事实源，不替代测试结果。
