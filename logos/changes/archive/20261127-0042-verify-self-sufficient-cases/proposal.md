# 变更提案：verify-self-sufficient-cases

> module: core | created: 2026-11-27

## 变更原因
**需求：verify 必须完全不需要人参与。** 来源：Team 需求池 openlogos #2（P1），由 #1 经 2026-11-26 讨论收敛而来；配套需求为 RunLogos #35。

- **病灶 1：「自动用例」没有准入门槛。** markdown6 定义了 1418 条 UT/ST，只有 26 条标 `[manual]`，另有约 600 条（后端要真实 MySQL 8.4，发布、钥匙环、账号界面要实机）在验收沙箱里跑不了。项目只好由人在外面跑好，再通过带 SHA256 的外部证据索引（环境变量 `M6_VERIFY_EVIDENCE_INDEX`）交回。RunLogos driver 不提供这个变量，每次最终验收都要人手拼证据。证据核对脚本 `scripts/verify-current-evidence.py` 已有 686 行，写死了后端提交号、Jar 的 SHA256 与「必须等于 1501 条」这类常数，最近 5 次提交全在给它打补丁。2026-11-26 editor-writing-ux 因此无法自动完成最终验收，只能经用户授权跳过 610 条。
- **病灶 2：判断依据只覆盖一部分情形。** test-writer 3c 只对 ST 列出真实终端、跨窗口、视觉、硬件这几类必须标 `[manual]` 的情形，判断标准是「CI 无头环境能否稳定运行」。「每次都要人提供凭据或证据文件」「要在实机上装签名包」「要人点系统弹窗」都没覆盖，也没有任何地方声明自动用例依赖哪些环境。
- **病灶 3：skip 就算有效通过。** `spec/test-results.md`「skip 结果的有效通过语义」与功能规格 §2.7A 规定：UT/ST 的 `skip` 计入已执行、已覆盖，通过率按 (通过 + 跳过) / 已执行 计算，不会让门禁失败。自动用例因为环境没准备好写一行 skip，验收照样通过，没有任何证据。smoke 早已堵上这个口子：§2.48 规定本提案改动的 `SMOKE-*` 用例写 skip 时门禁 FAIL（`required_cases_skipped`），只有 `reason_code: "platform-unavailable"` 且带非空 `detail` 的平台跳过放行。verify 却没有同样的规则。
- **病灶 4：提案看不出验收要人做什么。** proposal 里没有一处写明本次验收需要什么环境、哪些用例需要人参与。用户批准方案时，无法预见最后要亲手做多少事。

讨论中用户确认的规则（2026-11-26 原话见「决策澄清」C01、C02）：用例只按「是否需要人参与」分两类；verify 只跑不需要人参与的用例，可以对机器提环境要求，但不能要人配合；需要人参与的用例落到人工层（发布前冒烟验收中的人工验收由后续需求 openlogos #3 实现）。本提案只对 UT/ST 启用这套分类；SMOKE 的人工标记及其读取、待验与记录规则，由 #3 一并交付（评审 proposal-r1 F4）。

## 最小实现论证

> S35/S09：本段**不进 canonical 必填章节**——缺段、未填、占位残留三者均不触发任何检查。
> 它是自律提示，作用在设计发生**之前**；事后的规模信号由 change-lint 的观测 warning 承担。

- 先检索既有机制：
  - **`[manual]` / `[manual/<平台>]` 首格标记**（`cli/src/lib/test-id.ts` 的 `MANUAL_MARKER_RE`，S13 不变量 1）：verify 已把它们排除在 defined / executed 之外，结果里出现即判 `manual_test_result_id`。**直接复用作「需要人参与」的唯一标记**，只改它的判断依据，不新增标记语法。
  - **smoke 的平台跳过例外**（功能规格 §2.48，`reason_code: "platform-unavailable"` + 非空 `detail`；本提案改动用例的其余 skip 判 `required_cases_skipped`）：**verify 照搬同一套字段与判据**，不另造跳过原因体系。
  - **测试变更集**（`buildTestChangeSet`，change-lint L4 与 merge 共用）：已能算出活跃提案新增或修改的测试 ID。**复用作「严格判定集合」**，不另算。
  - **沙箱环境继承**（`cli/src/lib/sandbox.ts:171`，各执行路径都继承 `process.env`）：变量本来就传得进沙箱，markdown6 的问题是 driver 环境里没有这个变量。所以只加「声明 + 预检」，**不过滤未声明的变量**；过滤会连 `PATH`、`HOME`、`JAVA_HOME` 一起去掉，影响所有项目。
  - **proposal 的「部署影响」段**（固定字段 + lint 检查格式）：「验收标准」段沿用同样的固定字段写法，不引入新的 YAML 区块。
  - **配置写入路径**（评审 proposal-r1 F5）：change-writer 的产物只有 proposal / tasks 与获批的规格 delta（`skills/change-writer/SKILL.md` Step 4～6），delta 映射不含 `logos/logos.config.json`。但 guard 对 `logos/logos.config.json` 的规则是「有活跃提案时按提案范围处理、立案后可修改」（`logos/spec/pretooluse-guard.md`「受保护判定」第 3 步说明）。所以配置差异的分工是：change-writer 在「验收标准」段记录预期差异，test-writer 补齐具体要求，merge 后的 `[code]` 实现任务在活跃提案内写入配置，verify 负责对账。
  - **生成指令与 guard 规则的口径**（评审 proposal-r2 F5）：`openlogos sync` 生成的 AGENTS.md / CLAUDE.md「保护范围配置」一条（`spec/agents-md.md`「变更管理例外文件清单与保护范围配置」第 2、3 条，模板在 `cli/src/commands/init.ts` 中英各一份）对整份 `logos/logos.config.json` 写的是「不得直接修改」，只给了 `ignore` / `exempt` 两个入口，而这两个入口只管忽略和豁免路径（`cli/src/index.ts:117–118`）。按指令执行的实现代理因此没有写 `verify.requirements` 的合法写法，比 guard 本身的规则更严。本提案把指令改成与 guard 同口径：`.gitignore`、`.git/info/exclude` 与 `logos.config.json` 的 `guard` 字段决定保护范围，仍不得直接修改、继续走受限命令；`logos.config.json` 的其他字段（如 `verify.requirements`）只在已立案且属于当前提案范围时，由实现任务直接修改。本仓的生成指令在部署后执行 `openlogos sync` 时更新；在此之前，本提案 `[code]` 任务对 `verify.requirements.checks` 的那一次写入，以经批准的本提案范围为依据。
  - **测试入口与结果过滤**（评审 proposal-r1 F2）：verify 只是在统计时去掉人工 ID（`cli/src/commands/verify.ts:727`），预跑命令照样整条执行（`:365`）；reporter 也是在测试结束后才过滤结果（`cli/test/openlogos-reporter.ts:86`、`:103`）。这两处都挡不住人工用例被启动。所以规则必须落在项目测试入口上：调度前就排除人工用例，沿用项目已有的测试分组或独立入口。本仓规格里没有任何真实的 `[manual]` 行（`UT-S10-188 [manual]` 只出现在 UT-S35-154 的夹具描述里），默认入口不受影响。
- 为什么不能更小：
  - 只改 test-writer 的判断依据不够：没有机器检查，「环境没准备好就写 skip」仍然能过 verify，病灶 3 原样存在。
  - 只堵 skip 也不够：自动用例依赖的环境没有声明，环境缺失时只能看到一片 skip 或失败，分不清是代码坏了还是机器没准备好。driver 会派修复 agent 去修一个修不好的问题（RunLogos #35 正是为此）。
  - 不写「验收标准」段，用户批准方案时仍看不出要亲手做什么（病灶 4），也违背用户「做提案时就把验收标准写清楚」的要求。
- 本提案主动砍掉的：
  - **冒烟阶段的人工验收**（按环境开关、逐条记录、待验收清单）：属于 openlogos #3，依赖本提案的分类定义，另立提案。本提案不改 smoke 的任何判定。
  - **SMOKE 的人工标记**（评审 proposal-r1 F4）：`cli/src/lib/smoke-coverage.ts:66` 只把首格恰好等于 SMOKE ID 的行当作表格用例，整份文件没有匹配行时才退回全文扫描。提前要求 SMOKE 写 `[manual]`，同一用例会随文件里其他行而时有时无：被纳入时算作未覆盖，被漏掉时从集合里消失。这项与 #3 的读取、待验、记录规则一起交付；本提案只在「验收标准」段用文字列出人工验收事项。
  - **过滤未声明的环境变量**：理由见上。
  - **用关键词猜测用例是否需要人参与**（比如描述里出现「实机」「真机」就报错）：误报漏报都多，判断仍交给 test-writer 和评审；机器只检查标记格式和平台跳过原因。
  - **存量用例一刀切**：用户决定（C02）存量用例默认按「不需要人参与」处理，存量用例的非平台 skip 只出警告、不挡门禁；严格判定只作用于活跃提案新增或修改的用例。
  - **为每条用例加「执行环境」列**：环境要求在 `logos.config.json` 按项目或模块命令组声明一次即可，逐条加列会让上千行的用例表膨胀，又没有机器能核对。

## 变更类型
需求级（新增「用例按是否需要人参与分类、verify 完全自足」的用户可见规则：新增验收条件，并贯穿功能规格、S13 / S09 / S35 场景、测试结果规范、test-writer 与 change-writer 两个 Skill、测试用例、部署方案与 smoke；不涉及 API / DB）

## 变更范围
> 与 `tasks.md` 的 `[delta]` 目标一一对应。

- 影响的需求文档：`core-01-requirements.md` 新增「verify 自足与用例分类需求（verify-self-sufficient-cases）」，验收条件 AC-VERIFY-SELF-01 起。
- 影响的功能规格：`core-01-feature-specs.md` 新增 §2.106「verify 自足：用例分类、环境预检与跳过分类」，包括：
  - UT/ST 分类定义与判断方法（换版本判据，见变更概述）；
  - 项目测试入口在调度前排除人工用例；
  - `verify.requirements` 声明与预检，诊断码 `verify_env_not_ready`；
  - UT/ST 结果的 `reason_code` / `detail`，以及平台跳过例外；
  - 严格判定集合与诊断码 `case_tier_mismatch`；存量用例非平台 skip 的警告 `unclassified_skipped_cases`；
  - 验收标准中列出的环境要求与配置对账，诊断码 `acceptance_requirement_undeclared`；
  - proposal「验收标准」段与 change-lint 检查；
  - 兼容性（SMOKE 判定不变）。

  §2.7A「skip 语义」不改原文，由 §2.106 补充例外。
- 影响的业务场景：
  - `core-S13-verify-results.md` 新增「S13 verify 自足：环境预检与跳过分类」：时序、对账与预检先于任何命令执行、严格判定集合的来源、人工用例不被测试入口启动、异常与边界；
  - `core-S09-change-management.md` 新增「S09 提案验收标准段」：脚手架生成、change-writer 填写；
  - `core-S35-change-lint.md` 新增「S35 验收标准段检查」：缺段时警告，在场但字段缺失或取值非法时报违规。
- 影响的 API：无（`core` 模块 `skip_phases` 含 `api`）
- 影响的 DB 表：无（`skip_phases` 含 `database`）
- 影响的编排测试：无（同上，无 API）
- 影响的方法论规范与 Skill：
  - `spec/test-results.md`：UT/ST 的「`[manual]` 标记用例」改为「需要人参与」定义与换版本判据；新增「人工用例不得被测试入口启动」（调度前排除，沿用测试分组或独立入口）；UT/ST 结果行新增可选字段 `reason_code` / `detail`；新增「verify 环境要求声明、对账与预检」「verify 跳过分类」两节；reporter 模板说明如何按实际跳过原因写平台跳过。SMOKE 部分不改。
  - `skills/test-writer/SKILL.md`：3c 改为按「是否需要人参与」判断 UT/ST（换版本判据、典型情形）；人工用例的测试代码不得进入默认 verify 入口；不需要人参与的用例所需环境，列成具体条目交给 change-writer；平台限定用例按实际触发条件写跳过原因，适用平台上的前置工具写成 `checks`。SMOKE 的人工标记留给 #3。
  - `skills/change-writer/SKILL.md`：Step 4 新增「验收标准」段的填写要点。「自动验收环境要求」写成 `env:<名>` / `command:<名>` / `check:<名>` 条目，即预期的配置差异，并写明由 `[code]` 任务写入 `logos/logos.config.json` 的 `verify.requirements`、由 verify 对账。
  - `spec/cli-json-output.md`：「共用对象：run」的 `result_source` 新增 `"none"`，对应环境预检类原因判 FAIL 的历史记录（评审 delta-r1 F5）；功能规格 §2.104.3 同步修改。
  - `spec/test-results.md` 另修改「模块验收报告」（预检类原因与用例分层错误计入模块 Gate、预检失败时撤销旧 PASS，评审 delta-r1 F1）与「结果来源」两节。
  - `spec/agents-md.md`：「变更管理例外文件清单与保护范围配置」第 2、3 条（中英文案）改为与 guard 同口径，见「最小实现论证 → 生成指令与 guard 规则的口径」（评审 proposal-r2 F5）。
- 影响的测试规格：
  - `core-S13-test-cases.md`：UT-S13-157～UT-S13-179、ST-S13-40～ST-S13-43；
  - `core-S09-test-cases.md`：UT-S09-490 起；
  - `core-S08-test-cases.md`：UT-S08-90 起（生成指令的保护范围条款中英文案）；
  - `core-S35-test-cases.md`：UT-S35-225 起。
- 影响的部署方案与 smoke：
  - `core-01-deployment-plan.md` 新增「OpenLogos 0.16.24 本机测试环境发布（verify-self-sufficient-cases）」；
  - `core-smoke-test-cases.md` 新增安装态 smoke，SMOKE-core-338 起。
- 影响的代码：
  - `cli/src/commands/verify.ts`：执行任何预跑命令前，先把活跃提案「验收标准」列出的环境要求与生效配置对账（`acceptance_requirement_undeclared`），再做环境预检（`verify_env_not_ready`）；归一化时读取 UT/ST 结果的 `reason_code` / `detail`；按严格判定集合给出 `case_tier_mismatch`、按存量给出 `unclassified_skipped_cases`；接入门禁原因优先级、JSON 输出与验收报告。
  - `spec/logos.config.schema.json`：新增 `verify.requirements` 与 `verify.modules.<id>.requirements`。
  - `openlogos change` 的 proposal 脚手架：新增「验收标准」段。
  - `cli/src/lib/change-lint.ts`：「验收标准」段检查，包括环境要求条目的格式。
  - `cli/test/openlogos-reporter.ts` 支持写平台跳过原因。本仓 6 条平台跳过用例按各自实际的触发条件写原因：
    - ST-S08-45、ST-S09-219、ST-S19-35、ST-S19-36、ST-S19-37：非 Windows 时写平台跳过；
    - ST-S13-26：非 Linux、root 身份、或沙箱复用能力不可用时写平台跳过；适用条件全部成立时不再因为缺 `cc` 而跳过，缺 `cc` 由预检报 `verify_env_not_ready`（评审 proposal-r1 F3）。
  - ST-S13-26 的适用条件抽成单一判定（评审 proposal-r2 F3）：Linux、非 root、沙箱复用能力可用，三者同时成立。复用能力取自 `cli/src/lib/sandbox-reuse.ts` 的 `detectLivenessCapability`，含测试接缝 `OPENLOGOS_SANDBOX_TEST_NO_LIVENESS`。该判定以无需构建即可运行的形态提供，ST-S13-26 的跳过条件和下面的检查命令都调用它，不各写一份。
  - 本仓 `logos/logos.config.json`：在 code 阶段、活跃提案内新增 `verify.requirements.checks` 一项 `linux-nondump-cc`。检查命令用 node 执行、跨平台可用：调用上述单一判定，只在适用条件全部成立时要求 `cc --version` 成功，其余情况（含非 root Linux 但复用能力不可用）直接通过。
  - `cli/src/commands/init.ts`：生成指令「保护范围配置」一条的中英模板，按 `spec/agents-md.md` 新口径修改；部署后在本仓执行 `openlogos sync` 更新 AGENTS.md / CLAUDE.md。
  - 升版 0.16.24、CHANGELOG、安装态 smoke runner。

## 部署影响
- 是否需要部署：是
- 部署原因：verify、change-lint 与 proposal 脚手架都是 CLI 产品代码，只有装进本机全局 CLI，markdown6 等用全局 CLI 推进的项目才能用上；登记表配置了 `proposal_default_env: test`。升版到 0.16.24 以区分新旧安装态
- 影响环境：`test`（登记表 `proposal_default_env`，本机 npm 全局安装态）；不 npm publish、不打 tag、不 push
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」：脚本失败时自动回装回滚制品；成功落账后 `openlogos deploy --env test --rollback` 回到 test 当前版本，即提交 `3095ac7` 的安装态 0.16.23）
- 是否需要 smoke：是（安装态 smoke 在一次性项目中证明以下几点：
  - 验收标准列出的环境要求未写入配置时，报 `acceptance_requirement_undeclared`；
  - 写入配置但环境未就绪时，报 `verify_env_not_ready`，且两种情况都不执行预跑命令；
  - 活跃提案改动的用例写非平台 skip 时，报 `case_tier_mismatch`；
  - 带平台原因的 skip 放行；
  - 新建提案带「验收标准」段。）

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
    reason: 结果账本只新增可选字段 reason_code / detail，旧记录原样有效；不迁移、不改写已有账本与验收历史
  compatibility:
    status: required
    reason: 活跃提案新增或修改的 UT/ST 写非平台 skip 时，verify 由通过改为 FAIL；未声明 verify.requirements 的项目、存量用例的门禁结论不变。存量范围怎么过渡由用户决定（C02）
  security_privacy:
    status: none
    reason: 预检只检查已声明的环境变量是否非空、命令是否在 PATH 上、检查命令是否成功，诊断与报告只写变量名，不写变量值；不改权限、凭据与 guard
  public_release:
    status: none
    reason: 只部署到本机 test 环境，不 npm publish、不打 tag、不 push；公开发布另行决定
  external_commitment:
    status: none
    reason: CLI 只新增诊断码、JSON 字段与配置字段，不删除、不改名任何既有契约
decisions:
  - id: C01
    category: product
    source: user
    question: 用例怎么分类、verify 的自足边界在哪、需要人参与的用例放到哪里
    choice: 用例只按「是否需要人参与」分两类；verify 只跑不需要人参与的用例，可以对机器提环境要求（声明 + 预检），不能要人配合；平台不适用的 skip 合法、环境缺失的 skip 报用例分层错误；需要人参与的用例落到人工层；环境变量只做声明 + 预检、不过滤；提案写清验收标准
    reason: 用户 2026-11-26 逐条答复「1. 自足的目的就是不需要人类参与配合.可以做环境要求 2.可以 3.落到人工层吧 4.好的 5.好的」，并要求「在做提案的时候我们就把这个验收标准给写清楚了」；2026-11-27「现在openlogos来实现自己的这块吧」
    scope: 本提案全部范围；冒烟阶段人工验收属 openlogos #3
    rejected: 保留「自动用例 + 人工提供外部证据」的中间状态——每次验收都要人手拼证据，任何无关改动都会让证据失效，markdown6 已为此长出 686 行补丁脚本
  - id: C02
    category: compatibility
    source: user
    question: 存量用例如何过渡
    choice: 缺少分类信息的存量用例默认按「不需要人参与」处理；跳过严格判定只作用于活跃提案新增或修改的 UT/ST，存量用例的非平台 skip 只出警告 unclassified_skipped_cases、不挡门禁
    reason: 用户 2026-11-26 对「存量过渡」答复「好的」
    scope: verify 的严格判定集合 = 活跃提案测试变更集中的 UT/ST；无活跃提案时只出警告
    rejected: 一刀切——markdown6 等存量项目会在一次升级后整体 FAIL，被迫立即迁移上千条用例
  - id: C03
    category: deployment
    source: policy
    question: 本提案是否部署、部署到哪个环境、怎么部署、怎么回滚、以什么为 smoke 证据
    choice: 部署到 test（登记表 proposal_default_env）；部署方式为登记表 test.deploy（mode script，scripts/deploy-local.mjs），提案通道执行 openlogos deploy --env test；回滚按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」，test 的 current_ref 为 3095ac7（0.16.23）；smoke 证据为 scripts/run-smoke.js 经 openlogos smoke --env test 的实际运行结果
    reason: env show test 的 environment.deploy 为 script 方式指向受保护脚本 scripts/deploy-local.mjs，current_ref 非 null，require_approval 与 promote_from 均未配置；已合并部署方案有通用章节；默认 smoke dispatcher scripts/run-smoke.js 存在。CLI 产品代码有改动，需要装进全局才能被下游使用
    scope: "[deploy] 段、部署方案与 smoke 用例 delta、升版 0.16.24；不含 npm publish / tag / push"
    rejected: 不部署——下游 markdown6 与 RunLogos 用的都是全局 CLI，拿不到新判定
unresolved: []
defaults:
  - "诊断码命名：验收标准环境要求未写入配置 acceptance_requirement_undeclared（门禁 FAIL）；环境未就绪 verify_env_not_ready（门禁 FAIL）；用例分层错误 case_tier_mismatch（门禁 FAIL）；存量非平台 skip 警告 unclassified_skipped_cases（不挡门禁）。门禁原因优先级在功能规格中定稿，对账与预检排在最前，任一失败都不执行任何预跑命令。"
  - "分类判据（评审 proposal-r1 F1）：保留预装的机器环境，换一个待验版本（新的提交或制品），移除上一版本的结果与人工证据后，verify 命令能自行产生适用于新版本的证据，即不需要人参与。由机器自动签发、采集或获取的证据可用于自动验收；每个版本都要人重新准备的证据（例如带制品摘要的外部证据索引），归入需要人参与。"
  - "验收标准「自动验收环境要求」字段取值为「无」，或一个及以上反引号条目 `env:<变量名>` / `command:<命令名>` / `check:<检查名>`，名称与 verify.requirements 中对应项一致；条目后可跟说明文字。对账只在有活跃提案时进行；无活跃提案或该字段为「无」时不对账。"
  - "平台限定用例的前置工具检查（评审 proposal-r2 F3）：检查命令的触发条件必须与用例的完整适用条件同源（同一判定），只在用例确实会执行的机器上要求前置工具；适用条件任一不成立时检查直接通过、用例写平台跳过，避免一条用例的前置工具挡住整轮预跑。"
  - "人工用例不被启动：由项目测试入口在调度前排除（测试分组、独立文件或独立入口），verify 不新增注入变量；以哨兵用例验收（已标人工的用例一旦被启动就写哨兵文件，普通 verify 完成后哨兵不存在）。"
  - "verify.requirements 结构：env（变量名数组，要求非空）、commands（命令名数组，要求在 PATH 上）、checks（{name, command} 数组，要求退出码为 0，限时执行）。verify.modules.<id>.requirements 结构相同，只对实际执行的命令组生效，与项目级取并集。"
  - "平台跳过判据与 smoke §2.48 逐字同源：reason_code === \"platform-unavailable\" 且 detail 为非空字符串。"
  - "「验收标准」段为非 canonical 段：缺段时 change-lint 只出警告（与 UI/UX 声明段降级后的口径一致，不阻断在途提案）；段在场时三个字段（自动验收环境要求、平台限定用例、需要人参与的验收）必须存在且非空，否则报违规。"
  - "UT/ST 的 `[manual/<平台>]` 保留，语义为「需要人参与，且在该平台上执行」。SMOKE 的人工标记语义与读取规则不在本提案内改动，由 openlogos #3 交付。"
  - "新增测试编号：UT-S13-157、ST-S13-40、UT-S09-490、UT-S35-225、SMOKE-core-338 起；需求 AC-VERIFY-SELF-01 起；功能规格 §2.106。具体条数在 delta 中定稿。"
  - "本次是新能力，不新增长期 DXX 决策记录：分类规则直接写入功能规格与测试结果规范，读规格即可还原理由。"
```

## 验收标准
- 自动验收环境要求：`check:linux-nondump-cc` — 只在 ST-S13-26 的适用条件（Linux、非 root、沙箱复用能力可用）全部成立时要求 `cc --version` 成功，其余情况直接通过；由本提案 `[code]` 任务写入本仓 `logos/logos.config.json` 的 `verify.requirements.checks`
- 平台限定用例：ST-S08-45、ST-S09-219、ST-S19-35、ST-S19-36、ST-S19-37 在非 Windows 上写平台跳过；ST-S13-26 在非 Linux、root 身份或沙箱复用能力不可用时写平台跳过。本提案新增用例中如有平台限定，在测试 delta 中逐条注明
- 需要人参与的验收：无

## 变更概述
**分类（只对 UT/ST）。** UT/ST 只按「是否需要人参与」分两类，沿用 `[manual]` 标记表示「需要人参与」。判断方法：保留预装的机器环境，换一个待验版本，移除上一版本的结果与人工证据后，verify 命令仍能自行产生适用于新版本的证据，就是不需要人参与。机器自动签发、采集或获取的证据可用；每个版本都要人重新准备的证据，归入需要人参与。test-writer 按这条规则标记；人工用例的测试代码不得进入默认 verify 入口，必须在调度前被测试分组或独立入口排除。SMOKE 的人工标记留给 #3。

**环境要求的交付。** change-writer 在「验收标准」段写出预期的配置差异（`env:` / `command:` / `check:` 条目），test-writer 补齐具体要求，merge 后的 `[code]` 任务在活跃提案内把它们写进 `logos/logos.config.json` 的 `verify.requirements`。生成的 AGENTS.md / CLAUDE.md 同步改口径：保护范围（`.gitignore`、exclude、`logos.config.json` 的 `guard` 字段）仍只能走受限命令，其余配置字段在已立案且属于提案范围时可以由实现任务直接修改。

**verify 自足。**
- 执行任何预跑命令之前，先对账：活跃提案「验收标准」列出的每个环境要求条目，都必须出现在生效的 `verify.requirements` 中，缺了判 FAIL，诊断码 `acceptance_requirement_undeclared`。
- 再按 `verify.requirements` 检查环境：变量非空、命令在 PATH 上、检查命令成功。缺任何一项就判 FAIL，诊断码 `verify_env_not_ready`，逐项列出缺失项。对账或预检失败时都不执行预跑命令。
- UT/ST 结果行可以带 `reason_code` / `detail`。活跃提案新增或修改的 UT/ST 写了 skip 时，只有平台跳过（`reason_code: "platform-unavailable"` 加非空 `detail`）放行并单独列出，其余 skip 判 FAIL，诊断码 `case_tier_mismatch`，提示「准备好环境并声明到 verify.requirements，或改标 `[manual]`」。
- 存量用例的非平台 skip 只出警告 `unclassified_skipped_cases`。
- 没有声明环境要求、活跃提案验收标准没有列出环境要求条目、也没有严格集合内 skip 的项目，verify 结论与现在逐字一致；SMOKE 判定不变。

**写提案时写清验收标准。** `openlogos change` 的脚手架新增「验收标准」段，含三个字段：自动验收环境要求、平台限定用例、需要人参与的验收。change-writer 按事实填写，change-lint 检查格式。本提案自己已按这个格式写了「验收标准」段，并以 `check:linux-nondump-cc` 实际走一遍「提案记录 → code 写配置 → verify 对账与预检」。

随后升版 0.16.24，部署到本机 test 环境，用安装态 smoke 证明新判定在全局 CLI 中生效。冒烟阶段的人工验收（openlogos #3）与 RunLogos driver 的停机展示（RunLogos #35）另立提案。
