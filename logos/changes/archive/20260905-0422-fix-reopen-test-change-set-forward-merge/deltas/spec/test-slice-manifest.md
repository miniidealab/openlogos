## ADDED — test change set 的提案级语义与 reopen 前滚（0.14.20）

### 语义升格

`SPEC_MERGED.test_change_set` 的 `changed_test_ids` / `removed_test_ids` 语义为**提案级累计事实**：本提案（含全部 reopen 重合并轮次）引入/修改/删除了哪些测试 ID。schema 精确保持 `openlogos/test-change-set@1`，顶层键、排序、去重、不相交与 targets/hash 校验规则全部不变。

### 前滚规则（生产者侧）

提案存在 `MERGE_REOPENS.jsonl` 留痕时，merge 事务的 seal/apply 共用构建点按重开时序从最早归档 receipt 前滚到当前事务快照 diff：

```text
changed = (prev_changed ∖ cur_removed) ∪ cur_changed
removed = (prev_removed ∖ cur_changed) ∪ cur_removed
```

targets 与 before/after hash 保持当前事务快照；sha256 按前滚后 payload 重算。祖先 receipt 身份失配或留痕/receipt 损坏时 fail-closed 拒绝；abort 祖先（无 receipt）与 null change set 祖先按不参与/空集处理。无留痕提案与 0.14.19 逐字节一致。

### 消费者义务（不变，显式重申）

- `owned_test_ids ⊆ changed_test_ids` 校验、slice-aware verify 豁免与 slice-planner 的 C/R 来源全部只读当前 marker；前滚结果对消费者透明。
- 消费者在任何情形下不得读取 `merge-transactions/` 归档补齐或裁决（audit-only 契约）；change set 不可信时按既有 `test-slice-change-set-*` violation 分层阻断，不回退推导。
- `removed` 后写胜出：被后续轮次删除的 ID 不在 changed；own 该 ID 触发 `test-slice-test-id-unknown`。
