# core-S42: 按环境执行部署与回滚测试用例

> 场景：S42 按环境执行部署与回滚｜决策：C01～C13、C15，D13｜来源变更：environment-deploy｜格式权威：`spec/environments.md` §11
> 全部测试代码必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`，见 `logos/spec/test-results.md`），测试名包含对应 ID，`scenario_id="S42"`。全部用例在 `mktemp -d` 一次性临时 git 项目中构造；部署脚本只向一次性「发布目录」写文件，ci 方式一律使用替身 `gh`（本地可执行脚本，按用例输出约定的 dispatch 响应、运行状态与 artifact 内容，并记录收到的调用），不访问任何远程服务，不触碰本仓或用户其他项目。

## 一、单元测试（UT）

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|---------|----------|---------|
| UT-S42-01 | 前置与参数拒绝零执行零写入 | 分别构造：无登记表；登记表非法；未传 `--env`；`--env staging` 解析不到；prod 未配置 `deploy`；非 git 仓库；`--ref` 与 `--rollback` 同传；版本通道两者都缺；`--ref nosuch`；`--complete` 与 `--ref` 同传 | 执行 `deploy` | 依次为 `ENV_REGISTRY_NOT_FOUND`、`ENV_REGISTRY_INVALID`、`ENV_REQUIRED`、`ENV_UNKNOWN`、`DEPLOY_NOT_CONFIGURED`、`DEPLOY_GIT_REQUIRED`、`DEPLOY_ARGS_CONFLICT`、`DEPLOY_REF_REQUIRED`、`ENV_REF_UNRESOLVED`、`DEPLOY_ARGS_CONFLICT`，退出码 1；部署脚本未运行（发布目录无痕迹），项目全部文件与运行态目录前后 SHA-256 一致 |
| UT-S42-02 | dry-run 覆盖全部检查且不写任何文件 | prod 配置 script，脚本在目标 tag 中存在且可执行，声明密钥已导出；另一用例为 ci（替身 `gh` 已登录、工作流存在） | `deploy --env prod --ref v1 --dry-run --format json` | 退出码 0、`status=dry-run`，`plan` 给出通道、请求 commit、脚本路径与参数展开（或工作流与调度 ref）；未建工作树、脚本未运行、替身 `gh` 未收到 dispatch；全部文件与运行态目录前后一致；把脚本可执行位去掉、删除密钥变量、令替身 `gh auth status` 失败后，dry-run 分别报 `DEPLOY_SCRIPT_NOT_EXECUTABLE`、`DEPLOY_SECRETS_MISSING`、`DEPLOY_CI_UNAVAILABLE` |
| UT-S42-03 | script 在请求 commit 的隔离工作树中执行 | tag `v1` 与 `v2` 各带一版脚本（脚本把 `OPENLOGOS_DEPLOY_REF`、`OPENLOGOS_DEPLOY_CHANNEL`、`pwd` 下的 `git rev-parse HEAD` 与脚本版本写入发布目录）；HEAD 在 `v2` 之后另有提交，工作区有未提交改动 | `deploy --env prod --ref v1 --format json` | 发布目录记录 `OPENLOGOS_DEPLOY_REF` 与工作树 HEAD 都等于 `v1` 的 commit、脚本版本为 v1 那一版、未包含未提交改动；账本 `channel=version`、`mode=script`、`result=done`、`slug=null`、`ref=ref_requested=v1`、`ref_source=explicit`、`ref_input=v1`；结束后 `deploy-work/<deploy_id>` 不存在；`git worktree list` 无残留 |
| UT-S42-04 | in-place 约束 | prod 配置 `workdir: in-place`；① HEAD 等于请求 commit 且工作区干净；② HEAD 不等于请求 commit；③ 工作区有改动 | `deploy --env prod --ref <rev>` | ① 在当前工作区执行并成功；②③ `DEPLOY_WORKTREE_MISMATCH`、零执行 |
| UT-S42-05 | 脚本失败与超时 | ① 脚本以 3 退出；② 脚本启动一个子进程后休眠超过 `timeout_sec: 2` | `deploy --env prod --ref v1 --format json` | 均 `DEPLOY_FAILED`、退出码 1；① `details.exit_code=3`、`failure_reason=exit-code`；② `timed_out=true`、`failure_reason=timeout`，脚本及其子进程均已不存在；账本追加 `result=failed`、`ref=null` 记录，`current_ref` 不变；`details.log_path` 指向存在的日志 |
| UT-S42-06 | 密钥缺失与遮盖 | prod `secrets: [PROD_TOKEN, AB]`；脚本打印两个变量的值 | ① 不导出 `PROD_TOKEN`；② 导出 `PROD_TOKEN=s3cr3t-value`、`AB=xy` 后部署 | ① `DEPLOY_SECRETS_MISSING`，`details.missing=["PROD_TOKEN"]`，输出中不含任何值，零执行；② 日志、JSON `output_tail` 与文本模式 stdout/stderr 中不出现 `s3cr3t-value`、出现 `***`；长度不足 4 的 `xy` 不做替换 |
| UT-S42-07 | 回滚 | 账本 prod：成功 R1、成功 R2；另一用例 prod 只有一次成功部署 | `deploy --env prod --rollback --format json` | 部署 R1，账本 `rollback=true`、`rollback_from=R2`、`channel=version`；之后 `current_ref=R1`、`previous_ref=R2`；只有一次成功部署时 `DEPLOY_ROLLBACK_TARGET_MISSING`、零执行；`--rollback --channel proposal` 报 `DEPLOY_ARGS_CONFLICT` |
| UT-S42-08 | github-actions 运行身份与结论 | prod 配置 ci github-actions；替身 `gh` 分别：① dispatch 返回 `run_id` 与 URL，轮询两次后 `completed/success`；② 结论 `failure`；③ dispatch 响应不含运行身份；④ 一直 `in_progress`，`timeout_sec: 3` | `deploy --env prod --ref v1 --format json` | 替身记录显示以 `gh api` 调用 dispatch 且带 `return_run_details=true`，**没有**调用运行列表接口；① `result=done`，`ci_run_id` / `ci_run_url` 为响应值；② `DEPLOY_FAILED`、`failure_reason=ci-failure`；③ `DEPLOY_RESULT_UNKNOWN`、`failure_reason=ci-run-id-missing`，未决记录保留；④ `DEPLOY_RESULT_UNKNOWN`、`failure_reason=ci-observe-timeout`，未决记录保留；②③④ `current_ref` 不变 |
| UT-S42-09 | CI 部署版本只认运行回报 | 同 UT-S42-08 ①（运行成功），替身 `gh run download` 分别返回：① `deployed_ref` 等于请求 commit；② `workflow_ref: main`、默认 checkout，回报 main 的 commit；③ 调度提交（`headSha`）等于请求 commit，但回报 checkout 显式检出的另一个 tag 的 commit；④ 不存在 artifact；⑤ 内容不是 JSON；⑥ `workflow_ref: main`、通过 inputs 接收版本并检出，回报请求 commit | `deploy --env prod --ref v1 --format json` | ①⑥ `ref=ref_requested`、`ref_source=ci-reported`；②③④⑤ 退出码 0 但 `ref=null`、`ref_source=unknown`、`warnings` 含 `DEPLOY_REF_UNCONFIRMED`，`ci_reported_ref` 为回报原值（④⑤ 为 null），之后 `current_ref=null`、该记录不能作为 `previous_ref`；`headSha` 与 `workflow_ref` 的取值都不影响结论；②⑥（显式 `workflow_ref: main`，其 commit 不等于请求 commit）替身记录显示确实在 `main` 上发出了 dispatch 并读取了回报，**没有**在触发前以 `DEPLOY_CI_REF_NOT_DISPATCHABLE` 拒绝 |
| UT-S42-10 | github-actions 调度 ref 与 provider: script 协议 | ① 未配置 `workflow_ref`、请求 `v1`（远端 tag 解析为同一 commit）；② 未配置 `workflow_ref`、只给 commit；③ 远端 tag 指向另一 commit；④ provider script：`trigger_script` 输出 `{run_id,url}`、`status_script` 依次输出 `in_progress` 与 `completed/success` 并带 `deployed_ref`；⑤ `trigger_script` 缺 `run_id` | 执行部署 | ① 在 `v1` 上调度；②③ `DEPLOY_CI_REF_NOT_DISPATCHABLE`、零触发；④ `result=done`、`ref_source=ci-reported`；`status_script` 以 `run_id` 为参数被调用；⑤ `DEPLOY_RESULT_UNKNOWN`、`ci-run-id-missing` |
| UT-S42-11 | agent 两段式 | test 配置 `mode: agent`、`plan_section: 测试环境部署` | ① `deploy --env test --format json`；② 再次 `deploy --env test`；③ `--complete <错误 id> --result done`；④ `--complete <deploy_id> --result done`；另一轮 ⑤ `--abandon <deploy_id>` | ① 退出码 0、`status=awaiting-agent`，`plan` 给出部署方案位置与章节，账本无新增；② `DEPLOY_IN_PROGRESS`；③ `DEPLOY_PENDING_NOT_FOUND`；④ 账本追加 `mode=agent`、`result=done`、`ref_source=explicit` 记录，未决记录删除；⑤ 账本追加 `result=unknown`、`failure_reason=abandoned`，环境释放 |
| UT-S42-12 | 本地锁并发与遗留回收 | ① script 部署运行中（脚本休眠）；② 锁文件记录的 pid 已不存在 | ① 期间再次 `deploy --env prod`；② 直接 `deploy --env prod` | ① 第二次 `DEPLOY_IN_PROGRESS`、`details.holder` 含 `deploy_id`、`mode`、`pid`，零执行，第一次照常完成；② 遗留锁被回收，部署正常执行 |
| UT-S42-13 | CI 未决占用不随本地进程退出解除 | 由 UT-S42-08 ④ 留下 `ci-observe-timeout` 的未决记录（记录中的观察进程已退出）；替身 `gh run view` 先返回 `in_progress`、再返回 `completed/success` 并提供回报 artifact | ① `deploy --env prod --ref v1`；② `deploy --env prod --reconcile --format json`；③ 再次 `--reconcile`；④ 另一用例未决记录无 `run_id` 时 `--reconcile` 与 `--abandon`；⑤ 删除 `logos/.openlogos-guard`（无活跃提案）后对版本通道的未决记录执行 `--reconcile`，不传 `--ref`；⑥ `--abandon <错误 deploy_id>` 与 `--abandon <正确 deploy_id>` | ① `DEPLOY_IN_PROGRESS`，`holder.unresolved=true`、`holder.run_id` 为记录值；② `status=still-running`、环境仍占用、账本无新增；③ `status=reconciled`，为同一 `deploy_id` 追加 `reconciled=true`、`result=done`、`ref_source=ci-reported` 的记录，未决记录删除，该 `deploy_id` 以新记录为准；④ `--reconcile` 报告无法查询并保持占用，`--abandon` 后释放；②③⑤⑥ 均**不**因环境被占用而报 `DEPLOY_IN_PROGRESS`、不因未传 `--ref` 而报 `DEPLOY_REF_REQUIRED`、替身 `gh` 未收到新的 dispatch；⑤ 正常补记终态；⑥ 错误 id 报 `DEPLOY_PENDING_NOT_FOUND` 且未决记录不变，正确 id 解除占用 |
| UT-S42-14 | 提案通道首次部署与失败不落标 | 活跃提案处于 ready-to-deploy、verify 通过、`[deploy]` 未勾选，**不存在 `logos/resources/verify/deployment-report.md`**；① 脚本成功；② 脚本失败；③ 另一用例 verify 未通过 | `deploy --env prod --format json` | ① 退出码 0、`channel=proposal`；部署报告文件被创建并含本次 `deploy_id`、请求与已确认版本、结果；`[deploy]` 全勾；`DEPLOY_DONE.deploy_id` 等于账本该次记录的 `deploy_id`，账本只多一条记录；② `DEPLOY_FAILED`，部署报告追加失败结果，`[deploy]` 未勾选、无 `DEPLOY_DONE`、账本 `result=failed`；③ `VERIFY_NOT_PASSED`、零执行 |
| UT-S42-15 | 部署成功而记录失败 | 提案通道脚本成功，注入 deploy-done 写入函数在写 `DEPLOY_DONE` 时失败；版本通道脚本成功，注入账本追加失败 | `deploy --env prod --format json` | 均 `DEPLOY_RECORD_FAILED`、退出码 1，`details.deployed=true`，给出 `deploy_id`、`ref` 与未能写入的记录原文；提案通道 tasks.md、旧 smoke 标记、旧 `DEPLOY_DONE` 按快照恢复；不以未捕获异常退出 |
| UT-S42-16 | 部署执行未启用的项目零回归 | ① 无登记表项目；② 有登记表但所有环境未配置 `deploy`、账本只有 `deploy-done` 写出的记录（部署执行未启用，`spec/environments.md` §1） | 执行既有 `deploy-done`、`smoke`（含有 / 无活跃提案）、`status`、`env list`、`env show` 夹具（沿用 S21 / S19 / S11 / S41 既有用例形态），并与引入本提案前的基线输出比对 | 两种夹具的 JSON 输出（字段集与取值，不含时间戳与随机 id）、退出码、账本字节与提案目录文件都与基线逐字一致：EnvView 不出现 `previous_ref`、`deploy_mode`、`deploy_in_progress`，`last_deploy` 不出现扩展子字段；无活跃提案的 smoke 不写账本。启用后的新增字段与写入由 UT-S41-15、UT-S19-73 以启用夹具单独验证 |
| UT-S42-17 | 部署 skill 分发一致性 | 仓库源文件 `skills/deployment-designer/SKILL.md`、`skills/deployment-executor/SKILL.md` | 读取 `plugin/skills/` 下同名文件与 `cli/asset-manifest.json` 生成器输入 | 两个插件副本存在且与源文件字节一致；asset-manifest 同时登记两个 skill |

## 二、场景测试（ST）

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S42-01 | script 版本通道、回滚与环境视图 | S42 Step 1～12、14、17；EX-42.3 | 真实 CLI；临时 git 项目登记 staging（script）；tag `v1`、`v2` | ① `deploy --env staging --ref v1`；② `deploy --env staging --ref v2`；③ `env show staging --format json`；④ `deploy --env staging --rollback`；⑤ `status --format json` | ①② 成功、发布目录内容为对应版本脚本输出；③ `current_ref=v2`、`previous_ref=v1`、`deploy_mode=script`、`deploy_in_progress=null`；④ 部署 v1、`rollback=true`；⑤ staging 视图与 `env show` 一致且通过 `status.schema.json` 校验 |
| ST-S42-02 | 提案通道部署后 smoke 得到已验证事实 | S42 Step 8、15、16；S19 | 真实 CLI；活跃提案需部署需 smoke、无旧部署报告；smoke runner 读 `OPENLOGOS_SMOKE_ENV` 并写 `target_environment` | ① `deploy --env staging`；② `smoke --env staging --format json`；③ `deploy --env staging --ref <另一 tag> --channel version`；④ `smoke --env staging --format json` | ① 成功、部署报告追加、`DEPLOY_DONE` 写出；② 门禁 PASS、`verified=true`、smoke 记录 `deploy_id` 等于 ① 的 `deploy_id`；④ `SMOKE_DEPLOY_SUPERSEDED`、零副作用 |
| ST-S42-03 | ci 方式端到端（替身 gh）与结果未知恢复 | S42 Step 10、12、17、19；EX-42.8～EX-42.10 | 真实 CLI；staging 配置 ci github-actions；替身 `gh` 第一次运行在观察期内不结束，之后可结束并回报 | ① `deploy --env staging --ref v1 --format json`（观察超时）；② 再次 `deploy --env staging --ref v1`；③ `deploy --env staging --reconcile`（远程已完成）；④ `env show staging --format json` | ① `DEPLOY_RESULT_UNKNOWN`；② `DEPLOY_IN_PROGRESS`；③ `reconciled`；④ `current_ref` 为 v1 的 commit、`last_deploy.result=done`、`deploy_in_progress=null` |
| ST-S42-04 | agent 方式提案通道 | S42 Step 13、18；EX-42.12 | 真实 CLI；活跃提案 ready-to-deploy；test 配置 agent | ① `deploy --env test --format json`；② 写部署报告后 `deploy --env test --complete <deploy_id> --result done`；③ `env show test --format json` | ① `awaiting-agent`；② 写 `DEPLOY_DONE`、`[deploy]` 全勾、账本 `mode=agent`；③ `last_deploy.mode=agent`；② 若部署报告不存在则拒绝且不写任何文件 |

## 三、测试数据与断言要求

- 发布目录、运行态目录、隔离工作树都在一次性临时目录内；用例结束后删除。
- 「零执行」以发布目录无痕迹、替身 `gh` 未收到 dispatch 取证；「零写入」以项目全部文件与运行态目录前后 SHA-256 比对取证。
- 涉及密钥的断言覆盖完整 stdout、stderr、日志与 JSON 输出，以「密钥值字面量不出现」为判据。
- 进程树清理以超时后子进程 pid 不存在取证；涉及进程与权限的用例在不具备能力的平台按既有 skip 口径处理并写明原因。
- JSON 断言以字段与类型为准，不解析人类可读文案；中英文案各至少覆盖一个错误码。

## 四、覆盖度校验

- 验收 1（script 版本通道与隔离工作树）：UT-S42-03、UT-S42-04、ST-S42-01。
- 验收 2（提案通道、首次部署无报告、smoke 已验证）：UT-S42-14、ST-S42-02、ST-S42-04。
- 验收 3（失败、超时、密钥遮盖）：UT-S42-05、UT-S42-06。
- 验收 4（回滚）：UT-S42-07、ST-S42-01。
- 验收 5（ci 运行身份、结论与版本证据）：UT-S42-08、UT-S42-09、UT-S42-10、ST-S42-03。
- 验收 6（agent 两段式）：UT-S42-11、ST-S42-04。
- 验收 7（并发、远程仍运行、reconcile / abandon）：UT-S42-12、UT-S42-13、ST-S42-03。
- 验收 8（dry-run）：UT-S42-02。
- 验收 9（`deploy` 字段非法与零回归）：UT-S42-01、UT-S42-16；字段校验细节见 UT-S41-12。
- 验收 10（账本读取与视图）：ST-S42-01、ST-S42-03；读取口径细节见 UT-S41-13～UT-S41-15、ST-S41-04。
- 验收 11（插件分发）：UT-S42-17。
- 验收 12（smoke 部署身份）：ST-S42-02；细节见 UT-S19-72、UT-S19-73、ST-S19-29。
- 记录失败（C10）：UT-S42-15。
