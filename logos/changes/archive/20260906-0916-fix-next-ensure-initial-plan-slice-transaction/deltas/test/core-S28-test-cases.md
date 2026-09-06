# Delta: core-S28-test-cases.md（fix-next-ensure-initial-plan-slice-transaction）

## ADDED — S28 initial-plan 问即建测试

### 单元测试

| ID | 描述 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|
| UT-S28-50 | 首达 plan-slices 问即建创建 + 投影 | 活跃提案 spec-complete（`SPEC_MERGED` 在场）、`[code]` 标题在场且切片未填、无事务文件 | `next --format json` | 模块项建议节点为 `plan-slices` 且携带 `slice_transaction` 投影（`origin="initial-plan"`、`phase="collecting"`、`content_slots.required=2`、`missing_slot_ids` 含两 slot）；`TEST_SLICE_TRANSACTION.json` 落盘；`transaction_id` 为 `stx_` 前缀 |
| UT-S28-51 | 幂等重入与既有事务只读 | 参数化：① UT-S28-50 后重跑；② 事务已 `collecting` 且已提交 1 slot；③ 事务已 `completed`（切片已规划待 slice-exit） | 各自执行 `next --format json` | ① `transaction_id` 与首达一致、不重复创建；② 投影反映真实 phase 与 `content_slots.submitted=1`；③ 投影 `phase="completed"` 且事务**不被归档、不重建**——三态下投影均与 `slice transaction status` 同源一致 |
| UT-S28-52 | 失败如实与非触发场景不创建 | 参数化：① 事务创建失败（提案目录只读等 IO 注入）；② `proposal_step` 为 delta-writing / coding；③ 无 `[code]` 标题的纯 docs 提案；④ 无活跃提案 | 各自执行 `next --format json` | ① 输出**省略** `slice_transaction` 字段、detail 携错误信息、无半写事务文件；②③④ 一律不创建事务、不输出该字段，输出与 0.14.22 逐项一致 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S28-16 | 问即建端到端：next 投影 → submit-content 续用 | 真实命令链：构造 spec-complete 提案 → `next --format json` 拿到投影（事务 X 落盘）→ `slice transaction submit-content` 提交两 slot → seal → apply：全程只有事务 X（`transaction_id` 不变、无第二事务文件）、apply 后 `[code]` 与 manifest 原子落盘；再跑 `next` 投影 `phase="completed"` |

### 追溯与覆盖

- 问即建创建与投影输出：UT-S28-50；幂等与既有事务只读：UT-S28-51；失败如实与非触发零回归：UT-S28-52；端到端续用：ST-S28-16。
- 场景：S28 initial-plan 事务的问即建与投影输出；功能规格：§2.65；根规范：`spec/cli-json-output.md`（next 输出投影口径）、`spec/test-slice-manifest.md`（创建时机合同）；安装态：SMOKE-core-194。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S28"`；失败不得写 pass。
