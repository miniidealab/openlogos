## ADDED — S05 合并事务动作权威测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S05-35 | collecting/waiting 投影 | 缺 required slot 时 next 输出 waiting，且不返回 apply |
| UT-S05-36 | retryable validator 投影 | 内容校验失败保持 collecting，next 指向替换指定 slot 后 seal |
| UT-S05-37 | sealed 动作集合 | sealed 只允许 status/apply，next_action=apply |
| UT-S05-38 | applying 恢复投影 | applying/recovering 不被宿主 deadline 改写为 failed/completed |
| UT-S05-39 | completed 前沿 | completed receipt 有效时进入真实 spec-complete/切片前沿 |
| UT-S05-40 | failed 终态 | fatal failed 不返回 regenerate-content 或 apply |
| UT-S05-41 | status/next 同源 | 同一 snapshot 的 identity/phase/classification/actions 完全一致 |
| UT-S05-42 | completion 命名空间隔离 | `dispatch.completion` 不能被当作 transaction next_action |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S05-16 | Agent 内容未齐 | RunLogos 轮询 next 只获得等待/内容准备动作，正式目标零写入 |
| ST-S05-17 | validator 失败后修复 | 原子替换同一 slot 后 seal 成功，transaction_id 不变 |
| ST-S05-18 | sealed 到 completed | next 依次投影 apply 与 merge completed 后续前沿，不跳步 |
| ST-S05-19 | fatal/未知版本 | RunLogos 保守阻塞并保留原始 code，不由本地表兜底 |

### Runner 与 Reporter

- UT 由 Vitest 直接调用共享 MergeTransactionService/flow projection fixture。
- ST 通过真实 CLI JSON 入口执行，不 mock `next` 输出或手工写 marker。
- 每个 ID 必须向 `logos/resources/verify/test-results.jsonl` 追加 OpenLogos reporter 记录，至少包含 `id`、`status`、`timestamp`、`duration_ms` 与脱敏 evidence；重复矛盾或缺失 ID 由 verify 判失败。
