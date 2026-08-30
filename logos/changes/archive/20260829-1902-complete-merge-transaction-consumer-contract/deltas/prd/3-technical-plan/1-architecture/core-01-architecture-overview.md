## ADDED — Merge transaction 消费者合同完成架构

### 边界与所有权

- MergeTransactionPlanner：生成 target/slot identity 和唯一 staging 写域。
- ContentSlotGateway：验证声明路径、原子文件、编码、大小与 hash，提交为内部不可变 content。
- MergeTransactionService：唯一维护 phase、classification、allowed actions、abort 与 recover。
- ReceiptBuilder：生产无自引用 payload receipt。
- ArtifactProjector：在 receipt 外层计算 receipt/marker 文件 hash。
- RunLogos/Agent：只消费公共投影；不得读取内部 content、backup、journal 或正式 target 推导状态。

### 数据流与控制流

Agent 写声明 staging path → RunLogos 等待 WorkUnit quiescent → CLI submit-content 校验并接收 → seal 冻结输入 → apply 原子提交 payload/receipt/marker → ArtifactProjector 计算外层 hashes → completed projection 返回精确 commit_paths。

abort 只在 apply 前进入 failed/aborted，并清理全部私有制品；apply 已开始只能 recover，不能 abort。

### 不变量

1. 一个 slot 只有一个声明 staging path，file 参数必须与之相同。
2. `final_hashes` 仅覆盖 payload；`artifact_hashes` 仅覆盖 receipt/marker；并集精确等于 commit_paths。
3. receipt_sha256 不包含自身字段，任何层都不把自身文件 hash 写入自身。
4. public action 集中的每个 action 都有唯一 CLI 子命令。
5. status/next 不产生写入，不从 Git 或正式目标反推新的完成事实。

### 失败与回滚

路径、symlink、字节、schema、hash 或集合不变量失败时零正式副作用。abort 清理私有制品；apply 故障按 journal 前滚/回滚。无法证明全旧或全新时保持 recovery_required，绝不降级为 completed。

### 实现映射

主要落点为 `cli/src/lib/merge-transaction.ts`、`cli/src/commands/merge-transaction.ts`、公共 schema、status/next projector、安装态 smoke runner 与 reporter。
