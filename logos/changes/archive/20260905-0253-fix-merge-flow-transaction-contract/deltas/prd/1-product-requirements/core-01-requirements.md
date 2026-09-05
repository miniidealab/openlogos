## ADDED — merge 流程契约自洽（flow 前沿与事务事实同源）需求

### 用户价值

`openlogos merge` 在 0.14.x 生产语义下开启合并事务后，CLI 自身的 flow 前沿必须立即如实推进：用户与宿主 driver 依据 `status` / `next` 即可判断「本跳成功、下一步派 merge-executor」，不再遇到「命令成功但前沿永久冻结」的死区，也不必自行 stat 事务文件推断状态。存量不兼容事务与 status/next 失败必须给出机器可判的稳定错误码与恢复动作。

### 前沿推进要求（方案 A）

1. `spec/flow/launched.yaml` 节点 `generate-merge-prompt` 的 `done_when` 必须包含生产路径真实产生的事实：`any_present:[MERGE_TRANSACTION.json, MERGE_PROMPT_GENERATED, MERGE_PROMPT.md]`（事务在盘即 done；legacy 测试 marker 兼容保留），`artifacts_hint` 同步。
2. `flow-derive` 的 step 推导与 flow 规格 `done_when` 声明同一判据（前沿判据单源），由回归测试钉两处一致；`proposal_step` 闭合枚举、step 序列与 `merge-generated` 语义名不变。
3. merge 开事务（含幂等返回既有非终态事务、终态归档让位后重建）后：`proposal_step` 推进 `merge-generated`，`next` 的 `next_node` 为 `apply-merge`（派 merge-executor 走 submit-content → seal → apply）。

### merge 成功后置条件（二分，跨仓合同）

1. **no-delta 提案**：`openlogos merge` 当场写 `SPEC_MERGED`，前沿即进（既有行为，显式成文）。
2. **有 delta 提案**：`openlogos merge` 创建（或幂等返回 / 重开）`MERGE_TRANSACTION.json`；exit 0 + 事务在盘且 phase 合法 = 宿主判「本跳成功」的充分条件；`SPEC_MERGED` 由事务 apply 写入。
3. merge 命令收尾提示不得再指向「执行 MERGE_PROMPT.md」；必须引导事务链（submit-content → seal → apply）。

### 机器消费要求（S16）

1. 活跃提案存在合并事务时，`openlogos status --format json` 与 `openlogos next --format json` 的 `data.merge_transaction` **必须**挂载只读投影（从「可挂载」升格），且与 `merge transaction status` 同快照逐字段一致。
2. contract/schema 摘要失配的存量事务一律 fail-closed 拒绝：错误码稳定，diagnostic 含双方版本与摘要及标准 remediation（`abort` 后重开）；不承诺迁移。
3. `status` / `next` 所有失败路径必须输出结构化 `error.code`；瞬态类码集合稳定，变更走 CLI JSON 合同版本；任何失败路径退化为纯文本 stderr 视为回归。

### 场景验收条件

#### S05 next 引导

- merge 开事务后 `next` 立即给出 `apply-merge` 派活（不再滞留 `generate-merge-prompt`）；事务各相位（collecting/ready/sealed/completed/failed）下引导与事务 `next_action` 一致，不改写事务动作。

#### S09 变更生命周期

- 生产链路「merge 开事务 → step 推进 merge-generated → apply-merge 派活 → apply 写 SPEC_MERGED → coding」全链可推进；legacy 测试模式（marker 路径）行为保持不变。

#### S16 机器 JSON

- 投影必挂、失败路径结构化错误码、存量事务失配稳定拒绝均由 UT/ST 与安装态 smoke 锚定。

### 部署与非目标

- 必须以 0.14.19 真实 tarball 完成隔离矩阵（含跨组件全链验收与固定 0.14.18 死区零回归对照）后覆盖本机全局；smoke 必跑。
- 不采用方案 B（不合并 merge 子流节点、不改 step 枚举）；不实现存量事务迁移；不授权 npm publish、Git tag、GitHub Release、官网发布或 `git push`。
