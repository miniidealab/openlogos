## ADDED — Merge transaction 完成、SPEC_MERGED 与归档谓词

### 权威事实

对于 0.14.0 创建或升级的新合并，`merge_completed(change)` 的唯一权威是可读取、可复算且通过 `openlogos/merge-transaction@1` 校验的 completed receipt。进程退出码、Agent 回报、外部 manifest 在场、部分目标存在或单独的 `SPEC_MERGED` 文件均不得独立证明成功。

### 生命周期绑定

变更的 merge 子生命周期映射如下：

| transaction phase | 变更管理语义 | 可推进动作 |
|---|---|---|
| `collecting` | 等待必需 content slot | `submit_content`、`abort` |
| `ready` | 内容齐备、尚未冻结 | `seal`、`abort` |
| `sealed` | 身份与内容已冻结 | `apply`、`abort` |
| `applying` | 核心 writer 正在提交或等待恢复 | `recover` |
| `completed` | receipt 已持久化并校验通过 | 进入切片规划/实现 |
| `failed` | 稳定失败分类已持久化 | `recover` 或按分类修复后重试 |

`allowed_actions` 是动作许可的唯一来源；`next_action` 只能从其中确定性选出。Driver、skill 与 UI 不得另建成功谓词或跳过 phase。

### SPEC_MERGED 绑定

`SPEC_MERGED` 是 completed receipt 的提交内投影，不是独立权威。它必须与 resources、metadata 一起由事务 writer 原子落盘，并至少绑定 `transaction_id`、`seal_sha256`、`receipt_sha256` 和完成时间。marker 缺失或不匹配时，事务不得对外投影为 completed；恢复只能根据 journal 与 sealed after hash 修复，不得手工伪造 marker。

### 归档成功谓词

归档前必须同时满足：

1. 事务 phase 为 `completed`，receipt schema/contract hash 受当前安装态支持；
2. receipt 中全部 target after hash、metadata closure 与 `SPEC_MERGED` 绑定通过复核；
3. 合并后的 `[code]` 切片只引用真实 UT/ST ID，并已完成规定的 verify；
4. 存在 `[deploy]` 时，部署与 smoke 已按独立授权门完成；
5. RunLogos 要求的跨仓候选验证已引用同一 0.14.0 安装态和 receipt。

任一条件不满足时 archive 必须 fail-closed，并返回稳定 classification 与恢复动作；不得因工作目录看似已含目标文件而放行。

### 历史兼容

0.14.0 可只读展示旧 `MERGE_APPLY_MANIFEST.json` 或旧 marker 的诊断信息，但新合并不得写入、补全或消费该协议。旧描述若与本节冲突，以本节为准。
