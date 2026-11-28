## ADDED — S13 verify 自足：环境预检与跳过分类测试（verify-self-sufficient-cases）

> 覆盖场景 `core-S13-verify-results.md`「S13 verify 自足：环境预检与跳过分类」（Step 1～11、EX-13.1～EX-13.15），功能规格 §2.106.2～§2.106.7A、§2.106.10、§2.104.3（修改），`spec/test-results.md`「`[manual]` 标记用例」「verify 环境要求声明、对账与预检」「verify 跳过分类」「平台跳过原因的 reporter 写法」；需求 AC-VERIFY-SELF-01～08、AC-VERIFY-SELF-11、AC-VERIFY-SELF-13。
>
> **夹具 VS**：`mktemp -d` 一次性 git 项目，单模块 `core`（launched），已合并测试规格定义 UT-S01-01、UT-S01-02、ST-S01-01；`verify.pre_run_command` 指向记录型 runner：被执行时在项目外临时目录写标记文件 `RAN`，并按环境变量决定每条用例写 pass / fail / skip（skip 可带 `reason_code` / `detail`）。变体：
> - **VS-prop**：从不含 UT-S01-90 的已合并基线出发，建立活跃提案 `vs-demo`，测试 delta 新增 UT-S01-90，经正常 `openlogos merge` 合并（或以生产代码同一构造器写出能通过 `readTestChangeSet` 校验的 `SPEC_MERGED`）；proposal 含「验收标准」段。**每条使用 VS-prop 的用例在启动 verify 前先断言**：经 `readTestChangeSet` 读到的 `changed_test_ids` 包含 UT-S01-90、不含存量对照 UT-S01-02（评审 delta-r1 F4）。
> - **VS-req**：`logos.config.json` 声明 `verify.requirements`：`env: ["VS_TOKEN"]`、`commands: ["vs-fake-tool"]`、`checks: [{name: "vs-ready", command: "node check.mjs"}]`；`vs-fake-tool` 是放在临时 bin 目录中的可执行脚本，`check.mjs` 按环境变量决定退出码或挂起。
> - **VS-mod**：多模块（`core`、`backend`，各自声明非空 `paths`），`verify.modules.backend` 有独立命令组与 `requirements`。
>
> 「未声明要求时与现状一致」类断言以同一夹具在引入前实现上生成的 golden 比对。环境变量的值一律使用占位值 `VS-SECRET-9c1e`，断言其不出现在 stdout、stderr、验收报告与历史文件中。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-157 | 环境要求结构非法 | §2.106.4 | 夹具 VS；`verify.requirements` 依次为：`env` 不是数组、`checks` 中 `name` 重复、`name` 含空格 | `verify --format json` | 三种情形均门禁 FAIL，`gate.reason="verify_requirements_invalid"`，诊断指出字段；`RAN` 不存在 |
| UT-S13-158 | 验收标准条目未写入配置 | §2.106.5 第 2 步、EX-13.1 | 夹具 VS-prop；验收标准「自动验收环境要求」为 `` `command:vs-fake-tool` `` 与 `` `check:vs-ready` ``；配置只声明了 `commands: ["vs-fake-tool"]` | `verify --format json` | 门禁 FAIL，`gate.reason="acceptance_requirement_undeclared"`，`data.requirements.missing_declarations` 恰为 `["check:vs-ready"]`；`RAN` 不存在；验收报告写明缺失条目 |
| UT-S13-159 | 不适用时不对账 | §2.106.5 第 2 步 | 夹具 VS（无活跃提案）；夹具 VS-prop 三个变体：验收标准字段为「无」、缺「验收标准」段、条目全部已声明 | 各执行 `verify --format json` | 均不产生 `acceptance_requirement_undeclared`；`RAN` 存在（进入预跑） |
| UT-S13-160 | 环境变量缺失或为空 | §2.106.5 第 3 步、EX-13.2 | 夹具 VS-req，`vs-fake-tool` 与 `vs-ready` 可用；`VS_TOKEN` 依次为未设置、空串、`VS-SECRET-9c1e` | `verify --format json` | 前两种门禁 FAIL，`gate.reason="verify_env_not_ready"`，`missing_environment` 含 `{kind:"env", name:"VS_TOKEN"}`，`RAN` 不存在；第三种进入预跑；任何输出与报告中都不出现 `VS-SECRET-9c1e` |
| UT-S13-161 | 命令不在 PATH | §2.106.5 第 3 步、EX-13.2 | 夹具 VS-req，`VS_TOKEN` 已设置，临时 bin 目录不在 `PATH` | `verify --format json` | 门禁 FAIL，`missing_environment` 含 `{kind:"command", name:"vs-fake-tool"}`；`RAN` 不存在；把 bin 目录加入 `PATH` 后进入预跑 |
| UT-S13-162 | 检查命令非零退出或超时 | §2.106.5 第 3 步、EX-13.3 | 夹具 VS-req，其余要求满足；`check.mjs` 依次为：输出一行占位值后以 3 退出；挂起不退出（以可注入的检查时限缩短为 1 秒） | `verify --format json` | 两种情形均 `verify_env_not_ready`；`detail` 分别为退出码 3 与「超时」，不含检查命令的输出；超时情形下检查进程组已被终止（进程不残留）；`RAN` 不存在 |
| UT-S13-163 | 按模块确定生效要求：模块级同名 check 只替换本模块 | §2.106.4 生效集合第 2 条 | 夹具 VS-mod：项目级 check `dup` 恒失败；`verify.modules.backend.requirements` 含同名 check `dup`（恒成功）与 `commands: ["vs-backend-only"]` | ① 本次范围只含 `core`；② 本次范围只含 `backend`，`vs-backend-only` 不可用；③ 同 ② 但 `vs-backend-only` 可用 | ① core 使用项目级 `dup`，报 `verify_env_not_ready`（缺 `check dup`，归属 `["core"]`），不检查 `vs-backend-only`，`RAN` 不存在；② backend 的 `dup` 按模块级判定为满足，报缺 `command vs-backend-only`，`RAN` 不存在；③ 预检通过，`RAN` 存在 |
| UT-S13-164 | 预检全部通过后照常执行 | §2.106.5 | 夹具 VS-req，全部要求满足，runner 全部写 pass | `verify --format json` | `RAN` 存在；门禁 PASS；`data.requirements.declared` 与配置一致，`missing_declarations`、`missing_environment` 为空 |
| UT-S13-165 | 严格集合内的非平台 skip 判用例分层错误 | §2.106.6 第 4 条、EX-13.4 | 夹具 VS-prop；runner 对 UT-S01-90 写无原因的 skip，其余 pass | `verify --format json` | 门禁 FAIL，`gate.reason="case_tier_mismatch"`，`tier_mismatch_cases` 恰含 UT-S01-90 与 fix_hint「准备好环境并声明到 verify.requirements，或改标 `[manual]`」；`reason_code` 为 `"env-missing"` 等其他值时同样判定 |
| UT-S13-166 | 平台跳过放行与 detail 为空不放行 | §2.106.6 第 2、4 条、EX-13.5 | 夹具 VS-prop；UT-S01-90 依次写：`reason_code:"platform-unavailable"` + `detail:"requires win32"`；同 `reason_code` + `detail:""`；同 `reason_code` 缺 `detail` | `verify --format json` | 第一种门禁 PASS，`platform_skipped_cases=[{id:"UT-S01-90", detail:"requires win32"}]`，验收报告单独列出；后两种按 UT-S13-165 判 `case_tier_mismatch` |
| UT-S13-167 | 存量与无活跃提案只警告 | §2.106.6 第 5 条、EX-13.8 | ① 夹具 VS-prop，存量 UT-S01-02 写无原因 skip，UT-S01-90 pass；② 夹具 VS（无活跃提案），UT-S01-02 写无原因 skip | `verify --format json` | 两种情形门禁 PASS、退出码 0、`gate.reason` 为空；`warnings` 含 `unclassified_skipped_cases` 并列出 UT-S01-02；`skipped_count`、通过率与引入前 golden 一致 |
| UT-S13-168 | 门禁原因优先级 | §2.106.7 | 夹具 VS-prop 组合：① 对账失败且环境也缺失；② 预跑非零退出 + UT-S01-90 无原因 skip、无失败用例；③ 预跑成功 + 一条失败用例 + UT-S01-90 无原因 skip；④ 预跑成功 + UT-S01-90 无原因 skip + 另有未覆盖用例 | `verify --format json` | ① `acceptance_requirement_undeclared`（不再预检，`missing_environment` 缺省）；② `case_tier_mismatch`；③ `failed_cases`，`tier_mismatch_cases` 照常输出；④ `case_tier_mismatch`，`uncovered_cases` 照常输出 |
| UT-S13-169 | 未声明任何要求的零变化 | §2.106.10、EX-13.9 | 夹具 VS（无 `verify.requirements`、无活跃提案、无 skip）与 VS-prop（验收标准为「无」、严格集合内无 skip） | `verify --format json` 与文本模式 | `gate`、计数、诊断与退出码与引入前 golden 逐项一致；`data.requirements` 缺省；没有新增诊断码 |
| UT-S13-170 | 验收报告与 JSON 展示 | §2.106.5、§2.106.6 | 依次复用 UT-S13-158、UT-S13-160、UT-S13-166 第一种、UT-S13-167 ① 的场景 | 读取 `acceptance-report.md` 与 JSON | 报告分别含「验收标准条目未写入配置」「环境未就绪」（逐项列出名称、不含变量值）、「平台跳过」（ID 与 detail）、「未分类跳过（警告）」小节；JSON 字段名与功能规格一致；验收历史记录的门禁结论与报告一致 |
| UT-S13-171 | ST-S13-26 适用条件单一判定 | §2.106.4、§2.106.10、EX-13.6 | 判定以可注入的平台、uid、复用能力与 `cc` 可用性调用；复用能力缺省取 `detectLivenessCapability()` | 枚举：非 Linux；Linux root；Linux 非 root 复用不可用（含设置 `OPENLOGOS_SANDBOX_TEST_NO_LIVENESS=1`）；Linux 非 root 复用可用。另以同样注入执行本仓 `linux-nondump-cc` 检查命令，`cc` 分别可用与不可用 | 只有「Linux、非 root、复用可用」判为适用；ST-S13-26 的跳过条件与检查命令调用同一判定（源码中只有一处实现）；检查命令在不适用时退出 0，在适用时退出码 = `cc` 是否可用；不适用时 ST-S13-26 写 `platform-unavailable` 与说明条件的 `detail` |
| UT-S13-172 | 分类判据进入规范与 Skill | §2.106.2 | 读取 `spec/test-results.md`、`skills/test-writer/SKILL.md` 及 sync 后的 `logos/skills/test-writer/SKILL.md` | 检查「`[manual]` 标记用例」与 3c | 均包含换版本判据（换一个待验版本、移除上一版本的结果与人工证据），以「每个版本都要人重新准备的证据」归入人工的例子，以及「本节只约束 UT/ST、SMOKE 由后续需求交付」的说明；不再以「CI 无头环境能否稳定运行」作为唯一判断标准 |
| UT-S13-173 | reporter 写平台跳过原因 | `spec/test-results.md`「平台跳过原因的 reporter 写法」 | 本仓 `cli/test/openlogos-reporter.ts`；夹具测试文件以登记入口声明一条平台跳过、一条普通跳过 | 运行夹具测试并读取写出的结果行；另在非 Windows 上运行本仓 ST-S08-45、ST-S09-219、ST-S19-35、ST-S19-36、ST-S19-37 | 平台跳过行带 `reason_code:"platform-unavailable"` 与非空 `detail`；普通跳过行不带 `reason_code`；本仓五条 Windows 用例在非 Windows 上写平台跳过行，`detail` 写明 `requires win32` |
| UT-S13-174 | 模块验收报告不残留旧 PASS | §2.106.7A、`spec/test-results.md`「模块验收报告」第 4、5 条、EX-13.10 | 双模块夹具：`core`（launched）与 `a`、`b` 两个 initial 模块各声明非空 `paths`；`a`、`b` 已有 PASS 模块验收报告与 PASS 结果账本；活跃提案按 VS-prop 方式建立真实变更集，在 `a` 的测试规格 `a-S02-test-cases.md` 中新增 UT-S02-90（前置断言变更集包含它） | ① 声明项目级 `env: ["VS_TOKEN"]` 且不设置，执行 `verify --all --format json`；② 设置 `VS_TOKEN`，runner 对 UT-S02-90 写无原因 skip、其余 pass，再执行；每次之后以 `launch` 使用的模块验收报告判定函数检查 `a`、`b` | ① 共用门禁 `verify_env_not_ready`；`a`、`b` 的模块报告都被整份改写为 FAIL（「模块」行正确，计数「未执行」，正文写明预检原因），判定函数对两者都判未完成；旧账本字节未变且未被读入统计；② 共用门禁 `case_tier_mismatch`；`a` 的报告 FAIL、`b` 的报告 PASS；判定函数对 `a` 判未完成 |
| UT-S13-175 | 检查命令经沙箱执行器在测试同一环境执行；无隔离时只读并如实标注 | §2.106.4 执行环境、EX-13.13 | 夹具 VS-req 设 `verify.sandbox_mode: "always"`（平台不支持隔离时按既有规则改用注入的隔离能力替身）；宿主工作区有 `deps/ready` 标记而沙箱工作副本中没有（按既有沙箱同步规则排除）；隔离臂的 `check.mjs` 检查 `deps/ready` 是否存在，并在当前目录写写入探针 `check-wrote.txt`；降级臂改用只读的 `check-ro.mjs`（只检查 `deps/ready`，不写任何文件）。以可注入的预检钩子在**检查命令执行前后**、verify 写任何报告与启动 runner **之前**各取一次源工作区快照（文件清单与内容） | ① 隔离可用时执行 `verify --format json`；② 让隔离能力不可用，`sandbox_mode` 为 `always`；③ 同 ② 但 `sandbox_mode` 为 `auto`，使用只读检查 | 三臂中检查前后两次快照一致，源工作区始终不存在 `check-wrote.txt`。① 检查在沙箱工作副本中执行并失败，`verify_env_not_ready` 缺 `check vs-ready`，`data.requirements.isolation="sandboxed"`；共用验收报告写明预检原因；`RAN` 不存在；② 以既有沙箱诊断判 FAIL，检查与预跑都未执行，`RAN` 不存在；③ 按既有降级规则在源工作区执行只读检查（宿主有 `deps/ready`，检查通过），`isolation="unisolated"`，验收报告含「本次检查未隔离」；`RAN` 存在，结果账本含本轮 runner 写出的结果。verify 结束后的报告、账本与历史文件属于预期输出，单独断言其内容，不纳入检查前后的快照比对 |
| UT-S13-176 | 多模块合并：同名同命令合并、同名异命令分别执行 | §2.106.4 生效集合第 3 条、EX-13.12 | 夹具 VS-mod 变体：模块 `a`、`b` 使用同一命令组（`verify.modules` 中三个命令字段相同）；① 两模块都声明 `db-ready` 且命令相同（计数器记录执行次数）；② 两模块的 `db-ready` 命令不同，分别检查 `a`、`b` 的数据库，`a` 的数据库不可用 | 本次范围同时含 `a`、`b`，执行 `verify --format json` | ① `db-ready` 只执行一次，注入的 `OPENLOGOS_VERIFY_MODULES` 为 `a,b`，预检通过；② 两条 `db-ready` 各执行一次（注入的归属模块分别为 `a`、`b`），报 `verify_env_not_ready`，缺失项恰为 `{kind:"check", name:"db-ready", modules:["a"]}`；`RAN` 不存在 |
| UT-S13-177 | 预检失败的验收历史 `result_source: "none"` 与快照落点 | §2.104.3（修改）、§2.106.5、`spec/test-results.md`「结果来源」、EX-13.11 | ① 夹具 VS-req（无活跃提案），先成功跑一次 verify 留下 PASS 账本，再取消 `VS_TOKEN`；② 夹具 VS-prop（`raw_in_proposal` 缺省为 `true`），从未生成过结果文件，验收标准条目 `command:vs-fake-tool` 未写入配置；③ 同 ②，但 `verify.history.raw_in_proposal: false` | 各执行 `verify --format json`，再执行 `history show <run_id> --format json` 与 `history list --format json` | 三种情形的中央索引均为 `outcome:"completed"`、`result_source:"none"`、`gate.result:"FAIL"`、`gate.reason` 为对应原因，`counts` 各项为 null、三个 ID 数组为空；① `raw_location:"none"`，不写任何提案或本机记录，`history show` 注明本次没有完整记录；结果账本与 verify 前逐字节相同；② 提案完整记录只有 `record.json` 与 `report.md`（快照指出预检原因），没有 `results.jsonl`；③ 提案完整记录只有结构化 `record.json`，`report.md` 在本机原文目录，两处都没有 `results.jsonl` / `results-raw.jsonl`；`history list` 正常列出三条记录 |
| UT-S13-178 | 实际执行的命令组只用于选择模块级要求；无预跑命令时项目级要求仍预检 | §2.106.4 生效集合第 2、4 条、EX-13.15 | ① 夹具 VS-mod 变体：模块 `a`、`b` 都声明非空 `paths`；项目级未配置任何预跑命令；`verify.modules.a` 有命令组（记录型 runner 写 `RAN`）；`verify.modules.b` 只有 `requirements.commands: ["b-tool"]`，本机没有 `b-tool`。② 单模块夹具 VS：未配置任何预跑命令，结果账本是一份原本足以通过的 PASS 账本；项目级 `verify.requirements` 显式声明 `env: ["DB_URL"]`、`commands: ["vs-fake-tool"]`（可用）、`checks: [{name: "db-ready", command: "node -e 0"}]`（结构合法、恒成功、不依赖数据库），只缺 `DB_URL` | 各执行 `verify --all --format json` / `verify --format json` | ① 既有命令组选择只返回服务 `a` 的命令组；不检查 `b-tool`，不报 `verify_env_not_ready`；`RAN` 存在。② 预检照常执行，门禁 FAIL，`gate.reason="verify_env_not_ready"`，缺失项恰为 `{kind:"env", name:"DB_URL"}`；旧账本未被读取（历史 `result_source:"none"`，计数为 null），不产生 PASS |
| UT-S13-179 | 已合并提案的测试变更集无效时不得放行 | §2.106.6 第 3 条、§2.106.7 第 1A 条、EX-13.14 | 夹具 VS-prop 经正常 merge 建立变更集（前置断言读取有效、含 UT-S01-90）；随后三个变体：① 改坏 `SPEC_MERGED.test_change_set.sha256`；② 删除 `test_change_set` 字段；③ 不改（对照）。runner 对 UT-S01-90 写无原因 skip、其余 pass；另设对照 ④：从尚未 merge 的基线启动（活跃提案没有 `SPEC_MERGED`，测试规格中还没有 UT-S01-90），runner 只对已定义的存量 UT-S01-02 写无原因 skip，其余基线用例 pass，不产生 UT-S01-90 的结果行 | 各执行普通最终 `verify --format json` | ①② 门禁 FAIL，`gate.reason="test_change_set_invalid"`，`detail` 分别带读取器原因码（摘要不符、change set 缺失），不产生 `VERIFY_PASS`；③ `case_tier_mismatch`；④ 严格集合为空；门禁 PASS；`warnings` 含 `unclassified_skipped_cases` 且恰好点名 UT-S01-02；不出现 `unknown_test_result_id` |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-40 | 此前未声明要求的项目新增依赖后从正常入口生效 | Step 1～6、EX-13.1、EX-13.2 | 真实 CLI（构建后的 `dist/index.js`）；夹具 VS-prop，配置此前没有 `verify.requirements`；验收标准写 `` `command:vs-fake-tool` `` | ① 不改配置执行 `verify --format json`；② 按提案把 `commands: ["vs-fake-tool"]` 写入配置，`PATH` 不含该命令，再执行；③ 把临时 bin 目录加入 `PATH` 再执行 | ① `acceptance_requirement_undeclared`，`RAN` 不存在；② `verify_env_not_ready` 缺 `command vs-fake-tool`，`RAN` 不存在；③ `RAN` 存在，门禁 PASS；三次退出码与 `gate.result` 一致 |
| ST-S13-41 | 人工用例不被测试入口启动 | Step 6、EX-13.7 | 真实 CLI；夹具 VS 的测试规格新增 `ST-S01-02 [manual]`；项目 runner 由真实测试框架执行，ST-S01-02 的测试文件被启动时写哨兵文件；默认入口按 `spec/test-results.md` 在调度前排除该文件 | 执行普通最终 `verify --format json` | verify 完成，UT-S01-01 等自动用例有结果；哨兵文件不存在；结果账本不含 ST-S01-02；`manual_count=1` |
| ST-S13-42 | 本次改动用例的跳过分类端到端 | Step 7～11、EX-13.4、EX-13.5 | 真实 CLI；夹具 VS-prop（经正常 merge 建立真实变更集；启动 verify 前断言 `readTestChangeSet` 读到的集合包含 UT-S01-90、不含 UT-S01-02） | ① runner 对 UT-S01-90 写无原因 skip 执行 verify；② 改写为平台跳过（`requires win32`）再执行 | ① 退出码 1，`gate.reason="case_tier_mismatch"`，验收报告列出 UT-S01-90 与修复提示；② 退出码 0，门禁 PASS，验收报告「平台跳过」小节列出 UT-S01-90 与 `requires win32` |
| ST-S13-43 | 本仓 `check:linux-nondump-cc` 的完整路径 | Step 2～5、EX-13.6 | 本仓 `logos/logos.config.json`（本提案 `[code]` 写入后）；当前机器 | 读取本仓配置中的 `verify.requirements.checks`；执行其中 `linux-nondump-cc` 的检查命令；在一次性夹具中复制该 check 与本提案验收标准的同一条目，执行 `verify --format json` | 配置含名为 `linux-nondump-cc` 的 check；检查命令在当前机器的退出码 = （适用判定为真 ? `cc` 是否可用 : 0）；夹具中对账通过，预检结论与该退出码一致 |

### 覆盖度校验

- 结构校验与对账：UT-S13-157、UT-S13-158、UT-S13-159、ST-S13-40。
- 环境预检（变量、命令、检查、超时、只写变量名）：UT-S13-160、UT-S13-161、UT-S13-162、UT-S13-164、ST-S13-40。
- 按模块确定生效要求与多模块合并（模块级要求只对实际执行的命令组服务的模块；无预跑命令时项目级要求仍预检）：UT-S13-163、UT-S13-176、UT-S13-178。
- 检查命令的执行环境（沙箱执行器、隔离时不改写源工作区、无隔离时只读并标注）：UT-S13-175。
- 模块验收报告不残留旧 PASS：UT-S13-174。
- 预检失败的验收历史与快照落点：UT-S13-177。
- 已合并提案的测试变更集无效：UT-S13-179。
- 跳过分类（用例分层错误、平台跳过、存量警告；严格集合取自经正式读取器校验的变更集）：UT-S13-165、UT-S13-166、UT-S13-167、ST-S13-42。
- 门禁原因优先级：UT-S13-168。
- 零变化：UT-S13-169。
- 报告与 JSON：UT-S13-170。
- 适用平台缺前置工具与平台不适用的区分：UT-S13-171、ST-S13-43。
- 分类判据进入规范与 Skill：UT-S13-172。
- reporter 平台跳过与本仓既有平台用例：UT-S13-173。
- 人工用例不被测试入口启动：ST-S13-41。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S13"`，测试名含用例 ID；失败不得写 pass。
- 「预跑未执行」一律以项目外标记文件 `RAN` 是否存在判定，不以命令输出自述代替。
- 占位值 `VS-SECRET-9c1e` 对 stdout、stderr、验收报告、验收历史中央索引与提案运行目录逐文件全文搜索。
- 超时用例以可注入的检查时限缩短等待，不依赖真实 60 秒；结束时断言检查进程组已不存在。
- 所有临时目录在用例结束时删除；用例不读写本仓活跃提案与本机全局安装。
