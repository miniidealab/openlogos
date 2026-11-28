## ADDED — 人工验收字段测试（smoke-manual-acceptance）

> 覆盖场景 `core-S41-environment-registry.md`「人工验收字段（smoke-manual-acceptance）」与 EX-41.25～EX-41.30，功能规格 §2.107.3、§2.107.7、§2.107.11，`spec/environments.md` §5.2、§5.4、§15.2。全部用例在 `mktemp -d` 一次性项目中构造，测试代码写入 OpenLogos reporter，`scenario_id="S41"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|----|--------|---------|------|---------|
| UT-S41-30 | 合法字段通过校验 | `prod.manual_acceptance: {enabled: true, regression: [ST-S01-05, SMOKE-core-901]}`；`test` 不写该字段 | `env check --format json` | 无问题；`prod` 的 EnvView 含 `manual_acceptance.enabled=true` 与 regression；`test` 不出现该键 |
| UT-S41-31 | 结构非法 | 分别写 `enabled: "yes"`、`regression: SMOKE-core-1`、`regression: [TODO-1]`、`regression: [ST-S01-05, ST-S01-05]`、`manual_acceptance: true` | `env check` | 每种都报 `ENV_FIELD_INVALID`（`field` 指向具体子项），登记表按非法处理；`smoke --env prod` 与 `accept` fail-closed（`ENV_REGISTRY_INVALID`） |
| UT-S41-32 | 未知子键只警告 | `manual_acceptance: {enabled: true, owner: qa}` | `env check` | `ENV_UNKNOWN_FIELD` 警告（`field=manual_acceptance.owner`），登记表合法 |
| UT-S41-33 | 转义键拒绝 | `"manual_acceptance": {enabled: true}` | `env check` | `ENV_FIELD_INVALID`（`field=manual_acceptance`） |
| UT-S41-34 | 不构成受门环境 | 未配置 `deploy` 的 `test` 写 `manual_acceptance: {enabled: true}`；活跃提案满足 deploy-done 前置 | `deploy-done --env test` | 照常成功，不报 `DEPLOY_DONE_GATED_ENV`；EnvView 不出现 `promote_from` / `require_approval` / `open_approvals` |
| UT-S41-35 | 账本 manual 行校验 | 账本含：合法 manual 行；`result=fail` 且 `note` 为空的行；`case_id: "X-1"` 的行；`evidence: "a.png"`（非数组）的行 | 读取账本 | 合法行进入历史；其余三行计入 `corrupt_lines` 并跳过；manual 行不改变 `last_deploy`、`current_ref`、`previous_ref` |
| UT-S41-36 | 账本 pending 行校验 | 合法 pending 行；`result=pending` 但 `verified=true` 的行；`result=pending` 缺 `manual_pending` 的行 | 读取账本 | 合法行进入 `last_smoke`（`result=pending`）；其余两行计入 `corrupt_lines` |
| UT-S41-37 | 旧读取方兼容（契约断言） | 含 manual 行与 pending 行的账本 | 用 0.16.24 的校验函数快照读取（夹具内嵌旧实现的判定表） | 两类行计入 `corrupt_lines`、不崩溃；新版读取同一账本 `corrupt_lines=0` |
| UT-S41-38 | 过期推导影响已验证集合 | `staging` 有 D 的 `verified=true`、`manual_passed=true` 记录，其后有 D 的 manual 行 | 读取账本 | `staging` 的已验证 commit 集合与晋级候选不含 D 的 ref；更早的未过期记录仍在 |
| UT-S41-39 | status 中的 EnvView | UT-S41-30 夹具，`prod` 最近 smoke 为 pending | `status --format json` | `environments[].manual_acceptance.waiting` 与 `env show` 一致；`status.schema.json` 校验通过 |

### 场景测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|----|--------|---------|------|---------|
| ST-S41-08 | 真实 CLI：未配置字段的登记表零变化 | 既有 S41 ST 夹具 | `env list` / `env show` / `env check` / `status` 的 JSON | 与引入前逐字一致 |

### 覆盖度校验

| 来源 | 覆盖用例 |
|------|---------|
| 字段校验（修订 Step 2） | UT-S41-30、UT-S41-31、UT-S41-32、UT-S41-33 |
| 账本读取扩展（修订 Step 16） | UT-S41-35、UT-S41-36、UT-S41-37、UT-S41-38 |
| 环境视图新增字段（修订 Step 17） | UT-S41-30、UT-S41-39、ST-S41-08 |
| EX-41.25 | UT-S41-31 |
| EX-41.26 | UT-S41-33 |
| EX-41.27 | UT-S41-34 |
| EX-41.28 | UT-S41-37 |
| EX-41.29 | UT-S41-38 |
| EX-41.30 | `core-S09-test-cases.md` UT-S09-497 |

### 自动化与证据要求

- 账本夹具逐行写入一次性项目，不读写本仓账本。
- 全部用例写 OpenLogos reporter，测试名含对应 ID。
