# 变更提案：layered-verification

> module: core | created: 2026-11-27

## 变更原因
来源：Team 需求池 openlogos #5「verify 支持分层验收」。设计依据是 2026-11-27 与用户定稿的 `runlogos` 仓库 `logos/resources/reference/layered-verification-design.md`（下称「定稿」），本提案是其中 openlogos 负责的部分（定稿第十节）。用户 2026-11-27 确认开工，并裁定四块能力放在一个提案里做完（C02）。

**现象。** 大型应用上，每个提案的验收都要跑全量，成本高到拖慢所有工作：
- RunLogos 一次全量 15～24 分钟，2026-11-26～27 归档的提案里，有的在全量上前后花了约 40 分钟（见已归档提案 verify-flaky-rerun 的变更原因）。
- 现有的「按模块收窄」（§2.96）对单模块项目没有效果：RunLogos 只有一个 `core` 模块，`src/**`、`test/**` 全在其中，按模块算出的「受影响」就是全量。
- 反过来，如果只为了省时间而缩小提案验收的范围，回归会一路逃到发布。

**定稿给出的办法。** 把一道验收拆成回答不同问题的两级，越往后覆盖越全、频次越低：
- **提案级验收**回答「改动做对了，而且没有破坏核心吗」，跑三层合集：本提案用例 + 受影响用例 + 主链路用例。
- **发布级验收**回答「产品整体可以交付吗」，在指定提交上跑全量，结果与提交号绑定。

红线没有放松，只是分成两层：不合并未通过提案级验收的代码；不发布未通过发布级全量验收的代码。

**现在缺什么。** openlogos 目前没有以下四样东西，定稿的其余部分（RunLogos 的 driver、Team 的执行机调度与发布门）都要等它们：
1. 没有办法在规格里标出「主链路用例」。
2. 没有比模块更细的「受影响」口径；仓库里也没有「代码文件 → 场景」的对应关系。
3. verify 只有一种级别。无法表达「这次是发布级全量」，结果也不与提交号绑定——验收历史虽然记了提交号，但没有「提交变了即作废」的判定。
4. 两种结论共用一份 `acceptance-report.md` 和同一个「验收通过」，容易把「提案级通过」误读成「可以发布」。

## 最小实现论证

> S35/S09：本段**不进 canonical 必填章节**——缺段、未填、占位残留三者均不触发任何检查。
> 它是自律提示，作用在设计发生**之前**；事后的规模信号由 change-lint 的观测 warning 承担。

- 先检索既有机制：
  - **按用例收窄执行**（`OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`，切片验收、模块范围、失败复跑都在用）：三层合集算出来以后，直接用这条通道交给 runner，**不新增任何 runner 约定**。
  - **按模块限定范围**（§2.96，`cli/src/lib/verify-scope.ts`）：已有「改动落在哪个模块就跑哪个模块 + 本提案用例」，以及共享配置变化、文件归不到模块时回落全量的规则。本提案把它作为「受影响」算不到场景一级时的**上一级兜底**，原文不改；提案起点 `baseRef`、改动文件集合的计算也直接复用。
  - **本提案用例**（`SPEC_MERGED.test_change_set`，§2.101、§2.106.6）：已经是经校验的结构化集合，直接作为三层中的第一层，不另算。
  - **场景与用例文档的对应**：测试用例文档按 `<module>-SXX-test-cases.md` 命名，场景编号全局唯一。「某个场景的全部用例」可以从文件名直接得到，不需要新的索引。
  - **用例首格标记**（`[manual]`，`cli/src/lib/test-id.ts`）：首格语法是闭合的，旧版 CLI 与各项目自写的 reporter 遇到不认识的首格标记会把整行漏掉。所以主链路标记**不复用首格**，改写在用例文档内的独立小节（C05）。
  - **验收历史**（§2.104）：每次运行已记录提交号与工作区是否干净。发布级结果直接记在同一份历史里，只加「级别」与「平台」两个字段，不另建账本。
  - **失败复跑与偶发**（§2.108）：两级验收都沿用。主链路用例「不得偶发」的约束建在它上面。
  - **提案的「验收标准」段**（§2.106.8）：是「在提案里结构化声明、verify 对账」的先例。「受影响场景」声明照同一做法：脚手架生成段、change-lint 检查结构、verify 读取。
  - **`openlogos impact`**（`spec/change-impact.md`）：回答的是「一次提交是否只改了生命周期簿记」，面向下游 CI 的部署判断，粒度与用途都不同，不复用，也不改它。
- 为什么不能更小：
  - 只做主链路标记：没有消费方，提案验收的范围不会变。
  - 只做「受影响 + 主链路」、不做发布级：提案验收变窄以后，没有任何一道门再跑全量，等于把红线拿掉了一半。两级必须同时存在，分层开关才能安全打开。
  - 只做发布级、不做分层：提案验收仍然每次全量，#5 要解决的成本问题原封不动。
  - 不分开报告：`acceptance-report.md` 在提案级通过时写着 PASS，无法区分它是「三层合集通过」还是「全量通过」，定稿第八节明确要求分开。
  - 「受影响」只按模块算：对单模块项目等于全量（见变更原因）。
- 本提案主动砍掉的：
  - **代码文件到场景的机器映射**（在 `logos-project.yaml` 给场景声明 `paths`，或按测试覆盖率反推）：用户裁定影响评估在写提案时做（C01）。机器映射要么需要长期人工维护，要么依赖具体测试框架，都不做。代价见变更概述「已知限制」。
  - **全量的调度、执行机、每晚触发、自动生成缺陷、发布门**：属 Team 与 RunLogos（定稿第五～七节）。本提案只提供「在当前提交上跑发布级全量」和「查询某个提交有没有有效的发布级结果」两个原子能力。
  - **多平台聚合**：发布级记录只写下本次运行所在的平台；「每个目标平台都有全绿结果」由 Team 判断。
  - **既有回归的回补修复规则、越界记录**：属 RunLogos（定稿第四节第 3 条）。
  - **自动维护主链路清单**：由人和研发共同定义（定稿第四节第 2 条）。CLI 只做结构检查、规模上限和偶发约束。
  - **openlogos #4**（无关配置变化不回落全量）：另立提案。本提案沿用现有「共享配置变化即扩大到全量」的口径，#4 落地后自然收窄。
  - **SMOKE 分层**：冒烟仍按现有规则执行，本提案只管 UT/ST。

## 变更类型
需求级（新增用户可见规则「分层验收」：主链路用例、提案中的受影响场景声明、提案级三层验收、发布级全量验收与两级报告。新增验收条件，并贯穿功能规格、架构、场景、测试结果规范、CLI JSON 契约、配置 schema、提案脚手架与 change-lint、两个技能、测试用例、部署方案与 smoke；不涉及 API / DB）

## 变更范围
> 与 `tasks.md` 的 `[delta]` 目标一一对应。

- 影响的需求文档：`core-01-requirements.md` 新增「verify 分层验收需求（layered-verification）」，验收条件 AC-VERIFY-TIER-01 起。
- 影响的功能规格：`core-01-feature-specs.md`
  - 新增 §2.109「分层验收：主链路、受影响场景、提案级与发布级」；
  - 修改 §2.104.3（中央索引新增可选字段 `level`、`platform`）；
  - §2.96、§2.101、§2.106、§2.108 原文不改，由 §2.109 说明衔接关系。
- 影响的技术架构：`core-01-architecture-overview.md` 新增「六十、分层验收：验收集合的三层构成与两级证据」。
- 影响的业务场景：
  - `core-S13-verify-results.md` 新增「S13 分层验收：提案级三层集合」与「S13 发布级全量验收」两节；
  - `core-S09-change-management.md` 新增「S09 提案脚手架的『受影响场景』段」；
  - `core-S35-change-lint.md` 新增「S35 受影响场景声明与主链路小节的结构检查」；
  - `core-S32-slice-planning.md` 新增「S32 分层开启时切片 checkpoint 的基线部分」。
- 影响的 API：无（`core` 模块 `skip_phases` 含 `api`）
- 影响的 DB 表：无（`skip_phases` 含 `database`）
- 影响的编排测试：无（同上，无 API）
- 影响的方法论规范：
  - `spec/test-results.md`：新增「分层验收」一节（主链路小节的写法、三层集合、扩大规则、两级验收与各自的报告、对 runner 的要求不变）；修改「验收历史留存 > 三层数据与字段边界」的字段清单。
  - `spec/cli-json-output.md`：verify `data` 新增 `level`、`layers`；新增 `openlogos verify --release` 与 `--release --check` 的输出；`gate.reason` 新增三个取值；「共用对象：run」新增 `level`、`platform`；`history list` 新增筛选参数。
  - `spec/change-management.md`：提案包新增可选段「受影响场景」及其读取规则。
  - `spec/logos.config.schema.json`（属 `[code]`，随规格列出）：新增 `verify.layered`。
- 影响的技能：
  - `skills/change-writer/SKILL.md`：新增「受影响场景」段的评估与填写规则；
  - `skills/test-writer/SKILL.md`：新增主链路小节的写法与入选判据。
- 影响的测试规格：
  - `core-S13-test-cases.md`：UT-S13-217 起、ST-S13-48 起；
  - `core-S09-test-cases.md`：UT-S09-504 起；
  - `core-S35-test-cases.md`：UT-S35-231 起；
  - `core-S32-test-cases.md`：UT-S32-118 起。
- 影响的部署方案与 smoke：
  - `core-01-deployment-plan.md` 新增「OpenLogos 0.16.27 本机测试环境发布（layered-verification）」；
  - `core-smoke-test-cases.md` 新增安装态 smoke，SMOKE-core-352 起。
- 影响的代码：
  - 新模块：主链路小节读取、受影响场景声明读取、三层集合计算；
  - `cli/src/commands/verify.ts`：分层开启时以三层集合为验收集合；`--release` 与 `--release --check`；两级报告；
  - `cli/src/lib/verify-scope.ts`：作为上一级兜底被调用（规则不改）；
  - `cli/src/lib/test-slice-manifest.ts`：分层开启时 checkpoint 的基线部分；
  - `cli/src/lib/verification-history.ts` 与 `cli/src/commands/history.ts`：`level`、`platform` 与筛选；
  - `cli/src/commands/change.ts`（脚手架）、`cli/src/lib/change-lint.ts`：「受影响场景」段与主链路小节检查；
  - `cli/src/lib/verify-config.ts`、`spec/logos.config.schema.json`：`verify.layered`；
  - `cli/src/i18n.ts`；两个技能及其插件副本；
  - 升版 0.16.27、CHANGELOG、安装态 smoke runner。

## 部署影响
- 是否需要部署：是
- 部署原因：verify、change、change-lint 都是 CLI 产品代码，只有装进本机全局 CLI，RunLogos、markdown6 等用全局 CLI 推进的项目才能用上；登记表配置了 `proposal_default_env: test`。升版到 0.16.27 以区分新旧安装态
- 影响环境：`test`（登记表 `proposal_default_env`，本机 npm 全局安装态）；不 npm publish、不打 tag、不 push
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」：脚本失败时自动回装回滚制品；成功落账后 `openlogos deploy --env test --rollback` 回到 test 当前版本，即提交 `c3c7a9e` 的安装态 0.16.26）
- 是否需要 smoke：是（安装态 smoke 在一次性项目中证明：
  - 分层未开启时，验收范围与 0.16.26 一致；
  - 开启后，提案级验收把三层合集交给测试入口（夹具入口按清单收窄，调用记录可见未启动集合外的用例），门禁只采信三层合集，报告标明级别与三层各自的用例数；
  - 声明缺失或涉及共享改动时范围扩大，不缩小；
  - 主链路超过上限时 FAIL；
  - `verify --release` 实际执行全量、写独立报告；未配置命令时拒绝；`--release --check` 在同一提交后一次失败、或提交变化后判为无有效结果。）

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
    reason: 结果账本格式不变；验收历史与 JSON 输出只新增可选字段，旧记录原样有效，不迁移、不改写
  compatibility:
    status: required
    reason: 分层开启后提案级验收不再执行全量，是门禁范围的变化；主链路标记的写法决定旧版 CLI 与各项目自写 reporter 是否受影响。两项均已由用户决定（C04、C05）
  security_privacy:
    status: none
    reason: 发布级验收与提案级验收执行同一条已配置的命令、同一沙箱规则；受影响场景声明只含场景编号与理由，不扩大写入范围、不改权限与 guard
  public_release:
    status: none
    reason: 只部署到本机 test 环境，不 npm publish、不打 tag、不 push
  external_commitment:
    status: none
    reason: CLI 只新增参数、JSON 字段、门禁原因码与配置字段，不删除、不改名任何既有契约
decisions:
  - id: C01
    category: product
    source: user
    question: 「受影响用例」要细到场景一级，但没有「代码文件 → 场景」的对应关系，这层关系从哪里来
    choice: 写提案时评估本次改动影响到哪些场景，在提案里结构化声明，verify 读取这份声明；不引入代码路径到场景的机器映射
    reason: 用户 2026-11-27 原话「我们在写提案的时候,是否可以评估影响到了哪些场景?然后再提案级别做这个逻辑可以吗?」
    scope: 提案包新增「受影响场景」段、change-writer 的评估规则、change-lint 的结构检查、verify 的读取与扩大规则
    rejected: 在 logos-project.yaml 给场景声明 paths——需要长期人工维护；只用提案 delta 触及的场景——代码改到未写进 delta 的场景时发现不了
  - id: C02
    category: product
    source: user
    question: 主链路标记、受影响计算、提案级三层验收、发布级全量验收四块能力，做成一个提案还是拆开
    choice: 一个提案做完
    reason: 用户 2026-11-27 在「拆成两个 / 一个提案做完 / 拆成三个」中选择「一个提案做完」
    scope: 本提案全部范围；openlogos #5 在本提案归档时完成
    rejected: 拆成两个提案（提案级与发布级分开）——用户未采纳
  - id: C03
    category: product
    source: user
    question: 主链路的规模上限怎么定、超了怎么办
    choice: 可配置，缺省 50 条；超过上限时提案级验收判 FAIL 并点名超出数量，change-lint 在写规格时提前警告；主链路用例出现偶发时同样报出
    reason: 用户 2026-11-27 选择「可配置，缺省 50，超限判 FAIL」
    scope: verify.layered.main_path_max、门禁原因 main_path_over_limit 与 main_path_flaky、change-lint 警告
    rejected: 超限只警告——约束力弱，主链路容易膨胀成全量；按占比设上限——随项目长大自动放宽
  - id: C04
    category: compatibility
    source: user
    question: 分层模式的开关放在哪里、缺省是什么
    choice: 项目配置 logos.config.json 的 verify.layered.enabled，缺省 false；openlogos 不感知 Team，由宿主在开启发布流程时写入；未开启的项目行为逐字不变
    reason: 用户 2026-11-27 选择「项目配置，缺省关闭」；定稿第一节「没有发布概念的项目保持现状，提案验收照旧跑全量」
    scope: 升级到 0.16.27 的全部项目；只有显式开启的项目提案级验收范围才会变窄
    rejected: 命令行参数——人手工运行与宿主运行的范围可能不一致；配置加命令行覆盖——多一套优先级规则
  - id: C05
    category: compatibility
    source: user
    question: 主链路标记写在用例表首格，还是写在不影响首格的独立位置
    choice: 写在每个测试用例文档内固定标题的独立小节「主链路用例」中，列出本文档内属于主链路的用例 ID；用例表首格不变
    reason: 用户 2026-11-27 选择「用例文档内的独立小节」。首格语法是闭合的（cli/src/lib/test-id.ts），0.16.26 及更早的 CLI 与各项目自写的 reporter 遇到未知首格标记会漏掉整行，用例从已定义集合中消失
    scope: 主链路小节的语法与读取、test-writer 技能、change-lint 结构检查；旧版 CLI 与既有 reporter 不需要任何修改
    rejected: 首格标记 [main]——用了标记的项目必须所有机器同时升级并改 reporter 正则，否则主链路用例反而被漏掉
  - id: C06
    category: deployment
    source: policy
    question: 本提案是否部署、部署到哪个环境、怎么部署、怎么回滚、以什么为 smoke 证据
    choice: 部署到 test（登记表 proposal_default_env）；部署方式为登记表 test.deploy（mode script，scripts/deploy-local.mjs），提案通道执行 openlogos deploy --env test；回滚按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」，test 的 current_ref 为 c3c7a9e（0.16.26）；smoke 证据为 logos.config.json 的 smoke.command（node scripts/run-smoke.js）经 openlogos smoke --env test 的实际运行结果
    reason: env list 的 proposal_default_env 为 test；env show test 的 environment.deploy 为 mode script、script scripts/deploy-local.mjs，current_ref 为 c3c7a9e3772f；已合并部署方案有通用章节；CLI 产品代码有改动，需要装进全局才能被下游使用
    scope: "[deploy] 段、部署方案与 smoke 用例 delta、升版 0.16.27；不含 npm publish / tag / push"
    rejected: 不部署——下游 RunLogos 与 markdown6 用的都是全局 CLI，拿不到分层验收能力
unresolved: []
defaults:
  - "配置形态：verify.layered = { enabled: boolean（缺省 false）, main_path_max: 正整数（缺省 50）, shared_paths: glob 数组 }。shared_paths 缺省为依赖清单与锁文件（package.json、package-lock.json、pnpm-lock.yaml、yarn.lock、Cargo.toml、Cargo.lock、go.mod、go.sum、pyproject.toml、requirements*.txt，任意层级）；logos/logos.config.json 与 logos/logos-project.yaml 恒按共享配置处理（沿用 §2.96）。取值非法时按缺省值处理并警告，不改变门禁结论。"
  - "主链路小节：测试用例文档内二级或三级标题「主链路用例」（en：Main Path Cases），正文为列表，每项以一个用例 ID 开头，ID 之后可跟说明。只能列本文档用例表中已定义的、不带 [manual] 的 UT/ST；列了未定义、人工或 SMOKE 的 ID 属结构错误。没有该小节的文档没有主链路用例。主链路集合 = 全部测试用例文档主链路小节的并集，不随分层开关变化（标记属于规格），但只有分层开启时才参与验收范围。"
  - "受影响场景声明：提案脚手架新增「受影响场景」段（en：Affected Scenarios），位于「验收标准」之后，内容为 fenced YAML：schema openlogos/affected-scenarios@1、assessment（assessed | unknown）、shared_change（boolean，是否涉及共享代码、配置或依赖）、scenarios（数组，每项 id 与非空 reason）。该段不进 canonical 必填章节：旧提案没有它时不报错，只是按「无法评估」处理。"
  - "提案级验收集合（分层开启且存在活跃提案时）= 本提案用例 ∪ 受影响用例 ∪ 主链路用例。本提案用例取经校验的 SPEC_MERGED.test_change_set；受影响用例 = 受影响场景集合中每个场景的测试用例文档里全部不带 [manual] 的 UT/ST；受影响场景集合 = 声明的 scenarios ∪ 本提案 delta 触及的场景（deltas 下文件名含 <module>-SXX- 的场景文档与测试用例文档，自动并入，无论是否声明）。"
  - "扩大规则（只扩大不缩小），按顺序取第一个成立的：① 改动文件（复用 §2.96 的 baseRef 差异）命中共享配置或 shared_paths，或声明 shared_change 为 true → 扩大到全量；② 声明缺失、结构非法、assessment 为 unknown，或声明了不存在的场景编号 → 退回按模块计算（§2.96 的结果；模块范围未启用或其自身回落时即全量）；③ 提案起点不可用、不是 git 仓库、差异计算失败 → 全量。每次扩大都在 JSON 与报告中写明原因。扩大不是失败，不改变门禁结论。"
  - "没有活跃提案时（含直接在主干上运行），分层开启也按全量执行提案级验收：没有提案就没有三层集合的前两层。"
  - "切片 checkpoint：owned 范围不变（只验收已确认切片与本片的用例）。baseline 范围在分层开启时，其「基线回归」部分由全量改为「受影响用例 ∪ 主链路用例」，保证 切片 ⊂ 提案 ⊂ 发布 逐层包含。final verify 即提案级验收。"
  - "主链路约束（只在分层开启时进入门禁）：主链路用例数超过 main_path_max → FAIL，原因 main_path_over_limit；主链路小节结构错误 → FAIL，原因 main_path_invalid；主链路用例首跑失败、复跑通过 → 不按偶发放行，FAIL，原因 main_path_flaky，并提示修复用例或把它移出主链路。三者在原因优先级中排在 test_change_set_invalid 之后、预跑分支之前（over_limit、invalid 不依赖运行结果，在执行预跑命令之前判定并直接 FAIL，不执行命令）。分层未开启时，这三项只由 change-lint 以警告给出。"
  - "发布级验收：openlogos verify --release。不看分层开关、模块范围、切片与活跃提案，恒执行全部不带 [manual] 的 UT/ST。前置条件（任一不满足即以错误码拒绝、不执行任何命令、不产生发布级结论）：① git 仓库且工作区干净（除结果文件、报告等 lifecycle 路径外没有未提交改动）；② 配置了可执行的全量入口（pre_run_command 或两阶段命令）——发布级不支持只读取既有结果，缺命令时拒绝，磁盘上已有的全绿账本不能充当证据。不写、不删提案目录中的任何标记（VERIFY_PASS、VERIFY_FAIL、checkpoint、循环账本），不改写共用验收报告与模块验收报告。沿用环境预检、沙箱、失败复跑与偶发判定。"
  - "发布级提交身份在执行前固定：通过前置检查后、执行任何命令之前，解析并固定当前 HEAD 的完整提交号；执行副本、发布级报告与验收历史共用这一个值，不在收尾时重新读取 HEAD。收尾时复核：HEAD 与固定值不同，或工作区已不干净，本次运行不产生有效的发布级通过——门禁 FAIL，原因 release_commit_changed，历史记录的提交号仍是固定值（即被测试的那个提交），不会记到新提交名下。"
  - "发布级结论与查询：验收历史记录 level 为 release、commit.head 为执行前固定的提交号、platform 为运行所在平台（process.platform-process.arch）、result_source（发布级有结论的记录恒为 executed）。「有结论的发布级运行」指 level=release、outcome=completed、result_source=executed 的记录；环境预检类原因判 FAIL 的运行（result_source=none，没有执行任何测试）与被前置条件拒绝的调用都不是结论——环境没就绪只说明这次没跑成，既不推翻此前的结论，也不算通过。openlogos verify --release --check [--commit <sha>] 只读查询：在指定提交（缺省当前 HEAD）与当前平台下，取**最近一次有结论的发布级运行**，其门禁为 PASS 则退出码 0，否则退出码 1；同一提交先 PASS 后 FAIL 时判无效，先 FAIL 后 PASS 时判有效。退出码 1 时说明原因：从未有结论、最近一次结论为 FAIL，或只有其他提交 / 其他平台的结论（提交变了即作废）。多平台聚合由调用方按 platform 自行判断。"
  - "两级报告分开：提案级仍写 logos/resources/verify/acceptance-report.md，分层开启时 Summary 增加「级别：提案级（分层）」与三层各自的用例数、扩大原因；分层未开启时该报告字节不变。发布级写 logos/resources/verify/release/acceptance-report.md，标明「级别：发布级（全量）」、提交号与平台。文本输出与 JSON 同样标明级别；提案级通过时提示「不等于可以发布」。"
  - "JSON：verify data 新增 level（proposal | release，0.16.27 起恒输出）与 layers（分层开启的提案级验收才输出：changed、affected、main_path 各自的用例数与 ID 来源，affected 的场景清单、每个场景的来源（declared / delta），expansion 的取值与原因）。gate.reason 新增 main_path_over_limit、main_path_invalid、main_path_flaky，以及发布级的 release_commit_changed；layers 含 outside_result_count；warnings 新增 layered_runner_not_narrowed。中央索引新增可选字段 level、platform；history list 新增 --level 与 --commit 筛选。"
  - "实际省时取决于测试入口：verify 只负责算出三层集合、经 OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS 传给测试入口，并只采信集合内的结果；测试入口是否据此少启动测试文件由各项目决定。提案级 final 验收时不注入 OPENLOGOS_VERIFY_SLICE_SCOPE（该变量只属于切片 checkpoint），因此只在 slice-checkpoint 且 owned 时才按清单选文件的测试入口（RunLogos 的 scripts/run-vitest.js 现状）在分层开启后仍会执行全量文件——门禁正确，但不省时。项目开启分层的前置依赖是：测试入口在收到 OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS 时一律按清单选择要执行的文件（沿用其已有的选文件逻辑即可）；RunLogos 侧的适配属 RunLogos 的配套需求（定稿第十节「driver 按三层跑提案验收」），不在本提案内实现。为让未适配的情形可见，verify 在分层收窄生效时统计集合之外的结果行数（JSON layers.outside_result_count，报告同列），大于 0 时给出警告 layered_runner_not_narrowed；集合外的结果不采信、不判账本不自洽。本提案的验收同时核对两件事：测试入口实际启动的范围（夹具调用记录）与门禁采信的 ID。"
  - "发布级报告路径放在独立子目录 logos/resources/verify/release/ 下，不与模块验收报告 <module>-acceptance-report.md 同形（模块名可以合法地叫 release）。该路径纳入结果路径与报告路径的保留集合与冲突检查：result_path 等配置落在其上时按既有保留路径规则处理；沙箱写入白名单包含它。"
  - "已知限制：声明的受影响场景是写提案时的评估，实现过程中改到了声明之外的场景，verify 无法从代码差异中发现（没有代码到场景的映射，C01）。由三处缓解：delta 触及的场景自动并入；共享改动扩大到全量；发布级全量兜底。change-writer 在实现阶段发现影响面扩大时须更新声明。"
  - "新增编号：需求 AC-VERIFY-TIER-01 起；功能规格 §2.109；架构「六十」；UT-S13-217、ST-S13-48、UT-S09-504、UT-S35-231、UT-S32-118、SMOKE-core-352 起。具体条数在 delta 中定稿。"
  - "不新增长期 DXX 决策记录：规则直接写入功能规格与测试结果规范；定稿文档保留在 runlogos 仓库作为跨产品依据。"
```

## 验收标准
- 自动验收环境要求：无（发布级验收与受影响范围的用例需要 git，夹具自建一次性仓库；本仓 verify 已依赖 git，不新增声明）
- 平台限定用例：无（发布级记录中的平台取值用关系式断言，不依赖特定平台；如 delta 阶段发现需要平台限定，在测试 delta 中逐条注明）
- 需要人参与的验收：无

## 变更概述
**做什么。** 让 verify 有两种级别，并让提案级验收可以只跑「该跑的那部分」：

1. **主链路用例。** 在测试用例文档里加一个固定标题的小节「主链路用例」，列出「坏了就等于产品不可用」的用例 ID。它是规格的一部分，随提案的 delta 评审。规模有上限（缺省 50，可配置），超过就判 FAIL；主链路用例不允许靠复跑通过——首跑失败、复跑通过时不按偶发放行。
2. **受影响场景。** 新建提案时，脚手架多出一段「受影响场景」。写提案的人（或 AI）评估这次改动会波及哪些场景，逐个写出场景编号和理由，并说明是否涉及共享代码、配置或依赖。这一段和方案一起在「批准方案」时由人审视。
3. **提案级验收（分层开启时）。** 验收集合 = 本提案用例 + 受影响场景的全部用例 + 主链路用例，通过已有的收窄通道交给测试入口，门禁只采信集合内的结果。报告写明级别是「提案级」，以及三层各有多少条。真正少跑多少，取决于项目的测试入口是否按清单选择要执行的文件——这是项目开启分层的前置依赖（RunLogos 的测试入口需要配套适配，不在本提案内）；测试入口没有收窄时 verify 会给出警告。
4. **只扩大，不缩小。** 提案 delta 实际改到的场景会自动并入；改动碰到共享配置或依赖清单，或声明里写了涉及共享改动，就扩大到全量；声明缺失、写了「无法评估」或写错了场景编号，就退回按模块计算。每次扩大都写明原因，扩大本身不算失败。
5. **发布级验收。** `openlogos verify --release` 在干净的工作区上实际执行全量（不接受只读取已有结果），开跑前固定提交号，结果连同这个提交号和平台记进验收历史，写一份独立的 `logos/resources/verify/release/acceptance-report.md`，不碰提案的任何标记。`openlogos verify --release --check` 回答「这个提交有没有有效的发布级结果」：只看该提交在本平台上最近一次有结论的全量运行——后一次失败会推翻前一次通过；提交变了，旧结果就不算数。
6. **开关。** `verify.layered.enabled` 缺省关闭。不开启的项目，提案验收照旧跑全量，输出与报告不变；发布级验收命令始终可用。

**已知限制。** 受影响场景是写提案时的评估。实现过程中如果改到了声明之外的场景，verify 没有办法从代码差异里看出来，因为仓库里没有「代码文件 → 场景」的对应关系（这是 C01 的取舍）。缓解靠三处：delta 触及的场景自动并入、共享改动扩大到全量、发布级全量兜底。

**不做什么。** 不做全量的调度与执行机、不做每晚触发与自动生成缺陷、不做发布门与多平台聚合（Team 与 RunLogos 的部分）；不改既有回归的修复流程；不动 `openlogos impact`；不处理 openlogos #4；不对 SMOKE 分层。之后升版 0.16.27，部署到本机 test 环境，用安装态 smoke 证明分层验收在全局 CLI 中生效。
