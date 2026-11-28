## ADDED — S13 失败用例复跑与偶发判定测试（verify-flaky-rerun）

> 覆盖场景 `core-S13-verify-results.md`「S13 失败用例复跑与偶发判定」（Step 1～14、EX-13.16～EX-13.27），功能规格 §2.108.2～§2.108.11、§2.104.3（修改），`spec/test-results.md`「失败用例复跑与偶发（verify-flaky-rerun）」，`spec/cli-json-output.md`「verify 失败用例复跑与偶发（verify-flaky-rerun）」；需求 AC-VERIFY-RERUN-01～11、13。
>
> **夹具 RR**：`mktemp -d` 一次性 git 项目，单模块 `core`（launched），已合并测试规格定义 UT-S01-01、UT-S01-02、UT-S01-03；`verify.pre_run_command` 指向记录型 runner `rr-runner.mjs`：
> - 每次被执行时，在项目外临时目录追加一行调用记录（第几次调用、收到的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 与 `OPENLOGOS_VERIFY_RERUN`、当前工作目录）；
> - 启动时清空结果文件（与「清空策略」一致）；
> - 按夹具内的剧本文件决定每条用例在第 1 次、第 2 次调用时写 pass / fail / skip 或不写；有 fail 时以非零状态退出，剧本可覆盖某次调用的退出码；
> - 每条记录缺省写毫秒精度的 ISO `timestamp`；剧本可令某次调用不写 `timestamp`，或写固定的秒级值（两次调用写同一值即构成同刻）；剧本可令某次调用在末尾追加一行非法 JSON；
> - 收到 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 时只写集合内用例；变体 **RR-wide** 忽略该变量，每次都写全部用例。
>
> 其他变体：
> - **RR-rollback**：有失败时把结果文件回滚为上一份全部通过的结果，再以非零状态退出（EX-9.1 形态）。
> - **RR-two**：配置 `regression_command` 与 `incremental_command`，两段各写一部分用例。
> - **RR-two-shared**：同 RR-two，但不配置阶段结果路径，两段共用 `result_path`；剧本允许同一 ID 在两段各写一次。
> - **RR-mod**：多模块（`core`、`backend`，各自声明非空 `paths`），`verify.modules.backend` 有独立命令组。
> - **RR-slice**：有效切片 manifest 与活跃提案，处于 slice-checkpoint 验收。
>
> 「不复跑时与现状一致」类断言以同一夹具在引入前实现上生成的 golden 比对（新增的 `rerun` 字段除外）。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-180 | 首跑失败、复跑通过记为偶发 | §2.108.6、§2.108.8、AC-VERIFY-RERUN-01 | 夹具 RR；剧本：UT-S01-01 第 1 次 fail、第 2 次 pass，其余 pass | `verify --format json` | runner 被调用 2 次，第 2 次收到 `ELIGIBLE_TEST_IDS=["UT-S01-01"]` 与 `RERUN=1`；`gate.result="PASS"`；`flaky_cases` 仅含 UT-S01-01 且 `first_error` 为首跑的错误；`failed_cases` 为空；`warnings` 含 `flaky_cases_present`；退出码 0 |
| UT-S13-181 | 复跑仍失败照常 FAIL | §2.108.6、AC-VERIFY-RERUN-02 | 夹具 RR；UT-S01-01 两次都 fail | `verify --format json` | `gate.result="FAIL"`、`gate.reason="failed_cases"`；`failed_cases` 含 UT-S01-01；无 `flaky_cases`；无 `flaky_cases_present` |
| UT-S13-182 | 部分偶发、部分失败 | §2.108.6、AC-VERIFY-RERUN-03 | 夹具 RR；UT-S01-01 第 2 次 pass，UT-S01-02 两次都 fail | `verify --format json` | FAIL `failed_cases`；`flaky_cases` 仅含 UT-S01-01，`failed_cases` 仅含 UT-S01-02；`rerun.requested_ids` 为两者 |
| UT-S13-183 | 复跑没有新记录时维持失败 | §2.108.6、EX-13.17、AC-VERIFY-RERUN-04 | 夹具 RR；UT-S01-01 第 1 次 fail、第 2 次不写 | `verify --format json` | FAIL `failed_cases`；UT-S01-01 的 `error` 为首跑的；诊断说明复跑未产生通过结果 |
| UT-S13-184 | 复跑记录为 skip 时维持失败 | §2.108.6、EX-13.17 | 夹具 RR；UT-S01-01 第 2 次写 skip（带平台跳过原因） | `verify --format json` | FAIL `failed_cases`；UT-S01-01 不进入 `platform_skipped_cases`，不进入 `flaky_cases` |
| UT-S13-185 | 首跑通过的用例不因复跑丢失 | §2.108.6、EX-13.20、AC-VERIFY-RERUN-05 | 夹具 RR（runner 每次启动清空结果文件）；UT-S01-01 第 2 次 pass | `verify --format json`，随后读取 `result_path` | 三条用例都有结果；无未覆盖；`result_path` 含三条用例的最终记录，UT-S01-02、UT-S01-03 为首跑记录 |
| UT-S13-186 | 复跑写入集合之外的记录不采信（复跑非零退出） | §2.108.6、§2.108.7、EX-13.19、EX-13.21 | 夹具 RR-wide；UT-S01-01 第 2 次 pass，UT-S01-02 第 1 次 pass、第 2 次 fail（两次调用都因有 fail 而非零退出） | `verify --format json` | `flaky_cases` 仅含 UT-S01-01；UT-S01-02 计为通过、不在 `failed_cases`（`failed_cases` 为空）；`rerun.commands[0].rerun_exit_code` 非零、`status_after="fail"`；`gate.result="FAIL"`、`gate.reason="pre_run_failed"`；诊断提示测试入口未按集合收窄 |
| UT-S13-187 | 超过上限不复跑 | §2.108.3、EX-13.16、AC-VERIFY-RERUN-06 | 夹具 RR；`rerun_failed.max_cases: 1`；首跑两条 fail | `verify --format json` | runner 只被调用 1 次；FAIL `failed_cases`；`rerun.attempted=false`、`skipped_reason="too_many_failures"`，`requested_ids` 含两条 |
| UT-S13-188 | 上限边界 | §2.108.3 | 夹具 RR；`max_cases: 2`；首跑恰好两条 fail，复跑都 pass | `verify --format json` | 复跑执行；`gate.result="PASS"`；`flaky_cases` 含两条 |
| UT-S13-189 | 关闭后与引入前一致 | §2.108.2、EX-13.24、AC-VERIFY-RERUN-07 | 夹具 RR；`rerun_failed.enabled: false`；UT-S01-01 首跑 fail | `verify --format json` | runner 只被调用 1 次；`skipped_reason="disabled"`；除 `rerun` 外，输出与引入前 golden 一致，退出码一致 |
| UT-S13-190 | 配置缺省与非法取值 | §2.108.2、EX-13.24 | 夹具 RR；依次为：不写 `rerun_failed`、`max_cases: 0`、`enabled: "yes"`、`rerun_failed: []` | `verify --format json` | 不写时 `rerun.max_cases=10` 且复跑生效；三种非法情形都按缺省值处理，`warnings` 含 `rerun_config_invalid` 并指出字段，门禁结论不因警告改变 |
| UT-S13-191 | 首跑无失败时不复跑 | §2.108.3、AC-VERIFY-RERUN-11 | 夹具 RR；全部 pass | `verify --format json` | runner 只被调用 1 次；`rerun.attempted=false`、`skipped_reason="no_failed_cases"`、`requested_ids=[]`、`commands=[]`；除 `rerun` 外与 golden 一致 |
| UT-S13-192 | 测试入口回滚账本时不复跑 | §2.108.3、EX-13.18、AC-VERIFY-RERUN-08 | 夹具 RR-rollback；首跑有失败 | `verify --format json` | runner 只被调用 1 次；`gate.reason="pre_run_failed"`；`skipped_reason="no_failed_cases"` |
| UT-S13-193 | 环境预检失败时不复跑 | §2.108.3、EX-13.25、AC-VERIFY-RERUN-08 | 夹具 RR；声明 `verify.requirements.env: ["RR_TOKEN"]` 且未设置 | `verify --format json` | runner 未被调用；`gate.reason="verify_env_not_ready"`；响应含 `rerun`，`attempted=false`、`skipped_reason="precheck_failed"` |
| UT-S13-194 | 未执行预跑命令时不复跑 | §2.108.3、EX-13.25 | 夹具 RR 去掉 `pre_run_command`，结果文件预置一条 fail | `verify --format json` | FAIL `failed_cases`；`skipped_reason="no_command"` |
| UT-S13-195 | 测试变更集无效时不复跑 | §2.108.3、EX-13.25 | 夹具 RR 加活跃提案与无效的 `SPEC_MERGED.test_change_set`；首跑有失败 | `verify --format json` | runner 只被调用 1 次；`gate.reason="test_change_set_invalid"`；`skipped_reason="gate_blocked"` |
| UT-S13-196 | 命令组改判成立 | §2.108.7、§2.108.8 | 夹具 RR；UT-S01-01 第 2 次 pass，复跑命令零退出 | `verify --format json` | `pre_run.commands[0].status="fail"` 且 `exit_code` 为首跑退出码（不改写）；`rerun.commands[0]` 的 `first_exit_code` 非零、`rerun_exit_code=0`、`status_after="pass"`；`gate.result="PASS"` |
| UT-S13-197 | 复跑命令非零退出时不改判 | §2.108.7、EX-13.19 | 夹具 RR；剧本让第 2 次调用写 UT-S01-01 pass 后仍以非零状态退出 | `verify --format json` | `flaky_cases` 含 UT-S01-01；`rerun.commands[0].status_after="fail"`；`gate.result="FAIL"`、`gate.reason="pre_run_failed"` |
| UT-S13-198 | 改判不掩盖未覆盖 | §2.108.7 残余风险 | 夹具 RR；首跑 UT-S01-01 fail、UT-S01-03 没有记录；复跑 UT-S01-01 pass | `verify --format json` | `gate.result="FAIL"`，原因为未覆盖（`incomplete_coverage`）；`flaky_cases` 含 UT-S01-01 |
| UT-S13-199 | 同一沙箱内复跑 | §2.108.5 | 夹具 RR，`sandbox_mode: always` | `verify --format json` | 两次调用记录的工作目录相同；沙箱诊断显示只创建一次副本 |
| UT-S13-200 | 沙箱关闭时原地复跑 | §2.108.5 | 夹具 RR，`sandbox_mode: off`；UT-S01-01 第 2 次 pass | `verify --format json` | 两次调用的工作目录都是项目根；`gate.result="PASS"` |
| UT-S13-201 | 复跑结束后恢复环境变量 | §2.108.5 | 进程内调用 verify；调用前设置 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS=x`、未设置 `OPENLOGOS_VERIFY_RERUN` | 首跑有失败并复跑后返回 | 两个变量恢复为调用前的状态 |
| UT-S13-202 | 两阶段命令按阶段复跑 | §2.108.5、EX-13.23 | 夹具 RR-two；失败用例只来自 incremental 阶段，复跑通过 | `verify --format json` | 只有 incremental 命令被再执行一次；`rerun.commands` 仅一项、`stage="incremental"`；regression 阶段的用例结果不变 |
| UT-S13-203 | 模块范围下只复跑相关命令组 | §2.108.4、§2.108.5、EX-13.22、AC-VERIFY-RERUN-10 | 夹具 RR-mod；失败用例只属于 `backend`，复跑通过 | 启用模块范围执行 `verify --format json` | 只有 `backend` 命令组被再执行；复跑时 `OPENLOGOS_VERIFY_MODULES` 与首跑相同；`rerun.commands[0].modules=["backend"]`；`flaky_cases[0].module="backend"` |
| UT-S13-204 | 切片 checkpoint 下与 eligible 求交 | §2.108.4、EX-13.22、AC-VERIFY-RERUN-10 | 夹具 RR-slice；首跑 eligible 内一条 fail，复跑通过 | `verify --format json` | `requested_ids` 是 eligible 的子集；复跑时 `OPENLOGOS_VERIFY_SLICE_SCOPE` 与首跑相同；checkpoint 通过并记录该切片 |
| UT-S13-205 | 验收报告的偶发用例小节 | §2.108.9 | 夹具 RR；UT-S01-01 第 2 次 pass | `verify`，读取 `acceptance-report.md` | 报告含「偶发用例」小节，列出 UT-S01-01、模块与首跑错误摘要及提示语；不含命令输出；无偶发时不出现该小节 |
| UT-S13-206 | 验收历史记录偶发 | §2.104.3、§2.108.9、AC-VERIFY-RERUN-09 | 夹具 RR；UT-S01-01 第 2 次 pass | `verify`，随后 `history show <run_id> --format json` | 记录 `flaky_ids=["UT-S01-01"]`；`failed_ids` 为空；`counts.failed=0`、`counts.passed=3` |
| UT-S13-207 | 历史读取兼容 | §2.104.3 | 预置三份历史记录：缺 `flaky_ids`；`flaky_ids: []`；`flaky_ids: "x"` | `history list --format json` | 前两份正常读出，缺字段的按空数组；第三份按损坏记录跳过并给出警告 |
| UT-S13-208 | 文本模式输出偶发清单 | §2.108.9 | 夹具 RR；UT-S01-01 第 2 次 pass | `verify`（文本模式，zh 与 en 各一次） | 门禁结论之后输出偶发用例清单与提示语；两种语言都有对应文案 |
| UT-S13-209 | `VERIFY_PASS` 照常写入 | §2.108.8 | 夹具 RR 加活跃提案；UT-S01-01 第 2 次 pass，其余判据满足 | final `verify` | 写入 `VERIFY_PASS`；报告与 JSON 带偶发清单 |
| UT-S13-210 | 首跑账本的非法行不被复跑抹掉 | §2.108.5、§2.108.6、EX-13.26、AC-VERIFY-RERUN-13 | 夹具 RR 加活跃提案；UT-S01-01 第 1 次 fail、第 2 次 pass，其余首跑 pass；剧本令第 1 次调用末尾追加一行非法 JSON；第 2 次调用清空结果文件、只写 UT-S01-01 并以 0 退出 | final `verify --format json`，随后读取 `result_path` 与 `acceptance-report.md` | `flaky_cases` 含 UT-S01-01，`failed_cases` 为空、无未覆盖；`rerun.commands[0].status_after="pass"`；`gate.result="FAIL"`、`gate.reason="result_ledger_inconsistent"`；`consistency` 含首跑非法行的原因；报告保留该原因；不写 `VERIFY_PASS`；`result_path` 按原文保留该非法行 |
| UT-S13-211 | 复跑记录不写 timestamp 时照常采信 | §2.108.5、§2.108.6、AC-VERIFY-RERUN-01 | 夹具 RR；剧本令两次调用都不写 `timestamp`；UT-S01-01 第 1 次 fail、第 2 次 pass | `verify --format json` | `gate.result="PASS"`；`flaky_cases` 含 UT-S01-01；`failed_cases` 为空 |
| UT-S13-212 | 复跑记录与首跑同刻时照常采信 | §2.108.5、§2.108.6、AC-VERIFY-RERUN-01 | 夹具 RR；剧本令两次调用对 UT-S01-01 写同一个秒级 `timestamp`；第 1 次 fail、第 2 次 pass | `verify --format json` | `gate.result="PASS"`；`flaky_cases` 含 UT-S01-01。另以第 2 次不写 UT-S01-01（同刻配置不变）复测：UT-S01-01 维持失败，FAIL `failed_cases`（AC-VERIFY-RERUN-04） |
| UT-S13-213 | 集合外记录不采信且复跑零退出时放行 | §2.108.6、§2.108.7、EX-13.21 | 夹具 RR-wide；UT-S01-01 第 2 次 pass，UT-S01-02 第 1 次 pass、第 2 次 fail；剧本把第 2 次调用的退出码覆盖为 0 | `verify --format json` | `flaky_cases` 仅含 UT-S01-01；UT-S01-02 计为通过、不在 `failed_cases`；`rerun.commands[0].rerun_exit_code=0`、`status_after="pass"`；`gate.result="PASS"`；诊断提示测试入口未按集合收窄 |
| UT-S13-214 | 同一 ID 跨阶段时只在生效来源复跑一次 | §2.108.5、§2.108.6、EX-13.23、AC-VERIFY-RERUN-10 | 夹具 RR-two-shared；UT-S01-01 在 regression 首跑 pass、在 incremental 首跑 fail（生效记录为后者）；incremental 复跑写 UT-S01-01 pass | `verify --format json`；读取调用记录 | regression 命令只被调用 1 次，incremental 命令被调用 2 次，复跑时收到 `["UT-S01-01"]`；`rerun.commands` 仅一项、`stage="incremental"`；`flaky_cases` 含 UT-S01-01。另以 incremental 复跑不写 UT-S01-01 复测：regression 仍只被调用 1 次，UT-S01-01 维持失败，不进入 `flaky_cases`，FAIL `failed_cases` |
| UT-S13-215 | 一次性沙箱副本保留到复跑结束 | §2.108.5 | 夹具 RR，`sandbox_mode: always`、`sandbox_reuse: false`；UT-S01-01 第 2 次 pass | `verify --format json` | 两次调用记录的工作目录相同；`gate.result="PASS"`；verify 返回后该一次性副本目录已删除 |
| UT-S13-216 | 首跑执行环境不可用时不复跑 | §2.108.3、§2.108.5、EX-13.27、AC-VERIFY-RERUN-08 | 进程内调用 verify，夹具 RR，`sandbox_mode: always`；UT-S01-01 首跑 fail；以测试替身在首跑结束、复跑开始前删除首跑副本目录 | `verify --format json`；读取调用记录 | runner 只被调用 1 次（没有第二次调用，也没有在新副本或工作区中调用）；无 `flaky_cases`；`rerun.attempted=false`、`skipped_reason="sandbox_unavailable"`；`rerun.commands` 仍有一项，`rerun.commands[0].rerun_exit_code=null`、`skipped_reason="sandbox_unavailable"`、`status_after="fail"`（首跑非零退出）；FAIL `failed_cases`，UT-S01-01 的 `error` 为首跑的。另以首跑零退出的变体复测（剧本把第 1 次调用的退出码覆盖为 0，并在末尾追加一行非法 JSON，UT-S01-01 仍写 fail）：runner 只被调用 1 次；`rerun.commands[0].status_after="pass"`（取首跑状态，不强制为 fail）；UT-S01-01 维持失败、不进入 `flaky_cases`；`gate.result="FAIL"`、`gate.reason="result_ledger_inconsistent"` |

### 场景测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| ST-S13-44 | 偶发失败不再打断验收 | Step 1～14、AC-VERIFY-RERUN-01、05、09 | 真实 CLI（构建后的 `dist/index.js`）；夹具 RR，`sandbox_mode: always`；UT-S01-01 第 1 次 fail、第 2 次 pass | ① `verify --format json`；② 读取 `result_path` 与 `acceptance-report.md`；③ `history list --format json` | ① 退出码 0，`gate.result="PASS"`，`flaky_cases` 含 UT-S01-01，`warnings` 含 `flaky_cases_present`；② 三条用例都有最终记录，报告含「偶发用例」小节；③ 最新记录 `flaky_ids=["UT-S01-01"]` |
| ST-S13-45 | 真失败不被复跑放过 | Step 1～14、AC-VERIFY-RERUN-02、03 | 真实 CLI；夹具 RR；UT-S01-01 第 2 次 pass，UT-S01-02 两次都 fail | `verify --format json` | 退出码非 0；FAIL `failed_cases`；`failed_cases` 只含 UT-S01-02，`flaky_cases` 只含 UT-S01-01；报告同时列出失败与偶发 |
| ST-S13-46 | 关闭复跑后回到引入前行为 | EX-13.24、AC-VERIFY-RERUN-07、11 | 真实 CLI；夹具 RR；`rerun_failed.enabled: false` | ① 首跑有失败时 `verify --format json`；② 全部通过时 `verify --format json` | ① runner 只被调用 1 次，FAIL `failed_cases`；② PASS；两次输出除 `rerun` 外与引入前 golden 一致 |
| ST-S13-47 | 大面积失败不复跑 | EX-13.16、AC-VERIFY-RERUN-06 | 真实 CLI；夹具 RR 扩为 12 条用例，首跑 11 条 fail；`max_cases` 缺省 | `verify --format json` | runner 只被调用 1 次；FAIL `failed_cases`；`skipped_reason="too_many_failures"` |

### 覆盖度校验

- 偶发判定与合并：UT-S13-180～UT-S13-186、UT-S13-210～UT-S13-213、ST-S13-44、ST-S13-45。
- 触发条件与配置：UT-S13-187～UT-S13-195、ST-S13-46、ST-S13-47。
- 命令组状态与门禁：UT-S13-196～UT-S13-198、UT-S13-209。
- 执行环境与变量：UT-S13-199～UT-S13-201、UT-S13-215、UT-S13-216。
- 两阶段、模块范围、切片：UT-S13-202～UT-S13-204、UT-S13-214。
- 输出与历史：UT-S13-205～UT-S13-208。
- 异常 EX-13.16～EX-13.27 各至少一条：EX-13.16（187、ST-47）、EX-13.17（183、184）、EX-13.18（192）、EX-13.19（186、197）、EX-13.20（185）、EX-13.21（186、213）、EX-13.22（203、204）、EX-13.23（202、214）、EX-13.24（189、190、ST-46）、EX-13.25（193～195）、EX-13.26（210）、EX-13.27（216）。
- 需求 AC-VERIFY-RERUN-01～11、13 均有对应用例；AC-VERIFY-RERUN-12 由安装态 smoke 覆盖。

### 自动化与证据要求

- 全部用例由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
- 不需要人参与；不需要额外的环境要求；无平台限定用例。
- 夹具 runner 的「第几次调用」以项目外临时目录中的调用记录计数，不依赖时间或随机。
- 断言「runner 被调用几次」「复跑收到的变量」一律读调用记录，不从 CLI 输出推断。
