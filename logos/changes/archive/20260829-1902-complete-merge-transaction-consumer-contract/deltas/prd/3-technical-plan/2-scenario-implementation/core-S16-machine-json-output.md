## ADDED — S16 Merge transaction 消费者 JSON 合同补充

### 成功 envelope

`data.merge_transaction` 必须包含 schema/contract hash、identity、phase、classification、allowed_actions、next_action、content_slots、receipt、artifact_hashes 与 aborted_at。数组按稳定 path/slot 顺序输出。

### 跨字段约束

- `content_slots.items[].staging_path` 为项目根相对路径，slot_id 唯一。
- 非 completed：receipt=null 且 artifact_hashes=[]。
- completed：classification=null、actions=[]、receipt 非空、aborted_at=null。
- failed/aborted：receipt=null、artifact_hashes=[]、actions=[]、next_action=null、aborted_at 非空。
- receipt 的 final_hash path 与 changed/created path 集相等。
- final_hash path 与 artifact_hash path 互斥，并集与 commit_paths 相等。
- receipt_sha256 是 canonical payload identity；artifact_hashes 中 receipt 路径的 sha256 才是文件 hash。

结构、类型、枚举和可表达的阶段约束由三份 JSON Schema 校验；路径集合相等/互斥、稳定排序、计数守恒、receipt canonical identity 与完整 phase-action 映射由 `openlogos/merge-transaction-semantic@1` 校验。CLI 在输出成功 envelope 前执行两层自校验；RunLogos 在执行 action 或 Git 提交前再次执行两层校验。

### 动作与错误

命令面闭合为 `status|submit-content|seal|apply|recover|abort`。错误 envelope 保留 transaction_id、phase、classification、allowed_actions、next_action 与 retryable。未知 schema/hash/action/classification 不能按消息文本兼容。
