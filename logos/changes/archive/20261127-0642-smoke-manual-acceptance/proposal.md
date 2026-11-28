# 变更提案：smoke-manual-acceptance

> module: core | created: 2026-11-27

## 变更原因
**需求：需要人参与的用例要有地方执行、有人记录、有据可查。** 来源：Team 需求池 openlogos #3（P1）；本提案归档后同时收尾总需求 #1（#1 于 2026-11-26 拆为 #2、#3，#2 已由 verify-self-sufficient-cases 在 0.16.24 交付）。配套需求为 RunLogos #34（driver 停机展示与逐条记录界面）。

- **病灶 1：人工用例被 verify 排除后没有去处。** 0.16.24 起 UT/ST 只按「是否需要人参与」分两类，`[manual]` 用例不进 verify（功能规格 §2.106.2）。但项目里没有任何环节要求执行它们、记录结果：`spec/test-results.md`「`[manual]` 标记用例」只说「AC 标记为 `MANUAL_PENDING`，不触发 Gate 失败」。markdown6 有 26 条 `[manual]` UT/ST，0.16.24 之后它们在任何门禁里都不会被看到。
- **病灶 2：SMOKE 没有人工标记，读取时有 bug。** `cli/src/lib/smoke-coverage.ts:66` 只把首格恰好等于 SMOKE ID 的行当作表格用例，整份文件没有匹配行时才退回全文扫描。如果有人给 SMOKE 写了 `[manual]`，这条用例会随文件里其他行的情况时有时无：被纳入时算作未覆盖，被漏掉时就从集合里消失。verify-self-sufficient-cases 因此把 SMOKE 人工标记明确留给本需求（评审 proposal-r1 F4），test-writer 现在禁止给 SMOKE 写 `[manual]`。
- **病灶 3：提案「验收标准」段的「需要人参与的验收」只是文字。** change-writer Skill 规定「openlogos #3 落地前，用文字写明事项即可，不产生机器判定」。用户批准方案时看得到要人做什么，但部署、冒烟、归档都不检查这些事做了没有。
- **病灶 4：不部署的提案里的人工用例会丢。** 很多提案不部署（纯规格、或攒到下一个版本再发），它们新增的人工用例没有任何机制带到下一次发布时验收。

用户确认的规则见需求 #3 原文（「决策澄清」C01）：按环境开关；开启时自动 smoke 跑完停在「等待人工验收」、逐条记录、全部通过才写 `SMOKE_PASS`；关闭时只列出、不阻断；待验收清单由 CLI 自动计算（自上次人工验收通过以来新增或修改的人工用例 + 每次发布必跑的回归用例）；结果绑定 `deploy_id`；只能由人记录，做法同 `openlogos approve`，`--auto` 下是硬停点。

## 最小实现论证

> S35/S09：本段**不进 canonical 必填章节**——缺段、未填、占位残留三者均不触发任何检查。
> 它是自律提示，作用在设计发生**之前**；事后的规模信号由 change-lint 的观测 warning 承担。

- 先检索既有机制：
  - **`[manual]` / `[manual/<平台>]` 首格标记**（`cli/src/lib/test-id.ts` 的 `MANUAL_MARKER_RE`，§2.82 首列读法）：UT/ST 已在用，语义已在 0.16.24 改为「需要人参与」。**SMOKE 直接复用同一语法与同一正则**，不另造标记。
  - **本机部署账本 `logos/.openlogos-runtime/deployments.jsonl`**（`spec/environments.md` §5）：已有 deploy / smoke / approval 三类记录、账本锁、原子追加与失败补偿，`deploy_id` 本来就记在这里。**人工结果作为第四类记录 `kind=manual` 写进同一账本**，复用锁、校验与流式读取。需求要求「结果绑定 deploy_id」，`deploy_id` 只存在于本机账本，所以结果不能放进仓库文件。
  - **`openlogos approve` 的受限命令机制**（§2.95.5、D14、`plugin/bin/guard-check` 的 `approve` 分类）：「只能由人产生」的写入已有成熟做法——宿主原生审批，无人值守时阻断，不使用本地凭据文件。**记录命令加入同一份受限命令清单**，走同一条审批路径。
  - **已配置门禁的登记表受 guard 保护**（§2.95.5，guard 按字段名识别）：AI 不能「先关掉门再部署」。人工验收开关是同一性质的门禁策略，**把开关字段加入 guard 的识别字段**；否则 AI 改一行 YAML 就能绕开人工验收。
  - **smoke 门禁与 marker 写入顺序**（`spec/environments.md` §5.1「写入顺序与失败补偿」、`collectSmokeData`）：**在既有门禁判定之后接一层人工判定**，复用先写账本、后写 marker 的顺序与快照恢复。
  - **测试变更集 `buildTestChangeSet`**（change-lint L4、merge、verify 共用）：它只描述单个提案，算不出「跨提案、自上次通过以来」的集合，**不复用**。改用规格行对比：同一份测试规格在「上次人工验收通过时部署的版本」与「本次部署的版本」两个 commit 之间新增或内容变化的 `[manual]` 行，即为累积的待验收用例。不部署的提案合并后，它的规格自然进入下一次部署的版本，不需要额外记账。
  - **smoke 平台跳过**（§2.48.5）：人工用例的平台限定沿用 `[manual/<平台>]`，不新增跳过原因。
- 为什么不能更小：
  - 只做 SMOKE 人工标记、不做记录：病灶 1、3 原样存在，人工用例照样没人执行。
  - 只做记录、不做待验收清单：用户只能自己记住「哪些该验」，不部署的提案里的人工用例照样会丢（病灶 4），需求 #3 第 4 条明确要求 CLI 自动计算。
  - 不保护开关字段：AI 能直接关掉开关，「只能由人记录」就落空了。
  - 不做 `next` 的「等待人工验收」状态：`--auto` 下 driver 只能看到 smoke 没通过，会派修复 agent 去修一个修不好的问题，正是 RunLogos #35 刚堵上的那类问题。
- 本提案主动砍掉的：
  - **RunLogos 的展示与逐条记录界面**：属于 RunLogos #34，openlogos 只提供 JSON 契约与命令。
  - **人工结果入库（提交到仓库）**：结果绑定本机 `deploy_id`，入库后在另一台机器上没有对应部署，绑定不成立；多人协作下的跨机共享另立需求。
  - **证据文件的内容校验**：`--evidence` 只记录路径，不做存在性以外的检查，也不复制文件；截图和日志由人负责保管。
  - **按关键词判断用例是否需要人参与**：理由与 0.16.24 一致，判断交给 test-writer 和评审。
  - **改动本仓登记表、开启人工验收**：开关默认关闭，本提案不改 `logos/environments.yaml`；要不要在 prod 打开由用户在发布前决定。
  - **撤销与修改已记录结果的命令**：账本只追加，同一用例重新记录时以最后一条为准，不需要单独的撤销命令。

## 变更类型
需求级（新增「冒烟阶段人工验收」这一用户可见能力。需要新增验收条件和新场景 S46，并贯穿以下内容：功能规格；架构；S19、S41、S05、S09 场景；环境规范、测试结果规范、guard 规范、生成指令规范与变更管理规范；test-writer、change-writer 两个 Skill；测试用例；部署方案与 smoke。不涉及 API / DB）

## 变更范围
> 与 `tasks.md` 的 `[delta]` 目标一一对应。

- 影响的需求文档：`core-01-requirements.md` 新增「冒烟阶段人工验收需求（smoke-manual-acceptance）」，验收条件从 AC-SMOKE-MANUAL-01 起。
- 影响的功能规格：`core-01-feature-specs.md` 新增 §2.107「冒烟阶段人工验收」，包括：
  - SMOKE 人工标记与读取，修复全文回退问题；
  - 登记表 `manual_acceptance` 字段；
  - 待验收清单的计算口径；
  - `openlogos accept` 记录命令；
  - smoke 门禁：自动用例为零时的空自动阶段、人工判定与 `PENDING`（账本 smoke 记录 `result=pending`，不新增提案标记）、清单无法确定与回归用例失效时不能通过；
  - 结论过期：通过后再记录人工结果即撤销通过；
  - 关闭时的报告；
  - `next` / `status` 的「等待人工验收」；
  - guard 受限与登记表保护；
  - `--auto` 硬停点；
  - JSON 契约；
  - 兼容性。
- 影响的架构：`core-01-architecture-overview.md` 新增「五十九、冒烟阶段人工验收：账本 manual 记录与待验收清单」。
- 影响的业务场景：
  - 新建 `core-S46-smoke-manual-acceptance.md`，覆盖冒烟阶段人工验收的完整场景：
    - 开启时：自动 smoke → 等待人工验收 → 人逐条记录 → 重跑 smoke 写 `SMOKE_PASS`；
    - 关闭时：只列出、不阻断；
    - 待验收清单累积；
    - 重新部署后已记录结果作废；
    - AI 调用记录命令被 guard 拦截；
    - 异常与边界；
  - `core-00-scenario-overview.md` 场景总览新增 S46 行；
  - `core-S19-smoke-gate.md` 新增「S19 SMOKE 人工标记读取与人工判定接入」：门禁顺序、自动用例为零时的空自动阶段、`PENDING` 结论只写账本并清除既有两个标记、版本通道只写账本；
  - `core-S41-environment-registry.md` 新增「人工验收字段（smoke-manual-acceptance）」：字段校验，EnvView 的 `manual_acceptance`；
  - `core-S05-next-guidance.md` 新增「等待人工验收的 next 建议」：驻留态、建议文案、`--auto` 下不自动执行；
  - `core-S09-change-management.md` 新增「S09 人工验收记录命令受限与开关字段保护」。
- 影响的 API：无（`core` 模块 `skip_phases` 含 `api`）
- 影响的 DB 表：无（`skip_phases` 含 `database`）
- 影响的编排测试：无（同上，无 API）
- 影响的方法论规范与 Skill：
  - `spec/environments.md`：新增 §15「冒烟阶段人工验收」，内容为字段、账本 `kind=manual` 记录、待验收清单、记录命令、门禁与 marker、guard；§5.2「记录字段」与 §5.4「读取」随之修改。
  - `spec/test-results.md`：「`[manual]` 标记用例」扩展到 SMOKE，删去「SMOKE 部分由 #3 交付」的过渡说明；新增「Smoke 人工用例与冒烟阶段人工验收」一节，补充人工 SMOKE 不得写结果（`manual_smoke_result_id`）与全人工项目的空自动阶段，既有「Smoke 结果与覆盖预检」原文不改。
  - `spec/pretooluse-guard.md`：受限命令清单新增 `openlogos accept`；「已配置门禁的登记表」的识别字段新增 `manual_acceptance`。
  - `spec/agents-md.md` 与 `spec/change-management.md`：硬红线新增「等待人工验收」，任何模式、含 `--auto`，AI 都不得代记结果、不得修改开关字段。
  - `spec/cli-json-output.md`：`smoke` JSON 新增 `manual_acceptance` 对象，`gate.result` 新增 `PENDING`；新增 `accept` JSON；`env show` / `env list` 新增 `manual_acceptance`。
  - `skills/test-writer/SKILL.md`：SMOKE 可以标 `[manual]`，判据与 UT/ST 相同；人工 SMOKE 不写 runner；回归用例由人在登记表中指定。
  - `skills/change-writer/SKILL.md`：「验收标准 → 需要人参与的验收」改为写出人工用例 ID 与执行环境，删去「#3 落地前」的过渡说明。
- 影响的测试规格：
  - 新建 `core-S46-test-cases.md`：UT-S46-01 起、ST-S46-01 起；
  - `core-S19-test-cases.md`：UT-S19-127 起、ST-S19-40 起；
  - `core-S41-test-cases.md`：UT-S41-30 起；
  - `core-S05-test-cases.md`：UT-S05-58 起；
  - `core-S09-test-cases.md`：UT-S09-493 起；
  - `core-S08-test-cases.md`：UT-S08-93 起，覆盖生成指令里的硬红线条目。
- 影响的部署方案与 smoke：
  - `core-01-deployment-plan.md` 新增「OpenLogos 0.16.25 本机测试环境发布（smoke-manual-acceptance）」；
  - `core-smoke-test-cases.md` 新增安装态 smoke，SMOKE-core-342 起。
- 影响的代码：
  - `cli/src/lib/smoke-coverage.ts`：首格读法容忍 manual 标记；人工行计入「表格行存在」，不触发全文回退，也不计入自动用例集合；单独输出人工 SMOKE 集合。
  - `cli/src/lib/environments.ts`：`manual_acceptance` 字段校验；账本 `kind=manual` 的写入、校验与流式读取；EnvView 新字段。
  - 新建 `cli/src/lib/manual-acceptance.ts`：在两个 commit 之间对比测试规格行，计算待验收清单。
  - 新建 `cli/src/commands/accept.ts`，并在 `cli/src/index.ts` 注册。
  - `cli/src/commands/smoke.ts`：自动用例为零时的空自动阶段；接入人工判定；`PENDING` 账本记录与旧标记清除；报告与 JSON。
  - `cli/src/lib/lifecycle-gate.ts` / 晋级判定：只认未过期的通过结论；环境已开启人工验收（即使本部署没有任何人工记录），或本部署已有人工记录时，archive 在 `SMOKE_PASS` 之外按账本核对本部署自己的最近有效结论（`smoke_pass_expired`），防止并发重跑或旧部署写回的标记放行归档。
  - `next` / `status` 的派生：新增「等待人工验收」驻留态。
  - `plugin/bin/guard-check`、`plugin-cursor/hooks/runtime.cjs`：受限命令与识别字段。
  - `plugin-qoder/hooks/runtime.cjs`、`plugin-workbuddy/hooks/runtime.cjs`、`plugin-zcode/runtime/hook-runtime.js`：在生命周期与安全命令的提前放行之前，对含 `openlogos accept` 的命令一律拒绝（评审 delta-r1 F3）。
  - `cli/src/commands/init.ts`：生成指令的硬红线条目，中英各一份。
  - `spec/schema/status.schema.json`（EnvView、`last_smoke.result`）与 `spec/schema/next.schema.json`（驻留态）。
  - 升版 0.16.25、CHANGELOG、安装态 smoke runner。

## 部署影响
- 是否需要部署：是
- 部署原因：smoke、env、新命令 `accept`、next / status、guard 与生成指令都是 CLI 和插件的产品代码，只有装进本机全局 CLI，下游项目和 RunLogos #34 才能用上。登记表配置了 `proposal_default_env: test`。升版到 0.16.25，用来区分新旧安装态。
- 影响环境：`test`（登记表 `proposal_default_env`，即本机 npm 全局安装态）；不 npm publish、不打 tag、不 push
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」：脚本失败时自动回装回滚制品；成功落账后执行 `openlogos deploy --env test --rollback`，回到 test 当前版本，即提交 `aa1d9fd` 的安装态 0.16.24）
- 是否需要 smoke：是（安装态 smoke 在一次性项目中证明：SMOKE `[manual]` 行不进自动集合、不触发全文回退；开启人工验收的环境在自动用例全过后停在 `PENDING`（账本 smoke 记录 `result=pending`）；用 `openlogos accept --deploy` 记全通过后重跑写 `SMOKE_PASS`，记一条失败时写 `SMOKE_FAIL`；部署已更换时 accept 零写入；通过后再更正为失败即撤销 `SMOKE_PASS`、archive 被拒；全人工项目可进入等待；重新部署后旧结果不再计入；关闭时只列出、不阻断；不部署的提案新增的人工用例出现在下一次待验收清单中）

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
    reason: 账本只新增 kind=manual 记录类型、smoke 记录的 result 取值 pending 与可选字段 manual_passed / manual_pending，旧记录原样有效，不迁移、不改写；0.16.24 及更早的读取方把 manual 行与 pending 行计为坏行并跳过（与 0.16.5 引入 approval 时同一兼容口径），单机升级后即消失
  compatibility:
    status: none
    reason: 登记表没有 manual_acceptance 的项目，smoke 门禁结论不变，只在报告与 JSON 中多出「未执行的人工用例」计数；SMOKE 首格读法只是新增对 manual 标记的容忍，未带标记的行读法逐字不变；人工 SMOKE 写入结果判 manual_smoke_result_id，与 UT/ST 既有规则同源，此前 test-writer 禁止给 SMOKE 写 [manual]，存量项目没有这类行
  security_privacy:
    status: none
    reason: 记录命令沿用 D14 已确定的政策，「只能由人产生」的写入经宿主原生审批，与 openlogos approve 同一机制；开关字段按 §2.95.5 既有规则纳入登记表保护；不新增凭据、不读写密钥，recorder 只作展示
  public_release:
    status: none
    reason: 只部署到本机 test 环境，不 npm publish、不打 tag、不 push；公开发布另行决定
  external_commitment:
    status: none
    reason: CLI 只新增命令、诊断码、JSON 字段、gate.result 枚举值 PENDING 与 last_smoke.result 取值 pending，不删除、不改名任何既有契约；RunLogos #34 是同一用户名下的配套需求，按本提案的 JSON 实现
decisions:
  - id: C01
    category: product
    source: user
    question: 冒烟阶段的人工验收按什么规则执行、记录与累积
    choice: 按需求 #3 原文执行——按环境开关（如 test 关、prod 开）；开启时自动 smoke 跑完停在「等待人工验收」，人逐条记录通过或失败（失败必须写说明，通过时说明可选，可附截图或日志路径），全部记完且没有失败才写 SMOKE_PASS；关闭时报告列出「未执行的人工用例 N 条」、不阻断；待验收清单由 CLI 根据部署记录和人工结果自动计算，包括自上次人工验收通过以来各提案新增或修改的人工用例（不部署的提案也累积进来）和用户标为每次发布必跑的回归人工用例；人工结果绑定 deploy_id，重新部署后作废；记录命令是 guard 受限命令，做法同 openlogos approve，AI 不得代记，--auto 下是硬停点
    reason: 用户 2026-11-26 录入需求 #3（Team openlogos #3，版本 2）；2026-11-27 确认「#3 单独一个提案、#1 跟着收尾、默认关闭、4 个切片」的方案，并要求「先关联 #2，然后为 #3 创建变更提案」「开始写吧」
    scope: 本提案全部范围；RunLogos 展示与记录界面属 RunLogos #34
    rejected: 继续只在提案里用文字写人工验收事项——不检查、不累积，不部署提案里的人工用例会丢
  - id: C03
    category: deployment
    source: policy
    question: 本提案是否部署、部署到哪个环境、怎么部署、怎么回滚、以什么为 smoke 证据
    choice: 部署到 test（登记表 proposal_default_env）；部署方式为登记表 test.deploy（mode script，scripts/deploy-local.mjs），提案通道执行 openlogos deploy --env test；回滚按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」，test 的 current_ref 为 aa1d9fd（0.16.24）；smoke 证据为 scripts/run-smoke.js 经 openlogos smoke --env test 的实际运行结果
    reason: env list 的 proposal_default_env 为 test；env show test 的 environment.deploy 为 script 方式指向受保护脚本 scripts/deploy-local.mjs，current_ref 非 null，require_approval 与 promote_from 均未配置；已合并部署方案有「本机测试环境脚本部署（scripts/deploy-local.mjs）」章节；logos.config.json 的 smoke.command 为 node scripts/run-smoke.js。CLI 与插件产品代码有改动，需要装进全局才能被下游使用
    scope: "[deploy] 段、部署方案与 smoke 用例 delta、升版 0.16.25；不含 npm publish / tag / push"
    rejected: 不部署——下游项目与 RunLogos #34 用的都是全局 CLI，拿不到新能力
  - id: C02
    category: acceptance
    source: user
    depends_on: [C01]
    question: 某个环境第一次开启人工验收时，它还没有「上次人工验收通过」的记录，待验收清单从哪里算起？
    choice: 全部现有人工用例——基线 B 不存在时，P(E, D) = R 版本测试规格中全部 [manual] 用例（UT / ST / SMOKE）加 E 的有效回归用例
    reason: 用户 2026-11-27 选择「全部现有人工用例（推荐）」；该环境从未有人验过任何人工用例，算作已验过即无证据放行，首次工作量一次性
    scope: 待验收清单在基线缺失时的口径（defaults「待验收清单 P(E, D)」）；有基线后的增量口径不变
    rejected: 只算本次部署相对上一次部署的增量——开启前已存在的人工用例永远不会被要求验收
unresolved: []
defaults:
  - "SMOKE 人工标记：与 UT/ST 同一语法（首格 `SMOKE-xxx [manual]` / `[manual/<平台>]`，MANUAL_MARKER_RE）。带标记的行计入「文件存在表格用例行」，因此不触发全文回退；不计入自动 defined 集合、不要求 runner、不计 uncovered；结果文件出现人工 SMOKE ID 判 manual_smoke_result_id（门禁 FAIL）。"
  - "人工用例范围：已合并测试规格中带 [manual] 的 UT / ST / SMOKE 三类全部纳入待验收清单；verify 对 UT/ST [manual] 的排除语义逐字不变。"
  - "登记表字段：环境条目新增可选 `manual_acceptance: {enabled: <布尔>, regression: [<用例 ID>…]}`；缺省或 enabled=false 即关闭；登记表校验只检查结构与 ID 格式。regression 在已部署版本 R 的规格上逐一解析（评审 proposal-r1 F5）：开启的环境中，任一 ID 在 R 版本不存在或不是人工用例，门禁不能通过——FAIL，原因 manual_regression_unresolved，报告与 JSON 列出环境与失效 ID，直到人修正登记表或规格；这些 ID 不在 P 中，accept 也不接受。关闭的环境只出警告 manual_regression_unknown。字段不要求环境配置了 deploy，也不使环境成为 §12.1 的受门环境（不影响 deploy-done 与审批）。"
  - "开关保护：登记表任一环境写了 manual_acceptance 键，即按「已配置门禁的登记表」受 guard 保护（直接修改与删除须经宿主原生审批，无人值守阻断），识别方式与 promote_from / require_approval 相同（按字段名字面量），转义写法按 ENV_FIELD_INVALID 拒绝。"
  - "当前部署 D（评审 delta-r1 F4）：与 smoke 部署身份核对（spec/environments.md §4.2）同一身份，即 E 在账本中最近一条 deploy 记录（任意 result）；结果不是 done 时为未确认——accept 报 ACCEPT_DEPLOYMENT_UNCONFIRMED，smoke 人工阶段按 manual_scope_unresolved 处理，不退回更早的成功部署。"
  - "待验收清单 P(E, D)（环境 E、当前部署 D，D 的已确认版本为 R）：基线 B 取账本中 E 的、deploy_id 不等于 D 的部署里，最近一条未过期的人工验收通过 smoke 记录（manual_passed=true，过期规则见「结论过期」）的 ref；D 自己的通过记录不作为 D 的基线，因此通过后 P(E, D) 不变、普通用例也能更正（评审 delta-r1 F2）。P = R 版本测试规格中满足以下任一条件的人工用例：在 B 版本不存在，或在 B 版本存在但行内容不同（去掉首尾空白后逐字比较）；再并上 E 的 regression。B 不存在时（该环境从未通过人工验收）P = R 版本测试规格中全部人工用例再并上 regression（C02）。目标版本与基线的缺失分开处置（评审 proposal-r1 F2）：D 的 ref 为 null（如 CI 未回报实际部署提交），或 R 的对象在本地不可读（如浅克隆）时，不退回工作区——开启的环境门禁 FAIL，原因 manual_scope_unresolved（提示取得 R 的提交后重跑，如 git fetch --unshallow），不签发通过、不推进基线；关闭的环境只出同名警告、不列清单。B 有记录但对象不可读时按 B 不存在处理（取全部人工用例，只多验、不漏验），并出警告 manual_baseline_unavailable。工作区与 HEAD 始终只作观察信息，不参与 P 的计算。"
  - "记录命令：`openlogos accept --env <id|alias> --deploy <deploy_id> --case <ID>[,<ID>…] --result pass|fail [--note <文字>] [--evidence <路径>]… [--format json]`。--deploy 必填，取自 smoke / env show / next 给出的待验清单（清单与建议命令都携带 deploy_id）。一次可记录多条同一结果；--result fail 必须带非空 --note（否则报 ACCEPT_NOTE_REQUIRED）。前置条件依次为：登记表存在且合法；环境开启了人工验收（否则报 ACCEPT_NOT_ENABLED）；环境有成功的当前部署（否则报 ACCEPT_NO_DEPLOYMENT）。随后在追加所用的同一把账本锁内重读账本（评审 proposal-r1 F1）：--deploy 不等于 E 当前部署的 deploy_id 时报 ACCEPT_DEPLOY_CHANGED，即使两次部署是同一提交也一样；任一 --case 不在 P(E, D) 中时报 ACCEPT_CASE_NOT_PENDING；两者都整批零写入。身份核对沿用 spec/environments.md §11.1 未决记录操作「给出的 deploy_id 必须等于记录的 deploy_id」的先例。核对通过后为每个用例追加一条 kind=manual 记录，字段为 deploy_id、ref、case_id、result、note、evidence、recorder（git 用户，只作展示）。同一部署同一用例重复记录时以最后一条为准。--evidence 只检查路径存在，不存在时出警告、不拒绝。"
  - "门禁顺序。自动阶段（评审 proposal-r1 F4）：存在自动用例时按既有规则判定，缺结果仍报 NO_SMOKE_RESULTS；自动用例数为零但存在人工用例时，自动阶段视为空通过——不要求 runner 与结果文件，不报 NO_SMOKE_RESULTS / NO_SMOKE_CASES（配置了 smoke.command 时照常运行）；NO_SMOKE_CASES 只在既没有自动用例也没有人工用例时报出。全人工项目的 smoke 记录没有结果行，env_evidence 为 missing、verified=false，不能作为晋级依据，需要晋级的项目须至少有一条自动 smoke 用例。人工阶段（开启时，自动阶段 PASS 后）按以下顺序取第一条成立的：清单无法确定 → FAIL manual_scope_unresolved；回归用例失效 → FAIL manual_regression_unresolved；P 中任一用例在 D 上的最后结果为 fail → FAIL manual_cases_failed；P 全部为 pass（含 P 为空）→ PASS，smoke 记录带 manual_passed=true；其余（有未记录的用例）→ gate.result=PENDING，原因 manual_acceptance_pending。FAIL / PASS 的账本与标记写入照旧。人工阶段的结论在账本锁内复核后才落账（评审 proposal-r2 F3）：smoke 取得账本锁后、追加 smoke 记录前，重读该部署的 manual 记录并重新判定人工阶段，锁外判定只用于提前报告，与 §12.5 审批锁内复核同一做法；因此账本中任何 PASS 记录之前的 manual 记录都已被它采纳。PENDING 同样是一次门禁结论（评审 proposal-r1 F6）：账本追加 smoke 记录，result=pending、verified=false，带 deploy_id 与 manual_pending——即在同一次锁内读取时 P 中仍无该部署记录的用例 ID（评审 proposal-r2 F6），已记录过的用例不再列入；提案通道清除旧的 SMOKE_PASS / SMOKE_FAIL（沿用 §5.1 先账本后标记与快照恢复），不写新标记；版本通道只写账本（沿用无活跃提案路径）。PENDING 退出码与 FAIL 相同（1）。重跑 smoke 会重新执行自动用例，人工结果按 deploy_id 保留，不需要重新记录。"
  - "结论过期（评审 proposal-r1 F3）：一次 PASS 结论只采纳在它之前记录的人工结果。accept 为部署 D 追加任何记录后，D 上已有的 PASS 结论即过期：账本侧，一条 manual_passed=true 的 smoke 记录之后出现同一环境、同一 deploy_id 的 manual 记录时，它不再作为人工验收基线，也不再作为晋级依据（§12.3 晋级判定与晋级候选只认未过期的 verified 记录）；提案通道侧，活跃提案 DEPLOY_DONE 的 deploy_id 等于 D 时，accept 在追加账本后删除 SMOKE_PASS（先账本后标记，标记删除失败时撤销本次账本行并以错误结束）。标记只是投影，交错执行时可能被并发重跑写回（评审 proposal-r2 F3），所以 archive 以账本为准再核对一次：DEPLOY_DONE 的环境开启了人工验收（即使该部署没有 manual 记录，评审 delta-r1 F1），或账本中存在该部署的 manual 记录时，除 SMOKE_PASS 外还要求该部署自己的最近一条 smoke 记录为 pass（开启时还须 manual_passed=true）且其后没有同一部署的 manual 记录，其他部署的记录不算，否则以 ARCHIVE_SMOKE_NOT_PASSED 拒绝（details.reason=smoke_pass_expired）；next / status 同样把这种情况派生为需要重跑 smoke，而不是可归档。环境未开启人工验收且该部署没有 manual 记录时 archive 判据逐字不变。验收覆盖顺序执行「通过 → 更正为失败 → 直接 archive 被拒」，以及交错执行「重跑暂停在 PASS 账本追加后 → 失败更正完成 → 重跑恢复写回 SMOKE_PASS → 直接 archive 被拒」。"
  - "关闭时：报告与 JSON 列出「未执行的人工用例」，即 R 版本相对 E 上一次部署版本（previous_ref）新增或修改的人工用例，再加 regression；门禁结论不变。它们会累积到开启环境的 P 中，不需要另外记账。没有登记表的项目按关闭处理。"
  - "等待状态只保存在账本，不新增提案标记（评审 proposal-r1 F6）：next / status / env show 以「环境 + 当前 deploy_id」匹配该环境最近一条 smoke 记录，result=pending 即为等待人工验收；剩余清单 = 该记录的 manual_pending（写入时仍无记录的用例）减去该记录之后同一部署 manual 记录覆盖的用例，只读账本、不读 git；由于 manual_pending 已扣除写入前的记录，多次重跑仍等待时不会把已记录的用例重新列为待验（评审 proposal-r2 F6）。提案通道（活跃提案已部署、无 SMOKE_PASS / SMOKE_FAIL，DEPLOY_DONE 的环境与 deploy_id 对应的最近 smoke 记录为 pending）驻留态为 awaiting-manual-acceptance（标签「等待人工验收」）：剩余非空时列出剩余用例与 `openlogos accept --env <E> --deploy <deploy_id> --case …` 原文，注明需要人执行，auto_execute=false，--auto 不放行；剩余为空时建议重跑 `openlogos smoke --env <E>`，--auto 下 driver 可重新驱动。版本通道在 env show / status 的环境视图中给出同样的剩余清单，重启后两个通道都能恢复。"
  - "JSON：smoke 新增 data.manual_acceptance = {enabled, deploy_id, baseline_ref, pending[], passed[], failed[{id, note}], remaining[], regression_unresolved[], unexecuted[]（关闭时）, warnings[]}；gate.result 新增 PENDING；accept 输出 {environment, deploy_id, recorded[{case_id, result}], remaining[], expired_pass（是否使已有通过结论过期）}；env show / env list 的 EnvView 新增 manual_acceptance = {enabled, regression, waiting: {deploy_id, remaining[]} | null}（只在配置了该字段的环境上出现）；last_smoke.result 可为 pending。"
  - "新增测试编号：UT-S46-01、ST-S46-01、UT-S19-127、ST-S19-40、UT-S41-30、UT-S05-58、UT-S09-493、UT-S08-93、SMOKE-core-342 起；需求 AC-SMOKE-MANUAL-01 起；功能规格 §2.107；架构「五十九」；新场景 S46（scenario_counter.next_id 46 → 47，在 merge 时更新）。具体条数在 delta 中定稿。"
  - "本次不新增长期 DXX 决策记录：「只能由人记录」沿用 D14，规则直接写入功能规格与环境规范，读规格即可还原理由。"
```

## 验收标准
- 自动验收环境要求：无
- 平台限定用例：无。本提案新增用例如有平台限定，在测试 delta 中逐条注明。
- 需要人参与的验收：无。安装态 smoke 用一次性项目自动演练「开启 → 等待 → 记录 → 通过」的全过程。演练中的 `openlogos accept` 由 smoke runner 在一次性项目里直接调用 CLI，不经 AI 宿主，因此不触发 guard。本仓登记表不开启人工验收。

## 变更概述
**SMOKE 人工标记。** SMOKE 用例可以和 UT/ST 一样，在首格 ID 后写 `[manual]` / `[manual/<平台>]`，判据相同：换一个待验版本后，仍要人亲手做的，就是需要人参与。smoke 读取时容忍这个标记：带标记的行仍算「文件里有表格用例」，因此不再触发全文回退；这些行也不进自动用例集合，不要求 runner。runner 若为它们写了结果，判 `manual_smoke_result_id`。test-writer 与 change-writer 同步更新写法，删去「#3 落地前」的过渡说明。

**按环境开关与待验收清单。**
- 登记表的环境条目可以写 `manual_acceptance: {enabled, regression}`，缺省为关闭。只要写了这个键，登记表就按「已配置门禁的登记表」受 guard 保护。
- 环境 E 的待验收清单由 CLI 计算：以 E 上次人工验收通过时部署的版本为基线，取本次部署版本的测试规格中新增或内容有变化的 `[manual]` 行（UT / ST / SMOKE），再加上 E 的回归用例。
- 不部署的提案合并后，它的规格自然进入下一次部署的版本，所以会被自动带进清单。首次开启时没有基线，清单为全部现有人工用例加回归用例（C02）。

**记录与门禁。**
- `openlogos accept --env <E> --deploy <deploy_id> --case <ID…> --result pass|fail [--note] [--evidence]` 把结果写进本机部署账本（`kind=manual`），绑定 E 当前部署的 `deploy_id`。失败必须写说明，只能记录清单里的用例。
- 这是 guard 受限命令，做法同 `openlogos approve`：AI 调用时要经宿主原生审批，无人值守时阻断。生成指令与变更管理规范的硬红线里加上「等待人工验收」。
- 开启人工验收时，`openlogos smoke` 先按现有规则判定自动用例，全过后再判人工部分：
  - 有失败 → `SMOKE_FAIL`；
  - 全部通过 → `SMOKE_PASS`，账本 smoke 记录带 `manual_passed=true`，并成为下次的基线；
  - 清单无法确定（已部署版本未确认或不可读）或回归用例失效 → FAIL，不签发通过、不推进基线；
  - 还有未记录的用例 → `gate.result=PENDING`，账本写一条 `result=pending` 的 smoke 记录（不新增提案标记，提案通道与版本通道同一规则）。`next` / `status` 显示「等待人工验收」，并列出剩余用例和带 `--deploy` 的命令，`--auto` 不放行。
- 自动用例为零、只有人工用例的项目，自动阶段视为空通过，照样进入人工判定。
- `accept` 必须带清单给出的 `--deploy`，在账本锁内核对当前部署，部署已更换时整批零写入；通过后再记录任何人工结果，原通过结论即过期（删除 `SMOKE_PASS`，账本中不再作为基线与晋级依据），须重跑 smoke。
- 人记完后重跑 `openlogos smoke` 即可。重新部署会换一个 `deploy_id`，旧结果自然不再计入。
- 关闭人工验收时，报告列出「未执行的人工用例 N 条」，不阻断。

随后升版 0.16.25，部署到本机 test 环境，用安装态 smoke 证明新判定在全局 CLI 中生效。RunLogos 侧的停机展示与逐条记录界面由 RunLogos #34 按本提案的 JSON 契约实现。
