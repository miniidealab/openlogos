## ADDED — S09 提案验收标准段脚手架测试（verify-self-sufficient-cases）

> 覆盖场景 `core-S09-change-management.md`「S09 提案验收标准段」Step 1～2、EX-9I.1～EX-9I.2，功能规格 §2.106.8，需求 AC-VERIFY-SELF-09。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|----|--------|---------|------|---------|
| UT-S09-490 | `zh` 脚手架含「验收标准」段 | 一次性 launched 项目，`locale: "zh"` | `openlogos change vs-scaffold` 后读取 proposal.md | 「## 验收标准」位于「## 决策澄清」之后、「## 变更概述」之前，恰好一次；段内依次含「自动验收环境要求」「平台限定用例」「需要人参与的验收」三个字段，值为方括号占位提示；其余既有段与顺序不变 |
| UT-S09-491 | `en` 脚手架含 `Acceptance Criteria` 段 | 同上，`locale: "en"` | `openlogos change vs-scaffold-en` 后读取 proposal.md | 「## Acceptance Criteria」位于 Decision Clarification 之后、Summary 之前，含 `Automated verification requirements`、`Platform-limited cases`、`Human-involved acceptance` 三个字段占位 |
| UT-S09-492 | 新脚手架未填写时的 lint 与计划状态 | UT-S09-490 生成的未填写提案；另一份只把三个字段改为「无」、其余按既有规则填好的提案 | 分别执行 `change-lint --format json` 与 `next --format json` | 未填写时验收标准段的占位报 `acceptance_criteria_invalid`（与其他占位违规并列）；三个字段为「无」时该段不产生违规或警告，`plan_state.plan_ready` 只由既有 canonical 判据决定 |

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`，测试名含用例 ID；失败不得写 pass。
- 结构断言读回磁盘上的 proposal.md 解析，不以命令输出自述代替；所有临时目录在用例结束时删除。
