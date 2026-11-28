# 变更提案：verify-flaky-rerun

> module: core | created: 2026-11-27

## 变更原因
来源：Team 需求池 openlogos #6（承接 RunLogos #17 的 openlogos 部分）。2026-11-27 用户确认开工，并把它排为分层验收（openlogos #5、RunLogos #42 / #43）的第一步。

**现象。** verify 把预跑命令跑出来的每一个失败用例都当成真失败。可在全量并发负载下，有一类失败和代码无关：真实子进程超时、界面端到端用例等待超时、文件事件丢失。这类失败单独再跑一次就通过。现在的处理只有两种，都不好：
- 判 FAIL：宿主（RunLogos driver）派一轮修复、再跑一遍全量。RunLogos 提案 team-module-env-smoke 的 4 次 verify 失败都与提案改动无关；2026-11-26～27 归档的提案里，一次全量 15～24 分钟，有的提案在全量上前后花了约 40 分钟。
- 把用例放进项目自己的剔除清单（RunLogos `test/helpers/verify-quarantine.mjs` 现有 5 条）：用例从此不执行，等于放弃这条验证。

**为什么现在做。** 分层验收定稿（runlogos 仓库 `logos/resources/reference/layered-verification-design.md` 第五节第 5 条）要求每晚在主干跑全量，失败自动生成「阻断发布」的缺陷。没有偶发识别，每晚全量会把负载抖动写成一条条假缺陷，发布门无法使用。

**边界。** 「复跑通过」不等于「没有问题」。RunLogos 的 UT-S47-13 曾被当成偶发，实际是登记表键漂移的产品缺陷：第一次运行会把所需目录建出来，第二次就通过。所以本提案不把偶发用例悄悄记成通过，而是单独成类、醒目列出、留下历史。

## 最小实现论证

> S35/S09：本段**不进 canonical 必填章节**——缺段、未填、占位残留三者均不触发任何检查。
> 它是自律提示，作用在设计发生**之前**；事后的规模信号由 change-lint 的观测 warning 承担。

- 先检索既有机制：
  - **按用例收窄执行**：verify 已能在预跑前注入 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`（切片验收与模块范围在用，`spec/test-results.md`「三个集合」；`cli/src/commands/verify.ts` 约 1739 行）。复跑直接复用这条通道，把取值换成失败用例集合，**不新增命令配置字段**；测试 ID 到测试文件的映射仍由各项目 runner 决定。
  - **同一 ID 取最新记录**：S13 EX-7.5 已规定同一用例多条记录按 timestamp 去重。复跑结果由 verify 自己持有首跑快照来合并（见变更概述第 3 条），不依赖 runner 是否追加写；「是不是复跑产生的新记录」按 verify 已有的逐段采集边界判定，不比较 timestamp，同一次采集内的多条记录才沿用这条去重规则。
  - **跳过分类**（§2.106，`platform_skipped_cases`）：是「用例没跑」的分类，表达不了「跑了两次、结论不同」，不能复用，但输出形态（独立数组 + 报告独立小节）照它来。
  - **验收历史**（§2.104，verification-history）：已按运行记录计数与用例 ID 数组。偶发清单并入同一份历史，不另建文件，回看「同一用例是否反复偶发」直接查历史。
  - **项目自带的剔除清单**（RunLogos quarantine）：是项目侧的 skip，用例不执行；它解决不了「还想验，只是偶尔挂」。本提案不改它，两者并存。
- 为什么不能更小：
  - 只在宿主（RunLogos driver）里做重试：driver 只能把整个 verify 重跑一遍（再花 15～24 分钟），而且每个宿主各写一份；沙箱、命令和结果账本都在 verify 手里，只有 verify 能只复跑失败的那几条。
  - 只复跑、不单独列出：复跑通过的用例直接记成通过，UT-S47-13 那样的真缺陷会被永久掩盖。单独成类和留历史是这件事安全的前提，不能省。
  - 不设上限：一次大面积失败（改坏了公共代码）会被整批复跑一遍，白花一轮时间，且大面积失败本来就不是偶发。
- 本提案主动砍掉的：
  - **多次复跑 / 按通过率判定**：只复跑一次。跑三次取两次的做法更稳，但时间翻倍，且「偶尔才过」的用例不该被放行。
  - **自动进剔除清单**：反复偶发的用例是否剔除，仍由人决定（RunLogos 侧 2026-11-25 用户裁定：扩充清单先问用户）。verify 只负责把历史留全。
  - **自动判断是否「真偶发」**（比如对比基线提交）：属于既有回归归因，是分层验收后续需求（RunLogos #42）的事。
  - **SMOKE 复跑**：冒烟用例跑在部署后的环境里，重跑语义不同（可能有副作用），本提案只管 UT/ST。
  - **宿主侧展示**：RunLogos driver 与界面如何展示偶发清单属于 RunLogos #17，另立提案；本提案只保证 JSON 输出与报告里有它。
  - **让 runner 回滚账本的项目也能复跑**：见变更概述「已知限制」。

## 变更类型
需求级（新增用户可见规则「失败用例原地复跑一次，复跑通过的单独记为偶发」：新增验收条件，并贯穿功能规格、S13 场景、测试结果规范、CLI JSON 契约、配置 schema、测试用例、部署方案与 smoke；不涉及 API / DB）

## 变更范围
> 与 `tasks.md` 的 `[delta]` 目标一一对应。

- 影响的需求文档：`core-01-requirements.md` 新增「verify 失败用例复跑与偶发判定需求（verify-flaky-rerun）」，验收条件 AC-VERIFY-RERUN-01 起。
- 影响的功能规格：`core-01-feature-specs.md` 修改 §2.104.3（中央索引新增可选字段 `flaky_ids`），并新增 §2.108「verify 失败用例复跑与偶发判定」：触发条件与不触发的情形、复跑范围与执行方式、结果合并（首跑快照）、偶发判定、门禁与原因优先级的衔接、命令组状态改判、JSON 字段与验收报告小节、验收历史、配置项、兼容性。§2.75.1 与 §2.106.7 的优先级原文不改，由 §2.108 说明复跑发生在优先级计算之前、改变的是其输入。
- 影响的业务场景：`core-S13-verify-results.md` 新增「S13 失败用例复跑与偶发判定」：参与者、前置条件、时序（预跑 → 读取结果 → 判定是否复跑 → 快照 → 同沙箱复跑 → 合并 → 偶发判定 → 门禁）、步骤说明、异常与边界（超过上限、复跑后无新记录、runner 回滚账本、复跑命令自身失败、沙箱不可复用、切片与模块范围下的集合求交、两阶段命令）、追溯。
- 影响的 API：无（`core` 模块 `skip_phases` 含 `api`）
- 影响的 DB 表：无（`skip_phases` 含 `database`）
- 影响的编排测试：无（同上，无 API）
- 影响的方法论规范：
  - `spec/test-results.md`：新增「失败用例复跑与偶发」一节——复跑时 verify 注入的变量与取值、runner 的义务（只执行并只输出集合内用例；失败时不得回滚或清空账本，否则该次失败无法复跑）、偶发的定义、报告与历史中的形态。
  - `spec/cli-json-output.md`：verify 的 `data` 新增 `flaky_cases[]` 与 `rerun` 对象（含各命令组的首跑与复跑退出码）；新增警告码 `flaky_cases_present`；「共用对象：run」新增 `flaky_ids`。全部为加法字段。
  - `spec/logos.config.schema.json`（属 `[code]`，随规格列出）：新增 `verify.rerun_failed`。
- 影响的测试规格：
  - `core-S13-test-cases.md`：UT-S13-180 起、ST-S13-44 起。
- 影响的部署方案与 smoke：
  - `core-01-deployment-plan.md` 新增「OpenLogos 0.16.26 本机测试环境发布（verify-flaky-rerun）」；
  - `core-smoke-test-cases.md` 新增安装态 smoke，SMOKE-core-347 起。
- 影响的代码：
  - `cli/src/commands/verify.ts`：预跑与结果读取之后、门禁计算之前插入复跑环节；JSON 输出、验收报告与历史写入。
  - 沙箱执行（`cli/src/lib/sandbox.ts` 及预跑封装）：同一沙箱内二次执行命令组。
  - `cli/src/lib/verify-config.ts` 与 `spec/logos.config.schema.json`：`verify.rerun_failed`。
  - 验收历史写入（verification-history 相关模块）：偶发计数与 ID。
  - `cli/src/i18n.ts`：中英文案。
  - 本仓 runner（`cli/test` 的 OpenLogos reporter 与测试入口）：确认支持按 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 收窄，作为复跑的参考实现。
  - 升版 0.16.26、CHANGELOG、安装态 smoke runner。

## 部署影响
- 是否需要部署：是
- 部署原因：verify 是 CLI 产品代码，只有装进本机全局 CLI，RunLogos、markdown6 等用全局 CLI 推进的项目才能用上；登记表配置了 `proposal_default_env: test`。升版到 0.16.26 以区分新旧安装态
- 影响环境：`test`（登记表 `proposal_default_env`，本机 npm 全局安装态）；不 npm publish、不打 tag、不 push
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」：脚本失败时自动回装回滚制品；成功落账后 `openlogos deploy --env test --rollback` 回到 test 当前版本，即提交 `76773c2` 的安装态 0.16.25）
- 是否需要 smoke：是（安装态 smoke 在一次性项目中证明：
  - 首跑失败、复跑通过的用例进入 `flaky_cases`，Gate 不因它 FAIL，报告有「偶发用例」小节；
  - 两次都失败的用例照常 `failed_cases`；
  - 失败数超过上限时不复跑；
  - 关闭配置后行为与 0.16.25 一致。）

## UI/UX 变更声明

```yaml
ui_impact: false            # 本次是否触及界面（GUI 项目才有意义）
design_system_mode: generated   # generated | fallback（fallback 时须填 design_system_fallback_reason）
design_system_fallback_reason: ""
pages: []                   # 每项 {id, prototype: core-NN-<slug>.html, description}
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: 结果账本格式不变；验收历史与 JSON 输出只新增字段，旧记录原样有效，不迁移、不改写
  compatibility:
    status: required
    reason: 复跑开启后，「首跑失败、复跑通过」的用例不再让 Gate FAIL，这是门禁结论的变化；用户已决定默认开启（C03）
  security_privacy:
    status: none
    reason: 复跑在同一沙箱内执行同一条已配置的命令，不扩大写入范围、不改权限与 guard；报告只写用例 ID 与既有的错误摘要字段
  public_release:
    status: none
    reason: 只部署到本机 test 环境，不 npm publish、不打 tag、不 push
  external_commitment:
    status: none
    reason: CLI 只新增 JSON 字段、警告码与配置字段，不删除、不改名任何既有契约
decisions:
  - id: C01
    category: product
    source: user
    question: 是否实施失败用例复跑与偶发判定，做在哪里
    choice: 实施；复跑与偶发判定做在 openlogos verify 内（同一沙箱、只复跑失败用例），RunLogos 只负责展示；只复跑一次；复跑通过的单独记为偶发并醒目列出
    reason: 用户 2026-11-27 在分层验收实现顺序中把它排为第 1 步（「独立的小改动，现在就有收益；后面每晚全量靠它防止偶发失败刷出一堆假缺陷」），并在「做在 openlogos（A）还是只做在 RunLogos 自己的测试脚本里（B）」中选 A；RunLogos #17 原文要求「偶发清单要在界面上醒目展示，并定期回看」
    scope: 本提案全部范围；RunLogos driver 与界面展示属 RunLogos #17
    rejected: 只做在 RunLogos 的 scripts/run-vitest.js 里——只对一个项目生效，分层验收的每晚全量还得在 openlogos 重做
  - id: C02
    category: deployment
    source: policy
    question: 本提案是否部署、部署到哪个环境、怎么部署、怎么回滚、以什么为 smoke 证据
    choice: 部署到 test（登记表 proposal_default_env）；部署方式为登记表 test.deploy（mode script，scripts/deploy-local.mjs），提案通道执行 openlogos deploy --env test；回滚按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」，test 的 current_ref 为 76773c2（0.16.25）；smoke 证据为 scripts/run-smoke.js 经 openlogos smoke --env test 的实际运行结果
    reason: env show test 显示当前版本 76773c2830f8、上一版本 aa1d9fdd8eb4，部署方式为受保护脚本；已合并部署方案有通用章节；CLI 产品代码有改动，需要装进全局才能被下游使用
    scope: "[deploy] 段、部署方案与 smoke 用例 delta、升版 0.16.26；不含 npm publish / tag / push"
    rejected: 不部署——下游 RunLogos 与 markdown6 用的都是全局 CLI，拿不到复跑能力
  - id: C03
    category: compatibility
    source: user
    question: 复跑默认开启还是默认关闭
    choice: 默认开启；verify.rerun_failed.enabled=false 可关闭
    reason: 用户 2026-11-27 答复「默认开启，开始写 delta 吧」
    scope: 升级到 0.16.26 的全部项目；「首跑失败、复跑通过」由判 FAIL 改为带 flaky_cases_present 警告的通过
    rejected: 默认关闭——最需要它的每晚全量容易漏配
unresolved: []
defaults:
  - "复跑上限 max_cases 缺省 10：首跑失败用例数超过上限时不复跑、直接按首跑判定，并在 rerun.skipped_reason 写明 too_many_failures。上限可配置；取 10 的依据是 RunLogos 近期偶发失败每次 1～3 条，而改坏公共代码时通常是几十条以上。"
  - "配置形态：verify.rerun_failed = { enabled: boolean, max_cases: 正整数 }，项目级；不提供模块级覆盖（需要时再加）。"
  - "复跑范围 = 首跑失败用例 ∩ 本轮 eligible（切片验收、模块范围下先求交）；只含规格中定义的 UT/ST，SMOKE 与未知 ID 不复跑。"
  - "执行方式：在首跑所用的同一沙箱内，再执行一次产生这些失败用例的命令组，注入 OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS=复跑集合 与 OPENLOGOS_VERIFY_RERUN=1（让 runner 能区分首跑与复跑）。每个失败用例只交给首跑中产生其生效记录的那一个命令组与阶段复跑一次（首跑逐段采集已知来源）。首跑的沙箱副本（含一次性副本）保留到复跑决策结束；副本确实无法继续使用时不复跑、不新建副本、不退回工作区，相关用例维持失败，rerun.skipped_reason 为 sandbox_unavailable。沙箱模式为 off 时在工作区原地复跑。"
  - "结果合并由 verify 持有：复跑前快照首跑的归一化结果（含每条生效记录的来源与首跑的一致性诊断，如非法行）；复跑后只采信复跑集合内用例在其来源本次复跑采集中的记录，集合外的用例一律以首跑为准，不受 runner 在复跑中截断、覆盖结果文件的影响；首跑账本的非法行保留到最终门禁，偶发判定不抵消 result_ledger_inconsistent。"
  - "偶发判定：复跑集合内的用例，复跑记录为 pass → 偶发；复跑记录为 fail、skip 或没有新记录 → 维持失败。只要还有一条维持失败，Gate 照旧 failed_cases。"
  - "命令组状态改判：首跑命令非零退出、失败用例非空，且复跑命令零退出、复跑集合全部通过时，该命令组按通过计入门禁；首跑退出码保留在 pre_run.commands[] 的新增字段里。其余情况命令组状态不变。残余风险：首跑的非零退出若还有用例失败之外的原因，会被这条改判放过——由既有的未覆盖检查与账本一致性检查兜底（崩溃的测试文件会留下未覆盖用例）。"
  - "不触发复跑的情形：环境预检类原因（§2.106.5）、test_change_set_invalid、首跑没有任何失败用例记录（含 runner 失败后回滚账本的 EX-9.1 形态）、失败数超过上限、配置关闭。各自在 rerun.skipped_reason 给出取值。"
  - "有偶发用例且门禁通过时：Gate 仍为 PASS，warnings 增加 flaky_cases_present，验收报告增加「偶发用例」小节（用例 ID、所属模块、首跑错误摘要），VERIFY_PASS 照常写入。"
  - "验收历史：每次运行记录偶发用例计数与 ID 数组，与失败、跳过并列；不新增历史文件。"
  - "新增编号：需求 AC-VERIFY-RERUN-01 起；功能规格 §2.108；UT-S13-180、ST-S13-44、SMOKE-core-347 起。具体条数在 delta 中定稿。"
  - "本次是新能力，不新增长期 DXX 决策记录：规则直接写入功能规格与测试结果规范。"
```

## 验收标准
- 自动验收环境要求：无
- 平台限定用例：无（复跑用例以夹具项目和可控的「首次失败、再次通过」测试替身验证，不依赖特定平台；如 delta 阶段发现沙箱内二次执行需要平台限定，在测试 delta 中逐条注明）
- 需要人参与的验收：无

## 变更概述
**做什么。** verify 在预跑命令跑完、读到结果之后，如果结果里有失败的 UT/ST，就在同一个沙箱里把这些失败用例再跑一次，然后再算门禁：

1. **什么时候复跑**：首跑结果里有失败用例，数量不超过上限（缺省 10），配置没有关闭，且不是环境预检失败这类「根本没跑起来」的情况。
2. **怎么复跑**：再执行一次原来的预跑命令，通过既有的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 告诉 runner 只跑这几条，另注入 `OPENLOGOS_VERIFY_RERUN=1`。不新增命令配置。
3. **怎么合并**：verify 在复跑前保存首跑结果的快照。复跑后只采信「复跑集合内」用例的新结果，其余用例仍以首跑为准。这样即使 runner 在复跑时清空或覆盖了结果文件，也不会丢掉首跑中通过的那几千条。
4. **怎么判**：复跑通过的记为**偶发**，从失败里移出；复跑仍失败、被跳过或没有产生新结果的，照旧是失败。只要还剩一条失败，Gate 仍是 FAIL。全部变成偶发时，Gate 可以通过，但带警告 `flaky_cases_present`。
5. **怎么展示**：JSON 输出新增 `flaky_cases[]`（用例 ID、模块、首跑错误摘要）和 `rerun`（是否复跑、没复跑的原因、复跑命令的结果）；验收报告新增「偶发用例」小节；验收历史记下每次运行的偶发用例，方便回看同一条用例是不是反复偶发。

**已知限制。** 复跑的前提是「verify 能从结果账本里看到失败的是哪几条」。如果项目的 runner 在命令失败后把账本回滚成上一份完好结果（S13 EX-9.1 记录的形态，RunLogos 的 `scripts/run-vitest.js` 目前就是这样），verify 只能看到 `pre_run_failed`，不知道该复跑谁，本提案对这种情况**不触发复跑**，只在 `rerun.skipped_reason` 里说明。要用上复跑，runner 得在失败时保留失败记录——这是 RunLogos #17 在 RunLogos 侧要配套做的事，`spec/test-results.md` 会把它写成 runner 的义务。

**不做什么。** 不多次复跑、不自动把用例放进剔除清单、不判断失败是不是这次改动引起的、不复跑 SMOKE、不改宿主界面。之后升版 0.16.26，部署到本机 test 环境，用安装态 smoke 证明复跑在全局 CLI 中生效。
