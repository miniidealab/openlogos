## ADDED — verify 自足与用例分类需求（verify-self-sufficient-cases）

> 来源变更：verify-self-sufficient-cases（Team 需求池 openlogos #2；决策 C01、C02、C03；评审 proposal-r1 F1～F5、proposal-r2 F3/F5 处置）。规则权威见功能规格 §2.106、`spec/test-results.md`「需要人参与的用例（`[manual]`）」「verify 环境要求声明、对账与预检」「verify 跳过分类」、`spec/agents-md.md`「变更管理例外文件清单与保护范围配置」。配套需求：RunLogos #35（driver 识别本节诊断码后停机展示，不进入修复循环）；后续需求：openlogos #3（发布前冒烟验收中的人工验收与 SMOKE 人工标记）。

### 场景定义

- **触发条件**：下游项目（典型为 markdown6）有大量 UT/ST 在验收沙箱里跑不了——后端要真实 MySQL、发布与钥匙环要实机，只能由人在外面跑好、再以带制品摘要的外部证据索引交回；RunLogos driver 不提供该索引，每次最终验收都要人手拼证据，任何无关改动都会让证据失效。同时，现行规则把 UT/ST 的 `skip` 计为有效通过，自动用例因环境没准备好写一行 skip 就能过门禁；提案里也看不出本次验收要求什么环境、哪些事要人做。
- **用户价值**：verify 通过即等于在干净环境里由机器真跑过，全程不需要人配合；环境缺失时直接说清缺什么，而不是一片 skip 或失败；用户批准方案时就能看到本次验收的环境要求与人工事项。
- **优先级**：P1
- **主路径**：
  1. test-writer 按「是否需要人参与」把 UT/ST 分为两类，需要人参与的标 `[manual]`，其测试代码不进入默认 verify 入口；不需要人参与的用例所需环境，列成 `env:` / `command:` / `check:` 条目。
  2. change-writer 在 proposal「验收标准」段写出这些条目（预期配置差异），merge 后的 `[code]` 任务在活跃提案内把它们写入 `logos/logos.config.json` 的 `verify.requirements`。
  3. `openlogos verify` 执行任何预跑命令前，先对账（验收标准条目都已写入配置），再预检（环境要求全部满足）；任一失败即 FAIL，不启动测试。
  4. 测试结束后，活跃提案新增或修改的 UT/ST 写了非平台 skip 即 FAIL（用例分层错误）；带平台原因的 skip 放行并单独列出；存量用例的非平台 skip 只出警告。

### 分类定义（只对 UT/ST）

- **不需要人参与**：保留预装的机器环境，换一个待验版本（新的提交或制品），移除上一版本的结果与人工证据后，verify 命令仍能自行产生适用于新版本的证据。由机器自动签发、采集或获取的证据可用于自动验收。
- **需要人参与**：执行中任何一步要人动手（看屏幕、点系统弹窗、插设备、在实机上安装签名包、输入验证码），或每个版本都要人重新准备证据（如带制品摘要的外部证据索引）。标记沿用首格 `[manual]` / `[manual/<平台>]`。
- 一次性把机器准备好（安装 Docker、JDK、编译器等）不算人参与，但必须声明为环境要求并可由机器检查。
- SMOKE 的人工标记及其读取、待验与记录规则不在本需求内，由 openlogos #3 交付。

### 验收条件

#### AC-VERIFY-SELF-01：验收标准列出的环境要求必须写入配置
- **GIVEN** 活跃提案「验收标准」的「自动验收环境要求」列出 `command:mysql-cli`，`logos/logos.config.json` 未声明该项
- **WHEN** 执行 `openlogos verify`
- **THEN** 门禁 FAIL，诊断 `acceptance_requirement_undeclared` 点名 `command:mysql-cli`；不执行任何预跑命令

#### AC-VERIFY-SELF-02：环境未就绪时不启动测试
- **GIVEN** `verify.requirements` 声明了环境变量 `DB_URL`、命令 `docker` 与检查 `db-ready`，本机缺 `DB_URL`
- **WHEN** 执行 `openlogos verify`
- **THEN** 门禁 FAIL，诊断 `verify_env_not_ready` 逐项列出缺失项（只写变量名，不写任何变量值）；不执行任何预跑命令；补齐环境后重跑即正常执行

#### AC-VERIFY-SELF-03：此前未声明要求的项目新增依赖后从正常入口生效
- **GIVEN** 一个此前从未声明环境要求的项目，提案在验收标准中写入 `command:<新依赖>`，`[code]` 任务按提案把它写入 `verify.requirements`
- **WHEN** 从正常入口执行 `openlogos verify`，分别在依赖可用与缺失两种机器上
- **THEN** verify 读到该声明；依赖可用时照常执行预跑命令，依赖缺失时报 `verify_env_not_ready` 并停止预跑

#### AC-VERIFY-SELF-04：本次改动用例的非平台 skip 判用例分层错误
- **GIVEN** 活跃提案新增 UT-S01-90，测试运行写 `{"id":"UT-S01-90","status":"skip"}`（无原因）
- **WHEN** 执行 `openlogos verify`
- **THEN** 门禁 FAIL，诊断 `case_tier_mismatch` 点名 UT-S01-90，并提示「准备好环境并声明到 verify.requirements，或改标 `[manual]`」

#### AC-VERIFY-SELF-05：平台跳过放行并单独列出
- **GIVEN** 活跃提案新增的 ST-S01-30 只在 Windows 上执行，在 macOS 上的结果为 `{"status":"skip","reason_code":"platform-unavailable","detail":"requires win32"}`
- **WHEN** 执行 `openlogos verify`
- **THEN** 不因该 skip 判 FAIL；JSON 与验收报告单独列出该平台跳过及其 `detail`；`detail` 为空或缺失时按 AC-VERIFY-SELF-04 判用例分层错误

#### AC-VERIFY-SELF-06：存量用例只警告
- **GIVEN** 存量用例（不在活跃提案测试变更集内）写了无原因的 skip；或没有活跃提案
- **WHEN** 执行 `openlogos verify`
- **THEN** 门禁结论不因这些 skip 改变；输出警告 `unclassified_skipped_cases` 并逐条列出

#### AC-VERIFY-SELF-07：人工用例不被测试入口启动
- **GIVEN** 项目有一条自动用例与一条已标 `[manual]` 的用例，后者的测试代码一旦被启动就写哨兵文件
- **WHEN** 执行普通最终 verify
- **THEN** verify 完成，自动用例有结果，哨兵文件不存在

#### AC-VERIFY-SELF-08：前置工具检查与用例适用条件同源
- **GIVEN** 本仓 ST-S13-26 只在「Linux、非 root、沙箱复用能力可用」时执行，需要 `cc`；机器为非 root Linux 且没有 `cc`
- **WHEN** 只切换沙箱复用能力后分别执行 verify
- **THEN** 复用能力不可用时预检放行、该用例写平台跳过；可用时预检报 `verify_env_not_ready`；非 Linux 机器上预检放行、该用例写平台跳过

#### AC-VERIFY-SELF-09：提案带验收标准段
- **GIVEN** 用户执行 `openlogos change <slug>`
- **WHEN** 查看生成的 proposal.md 并运行 `openlogos change-lint`
- **THEN** proposal 含「验收标准」段及三个字段：自动验收环境要求、平台限定用例、需要人参与的验收；缺段只出警告不改退出码，段在场但字段缺失、为空或环境要求条目格式非法时报违规

#### AC-VERIFY-SELF-10：生成指令与 guard 规则同口径
- **GIVEN** 用户执行 `openlogos init` 或 `openlogos sync`
- **WHEN** 查看生成的 AGENTS.md / CLAUDE.md「保护范围配置」条款
- **THEN** 条款写明 `.gitignore`、`.git/info/exclude` 与 `logos/logos.config.json` 的 `guard` 字段不得直接修改、走 `openlogos ignore|exempt`；`logos.config.json` 其他字段（如 `verify.requirements`）在已立案且属于当前提案范围时由实现任务直接修改；不再出现对整份 `logos.config.json` 的禁改文案

#### AC-VERIFY-SELF-11：零回归
- **GIVEN** 项目未声明 `verify.requirements`，活跃提案验收标准未列环境要求条目，测试变更集内没有 skip
- **WHEN** 执行 `openlogos verify` 与 `openlogos smoke`
- **THEN** verify 结论、诊断与退出码与引入前一致（新增警告除外）；smoke 的全部判定不变

#### AC-VERIFY-SELF-12：进入本机全局安装态
- **THEN** 以上行为进入本机全局安装态 0.16.24，并由安装态 smoke 证明（仓内源码修好但安装态未更新不算达成）

#### AC-VERIFY-SELF-13：拒绝不留旧放行证据，历史如实记录
- **GIVEN** 双模块项目的两个 initial 模块已有 PASS 模块验收报告，上次 verify 留下 PASS 结果账本
- **WHEN** ① 项目级环境要求缺失时执行 verify；② 环境就绪，但模块 a 的用例中有本次改动用例写了非平台 skip
- **THEN** ① 两份模块报告改写为 FAIL（写明预检原因与「本次未执行测试」），旧账本既不被截断也不计入本轮；验收历史记一条 `result_source: "none"` 的 FAIL；② 模块 a 的报告 FAIL、模块 b 的报告 PASS；受影响模块都不能再凭旧报告通过 `launch` 检查

### 非目标

- 冒烟阶段的人工验收（按环境开关、逐条记录、待验收清单）与 SMOKE 人工标记：openlogos #3。
- 过滤 verify 未声明的环境变量：沙箱照旧继承环境，只做声明 + 预检。
- 按描述关键词猜测用例是否需要人参与：判断交给 test-writer 与评审，机器只检查标记格式、平台跳过原因与配置对账。
- 存量用例一刀切：存量非平台 skip 只警告（C02）。
- 为每条用例加「执行环境」列。

### 追溯

- 功能规格：§2.106。
- 场景：`core-S13-verify-results.md`「S13 verify 自足：环境预检与跳过分类」、`core-S09-change-management.md`「S09 提案验收标准段」、`core-S35-change-lint.md`「S35 验收标准段检查」。
- 规范与 Skill：`spec/test-results.md`、`spec/agents-md.md`、`spec/logos.config.schema.json`（`verify.requirements`）、`skills/test-writer/SKILL.md` 3c、`skills/change-writer/SKILL.md`「验收标准」段。
- 测试：`core-S13-test-cases.md`（UT-S13-157～UT-S13-179、ST-S13-40～ST-S13-43）、`core-S09-test-cases.md`（UT-S09-490 起）、`core-S35-test-cases.md`（UT-S35-225 起）、`core-S08-test-cases.md`（UT-S08-90 起）；安装态 smoke：`core-smoke-test-cases.md`（SMOKE-core-338 起）。
