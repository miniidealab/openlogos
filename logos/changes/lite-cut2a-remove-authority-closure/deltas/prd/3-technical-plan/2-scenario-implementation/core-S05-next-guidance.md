# Delta: core-S05-next-guidance.md

> change: lite-cut2a-remove-authority-closure
> 目标：`logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`

## REMOVED — S05 新建 authority fact 提案的 proposal_step 派生

本节描述「新建 authority fact 的提案如何脱离 plan 门死锁并派生到 `ready-to-delta`」。该死锁由 L10 自身制造——其通过条件要求 test delta 已存在，而 plan 阶段的定义就是尚无 delta。L10 删除后死锁与其解除路径一并消失。

`next` 的通用 `proposal_step` 派生（flow 派生、gate 消费、marker 读法）不受影响。

## REMOVED — S05 围栏多命中时 plan 阶段容错失效的归因路径

本节描述 `collectPlannedAuthorityCreateTargets` 在嵌套围栏致候选数不为 1 时静默返回空集、使 `authority_ref` 的 plan 阶段容错无声失效的传导路径与归因诊断。该容错通道是 L10 为绕开自身 plan 阶段限制而自建的第二套 `baseline_closure` 解析器，随 L10 一并删除。

围栏提取的单点性（全部提取器共用 `markdown-scan` 的 fence-aware 掩码）由 S35 的围栏节继续约束。
