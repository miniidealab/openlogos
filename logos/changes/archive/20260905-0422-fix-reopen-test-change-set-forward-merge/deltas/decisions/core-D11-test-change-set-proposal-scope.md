## ADDED — D11：test change set 是提案级累计事实，前滚仅在核心 writer 内、归档对消费者 audit-only

- **状态**：accepted
- **日期**：2026-09-05
- **来源**：提案 `fix-reopen-test-change-set-forward-merge`；bug report `logos/resources/reference/openlogos-merge-reopen-empty-test-change-set-bug-report.md`（cursor-adapter-parity 0.14.17 现场，曾为 GitHub issue #20）

## 背景

0.14.x 的 `SPEC_MERGED.test_change_set` 由当前事务的语义 before/after diff 计算。completed 事务经受控 reopen 重合并时，幂等重放目标贡献零变化——首轮引入的测试 ID 从 changed 系统性丢失；而「归档事务/receipt audit-only、禁作 fallback 真相源」契约（正确地）堵死了消费者自行补齐的通道。提案级测试变化事实自此既丢失又无合法恢复路径：切片被迫单切、owned 维度失真、删后续证伪门无法成立。

## 决策

1. **提案级语义（不变量）**：`SPEC_MERGED.test_change_set` 表达「本提案引入/修改/删除了哪些测试 ID」，覆盖全部 reopen 重合并轮次；schema `openlogos/test-change-set@1` 不变。
2. **前滚仅在核心 writer 内（不变量）**：存在 reopen 留痕时，由 seal/apply 共用构建点按重开时序前滚合并归档 receipt（changed 前滚并集、removed 后写胜出，targets/hash 保持当前快照、sha256 重算）；祖先身份失配 fail-closed。
3. **归档对消费者保持 audit-only（不变量）**：前滚是核心 apply 路径的受控读取，不开放任何消费者归档通道；消费者仍只认当前 marker。

## 理由

提案级 change set 是切片契约（owned⊆changed、按归属豁免、删后续门）的地基——地基表达错了口径，上层每个消费者都会被迫各自绕路（单切、runner_selectors 侧载），审计价值随之失真。前滚放在唯一 writer 内部，单一权威与 audit-only 两条既有契约都不破，且 sealed preflight 与最终 marker 天然同源。

## 备选方案

- **消费者自行并集归档 receipt**：被否——打破单一权威（每个消费者成为第二裁决者）与 audit-only 契约，且各消费者实现漂移风险高。该方案将来可能被重新提出（「读归档很方便」），本记录明确其否决理由。
- **reopen 时把旧 change set 写入新事务初始状态**：被否——事务创建时尚无 delta 内容，无法与 seal/apply 的快照校验同源；且污染事务身份的确定性派生。
- **不修，永久单切 + runner_selectors 侧载**：被否——削弱切片契约与审计维度，属于把缺陷制度化。

## 影响面

- 约束 merge 事务 apply/preflight 实现与全部 change set 消费者（切片校验、slice-aware verify、slice-planner）。
- 约束后续宿主（RunLogos 等）：不得读归档 receipt 裁决测试归属。
- Authority Registry 行：`test-change-set.proposal-scope`（架构文档「四十八」）。

## 来源

- 提案：`fix-reopen-test-change-set-forward-merge`
- 关联：D10（merge 前沿事务事实）、`spec/test-slice-manifest.md`、`spec/change-management.md` reopen 段
