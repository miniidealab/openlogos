## ADDED — Authority Closure Plan 合同

## Authority Closure Plan 合同

### 流程位置与正交边界

Authority Closure 嵌入既有 write-proposal / PlanPackageEvaluator / plan-exit，不新增 lifecycle、subflow、human gate 或 marker。它与 `baseline_closure` 正交：authority impact 回答“谁有权裁决事实以及如何迁移”，baseline closure 回答“本次需要哪些规格目标”。两者均通过才可能 plan ready。

### proposal 唯一声明

新 scaffold 必须包含唯一 `authority_impact` fenced YAML，schema 为 `openlogos/authority-impact@1`。required 分支引用项目 Authority Registry 或当前 CREATE authority target，列出 projections、retired shadow sources、forbidden fallbacks、cutover 和真实 test IDs，`unresolved` 为空。not_applicable 分支只含非空 evidence，不得用空 facts 绕过。

proposal 是 change 计划，Registry 是项目 fact ownership 实例，`spec/authority-closure.md` 是方法论规范；三者不得互相复制。tasks 只投影 material Delta target，不保存另一份 authority 判据。

### 完成与检查

PlanPackageEvaluator 组合唯一 AuthorityClosureEvaluation。以下任一条件使 plan 未完成：声明缺失/重复/畸形、fact 引用不存在、required 字段不全、测试 ID 不真实、shadow source 未退休、cutover 无 old stop/new start/rollback/exit、unresolved 非空。

change-lint、status、next、flow 和 merge precheck 只能消费共享 evaluation；禁止独立 Markdown/YAML parser、关键词触发器或局部 pass 公式。结构 violation 走 exit 2；操作错误 exit 1；求值只读，不写 proposal、Registry、marker 或任务。

### 历史兼容

新提案和仍 writing 的提案严格执行。存在 `PLAN_APPROVED|SPEC_MERGED|MERGED|VERIFY_PASS` 或已归档提案不回退。存量项目按后续触达 fact 渐进补齐 Registry，不全量生成推测性历史。

### 授权

authority impact 完成只允许到达既有 plan-exit；`PLAN_APPROVED` 只允许产 Delta。merge、verify、部署、smoke、archive、公开发布和 git push 继续按各自确认点授权。
