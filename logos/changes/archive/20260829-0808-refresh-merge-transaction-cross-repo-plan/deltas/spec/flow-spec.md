## ADDED — Plan completion 与 merge transaction 前沿隔离

### 命名空间

Plan 完成事实继续属于 `plan.*`（proposal、tasks、Delta、clarification、PLAN_APPROVED）；合并执行事实唯一属于 `merge_transaction.*`。`PLAN_APPROVED` 只授权进入 Delta/merge 准备，不代表 transaction sealed、applied 或 completed。两个命名空间不得复用 `ready`、`completed` 或 marker 作为无前缀共享状态。

### 前沿派生

当 plan/delta 门满足且用户已明确授权 merge 后，flow 必须创建或恢复该 slug 的唯一活跃 merge transaction，并完全消费其投影：

1. `collecting`：派发仅可填充声明式 content slot 的工作单；
2. `ready`：建议 `seal`；
3. `sealed`：建议 `apply`；
4. `applying`：建议 `recover`，禁止并发新 apply；
5. `completed`：以 receipt 进入 `plan-slices`/实现前沿；
6. `failed`：依据 classification 选择 `recover` 或阻塞，禁止退回旧 manifest 路径。

`next_action` 是前沿动作的唯一权威；flow 节点只能将它映射为已注册节点，不能根据文件是否存在猜测下一步。若 `next_action` 与 `allowed_actions` 不一致，必须以 `contract-invalid` fail-closed。

### Driver 边界

Driver 可以创建/读取事务、派发 slot 填充、调用 seal/apply/recover，并转发 receipt；不得写 canonical target、metadata、dogfood、marker、journal 或 receipt，不得要求 Agent 生成 `MERGE_APPLY_MANIFEST.json`。工作单完成仅表示 slot 已提交，不表示 apply-merge 节点完成。

### no-delta

no-delta 不跳过事务节点。flow 创建空 resource target set，核心扩展必要 metadata closure，随后按 `ready → sealed → applying → completed` 推进。这样 no-delta 与普通 Delta 使用同一成功和恢复谓词。

### 重启、幂等与并发

- 同一 slug 只能有一个非终态 transaction；重复启动返回同一 transaction id。
- sealed 后任何 slot 或 target 身份变化必须拒绝，不能隐式另开事务。
- apply 超时或 Driver 断连后，下一轮先读取 status，再按 `allowed_actions` 恢复。
- completed 后重复调用返回同一 receipt，flow 不重复进入 merge side effects。

### 跨仓候选门

RunLogos 只能针对本机全局安装的 OpenLogos 0.14.0，通过公开 JSON 契约推进候选事务。flow 在调用前冻结 command path、CLI version、schema hash 与 contract hash；任一漂移立即停止，不得改走源码 checkout 或旧协议。真实候选 completed receipt 是跨仓 E2E 的成功证据。

### 兼容优先级

本节覆盖本文档中任何把“manifest 在场”“Agent done”“目标逐文件已写”或“SPEC_MERGED 单独存在”视为 merge 节点完成的旧派生规则。
