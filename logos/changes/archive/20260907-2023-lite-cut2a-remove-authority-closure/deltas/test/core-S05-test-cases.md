# Delta: core-S05-test-cases.md

> change: lite-cut2a-remove-authority-closure
> 目标：`logos/resources/test/core-S05-test-cases.md`

## REMOVED — S05 新建 authority fact 提案的 proposal_step 可达性测试

本节（UT-S05-47～50、ST-S05-22）验证的是「新建 authority fact 的提案在 plan 门死锁解除后可派生到 `ready-to-delta`」。该死锁由 L10 自身制造（通过条件要求 delta 已存在，而 plan 阶段定义为尚无 delta），L10 删除后死锁与其解除逻辑一并消失，用例失去验证对象。

「门禁前置条件必须在其所处阶段可满足」这一通用要求不随之丢失——它由 UT-S35-129 独立锁定，该用例遍历门禁全集、不依赖 authority 语义。

## REMOVED — S05 围栏多命中时容错失效的归因测试

本节（UT-S05-51、ST-S05-23）验证的是「嵌套围栏致 `collectPlannedAuthorityCreateTargets` 静默返回空集、使 plan 阶段 `authority_ref` 容错失效」的归因诊断。该容错通道是 L10 为绕开自身 plan 阶段限制而自建的第二套 `baseline_closure` 解析器，随 L10 一并删除。

围栏提取本身的单点性（全部提取器共用 `markdown-scan` fence-aware 掩码）由 UT-S35-127 继续锁定。
