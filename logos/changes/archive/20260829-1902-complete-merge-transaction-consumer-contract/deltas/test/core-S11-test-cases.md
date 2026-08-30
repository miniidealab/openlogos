## ADDED — S11 完整公共事务只读投影测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S11-71 | slot descriptors 只读投影 | collecting/ready 的 status 原样返回完整 `content_slots.items[]`，重复读取不创建或刷新 staging 文件 |
| UT-S11-72 | completed 完整投影 | status 同时返回 receipt payload final hashes 与外层 artifact hashes，交叉校验后精确覆盖 commit_paths |
| UT-S11-73 | aborted 稳定投影 | failed/aborted 的 `aborted_at` 稳定、receipt=null、动作清空，重复读取不触发清理或恢复 |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S11-42 | 跨进程只读重放 | 对 collecting、completed、aborted fixture 两次运行真实 status，公共 transaction 投影 canonical bytes 相同且项目树 hash 不变 |

### Runner、Reporter 与追溯

- UT/ST 都比较调用前后全项目文件集合与逐文件 SHA-256；ST 使用新进程和打包 Schema 校验响应。
- 每个 ID 必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`，evidence 至少含前后树 hash、投影摘要 hash 与 phase。
- slot：UT-S11-71；completed：UT-S11-72；aborted：UT-S11-73；跨进程只读：ST-S11-42。
