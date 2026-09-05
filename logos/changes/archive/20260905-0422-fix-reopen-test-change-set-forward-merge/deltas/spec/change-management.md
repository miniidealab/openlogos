## ADDED — reopen 重合并的 test change set 前滚合同（0.14.20）

### 前滚语义

`SPEC_MERGED.test_change_set` 表达**提案级累计事实**（本提案引入/修改/删除了哪些测试 ID），非「最近一次事务的快照 diff」。提案存在 reopen 留痕（`MERGE_REOPENS.jsonl`）时，重合并的 seal/apply 共用构建点必须按重开时序前滚合并各归档 receipt 携带的 `test_change_set`：`changed = (prev_changed ∖ cur_removed) ∪ cur_changed`、`removed = (prev_removed ∖ cur_changed) ∪ cur_removed`；`targets` 与 before/after hash 保持当前事务快照，`sha256` 重算；sealed preflight 的 `test_change_set_sha256` 与最终 marker 同源一致。

### 边界

- 留痕行无对应 receipt（abort 祖先）不参与前滚；receipt `test_change_set` 为 null 记空集。
- 祖先 receipt 身份（change/module/source）失配或留痕/receipt 损坏：fail-closed 拒绝 seal/apply，点名路径，不静默降级为快照 diff。
- 无留痕提案行为与 0.14.19 逐字节一致；schema `openlogos/test-change-set@1` 不变；历史已固化 marker 不迁移。

### 权威边界（audit-only 不破）

归档事务与 receipt 对**消费者**保持 audit-only、禁作 fallback 真相源——前滚是核心 apply writer 内部的受控读取，不构成消费者归档通道。消费者（切片校验、slice-aware verify、slice-planner）仍只认当前 `SPEC_MERGED.test_change_set`；读取归档并集裁决、从 delta 或 Git 推导、手改 marker 均属 forbidden fallback。Authority Registry 行：`test-change-set.proposal-scope`。
