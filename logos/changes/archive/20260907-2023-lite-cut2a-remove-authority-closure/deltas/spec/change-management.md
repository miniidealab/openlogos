# Delta: change-management.md

> change: lite-cut2a-remove-authority-closure
> 目标：`spec/change-management.md`

Authority Closure Plan 合同随 change-lint L10 废止。该节在主文档中存在两处字节相同的同名标题（第 947、950 行），章节锚不可唯一定位，故按其**子节**逐节删除；两个空标题壳留待后续清理。

## REMOVED — 流程位置与正交边界

本子节定义 Authority Closure 在 write-proposal / PlanPackageEvaluator / plan-exit 中的嵌入位置及其与 `baseline_closure` 的正交边界。L10 删除后失去定义对象。

## REMOVED — proposal 唯一声明

本子节要求每份 scaffold 含唯一 `authority_impact` fenced YAML（schema `openlogos/authority-impact@1`），并约定 proposal / Registry / 方法论规范三者不得互相复制。`authority_impact` 块不再被解析后失去要求对象。

## REMOVED — 完成与检查

本子节定义 PlanPackageEvaluator 组合 AuthorityClosureEvaluation 的完成判据（声明缺失/重复/畸形、fact 引用不存在、required 字段不全、测试 ID 不真实、shadow source 未退休、cutover 四子字段、unresolved 非空）及消费方唯一性要求。L10 删除后失去判据对象。

## REMOVED — Authority Closure Plan 合同 > 历史兼容

本子节定义 Authority Closure 对存量提案与已归档提案的兼容读法。`authority_impact` 块自 0.15.0 起一律忽略而非报错，兼容分级不再需要。

## REMOVED — 授权

本子节声明 authority impact 完成只允许到达既有 plan-exit。该授权链条随 L10 删除；merge / verify / 部署 / smoke / archive / 公开发布 / git push 的各自确认点由本规范其余章节继续约束。
