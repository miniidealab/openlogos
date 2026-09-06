# Delta: cli-json-output.md（fix-next-ensure-initial-plan-slice-transaction）

## ADDED — next 输出的 slice_transaction 投影（initial-plan 问即建）

### 出现条件

`next` / `next --format json` 的模块项（及单模块顶层等价形态）在满足全部条件时**必须**携带 `slice_transaction` 字段：

1. `proposal_step == "ready-to-implement"`（建议节点为 `plan-slices`，含 `[code]` 已脱模板待 slice-exit 的驻留态）；
2. 需要代码（`[code]` 标题在场）；
3. 提案未归档、提案目录存在；
4. 无 manifest 失效态（失效态走既有 manifest-recovery 分支，该分支的 `slice_transaction` 输出口径不变）。

### 字段口径

- 投影 schema 与字段表**沿用** `openlogos/test-slice-transaction@1` 公共合同的「投影字段」节，逐字段一致——本节仅扩大该投影在 `next` 输出中的出现场景（此前仅 manifest-recovery 分支），**不新增第二事实源、不另发明字段**。
- 首达（`next` 问即建刚创建）时投影形态：`origin="initial-plan"`、`phase="collecting"`、`content_slots.required=2`、`missing_slot_ids=["slot_codesection","slot_slices"]`。
- 已有事务（任意 phase，含 `completed` / `failed`）时投影反映其真实状态；`next` 只读输出，不重建、不归档。

### 失败与幂等口径

- 事务创建失败：模块项**省略** `slice_transaction` 字段，`detail` 携带错误信息；消费方按「投影缺失」结构化 fail-closed，不得按建议节点自行恢复。
- 幂等：同一状态重复调用投影 `transaction_id` 不变；`next` 除事务文件外不产生任何其它写副作用。

### 兼容

既有字段、exit code 与 envelope 不改名；非出现条件场景（其它 `proposal_step`、无 `[code]` 标题、无活跃提案、initial 生命周期）不输出该字段，行为与 0.14.22 逐项一致。消费方按字段存在性消费，旧消费方忽略新增字段零影响。
