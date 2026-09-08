# Delta: authority-closure.md

> change: lite-cut2a-remove-authority-closure
> 目标：`spec/authority-closure.md`

Authority Closure 规范整体废止：change-lint 的 L10 检查项、`openlogos/authority-impact@1` schema 与 Plan Package 的 authority 维度一并删除，本规范的每一节都失去规范对象。逐节删除后新增一节废止说明；文件本身留待 0.15.0 打包时从随包 `spec/` 中移除。

## REMOVED — 1. 目的

Authority Closure 规范废止，本节随之删除。

## REMOVED — 2. 规范关键词

Authority Closure 规范废止，本节随之删除。

## REMOVED — 3. 术语

Authority Closure 规范废止，本节随之删除。

## REMOVED — 4. AC-01～AC-08

Authority Closure 规范废止，本节随之删除。

## REMOVED — 5. Authority Registry

Authority Closure 规范废止，本节随之删除。

## REMOVED — 6. 适用性

Authority Closure 规范废止，本节随之删除。

## REMOVED — 7. openlogos/authority-impact@1

Authority Closure 规范废止，本节随之删除。

## REMOVED — 8. Plan Package evaluator

Authority Closure 规范废止，本节随之删除。

## REMOVED — 9. violation 合同

Authority Closure 规范废止，本节随之删除。

## REMOVED — 10. 角色职责

Authority Closure 规范废止，本节随之删除。

## REMOVED — 11. 场景与消费者规则

Authority Closure 规范废止，本节随之删除。

## REMOVED — 12. Cutover 与回滚

Authority Closure 规范废止，本节随之删除。

## REMOVED — 13. 测试与审查

Authority Closure 规范废止，本节随之删除。

## REMOVED — 14. 历史兼容

Authority Closure 规范废止，本节随之删除。

## REMOVED — 15. 验收

Authority Closure 规范废止，本节随之删除。

## ADDED — 废止说明

> 状态：已废止（0.15.0）｜原策略标识：`openlogos/authority-impact@1`｜替代判据：无

Authority Closure 于 0.15.0 整体废止。原规范要求每个变更提案声明 `authority_impact` 并为每个业务事实枚举 15 个闭合字段（owner / sole_writer / mutation_entry / decision_api / freshness_proof / rebuild_rule / recovery_source / projections / retired_shadow_sources / forbidden_fallbacks / cutover 四子字段 / tests）。

**废止理由**：该规范要求人工预测「谁裁决事实」并逐字段闭合，属于让人做机器该做的事。实践证据是它在起草阶段反复拦截作者本身而从未拦下真实的权威设计缺陷；它还为绕开自身在 plan 阶段的不可满足性，自建了第二套 `baseline_closure` 解析器与围栏归因诊断，成为新的失败来源。

**替代**：事实归属的正确性由测试覆盖与代码审查保障，不再由 lint 门强制。`proposal.md` 中已存在的 `authority_impact` 块自 0.15.0 起被忽略而非报错，无需迁移。

**消费方影响**：`change-lint` 的检查项由 11 项收敛为 10 项（L0～L9）；`authority_closure_*` issue 码族不再发射。
