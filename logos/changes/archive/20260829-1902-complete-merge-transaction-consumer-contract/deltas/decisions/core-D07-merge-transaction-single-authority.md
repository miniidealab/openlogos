## ADDED — 消费者合同完整性补充（2026-08-29）

### 状态

accepted，补充并约束 D07；不创建第二个事务决策编号。

### 背景

安装态 0.14.0 已能创建、seal、apply 和恢复 merge transaction，但公共投影尚不足以让 RunLogos 在不读取内部文件的情况下生产内容、执行精确 Git 提交并处理所有公开动作。

### 决策

1. OpenLogos 签发每个 Agent slot 的稳定 identity、项目根相对 staging path、编码、大小上限和原子写协议；`submit-content` 只接受该 slot 声明的 staging path。
2. completed receipt 以无环模型公开提交闭包：payload `final_hashes` 与外层 receipt/marker `artifact_hashes` 互斥，二者路径并集精确等于 `commit_paths`。
3. `receipt_sha256` 是排除自身字段后的 canonical receipt payload identity，不是 receipt 文件自身 SHA-256。
4. `abort` 只允许于 collecting/ready/sealed；成功后为 `failed/aborted` 终态、动作清空、receipt 为 null，重复调用幂等。
5. 旧 `SMOKE-core-150` 归旧 slug；新合同 smoke 使用 `SMOKE-core-151+`，两个 worktree/guard/marker 不混用。

### 理由

只有 OpenLogos 能同时证明 target、slot、正式字节、marker 与 receipt 的一致性。让 RunLogos读取内部文件或自行推导 staging/commit 集，会重新产生第二权威。

### 备选方案

- RunLogos 读取内部 `MERGE_RECEIPT.json`：拒绝，未冻结且无法覆盖全部提交制品。
- RunLogos 自建临时目录和 commit 白名单：拒绝，破坏单一权威。
- 从 action 枚举移除 abort：拒绝，无法提供明确取消和私有制品清理能力。

### 影响面与来源

影响 S05/S09/S11/S16/S19/S39、双语 merge-executor Skill、公共 schema、部署与跨仓 smoke。来源为 RunLogos 消费者接入审查与用户批准的 OpenLogos follow-up。
