# Delta: baseline-closure.md

> change: lite-cut2b-remove-baseline-closure
> 目标：`spec/baseline-closure.md`

按触达目标规格闭包规范整体废止：change-lint L9、`baseline_closure` 声明与 P==T==D 对账一并删除，本规范的每一节都失去规范对象。逐节删除后新增废止说明；文件本身留待 0.15.0 打包时从随包 `spec/` 中移除。

## REMOVED — 1. 目的

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 2. 规范关键词

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 3. 术语

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 4. 核心不变量

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 5. Plan 输入与证据

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 6. 受影响场景识别

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 7. 闭包维度与适用性

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 8. 目标模式

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 9. canonical target 与去重

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 10. Effective view 与生成顺序

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 11. CREATE 最低完整度

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 12. Plan/spec/merge 检查

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 13. Apply 事务

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 14. 棕地兼容

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 15. 无 JIT 确认红线

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 16. 验收

按触达目标规格闭包规范废止，本节随之删除。

## REMOVED — 17. 场景 CREATE Markdown 结构完整性合同

按触达目标规格闭包规范废止，本节随之删除。

## ADDED — 废止说明

> 状态：已废止（0.15.0）｜原策略标识：`on-touch-v1`｜替代判据：merge 目标集由 `deltas/` 目录派生（功能规格 §2.71）

按触达目标规格闭包于 0.15.0 整体废止。原规范要求作者在规划阶段枚举本次触达的场景，为每个触达场景补齐 requirement/feature/scenario/test 四维目标与其余维度的证据化 disposition，再由 change-lint L9 做 P==T==D 三方对账。

**废止理由**：让作者预测「改动会波及哪些规格」是错误的分工。本次减法自身在四个提案中漏标四次（合计 200 余个用例），全部由测试覆盖度发现、无一由 L9 发现；L9 实际拦下的是 targets 排序、SKIP 证据组合这类格式问题。更严重的是它逼出编造——一处只涉及测试规格表格格式的修复，也被要求为该场景补齐并不存在的场景文档变更。

**替代**：merge 的目标集是 `deltas/` 目录的无逻辑投影——每个可 merge 的 delta 经 `canonicalTargetFromDeltaPath` 映射为唯一 canonical target，目标存在即 MODIFY、缺失即 CREATE，在 merge 执行时按磁盘事实判定。规格是否波及完整，由 `openlogos verify` 的 ID 覆盖检查（规格声明的用例必须都有执行结果）保障。

**消费方影响**：`change-lint` 检查项由 10 项收敛为 9 项（L0～L8）；`baseline_closure_*` violation 码族不再发射；`proposal.md` 中已存在的 `baseline_closure` 块自 0.15.0 起被忽略而非报错，无需迁移。

**保留不变**：`canonicalTargetFromDeltaPath` 等路径映射判据、non-Markdown（OpenAPI / SQL）整文件 delta 的 marker 协议、以及 apply 阶段的原子落盘与恢复 journal——它们与闭包规划无关，逐行保留。
