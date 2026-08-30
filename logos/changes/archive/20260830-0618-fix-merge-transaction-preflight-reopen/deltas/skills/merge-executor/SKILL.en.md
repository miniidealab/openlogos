## ADDED — Merge Transaction Preflight/Reopen 执行规则（0.14.2）

### 适用边界

本节覆盖新事务seal preflight和首写前legacy sealed事务的可修复reopen。公共phase/action/classification/JSON字段不变；执行者不得自行发明reopen命令或编辑transaction私有文件。

### Seal 前行为

1. 全部required slots提交后只调用core `seal`，不得把ready视为已合并。
2. seal可能因after表、test-change-set或其它确定性派生校验退回collecting。
3. 收到`slot_identity_mismatch + retryable=true`后，立即读取status/next；以`content_slots.missing_slot_ids`为唯一重提列表。
4. 只重建missing slots的最终完整字节，写各自声明`staging_path`并原子rename，再逐一submit。
5. 未受影响slot保持submitted，不重新生成、不重新submit。

### Legacy Sealed Apply

0.14.1 sealed transaction由0.14.2 apply首写前preflight。若通过，沿用legacy seal继续；若可归因失败，core先持久化collecting再返回retryable。执行者不得因phase曾为sealed而直接覆盖slot，也不得abort后重建整单。

### 错误分支

- retryable collecting：按missing slots修复并重新seal。
- fatal/unattributable/OpenLogos producer/plan或hash drift：停止并报告，不清slot、不猜测message中的path。
- applying/journal/recovery：只按`allowed_actions`执行recover；禁止reopen。
- completed：验证receipt/marker并按`commit_paths`精确提交，不扫描私有目录。

### 授权边界

plan批准不授权merge、verify、部署、smoke、archive、push或跨仓恢复。只有当前用户的明确指令或有效`--auto`standing授权可以消费对应门；Skill文字本身不是授权。

### 报告

每次重提报告transaction ID、missing/submitted slot IDs及hash；不得泄露私有content。成功只能由completed receipt证明。
