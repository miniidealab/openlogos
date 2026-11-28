# S21: 标记部署完成 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S21-01 | 解析 guard 定位活跃提案 | deploy-done command | 存在 `logos/.openlogos-guard` | root path | 返回 slug 和 proposalDir |
| UT-S21-02 | 缺少 VERIFY_PASS 时拒绝写 DEPLOY_DONE | deploy-done preflight | 活跃提案缺少 `VERIFY_PASS` | deploy-done | 失败且不写 marker |
| UT-S21-03 | 存在 VERIFY_FAIL 时拒绝写 DEPLOY_DONE | deploy-done preflight | 活跃提案存在 `VERIFY_FAIL` | deploy-done | 失败且不写 marker |
| UT-S21-04 | 部署决策冲突时拒绝写 DEPLOY_DONE | deployment decision | proposal/tasks 冲突 | deploy-done | 失败并输出冲突原因 |
| UT-S21-05 | 缺少 `[deploy]` section 时拒绝写 DEPLOY_DONE | tasks parser | 提案声明需要部署但 tasks 缺少 `[deploy]` | deploy-done | 失败且不写 marker |
| UT-S21-06 | 缺少部署报告时拒绝写 DEPLOY_DONE | deploy report gate | 缺少 `deployment-report.md` | deploy-done | 失败且不写 marker |
| UT-S21-07 | 成功时勾选 `[deploy]` 并写入 DEPLOY_DONE | deploy-done command | 前置条件满足 | deploy-done | `[deploy]` 全勾，`DEPLOY_DONE` 存在 |
| UT-S21-08 | 成功时清理旧 smoke marker | deploy-done command | 存在旧 `SMOKE_PASS` / `SMOKE_FAIL` | deploy-done | 删除旧 smoke marker |
| UT-S21-09 | JSON 输出包含部署完成摘要 | deploy-done json | 前置条件满足 | deploy-done --format json | 输出 slug、marker_path、deploy_tasks、next_step |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S21-01 | 需要 smoke 的提案部署完成后进入 ready-to-smoke | Step 1→10 | 活跃提案 `VERIFY_PASS`、需要部署和 smoke、存在部署报告 | `openlogos deploy-done --env staging` → `openlogos status --format json` | 写入 `DEPLOY_DONE`，`proposal_step=ready-to-smoke` |
| ST-S21-02 | 无需 smoke 的提案部署完成后进入 deploy-done | Step 1→10 | 活跃提案 `VERIFY_PASS`、需要部署但无需 smoke、存在部署报告 | `openlogos deploy-done` → `openlogos next --format json` | `proposal_step=deploy-done`，建议 archive |
| ST-S21-03 | deploy-done 不执行实际部署命令 | Step 1→10 | 部署报告已存在 | `openlogos deploy-done` | 不调用 build/push/ssh/npm publish 等外部部署命令，只写状态文件 |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S21-EX-2.1 | 项目未初始化 | EX-2.1 | 缺少 `logos/logos.config.json` | `openlogos deploy-done` | 输出项目未初始化错误 |
| ST-S21-EX-3.1 | 缺少活跃提案 | EX-3.1 | 缺少 guard | `openlogos deploy-done` | 输出无活跃提案错误 |
| ST-S21-EX-4.1 | verify 未通过 | EX-4.1 | 缺少 `VERIFY_PASS` 或存在 `VERIFY_FAIL` | `openlogos deploy-done` | 不写 `DEPLOY_DONE` |
| ST-S21-EX-5.1 | 部署决策冲突 | EX-5.1 | proposal/tasks 冲突 | `openlogos deploy-done` | 输出冲突原因，不写 marker |
| ST-S21-EX-5.2 | 提案无需部署 | EX-5.2 | `deployment_required=false` | `openlogos deploy-done` | 提示无需部署，不写 marker |
| ST-S21-EX-6.1 | 部署报告缺失 | EX-6.1 | 缺少 `deployment-report.md` | `openlogos deploy-done` | 提示先生成部署报告，不写 marker |

## S21 唯一 writer 与消费侧收口回归测试

> S21 场景文档本次由缺失补齐为完整文档（`core-S21-deploy-done-marker.md` CREATE）。`openlogos deploy-done` 的**命令自身行为零变化**——既有 `UT-S21-01`～`UT-S21-09`、`ST-S21-01`～`ST-S21-03` 与 `cli/test/s21-deploy-done.test.ts` 继续覆盖其六项前置校验、`[deploy]` 勾选同步、旧 smoke 标记清理与错误分支零副作用。
>
> 本节新增的是场景文档新固化的两条**跨命令不变量**的回归锚点：`DEPLOY_DONE` 的唯一 writer 身份，以及漏跑 `deploy-done` 时缺口不再扩散（由下游 fail-closed 与对账投影承接，S21 自身不自愈）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S21-10 | `DEPLOY_DONE` 唯一 writer：除 deploy-done 外无命令写该 marker | S21 原子性与唯一 writer 不变量 1 | 构造需部署提案，`VERIFY_PASS` + `deployment-report.md` 在场、`DEPLOY_DONE` 缺失 | 依次执行 `openlogos smoke`、`openlogos archive`、`openlogos status`、`openlogos next`（含 `--format json`） | 四条命令执行前后 `DEPLOY_DONE` 始终不存在——**无一命令写入或补写该 marker**；`smoke`/`archive` 走 fail-closed 拒绝，`status`/`next` 走只读派生；提案目录内 marker 集合零变化 |
| UT-S21-11 | 成功路径写入顺序：marker 最后写，蕴含勾选与清理已完成 | S21 原子性与唯一 writer 不变量 3 | 六项前置全满足，`[deploy]` 未勾且存在旧 `SMOKE_PASS` | 执行 `openlogos deploy-done` | 成功后 `[deploy]` 全勾、旧 `SMOKE_PASS` 已清理、`DEPLOY_DONE` 在场；`cleared_smoke_markers` 含 `SMOKE_PASS`；对错误分支（如移除 `deployment-report.md`）重放：**三者皆无变化**，不得出现「只写 marker 未勾选」的部分状态 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S21-04 | 漏跑 deploy-done 的缺口不扩散（EX-21.7 闭环） | S21 主时序 Step 10 + EX-21.7 | 真实 CLI；需部署需 smoke 提案，部署与 smoke 实际都已完成，但**未跑** `openlogos deploy-done` | ① `openlogos smoke` → ② `openlogos archive` → ③ `openlogos status --format json` / `next` → ④ 补跑 `openlogos deploy-done` → ⑤ 重放①②③ | ① `SMOKE_DEPLOY_NOT_DONE` 拒绝且无 `SMOKE_PASS` 产生；② `ARCHIVE_DEPLOY_NOT_DONE` 拒绝且目录未移动、guard 未删；③ 输出 `state_inconsistency` 投影并给出 `openlogos deploy-done`；④ 落标成功；⑤ smoke 正常执行、archive 链条按 `SMOKE_PASS` 状态继续判定、投影字段消失——**缺口只能由唯一 writer 补上，且补上后全链自然恢复** |

### 追溯与覆盖

- AC-S21-01～AC-S21-06（deploy-done 六项前置、勾选同步、smoke 标记清理、错误分支零副作用）：既有 UT-S21-01～UT-S21-09、ST-S21-01～ST-S21-03，本次行为零变化、逐项零回归。
- AC-S21-07 唯一 writer 不变量（消费者不得写 `DEPLOY_DONE`）：UT-S21-10、ST-S21-04。
- AC-S21-08 成功路径写入顺序与不产生部分状态更新：UT-S21-11。
- AC-S21-09 漏标缺口不扩散、补标后全链恢复：ST-S21-04。
- 场景：`core-S21-deploy-done-marker.md`（原子性与唯一 writer 不变量、EX-21.7、消费侧收口）；功能规格：§2.11、§2.11.1、§2.67。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S21"`；失败不得写 pass。
- 「无命令写 marker」断言以调用前后提案目录 marker 文件集合比对取证，不得只断言命令退出码。
- 全部断言在一次性临时项目中构造，不得触碰本仓或用户其它项目的活跃提案与 guard。

## S21 环境校验、版本声明与部署账本测试（environment-registry）

> 覆盖场景 `core-S21-deploy-done-marker.md`「环境校验、版本声明与部署账本（environment-registry）」、功能规格 §2.11 / §2.93.2 / §2.93.3、`spec/environments.md` §3～§5。既有 UT-S21-01～UT-S21-11、ST-S21-01～ST-S21-04 不变，作为零回归守护。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S21"`；全部在一次性临时 git 仓库中构造。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S21-12 | 登记表存在时环境未登记拒绝 | EX-21.8 | 登记表含 test、prod；deploy-done 既有前置全满足 | `deploy-done --env staging` | `ENV_UNKNOWN`、退出码 1、消息列出 test 与 prod；`[deploy]` 未勾、`DEPLOY_DONE` 不存在、账本不存在 |
| UT-S21-13 | 登记表存在时未传 `--env` 拒绝 | EX-21.8 | 同上 | `deploy-done` | `ENV_REQUIRED`、退出码 1；零副作用（同上） |
| UT-S21-14 | 别名解析为 id 并写入 marker 与账本 | S21 环境节 Step 3、7、8 | test 的 aliases 含「测试」 | `deploy-done --env 测试 --ref HEAD` | `DEPLOY_DONE` 为单行 JSON，`environment="test"`；账本新增 1 行 `kind=deploy`、`environment="test"`、`result="done"`、`slug` 为活跃提案；`deploy_id` 与 marker 相同 |
| UT-S21-15 | 部署版本只来自 `--ref` | S21 环境节 Step 4、5 | 仓库有提交 R0、R1，HEAD 为 R1 | `deploy-done --env test --ref R0` | marker 与账本 `ref` 为 R0 的完整 commit、`ref_source="explicit"`；账本 `observed_head` 为 R1 的完整 commit；`observed_dirty` 与工作区状态一致 |
| UT-S21-16 | 未传 `--ref` 时版本未知 | EX-21.11 | HEAD 为 R1 | `deploy-done --env test` | marker 与账本 `ref=null`、`ref_source="unknown"`；`observed_head` 为 R1；不以 HEAD 填充 `ref` |
| UT-S21-17 | `--ref` 无法解析拒绝 | EX-21.10 | ① 提交不存在；② 当前项目不是 git 仓库 | `deploy-done --env test --ref deadbeef` | 两种情形均 `ENV_REF_UNRESOLVED`、退出码 1；`[deploy]` 未勾、`DEPLOY_DONE` 不存在、账本无新增 |
| UT-S21-18 | 无登记表时输出逐字不变 | EX-21.12 | 无 `logos/environments.yaml`；既有前置满足 | 分别执行 `deploy-done`、`deploy-done --env staging`、`deploy-done --format json` 并与引入前的基线输出比对 | 文本与 JSON 输出、退出码与基线逐字一致（JSON 无 `deployment` 对象）；marker 为单行 JSON，`environment` 依次为 null、`"staging"`；仅带 `--env` 的一次追加账本 |
| UT-S21-19 | 重跑整体重写 marker | §2.11 成功后写入 | 已成功执行一次 `deploy-done --env test --ref R0` | 再执行 `deploy-done --env test --ref R1` | marker 只有一行，`deploy_id` 变化、`ref` 为 R1；账本共 2 行 deploy 记录且顺序为 R0、R1 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S21-05 | 真实 CLI 下的环境与版本落标 | S21 环境节 Step E1～E9 | 真实 CLI；一次性 git 仓库；登记表含 test（alias「测试」）；活跃提案满足既有前置 | ① `deploy-done --env 测试 --ref HEAD --format json`；② 读取 `DEPLOY_DONE` 与账本；③ `openlogos env show test --format json` | ① 成功，JSON 含 `deployment`（`deploy_id`、`environment="test"`、`ref`、`ref_source="explicit"`、`ledger_written=true`）；② marker 五字段齐全且与 JSON 一致，账本末行为对应 deploy 记录；③ `current_ref` 等于该 ref |

### 追溯与覆盖

- 环境未登记 / 缺失 / 登记表非法零副作用：UT-S21-12、UT-S21-13（登记表非法由 UT-S41-11 覆盖）。
- 别名解析与写入：UT-S21-14、ST-S21-05。
- 版本来源（`--ref`、未传、无法解析、HEAD 仅观察）：UT-S21-15、UT-S21-16、UT-S21-17。
- 无登记表零回归：UT-S21-18；重跑重写：UT-S21-19。

### 自动化与证据要求

- 「零副作用」断言以调用前后提案目录文件集合、`tasks.md` 字节与账本字节比对取证，不得只断言退出码。
- 「逐字不变」断言以引入前实现生成的基线输出为对照。

## S21 按模块的环境校验测试（module-scoped-env-smoke）

> 覆盖场景 `core-S21-deploy-done-marker.md`「按模块的环境校验（module-scoped-env-smoke）」，功能规格 §2.98.3、§2.98.5，`spec/environments.md` §14.2、§14.4，proposal-r1 F1。既有 UT-S21-01～UT-S21-19、ST-S21-01～ST-S21-05 不变，作为零回归守护。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S21"`；「零写入」以调用前后提案目录、部署账本与 `[deploy]` 勾选状态的字节快照比对取证。
>
> **夹具 MM**：`mktemp -d` 一次性 git 项目，`logos-project.yaml` 登记 `core`（launched，不声明 `deployment_gates`）与 `team`（initial，`deployment_gates.team.environments: [team-prod]`）；登记表 `logos/environments.yaml` 含 `test`、`prod`、`team-prod`（别名 `Team-Production`），`team-prod` 配置 `deploy`（script，夹具内记录型脚本）；smoke 规格为 `core-smoke-test-cases.md`、`team-smoke-test-cases.md` 与全局 `shared-smoke-test-cases.md`；`smoke.command` 与 `smoke.modules.team.command` 为两个记录型 runner（把被调用的模块、`OPENLOGOS_SMOKE_MODULE`、`OPENLOGOS_SMOKE_ENV` 写入项目外一次性调用日志，并为各自模块用例写结果）。**夹具 S1**：单模块项目带同一登记表；**夹具 M0**：同 MM 但不写任何 `deployment_gates` 与 `smoke.modules`。「零回归基准」为修改前（0.16.9）CLI 对同一输入的实测输出，入库为夹具，不在测试内复述。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S21-20 | 未声明环境的模块按无登记表落标 | §14.4 | MM，core 活跃提案既有前置全满足 | ① `deploy-done`（不传 `--env`）；② `deploy-done --env local-macos`（未登记）；③ `deploy-done --env team-prod` | ① ② 成功，`DEPLOY_DONE.environment` 分别为 null 与 `"local-macos"`，`[deploy]` 勾选，部署账本不存在或字节不变；③ `ENV_MODULE_MISMATCH`（`details.module=core`、`module_environments=[]`），零写入 |
| UT-S21-21 | 声明了环境的模块只能用自己的环境 | §14.4 | MM，team 活跃提案既有前置全满足 | ① `deploy-done --env prod`；② `deploy-done`（不传）；③ `deploy-done --env Team-Production` | ① `ENV_MODULE_MISMATCH`，列出 `["team-prod"]`；② `ENV_REQUIRED`；均零写入；③ 进入既有流程，`DEPLOY_DONE.environment="team-prod"` 并追加账本 |
| UT-S21-22 | 引用失效先于受门环境与写入拒绝 | §14.2、proposal-r1 F1 | MM 变体：team 声明的别名已从登记表删除；`team-prod` 配置 `require_approval: true`；team 活跃提案既有前置全满足 | `deploy-done --env team-prod`；另在 core 活跃提案下执行 `deploy-done` | team：`ENV_GATE_REFERENCE_UNKNOWN`，不出现 `DEPLOY_DONE_GATED_ENV` 以外的成功路径，零写入；core 照常落标，不受 team 失效引用影响 |

## S21 initial 模块的模块部署报告测试（module-scoped-phase-reports）

> 覆盖场景 `core-S21-deploy-done-marker.md`「initial 模块的模块部署报告（module-scoped-phase-reports）」（EX-MR.1～EX-MR.4），功能规格 §2.99.7，`spec/environments.md` §14.9，决策 C01，proposal-r1 F1。既有 S21 用例作为回归守护。测试实现必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`），测试名包含对应 ID，`scenario_id="S21"`。
>
> **夹具 MD**：`mktemp -d` 一次性 git 项目，`logos-project.yaml` 登记 `core`（launched）与 `team`（initial，`deployment_gates.team.environments: [team-prod]`）；登记表含 `team-prod`（未配置 `deploy`，无门禁）；以 `openlogos change` 创建归属 team 的活跃提案，`VERIFY_PASS`、部署决策与共用 `deployment-report.md` 均已就绪。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S21-23 | 落标成功后追加模块部署报告 | §2.99.7 | 夹具 MD；`team-deployment-report.md` 不存在 | `deploy-done --env team-prod --ref <commit> --format json` | 既有落标结果不变（`[deploy]` 勾选、`DEPLOY_DONE`、账本 deploy 记录）；`team-deployment-report.md` 被创建，含标题与一段：部署 id 等于 `DEPLOY_DONE.deploy_id`、环境 `team-prod`、通道 `proposal`、方式 `deploy-done`、版本与来源、结果 `done`、记录时间；再次部署并落标时追加第二段，不覆盖第一段 |
| UT-S21-24 | 拒绝路径不写 | §2.99.7、EX-MR.1 | 夹具 MD；变体 ①：删除 `VERIFY_PASS`；②：删除共用 `deployment-report.md`；③：`--env prod`（不属于 team 的已登记环境） | `deploy-done` | 分别以既有错误码（含 `DEPLOYMENT_REPORT_MISSING`、`ENV_MODULE_MISMATCH`）零写入退出；不创建 `team-deployment-report.md` |
| UT-S21-25 | 落标或账本写入失败不写 | §2.99.7、EX-MR.2 | 夹具 MD；以测试钩子让 `DEPLOY_DONE` 写入失败；变体：让账本追加失败 | `deploy-done --env team-prod --ref <commit>` | 既有失败输出、快照回滚；不创建 `team-deployment-report.md`；team 的 phase.3-7 未完成 |
| UT-S21-26 | 模块报告写入失败以 DEPLOY_RECORD_FAILED 退出，且不被判为已部署（delta-r1 F2） | §2.99.7、EX-MR.3 | 夹具 MD；team 前序阶段齐全，已有 Gate PASS 的模块验收报告；`logos/resources/verify/team-deployment-report.md` 位置被同名目录占用（不可写） | ① `deploy-done --env team-prod --ref <commit> --format json`；② 对 team 派生 `phase_progress`；③ `launch team` | ① 退出码非零，错误码 `DEPLOY_RECORD_FAILED`，`details.module_report_path="logos/resources/verify/team-deployment-report.md"`；`DEPLOY_DONE` 与账本记录保留；② team 的 phase.3-7 未完成；③ 拒绝并点名该路径 |
| UT-S21-28 | 发布中断不留残留；已有成功报告时追加失败保留旧凭据（delta-r1 F2） | §2.99.2、§2.99.7 | 夹具 MD；以测试钩子让模块报告临时文件写入中途失败；变体 ①：此前没有 `team-deployment-report.md`；②：此前已有一段成功记录的 `team-deployment-report.md` | `deploy-done --env team-prod --ref <commit>` 后派生 team 的 `phase_progress` | 两个变体都以 `DEPLOY_RECORD_FAILED` 退出；① 正式路径不存在（无空文件或部分内容），phase.3-7 未完成；② 正式路径内容与执行前逐字节相同，phase.3-7 仍为完成 |
| UT-S21-27 | launched 提案模块与单模块项目不写 | §2.99.7、EX-MR.4 | 夹具 MD 改为 core 的活跃提案（core 未声明环境）；另有单模块项目夹具 | 各自执行 `deploy-done` | 不写任何 `<m>-deployment-report.md`；输出、标记与账本与修改前逐字节相同 |

### 覆盖度校验

- 成功边界写入与追加：UT-S21-23。
- 拒绝、落标失败、写入失败：UT-S21-24、UT-S21-25、UT-S21-26。
- 原子发布与失败后的判定（delta-r1 F2）：UT-S21-26、UT-S21-28。
- launched 与单模块零回归：UT-S21-27。

## 主链路用例

> 主链路用例是「坏了就等于产品不可用」的核心流程用例（功能规格 §2.109.3）。分层验收开启时，每次提案级验收都执行它们，且不允许偶发。只读取下面的列表项；增删须经提案（enable-layered-verify 首次给出）。

- ST-S21-02 — 无需 smoke 的提案部署完成后进入 deploy-done
- ST-S21-03 — deploy-done 不执行实际部署命令
