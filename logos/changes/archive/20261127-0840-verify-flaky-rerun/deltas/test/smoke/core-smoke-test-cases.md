## ADDED — OpenLogos 0.16.26 verify 复跑安装态 smoke（SMOKE-core-347～351）

> 这组用例验证本提案 verify-flaky-rerun 的失败用例复跑与偶发判定，已在本机全局安装态中以 0.16.26 的身份生效（功能规格 §2.108；需求 AC-VERIFY-RERUN-12）。完整行为已由仓库内 UT-S13-180～UT-S13-216、ST-S13-44～ST-S13-47 覆盖。安装态只取证：装上的是本次候选；全局 CLI 在一次性项目中确实会复跑、判偶发、在该 FAIL 时仍 FAIL、在该不复跑时不复跑。
>
> **夹具**：每条用例在各自的 `mktemp -d` 一次性 git 项目 `P` 内执行，经全局 `openlogos init` 建立项目后写入：
> - 单模块 `core` launched，已合并测试规格含 UT-S01-01、UT-S01-02、UT-S01-03；
> - `verify.pre_run_command` 指向夹具内的记录型脚本 `rr-runner.mjs`：每次被执行时在项目外临时目录追加一行调用记录（第几次调用、收到的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 与 `OPENLOGOS_VERIFY_RERUN`）；启动时清空结果文件；按夹具内的剧本文件决定每条用例在第 1 次、第 2 次调用时写 pass 或 fail；有 fail 时以非零状态退出；收到集合时只写集合内用例。
>
> 每次执行全局 CLI 前把夹具改动提交到本地 git。runner 对全局安装态**只读**，不做安装或卸载。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.26`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-347 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并以包内校验器重算 | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link，回执 `entry_realpath` 为非空绝对路径且等于入口 realpath；② 校验器不抛错 | 保留读取结果；回流部署，不继续后续用例的通过判定 |
| SMOKE-core-348 | 首跑失败、复跑通过记为偶发 | 夹具 `P`；剧本：UT-S01-01 第 1 次 fail、第 2 次 pass，其余 pass | 全局 `openlogos verify --format json`；读取调用记录、`result_path` 与 `acceptance-report.md` | 退出码 0；`gate.result="PASS"`；`flaky_cases` 含 UT-S01-01，`failed_cases` 为空，`warnings` 含 `flaky_cases_present`；`rerun.attempted=true`；runner 被调用 2 次，第 2 次收到 `["UT-S01-01"]` 与 `RERUN=1`；`result_path` 含三条用例；报告含「偶发用例」小节 | 保留信封、调用记录与报告；回流实现 |
| SMOKE-core-349 | 两次都失败照常 FAIL | 夹具 `P`；UT-S01-01 两次都 fail | 全局 `openlogos verify --format json` | 退出码非 0；`gate.result="FAIL"`、`gate.reason="failed_cases"`；`failed_cases` 含 UT-S01-01；无 `flaky_cases` | 同上 |
| SMOKE-core-350 | 超过上限不复跑 | 夹具 `P`；`verify.rerun_failed.max_cases: 1`；首跑 UT-S01-01、UT-S01-02 都 fail | 全局 `openlogos verify --format json` | runner 只被调用 1 次；FAIL `failed_cases`；`rerun.attempted=false`、`rerun.skipped_reason="too_many_failures"` | 同上 |
| SMOKE-core-351 | 关闭配置后不复跑 | 夹具 `P`；`verify.rerun_failed.enabled: false`；UT-S01-01 第 1 次 fail | 全局 `openlogos verify --format json` | runner 只被调用 1 次；FAIL `failed_cases`；`rerun.skipped_reason="disabled"` | 同上 |

### 二、执行边界

- 全部读写只在一次性项目 `P`、项目外临时目录与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰以下对象：本仓活跃提案；本仓 `logos/resources/`（结果账本除外）；本仓运行态目录与账本；本仓的 git 分支与工作区；本仓登记表；用户其他仓库（包括 runlogos、markdown6）；本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行，才带 `target_environment="test"`；目标不是 test 的 skip 行与窗口之外的 skip 行，都不声明 `target_environment`。

### 三、追溯与覆盖

- 需求：AC-VERIFY-RERUN-01、02、05、06、07、12；功能规格：§2.108。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.26 本机测试环境发布（verify-flaky-rerun）」。
- 仓库内对应用例：
  - SMOKE-core-348：UT-S13-180、UT-S13-185、UT-S13-205、ST-S13-44；
  - SMOKE-core-349：UT-S13-181、ST-S13-45；
  - SMOKE-core-350：UT-S13-187、ST-S13-47；
  - SMOKE-core-351：UT-S13-189、ST-S13-46。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-verify-flaky-rerun.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-347～SMOKE-core-351，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。
- **适用窗口**：活跃变更为 `verify-flaky-rerun`，或设置了 `OPENLOGOS_RR_SMOKE=1`。窗口之外，为全部 owned ID 写 skip，不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_RR_` 前缀。
- **部署前置**：先读部署账本中本提案在 test 的最后一条成功 deploy。没有记录时写显式 `skip`，并携带缺失项。有记录时，要求源码候选版本可读，且回执满足以下全部条件，任一不符判 fail：同一 deploy_id；`result=done`；`candidate_version` 等于源码候选版本；`entry_realpath` 为非空绝对路径。有 skip 时不得写 `SMOKE_PASS`。
- **子进程与超时**：全局 CLI 子进程在独立进程组中运行，每次限时 120 秒；到时对整个进程组强制终止，判 fail。
- **判定方式**：按预期退出码与输出通道判定。要求解析信封的步骤一律以 `--format json` 调用，并对 `stdout.trim()` 整体 `JSON.parse`。以下情况都判该用例 fail，不得重试后写 pass：超时、被信号终止、启动错误、非预期退出码、信封无法整体解析。「runner 被调用几次」读项目外的调用记录，不从 CLI 输出推断。
- **结果写入**：写入 smoke reporter，每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 这组用例都不需要人参与，不带 `[manual]` 标记。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-347～SMOKE-core-351 均被 runner 覆盖。
