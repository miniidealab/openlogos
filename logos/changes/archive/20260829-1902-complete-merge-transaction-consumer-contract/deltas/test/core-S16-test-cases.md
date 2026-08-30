## ADDED — S16 完整 merge-transaction@1 Schema 与 golden 测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S16-28 | content_slots.items Schema | slot descriptor 必填字段、`utf8-raw`、`atomic-rename`、max_bytes 与 nullable submitted hash 的正反例均被正确校验 |
| UT-S16-29 | completed receipt 双层校验 | JSON Schema 校验完整 receipt、artifact hashes 与双合同 hash；canonical semantic validator 拒绝 final/artifact path 重叠、缺失、额外或并集不等于 commit_paths |
| UT-S16-30 | aborted/fatal 跨字段约束 | Schema 与 semantic validator 共同保证 aborted 只能是 failed/aborted 且动作空；recovery_required 只允许 recover；普通 fatal failed 不允许 abort 或其它自动动作 |
| UT-S16-31 | action-command parity golden | 五个已知 action 与五个 CLI 子命令一一对应，help、next/status JSON 与消费者命令表一致 |
| UT-S16-32 | 未知合同 fail-closed | 未知 action、classification、hash 格式、schema/contract hash 或附加字段均不能通过生产者自校验/消费者校验 |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S16-09 | 安装态 golden/schema 联动 | 解包 candidate 后真实运行 status/next/abort 与 completed 流程，输出通过随包三份 Schema，schema/contract hash 与源码冻结值一致 |

### Runner、Reporter 与追溯

- UT 同时使用 Draft 2020-12 validator 与 `openlogos/merge-transaction-semantic@1`、固定正反例及 canonical golden；ST 使用 tarball 内 CLI/Schema/semantic validator，不得引用源码树资产。
- 每个 ID 必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`，evidence 记录 schema version、schema/contract hash 与响应摘要 hash。
- slot：UT-S16-28；completed/aborted：UT-S16-29～30；动作与未知值：UT-S16-31～32；安装态：ST-S16-09。
