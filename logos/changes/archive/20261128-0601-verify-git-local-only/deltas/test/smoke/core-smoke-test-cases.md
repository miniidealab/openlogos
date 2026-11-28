## ADDED — OpenLogos 0.16.30 验收期间 git 调用只读本地安装态 smoke（SMOKE-core-375～379）

> 这组用例验证本提案 verify-git-local-only 的修正，已在本机全局安装态中以 0.16.30 的身份生效（功能规格 §2.111；需求 AC-VERIFY-LOCAL-09）。完整行为已由仓库内 UT-S13-309～UT-S13-322、ST-S13-57、ST-S13-58 覆盖。安装态取证：装上的是本次批准的 0.16.30；全局 CLI 在一次性项目中，本地缺文件内容、缺起点提交、发布查询提交不存在三种情形下都没有连接远端、对象库不变，并各自落入既有结果；回落后门禁按实际结果判定；对象齐全时范围与结果不变。
>
> **夹具 `G`（分层）**：每条用例在各自的 `mktemp -d` 一次性 git 项目内执行，经全局 `openlogos init` 建立项目后写入：
> - 单模块 `core` launched，`verify.layered.enabled: true`；
> - 已合并测试规格：`core-S01-test-cases.md`（UT-S01-01、02）、`core-S02-test-cases.md`（UT-S02-01、02）、`core-S03-test-cases.md`（UT-S03-01、02，含「主链路用例」小节，列出 UT-S03-01）；另有已跟踪的源码文件 `src/core.ts`；
> - `verify.pre_run_command` 指向夹具内的记录型脚本：每次被执行时在项目外追加一行调用记录（收到的清单、实际执行的用例 ID）；收到清单时只执行、只上报清单内的用例；按剧本决定每条用例写 pass 或 fail，缺省全部 pass；
> - 全部内容提交后，经全局 `openlogos change <slug>` 建立活跃提案（guard 带 `baseRef`），声明 `assessment: assessed`、`shared_change: false`，`scenarios` 为 S02（由夹具函数写成含 `id` 与非空 `reason` 的对象）；提案期间修改 `src/core.ts`。
> - 缺省提案集合为 UT-S02-01、UT-S02-02、UT-S03-01；UT-S01-01、UT-S01-02、UT-S03-02 在集合之外。
>
> **远端与远端接入记录**：项目外的一个本机裸仓库持有项目的全部对象并允许按对象取回；项目把它登记为远端，只配置 URL 与取回过滤器，并显式配置 `protocol.file.allow=always`。远端一侧每收到一次请求就在项目外的记录文件追加一行。每条用例都先执行对照步骤（不加保护、直接读取同一个缺失对象，记录中出现条目且对象被取回），证明记录有区分力；随后恢复缺失状态、清空记录，再执行全局 CLI。对照步骤失败判该用例 fail。
>
> **对象库快照**：松散对象与 pack 目录的文件清单；「对象库不变」指全局 CLI 执行前后快照相同。
>
> **git 调用记录**：执行全局 CLI 时把一个记录型的 `git` 包装放在 `PATH` 最前，每次被调用时在项目外追加一行（参数），再转交真实的 git。用于确认某个 git 调用有没有发生。
>
> **版本**：本次批准的目标版本是 `0.16.30`（需求 AC-VERIFY-LOCAL-09）。runner 中把它写成唯一的常量 `APPROVED_VERSION = '0.16.30'`，SMOKE-core-375 同时断言它与全局 `--version`、部署回执的 `candidate_version`、源码候选版本（`cli/src/lib/local-release-candidate.ts`）四者相等。只有关系式相等而版本不是 `0.16.30` 判 fail。
>
> runner 对全局安装态**只读**，不做安装或卸载。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-375 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并以包内校验器重算 | ① `--version` 等于 `0.16.30`，并等于本次成功部署回执中的 `candidate_version` 与源码候选版本；入口无 workspace link，回执 `entry_realpath` 为非空绝对路径且等于入口 realpath；② 校验器不抛错 | 保留读取结果；回流部署，不继续后续用例的通过判定 |
| SMOKE-core-376 | 本地缺文件内容时不连接远端，扩大到全量后按实际结果判定 | 夹具 `G`；删除 `src/core.ts` 在提案起点中的内容对象。两臂：① 全部 pass；② 提案集合之外的 UT-S03-02 实际会失败，其余全部 pass。两臂都没有其他门禁原因 | 每臂执行全局 `openlogos verify --format json`；读取远端接入记录、对象库快照与调用记录 | 两臂：远端接入记录为空；对象库不变；`layers.expansion.level="full"`，原因含 `base_ref_unavailable`，其 `detail` 含 `diff_failed` 与「本地缺少对象，验收不从远端取回」；入口执行了全部 6 条用例。① 退出码 0，`gate.result="PASS"`；② 退出码 1，`gate.result="FAIL"`、`gate.reason="failed_cases"` | 保留信封、远端接入记录、对象库快照与调用记录；回流实现 |
| SMOKE-core-377 | 本地缺起点提交对象时不连接远端，判为起点不可达 | 夹具 `G`；把 guard 的 `baseRef` 改为只存在于远端、本地没有的一个提交号 | 全局 `openlogos verify --format json`；读取远端接入记录、对象库快照、git 调用记录与调用记录 | 远端接入记录为空；对象库不变；`layers.expansion.level="full"`，原因含 `base_ref_unavailable`，其 `detail` 含 `base_ref_unreachable`、不含 `diff_failed`；git 调用记录中有检查该起点提交的调用，没有以该起点为参数的差异计算（`diff`）调用；入口执行了全部 6 条用例；退出码 0，`gate.result="PASS"` | 同上 |
| SMOKE-core-378 | 发布查询指定的提交本地不存在时不连接远端并照旧拒绝 | 夹具 `G` 去掉活跃提案，全部内容已提交、工作区干净；取一个只存在于远端的提交号 | 全局 `openlogos verify --release --check --commit <该提交号> --format json`；读取远端接入记录、对象库快照与调用记录 | 远端接入记录为空；对象库不变；退出码 2，stderr 错误信封 `error.code="RELEASE_CHECK_COMMIT_INVALID"`；测试入口没有被调用 | 同上 |
| SMOKE-core-379 | 对象齐全时验收范围与结果不变 | 夹具 `G`，登记了远端但不删除任何对象；全部 pass | 全局 `openlogos verify --format json`；读取远端接入记录与调用记录 | 退出码 0，`gate.result="PASS"`；`layers.expansion.level="none"`；入口实际执行的用例恰为 UT-S02-01、UT-S02-02、UT-S03-01；远端接入记录为空 | 同上 |

### 二、执行边界

- 全部读写只在一次性项目、项目外临时目录与受控临时目录内进行，结束即删除；远端是本机裸仓库，不配置网络远端、不联网。
- **不得**触碰以下对象：本仓活跃提案；本仓 `logos/resources/`（结果账本除外）；本仓运行态目录与账本；本仓的 git 分支、工作区、对象库与配置；本仓登记表；用户其他仓库（包括 runlogos）；本机全局 prefix；用户级 git 配置。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行，才带 `target_environment="test"`；目标不是 test 的 skip 行与窗口之外的 skip 行，都不声明 `target_environment`。

### 三、追溯与覆盖

- 需求：AC-VERIFY-LOCAL-01、02、03、05、06、09；功能规格：§2.111。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.30 本机测试环境发布（verify-git-local-only）」。
- 仓库内对应用例：
  - SMOKE-core-376：UT-S13-310、UT-S13-315、ST-S13-58；
  - SMOKE-core-377：UT-S13-311；
  - SMOKE-core-378：UT-S13-312；
  - SMOKE-core-379：UT-S13-318。
- 未在安装态重复的三项，及其理由：
  - 调用超过时限（AC-VERIFY-LOCAL-04）：安装态要等满 60 秒才能触发，且需要替换 git 才能制造等待；由仓库内 UT-S13-314（超时后的分支）与 UT-S13-321（短时限下真实子进程被终止）覆盖；
  - 不识别禁用取回开关的 Git（AC-VERIFY-LOCAL-07）：本机全局只有一个 Git 版本，无法在安装态切换；由 UT-S13-313 以不设置该开关的方式覆盖，且没有在真实旧版 Git 上执行；
  - smoke 历史记录不变与不弹提示（AC-VERIFY-LOCAL-08）：由 UT-S13-317、UT-S13-319 覆盖。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-verify-git-local-only.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-375～SMOKE-core-379，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。
- **适用窗口**：活跃变更为 `verify-git-local-only`，或设置了 `OPENLOGOS_VGL_SMOKE=1`。窗口之外，为全部 owned ID 写 skip，不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_VGL_` 前缀。
- **部署前置**：先读部署账本中本提案在 test 的最后一条成功 deploy。没有记录时写显式 `skip`，并携带缺失项。有记录时，要求源码候选版本可读，且回执满足以下全部条件，任一不符判 fail：同一 deploy_id；`result=done`；`candidate_version` 等于源码候选版本，且等于 `APPROVED_VERSION`（`0.16.30`）；`entry_realpath` 为非空绝对路径。有 skip 时不得写 `SMOKE_PASS`。
- **子进程与超时**：全局 CLI 子进程在独立进程组中运行，每次限时 120 秒；到时对整个进程组强制终止，判 fail。
- **判定方式**：按预期退出码与输出通道判定。要求解析信封的步骤一律以 `--format json` 调用，并对 `stdout.trim()` 整体 `JSON.parse`（错误信封在 stderr 时同样整体解析）。以下情况都判该用例 fail，不得重试后写 pass：超时、被信号终止、启动错误、非预期退出码、信封无法整体解析、对照步骤未能证明远端接入记录有区分力。「远端有没有收到请求」读远端接入记录，「对象库有没有新增」比较快照，「某个 git 调用有没有发生」读 git 调用记录，「实际执行了哪些用例」读调用记录，都不从 CLI 输出推断。
- **失败证据**：行为用例失败时，在清理夹具之前把每条全局 CLI 命令的完整 stdout 与 stderr（含失败的 `init`）、远端接入记录原文、git 调用记录原文、执行前后的对象库快照与逐次调用记录写入该用例的失败证据；文件不存在时明确记录缺失。
- **结果写入**：写入 smoke reporter，每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 这组用例都不需要人参与，不带 `[manual]` 标记。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-375～SMOKE-core-379 均被 runner 覆盖。
