## ADDED — S11 合并事务只读状态测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S11-63 | collecting 快照 | identity、slot summary、waiting/retryable 与 actions 字段同源 |
| UT-S11-64 | sealed 快照 | sealed hash 冻结，allowed_actions 仅 status/apply |
| UT-S11-65 | applying 快照 | 显示恢复阶段且不伪造 completed receipt |
| UT-S11-66 | completed 快照 | receipt/commit_paths/final hashes 稳定且重复读取不刷新时间 |
| UT-S11-67 | failed 快照 | fatal code/stage/field_path 保留，failed 为终态 |
| UT-S11-68 | status 零副作用 | 调用前后 transaction 外项目树与 marker 集合 hash 不变 |
| UT-S11-69 | 可恢复 journal | status 先收敛 journal，只输出全旧或全新一致视图 |
| UT-S11-70 | 不可恢复 journal | 返回操作错误/fatal，不降级为正常 proposal_step |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S11-38 | 多 phase 轮询 | 真实 CLI 连续轮询只随底层事实变化，未写任何 marker |
| ST-S11-39 | apply 中断后 status | 重启恢复后状态与正式目标树一致，不暴露半新计数 |
| ST-S11-40 | completed response lost | 新进程读取同 receipt，不依赖 Git/宿主 ledger 重建 |
| ST-S11-41 | status/next 对账 | 两命令 transaction identity/phase/classification/actions 完全一致 |

### Runner 与 Reporter

- UT 通过 filesystem snapshot fixture 断言只读性与 journal 恢复分支。
- ST 调用真实 `openlogos status --format json` 与 `next --format json`，响应必须通过打包 schema。
- 每个 ID 写入 OpenLogos reporter；只读断言的 evidence 至少包含调用前后树 hash 与 marker 集合 hash。
