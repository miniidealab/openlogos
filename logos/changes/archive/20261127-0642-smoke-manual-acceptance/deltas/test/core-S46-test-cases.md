## ADDED — logos/resources/test/core-S46-test-cases.md（新文件，整文件）
# core-S46: 冒烟阶段人工验收测试用例

> 场景：S46 冒烟阶段人工验收｜决策：C01～C03｜来源变更：smoke-manual-acceptance｜规则权威：功能规格 §2.107、`spec/environments.md` §15
> 全部测试代码必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`，见 `logos/spec/test-results.md`），测试名包含对应 ID，`scenario_id="S46"`。除纯函数用例外，全部用例在 `mktemp -d` 一次性临时 git 仓库中构造：已初始化、launched 的 `core` 单模块项目；登记表 `logos/environments.yaml` 含 `test`（未开启人工验收）与 `prod`（`manual_acceptance: {enabled: true}`），两者都配置 `deploy`（script 方式指向夹具内被跟踪的脚本）；部署通过以下两种命令之一真实落账，每次部署先按所用命令断言成功，并取得部署 ID D 用于后续人工记录（评审 delta-r3 F5）：① 版本通道 `openlogos deploy --env <E> --ref <刚提交的版本> --format json`（重新部署同一提交也显式传 `--ref`），断言退出码 0、`data.status === "done"`、`data.deploy_id` 非空，D 取 `data.deploy_id`（字段见 `spec/cli-json-output.md`「deploy 成功输出」）；② 提案通道 `openlogos deploy-done --env <E> --ref HEAD --format json`（HEAD 为已提交用例的版本；不传 `--ref` 时账本写入 `ref=null`、`ref_source=unknown`，开启环境会落入 §15.4 的版本未知分支，评审 delta-r5 F5），断言退出码 0、`data.deployment.ledger_written === true`、`data.deployment.deploy_id` 非空、`data.deployment.ref` 等于该提交、`data.deployment.ref_source === "explicit"`，D 取 `data.deployment.deploy_id`（`deploy-done` 的成功信封没有 `data.status`）。只有专门验收版本未知的用例才省略 `--ref`，并在该用例的前置中写明。两个分支都可以再用同一 D 核对账本 deploy 行；需要核验 `result` 时读取该行；人工用例写在 `logos/resources/test/` 的规格表中并提交。测试不读写本仓账本。

## 一、单元测试（UT）

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|---------|----------|---------|
| UT-S46-01 | 在给定 commit 上枚举人工用例行 | 提交 C1：`core-S01-test-cases.md` 含 `ST-S01-05 [manual]`、`UT-S01-77 [manual/windows]`、`ST-S01-06`；smoke 规格含 `SMOKE-core-901 [manual]`、`SMOKE-core-01` | 对 C1 调用人工用例枚举函数 | 返回 ST-S01-05、UT-S01-77、SMOKE-core-901 三条及各自行内容（去首尾空白）；不含 ST-S01-06、SMOKE-core-01；读取经 `git ls-tree` / `git show`，工作区未提交的修改不影响结果 |
| UT-S46-02 | 首次开启取全部人工用例 | `prod` 账本中没有 `manual_passed=true` 的 smoke 记录；当前部署 D 的 ref 为 C1 | 计算 P(prod, D) | P = {ST-S01-05, UT-S01-77, SMOKE-core-901}；`baseline_ref=null` |
| UT-S46-03 | 有基线时只取增量 | 基线 B=C1（未过期的通过记录）；C2 在 C1 基础上新增 `ST-S01-08 [manual]`，其余人工行不变；D 的 ref 为 C2 | 计算 P | P = {ST-S01-08}；`baseline_ref=C1` |
| UT-S46-04 | 行内容变化计入增量 | B=C1；C2 只修改 ST-S01-05 的预期输出列；另把 UT-S01-77 行的首尾空白改变 | 计算 P | P = {ST-S01-05}；仅首尾空白变化的 UT-S01-77 不计入 |
| UT-S46-05 | 回归用例并入且在已部署版本上解析 | B=C1，D 的 ref 为 C1（无增量）；`prod.manual_acceptance.regression: [SMOKE-core-901]` | 计算 P | P = {SMOKE-core-901}；`regression_unresolved=[]` |
| UT-S46-06 | 回归用例失效进入 regression_unresolved | `regression: [SMOKE-core-901, ST-S01-99]`，ST-S01-99 在 R 版本不存在；另一夹具中 regression 指向 R 版本中已去掉标记的 `ST-S01-06` | 计算 P | 两个夹具分别得到 `regression_unresolved=[ST-S01-99]`、`[ST-S01-06]`；失效 ID 不在 P 中 |
| UT-S46-07 | 已部署版本为 null 时清单无法确定 | D 的 deploy 记录 `ref=null`（ci 方式 `ref_source=unknown`） | 计算 P | 返回 `scope_unresolved`；不读取工作区，即使工作区规格含人工用例也不列出 |
| UT-S46-08 | 已部署版本对象不可读时清单无法确定 | D 的 ref 为本地不存在的 40 位 commit（模拟浅克隆） | 计算 P | 返回 `scope_unresolved` |
| UT-S46-09 | 基线不可读按全量 | B 的 ref 为本地不存在的 commit；R 可读 | 计算 P | P = R 版本全部人工用例；警告 `manual_baseline_unavailable` |
| UT-S46-10 | 关闭环境计算未执行的人工用例 | `test` 未开启；上一次部署 ref 为 C1，本次为 C2（新增 ST-S01-08）；`test` 配置 `regression: [ST-S01-05, ST-S01-99]` | 计算 `unexecuted` | `unexecuted={ST-S01-08, ST-S01-05}`；ST-S01-99 产生警告 `manual_regression_unknown`；不产生 FAIL 原因 |
| UT-S46-11 | 关闭环境没有上一次部署 | `test` 只有一次部署 C1 | 计算 `unexecuted` | 为 C1 全部人工用例 |
| UT-S46-12 | accept 参数校验 | 合法夹具 | 依次缺 `--deploy`、缺 `--case`、`--result maybe`、`--result fail` 不带 `--note`、`--note "  "` | 前三者 `ACCEPT_ARGS_INVALID`；后两者 `ACCEPT_NOTE_REQUIRED`；均退出码 1、账本字节不变 |
| UT-S46-13 | accept 前置：未开启与无部署 | 对 `test` 执行；另一夹具 `prod` 在账本中没有任何 deploy 记录 | `openlogos accept --env … --deploy x --case ST-S01-05 --result pass` | 分别 `ACCEPT_NOT_ENABLED`、`ACCEPT_NO_DEPLOYMENT`；零写入 |
| UT-S46-14 | accept 前置：登记表缺失或非法 | 删除登记表；另一夹具登记表 `manual_acceptance.enabled: "yes"` | 执行 accept | 分别 `ENV_REGISTRY_NOT_FOUND`、`ENV_REGISTRY_INVALID`；零写入 |
| UT-S46-15 | accept 部署已更换（同一提交的两次部署） | `prod` 先后两次部署同一 commit，得到 D1、D2；P 含 ST-S01-05 | `accept --deploy <D1> --case ST-S01-05 --result pass` | `ACCEPT_DEPLOY_CHANGED`，`details.expected=D1`、`current=D2`；零写入 |
| UT-S46-16 | accept 部署身份在锁内核对 | 测试接缝：accept 锁外检查通过后、取锁前，另一进程追加 `prod` 的新 deploy 记录 D2 | accept 继续执行 | 锁内重读后报 `ACCEPT_DEPLOY_CHANGED`；账本只多出 D2 那一行 |
| UT-S46-17 | accept 用例不在清单整批零写入 | P = {ST-S01-05, SMOKE-core-901} | `--case ST-S01-05,UT-S01-99 --result pass` | `ACCEPT_CASE_NOT_PENDING`，`details.not_pending=[UT-S01-99]`；ST-S01-05 也未写入 |
| UT-S46-18 | accept 清单无法确定 | D 的 ref 为 null | accept 任一用例 | `ACCEPT_CASE_NOT_PENDING`，`details.reason=scope_unresolved`；零写入 |
| UT-S46-19 | accept 写入 manual 行 | P 含 ST-S01-05、SMOKE-core-901 | `--case ST-S01-05 --case SMOKE-core-901 --result fail --note 首启白屏 --evidence shots/a.png` | 账本追加两行 `kind=manual`，各含 `deploy_id=D`、`ref`、`case_id`、`result=fail`、`note`、`evidence=["shots/a.png"]`、`recorder`；`shots/a.png` 不存在时输出警告 `accept_evidence_missing`、退出码 0 |
| UT-S46-20 | 同一用例重复记录以最后一条为准 | 先记录 ST-S01-05 fail（带说明），再记录 pass | 计算 D 上 ST-S01-05 的结果 | 为 pass；两行都保留在账本 |
| UT-S46-21 | accept 并发只按锁串行 | 两个 accept 进程同时对不同用例写入 | 并发执行 | 两者都成功；账本每行完整、无粘连，`corrupt_lines=0` |
| UT-S46-22 | 人工阶段判定顺序 | 自动阶段 PASS；分别构造：① R 不可读；② regression 失效且有 fail 记录；③ 一条 fail；④ 全部 pass；⑤ P 为空；⑥ 一条未记录 | 调用人工阶段判定 | 依次为 FAIL `manual_scope_unresolved`、FAIL `manual_regression_unresolved`、FAIL `manual_cases_failed`、PASS、PASS、PENDING `manual_acceptance_pending` |
| UT-S46-23 | PENDING 落账内容 | P = {A, B}，D 上已有 A 的 pass 记录 | `openlogos smoke --env prod`（自动阶段 PASS） | 账本追加 smoke 行 `result=pending`、`verified=false`、`deploy_id=D`、`manual_pending=[B]`；`gate.result=PENDING`；退出码 1 |
| UT-S46-24 | smoke 锁内复核采纳锁外判定之后的记录 | 测试接缝：smoke 锁外判定为 PENDING（B 未记录）后、取锁前，accept 写入 B 的 pass | smoke 继续执行 | 锁内重新判定为 PASS，追加 `result=pass`、`manual_passed=true`；反向：锁外判定 PASS 后、取锁前写入 A 的 fail，锁内判定为 FAIL `manual_cases_failed` |
| UT-S46-25 | 过期推导与基线 | 账本：D 的 smoke 行 `manual_passed=true`，其后 D 的一条 manual 行 | 读取账本推导 | 该通过记录过期：基线 B 退回更早的未过期通过记录（没有时为 null）；`prod` 的已验证集合与晋级候选不含它 |
| UT-S46-26 | 过期记录不作为晋级依据 | `staging` 开启人工验收，D 的过期 `verified=true` 通过记录 ref=X；`prod.promote_from: staging` | `openlogos deploy --env prod --ref X --dry-run` | `DEPLOY_PROMOTION_UNVERIFIED`，`details.upstream_candidate_ref` 不为 X |
| UT-S46-27 | 剩余清单只读账本 | 第一条 pending `manual_pending=[A,B]`；记录 A；第二条 pending `manual_pending=[B]`；记录 B | 读取账本计算剩余清单（用 spy 断言不调用 git） | 剩余清单为空；不出现 A |
| UT-S46-28 | EnvView 的 manual_acceptance | 上一用例的账本；另一环境未配置该字段 | `env show prod --format json`、`env list --format json` | `prod` 含 `manual_acceptance={enabled:true, regression:[], waiting:{deploy_id:D, remaining:[]}}`；最近 smoke 不是 pending 时 `waiting=null`；未配置的环境不出现该键 |
| UT-S46-29 | smoke JSON 契约 | 开启与关闭各一个夹具 | `smoke --format json` | `data.manual_acceptance` 含 `enabled`、`environment`、`deploy_id`、`ref`、`baseline_ref`、`pending`、`passed`、`failed`、`remaining`、`regression_unresolved`、`unexecuted`、`warnings`；开启时 `unexecuted=[]`，关闭时 `pending/passed/failed/remaining=[]`；`status.schema.json` 校验 EnvView 通过 |
| UT-S46-30 | accept JSON 契约 | 记录后仍剩一条 | `accept --format json` | `data` 含 `environment`、`deploy_id`、`ref`、`recorded[{case_id,result}]`、`remaining`、`expired_pass=false`、`recorder`、`warnings` |
| UT-S46-31 | 通过后 accept 删除 SMOKE_PASS | 活跃提案 `DEPLOY_DONE.deploy_id=D`，`SMOKE_PASS` 在场，D 已有通过记录 | accept 把回归用例 X 记为 fail | 账本追加 manual 行；`SMOKE_PASS` 被删除；`expired_pass=true` |
| UT-S46-32 | 删除 SMOKE_PASS 失败时撤销账本行 | 同上，测试接缝让删除 `SMOKE_PASS` 失败 | accept | 本次追加的全部 manual 行按整行原文撤销；`SMOKE_PASS` 仍在；`ACCEPT_LEDGER_WRITE_FAILED`、退出码 1 |
| UT-S46-33 | archive 以账本核对最近有效结论 | 活跃提案已部署 D，`SMOKE_PASS` 在场；账本中 D 有 manual 记录，且最近 smoke 通过记录之后又有 D 的 manual 记录 | `openlogos archive <slug>` | `ARCHIVE_SMOKE_NOT_PASSED`，`error.details={reason:"smoke_pass_expired", environment, deploy_id}`；提案未归档 |
| UT-S46-34 | archive 账本核对的适用范围 | 三臂：① 环境未开启人工验收，部署 D 没有任何 manual 记录，`SMOKE_PASS` 在场；② 环境开启人工验收，D 没有 manual 记录，P 为空，D 自己有 `manual_passed=true` 的通过记录；③ 环境开启人工验收，D 没有 manual 记录，`SMOKE_PASS` 在场但账本中没有 D 自己的通过记录 | archive | ① 与引入前一致，归档成功；② 归档成功；③ `ARCHIVE_SMOKE_NOT_PASSED`（`smoke_pass_expired`） |
| UT-S46-36 | 最近一次部署未确认时 accept 与 smoke 同口径 | `prod` 的 D1 成功且有待验清单；随后同一环境的 D2 落账为 `unknown` | ① `accept --deploy <D1> …`；② `accept --deploy <D2> …`；③ `smoke --env prod`（无活跃提案）；④ `deploy --env prod --reconcile` 把 D2 补记为 `done` 后，重复 ① 与 ② | ① `ACCEPT_DEPLOY_CHANGED`（身份检查先于确认状态检查，锁外预检与锁内复核同一顺序）；② `ACCEPT_DEPLOYMENT_UNCONFIRMED`（`details.result=unknown`）；均零写入；③ 人工阶段 FAIL `manual_scope_unresolved`，不退回 D1；④ D1 清单仍被拒，D2 清单可记录 |
| UT-S46-37 | 通过后普通用例可更正（无回归配置） | `prod` 只写 `enabled: true`（regression 为空）；D 首次通过，P(prod, D) = {ST-S01-05, SMOKE-core-901} | ① 计算 P(prod, D)；② `accept --deploy <D> --case SMOKE-core-901 --result fail --note 白屏` | ① 仍为原两条：D 自己的通过记录不作为 D 的基线，`baseline_ref` 为 D 之前的通过部署（没有时为 null）；② 成功，`expired_pass=true` |
| UT-S46-35 | 版本通道 PENDING 只写账本 | 没有活跃提案，`prod` 当前部署 D | `smoke --env prod`（自动 PASS，人工未记录） | 追加 `slug=null` 的 pending 行；不读写任何提案标记；`env show prod` 的 `waiting.remaining` 正确 |

## 二、场景测试（ST）

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|---------|----------|---------|
| ST-S46-01 | 开启 → 等待 → 记录 → 通过（提案通道，真实 CLI） | 活跃提案新增 `ST-S01-05 [manual]` 与 `SMOKE-core-901 [manual]`，已 merge、verify PASS，部署到 `prod`；一条自动 SMOKE 的 runner 写 pass | ① `openlogos smoke --env prod`；② `openlogos next --format json`；③ `openlogos accept --env prod --deploy <D> --case ST-S01-05,SMOKE-core-901 --result pass`；④ 重跑 smoke；⑤ `openlogos archive` | ① PENDING，退出码 1；② 驻留态 `awaiting-manual-acceptance`、`auto_execute=false`，建议命令含 `--deploy <D>`；③ `remaining=[]`；④ PASS，写 `SMOKE_PASS`，账本通过记录 `manual_passed=true`；⑤ 归档成功 |
| ST-S46-02 | 人工用例失败 | 同 ST-S46-01 到 ①；③ 改为记 SMOKE-core-901 fail 并带说明 | 重跑 smoke | FAIL `manual_cases_failed`，写 `SMOKE_FAIL`，报告列出用例与说明；archive 被拒 |
| ST-S46-03 | 重新部署后旧结果作废 | ST-S01-05 已在 D1 记 pass；随后重新部署为 D2 | `smoke --env prod` | ST-S01-05 重新出现在 `pending` 与 `remaining` 中；用 D1 的 `--deploy` 记录报 `ACCEPT_DEPLOY_CHANGED` |
| ST-S46-04 | 不部署提案的人工用例被累积 | 提案 A 新增 `ST-S01-08 [manual]` 后归档、未部署；`prod` 上次人工验收通过的版本不含它；提案 B 部署到 `prod` | `smoke --env prod` | `pending` 含 ST-S01-08 |
| ST-S46-05 | 关闭环境只列出不阻断 | 同一项目部署到 `test` | `smoke --env test` | 门禁结论只由自动用例决定（PASS 写 `SMOKE_PASS`）；报告含「未执行的人工用例 N 条」，JSON `unexecuted` 列出 ID；账本没有 pending 行 |
| ST-S46-06 | 清单无法确定时不签发通过 | `prod` 的部署记录 `ref=null`；工作区切到一个缺少 ST-S01-05 的分支 | `smoke --env prod` | FAIL `manual_scope_unresolved`，不写 `SMOKE_PASS`，基线不推进；改为浅克隆夹具（R 不可读）结果相同 |
| ST-S46-07 | 回归用例失效时不能通过 | `prod.regression: [SMOKE-core-901, ST-S01-99]`（后者不存在）；记录 SMOKE-core-901 pass | 重跑 smoke | FAIL `manual_regression_unresolved`，`regression_unresolved=[ST-S01-99]`；修正登记表后重跑才 PASS |
| ST-S46-08 | 通过后更正为失败：顺序与交错两种执行 | ST-S46-01 到 ④ 之后；把回归用例记为 fail。交错夹具：用测试接缝把一次 smoke 重跑暂停在 PASS 账本追加之后，完成 fail 更正，再恢复重跑并写回 `SMOKE_PASS` | 两种情况都直接 `openlogos archive` | 都以 `ARCHIVE_SMOKE_NOT_PASSED`（`smoke_pass_expired`）拒绝；next 建议重跑 smoke |
| ST-S46-09 | 多次重跑后从账本恢复等待状态（两种通道） | P = {A, B}；有活跃提案与无活跃提案两套夹具 | 记录 A → 重跑 smoke（仍 PENDING）→ 记录 B → 新进程执行 `next --format json` 与 `env show prod --format json` | 第二条 pending 行 `manual_pending=[B]`；剩余清单为空；提案通道 next 建议重跑 `openlogos smoke --env prod`，版本通道 `waiting.remaining=[]` |
| ST-S46-11 | 重新部署后旧部署的 smoke 写回通过标记 | 活跃提案在开启人工验收的 `prod` 部署 D1，回归用例 X 已记 pass | ① 用测试接缝把 D1 的 smoke 暂停在 PASS 账本追加之后；② 提案重新部署为 D2（清除旧标记，写新 `DEPLOY_DONE`）；③ 恢复 D1 的 smoke，写回 `SMOKE_PASS`；④ 直接 `openlogos archive`；⑤ 对 D2 执行 smoke、记录 X、重跑，再 archive | ④ `ARCHIVE_SMOKE_NOT_PASSED`（`smoke_pass_expired`）；⑤ D2 上 X 重新等待，记录并重跑通过后归档成功 |
| ST-S46-12 | 首次通过后更正普通用例（无回归配置，提案通道） | ST-S46-01 夹具但 `prod` 不配置 regression；完成 ①～④ 得到 `SMOKE_PASS` | ① `accept --deploy <D> --case SMOKE-core-901 --result fail --note 白屏`；② 直接 archive；③ 重跑 smoke | ① 成功，`expired_pass=true`，`SMOKE_PASS` 被删除；② `ARCHIVE_SMOKE_NOT_PASSED`；③ FAIL `manual_cases_failed` |
| ST-S46-10 | 只有人工用例的项目 | 项目只有一条 `SMOKE-core-901 [manual]`，没有 runner、没有结果文件，未配置 `smoke.command` 以外的任何 smoke 产物 | `smoke --env prod` → accept → 重跑 | 依次 PENDING、PASS；不报 `NO_SMOKE_RESULTS` / `NO_SMOKE_CASES`；通过记录 `verified=false` |

## 三、覆盖度校验

| 来源 | 覆盖用例 |
|------|---------|
| S46 主路径 Step 1～14 | ST-S46-01、UT-S46-23、UT-S46-24 |
| EX-46.1 | ST-S46-02、UT-S46-22 |
| EX-46.2 | UT-S46-17 |
| EX-46.3、EX-46.4 | UT-S46-13、UT-S46-36 |
| EX-46.5 | UT-S46-12 |
| EX-46.6、EX-46.13 | ST-S46-03、UT-S46-15、UT-S46-16 |
| EX-46.7 | ST-S46-05、UT-S46-10、UT-S46-11 |
| EX-46.8 | ST-S46-04、UT-S46-03 |
| EX-46.9 | UT-S46-02 |
| EX-46.10 | ST-S46-06、UT-S46-07、UT-S46-08、UT-S46-18 |
| EX-46.11 | UT-S46-09 |
| EX-46.12 | ST-S46-07、UT-S46-06 |
| EX-46.14 | ST-S46-08、ST-S46-12、UT-S46-25、UT-S46-26、UT-S46-31、UT-S46-32、UT-S46-33、UT-S46-37 |
| EX-46.20 | ST-S46-11、UT-S46-34 |
| EX-46.15 | `core-S09-test-cases.md` UT-S09-493 起 |
| EX-46.16 | `core-S05-test-cases.md` UT-S05-58 起 |
| EX-46.17 | ST-S46-10 |
| EX-46.18 | ST-S46-09、UT-S46-27 |
| EX-46.19 | `core-S19-test-cases.md` UT-S19-130 |

## 四、验收条件追溯

| 验收条件 | 覆盖用例 |
|---------|---------|
| AC-SMOKE-MANUAL-01 | `core-S19-test-cases.md` UT-S19-127～UT-S19-130 |
| AC-SMOKE-MANUAL-02 | ST-S46-01、UT-S46-23、UT-S46-35 |
| AC-SMOKE-MANUAL-03 | ST-S46-01 |
| AC-SMOKE-MANUAL-04 | ST-S46-02、UT-S46-12 |
| AC-SMOKE-MANUAL-05 | UT-S46-15、UT-S46-16、UT-S46-17、UT-S46-36 |
| AC-SMOKE-MANUAL-06 | ST-S46-03 |
| AC-SMOKE-MANUAL-07 | ST-S46-05、UT-S46-10 |
| AC-SMOKE-MANUAL-08 | ST-S46-04 |
| AC-SMOKE-MANUAL-09 | UT-S46-02 |
| AC-SMOKE-MANUAL-10 | ST-S46-06、ST-S46-07、UT-S46-06、UT-S46-07、UT-S46-08 |
| AC-SMOKE-MANUAL-11 | ST-S46-08、ST-S46-11、ST-S46-12、UT-S46-31、UT-S46-33、UT-S46-37 |
| AC-SMOKE-MANUAL-12 | ST-S46-10 |
| AC-SMOKE-MANUAL-13 | `core-S09-test-cases.md` UT-S09-493～UT-S09-496、UT-S09-501～UT-S09-503、`core-S05-test-cases.md` UT-S05-59 |
| AC-SMOKE-MANUAL-14 | ST-S46-09、UT-S46-27 |
