# core-S41: 环境登记与查询测试用例

> 场景：S41 环境登记与查询｜决策：C02～C08｜来源变更：environment-registry｜格式权威：`spec/environments.md`
> 全部测试代码必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`，见 `logos/spec/test-results.md`），测试名包含对应 ID，`scenario_id="S41"`。全部用例在 `mktemp -d` 一次性临时项目中构造，不得触碰本仓或用户其他项目的登记表、账本、活跃提案与 guard。

## 一、单元测试（UT）

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|---------|----------|---------|
| UT-S41-01 | 合法登记表解析 | 登记表含 test、prod 两项，字段齐全（含 aliases、health、version、secrets） | 加载登记表 | 返回两项环境，字段值与文件一致；无 error、无 warning |
| UT-S41-02 | 字段非法逐条点名 | 分别构造：id 含大写或下划线、缺 name、tier 为 `qa`、health 为 `ftp://…`、secrets 含 `MY-TOKEN`、`schema_version: 2` | 加载并执行 `env check` 的校验逻辑 | 每种情形报 `ENV_FIELD_INVALID`（`schema_version` 报 `ENV_REGISTRY_INVALID`），点名环境与字段；加载结论为非法 |
| UT-S41-03 | id / alias 不区分大小写冲突 | ① 两项 id 相同；② 一项 alias 为 `Prod` 与另一项 id `prod` 相同；③ 两项 alias 都含 `测试` | 加载登记表 | 三种情形均报 `ENV_DUPLICATE_ID_OR_ALIAS` 并点名冲突值 |
| UT-S41-04 | 未知字段只警告 | 顶层含 `owner`，环境项含 `promote_from` | 加载登记表 | 加载成功；warning 列表含两条 `ENV_UNKNOWN_FIELD`；不计入 error |
| UT-S41-05 | 环境解析顺序与失败 | 登记表 test（aliases `[测试, QA]`）、prod | 依次解析 `TEST`、`qa`、`测试`、`staging` | 前三者解析为 `test`；`staging` 报 `ENV_UNKNOWN`，消息列出 `test`、`prod` |
| UT-S41-06 | 账本完整流式扫描与按环境聚合 | 账本第 1、2 行为 prod 的 deploy、smoke；之后追加 1001 条 test 记录；再追加 25 条 prod 之外的记录 | 读取账本并投影 | prod 的 `last_deploy`、`last_smoke` 为第 1、2 行；test 的 `last_*` 为其最后的记录；每个环境历史最多 20 条且为新到旧；不存在全局行数窗口 |
| UT-S41-07 | 账本非法行整行跳过且不覆盖有效状态 | 账本依次为：prod 的合法 deploy（R1）与合法 smoke；随后 prod 的非法行——非 JSON、JSON 数组、缺 `kind`、`kind: rollback`、`{"kind":"deploy","environment":"prod"}`（缺字段）、deploy 行 `ref` 为数字、deploy 行 `ref_source=explicit` 而 `ref=null`、smoke 行 `verified` 为字符串、smoke 行 `result=pass` 等条件满足 `verified=true` 却写 `verified=false`、smoke 行缺 `fresh_results`；末尾一行含未知额外字段 `note` 的合法 test deploy | 读取账本并投影 | `corrupt_lines=10`；prod 的 `last_deploy` 仍为 R1 那行、`current_ref` 为 R1 且类型为字符串，`last_smoke` 仍为那条合法 smoke；prod 历史不含任何非法行；test 的含额外字段的行被接受；不抛出 |
| UT-S41-08 | `verified` 判定真值表 | 构造 smoke 记录组合：result（pass/fail）× env_evidence（declared/missing/mismatch）× fresh_results（true/false）× deploy_env_confirmed（true/false）× ref（commit/null） | 计算 `verified` | 仅 `pass + declared + fresh + confirmed + 非 null` 为 true，其余 47 种组合均为 false |
| UT-S41-09 | `env check` 引用与密钥检查 | `deployment_gates.core.environments` 含 `staging`（未登记）；prod `secrets: [PROD_TOKEN]`，进程环境未设置；test `secrets: [TEST_TOKEN]` 且已设置为 `s3cr3t-value` | `env check --format json` | 报 `ENV_GATE_REFERENCE_UNKNOWN`（staging）与 `ENV_SECRET_MISSING`（PROD_TOKEN）；`secrets` 列表含两个变量名与 `present`；完整输出（stdout + stderr）不含 `s3cr3t-value`；退出码 1 |
| UT-S41-10 | `--probe` 仅显式时联网 | 本地 HTTP 测试服务：health 返回 200、version 返回 200 与正文、另一环境 health 延迟 6 秒；记录服务收到的请求数 | ① `env check`（不加 `--probe`）；② `env check --probe` | ① 服务收到 0 个请求；② 正常地址记录状态码，延迟地址在约 5 秒时报 `ENV_PROBE_FAILED`（超时），退出码 1 |
| UT-S41-11 | 登记表非法时 fail-closed | 登记表为非法 YAML；存在满足 deploy-done 前置的活跃提案 | 执行 `env list`、`deploy-done --env test`、`smoke --env test` | 均报 `ENV_REGISTRY_INVALID`、退出码 1；`DEPLOY_DONE`、`[deploy]` 勾选、账本、smoke marker 均不变 |

## 二、场景测试（ST）

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S41-01 | `env` 命令 JSON 合同与无登记表行为 | S41 Step 1～3、15～17；EX-41.1 | 真实 CLI；一次性项目 | ① 无登记表时执行 `env list --format json`、`env show prod --format json`、`env check --format json`；② 写入合法登记表与若干账本记录后再执行三者 | ① `list` 返回空数组、退出码 0，`show` / `check` 报 `ENV_REGISTRY_NOT_FOUND`、退出码 1；② 三者输出符合 `spec/cli-json-output.md`「`openlogos env list|show|check --format json`」的字段与类型；`show` 的历史为新到旧且不超过 20 条 |
| ST-S41-02 | 部署与 smoke 全链路得到已验证事实 | S41 Step 4～17 | 真实 CLI；一次性 git 仓库与活跃提案（需部署、需 smoke，`VERIFY_PASS`、部署报告在场）；smoke runner 读取 `OPENLOGOS_SMOKE_ENV` 并写 `target_environment` | ① `deploy-done --env 测试 --ref HEAD`；② 新提交使 HEAD 前进；③ `smoke --env test`；④ `env show test --format json`；⑤ `status --format json` | ① `DEPLOY_DONE` 为合法 JSON、`environment=test`、`ref` 为 ① 时的 commit；③ 写 `SMOKE_PASS`；④ `current_ref` 等于 ① 的 commit，`last_smoke.verified=true`、`ref` 等于 ① 的 commit、`observed_head` 为 ② 后的 HEAD；⑤ `environments` 中 test 的 `current_ref`、`last_deploy`、`last_smoke` 与 ④ 逐字段相等 |
| ST-S41-03 | 登记表的 guard 内置默认豁免 | EX-41.10；决策 C07 | 真实 guard hook；launched 项目、无活跃提案；用例 A：`logos.config.json` 未写 `guard.exempt`；用例 B：显式 `guard.exempt` 不含该路径 | 对 `logos/environments.yaml` 执行 Edit / Write，并触发事后检查 | A：不阻断、事后检查不报警；B：按受保护文件处理（阻断或事后报警）；B 中用户经保护范围命令添加该路径后行为与 A 相同 |

## 三、测试数据与断言要求

- 登记表与账本只在一次性临时项目中构造；账本路径固定为 `logos/.openlogos-runtime/deployments.jsonl`。
- 涉及密钥的断言必须覆盖完整 stdout 与 stderr，并以「密钥值字面量不出现」为判据。
- 网络相关断言只针对本地测试服务，记录请求计数，不访问公网。
- JSON 断言以字段与类型为准，不解析人类可读文案；文案中英文各至少覆盖一个错误码。

## 四、覆盖度校验

- 登记表格式与校验（§2）：UT-S41-01～UT-S41-04、UT-S41-11。
- 环境解析（§3）：UT-S41-05。
- 账本读取与视图（§5.4、§7）：UT-S41-06、UT-S41-07、ST-S41-01。
- 已验证判据（§5.3）：UT-S41-08、ST-S41-02。
- `env check` 与探测（§7.2）：UT-S41-09、UT-S41-10。
- guard 豁免（§9，决策 C07）：ST-S41-03。
- 部署与 smoke 的环境、版本与证据细节分别由 `core-S21-test-cases.md`（UT-S21-12～UT-S21-19、ST-S21-05）、`core-S19-test-cases.md`（UT-S19-58～UT-S19-67、ST-S19-25～ST-S19-27）、`core-S11-test-cases.md`（UT-S11-96～UT-S11-100、ST-S11-52）覆盖。

## 五、部署配置与部署记录扩展测试（environment-deploy）

> 覆盖场景 `core-S41-environment-registry.md`「部署配置与部署记录扩展（environment-deploy）」、EX-41.11、EX-41.12，`spec/environments.md` §2.2、§5.2、§5.4、§7.1、§11.2，决策 C06、C08、D13。既有 UT-S41-01～UT-S41-11、ST-S41-01～ST-S41-03 不变（UT-S41-04 的 `promote_from` 仍为未知字段，UT-S41-07 列举的非法行仍为非法）。测试实现必须写入 OpenLogos reporter，`scenario_id="S41"`；账本记录以直接写入的方式构造，全部在一次性临时项目中执行。

### 单元测试（UT）

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|---------|----------|---------|
| UT-S41-12 | 登记表 `deploy` 字段校验 | 分别构造：① 合法 script（`script: deploy/prod.sh`、`args: ["{env}","{ref}"]`、`timeout_sec: 600`）；② 合法 ci github-actions；③ 合法 ci provider script；④ 合法 agent；⑤ 缺 `mode`；⑥ `mode: shell`；⑦ script 为绝对路径；⑧ script 含 `..`；⑨ `args` 含数字；⑩ `args` 含未知占位符 `{token}`；⑪ `timeout_sec: 9000`；⑫ github-actions 缺 `workflow`；⑬ agent 缺 `plan_section`；⑭ `deploy` 含 `run: ./deploy.sh`；⑮ `deploy` 含未知子字段 `owner` | 加载登记表并执行 `env check` 的校验逻辑 | ①～④ 无 error；⑤～⑭ 各报 `ENV_FIELD_INVALID`，`field` 形如 `deploy.mode` / `deploy.script` / `deploy.args` / `deploy.run`，登记表判为非法；⑮ 只报 `ENV_UNKNOWN_FIELD` warning |
| UT-S41-13 | 扩展 deploy 记录的校验与读取 | 账本依次为 prod：① deploy-done 旧形态记录（无 `channel`）；② `deploy` 写出的 `channel=version`、`slug=null`、`result=done`、`ref_source=explicit` 记录；③ `result=failed`、`ref=null`、`failure_reason=exit-code`；④ `result=unknown`、`ci_run_id` 非空；⑤ 与 ④ 同一 `deploy_id`、`reconciled=true`、`result=done`、`ref_source=ci-reported`；⑥ 非法：`slug=null` 而 `channel=proposal`；⑦ 非法：`ref_source=ci-reported` 而 `ref=null`；⑧ 非法：`result=pending` | 读取账本并投影 | ①～⑤ 被接受，① 读作 `channel=proposal`、`mode=null`；⑥⑦⑧ 计入 `corrupt_lines` 且不更新任何槽位；`last_deploy` 为 ⑤；同一 `deploy_id` 以 ⑤ 为该次部署结论；`env show` 历史含 ①～⑤ |
| UT-S41-14 | `current_ref` 与 `previous_ref` 口径 | 账本 prod 依次：成功 R1；成功 R2；失败（`ref=null`）；成功 R2（重复部署）；未知 | 读取并投影 | `current_ref=R2`、`previous_ref=R1`（不因失败、未知或重复 R2 而改变）；再追加一条成功但 `ref=null`（版本未确认）后 `current_ref=null`、`previous_ref=R2`；另构造 R1 成功后追加 1000 条 test 记录与 30 条 prod 失败记录，`previous_ref` 仍按完整账本计算，不受 20 条历史窗口限制 |
| UT-S41-15 | 环境视图新增字段与 schema | prod 配置 `deploy.mode: script`、test 未配置 `deploy`；运行态目录有 prod 的环境锁与 test 的未决记录 | `env list --format json`、`env show prod --format json`、`status --format json` | prod 的 `deploy_mode=script`、test 为 null；`deploy_in_progress` 分别反映锁与未决记录（含 `unresolved`）；`last_deploy` 含 `result`、`channel`、`mode`、`ref_requested`、`failure_reason`；三条命令同一环境的视图字段一致；`status` 输出通过 `spec/schema/status.schema.json`（含 `environments`、`environment_ledger`、`environment_registry_error`）校验 |

### 场景测试（ST）

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S41-04 | 新旧记录混合账本的视图与 0.16.3 读取兼容 | 部署配置与部署记录扩展；EX-41.12 | 真实 CLI；登记表含 prod（配置 `deploy`）；账本含 deploy-done 旧形态记录、版本通道成功、失败与未知记录 | ① `env show prod --format json`；② `status --format json`；③ 以账本读取函数在「只认 0.16.3 字段集」的兼容夹具下读取同一账本 | ① ② 视图字段符合 §7.1，`current_ref` / `previous_ref` 与 UT-S41-14 口径一致；③ 新形态记录计入 `corrupt_lines` 并跳过，不抛出，旧形态记录照常生效 |

### 覆盖度校验（environment-deploy 增量）

- `deploy` 字段校验与 D13（拒绝命令字符串字段）：UT-S41-12。
- 扩展记录校验、同一 `deploy_id` 取最后一条：UT-S41-13。
- `current_ref` / `previous_ref`：UT-S41-14、ST-S41-04。
- 视图新增字段与 status schema：UT-S41-15、ST-S41-04。
