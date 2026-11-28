## ADDED — verify 分层验收需求（layered-verification）

> 来源变更：layered-verification（Team 需求池 openlogos #5；决策 C01～C06）。设计依据：`runlogos` 仓库 `logos/resources/reference/layered-verification-design.md`（2026-11-27 与用户定稿，下称「定稿」），本需求是其中 openlogos 负责的部分。规则权威见功能规格 §2.109、`spec/test-results.md`「分层验收（layered-verification）」、`spec/cli-json-output.md`「verify 分层验收与发布级验收（layered-verification）」。配套需求：RunLogos 的测试入口按清单选文件、driver 按三层跑提案验收；Team 的执行机调度、每晚触发、发布门。

### 场景定义

- **触发条件**：大型应用上每个提案的验收都跑全量，成本高（RunLogos 一次全量 15～24 分钟）。现有按模块收窄对单模块项目无效。只为省时间而缩小提案验收，又会让回归逃到发布。
- **用户价值**：提案验收只跑「该跑的那部分」，更快给出结论；全量验收集中到发布前，在确定的提交上给出与提交号绑定的证据。两种结论分开展示，不会把「提案通过」误读成「可以发布」。
- **优先级**：P1
- **红线**（由「绝不放行未通过测试的代码」分成两层，没有放松）：
  - 不合并未通过提案级验收的代码；
  - 不发布未通过发布级全量验收的代码。
- **主路径**：
  1. 研发与产品负责人在测试用例文档中标出主链路用例。
  2. 写提案时评估并声明本次改动的受影响场景，随方案一起批准。
  3. 分层开启的项目上，`openlogos verify` 以「本提案用例 + 受影响用例 + 主链路用例」为验收集合，给出提案级结论。
  4. 发布前（或每晚），在干净的指定提交上执行 `openlogos verify --release`，给出发布级结论。
  5. 调用方用 `openlogos verify --release --check` 查询某个提交是否有有效的发布级结论。

### 定义

| 概念 | 定义 |
|---|---|
| 本提案用例 | 本提案新增或修改的 UT/ST（已合并提案的测试变更集） |
| 受影响场景 | 本次改动波及的已有场景：提案中声明的场景，加上提案 delta 实际触及的场景 |
| 受影响用例 | 受影响场景的测试用例文档中全部不需要人参与的 UT/ST |
| 主链路用例 | 「坏了就等于产品不可用」的核心用户路径上的用例；少、快、绝对稳定；是规格的一部分 |
| 全量用例 | 全部不需要人参与的 UT/ST |
| 提案级验收 | 回答「改动做对了，而且没有破坏核心吗」；分层开启时跑三层合集 |
| 发布级验收 | 回答「产品整体可以交付吗」；在指定提交上实际执行全量，结论与提交号绑定 |

- 只对 UT/ST 分层；SMOKE 不在本需求范围内。
- 人工用例（`[manual]`）不属于任何一层，仍在冒烟阶段做人工验收。

### 验收条件

#### AC-VERIFY-TIER-01：主链路用例在用例文档中标出
- **GIVEN** 测试用例文档中有固定标题的小节「主链路用例」，列出本文档中定义的若干 UT/ST
- **WHEN** 读取规格
- **THEN** 这些用例构成主链路集合；用例表首格不需要任何标记，没有该小节的文档没有主链路用例

#### AC-VERIFY-TIER-02：主链路有规模上限
- **GIVEN** 分层已开启，主链路用例总数超过 `verify.layered.main_path_max`（缺省 50）
- **WHEN** 执行 `openlogos verify`
- **THEN** 门禁 FAIL，原因 `main_path_over_limit`，点名上限与实际数量；不执行预跑命令

#### AC-VERIFY-TIER-03：主链路小节写错即拒绝
- **GIVEN** 分层已开启，主链路小节列了本文档未定义的 ID、人工用例或 SMOKE
- **WHEN** 执行 `openlogos verify`
- **THEN** 门禁 FAIL，原因 `main_path_invalid`，逐条点名；不执行预跑命令

#### AC-VERIFY-TIER-04：主链路用例不得靠复跑通过
- **GIVEN** 分层已开启，某条主链路用例首跑失败、复跑通过
- **WHEN** 执行 `openlogos verify`
- **THEN** 不按偶发放行：门禁 FAIL，原因 `main_path_flaky`，提示修复该用例或把它移出主链路；非主链路用例的偶发判定不变

#### AC-VERIFY-TIER-05：提案声明受影响场景
- **GIVEN** 新建提案
- **WHEN** 执行 `openlogos change <slug>`
- **THEN** 提案脚手架含「受影响场景」段，可写明评估结论、是否涉及共享改动，以及逐个场景的编号与理由；该段随方案在「批准方案」时由人审视

#### AC-VERIFY-TIER-06：提案级验收跑三层合集
- **GIVEN** 分层已开启；活跃提案已合并规格，声明了受影响场景 S20；主链路含若干用例
- **WHEN** 执行 `openlogos verify`
- **THEN** 验收集合 = 本提案用例 ∪ S20 的全部自动化用例 ∪ 主链路用例；该集合经 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 交给测试入口；门禁只采信集合内的结果；集合之外的已定义用例不计未覆盖；测试命令的退出状态照常计入门禁

#### AC-VERIFY-TIER-07：delta 触及的场景自动并入
- **GIVEN** 提案的 delta 修改了场景 S21 的场景文档或测试用例文档，但声明中没有 S21
- **WHEN** 执行 `openlogos verify`
- **THEN** S21 仍计入受影响场景，来源标为 delta

#### AC-VERIFY-TIER-08：共享改动扩大到全量
- **GIVEN** 分别为：改动文件命中共享配置或依赖清单；或声明写明涉及共享改动（只要这一项可读出即采信，即使声明的其余部分写了无法评估或有错）
- **WHEN** 执行 `openlogos verify`
- **THEN** 验收集合扩大到全量，JSON 与报告写明扩大原因

#### AC-VERIFY-TIER-09：评估不可用时退回按模块
- **GIVEN** 分别为：提案没有「受影响场景」段；该段结构非法；写了「无法评估」；声明了不存在的场景编号
- **WHEN** 执行 `openlogos verify`
- **THEN** 受影响用例按模块计算（现有按模块限定范围的结果；未启用或其自身回落时为全量），并保留声明中已能识别的场景与 delta 触及的场景，再并上本提案用例与主链路用例；写明原因

#### AC-VERIFY-TIER-10：只扩大不缩小，扩大不是失败
- **GIVEN** 任一扩大情形
- **WHEN** 执行 `openlogos verify`
- **THEN** 验收集合是未扩大时集合的超集；扩大本身不改变门禁结论

#### AC-VERIFY-TIER-11：未开启时零变化
- **GIVEN** `verify.layered.enabled` 未配置或为 `false`
- **WHEN** 执行 `openlogos verify`
- **THEN** 验收范围、门禁结论、验收报告与退出码和引入前一致（新增的 `level` 字段除外）；主链路小节与受影响场景声明不影响验收

#### AC-VERIFY-TIER-12：没有活跃提案时按全量
- **GIVEN** 分层已开启，没有活跃提案
- **WHEN** 执行 `openlogos verify`
- **THEN** 按全量执行提案级验收，写明原因

#### AC-VERIFY-TIER-13：切片验收不超出提案验收
- **GIVEN** 分层已开启，切片 checkpoint 的验收范围为 baseline
- **WHEN** 执行切片 checkpoint
- **THEN** 其基线部分为「受影响用例 ∪ 主链路用例」而不是全量；owned 范围不变；交给测试入口的清单与统计都只含本次 checkpoint 的用例，尚未轮到的本提案用例不提前执行，被提前上报时照旧判越界

#### AC-VERIFY-TIER-14：发布级验收实际执行全量
- **GIVEN** 干净的工作区，配置了测试命令
- **WHEN** 执行 `openlogos verify --release`
- **THEN** 不看分层开关、模块范围、切片与活跃提案，执行全部自动化 UT/ST；没有平台原因的跳过不能构成通过（判 `case_tier_mismatch`），带平台原因的跳过照既有规则接受；不写、不删任何提案标记，不改写提案级验收报告；写独立的发布级报告

#### AC-VERIFY-TIER-15：发布级验收的前置拒绝
- **GIVEN** 分别为：不是 git 仓库；工作区有未提交改动；没有配置可执行的测试命令（即使磁盘上有全绿的旧结果）
- **WHEN** 执行 `openlogos verify --release`
- **THEN** 以错误码拒绝，不执行任何命令，不产生发布级结论

#### AC-VERIFY-TIER-16：结论归属被测试的提交
- **GIVEN** 在提交 A 上启动发布级验收，结束前工作区切到了提交 B
- **WHEN** 验收收尾
- **THEN** 记录的提交号是 A；本次不产生有效通过（原因 `release_commit_changed`）；查询 B 不命中这次结果

#### AC-VERIFY-TIER-17：查询以最近一次结论为准
- **GIVEN** 同一提交、同一平台上先后有两次有结论的发布级运行
- **WHEN** 执行 `openlogos verify --release --check`
- **THEN** 先 PASS 后 FAIL 时退出码 1；先 FAIL 后 PASS 时退出码 0；环境预检未通过的运行不算结论，不推翻此前的结论也不算通过

#### AC-VERIFY-TIER-18：提交变了即作废
- **GIVEN** 提交 A 有通过的发布级结论，当前 HEAD 为提交 B
- **WHEN** 执行 `openlogos verify --release --check`
- **THEN** 退出码 1，说明只有其他提交的结论

#### AC-VERIFY-TIER-19：两级报告分开并标明级别
- **GIVEN** 同一提交上先后完成提案级验收（分层开启）与发布级验收
- **WHEN** 查看报告
- **THEN** 提案级报告标明「提案级」、三层各自的用例数与扩大原因，并注明不等于可以发布；发布级报告在独立路径，标明「发布级」、提交号与平台；两份报告互不覆盖

#### AC-VERIFY-TIER-20：测试入口没有收窄时尽可能可见
- **GIVEN** 分层收窄生效，测试入口执行并上报了集合之外的用例
- **WHEN** 执行 `openlogos verify`
- **THEN** 集合外的结果不采信、不判账本不自洽；JSON 给出集合外结果行数与警告 `layered_runner_not_narrowed`。测试入口执行了集合外的文件但没有上报其结果时，verify 无从得知，不告警

#### AC-VERIFY-TIER-21：写规格时提前发现问题
- **GIVEN** 提案的「受影响场景」段结构非法、仍是占位内容，或引用了不存在的场景；或主链路小节写错、超过上限
- **WHEN** 执行 `openlogos change-lint`
- **THEN** 前者报违规并带修复提示（缺段只警告）；后者给出警告

#### AC-VERIFY-TIER-22：进入本机全局安装态
- **THEN** 以上行为进入本机全局安装态 0.16.27，并由安装态 smoke 证明（仓内源码修好但安装态未更新不算达成）

### 非目标

- 全量的调度与执行机、每晚触发、错过补跑、自动生成缺陷与「阻断发布」标识、发布门、多平台聚合：Team 与 RunLogos。
- 既有回归在当前提案内修复的规则、越界记录：RunLogos。
- 代码文件到场景的机器映射：影响评估在写提案时做（C01）。实现过程中改到声明之外的场景，verify 无法从代码差异发现；由 delta 触及场景自动并入、共享改动扩大到全量、发布级全量兜底三处缓解。
- 测试入口的改造：verify 只传递清单并只采信清单内的结果；项目的测试入口按清单选择要执行的文件，是该项目开启分层的前置条件。
- 自动维护主链路清单：由人和研发共同定义。
- SMOKE 分层；`openlogos impact` 的任何变化；openlogos #4（无关配置变化不回落全量）。

### 追溯

- 功能规格：§2.109；§2.104.3（修改）。
- 架构：「六十、分层验收：验收集合的三层构成与两级证据」。
- 场景：`core-S13-verify-results.md`「S13 分层验收：提案级三层集合」「S13 发布级全量验收」；`core-S09-change-management.md`「S09 提案脚手架的『受影响场景』段」；`core-S35-change-lint.md`「S35 受影响场景声明与主链路小节的结构检查」；`core-S32-slice-planning.md`「S32 分层开启时切片 checkpoint 的基线部分」。
- 规范：`spec/test-results.md`、`spec/cli-json-output.md`、`spec/change-management.md`、`spec/logos.config.schema.json`（`verify.layered`）。
- 测试：`core-S13-test-cases.md`（UT-S13-217 起、ST-S13-48 起）、`core-S09-test-cases.md`（UT-S09-504 起）、`core-S35-test-cases.md`（UT-S35-231 起）、`core-S32-test-cases.md`（UT-S32-118 起）；安装态 smoke：`core-smoke-test-cases.md`（SMOKE-core-352 起）。
