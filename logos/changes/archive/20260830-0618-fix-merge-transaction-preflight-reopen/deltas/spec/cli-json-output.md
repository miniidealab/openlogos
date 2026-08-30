## ADDED — Merge Transaction Preflight/Reopen JSON 兼容合同（0.14.2）

### 字段兼容

公共`openlogos/merge-transaction@1` projection、status/next挂载及错误envelope不新增字段。内部`preflight_sha256`、structured target paths和producer attribution不公开。

### Retryable Error

core必须先成功持久化collecting，再输出：

```json
{
  "error": {
    "code": "slot_identity_mismatch",
    "details": {
      "transaction_id": "mtx_...",
      "phase": "collecting",
      "classification": "slot_identity_mismatch",
      "allowed_actions": ["submit_content", "abort"],
      "next_action": "submit_content",
      "retryable": true
    }
  }
}
```

错误details保持既有字段集合，不增加`missing_slot_ids`。消费者以随后status/next中既有`data.merge_transaction.content_slots.missing_slot_ids`取得slot集合。

### Projection 约束

- collecting：`seal_sha256=null`、receipt=null、artifact_hashes=[]；items中rejected `submitted_sha256=null`，其它hash保留。
- ready：missing空，next_action=seal。
- sealed：new seal可与legacy seal算法不同，但均为合法SHA-256；transaction/target-set identity不变。
- applying/recovery：不得投影submit_content。
- completed：receipt seal必须等于外层当前seal；legacy pass仍绑定legacy seal。

### Error/Status/Next 同源

retryable响应中的phase/actions必须与紧随其后的status/next逐值一致。response lost时status是唯一恢复入口；私有文件和stderr message不是机器事实。fatal/unattributable错误`retryable=false`且不改变missing集合。

### Schema 与 Golden

status.schema、next.schema、merge-transaction.schema和completed golden只需证明无公共字段漂移及新状态组合仍满足既有schema。内部stored transaction可含optional preflight record，但不得被公共projection透传。
