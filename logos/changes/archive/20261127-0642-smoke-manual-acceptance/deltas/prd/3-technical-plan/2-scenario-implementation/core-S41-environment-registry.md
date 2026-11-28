## ADDED — 人工验收字段（smoke-manual-acceptance）

> 来源变更：smoke-manual-acceptance（决策 C01；proposal-r1 F3/F5/F6、proposal-r2 F3/F6 处置）。权威定义见 `spec/environments.md` §2.2、§5.2、§5.4、§7.1、§15。本节修订前文步骤 2、16、17 的口径，其余步骤不变。

### 字段校验（修订 Step 2）

- `environments[].manual_acceptance` 不再是未知字段；`env check`、`smoke`、`accept`、`deploy` 共用同一校验：
  - 必须是对象，只允许 `enabled`、`regression` 两个键（其他键出 `ENV_UNKNOWN_FIELD` 警告）；
  - `enabled` 为布尔，缺省视为 `false`；
  - `regression` 为字符串数组，缺省为空。每项必须是首格 ID 格式合法、前缀为 `UT-` / `ST-` / `SMOKE-` 的 ID，不得重复；
  - 字段必须以普通键名书写，转义键报 `ENV_FIELD_INVALID`，规则与 `promote_from` / `require_approval` 相同。
- 违反时报 `ENV_FIELD_INVALID`，登记表按非法处理（`ENV_REGISTRY_INVALID`）。
- 字段不要求环境配置了 `deploy`，也不使环境成为受门环境：`deploy-done` 不因该字段报 `DEPLOY_DONE_GATED_ENV`，审批与晋级不受影响。
- `regression` 中的 ID 是否存在、是否为人工用例，不在登记表校验中判定，由 smoke 在已部署版本上解析（S46）。

### 账本读取扩展（修订 Step 16）

- 新增 `kind=manual` 记录，按 `spec/environments.md` §5.4 校验：`deploy_id` 非空、`ref` 为 40 位 commit 或 null、`case_id` 为合法 ID、`result` 为 `pass` / `fail`、`fail` 时 `note` 非空、`evidence` 为字符串数组、`recorder` 为字符串或 null。不合格的行整行跳过，并计入 `corrupt_lines`。
- smoke 记录的 `result` 新增 `pending`，可选字段 `manual_passed`（布尔）与 `manual_pending`（字符串数组）。`result=pending` 时 `verified` 必须为 false，`manual_pending` 必须存在。
- 同一次流式扫描中按环境维护：
  - **当前部署**：最近一条 deploy 记录（任意 `result`，与 §4.2 smoke 部署身份核对同一身份；`deploy_id`、`ref`、`result`），以及 `previous_ref`；结果不是 `done` 时为未确认（评审 delta-r1 F4）；
  - **D 的 manual 结果**：当前部署每个 `case_id` 的最后一条 manual 记录；
  - **通过记录的过期**：`manual_passed=true` 的 smoke 记录之后出现同一环境、同一 `deploy_id` 的 manual 记录即过期；
  - **人工验收基线**：`deploy_id` 不等于当前部署的部署里，最近一条未过期的 `manual_passed=true` smoke 记录的 `ref`（评审 delta-r1 F2）；
  - **已验证 commit 集合与晋级候选**：只认未过期的 `verified=true` smoke 记录（修订「晋级与审批字段」一节的同名推导）；
  - **等待状态**：当前部署最近一条 smoke 记录为 `pending` 时，剩余清单 = `manual_pending` 减去其后同一部署 manual 记录覆盖的用例。
- manual 记录进入历史，不进入 `last_deploy`，不影响 `current_ref` / `previous_ref`。pending 记录进入 `last_smoke`。

### 环境视图新增字段（修订 Step 17）

- 环境配置了 `manual_acceptance` 时，EnvView 新增 `manual_acceptance = {enabled, regression, waiting}`。`waiting` 为 `{deploy_id, remaining[]}`；当前部署最近一条 smoke 记录不是 `pending` 时为 null。
- 未配置该字段的环境不出现这个键。
- `last_smoke.result` 可为 `pending`；`status.schema.json` 同步。
- `env check` 报告 `manual_acceptance` 的校验问题。

### 异常补充

- **EX-41.25：`manual_acceptance` 结构非法**——触发：`enabled: "yes"`，或 `regression: SMOKE-core-1`（不是数组），或 `regression` 中有 `TODO-1`；期望：`env check` 报 `ENV_FIELD_INVALID`，登记表按非法处理，`smoke` / `accept` fail-closed；副作用：无。
- **EX-41.26：转义键**——触发：写 `"manual_acceptance": {…}`；期望：`ENV_FIELD_INVALID`（`field=manual_acceptance`）；副作用：无。
- **EX-41.27：字段不构成受门环境**——触发：未配置 `deploy` 的 test 写了 `manual_acceptance: {enabled: true}`；期望：校验通过，`deploy-done --env test` 照常执行，不报 `DEPLOY_DONE_GATED_ENV`；副作用：无。
- **EX-41.28：账本含 0.16.24 不认识的记录**——触发：账本含 `kind=manual` 行或 `result=pending` 的 smoke 行；期望：本版本按 §5.4 正常读取；0.16.24 及更早的读取方计入 `corrupt_lines` 并跳过，不崩溃；副作用：无。
- **EX-41.29：过期通过记录不作为晋级依据**——触发：staging 的 D 有 `verified=true`、`manual_passed=true` 的 smoke 记录，其后出现 D 的 manual 记录；期望：staging 的已验证集合与晋级候选不含该记录的 `ref`，prod 部署该 commit 报 `DEPLOY_PROMOTION_UNVERIFIED`；副作用：零执行、零写入。
- **EX-41.30：AI 编辑写了 `manual_acceptance` 的登记表**——触发：登记表任一环境写了 `manual_acceptance`，AI 以 Edit / Write 修改，或以 shell 删除该文件；期望：按「已配置门禁的登记表」处理，交互模式由宿主弹窗请用户批准，其他模式阻断（S09）；副作用：被阻断时文件不变。

### 追溯

- 功能规格：§2.107.3、§2.107.7、§2.107.8、§2.107.11；场景：S46；测试：`core-S41-test-cases.md`（UT-S41-30 起）。
