## ADDED — 2.60 merge 流程契约自洽：前沿事务事实、后置条件二分与机器消费验收

### 2.60.1 功能目标

消除 0.14.x「merge 已是事务语义、flow 前沿仍认 0.13.x marker」的自洽缺口（生产死区）：`openlogos merge` 开事务后 CLI 自身的 `proposal_step` / `next_node` 立即如实推进；merge 成功后置条件、事务投影挂载、存量事务兼容边界与 status/next 错误码全部成文为机器可消费契约。不改 `proposal_step` 闭合枚举、step 序列与合并事务 seal/apply/receipt 的任何既有判据。

### 2.60.2 前沿推进事实（方案 A，authority cutover）

- `generate-merge-prompt.done_when = any_present:[MERGE_TRANSACTION.json, MERGE_PROMPT_GENERATED, MERGE_PROMPT.md]`；`artifacts_hint = ["MERGE_TRANSACTION.json", "MERGE_PROMPT.md", "MERGE_PROMPT_GENERATED"]`。
- 「事务在盘」是生产路径唯一权威 done 事实；两个 MERGE_PROMPT marker 自本案起为 **legacy 兼容影子**（仅 `legacyMergeTestMode` 测试模式产生），生产路径永不写入。
- `flow-derive` 的 step 推导与 `launched.yaml` `done_when` 为同一判据的两处声明（前沿判据单源），由回归测试断言两处一致；任一处单改视为缺陷。
- 推进语义：事务在盘（任意非归档相位，含 failed——终态由 merge 重跑走归档让位重建）即 `proposal_step: merge-generated`、`next_node: apply-merge`（skill: merge-executor）；`SPEC_MERGED` 落盘后按既有规则越过 merge 段。

### 2.60.3 merge 成功后置条件（二分，跨仓合同）

| 情形 | exit 0 的后置条件 | 前沿 |
|---|---|---|
| no-delta 提案 | 当场写 `SPEC_MERGED`（既有行为） | 即进 spec-complete |
| 有 delta 提案 | `MERGE_TRANSACTION.json` 创建 / 幂等返回既有非终态事务 / 终态归档让位后重建 | 推进 `merge-generated`，等 apply 写 `SPEC_MERGED` |

- 宿主判「本跳成功」的充分条件：exit 0 + 事务在盘且 `phase` 为合法枚举值。「前沿停在 apply 前」是合法中间态，不是失败。
- merge 对非终态事务幂等返回（0.14.17 §2.58.1 既有语义，此处显式引用为合同一部分）。
- merge 收尾提示改为事务引导（见 CLI 体验 §2.41），不再指向 MERGE_PROMPT.md。

### 2.60.4 status / next 投影必挂

- 活跃提案目录存在 `MERGE_TRANSACTION.json` 时，`status --format json` 与 `next --format json` 的 `data.merge_transaction` **必须**挂载（由既有「可挂载」升格）；不存在时省略字段。
- 投影与 `merge transaction status` 同快照逐字段一致；`next` 不得覆盖 `allowed_actions` / 改写 `next_action`（既有约束不变）。
- 宿主分流「待开事务 / 事务进行中 / 可 seal / 可 apply」只消费该投影，禁止自行 stat 事务文件（forbidden fallback）。

### 2.60.5 存量事务兼容边界（fail-closed，不迁移）

- CLI 读取到 contract/schema 摘要（或 schema id）与当前 CLI 不一致的存量事务时，一律 fail-closed 拒绝动作（status 只读投影可展示已知字段）。
- 错误走标准 error envelope，classification 稳定（纳入既有闭合枚举的 `unsupported_contract` 族或同级稳定码）；`error.details` 必须含双方（事务内记录 vs 当前 CLI）的版本与摘要、以及标准 remediation：`openlogos merge transaction abort` 后重跑 `openlogos merge` 重开事务。
- **永不承诺就地迁移**；宿主按 fail-closed + 重开消费。

### 2.60.6 status / next 错误 envelope 验收

- `status` / `next` 的**所有**失败路径必须输出结构化 `error.code`（`--format json` 下 stderr error envelope；默认文本下携带稳定码前缀），不得退化为纯文本 stderr。
- 瞬态类错误码集合（如 `baseline_commit_in_progress`）稳定；集合变更走 CLI JSON 合同版本。
- 回归用例枚举既有失败路径逐一断言结构化码在场，防单路径退化。

### 2.60.7 兼容与回归

- `proposal_step` 闭合枚举、step 注册表、禁止抢占前沿规则、merge 事务 seal/apply/preflight/receipt/终态出路判据一字不改。
- legacy 测试模式（`NODE_ENV=test` + 内部开关）继续写 MERGE_PROMPT marker 且被 done_when 兼容接受，0.13.x 合同回归不破。
- 既有 golden/结构化回归锁定 status/next 输出结构；投影升格仅影响「活跃事务在场」分支。
