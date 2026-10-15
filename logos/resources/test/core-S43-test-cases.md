# core-S43: 环境晋级与部署审批测试用例

> 场景：S43 环境晋级与部署审批｜决策：C01～C11，D14｜来源变更：environment-promotion-approval｜格式权威：`spec/environments.md` §12
> 全部测试代码必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`，见 `logos/spec/test-results.md`），测试名包含对应 ID，`scenario_id="S43"`。全部用例在 `mktemp -d` 一次性临时 git 项目中构造：登记表含 test、staging、prod，staging 与 prod 配置 `deploy.mode: script`（部署脚本只向一次性「发布目录」写文件），prod 配置 `promote_from: staging` 与 `require_approval: true`（个别用例另行说明）；上游 smoke 记录以真实 `openlogos smoke --env staging` 产生或直接写入账本构造。guard 相关用例见 `core-S09-test-cases.md` UT-S09-461～UT-S09-466、ST-S09-205。

## 一、单元测试（UT）

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|---------|----------|---------|
| UT-S43-01 | 晋级未验证零执行零写入 | staging 账本：对 X 无 smoke 记录；另一用例只有对 X 的 `verified=false` smoke；第三用例只有对 Y 的 `verified=true` smoke | `deploy --env prod --ref X --format json` | 三例均 `DEPLOY_PROMOTION_UNVERIFIED`、退出码 1；`details` 含 `environment=prod`、`promote_from=staging`、`requested`（X 的 commit）、`upstream_current_ref`、`upstream_candidate_ref`（第三例为 Y）；部署脚本未运行、项目全部文件与运行态目录前后 SHA-256 一致 |
| UT-S43-02 | 上游曾验证即可晋级 | staging 账本：对 X `verified=true`，之后部署并验证 Y（`current_ref=Y`）；prod 已有对 X 的未使用审批 | `deploy --env prod --ref X --format json` | 晋级检查通过，部署成功；deploy 记录 `promoted_from=staging`、`promotion_override_reason=null` |
| UT-S43-03 | `--force-promote` 留痕越过与参数冲突 | staging 未验证 X；prod 有对 X 的未使用审批；test 未配置 `promote_from` | ① `deploy --env prod --ref X --force-promote "hotfix 已人工验证"`；② `--force-promote ""`；③ `deploy --env staging --ref X --force-promote "r"`（staging 未配置 `promote_from`）；④ `deploy --env prod --rollback --force-promote "r"`；⑤ `deploy --env prod --reconcile --force-promote "r"` | ① 成功，记录 `promotion_override_reason="hotfix 已人工验证"`、`promoted_from=null`；②～⑤ 均 `DEPLOY_ARGS_CONFLICT`、零执行 |
| UT-S43-04 | 审批缺失与审批后部署 | staging 已验证 X；prod 无审批 | ① `deploy --env prod --ref X --format json`；② `approve --env prod --ref X --note "发版窗口" --format json`；③ 再次 `deploy --env prod --ref X --format json` | ① `DEPLOY_APPROVAL_REQUIRED`，`details.approve_command` 等于 `openlogos approve --env prod --ref <X 的 40 位 commit>`，零执行零写入；② 账本新增一条 `kind=approval`（`ref` 为 X 的 40 位 commit、`ref_input` 为原写法、`note="发版窗口"`），JSON `created=true`；③ 成功，deploy 记录 `approval_id` 等于 ② 的 `approval_id` |
| UT-S43-05 | 审批的使用、幂等与 commit 绑定 | staging 已验证 X、Y；prod 对 X 有审批 A | ① 部署 X 成功后 `env show prod`；② 再次 `deploy --env prod --ref X`；③ 对 Y 执行 `approve` 后部署 X；④ 对 X 连续两次 `approve` | ① `open_approvals` 不含 A；② `DEPLOY_APPROVAL_REQUIRED`；③ 仍 `DEPLOY_APPROVAL_REQUIRED`（对 Y 的审批不放行 X）；④ 第二次返回与第一次相同的 `approval_id`、`created=false`，账本只多一行 |
| UT-S43-06 | 失败与结果未知不使用审批，成功使用不可撤销 | staging 已验证 X；prod 对 X 有审批 A；部署脚本：① 以 3 退出；② 另一用例 prod 为 ci 方式、替身 `gh` 观察超时；③ 另一用例 prod 为 agent 方式，`--complete --result done` 落账后注入删除未决记录失败（未决记录保留） | 执行部署后 `env show prod`；②中随后 `--reconcile`（远程已成功） | ① `DEPLOY_FAILED`，A 仍在 `open_approvals`，再次部署（脚本改为成功）使用 A；② `DEPLOY_RESULT_UNKNOWN`，A 仍未使用；`--reconcile` 补记 done 后 A 视为已使用；③ 随后 `--abandon <deploy_id>` 解除占用（账本追加 abandoned 记录），A 仍为已使用、不在 `open_approvals`，再次 `deploy --env prod --ref X` 报 `DEPLOY_APPROVAL_REQUIRED` |
| UT-S43-07 | 并发部署不能共用同一审批 | staging 已验证 X；prod 只有对 X 的一份审批 P | 进程内调用部署 A，在既有 `beforeAcquire` 注入点暂停；期间以真实 CLI 完成部署 B（成功、使用 P）；恢复 A | A 以 `DEPLOY_APPROVAL_REQUIRED` 零执行结束（部署脚本只被 B 运行一次）；账本只有 B 的一条 `approval_id=P` 的成功记录；agent 方式同样交错时 A 不登记未决记录、未决记录只属于 B |
| UT-S43-08 | 并发 approve 只写一条 | prod 无审批 | 在账本锁临界区注入点让两个 `approve --env prod --ref X` 交错执行 | 账本只多一条 `approval` 记录，两个调用返回同一 `approval_id`（一个 `created=true`、一个 `created=false`） |
| UT-S43-09 | 回滚与 dry-run | prod 先后成功部署 R1、R2（均经晋级与审批）；staging 从未验证 R1 以外的版本 | ① `deploy --env prod --rollback`（无对 R1 的未使用审批）；② 对 R1 `approve` 后再 `--rollback`；③ 另一用例未审批时 `deploy --env prod --ref X --dry-run`；④ 已审批时 `--dry-run` | ① `DEPLOY_APPROVAL_REQUIRED`（不报晋级错误）；② 成功、`rollback=true`；③ `DEPLOY_APPROVAL_REQUIRED`、零写入；④ 退出码 0、`status=dry-run`，`plan.approval_id` 为该审批、`plan.promotion` 给出 `{from: staging, verified_ref}`；③④ 项目全部文件与运行态目录前后一致，审批未被使用 |
| UT-S43-10 | agent 方式携带审批身份 | prod 改为 `deploy.mode: agent`；staging 已验证 X；prod 对 X 有审批 A | ① 未审批的 Y：`deploy --env prod --ref Y`；② `deploy --env prod --ref X`；③ `--complete <deploy_id> --result done` | ① `DEPLOY_APPROVAL_REQUIRED`（或晋级错误），不登记未决记录；② `awaiting-agent`，未决记录含 `approval_id=A`、`promoted_from=staging`；③ 写出的 `mode=agent` 记录带 `approval_id=A`，A 视为已使用；`--complete` 不重新检查（期间删除 staging 的 smoke 记录不影响 ③） |
| UT-S43-11 | `deploy-done` 对受门环境拒绝 | 活跃提案处于 ready-to-deploy；prod 配置了门，test 未配置门；另一夹具 prod 只写 `require_approval: false` | ① `deploy-done --env prod --ref HEAD --format json`；② `deploy-done --env test --ref HEAD`；③ `require_approval: false` 夹具下 `deploy-done --env prod` | ① `DEPLOY_DONE_GATED_ENV`、退出码 1，tasks.md、smoke 标记、`DEPLOY_DONE` 与账本字节不变；② ③ 与引入前行为一致（成功落标） |
| UT-S43-12 | `approve` 前置拒绝 | 分别构造：无登记表；登记表非法；未传 `--env`；`--env` 解析不到；test 未配置 `require_approval`；`--ref nosuch`；未传 `--ref` | `approve --env … --ref … --format json` | 依次 `ENV_REGISTRY_NOT_FOUND`、`ENV_REGISTRY_INVALID`、`ENV_REQUIRED`、`ENV_UNKNOWN`、`APPROVAL_NOT_REQUIRED`、`ENV_REF_UNRESOLVED`、`APPROVAL_REF_REQUIRED`，退出码 1，账本字节不变 |
| UT-S43-13 | 生成指令硬红线条目 | 中、英两种 locale 的一次性项目 | `openlogos init` 后读取生成的 AGENTS.md / CLAUDE.md | 硬红线条目均包含「目标环境要求审批而该版本未获审批，或晋级检查未通过」的语义（中英文各自措辞），且说明任何模式（含 `--auto`）都不自动放行、不得自行审批或越过 |
| UT-S43-14 | 未配置门禁零回归 | 三种夹具：没有登记表；有登记表但无门；已启用部署执行但无门 | 执行 `env list`、`env show`、`status`、`deploy`（版本通道）、`deploy-done`、`smoke` 的 `--format json` | 输出、退出码与账本字节与引入本提案前的基线逐字一致；未出现 `promote_from`、`require_approval`、`open_approvals`、`promotion`、`approval_id`、`promoted_from`、`promotion_override_reason` |

## 二、场景测试（ST）

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S43-01 | staging → prod 晋级与审批全链路 | S43 Step 1～12；EX-43.1、EX-43.3 | 真实 CLI；tag `v1`；staging 与 prod 配置如前置 | ① `deploy --env prod --ref v1`；② `deploy --env staging --ref v1` 后 `smoke --env staging`（runner 写 `target_environment`）；③ `deploy --env prod --ref v1`；④ `approve --env prod --ref v1`；⑤ `deploy --env prod --ref v1`；⑥ `env show prod --format json` | ① `DEPLOY_PROMOTION_UNVERIFIED`；② smoke `verified=true`；③ `DEPLOY_APPROVAL_REQUIRED`；④ 写入审批；⑤ 成功，记录 `approval_id`、`promoted_from=staging`；⑥ `current_ref` 为 v1 的 commit、`open_approvals` 为空、`promotion.candidate_ref` 为 v1 的 commit |
| ST-S43-02 | 上游已前进时补发已验证版本 | EX-43.2 | ST-S43-01 结束状态；tag `v2` | ① staging 部署并验证 v2；② `approve --env prod --ref v2`、部署 v2；③ `approve --env prod --ref v1`、`deploy --env prod --ref v1` | ① ② 成功；③ 晋级检查通过（staging 曾验证 v1）、部署成功，`current_ref` 回到 v1 |
| ST-S43-03 | `--auto` 停点与审批后续跑 | S43 Step 7～11；EX-43.9 | 一次性项目中活跃提案处于 ready-to-deploy，部署方案目标为 prod；以 deployment-executor 的部署调用序列模拟宿主驱动（`permission_mode=bypassPermissions`） | ① 执行 `deploy --env prod --format json`；② 以 guard-check 判定 `openlogos approve --env prod --ref HEAD`（bypassPermissions）；③ 用户在终端执行 `approve`；④ 重新执行 ① | ① `DEPLOY_APPROVAL_REQUIRED`，`next` 仍停在 ready-to-deploy（未写 `DEPLOY_DONE`）；② guard exit 2；③ 写入审批；④ 成功并写 `DEPLOY_DONE`，`next` 进入 ready-to-smoke |
| ST-S43-04 | 改门绕道被封堵 | EX-43.10、EX-43.11 | prod 配置了门；`permission_mode=bypassPermissions`；存在活跃提案 | ① 以 guard-check 判定 Edit `logos/environments.yaml`（删去 `require_approval`）；② 判定 Bash `rm logos/environments.yaml`；③ `deploy-done --env prod --ref HEAD`；④ `deploy --env prod --ref X`（未审批） | ① ② guard exit 2，登记表字节不变；③ `DEPLOY_DONE_GATED_ENV`；④ `DEPLOY_APPROVAL_REQUIRED`；全过程无部署脚本运行、无 `DEPLOY_DONE` |

## 三、测试数据与断言要求

- 发布目录、运行态目录与隔离工作树都在一次性临时目录内；用例结束后删除。
- 「零执行」以发布目录无痕迹取证；「零写入」以项目全部文件与运行态目录前后 SHA-256 比对取证。
- 确定性交错（UT-S43-07、UT-S43-08）使用进程内注入点暂停一方、以真实 CLI 进程执行另一方，不依赖时序竞争。
- 审批与部署记录以账本中的结构化字段断言，不解析人类可读文案；中英文案各至少覆盖一个错误码。
- guard 判定以真实 `plugin/bin/guard-check` 脚本与构造的 PreToolUse 输入执行，不访问真实宿主。

## 四、覆盖度校验

- 验收 1（两个字段校验）：UT-S41-16（细节）、ST-S43-01。
- 验收 2（晋级未验证 / 曾验证即可）：UT-S43-01、UT-S43-02、ST-S43-02。
- 验收 3（`--force-promote` 与参数冲突）：UT-S43-03。
- 验收 4（审批缺失与审批后部署）：UT-S43-04、ST-S43-01。
- 验收 5（审批使用、幂等、commit 绑定、failed / unknown 不使用、成功使用不可撤销）：UT-S43-05、UT-S43-06；读取口径细节见 UT-S41-18。
- 验收 6（回滚与 dry-run）：UT-S43-09。
- 验收 7（agent 方式）：UT-S43-10。
- 验收 8（guard 受限命令）：ST-S43-03；细节见 UT-S09-461～UT-S09-463、UT-S09-466。
- 验收 9（`deploy-done` 受门拒绝）：UT-S43-11、ST-S43-04。
- 验收 10（未配置门禁零回归与视图）：UT-S43-14；细节见 UT-S41-19、ST-S41-05。
- 验收 11（指令与 skill）：UT-S43-13。
- 验收 12（并发与 approve 幂等）：UT-S43-07、UT-S43-08。
- 验收 13（门禁配置受人确认保护）：ST-S43-04；细节见 UT-S09-464、UT-S09-465、ST-S09-205。
- `approve` 前置拒绝：UT-S43-12。
