## ADDED — S16 merge-transaction@1 机器合同测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S16-18 | collecting schema | required identity/actions/agent_io 合法，completed receipt 不得出现 |
| UT-S16-19 | sealed schema | sealed 必须有冻结摘要且不允许内容写动作 |
| UT-S16-20 | applying schema | applying 不含伪 completed receipt，允许恢复诊断 |
| UT-S16-21 | completed schema | receipt 必填、error/classification/code 为空、commit_paths 合法 |
| UT-S16-22 | failed schema | fatal error 必填且 next_action 不得是 regenerate-content/apply |
| UT-S16-23 | 稳定排序与 hash | targets、paths、hashes、actions 输出顺序和 canonical hash 可复现 |
| UT-S16-24 | text/JSON 同源 | 同一错误的 classification/code/stage/field_path 不漂移 |
| UT-S16-25 | contract hash | 运行时 contract_hash 等于打包 schema 字节 hash/冻结 manifest |
| UT-S16-26 | unknown major | 消费方保守阻塞，不按相似字段自动执行动作 |
| UT-S16-27 | producer 自校验 | 非法 CLI data 返回非零，不输出 success=true |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S16-05 | status/seal/apply JSON 全链 | 每步输出通过 `merge-transaction.schema.json` 且 identity 连续 |
| ST-S16-06 | 错误 golden | waiting/retryable/fatal 的 JSON/text 投影与稳定 code golden 一致 |
| ST-S16-07 | 源码态与 tarball 态 | 同 fixture 的 schema/contract hash/plan identity 完全一致 |
| ST-S16-08 | next/status schema 联动 | transaction 投影通过 next/status schema且不复用 completion 字段 |

### Runner 与 Reporter

- UT 使用 JSON Schema validator 和固定 canonical/golden fixture，不依赖对象属性插入顺序。
- ST 分别运行仓库构建入口和解包 tarball 的 CLI 子进程；不得注入 mock response。
- 每个 ID 通过 OpenLogos reporter 写入 test-results，evidence 记录 schema version、contract hash 和响应摘要 hash。
