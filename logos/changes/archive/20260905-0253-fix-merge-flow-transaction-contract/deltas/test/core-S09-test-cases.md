## ADDED — merge 前沿事务判据与后置条件二分测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-303 | flow-derive 事务判据 | 事务文件在盘（任意相位）→ step 推导 merge-generated；文件不在且无 marker → 停 ready-to-merge |
| UT-S09-304 | 判据两处同源 | launched.yaml done_when 声明与 flow-derive 推导对同一 fixture 集逐一同判（回归钉一致，单改任一处即红） |
| UT-S09-305 | legacy marker 兼容 | 仅 MERGE_PROMPT_GENERATED / MERGE_PROMPT.md 在场（legacy 测试模式）同样推进 merge-generated，0.13.x 合同不破 |
| UT-S09-306 | 后置条件二分 | no-delta：merge 后 SPEC_MERGED 在场、前沿即进；有 delta：merge 后事务在盘、SPEC_MERGED 不在场、前沿 merge-generated |
| UT-S09-307 | 收尾提示事务引导 | merge（有 delta）stdout 含 submit-content/seal/apply 引导、不含「MERGE_PROMPT.md」字样；幂等/重建情形提示体现现状 |
| UT-S09-308 | 存量事务失配 fail-closed | contract/schema 摘要失配 fixture：写动作拒绝、classification 稳定、details 含双方版本与摘要 + remediation（abort 后重开）、retryable:false |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-116 | 生产链路无死区全链 | 真实命令链 merge→（status 即 merge-generated）→submit→seal→apply→SPEC_MERGED→status 越过 merge 段；各步 proposal_step 与磁盘事实一致 |
| ST-S09-117 | 终态出路与前沿协同 | abort 后重跑 merge 归档让位重建：新事务在盘、前沿仍 merge-generated、不死锁；手删事务文件（越权）→ 前沿回退 ready-to-merge |

### 自动化与证据要求

- 判据一致性用例（UT-S09-304）必须同时驱动 flow 规格解析与 flow-derive 两条路径，禁止只测其一。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
