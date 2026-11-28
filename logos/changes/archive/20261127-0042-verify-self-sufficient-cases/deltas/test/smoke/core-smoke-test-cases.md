## ADDED — OpenLogos 0.16.24 verify 自足安装态 smoke（SMOKE-core-338～341）

> 这组用例验证本提案 verify-self-sufficient-cases 的 verify 自足能力已在本机全局安装态中以 0.16.24 的身份生效（功能规格 §2.106；需求 AC-VERIFY-SELF-12）。完整行为已由仓库内 UT-S13-157～UT-S13-173、ST-S13-40～ST-S13-43、UT-S09-490～UT-S09-492、UT-S35-225～UT-S35-230、UT-S08-90～UT-S08-92 覆盖。安装态只取证：装上的是本次候选；全局 CLI 在一次性项目中确实按新规则对账、预检、分类跳过；新建提案与生成指令带新内容。
>
> **夹具**：每条用例在各自的 `mktemp -d` 一次性 git 项目 `P` 内执行，经全局 `openlogos init` 建立项目后写入：
> - 单模块 `core` launched，已合并测试规格含 UT-S01-01；`verify.pre_run_command` 指向夹具内的记录型脚本：被执行时在项目外临时目录写标记 `RAN`，按环境变量为每条用例写 pass 或 skip（skip 可带 `reason_code` / `detail`）；
> - 活跃提案 `vs-smoke`：从不含 UT-S01-90 的已合并基线出发，测试 delta 新增 UT-S01-90，经全局 CLI 的正常 `openlogos merge` 合并，产生 `SPEC_MERGED.test_change_set`；proposal 含「验收标准」段。**启动 verify 前**以全局包内的正式读取器（`readTestChangeSet`）断言变更集包含 UT-S01-90、不含存量对照 UT-S01-02，不满足即判该用例 fail（评审 delta-r1 F4）；
> - 项目外临时 bin 目录 `B`，内含可执行脚本 `vs-fake-tool`；是否把 `B` 加入 `PATH` 由用例控制。
>
> 每次执行全局 CLI 前把夹具改动提交到本地 git。runner 对全局安装态**只读**，不做安装或卸载。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.24`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-338 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并以包内校验器重算 | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link，回执 `entry_realpath` 为非空绝对路径且等于入口 realpath；② 校验器不抛错（payloadHash 与全部资源摘要自洽） | 保留读取结果；任一不符则停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-339 | 对账与环境预检先于预跑 | 本机全局已安装本次候选；夹具按上述建立，验收标准写 `` `command:vs-fake-tool` `` | ① 配置未声明该命令，执行 `openlogos verify --format json`；② 配置写入 `verify.requirements.commands: ["vs-fake-tool"]`，`PATH` 不含 `B`，再执行；③ 把 `B` 加入 `PATH` 再执行 | ① 退出码 1，`gate.result="FAIL"`，`gate.reason="acceptance_requirement_undeclared"`，诊断点名 `command:vs-fake-tool`，`RAN` 不存在；② 退出码 1，`gate.reason="verify_env_not_ready"`，缺失项含 `vs-fake-tool`，`RAN` 不存在；③ `RAN` 存在，退出码 0，`gate.result="PASS"` | 同上；任一不成立表示新规则未完整进入安装态 |
| SMOKE-core-340 | 本次改动用例的跳过分类 | 同上，配置无环境要求、验收标准字段为「无」；已按夹具说明断言真实变更集包含 UT-S01-90 | ① 记录型脚本对 UT-S01-90 写无原因 skip，执行 `openlogos verify --format json`；② 改写为 `reason_code:"platform-unavailable"`、`detail:"requires win32"` 再执行 | ① 退出码 1，`gate.reason="case_tier_mismatch"`，`tier_mismatch_cases` 含 UT-S01-90；② 退出码 0，`gate.result="PASS"`，`platform_skipped_cases` 含 `{id:"UT-S01-90", detail:"requires win32"}` | 同上 |
| SMOKE-core-341 | 新建提案带验收标准段、生成指令为新口径 | 本机全局已安装本次候选；另建一次性 launched 项目（`locale: "zh"`），无活跃提案 | ① 执行 `openlogos change vs-smoke-new` 并读取 proposal.md；② 删除该段后执行 `openlogos change-lint --format json`；③ 读取 `openlogos init` 生成的 CLAUDE.md | ① 含「## 验收标准」段与三个字段；② 退出码 0（若无其他违规），`warnings` 含 `acceptance_criteria_missing`；③「保护范围配置」条款写明只禁止直接修改 `.gitignore`、`.git/info/exclude` 与 `logos.config.json` 的 `guard` 字段，其他字段限已立案的提案范围内可改 | 同上 |

### 二、执行边界

- 全部读写只在一次性项目 `P`、项目外临时目录与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录、本仓的 git 分支与工作区、用户其他仓库（包括 runlogos、markdown6）或本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行才带 `target_environment="test"`；目标非 test 的 skip 行与窗口之外的 skip 行都不声明 `target_environment`。

### 三、追溯与覆盖

- 需求：AC-VERIFY-SELF-12；功能规格：§2.106。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.24 本机测试环境发布（verify-self-sufficient-cases）」。
- 仓库内对应用例：UT-S13-158、ST-S13-40 对应 SMOKE-core-339 ①；UT-S13-161、ST-S13-40 对应 SMOKE-core-339 ②③；UT-S13-165、UT-S13-166、ST-S13-42 对应 SMOKE-core-340；UT-S09-490、UT-S35-225、UT-S08-90 对应 SMOKE-core-341。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-verify-self-sufficient.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-338～SMOKE-core-341，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。
- 适用窗口：活跃变更为 `verify-self-sufficient-cases`，或设置了 `OPENLOGOS_VS_SMOKE=1`。窗口之外为全部 owned ID 写 skip，不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_VS_` 前缀。
- 部署前置：先读部署账本中本提案在 test 的最后一条成功 deploy；没有记录时写显式 `skip` 并携带缺失项；有记录时要求源码候选版本可读，且回执同一 deploy_id、`result=done`、`candidate_version` 等于源码候选版本、`entry_realpath` 为非空绝对路径，任一不符判 fail。有 skip 时不得写 `SMOKE_PASS`。
- 全局 CLI 子进程在独立进程组中运行，每次限时 120 秒，到时对整个进程组强制终止并判 fail。
- 按预期退出码与输出通道判定：要求解析信封的步骤一律以 `--format json` 调用，并对 `stdout.trim()` 整体 `JSON.parse`；超时、被信号终止、启动错误、非预期退出码或信封无法整体解析，均判该用例 fail，不得重试后写 pass。
- 「预跑未执行」以项目外标记 `RAN` 是否存在判定。
- 结果写入 smoke reporter，每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-338～SMOKE-core-341 均被 runner 覆盖。
