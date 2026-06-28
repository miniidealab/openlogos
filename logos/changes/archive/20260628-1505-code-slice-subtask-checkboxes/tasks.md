# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/core-01-requirements.md` — 更新 S31 对缩进子任务 checkbox 的需求、完成判定和验收条件。
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — 更新 2.22 / S31 功能规格，明确顶层切片与切片子任务的分层语义。
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md` — 更新 `next --format json` 中 `slice_state` / `next_node.slice_children` 的 CLI 输出说明。
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md` — 更新 S31 派生架构，说明缩进 checkbox 解析、完成计数和 next_node 挂载策略。
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S31-code-slice-loop.md` — 更新 S31 时序图与步骤说明，补充父切片和子任务 checkbox 的推进规则。
- [x] 产出 delta 文件到 `deltas/test/core-S31-test-cases.md` — 新增切片子任务 checkbox 的 UT/ST 用例设计（暂定覆盖 UT-S31-15、UT-S31-16、UT-S31-17、UT-S31-18、ST-S31-07）。

## [code] 代码实现
- [x] 单切片：实现 S31 切片子任务 checkbox 支持，并同步更新 `flow-loop-derive` / `next` 相关逻辑、CLI UT/ST、OpenLogos reporter 和必要 golden baseline；覆盖父切片计数不受缩进子任务影响、父切片已勾但子任务未全勾不计 done、`slice_state.current_children` / `current_unchecked_children` / `next_node.slice_children` 输出、既有无子任务切片行为不变（覆盖 UT-S31-15、UT-S31-16、UT-S31-17、UT-S31-18、ST-S31-07）。
