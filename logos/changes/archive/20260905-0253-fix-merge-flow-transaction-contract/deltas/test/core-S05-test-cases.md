## ADDED — merge 事务相位下的 next 引导测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S05-52 | 开事务后前沿立即推进 | merge exit 0（有 delta）后 next 的 proposal_step=merge-generated、next_node.id=apply-merge，不再滞留 generate-merge-prompt |
| UT-S05-53 | 各相位引导与事务 next_action 一致 | collecting→submit-content、ready→seal、sealed→apply、completed→SPEC_MERGED 已写；next 不改写事务 allowed_actions/next_action |
| UT-S05-54 | 投影必挂透传 | 活跃事务在场时 next 的 data.merge_transaction 在场且与 merge transaction status 同快照逐字段一致 |
| UT-S05-55 | failed 相位不冻结前沿 | 事务 failed（aborted/fatal）时前沿仍 merge-generated，引导按 classification 给 abort/recover 指引 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S05-24 | 全链前沿推进 | 临时 launched 提案：merge 开事务 → next 即 apply-merge → submit/seal/apply → SPEC_MERGED → next 前沿越过 merge 段 |
| ST-S05-25 | 幂等重跑不回退 | 非终态事务在场重跑 merge：幂等返回、前沿不回退、无第二事务 |

### 自动化与证据要求

- ST 经真实 `openlogos merge` / `merge transaction` 公开命令驱动，保存各步 status/next JSON 证据。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S05"`；失败不得写 pass。
