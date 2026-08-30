## ADDED — 2.44.8 公共消费者合同完成补充

### 功能目标与价值

让 Agent 和 RunLogos 只消费一个自足的 merge transaction 投影，删除“知道 OpenLogos 内部目录才能工作”的隐性前提。

### Content slot descriptor

`content_slots.items[]` 按 `slot_id` 稳定排序，每项包含：

- `slot_id`、opaque `target_ref`；
- 项目根相对 `staging_path`，固定在当前 slug 的隔离写域；
- `required`、`content_encoding=utf8-raw`、`max_bytes`；
- `write_protocol=atomic-rename` 与当前 `submitted_sha256|null`。

Agent 仅能在 staging path 的同目录临时文件写完后原子 rename；RunLogos 等 WorkUnit quiescent 后调用 `submit-content`。CLI 必须验证 file 参数与声明路径字节等价，不能接受任意宿主临时文件。

### 无环 receipt

`payload_paths = changed_paths ∪ created_paths`；receipt 内 `final_hashes` 与 payload_paths 一一对应。`commit_paths` 在 payload_paths 基础上加入公共 `MERGE_RECEIPT.json` 与 `SPEC_MERGED`。receipt 不保存自身或 marker 文件 hash；completed projection 外层 `artifact_hashes` 计算并冻结这两个协议制品的文件 SHA-256。

`receipt_sha256` 对排除自身字段后的 canonical receipt payload 求 hash。校验必须满足：

`paths(final_hashes) ∩ paths(artifact_hashes) = ∅`

`paths(final_hashes) ∪ paths(artifact_hashes) = commit_paths`

### Abort 体验

abort 只在 collecting、ready、sealed 可见。成功后固定为 failed/aborted，清理 content、staging、backup 和未开始 apply 的 journal，不产生正式 payload、receipt 或 marker。重复 abort 是无写入幂等重放；status 返回同一 aborted_at；recover 与其它动作拒绝。

### 验收与非目标

安装态 schema、CLI contract、双语 Skill 与 golden 必须同源。RunLogos 不读取内部文件、不重算 closure、不维护 action 转移表。本补充不改变 Plan completion 合同或 UI。
