## ADDED — verify 失败用例复跑与偶发判定需求（verify-flaky-rerun）

> 来源变更：verify-flaky-rerun（Team 需求池 openlogos #6，承接 RunLogos #17 的 openlogos 部分；决策 C01、C02、C03）。规则权威见功能规格 §2.108、`spec/test-results.md`「失败用例复跑与偶发（verify-flaky-rerun）」、`spec/cli-json-output.md`「verify 失败用例复跑与偶发（verify-flaky-rerun）」。配套需求：RunLogos #17（driver 与界面展示偶发清单；RunLogos 的测试入口在失败时保留失败记录）。后续需求：openlogos #5、RunLogos #42 / #43（分层验收，每晚全量依赖本需求避免把偶发失败记成缺陷）。

### 场景定义

- **触发条件**：全量并发负载下，有一类用例失败与代码无关——真实子进程超时、界面端到端用例等待超时、文件事件丢失——单独再跑一次就通过。verify 把它们当成真失败：宿主派一轮修复、再跑一遍全量（RunLogos 一次全量 15～24 分钟）；或者项目把用例放进自己的剔除清单，从此不再验证。
- **用户价值**：偶发失败不再触发一轮修复与重新验收；同时偶发用例不被悄悄记成通过，而是单独列出并留下历史，方便回看同一条用例是否反复偶发、是否其实是真缺陷。
- **优先级**：P1
- **主路径**：
  1. `openlogos verify` 执行预跑命令并读取结果。
  2. 结果中有失败的 UT/ST、数量不超过上限、复跑未关闭时，verify 在同一沙箱内只把这些失败用例再跑一次。
  3. 复跑通过的用例记为「偶发」，从失败中移出；复跑仍失败、被跳过或没有产生新结果的，维持失败。
  4. 仍有失败时门禁 FAIL；全部变为偶发时门禁按其余判据继续，通过时带警告 `flaky_cases_present`。
  5. 偶发用例在 JSON 输出、验收报告与验收历史中单独列出。

### 定义

- **偶发用例**：同一次 verify 调用内，首跑结果为 fail、在同一沙箱内复跑一次结果为 pass 的 UT/ST。
- 偶发不等于没有问题。第一次运行改变了环境、使第二次恰好通过的真缺陷（例如第一次运行创建了所需目录）也会被判为偶发。因此偶发用例必须单独列出并留下历史，不得并入普通通过。
- 只对 UT/ST；SMOKE 不复跑。

### 验收条件

#### AC-VERIFY-RERUN-01：首跑失败、复跑通过记为偶发
- **GIVEN** 预跑命令首跑时 UT-S01-01 失败、其余通过，复跑时 UT-S01-01 通过
- **WHEN** 执行 `openlogos verify`
- **THEN** UT-S01-01 进入 `flaky_cases`，不在 `failed_cases` 中；门禁不因它 FAIL；通过时 `warnings` 含 `flaky_cases_present`；验收报告有「偶发用例」小节
- 测试入口不写 timestamp、timestamp 只精确到秒或两次记录同刻时，结论相同

#### AC-VERIFY-RERUN-02：复跑仍失败照常 FAIL
- **GIVEN** UT-S01-01 首跑与复跑都失败
- **WHEN** 执行 `openlogos verify`
- **THEN** 门禁 FAIL，`gate.reason` 为 `failed_cases`，UT-S01-01 在 `failed_cases` 中

#### AC-VERIFY-RERUN-03：部分偶发、部分失败
- **GIVEN** UT-S01-01、UT-S01-02 首跑都失败，复跑时前者通过、后者失败
- **WHEN** 执行 `openlogos verify`
- **THEN** 门禁 FAIL；`flaky_cases` 只含 UT-S01-01，`failed_cases` 只含 UT-S01-02

#### AC-VERIFY-RERUN-04：复跑没有产生新结果时维持失败
- **GIVEN** 测试入口不支持按用例收窄，复跑后 UT-S01-01 没有新的结果记录，或新记录为 skip
- **WHEN** 执行 `openlogos verify`
- **THEN** UT-S01-01 维持失败，门禁 FAIL；诊断说明复跑未产生该用例的通过结果

#### AC-VERIFY-RERUN-05：首跑通过的用例不因复跑丢失
- **GIVEN** 测试入口在每次启动时清空结果文件；首跑 3 条用例中 1 条失败、2 条通过，复跑只执行失败的那一条并通过
- **WHEN** 执行 `openlogos verify`
- **THEN** 3 条用例都有结果，首跑通过的 2 条仍计为通过，不出现未覆盖

#### AC-VERIFY-RERUN-06：超过上限不复跑
- **GIVEN** 首跑失败用例数超过 `verify.rerun_failed.max_cases`（缺省 10）
- **WHEN** 执行 `openlogos verify`
- **THEN** 不执行复跑，按首跑判定；`rerun.skipped_reason` 为 `too_many_failures`

#### AC-VERIFY-RERUN-07：可关闭
- **GIVEN** `verify.rerun_failed.enabled` 为 `false`
- **WHEN** 首跑有失败用例时执行 `openlogos verify`
- **THEN** 不执行复跑；门禁结论、`failed_cases` 与退出码和 0.16.25 一致

#### AC-VERIFY-RERUN-08：不该复跑的情形不复跑
- **GIVEN** 分别为：环境预检类原因命中；预跑命令失败但结果中没有任何失败用例记录（测试入口回滚了账本）；未配置任何预跑命令；首跑所用的沙箱副本在复跑前已无法继续使用
- **WHEN** 执行 `openlogos verify`
- **THEN** 都不执行复跑（副本不可用时也不新建副本、不退回工作区执行），门禁结论与引入前一致；`rerun.skipped_reason` 给出对应取值

#### AC-VERIFY-RERUN-09：偶发留下历史
- **GIVEN** 一次 verify 判出偶发用例
- **WHEN** 执行 `openlogos history show <run_id> --format json`
- **THEN** 该次记录的 `flaky_ids` 含这些用例 ID；没有偶发的运行该数组为空

#### AC-VERIFY-RERUN-10：切片验收与模块范围下同样生效
- **GIVEN** 切片 checkpoint 或按模块限定范围的 verify，首跑有失败用例
- **WHEN** 执行 `openlogos verify`
- **THEN** 复跑集合为失败用例与本轮应执行集合的交集；只再执行产生这些失败的命令组；同一用例在多个阶段出现时，只在产生其生效失败记录的那一个命令组与阶段复跑一次

#### AC-VERIFY-RERUN-11：零回归
- **GIVEN** 首跑没有失败用例
- **WHEN** 执行 `openlogos verify`
- **THEN** 不执行复跑；门禁结论、诊断与退出码与引入前一致（新增的 `rerun` 字段除外）

#### AC-VERIFY-RERUN-12：进入本机全局安装态
- **THEN** 以上行为进入本机全局安装态 0.16.26，并由安装态 smoke 证明（仓内源码修好但安装态未更新不算达成）

#### AC-VERIFY-RERUN-13：首跑账本问题不因复跑消失
- **GIVEN** 首跑结果文件含一行非法记录，UT-S01-01 首跑失败；复跑时测试入口清空结果文件，只写 UT-S01-01 的通过记录并以 0 退出
- **WHEN** 执行 `openlogos verify`
- **THEN** UT-S01-01 可列入 `flaky_cases`，但门禁 FAIL、`gate.reason` 为 `result_ledger_inconsistent`；验收报告保留非法行原因；不写 `VERIFY_PASS`

### 非目标

- 多次复跑或按通过率判定：只复跑一次。
- 自动把反复偶发的用例放进剔除清单：是否剔除仍由人决定，verify 只留历史。
- 判断失败是否由本次改动引起（与基线对比）：属分层验收后续需求。
- SMOKE 复跑。
- 宿主（RunLogos）界面与 driver 的展示：RunLogos #17。
- 让「失败后回滚结果账本」的测试入口也能复跑：verify 看不到失败用例时无从复跑，由项目测试入口保留失败记录来解决。

### 追溯

- 功能规格：§2.108；§2.104.3（修改）。
- 场景：`core-S13-verify-results.md`「S13 失败用例复跑与偶发判定」。
- 规范：`spec/test-results.md`、`spec/cli-json-output.md`、`spec/logos.config.schema.json`（`verify.rerun_failed`）。
- 测试：`core-S13-test-cases.md`（UT-S13-180 起、ST-S13-44 起）；安装态 smoke：`core-smoke-test-cases.md`（SMOKE-core-347 起）。
