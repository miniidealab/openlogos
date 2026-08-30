## ADDED — S16 Preflight/Reopen 机器输出同源合同

### 公共兼容边界

本案不新增公共 JSON 字段、phase、action或classification。`openlogos/merge-transaction@1`、status.schema、next.schema及golden继续使用既有字段集合。

### Retryable 错误

apply/seal发现可归因内容错误时，core先持久化 collecting再输出既有错误结构：

```json
{
  "error": {
    "code": "slot_identity_mismatch",
    "message": "<可操作但非机器归因来源的说明>",
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

错误 envelope不新增 `missing_slot_ids`。消费者随后调用status/next，从既有 `data.merge_transaction.content_slots.missing_slot_ids`读取精确slot列表。内部结构化 `target_paths[]/producer` 不进入公共输出。

### Fatal 与 Recovery 输出

- 无法唯一归因、OpenLogos producer、mixed错误、contract/schema/plan/source/before/seal/path drift：`retryable=false`，transaction不清slot。
- applying或journal存在：只返回recover相关投影，不输出submit_content。
- legacy sealed pass：completed projection继续绑定legacy seal和有效receipt，不凭空暴露preflight字段。
- reopen后重seal：公共只观察新的`seal_sha256`；transaction/plan/target-set identity不变。

### 同源要求

CLI text、transaction command JSON、status JSON和next JSON必须从同一持久化projection派生。错误响应中的phase/actions与紧随其后的status/next必须一致；response-lost场景允许客户端仅凭status恢复，不读取stderr文本或私有文件。

### Schema/Golden

UT-S16-33～34与ST-S16-10验证：既有schema无字段漂移、retryable/fatal分支、status/next同源、legacy/new seal投影和错误后跨进程重放。
