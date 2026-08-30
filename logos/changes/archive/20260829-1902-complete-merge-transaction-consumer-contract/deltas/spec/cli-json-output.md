## ADDED — Merge transaction 消费者合同完成版（0.14.0）

### 命令面

`openlogos merge transaction status|submit-content|seal|apply|recover|abort --slug <slug> --format json`。所有已知 action 必须有唯一子命令；未知 action 或命令注册缺失返回 `unsupported_contract`。

### Content slots

```json
{
  "content_slots": {
    "required": 1,
    "submitted": 0,
    "missing_slot_ids": ["slot_x"],
    "items": [{
      "slot_id": "slot_x",
      "target_ref": "target_x",
      "staging_path": "logos/changes/x/merge-staging/slot_x/content",
      "required": true,
      "content_encoding": "utf8-raw",
      "max_bytes": 20971520,
      "write_protocol": "atomic-rename",
      "submitted_sha256": null
    }]
  }
}
```

items 按 slot_id 排序，不包含 canonical target 可写路径或内容。`submit-content --file` 必须与声明 staging_path 完全相同。

### Completed projection

```json
{
  "phase": "completed",
  "classification": null,
  "allowed_actions": [],
  "next_action": null,
  "receipt": {
    "transaction_id": "mtx_x",
    "plan_sha256": "sha256:...",
    "change": "x",
    "module": "core",
    "changed_paths": [],
    "created_paths": ["logos/resources/example.md"],
    "final_hashes": [{"path":"logos/resources/example.md","sha256":"sha256:..."}],
    "metadata_summaries": [],
    "test_change_set": null,
    "spec_merged": {"path":"logos/changes/x/SPEC_MERGED"},
    "commit_paths": ["logos/changes/x/MERGE_RECEIPT.json","logos/changes/x/SPEC_MERGED","logos/resources/example.md"],
    "receipt_sha256": "sha256:...",
    "completed_at": "..."
  },
  "artifact_hashes": [
    {"path":"logos/changes/x/MERGE_RECEIPT.json","sha256":"sha256:..."},
    {"path":"logos/changes/x/SPEC_MERGED","sha256":"sha256:..."}
  ],
  "aborted_at": null
}
```

`spec_merged` 在 receipt 中只保存 marker 路径与事务身份关系，不保存 marker 文件 SHA-256。`receipt_sha256` 是排除自身字段后的 canonical payload identity；marker 内容可以绑定该 identity，而 marker 文件 SHA-256 只出现在外层 `artifact_hashes`，因此不存在 receipt↔marker hash 环。

JSON Schema 校验字段、类型、枚举和可表达的阶段条件；`openlogos/merge-transaction-semantic@1` canonical semantic validator 进一步校验 path 唯一与稳定排序、final/artifact 路径互斥、二者并集精确等于 commit_paths、summary 计数、receipt identity，以及每个 phase/classification 的精确 action 映射。生产者在输出成功 envelope 前、消费者在执行动作或 Git 提交前都必须同时通过两层校验。

### Aborted projection

abort 只允许于 collecting/ready/sealed。成功与幂等重放均返回 `phase=failed`、`classification=aborted`、actions=[]、next_action=null、receipt=null、artifact_hashes=[] 与稳定 aborted_at。普通 fatal failed 不暴露 abort；recovery_required 只暴露 recover。

### 安装态冻结

成功 envelope 必须继续公开 schema_sha256 与 contract_sha256。RunLogos 在任何 WorkUnit/quota/paste/Agent/正式写入前校验全局入口、0.14.0、slug/transaction identity 和双 hash。
