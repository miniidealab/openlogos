## ADDED — OpenLogos 0.16.28 验收范围字段判断与切片模块安装态 smoke（SMOKE-core-359～366）

> 这组用例验证本提案 verify-scope-fields-and-slice-module 的两项修正，已在本机全局安装态中以 0.16.28 的身份生效（功能规格 §2.96.3.1、§2.110；需求 AC-VERIFY-FIELD-01～10）。完整行为已由仓库内 UT-S13-275～UT-S13-293、ST-S13-52～ST-S13-54、UT-S32-126～UT-S32-134 覆盖。安装态只取证：装上的是本次候选；全局 CLI 在一次性项目中，只改无关字段时范围不回落、改了相关字段或无法判断时回落并写明原因、工作区缺配置时入口错误不变；非 core 模块提案能规划切片并进入切片验收，`--slug` 指向非活跃提案时拒绝。
>
> **夹具 `P`（多模块）**：每条用例在各自的 `mktemp -d` 一次性 git 项目内执行，经全局 `openlogos init` 建立项目后写入：
> - 模块 `core` 与 `web`（均 launched），各自声明非空 `paths`（`core/**`、`web/**`）；已合并测试规格 `core-S01-test-cases.md`（UT-S01-01、02）、`web-S05-test-cases.md`（UT-S05-01、02）；
> - `verify.modules.core` 与 `verify.modules.web` 各有命令组，指向夹具内的记录型脚本：每次被执行时在项目外临时目录追加一行调用记录（模块、收到的清单、实际执行的用例 ID），并写出本模块用例的结果（缺省全部 pass）；`logos/logos.config.json` 另含 `smoke` 与 `description`，`logos/logos-project.yaml` 含 `resource_index`；分层验收关闭；
> - 全部内容提交后，经全局 `openlogos change <slug> --module web` 建立活跃提案（guard 带 `baseRef` 与 `module: web`）。
>
> **夹具 `L`（分层）**：同「OpenLogos 0.16.27 分层验收安装态 smoke」的单模块夹具，`verify.layered.enabled: true`，活跃提案声明 `assessment: assessed`、`scenarios: [S02]`。
>
> runner 对全局安装态**只读**，不做安装或卸载。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.28`。`detail` 的断言为精确字符串比较。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-359 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并以包内校验器重算 | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link，回执 `entry_realpath` 为非空绝对路径且等于入口 realpath；② 校验器不抛错 | 保留读取结果；回流部署，不继续后续用例的通过判定 |
| SMOKE-core-360 | 多模块项目只改无关字段时验收范围不回落 | 夹具 `P`；提案期间修改 `web/app.ts`，在 `logos/logos-project.yaml` 新增一条 `resource_index`，在 `logos/logos.config.json` 写入 `driver.review` | 全局 `openlogos verify --format json`；读取各命令组的调用记录 | 退出码 0；`scope.mode="module"`、`scope.modules=["web"]`、`scope.fallback_reason` 为 null；只有 `web` 的命令组被执行；`gate.result="PASS"` | 保留信封与调用记录；回流实现 |
| SMOKE-core-361 | 改了相关字段时回落全量并写明字段 | 承 SMOKE-core-360 的夹具；再修改 `logos/logos.config.json` 中 `verify.modules.core` 命令的一个参数 | 全局 `openlogos verify --format json`；读取调用记录 | `scope.mode="fallback-full"`、`fallback_reason.code="shared_config_changed"`、`detail` 为 `logos/logos.config.json（verify）`；两个模块的命令组都被执行 | 同上 |
| SMOKE-core-362 | 提案起点或工作区内容无法严格解析时回落 | ① 夹具 `P` 的变体：建立提案时的提交中 `logos/logos.config.json` 是损坏的 JSON，随后在工作区修正为有效内容；② 夹具 `P`：在工作区 `logos/logos-project.yaml` 中重复一个顶层 `resource_index` 键，`modules` 仍为两个带 `paths` 的模块 | 每个项目执行全局 `openlogos verify --format json` | ① `scope.mode="fallback-full"`、`detail` 为 `logos/logos.config.json（提案起点中的内容无法解析）`；② `scope.mode="fallback-full"`、`detail` 为 `logos/logos-project.yaml（工作区中的内容无法解析）`；两者 `code` 均为 `shared_config_changed` | 同上 |
| SMOKE-core-363 | 工作区缺项目配置时入口错误不变 | 夹具 `P`；删除工作区 `logos/logos.config.json` | 全局 `openlogos verify --format json`；读取调用记录 | 退出码 1；stderr 错误信封 `error.code="PROJECT_NOT_INITIALIZED"`；没有任何命令组被执行；输出中没有 `shared_config_changed` | 同上 |
| SMOKE-core-364 | 分层项目只改无关字段时保持收窄 | 夹具 `L`；提案期间只在 `logos/logos-project.yaml` 新增 `resource_index` 条目、修改 `logos/logos.config.json` 的 `description` | ① 全局 `openlogos verify --format json`，读取调用记录；② 再修改 `logos/logos.config.json` 的 `smoke.command` 后重跑 | ① `layers.expansion.level="none"`，入口只执行提案集合内的用例；② `layers.expansion.level="full"`，原因含 `shared_path_changed`，`detail` 为 `logos/logos.config.json（smoke）`，入口执行全部用例 | 同上 |
| SMOKE-core-365 | 非 core 模块提案规划切片后验收不报清单无效 | 夹具 `P`；活跃提案登记在 `web`，经全局 `openlogos merge` 写入 `SPEC_MERGED`（变更用例两条），切片输入把两条用例分给两个切片 | ① 全局 `openlogos slice plan --file slices.json --format json`，读取 `TEST_SLICE_MANIFEST.json`；② 全局 `openlogos verify --format json` | ① 退出码 0，清单 `module="web"`；② 输出中没有 `test-slice-manifest-invalid`，`verify_mode="slice-checkpoint"`，`attempted_slice_id` 为第一个切片 | 同上 |
| SMOKE-core-366 | `--slug` 指向非活跃提案时拒绝且不改文件 | 承 SMOKE-core-365 的项目；另建第二个提案目录 `other-demo`（含 `tasks.md`），guard 仍指向第一个提案；记录 `other-demo/tasks.md` 的哈希 | 全局 `openlogos slice plan --slug other-demo --file slices.json --format json` | 退出码 1；stderr 错误信封 `error.code="SLICE_PLAN_NO_ACTIVE_CHANGE"`；`other-demo/tasks.md` 哈希不变，目录中没有生成切片清单 | 同上 |

### 二、执行边界

- 全部读写只在一次性项目、项目外临时目录与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰以下对象：本仓活跃提案；本仓 `logos/resources/`（结果账本除外）；本仓运行态目录与账本；本仓的 git 分支与工作区；本仓登记表；用户其他仓库（包括 runlogos）；本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行，才带 `target_environment="test"`；目标不是 test 的 skip 行与窗口之外的 skip 行，都不声明 `target_environment`。

### 三、追溯与覆盖

- 需求：AC-VERIFY-FIELD-01、02、05、06、07、08、09；功能规格：§2.96.3.1、§2.110。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.28 本机测试环境发布（verify-scope-fields-and-slice-module）」。
- 仓库内对应用例：
  - SMOKE-core-360：UT-S13-275、UT-S13-276、ST-S13-52、ST-S13-53；
  - SMOKE-core-361：UT-S13-109、UT-S13-277、ST-S13-53；
  - SMOKE-core-362：UT-S13-282、UT-S13-284；
  - SMOKE-core-363：UT-S13-286；
  - SMOKE-core-364：UT-S13-288、UT-S13-289、ST-S13-54；
  - SMOKE-core-365：UT-S32-126、UT-S32-127；
  - SMOKE-core-366：UT-S32-129。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-verify-scope-fields.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-359～SMOKE-core-366，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。
- **适用窗口**：活跃变更为 `verify-scope-fields-and-slice-module`，或设置了 `OPENLOGOS_VSF_SMOKE=1`。窗口之外，为全部 owned ID 写 skip，不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_VSF_` 前缀。
- **部署前置**：先读部署账本中本提案在 test 的最后一条成功 deploy。没有记录时写显式 `skip`，并携带缺失项。有记录时，要求源码候选版本可读，且回执满足以下全部条件，任一不符判 fail：同一 deploy_id；`result=done`；`candidate_version` 等于源码候选版本；`entry_realpath` 为非空绝对路径。有 skip 时不得写 `SMOKE_PASS`。
- **子进程与超时**：全局 CLI 子进程在独立进程组中运行，每次限时 120 秒；到时对整个进程组强制终止，判 fail。
- **判定方式**：按预期退出码与输出通道判定。要求解析信封的步骤一律以 `--format json` 调用，并对 `stdout.trim()` 整体 `JSON.parse`（错误信封在 stderr 时同样整体解析）。以下情况都判该用例 fail，不得重试后写 pass：超时、被信号终止、启动错误、非预期退出码、信封无法整体解析。「哪些命令组被执行」「实际执行了哪些用例」读项目外的调用记录，不从 CLI 输出推断。
- **既有 smoke 夹具随行为变化同步**：既有 runner 中凡是靠「改动两个配置文件即回落」构造前置的，改为修改相关字段；本提案实现时逐个核对 `scripts/smoke-*.js`。
- **结果写入**：写入 smoke reporter，每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 这组用例都不需要人参与，不带 `[manual]` 标记。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-359～SMOKE-core-366 均被 runner 覆盖。
