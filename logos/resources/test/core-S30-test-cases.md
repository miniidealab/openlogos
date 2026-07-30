# S30: cmd: 放开到 verify/deploy/smoke gate — 测试用例

> 复用 S22/S26/S27 临时项目 overlay 模式（`makeTempRoot` + `scaffoldProject` + 写 `root/logos/flow/<lifecycle>.yaml`）：
> launched fixture + overlay `modify` 把 `verify`/`deploy`/`smoke` 的 `done_when`/`fail_when` 改 `cmd:<command>`；cmd 执行/超时/drain 整体复用 S26 `flow-cmd.ts`（`cmd:true`=exit 0、`cmd:exit 3`/`cmd:false`=非 0、`cmd:sleep N`+`cmd_timeout_seconds`=超时）。
> marker 类前置用预写 `VERIFY_PASS`/`VERIFY_FAIL`/`DEPLOY_DONE`/`SMOKE_PASS` 等账本文件构造；status/watch 断言「命令未被调用」（无副作用）。
> 不改 `spec/flow/*.yaml`、真实 `logos/flow/`、`golden-baseline.test.ts` fixture。含 OpenLogos reporter（用例名须带 `UT-S30-*` / `ST-S30-*` 供抽取）。
> **golden 零漂移**：放开仅经 overlay `modify` opt-in；无 overlay（builtin 仍 marker:）→ status/next/watch/flow show 快照**必须逐字节不变**、**不输出 `cmd_gate`**。

## 一、单元测试用例

| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S30-01 | 白名单：verify.done_when→cmd: 合法 | launched + modify `verify.done_when=cmd:gh pr checks` | 加载 resolved flow | 解析通过；verify 标记为 cmd gate（done_when 字段为 cmd 描述符） |
| UT-S30-02 | 白名单：verify.fail_when→cmd: 合法 | modify `verify.fail_when=cmd:<检查>`（done_when 仍 marker） | 加载 resolved flow | 解析通过；fail_when 为 cmd、done_when 仍 marker（per-field） |
| UT-S30-03 | 白名单：smoke.done_when→cmd: 合法 | modify `smoke.done_when=cmd:<脚本>` | 加载 resolved flow | 解析通过；smoke 标记为 cmd gate |
| UT-S30-04 | 白名单：smoke.fail_when→cmd: 合法 | modify `smoke.fail_when=cmd:<检查>` | 加载 resolved flow | 解析通过；smoke.fail_when 为 cmd |
| UT-S30-05 | 白名单：deploy.done_when→cmd: 合法 | modify `deploy.done_when=cmd:<部署校验>` | 加载 resolved flow | 解析通过；deploy 标记为 cmd gate |
| UT-S30-06 | deploy.fail_when→cmd: → fail loud（deploy 无 fail_when） | modify `deploy.fail_when=cmd:<检查>` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`，message 指出 deploy 无 fail_when、不支持 fail_when:cmd |
| UT-S30-07 | 其它 builtin（code）任意字段改 cmd: → fail loud | modify `code.done_when=cmd:true` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`，message 指出仅 verify/deploy/smoke 可接 cmd: |
| UT-S30-08 | 其它 builtin（write-proposal）改 cmd: → fail loud | modify `write-proposal.done_when=cmd:true` | 加载 resolved flow | `FLOW_SCHEMA_INVALID` |
| UT-S30-09 | 其它 builtin（archive）改 cmd: → fail loud | modify `archive.done_when=cmd:true` | 加载 resolved flow | `FLOW_SCHEMA_INVALID` |
| UT-S30-10 | initial builtin（prd 类节点）改 cmd: → fail loud | initial fixture + modify 某 initial 节点 `done_when=cmd:true` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`（initial 全部不可接 cmd:） |
| UT-S30-11 | 决策 B：verify 同节点 done_when+fail_when 双 cmd: → fail loud | modify `verify.done_when=cmd:a` + `verify.fail_when=cmd:b` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`，message 指出同节点不得双 cmd: |
| UT-S30-12 | 决策 B：smoke 同节点双 cmd: → fail loud | modify `smoke.done_when=cmd:a` + `smoke.fail_when=cmd:b` | 加载 resolved flow | `FLOW_SCHEMA_INVALID` |
| UT-S30-13 | 空命令 → fail loud | modify `verify.done_when="cmd:"` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`，message 指出 cmd 命令不得为空 |
| UT-S30-40 | initial 的 verify/deploy/smoke 改 cmd: → fail loud（cmd: 仅 launched gate） | initial.yaml modify `verify.done_when="cmd:true"` | 加载 resolved initial flow | `FLOW_SCHEMA_INVALID`（lifecycle≠launched） |
| UT-S30-14 | per-field/B3：done_when:cmd + fail_when:marker:VERIFY_FAIL，VERIFY_FAIL 存在 → status failed | modify `verify.done_when=cmd:gh pr checks` + `fail_when=marker:VERIFY_FAIL`；预写 `VERIFY_FAIL` | `status --format json`（不执行 cmd） | verify `failed`（fail 优先、非 cmd 字段照常）；命令未被调用 |
| UT-S30-15 | per-field/B3：同上但 VERIFY_FAIL 不存在 → status pending（停门前） | 同上但不写 `VERIFY_FAIL` | `status --format json` | verify `pending`、proposal_step=`ready-to-verify`；命令未被调用 |
| UT-S30-16 | per-field/B3：done_when:marker:VERIFY_PASS + fail_when:cmd，VERIFY_PASS 存在 → done 且 next 不求值 fail_when:cmd（非前沿） | modify `verify.done_when=marker:VERIFY_PASS` + `fail_when=cmd:true`；预写 `VERIFY_PASS` | `next --format json` | verify `done`、续推；`fail_when:cmd` **未被执行**（断言无副作用、无 cmd 结果字段指向 verify.fail_when） |
| UT-S30-17 | per-field/B3：同上但 VERIFY_PASS 不存在 → pending 且 next 求值 fail_when:cmd | 同上但不写 `VERIFY_PASS` | `status` 与 `next --format json` | status `pending`（前沿）；next 求值 `fail_when:cmd`（exit 0 → failed；未命中仍因 done_when marker 缺失停门前） |
| UT-S30-41 | done_when:cmd + fail_when:marker:VERIFY_FAIL，VERIFY_FAIL 存在 → 无 cmd_gate、next 不执行 done cmd（frontier） | modify `verify.done_when="cmd:exit 99"` + 写 VERIFY_FAIL | `status` 与 `next --format json` | status proposal_step=`verify-failed`、**无 cmd_gate**；next `cmd_node_id≠verify`（done cmd 未执行）、proposal_step=`verify-failed` |
| UT-S30-18 | status：cmd gate observe → pending、不执行、输出 cmd_gate（顶层/legacy） | legacy 无 modules[] fixture + modify `verify.done_when=cmd:gh pr checks` | `status --format json` | verify `pending`、proposal_step=`ready-to-verify`；顶层 `cmd_gate={node_id:"verify",field:"done_when",command:"gh pr checks",timeout_seconds}`；命令未被调用 |
| UT-S30-19 | status：有 modules[] → 只挂 modules[].cmd_gate、**顶层不输出**（不回退） | 多模块 launched fixture + modify `verify.done_when="cmd:gh pr checks"`（非空命令） | `status --format json` | `modules[].cmd_gate` 存在且与 `active_change` 平级（**不**在其下）；**顶层无 `cmd_gate` 键**（有 modules[] 时不回退顶层）；命令未被调用 |
| UT-S30-20 | watch：首 tick cmd gate → pending、不执行、输出 cmd_gate | 同 UT-S30-18 fixture | `watch`（初次 tick，json） | 与 status 一致：pending、`cmd_gate` 输出、命令未调用 |
| UT-S30-21 | next：done_when:cmd exit 0 → 瞬态推进过门（按部署决策落点） | **proposal 声明需要部署（`deployment_required=true`）** + modify `verify.done_when="cmd:true"` | `next --format json` | 本次 envelope proposal_step=`ready-to-deploy`（**需部署 → 过门落 ready-to-deploy**；若 `deployment_required!==true` 则落 `verify-passed`，见 `flow-derive` 部署决策）；`cmd_node_id:"verify"`/`cmd_predicate_field:"done_when"`/`cmd_satisfied:true`；`next_node` R3 续推 |
| UT-S30-22 | next：done_when:cmd 非 0 → 停门前 | modify `verify.done_when=cmd:exit 3` | `next --format json` | proposal_step=`ready-to-verify`（停门前）；`cmd_exit_code:3`/`cmd_satisfied:false`；`next_node` 指向 verify |
| UT-S30-23 | next：无部署提案 done_when:cmd exit 0 → verify-passed（按部署决策落点） | `deployment_required≠true` + modify `verify.done_when=cmd:true` | `next --format json` | proposal_step=`verify-passed`（无部署→落 verify-passed）；`cmd_node_id:"verify"`/`cmd_satisfied:true` |
| UT-S30-24 | next：fail_when:cmd exit 0 → verify-failed（瞬态失败、非推进） | modify `verify.done_when=marker:VERIFY_PASS`(不写) + `fail_when=cmd:true` | `next --format json` | proposal_step=`verify-failed`（瞬态失败、非推进）；`cmd_predicate_field:"fail_when"`/`cmd_satisfied:true`；不续推 |
| UT-S30-25 | next：deploy.done_when:cmd exit 0（已 verify-pass、需部署、[deploy] 未勾选）→ 过门推进、不被 deployTasksChecked 拦（High） | VERIFY_PASS + deploy:true（[deploy] 未勾选）+ modify `deploy.done_when=cmd:true` | `next --format json` | proposal_step≠`ready-to-deploy`（cmd 为 deploy 唯一裁判）；`cmd_node_id:"deploy"`/`cmd_satisfied:true`；前沿越过 deploy → 不挂 cmd_gate |
| UT-S30-26 | next：smoke.done_when:cmd（已 deploy-done、smoke 前沿）→ 求值 smoke cmd | launched 到 smoke 前沿（VERIFY_PASS+DEPLOY_DONE）+ modify `smoke.done_when=cmd:true` | `next --format json` | `cmd_node_id:"smoke"`/`cmd_predicate_field:"done_when"`；按 exit 求值 smoke cmd |
| UT-S30-27 | next/status 有意不一致：next 瞬态 ready-to-deploy 后 status 回 ready-to-verify（不写 marker） | **proposal 声明需要部署（`deployment_required=true`）** + modify `verify.done_when="cmd:true"` | 先 `next` 再 `status`（均 json） | next：proposal_step=`ready-to-deploy`（需部署→过门落 ready-to-deploy）；磁盘**无新增 marker**（无 VERIFY_PASS/DEPLOY_DONE）；随后 status：proposal_step 回 `ready-to-verify` + `cmd_gate` 复现 |
| UT-S30-28 | next 不写 marker：fail_when:cmd exit 0 也不写 *_FAIL | modify `verify.fail_when=cmd:true`(done_when 仍 marker、不写) | `next` 后检查磁盘 | proposal_step=`verify-failed`；磁盘**无** `VERIFY_FAIL` 等 marker 新增 |
| UT-S30-29 | F·loop 正交：激活 loop（implement max_iters:2）+ verify.done_when=cmd → fail loud | overlay `set-loop implement set:{max_iters:2}` + modify `verify.done_when=cmd:true` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`，message 指出激活 loop 与 verify cmd gate 互斥 |
| UT-S30-30 | F·loop 正交：激活 loop + verify.fail_when=cmd → fail loud（不区分字段） | `set-loop implement set:{max_iters:2}` + modify `verify.fail_when=cmd:true` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`（严格版：verify 任一字段含 cmd 即互斥） |
| UT-S30-31 | F·loop 正交反向回归：未激活 loop（max_iters:1）+ verify cmd → 合法 | `set-loop implement set:{max_iters:1}` + modify `verify.done_when=cmd:true` | 加载 resolved flow | 解析通过（仅激活 loop 才冲突） |
| UT-S30-32 | F·loop 正交：deploy/smoke cmd + 激活 loop → 不冲突（无 loop 子流程） | `set-loop implement set:{max_iters:2}` + modify `deploy.done_when=cmd:true` | 加载 resolved flow | 解析通过（deploy 在 deliver、无 loop） |
| UT-S30-33 | 可达性：deployment_required=false → deploy builtin cmd 绝不执行 | 提案声明无需 deploy + modify `deploy.done_when=cmd:true` | `next --format json` | deploy 不可达 → 命令**未被调用**；无 `cmd_node_id:"deploy"` 结果字段 |
| UT-S30-34 | 可达性：smoke_required=false → smoke builtin cmd 绝不执行 | 提案声明无需 smoke + modify `smoke.done_when=cmd:true` | `next --format json` | smoke 不可达 → 命令**未被调用** |
| UT-S30-35 | budget 顺序：前 overlay-add cmd + 后 builtin cmd gate → budget=1 先执行前者、后者 pending | overlay add cmd 节点（前）+ modify `verify.done_when=cmd:true`（后） | `next --format json` | 按 flow 顺序仅执行**前**的 overlay-add cmd；verify 命令**未被调用**、verify 保持 pending + `cmd_gate` |
| UT-S30-36 | golden 零漂移：无 overlay（builtin marker:）→ 不输出 cmd_gate | builtin launched fixture（verify/deploy/smoke 仍 marker:） | `status`/`next`/`watch`/`flow show --resolved`（均 json） | 全部快照逐字节不变；**无** `cmd_gate` 字段 |
| UT-S30-37 | 决策 G·deploy-done 承认 cmd-gate verify（done_when:cmd exit 0 → 放行） | 需部署提案 + modify `verify.done_when="cmd:true"`、**无 VERIFY_PASS marker** | `deploy-done --format json` | deploy-done 求值 verify cmd（exit 0）→ **不报 `VERIFY_NOT_PASSED`**、按部署流程放行（写 DEPLOY_DONE） |
| UT-S30-38 | 决策 G·deploy-done：cmd-gate verify done_when:cmd 非 0 → 拒 | 需部署提案 + modify `verify.done_when="cmd:exit 3"`、无 VERIFY_PASS | `deploy-done --format json` | `VERIFY_NOT_PASSED`（带 cmd 上下文）；不写 DEPLOY_DONE |
| UT-S30-39 | 决策 G·回归：marker verify（无 overlay）→ deploy-done 行为不变 | 需部署提案 + verify 仍 marker:、预写 VERIFY_PASS | `deploy-done --format json` | 与现状逐字节等价：VERIFY_PASS 存在 → 放行；VERIFY_FAIL 存在 → `VERIFY_NOT_PASSED` |
| UT-S30-42 | deploy-done 遇非法 overlay → FLOW_SCHEMA_INVALID（不吞错、不写 DEPLOY_DONE） | 非法 overlay（modify code done_when:cmd:）+ VERIFY_PASS 存在 | `deploy-done --format json` | error envelope `FLOW_SCHEMA_INVALID`、非零退出；**不写 DEPLOY_DONE**（即便磁盘有 VERIFY_PASS） |
| UT-S30-43 | next --module <其它模块> → 不执行活跃提案模块的 cmd gate（High） | 多模块（core 有活跃提案 + verify done_when:cmd:touch SENTINEL）；`next('json','m1')` | `next --format json --module m1` | core 的 verify cmd **绝不执行**（无 SENTINEL 副作用）；不因顶层回退触发隐藏模块的命令 |
| UT-S30-44 | deploy-done + 非法 flow.cmd_timeout_seconds + verify cmd → FLOW_SCHEMA_INVALID（不写 DEPLOY_DONE） | `flow.cmd_timeout_seconds:0` + modify `verify.done_when=cmd:true` | `deploy-done --format json` | error envelope `FLOW_SCHEMA_INVALID`、非零退出；**不写 DEPLOY_DONE**（执行 cmd / 写 marker 前 fail loud） |
| UT-S30-45 | deploy-done cmd verify 失败 → 错误 message 带 cmd 上下文 | modify `verify.done_when=cmd:exit 4` | `deploy-done --format json` | `VERIFY_NOT_PASSED`，message 含 `verify.done_when`/命令/`exit 4`；不写 DEPLOY_DONE |
| UT-S30-46 | next --module <非活跃模块> → 顶层 active_change/proposal_step 与过滤模块收敛（不泄漏 High） | 多模块（core 有活跃提案）；`next('json','m1')` | `next --format json --module m1` | 顶层 `active_change`/`proposal_step`/`action`/`detail` 来自 m1（不泄漏 core 的 feat/ready-to-verify） |
| UT-S30-47 | deploy-done text 模式错误输出人类文本（非 JSON envelope） | text 模式 + cmd-gate verify 失败（exit 4） | `deploy-done`（text） | stderr 为 `Error: …`（含 cmd 上下文），非 JSON envelope |
| UT-S30-48 | next --module <非活跃模块> --auto → 不给其它模块写 GATE_AUTO_PASSED（High） | 多模块（core 在 ready-to-merge 可跳 gate）；`next('json','m1',true)` | `next --auto --module m1` | `gate_auto_passed` 非 true；**不向 core 的 GATE_AUTO_PASSED 追加**（auto 在非活跃模块禁用） |
| UT-S30-49 | builtin cmd gate 路径 flow 错误 text 模式 → 人类文本（非 JSON） | loop + verify cmd（FLOW_SCHEMA_INVALID）+ text 模式 | `next`（text） | stderr 为 `✖ flow 配置错误（FLOW_SCHEMA_INVALID）…`，非 JSON envelope |
| UT-S30-50 | deploy+smoke + verify cmd 通过 → deploy-done next_step=ready-to-smoke（cmdEval 回灌，High） | deploy:true+smoke:true + 部署报告 + deploy 勾选 + verify.done_when:cmd:true | `deploy-done --format json` | 写 DEPLOY_DONE；`next_step=ready-to-smoke`（不误报 deploy-done/可归档；cmdEval 回灌 detect） |
| UT-S30-51 | 无需部署 + verify cmd → DEPLOYMENT_NOT_REQUIRED 且 cmd 不执行（纯读前置先于 cmd，Medium） | 无部署提案 + verify.done_when:cmd:touch SENTINEL | `deploy-done` | `DEPLOYMENT_NOT_REQUIRED` 退出；**verify cmd 不执行**（无 SENTINEL 副作用） |
| UT-S30-52 | 缺部署报告 + verify cmd → DEPLOYMENT_REPORT_MISSING 且 cmd 不执行 | deploy:true（不写部署报告）+ verify.done_when:cmd:touch SENTINEL | `deploy-done` | `DEPLOYMENT_REPORT_MISSING` 退出；verify cmd 不执行 |
| UT-S30-53 | marker verify（无 overlay）缺 VERIFY_PASS + 缺部署报告 → VERIFY_NOT_PASSED（保 S21 旧顺序，Medium） | deploy:true、verify 仍 marker、无 VERIFY_PASS、无部署报告 | `deploy-done` | `VERIFY_NOT_PASSED`（marker verify 先于部署报告校验，逐字节等价 S21），不报 DEPLOYMENT_REPORT_MISSING |
| UT-S30-54 | next：smoke.fail_when:cmd exit 0 → smoke-failed（瞬态失败、非推进） | launched 到 smoke 前沿 + modify `smoke.fail_when=cmd:true`（done_when 仍 marker:SMOKE_PASS 未写） | `next --format json` | proposal_step=`smoke-failed`；`cmd_node_id:"smoke"`/`cmd_predicate_field:"fail_when"`/`cmd_satisfied:true` |
| UT-S30-55 | next：done_when:cmd 超时 → 停门前不崩溃（cmd_timed_out） | modify `verify.done_when=cmd:sleep 5` + `cmd_timeout_seconds:1` | `next --format json` | `cmd_timed_out:true`/`cmd_satisfied:false`；proposal_step=`ready-to-verify`；进程被杀不挂住 |
| UT-S30-56 | status/watch：legacy 无 modules[] + 活跃提案 + verify.done_when:cmd → 顶层 cmd_gate（§3.8f，High） | `setLegacy`（无 modules[]）+ 活跃提案 + modify `verify.done_when=cmd:gh pr checks` | `status --format json` | `modules` 省略；`lifecycle=launched`；顶层 `cmd_gate{node_id:"verify",field:"done_when",command}` |
| UT-S30-57 | deploy-done：按 resolved verify 自定义 marker 名判定（S25）→ CUSTOM_VERIFY 命中即过 verify（High） | modify `verify.done_when=marker:CUSTOM_VERIFY` + 写 CUSTOM_VERIFY（无 VERIFY_PASS）+ deploy:true（[deploy] 勾选、有部署报告） | `deploy-done` | 不报 VERIFY_NOT_PASSED；写 DEPLOY_DONE |
| UT-S30-58 | deploy-done：自定义 marker verify 未命中（仅旧 VERIFY_PASS 在）→ VERIFY_NOT_PASSED（不认硬编码名） | modify `verify.done_when=marker:CUSTOM_VERIFY` + 仅写 VERIFY_PASS（无 CUSTOM_VERIFY）+ deploy:true | `deploy-done` | `VERIFY_NOT_PASSED`（resolved done marker 是 CUSTOM_VERIFY） |
| UT-S30-59 | deploy-done：非法 resolved verify 谓词（file:）→ FLOW_SCHEMA_INVALID（与 status 一致、不写 DEPLOY_DONE，Medium） | modify `verify.done_when=file:logos/X`（非 cmd:/marker:）+ deploy:true | `deploy-done` | `FLOW_SCHEMA_INVALID`（非 VERIFY_NOT_PASSED）；不写 DEPLOY_DONE |

## 二、场景测试用例（ST，端到端 next / status / watch）

| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| ST-S30-01 | verify gate 接 `cmd:gh pr checks`：status 停门前 + cmd_gate | launched（有 modules[]）到 verify 前沿 + modify `verify.done_when=cmd:gh pr checks` | `status --format json` | proposal_step=`ready-to-verify`；`modules[].cmd_gate={node_id:"verify",field:"done_when",command:"gh pr checks"}`（**顶层不输出**，挂载契约见 UT-S30-18/19）；命令未执行 |
| ST-S30-02 | verify cmd 通过 → next 瞬态推进、续推 | **proposal 声明需要部署（`deployment_required=true`）** + modify `verify.done_when="cmd:true"`（命令 exit 0） | `next --format json` | proposal_step 瞬态=`ready-to-deploy`（需部署；若 `deployment_required!==true` 则 `verify-passed`）；`cmd_satisfied:true`；`next_node` 续推；磁盘无新增 marker |
| ST-S30-03 | verify cmd 未过 → next 卡门前、重试提示 | modify `verify.done_when=cmd:false`（exit 1） | `next --format json` | success envelope；proposal_step=`ready-to-verify`；`cmd_satisfied:false`；提示修复后重试 |
| ST-S30-04 | verify fail_when:cmd 命中 → next 瞬态 verify-failed | modify `verify.done_when=marker:VERIFY_PASS`(不写) + `fail_when=cmd:true` | `next --format json` | proposal_step=`verify-failed`（瞬态、非推进）；不写 marker |
| ST-S30-05 | next/status 不一致端到端 | **proposal 声明需要部署（`deployment_required=true`）** + modify `verify.done_when="cmd:true"` | `next` 后 `status`（均 json） | next 门后态 `ready-to-deploy`（需部署落点）；status 回 `ready-to-verify` + `cmd_gate` 复现（停门前持久态） |
| ST-S30-06 | deploy gate 接 cmd：status 停门前 + next 推进 | **proposal 声明需要部署（`deployment_required=true`，deploy 未被 when 跳过）**、launched 到 deploy 前沿 + modify `deploy.done_when="cmd:true"` | `status` 后 `next`（json） | status `ready-to-deploy`（deploy 前沿持久态）+ `cmd_gate{node_id:"deploy",field:"done_when"}`；next exit 0 → 推进过门、续推 |
| ST-S30-07 | deploy gate 接 cmd：cmd 通过 → next 推进过门 | launched 到 deploy 前沿 + modify `deploy.done_when=cmd:true` | `next --format json` | cmd exit 0 → 推进过门、续推；`cmd_node_id:"deploy"` |
| ST-S30-08 | smoke gate 接 cmd：status 停门前 + cmd_gate | launched 到 smoke 前沿 + modify `smoke.done_when=cmd:true` | `status --format json` | smoke 停门前 + `cmd_gate{node_id:"smoke",field:"done_when"}`；命令未调用 |
| ST-S30-09 | budget=1 端到端：前 overlay-add cmd + 后 verify cmd gate | overlay add cmd 节点 + modify `verify.done_when=cmd:true` | `next --format json` | 仅执行前者；verify 保持 pending + `cmd_gate`；单条合法 envelope |
| ST-S30-10 | 可达性端到端：无需 deploy/smoke → 命令绝不执行 | 提案 deployment_required/smoke_required=false + modify deploy/smoke done_when=cmd:true | `next` 直至完成（json） | 全程 deploy/smoke 命令未调用；流程正常收敛 |
| ST-S30-11 | loop 冲突 fail loud 端到端 | `set-loop implement set:{max_iters:2}` + modify `verify.done_when=cmd:true` | `status --format json` | error envelope `FLOW_SCHEMA_INVALID`、非零退出；指出 loop 与 verify cmd gate 互斥 |
| ST-S30-12 | golden 零漂移 | 无任何 overlay（builtin marker:） | `status`/`next`/`watch`/`flow show --resolved --format json` | 全部快照与基线逐字节一致；**无** `cmd_gate` |

## 三、覆盖度校验清单
- [x] 白名单合法/非法（含 initial gate 拒绝）：UT-S30-01~13/40、ST-S30-11
- [x] per-field（B3 frontier，含 fail:marker 命中不执行 done cmd）：UT-S30-14~17/24/41
- [x] status/watch 停门前 + cmd_gate 挂载（modules[]→只挂 modules[]、顶层不输出；legacy 无 modules[]→顶层回退 §3.8f）：UT-S30-18/19/20/56、ST-S30-01/06/08
- [x] next 求值矩阵（done exit0/非0/超时、fail exit0、smoke fail→smoke-failed）：UT-S30-21~26/54/55、ST-S30-02/03/04/07
- [x] next 不写 marker + next/status 有意不一致：UT-S30-27/28、ST-S30-05
- [x] F·loop 正交（互斥/反向回归/deploy-smoke 不冲突）：UT-S30-29~32、ST-S30-11
- [x] 可达性（无需 deploy/smoke 绝不执行）：UT-S30-33/34、ST-S30-10
- [x] budget=1 共享顺序：UT-S30-35、ST-S30-09
- [x] golden 零漂移（无 cmd_gate）：UT-S30-36、ST-S30-12
- [x] 决策 G·deploy-done 承认 cmd-gate verify（放行/拒/marker 回归/cmdEval 回灌 next_step）：UT-S30-37/38/39/50
- [x] deploy-done 健壮性（非法 overlay/timeout 不吞错、纯读前置先于 cmd、错误码+cmd 上下文、text/json 格式、marker S21 顺序、resolved 自定义 marker、非法谓词与 status 一致）：UT-S30-42/44/45/47/49/51/52/53/57/58/59
- [x] --module 隔离（不跑他模块 cmd、不泄漏顶层 active_change、--auto 不写他模块 GATE_AUTO_PASSED）：UT-S30-43/46/48
