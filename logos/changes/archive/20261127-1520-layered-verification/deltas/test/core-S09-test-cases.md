## ADDED — S09 提案脚手架「受影响场景」段测试（layered-verification）

> 覆盖场景 `core-S09-change-management.md`「S09 提案脚手架的『受影响场景』段」（Step 1～2、EX-9J.4），功能规格 §2.109.4；需求 AC-VERIFY-TIER-05。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-504 | 脚手架生成「受影响场景」段（zh） | §2.109.4、Step 2 | 一次性 launched 项目，locale 为 zh | `openlogos change lv-zh`，读取 `proposal.md` | 「验收标准」之后、「变更概述」之前有「受影响场景」段；正文是一个 fenced YAML，含 `schema: openlogos/affected-scenarios@1`、`assessment: pending`、`shared_change: false`、`scenarios: []`；其余各段的标题、顺序与内容和引入前的脚手架一致 |
| UT-S09-505 | 脚手架生成 `Affected Scenarios` 段（en） | §2.109.4、Step 2 | 一次性 launched 项目，locale 为 en | `openlogos change lv-en`，读取 `proposal.md` | `Acceptance Criteria` 之后、`Summary` 之前有 `Affected Scenarios` 段，YAML 内容同上；其余各段与引入前一致 |
| UT-S09-506 | 该段不是必填章节 | EX-9J.4 | 承 UT-S09-504；删除该段，其余各段填写完整 | `openlogos next --format json` | `plan_state.plan_ready=true`；`PLAN_SECTION_REGISTRY` 的章节集合与引入前相同 |

### 自动化与证据要求

- 由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。不需要人参与，无平台限定。
