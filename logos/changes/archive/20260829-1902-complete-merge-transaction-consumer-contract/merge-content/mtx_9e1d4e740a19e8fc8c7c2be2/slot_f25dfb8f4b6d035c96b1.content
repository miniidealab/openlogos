## D07：合并事务单一权威与跨仓边界

### 状态

已接受（Accepted）。本决策随 `refresh-merge-transaction-cross-repo-plan` 合并后生效，目标发布版本为 OpenLogos 0.14.0。

### 背景

旧合并链把目标身份冻结、内容合成、Base64 搬运、正式目标写入、metadata 更新和完成标记拆给 Driver、Agent 与多个命令。`MERGE_APPLY_MANIFEST.json` 因而同时承担工作单、内容容器和写入授权，产生多 writer、双重 hash 权威、部分落盘、崩溃后状态歧义以及 OpenLogos 与 RunLogos 各自判断“完成”的问题。

### 决策

1. OpenLogos 核心 `merge transaction` 是合并状态、动作授权、目标身份、最终内容、原子写入、恢复和完成 receipt 的唯一权威；Driver 只能调用事务动作和读取投影。
2. 事务按 `collecting → ready → sealed → applying → completed | failed` 推进。只有 `allowed_actions` 中出现的动作才可执行；`next_action` 必须是该集合的唯一确定性选择或 `null`。
3. Agent 只可向事务声明的 `content_slots` 提交最终字节，不得创建或填写外部 apply manifest，不得直接修改 canonical target、metadata、`SPEC_MERGED` 或 receipt。
4. `seal` 冻结 canonical target set、before/source/content hash、模式和 contract hash；`apply` 由同一事务 writer 原子提交 resources、OpenLogos-produced metadata、dogfood 镜像和完成 marker。
5. `completed` 仅由持久化且可校验的 receipt 证明。receipt 必须绑定 transaction id、seal hash、目标集合、提交后 hash、metadata closure 与 schema/contract 版本。
6. no-delta 也必须走事务：其目标集合为空，但仍需 seal、apply 和 completed receipt；空集合不得成为绕过事务的成功捷径。
7. `status`、`next` 与 `--format json` 只读取同一事务投影，不得自行派生第二套 phase 或成功谓词。

### 理由

合并的正确性依赖目标身份、最终字节、metadata 闭包与完成证据属于同一个提交边界。把这些事实分散给多个 writer，即使为每层增加 hash，也无法让崩溃恢复判断“谁的状态才是真的”。由 OpenLogos 核心持有唯一事务与原子 writer，才能把 RunLogos 限定为协议消费者、把 Agent 限定为内容生产者，并让所有成功与恢复路径共享一个可验证 receipt。

### 备选

- **保留 `MERGE_APPLY_MANIFEST.json` 并补更多 hash**：否决。它保留了两个可写权威，无法消除竞态与恢复歧义。
- **让 Driver 直接写 canonical targets**：否决。跨仓调度器不拥有 OpenLogos 仓库内原子提交与 metadata 闭包。
- **逐文件成功、最后补 marker**：否决。中途失败会暴露部分正式态，且 marker 无法证明所有目标属于同一事务。
- **仅靠进程内锁**：否决。无法覆盖进程崩溃、重启、跨仓重试与幂等恢复。

### 跨仓约束

RunLogos 只能使用随 OpenLogos 0.14.0 安装包发布的 transaction schema/contract，通过公开 CLI 动作驱动候选事务，并以 completed receipt 判定成功；不得解析工作区内部临时文件，不得生成兼容 manifest，不得直接写 OpenLogos canonical targets。跨仓 E2E 必须使用本机全局安装的 0.14.0，而不是源码 checkout 的隐式入口。

### 影响

- 需要新增事务存储、状态机、原子 writer、receipt 与恢复实现。
- 旧 manifest 路径在 0.14.0 的新事务中 fail-closed；历史已完成记录只读兼容，不可重新作为写入输入。
- 合并后切片、verify、archive 只能消费 completed receipt 和真实测试 ID。
- 0.14.0 需以 tarball 部署到本机全局环境，并由 RunLogos 真实候选流程验证。

### 验收锚

对应 S05、S09、S11、S16、S19、S39；由这些场景 Delta 引用的 UT/ST，以及 `SMOKE-core-141` 至 `SMOKE-core-150` 共同验收。

## 消费者合同完整性补充（2026-08-29）


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
