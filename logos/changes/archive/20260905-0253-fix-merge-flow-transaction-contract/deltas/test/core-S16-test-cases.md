## ADDED — merge 事务投影必挂与错误 envelope 验收测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S16-38 | 投影必挂升格 | 活跃事务在场时 status/next 的 data.merge_transaction 必在场；无事务时字段省略；契约版本条件位与既有规则一致 |
| UT-S16-39 | 投影同快照一致 | status/next 的投影与 merge transaction status 在同一仓库快照下逐字段一致；next 不覆盖 allowed_actions/next_action |
| UT-S16-40 | 失败路径结构化错误码枚举 | 枚举 status/next 既有失败路径（flow 配置错误、baseline 读锁、guard/提案状态损坏等）逐一断言 stderr error envelope 携带稳定 error.code，无一路径纯文本退化 |
| UT-S16-41 | 瞬态码集合稳定 | 瞬态类错误码集合（含 baseline_commit_in_progress）与合同版本绑定；集合快照回归，增删未走合同版本即红 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S16-12 | 宿主分流只读投影全链 | 真实命令链下宿主视角仅消费 status/next 投影完成「待开事务→collecting→ready→sealed→completed」分流，全程无需 stat 事务文件 |
| ST-S16-13 | 存量失配事务机器消费 | 失配 fixture：status 只读投影可读、写动作稳定码拒绝、默认文本输出含 `Error [<code>]` 前缀、JSON 输出 details 含双方摘要与 remediation |

### 自动化与证据要求

- 错误路径枚举用例维护「失败路径 → 期望 error.code」注册表，新增失败路径必须登记，防单路径退化。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S16"`；失败不得写 pass。
