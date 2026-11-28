## MODIFIED — ③ 验收与部署门禁
用可追溯的验收报告与部署 / smoke 门禁守住交付质量（回应 P01/P03/P05）。

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S13 | 运行测试验收并生成报告 | 代码实现完成后 | P01/P03 | P0 |
| S19 | 执行部署后 smoke 门禁 | 已部署到目标环境后 | P01/P03 | P0 |
| S21 | 标记部署完成 | 外部部署已成功，需要推进提案状态 | P03/P05 | P0 |
| S41 | 环境登记与查询 | 项目需要登记研发环境（测试 / 预发 / 生产等）、按环境标记部署与 smoke，或查询「某环境当前跑的是哪个版本」时 | P03/P05/P07 | P1 |
| S42 | 按环境执行部署与回滚 | 需要把某个版本真正部署到登记过的环境（脚本、CI 或 AI 执行）、按版本发布或回滚时 | P01/P05/P07 | P1 |
| S43 | 环境晋级与部署审批 | 需要让某个环境只接收已在上游环境验证过的版本，或要求有人批准后才能部署到该环境（含 `--auto` 下的硬停点）时 | P01/P05/P06 | P1 |
| S46 | 冒烟阶段人工验收 | 项目有需要人参与的用例（`[manual]` 的 UT / ST / SMOKE），需要在某个环境的部署后冒烟验收中由人逐条执行并记录结果，或需要知道还有哪些人工用例没验时 | P01/P03/P06 | P1 |

## ADDED — 冒烟阶段人工验收需求（smoke-manual-acceptance）

> 来源变更：smoke-manual-acceptance（Team 需求池 openlogos #3，收尾总需求 #1；决策 C01、C02、C03；评审 proposal-r1 F1～F6、proposal-r2 F3/F6 处置）。规则权威见功能规格 §2.107、`spec/environments.md` §15、`spec/test-results.md`「`[manual]` 标记用例」、`spec/pretooluse-guard.md`、`spec/cli-json-output.md`。配套需求：RunLogos #34（driver 停机展示待验收用例并提供逐条记录界面）。前置能力：verify-self-sufficient-cases（0.16.24，UT/ST 按「是否需要人参与」分类）。

### 场景定义

- **触发条件**：0.16.24 起，需要人参与的 UT/ST 标 `[manual]` 后不进 verify，但没有任何环节要求执行它们、记录结果；SMOKE 没有人工标记；提案「验收标准」里写的人工事项只是文字；不部署的提案里新增的人工用例，没有机制带到下一次发布时验收。
- **用户价值**：每个人工用例都有确定的执行环境与记录；是否要在某个环境上做人工验收由用户按环境决定；需要验什么由 CLI 自动算出，不靠人记；验收结果只能由人产生，`--auto` 不能代替人。
- **优先级**：P1
- **主路径**：
  1. test-writer 给需要人参与的 UT / ST / SMOKE 标 `[manual]`；用户在登记表中为环境开启人工验收，并可指定每次发布必跑的回归人工用例。
  2. 部署到开启人工验收的环境后，`openlogos smoke` 先跑自动用例；自动部分通过后，算出该环境的待验收清单，停在「等待人工验收」。
  3. 人逐条执行清单中的用例，用 `openlogos accept` 记录通过或失败（失败必须写说明，可附截图或日志路径）。
  4. 全部记录且没有失败后重跑 `openlogos smoke`，写 `SMOKE_PASS`；这次部署的版本成为该环境下次计算清单的基线。
  5. 部署到关闭人工验收的环境时，smoke 只列出「未执行的人工用例 N 条」，不阻断；这些用例累积到下一次开启人工验收的环境。

### 规则

- **人工用例**：已合并测试规格中首格带 `[manual]` / `[manual/<平台>]` 的 UT、ST、SMOKE。SMOKE 的判据与 UT/ST 相同：换一个待验版本后仍要人亲手做的，就是需要人参与。人工 SMOKE 不要求 runner，也不得写入 smoke 结果。
- **按环境开关**：登记表环境条目的 `manual_acceptance.enabled` 决定该环境的冒烟验收是否执行人工用例，缺省为关闭；`manual_acceptance.regression` 列出每次发布必跑的回归人工用例。写了 `manual_acceptance` 的登记表只能由人修改。
- **待验收清单**：以该环境上次人工验收通过时部署的版本为基线，取本次部署版本中新增或内容有变化的人工用例，再加上回归用例。不部署的提案合并后自然进入下一次部署的版本，因此会被带进清单。该环境从未通过人工验收时，清单为全部现有人工用例加回归用例（C02）。本次部署的版本无法确认或在本地读不到时，开启人工验收的环境不能通过，也不推进基线。
- **结果绑定部署**：每条人工结果绑定该环境当前部署的 `deploy_id`；重新部署后旧结果不再计入。记录时必须给出待验清单上的 `deploy_id`，部署已更换时整批不写。
- **只能由人记录**：`openlogos accept` 是 guard 受限命令，与部署审批命令同一机制；AI 不得代记，`--auto` 下「等待人工验收」是硬停点。
- **结论可撤销**：通过后又记录了人工结果（例如把某条更正为失败），原通过结论即失效，必须重跑 smoke，归档也会被拒。

### 验收条件

#### AC-SMOKE-MANUAL-01：SMOKE 人工标记不进自动集合
- **GIVEN** smoke 规格中有 `| SMOKE-core-901 [manual] | … |` 一行，同一文件还有一条自动用例，或整份文件只有这一条人工用例
- **WHEN** 执行 `openlogos smoke`
- **THEN** SMOKE-core-901 不计入自动 defined 集合，不要求 runner，不计 uncovered；整份文件只有人工行时也不触发全文回退扫描；结果文件中出现 SMOKE-core-901 时门禁 FAIL，诊断 `manual_smoke_result_id`

#### AC-SMOKE-MANUAL-02：开启环境在自动部分通过后等待人工验收
- **GIVEN** 环境 `prod` 的 `manual_acceptance.enabled` 为 true，本次部署 D 的清单含 ST-S01-05、SMOKE-core-901，自动用例全部通过
- **WHEN** 执行 `openlogos smoke --env prod`
- **THEN** `gate.result` 为 `PENDING`，原因 `manual_acceptance_pending`；账本追加一条 `result=pending` 的 smoke 记录，列出两条待验用例与 D 的 `deploy_id`；不写 `SMOKE_PASS`，旧的 `SMOKE_PASS` / `SMOKE_FAIL` 被清除；`next` 显示「等待人工验收」与带 `--deploy` 的 `openlogos accept` 命令原文

#### AC-SMOKE-MANUAL-03：全部通过后重跑写通过
- **GIVEN** AC-SMOKE-MANUAL-02 的状态下，人用 `openlogos accept --env prod --deploy <D> --case ST-S01-05,SMOKE-core-901 --result pass` 记录
- **WHEN** 重跑 `openlogos smoke --env prod`
- **THEN** 写 `SMOKE_PASS`，账本 smoke 记录带 `manual_passed=true`；下次部署计算清单时以 D 的版本为基线

#### AC-SMOKE-MANUAL-04：人工用例失败即门禁失败
- **GIVEN** 清单中一条用例记录为 `fail` 并写了说明
- **WHEN** 执行 `openlogos smoke --env prod`
- **THEN** 门禁 FAIL，原因 `manual_cases_failed`，报告列出该用例与说明；`openlogos accept --result fail` 未带 `--note` 时报 `ACCEPT_NOTE_REQUIRED`、不写入

#### AC-SMOKE-MANUAL-05：只能记录清单中的用例与当前部署
- **GIVEN** 环境 `prod` 当前部署为 D2，人手上是 D1 的清单
- **WHEN** 执行 `openlogos accept --env prod --deploy <D1> --case X --result pass`，或 `--case` 中含不在清单里的 ID
- **THEN** 分别报 `ACCEPT_DEPLOY_CHANGED`（即使 D1、D2 部署的是同一提交）或 `ACCEPT_CASE_NOT_PENDING`，整批零写入；D2 结果未知（`unknown`）时，用 D1 的清单记录同样被拒（`ACCEPT_DEPLOY_CHANGED`），用 D2 记录报 `ACCEPT_DEPLOYMENT_UNCONFIRMED`，D2 对账确认为成功后才接受 D2 的清单

#### AC-SMOKE-MANUAL-06：重新部署后旧结果作废
- **GIVEN** D1 上已记录 X 通过，随后重新部署为 D2，X 仍在 D2 的清单中
- **WHEN** 执行 `openlogos smoke --env prod`
- **THEN** X 列为待验，D1 上的记录不计入

#### AC-SMOKE-MANUAL-07：关闭环境只列出、不阻断
- **GIVEN** 环境 `test` 未开启人工验收，本次部署相对上一次部署新增一条人工用例
- **WHEN** 执行 `openlogos smoke --env test`
- **THEN** 门禁结论只由自动用例决定；报告与 JSON 列出「未执行的人工用例 1 条」

#### AC-SMOKE-MANUAL-08：不部署提案的人工用例被累积
- **GIVEN** 提案 A 新增人工用例 X 后归档但没有部署；随后提案 B 部署到开启人工验收的 `prod`，`prod` 上次人工验收通过时的版本不含 X
- **WHEN** 执行 `openlogos smoke --env prod`
- **THEN** 待验收清单含 X

#### AC-SMOKE-MANUAL-09：首次开启取全部现有人工用例
- **GIVEN** 环境 `prod` 从未通过人工验收，当前规格中有 3 条人工用例
- **WHEN** 首次在 `prod` 执行 `openlogos smoke --env prod`
- **THEN** 待验收清单为这 3 条加有效的回归用例

#### AC-SMOKE-MANUAL-10：清单无法确定或回归用例失效时不能通过
- **GIVEN** 开启人工验收的环境，本次部署的版本为 null 或本地读不到；或回归清单中有一个 ID 在已部署版本中不存在
- **WHEN** 执行 `openlogos smoke --env prod`
- **THEN** 分别以 `manual_scope_unresolved`、`manual_regression_unresolved` 判 FAIL，不写 `SMOKE_PASS`，不推进基线；不会退回读取工作区规格；关闭的环境只出警告

#### AC-SMOKE-MANUAL-11：通过后再记录即撤销通过
- **GIVEN** D 已通过人工验收并写了 `SMOKE_PASS`
- **WHEN** 人把其中一条（回归用例或普通用例）更正为失败后直接执行 `openlogos archive`；或另一次 smoke 重跑在更正之后写回了 `SMOKE_PASS`；或提案重新部署为 D2 后，D 的 smoke 才写回 `SMOKE_PASS`
- **THEN** 更正被接受（D 自己的通过不作为 D 的基线，清单不变）；三种情况 archive 都以 `ARCHIVE_SMOKE_NOT_PASSED` 拒绝（`smoke_pass_expired`），D2 须自己完成 smoke 才可归档；该通过记录也不再作为基线与晋级依据

#### AC-SMOKE-MANUAL-12：只有人工用例的项目也能完成人工验收
- **GIVEN** 项目只有一条人工 SMOKE，没有 runner、没有结果文件，环境开启人工验收
- **WHEN** 执行 `openlogos smoke --env prod`、记录结果后重跑
- **THEN** 依次得到 `PENDING` 与 `SMOKE_PASS`，不报 `NO_SMOKE_RESULTS` / `NO_SMOKE_CASES`

#### AC-SMOKE-MANUAL-13：AI 不能代记，`--auto` 不放行
- **GIVEN** AI 代理在会话中执行 `openlogos accept …`（任何参数形态）
- **WHEN** guard 拦截该调用
- **THEN** Claude Code 的 `default` / `acceptEdits` 模式由宿主弹出原生审批；其他模式、非交互与复合命令一律阻断；qoder / workbuddy / zcode 在任何生命周期（含 initial）下一律拒绝；`next --auto` 遇「等待人工验收」且清单仍有未记录用例时不自动放行

#### AC-SMOKE-MANUAL-14：等待状态可从账本恢复
- **GIVEN** 清单为 A、B；记录 A 后重跑 smoke 仍等待 B，再记录 B；有、无活跃提案两种情况
- **WHEN** 重启后执行 `openlogos next` / `openlogos env show prod`
- **THEN** 剩余清单为空，提示重跑 smoke；不会把 A 重新列为待验

### 非目标

- RunLogos 的停机展示与逐条记录界面（RunLogos #34），openlogos 只提供 JSON 契约与命令。
- 人工结果入库或跨机器共享：结果绑定本机账本中的 `deploy_id`。
- 证据文件的内容校验：`--evidence` 只记录路径。
- 按关键词判断用例是否需要人参与。
- 撤销记录的专用命令：同一用例重新记录以最后一条为准。

### 追溯

- 功能规格：§2.107。架构：「五十九、冒烟阶段人工验收：账本 manual 记录与待验收清单」。
- 场景：`core-S46-smoke-manual-acceptance.md`（新增）、`core-S19-smoke-gate.md`「S19 SMOKE 人工标记读取与人工判定接入」、`core-S41-environment-registry.md`「人工验收字段（smoke-manual-acceptance）」、`core-S05-next-guidance.md`「等待人工验收的 next 建议」、`core-S09-change-management.md`「S09 人工验收记录命令受限与开关字段保护」。
- 规范与 Skill：`spec/environments.md` §15、`spec/test-results.md`、`spec/pretooluse-guard.md`、`spec/agents-md.md`、`spec/change-management.md`、`spec/cli-json-output.md`、`skills/test-writer/SKILL.md` 3c、`skills/change-writer/SKILL.md`「验收标准」段。
- 测试：`core-S46-test-cases.md`（UT-S46-01 起、ST-S46-01 起）、`core-S19-test-cases.md`（UT-S19-127 起、ST-S19-40 起）、`core-S41-test-cases.md`（UT-S41-30 起）、`core-S05-test-cases.md`（UT-S05-58 起）、`core-S09-test-cases.md`（UT-S09-493 起）、`core-S08-test-cases.md`（UT-S08-93 起）；安装态 smoke：`core-smoke-test-cases.md`（SMOKE-core-342 起）。
