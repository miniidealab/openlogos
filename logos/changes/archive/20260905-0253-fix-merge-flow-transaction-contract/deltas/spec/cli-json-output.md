## MODIFIED — status/next 挂载

`openlogos status --format json` 与 `openlogos next --format json` 在既有 envelope 的 `data.merge_transaction` 挂载同一只读投影，规则如下（fix-merge-flow-transaction-contract 升格）：

- **必挂**：活跃提案目录存在 `MERGE_TRANSACTION.json` 时，`data.merge_transaction` **必须**在场；不存在合并事务时省略该字段。
- 二者必须与 transaction status 在同一仓库快照下逐字段一致；`next` 不得覆盖事务的 `allowed_actions` 或自行改写 `next_action`。
- 宿主分流「待开事务 / 事务进行中 / 可 seal / 可 apply / 终态」只消费该投影；自行 stat 事务文件推导状态是 forbidden fallback。

## ADDED — merge 成功后置条件与前沿推进契约（fix-merge-flow-transaction-contract）

### 后置条件二分（跨仓合同）

`openlogos merge <slug>` exit 0 的后置条件按情形二分：

| 情形 | 后置条件 | flow 前沿 |
|---|---|---|
| no-delta 提案 | 当场写 `SPEC_MERGED` | 前沿即进 spec-complete |
| 有 delta 提案 | `MERGE_TRANSACTION.json` 创建 / 幂等返回既有非终态事务 / 终态归档让位后重建 | `proposal_step` 推进 `merge-generated`、`next_node` 为 `apply-merge`；`SPEC_MERGED` 由事务 apply 写入 |

- 宿主判「本跳成功」的充分条件：**exit 0 + 事务在盘且 `phase` 为合法枚举值**。「前沿停在 apply 前」是合法中间态，不是失败。
- merge 对非终态事务幂等（重跑 = 返回现状，不重复创建）；终态按 §2.58.1 归档让位重建。
- 前沿推进的权威事实与 `spec/flow/launched.yaml` `done_when`、flow-derive step 推导同源（见 `spec/flow-spec.md` 与架构「四十七」）。

### 存量事务合同兼容边界（fail-closed，不迁移）

- CLI 读取到 contract/schema 摘要（或 schema id）与当前 CLI 不一致的存量事务时，一律 **fail-closed 拒绝写动作**；`status` 只读投影可展示已知字段。
- 错误走标准 error envelope，classification 使用稳定码（`unsupported_contract` 族或同级新增稳定码，纳入闭合枚举）；`error.details` 必须包含：事务内记录的版本与 schema/contract 摘要、当前 CLI 的版本与摘要、`retryable:false`、标准 remediation——`openlogos merge transaction abort` 后重跑 `openlogos merge <slug>` 重开事务。
- **不承诺就地迁移**；宿主按 fail-closed + 重开消费。

### status/next 错误 envelope 验收（防退化）

- `openlogos status` / `openlogos next` 的**所有**失败路径必须输出结构化 `error.code`：`--format json` 下 stderr error envelope；默认文本下携带稳定码（`Error [<code>]: <message>` 或等价形式）。任何失败路径退化为无码纯文本 stderr 视为合同回归。
- 瞬态类错误码集合（供宿主有界恢复，如 `baseline_commit_in_progress`）保持稳定；集合增删走 CLI JSON 合同版本。
- 回归用例必须枚举既有失败路径（flow 配置错误、baseline 读锁、guard/提案状态损坏等）逐一断言结构化码在场。
