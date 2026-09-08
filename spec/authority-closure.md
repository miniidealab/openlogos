## Authority Closure 业务事实权威闭包规范


# Authority Closure 业务事实权威闭包规范

## 废止说明

> 状态：已废止（0.15.0）｜原策略标识：`openlogos/authority-impact@1`｜替代判据：无

Authority Closure 于 0.15.0 整体废止。原规范要求每个变更提案声明 `authority_impact` 并为每个业务事实枚举 15 个闭合字段（owner / sole_writer / mutation_entry / decision_api / freshness_proof / rebuild_rule / recovery_source / projections / retired_shadow_sources / forbidden_fallbacks / cutover 四子字段 / tests）。

**废止理由**：该规范要求人工预测「谁裁决事实」并逐字段闭合，属于让人做机器该做的事。实践证据是它在起草阶段反复拦截作者本身而从未拦下真实的权威设计缺陷；它还为绕开自身在 plan 阶段的不可满足性，自建了第二套 `baseline_closure` 解析器与围栏归因诊断，成为新的失败来源。

**替代**：事实归属的正确性由测试覆盖与代码审查保障，不再由 lint 门强制。`proposal.md` 中已存在的 `authority_impact` 块自 0.15.0 起被忽略而非报错，无需迁移。

**消费方影响**：`change-lint` 的检查项由 11 项收敛为 10 项（L0～L9）；`authority_closure_*` issue 码族不再发射。
