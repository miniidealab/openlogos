## ADDED — S05 消费者动作与终态投影测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S05-43 | action-command parity | `submit_content/seal/apply/recover/abort` 各自只映射到 `submit-content/seal/apply/recover/abort`；未知 action 不生成命令 |
| UT-S05-44 | 普通 fatal failed | `classification=fatal` 时 `allowed_actions=[]`、`next_action=null`，不得猜测 abort/recover/apply |
| UT-S05-45 | aborted 终态投影 | `phase=failed`、`classification=aborted`、`receipt=null`、稳定 `aborted_at`，无后续事务动作 |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S05-20 | next 零推导执行 | RunLogos 只执行公共 `next_action` 对应的唯一命令；等待、fatal、aborted 与未知 action 均保守停机 |

### Runner、Reporter 与追溯

- UT 使用固定 transaction projection 与命令注册表；ST 调用真实 `openlogos next --format json`，不得从 phase 或文案猜命令。
- 每个 ID 必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`，至少包含 `id`、`status`、`timestamp`、`duration_ms` 与脱敏 evidence。
- 动作对称：UT-S05-43、ST-S05-20；终态隔离：UT-S05-44、UT-S05-45、ST-S05-20。
