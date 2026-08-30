## ADDED — S39 无环提交闭包补充

### 闭包集合

- `payload_paths = changed_paths ∪ created_paths`。
- `paths(final_hashes) = payload_paths`。
- `protocol_artifact_paths = {change/MERGE_RECEIPT.json, change/SPEC_MERGED}`。
- `paths(artifact_hashes) = protocol_artifact_paths`。
- `commit_paths = payload_paths ∪ protocol_artifact_paths`。
- final_hashes 与 artifact_hashes 路径不重叠，所有集合去重并按项目根相对路径稳定排序。

### Hash 计算顺序

先完成并验证全部 payload，再构造不含自身字段的 canonical receipt payload 与 receipt_sha256；随后写 receipt 和 SPEC_MERGED；最后由 completed projector 计算二者文件 hash。任何阶段不得把某文件 SHA-256 嵌入该文件自身。

### 私有制品

content、Agent staging、同目录临时文件、backup、apply journal 与 MERGE_TRANSACTION 私有状态不进入 commit_paths。completed/aborted 后按各自终态清理；recovery_required 时保留恢复所需制品但不得宣称可提交。

### 失败策略

集合不相等、路径逃逸、重复路径、hash 不匹配或 artifact 缺失均阻断 completed；不能通过扫描 Git 或正式目标补齐缺项。
