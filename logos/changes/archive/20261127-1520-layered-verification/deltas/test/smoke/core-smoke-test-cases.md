## ADDED — OpenLogos 0.16.27 分层验收安装态 smoke（SMOKE-core-352～358）

> 这组用例验证本提案 layered-verification 的分层验收与发布级验收，已在本机全局安装态中以 0.16.27 的身份生效（功能规格 §2.109；需求 AC-VERIFY-TIER-22）。完整行为已由仓库内 UT-S13-217～UT-S13-274、ST-S13-48～ST-S13-51、UT-S09-504～506、UT-S35-231～239、UT-S32-118～125 覆盖。安装态只取证：装上的是本次候选；全局 CLI 在一次性项目中未开启时不变、开启后只采信三层合集、该扩大时扩大、主链路超限时在执行前 FAIL、发布级实际执行全量并与提交号绑定。
>
> **夹具**：每条用例在各自的 `mktemp -d` 一次性 git 项目 `P` 内执行，经全局 `openlogos init` 建立项目后写入：
> - 单模块 `core` launched；已合并测试规格 `core-S01-test-cases.md`（UT-S01-01、02）、`core-S02-test-cases.md`（UT-S02-01、02）、`core-S03-test-cases.md`（UT-S03-01、02，含「主链路用例」小节，列出 UT-S03-01）；
> - `verify.pre_run_command` 指向夹具内的记录型脚本 `lv-runner.mjs`：每次被执行时在项目外临时目录追加一行调用记录（收到的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`、实际执行的用例 ID）；启动时清空结果文件；收到清单时只执行、只上报清单内的用例，否则执行全部；按剧本决定每条用例写 pass 或 fail；
> - 需要活跃提案的用例：经全局 `openlogos change` 建立提案（脚手架即含「受影响场景」段），按用例填写该段，guard 带 `baseRef`。
>
> 每次执行全局 CLI 前把夹具改动提交到本地 git。runner 对全局安装态**只读**，不做安装或卸载。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.27`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-352 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并以包内校验器重算 | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link，回执 `entry_realpath` 为非空绝对路径且等于入口 realpath；② 校验器不抛错 | 保留读取结果；回流部署，不继续后续用例的通过判定 |
| SMOKE-core-353 | 未开启时范围不变，脚手架含「受影响场景」段 | 夹具 `P`；不写 `verify.layered`；全部 pass | ① 全局 `openlogos change lv-smoke`，读取 `proposal.md`；② 全局 `openlogos verify --format json`；读取调用记录 | ① 提案含「受影响场景」段与 `schema: openlogos/affected-scenarios@1`；② `data.level="proposal"`，没有 `layers`；入口未收到分层清单，执行全部 6 条用例；`gate.result="PASS"` | 保留信封与调用记录；回流实现 |
| SMOKE-core-354 | 开启后提案级验收只采信三层合集 | 夹具 `P`；`verify.layered.enabled: true`；活跃提案声明 `assessment: assessed`、`scenarios: [S02]`；全部 pass | 全局 `openlogos verify --format json`；读取调用记录与 `acceptance-report.md` | 退出码 0；`gate.result="PASS"`；`layers.expansion.level="none"`；`layers.total.ids` 为 S02 的两条加 UT-S03-01；入口收到的清单与之相同，实际只执行这 3 条，S01 的用例与 UT-S03-02 未被执行、不计未覆盖；报告含「级别」行（提案级）与验收范围小节 | 同上 |
| SMOKE-core-355 | 评估不可用时扩大 | 承 SMOKE-core-354 的夹具；把声明改回 `assessment: pending` | 全局 `openlogos verify --format json`；读取调用记录 | `layers.expansion.level="full"`，原因含 `declaration_invalid`；入口执行全部 6 条用例；`gate.result="PASS"`（扩大不是失败） | 同上 |
| SMOKE-core-356 | 主链路超过上限在执行前 FAIL | 夹具 `P`；`verify.layered.enabled: true`、`main_path_max: 1`；`core-S03` 的主链路小节列 2 条 | 全局 `openlogos verify --format json`；读取调用记录 | 退出码非 0；`gate.reason="main_path_over_limit"`；`layers.main_path` 给出 `limit=1`、`count=2`；入口未被调用 | 同上 |
| SMOKE-core-357 | 发布级验收实际执行全量并写独立报告 | 夹具 `P`；`verify.layered.enabled: true`；没有活跃提案；全部内容已提交、工作区干净；全部 pass | ① 全局 `openlogos verify --release --format json`；② 读取调用记录、`logos/resources/verify/release/acceptance-report.md` 与最新一条验收历史；③ 新项目去掉 `pre_run_command`、预置全绿结果后执行 `openlogos verify --release --format json` | ① 退出码 0；`data.level="release"`；`data.release.commit` 等于运行前的 HEAD；② 入口未收到清单、执行全部 6 条用例；发布级报告含级别（发布级）、提交号与平台；历史记录 `level="release"`、`commit.head` 为该提交；③ `RELEASE_VERIFY_NO_COMMAND`，退出码 2，入口未被调用 | 同上 |
| SMOKE-core-358 | 发布级结论的查询：后一次失败推翻前一次通过，提交变了即作废 | 承 SMOKE-core-357 ① 的项目 | ① `openlogos verify --release --check --format json`；② 把剧本改为一条用例 fail，该改动放在项目外的剧本文件中（不改变提交），再执行 `openlogos verify --release`，随后 `--release --check`；③ 新建一个空提交后 `--release --check`；④ 留下一个未提交的源码改动后执行 `openlogos verify --release --format json` | ① `valid=true`，退出码 0；② 发布级 FAIL；查询 `valid=false`、`reason="latest_failed"`，退出码 1；③ `valid=false`、`reason="other_commit_only"`，退出码 1；④ `RELEASE_VERIFY_DIRTY`，退出码 2，入口未被调用 | 同上 |

### 二、执行边界

- 全部读写只在一次性项目 `P`、项目外临时目录与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰以下对象：本仓活跃提案；本仓 `logos/resources/`（结果账本除外）；本仓运行态目录与账本；本仓的 git 分支与工作区；本仓登记表；用户其他仓库（包括 runlogos、markdown6）；本机全局 prefix。发布级验收只在一次性项目内执行，不对本仓执行。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行，才带 `target_environment="test"`；目标不是 test 的 skip 行与窗口之外的 skip 行，都不声明 `target_environment`。

### 三、追溯与覆盖

- 需求：AC-VERIFY-TIER-02、05、06、09、10、11、14、15、17、18、19、22；功能规格：§2.109。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.27 本机测试环境发布（layered-verification）」。
- 仓库内对应用例：
  - SMOKE-core-353：UT-S13-218、UT-S09-504；
  - SMOKE-core-354：UT-S13-221、UT-S13-222、UT-S13-247、ST-S13-48；
  - SMOKE-core-355：UT-S13-229、UT-S13-234、ST-S13-49；
  - SMOKE-core-356：UT-S13-238；
  - SMOKE-core-357：UT-S13-254、UT-S13-255、UT-S13-257、UT-S13-258、ST-S13-50；
  - SMOKE-core-358：UT-S13-253、UT-S13-261、UT-S13-263、ST-S13-51。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-layered-verification.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-352～SMOKE-core-358，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。
- **适用窗口**：活跃变更为 `layered-verification`，或设置了 `OPENLOGOS_LV_SMOKE=1`。窗口之外，为全部 owned ID 写 skip，不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_LV_` 前缀。
- **部署前置**：先读部署账本中本提案在 test 的最后一条成功 deploy。没有记录时写显式 `skip`，并携带缺失项。有记录时，要求源码候选版本可读，且回执满足以下全部条件，任一不符判 fail：同一 deploy_id；`result=done`；`candidate_version` 等于源码候选版本；`entry_realpath` 为非空绝对路径。有 skip 时不得写 `SMOKE_PASS`。
- **子进程与超时**：全局 CLI 子进程在独立进程组中运行，每次限时 120 秒；到时对整个进程组强制终止，判 fail。
- **判定方式**：按预期退出码与输出通道判定。要求解析信封的步骤一律以 `--format json` 调用，并对 `stdout.trim()` 整体 `JSON.parse`（错误信封在 stderr 时同样整体解析）。以下情况都判该用例 fail，不得重试后写 pass：超时、被信号终止、启动错误、非预期退出码、信封无法整体解析。「入口被调用几次」「实际执行了哪些用例」读项目外的调用记录，不从 CLI 输出推断。
- **结果写入**：写入 smoke reporter，每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 这组用例都不需要人参与，不带 `[manual]` 标记。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-352～SMOKE-core-358 均被 runner 覆盖。
