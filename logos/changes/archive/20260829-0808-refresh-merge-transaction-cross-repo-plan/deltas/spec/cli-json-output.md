## ADDED — Merge transaction JSON 契约（0.14.0）

### 契约版本与命令

`openlogos merge transaction status|seal|apply|recover --format json` 使用公共 schema `openlogos/merge-transaction@1`。`status` 为纯读取；`seal`、`apply`、`recover` 是显式写动作。所有成功输出沿用 CLI 顶层 success envelope，`data.merge_transaction` 必须是该 schema 的有效投影。

### 稳定投影

```json
{
  "schema": "openlogos/merge-transaction@1",
  "transaction_id": "mtx_...",
  "slug": "example-change",
  "phase": "ready",
  "classification": null,
  "allowed_actions": ["seal", "abort"],
  "next_action": "seal",
  "target_set_sha256": "sha256:...",
  "seal_sha256": null,
  "content_slots": {
    "required": 2,
    "submitted": 2,
    "missing_slot_ids": []
  },
  "receipt": null
}
```

字段规则：

- `phase` 闭合枚举为 `collecting|ready|sealed|applying|completed|failed`；
- `allowed_actions` 去重并按 schema 定义的规范顺序输出；
- `next_action` 为 `allowed_actions` 中唯一推荐动作，无动作时为 `null`；
- `classification` 仅失败或可恢复异常时非空；
- `target_set_sha256` 在事务创建时冻结目标身份，`seal_sha256` 仅在 sealed 及之后非空；
- `content_slots` 只暴露计数与缺失 slot id，不回显完整内容；
- `receipt` 只在 completed 时非空，且必须包含 transaction/seal/target/closure 的可复核摘要。

### 动作输出

- `seal` 成功：phase 必须为 `sealed`，`seal_sha256` 非空，`next_action` 为 `apply`。
- `apply` 成功：phase 必须为 `completed`，`allowed_actions=[]`、`next_action=null`、`receipt` 非空。
- `recover` 成功：返回恢复后的真实 phase；若已 completed，必须返回原 receipt，不制造新 transaction id。
- `status` 不得改变任何时间戳、journal、slot、target、marker 或 receipt 字节。

### 稳定错误

事务操作失败继续使用标准 error envelope；`error.details` 必须包含 `transaction_id`（可获得时）、`phase`、`classification`、`allowed_actions`、`next_action` 和 `retryable`。classification 闭合枚举至少包含：

`invalid_phase`、`action_not_allowed`、`content_slot_missing`、`slot_identity_mismatch`、`source_hash_mismatch`、`before_hash_mismatch`、`target_set_mismatch`、`seal_mismatch`、`apply_conflict`、`receipt_mismatch`、`legacy_manifest_rejected`、`unsupported_contract`、`recovery_required`、`internal_failure`。

未知 classification 必须 fail-closed；宿主不得按错误消息文本分支。

### status/next 挂载

`openlogos status --format json` 与 `openlogos next --format json` 可在既有 envelope 的 `data.merge_transaction` 挂载同一只读投影。二者必须与 transaction status 在同一仓库快照下逐字段一致；`next` 不得覆盖事务的 `allowed_actions` 或自行改写 `next_action`。

### 安装态自描述

0.14.0 的机器输出必须同时可获得 CLI `version`、transaction schema id、schema SHA-256 与 contract SHA-256，供 RunLogos 在调用前冻结候选安装态。源码版本、包版本与全局命令版本不一致时返回 `unsupported_contract`，不得降级为旧 manifest 流程。

### 兼容优先级

本节覆盖本文档中与 `MERGE_APPLY_MANIFEST.json`、Base64 apply payload 或外部 writer 成功判定冲突的旧段落；历史字段可只读展示，但不得参与 0.14.0 新事务动作。
