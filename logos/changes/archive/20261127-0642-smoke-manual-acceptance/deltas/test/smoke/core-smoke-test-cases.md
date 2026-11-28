## ADDED — OpenLogos 0.16.25 冒烟阶段人工验收安装态 smoke（SMOKE-core-342～346）

> 这组用例验证本提案 smoke-manual-acceptance 的冒烟阶段人工验收能力，已在本机全局安装态中以 0.16.25 的身份生效（功能规格 §2.107；需求 AC-SMOKE-MANUAL-01～AC-SMOKE-MANUAL-14）。完整行为已由仓库内用例覆盖：UT-S46-01 起、ST-S46-01 起、UT-S19-127 起、ST-S19-40 起、UT-S41-30 起、UT-S05-58 起、UT-S09-493 起、UT-S08-93 起。安装态只取证三件事：装上的是本次候选；全局 CLI 在一次性项目中确实按新规则读取人工标记、等待、记录、通过、失败与过期；不部署提案的人工用例会被累积。
>
> **夹具**：每条用例在各自的 `mktemp -d` 一次性 git 项目 `P` 内执行，经全局 `openlogos init` 建立项目后写入：
> - 单模块 `core` launched；
> - 登记表含两个环境：`ma-test` 不写 `manual_acceptance`；`ma-prod` 写 `manual_acceptance: {enabled: true}`。两者都配置 `deploy: {mode: script, script: deploy/noop.sh}`，`deploy/noop.sh` 为被 git 跟踪、立即以 0 退出的脚本；
> - 测试规格含 `ST-S01-05 [manual]`，smoke 规格含 `SMOKE-core-01`（自动）与 `SMOKE-core-901 [manual]`；
> - `smoke.command` 指向夹具内的记录型 runner，为 SMOKE-core-01 写 pass，并按环境变量控制是否额外为 SMOKE-core-901 写一行（用于判定 `manual_smoke_result_id`）。
>
> 部署一律经全局 CLI 的 `openlogos deploy --env <环境> --ref HEAD --format json`（版本通道，无活跃提案；版本通道必须显式给出 `--ref`，否则报 `DEPLOY_REF_REQUIRED`，评审 delta-r1 F5）真实落账，**不手写账本**。每次部署前先把夹具改动提交，`HEAD` 即该步骤刚提交的版本；重新部署同一提交时同样传 `--ref HEAD`。每次部署都以「退出码 0、`data.status === "done"`、`data.deploy_id` 非空」作为该步的前置断言（部署成功信封的字段见 `spec/cli-json-output.md`「deploy 成功输出」，评审 delta-r2 F5），不满足即判该用例 fail，不再继续后续断言；需要核验 `result` 时，读取 `P` 内账本中同一 `deploy_id` 的 deploy 行。
>
> 每条用例在**各自的** `P` 中独立执行；需要以 SMOKE-core-344 的通过状态为起点的用例，在自己的 `P` 中先重放 SMOKE-core-344 的 ①～④。`openlogos accept` 由 runner 在 `P` 内以子进程直接调用：不经 AI 宿主，因此不触发 guard。每次执行全局 CLI 前，把夹具改动提交到本地 git。runner 对全局安装态**只读**，不做安装或卸载。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.25`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-342 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之为同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json`，并以包内校验器重算 | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link，回执 `entry_realpath` 为非空绝对路径且等于入口 realpath；② 校验器不抛错 | 保留读取结果；任一不符即停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-343 | 人工标记读取与关闭环境只列出 | 夹具如上；另建一个只含 `SMOKE-core-901 [manual]`、没有 runner 与结果文件的全人工子夹具 | ① `deploy --env ma-test --ref HEAD` 后执行 `smoke --env ma-test --format json`；② 让 runner 额外写 SMOKE-core-901 后重跑；③ 在全人工子夹具中 `deploy --env ma-test --ref HEAD` 后执行 `smoke --env ma-test --format json` | ① 退出码 0，`gate.result="PASS"`，`defined_count` 不含 SMOKE-core-901，`manual_acceptance.unexecuted` 含 ST-S01-05 与 SMOKE-core-901，账本没有 pending 行；② 退出码 1，诊断 `manual_smoke_result_id`；③ 不报 `NO_SMOKE_RESULTS` / `NO_SMOKE_CASES`，`gate.result="PASS"` | 保留 JSON 与账本副本；按失败回流修复 |
| SMOKE-core-344 | 开启环境：等待 → 记录 → 通过 | 夹具如上 | ① `deploy --env ma-prod --ref HEAD --format json`，取返回的 deploy_id D，并与 `env show ma-prod --format json` 核对一致；② `smoke --env ma-prod --format json`；③ `accept --env ma-prod --deploy <D> --case ST-S01-05,SMOKE-core-901 --result pass --format json`；④ 重跑 smoke；⑤ `env show ma-prod --format json` | ② 退出码 1，`gate.result="PENDING"`，`gate.reason="manual_acceptance_pending"`，`manual_acceptance.pending` 含两条，账本最近 smoke 行 `result=pending`；③ 退出码 0，`remaining=[]`；④ 退出码 0，`gate.result="PASS"`，账本最近 smoke 行 `manual_passed=true`；⑤ `manual_acceptance.waiting=null` | 同上 |
| SMOKE-core-345 | 首次通过后更正普通用例、部署已更换 | 自己的 `P`（夹具不配置 regression），先重放 SMOKE-core-344 的 ①～④ 使 ma-prod 在 D 上通过 | ① 读取 `env show ma-prod --format json` 确认通过；② `accept --env ma-prod --deploy <D> --case SMOKE-core-901 --result fail --note 白屏 --format json`；③ 重跑 smoke；④ `deploy --env ma-prod --ref HEAD` 重新部署同一提交得到 D2，然后执行 `accept --env ma-prod --deploy <D> --case ST-S01-05 --result pass` | ② 退出码 0，`expired_pass=true`（D 自己的通过不作为 D 的基线，SMOKE-core-901 仍在清单中）；③ 退出码 1，`gate.reason="manual_cases_failed"`，`failed` 含 SMOKE-core-901 与说明；④ 部署断言通过且 D2≠D；accept 退出码 1，错误码 `ACCEPT_DEPLOY_CHANGED`，账本行数不变 | 同上 |
| SMOKE-core-346 | 不部署提案的人工用例被累积 | 自己的 `P`，先重放 SMOKE-core-344 的 ①～④（基线为该次部署的提交） | ① 新提交加入 `ST-S01-08 [manual]`（模拟一个已归档、未部署的提案）；② 再提交一处无关改动；③ `deploy --env ma-prod --ref HEAD` 后执行 `smoke --env ma-prod --format json` | ③ `manual_acceptance.pending` 含 ST-S01-08，不含基线中未改动的 ST-S01-05，`baseline_ref` 等于 SMOKE-core-344 通过时的提交 | 同上 |

### 二、执行边界

- 全部读写只在一次性项目 `P`、项目外临时目录与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰以下对象：本仓活跃提案；本仓 `logos/resources/`（结果账本除外）；本仓运行态目录与账本；本仓的 git 分支与工作区；本仓登记表；用户其他仓库（包括 runlogos、markdown6）；本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行，才带 `target_environment="test"`；目标不是 test 的 skip 行与窗口之外的 skip 行，都不声明 `target_environment`。

### 三、追溯与覆盖

- 需求：AC-SMOKE-MANUAL-01～AC-SMOKE-MANUAL-14；功能规格：§2.107。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.25 本机测试环境发布（smoke-manual-acceptance）」。
- 仓库内对应用例：
  - SMOKE-core-343：UT-S19-127～UT-S19-132、ST-S46-05、ST-S46-10；
  - SMOKE-core-344：ST-S46-01、UT-S46-23；
  - SMOKE-core-345：ST-S46-02、ST-S46-03、UT-S46-15、UT-S46-31；
  - SMOKE-core-346：ST-S46-04、UT-S46-03。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-manual-acceptance.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-342～SMOKE-core-346，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。
- **适用窗口**：活跃变更为 `smoke-manual-acceptance`，或设置了 `OPENLOGOS_MA_SMOKE=1`。窗口之外，为全部 owned ID 写 skip，不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_MA_` 前缀。
- **部署前置**：先读部署账本中本提案在 test 的最后一条成功 deploy。没有记录时写显式 `skip`，并携带缺失项。有记录时，要求源码候选版本可读，且回执满足以下全部条件，任一不符判 fail：同一 deploy_id；`result=done`；`candidate_version` 等于源码候选版本；`entry_realpath` 为非空绝对路径。有 skip 时不得写 `SMOKE_PASS`。
- **子进程与超时**：全局 CLI 子进程在独立进程组中运行，每次限时 120 秒；到时对整个进程组强制终止，判 fail。
- **判定方式**：按预期退出码与输出通道判定。要求解析信封的步骤一律以 `--format json` 调用，并对 `stdout.trim()` 整体 `JSON.parse`。以下情况都判该用例 fail，不得重试后写 pass：超时、被信号终止、启动错误、非预期退出码、信封无法整体解析。账本断言读取 `P` 内的 `logos/.openlogos-runtime/deployments.jsonl`，只读不写。
- **结果写入**：写入 smoke reporter，每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-342～SMOKE-core-346 均被 runner 覆盖。
