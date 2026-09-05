## ADDED — 2.61 reopen 后 test change set 提案级前滚合并

### 2.61.1 问题与语义升格

0.14.19 及以前，`SPEC_MERGED.test_change_set` 的 changed/removed 由**当前事务**的语义 before/after diff 计算。completed 事务经受控 `reopen` 重合并时，未被修正的目标幂等重放（before==after）贡献零变化——首轮引入的测试 ID 从 `changed_test_ids` 系统性丢失，下游 `owned ⊆ changed` 校验令任何切片都不能 own 本提案真实新增的 ID（violation `test-slice-test-id-unknown`），切片规划被迫单切。

本特性把该字段语义升格为**提案级累计事实**：「本提案引入/修改/删除了哪些测试 ID」。schema `openlogos/test-change-set@1`、消费接口与校验规则全部不变。

### 2.61.2 前滚合并规则（核心 writer 内部）

触发条件：提案目录存在 `MERGE_REOPENS.jsonl` 且其中至少一行的 `old_transaction_id` 在 `merge-transactions/` 有对应 `<id>.receipt.json`。

合并算法（按 `MERGE_REOPENS.jsonl` 行序，即重开时序，从最早的归档 receipt 依次前滚到当前事务）：

```text
初始：changed = ∅, removed = ∅
对每个事实源 t（归档 receipt 按时序在前，当前事务快照 diff 最后）：
  changed = (changed ∖ t.removed) ∪ t.changed
  removed = (removed ∖ t.changed) ∪ t.removed
```

- changed 取前滚并集，removed 后写胜出；两集合恒不相交（算法保证，落盘前仍执行既有 overlap 校验）。
- `targets` 数组与 before/after hash 保持**当前事务**快照，不合成历史 hash；`sha256` 按前滚后 payload 重算。
- 前滚实现在 seal/apply 共用的唯一构建点（`buildMergePreflight`）：sealed preflight 的 `test_change_set_sha256` 与 apply 落盘的 `SPEC_MERGED.test_change_set` 同源一致。

### 2.61.3 边界与 fail-closed

| 情形 | 行为 |
|---|---|
| 无 `MERGE_REOPENS.jsonl` | 不前滚，行为与 0.14.19 逐字节一致 |
| 留痕行指向的 receipt 不存在（如 abort 归档无 receipt） | 该行不参与前滚（abort 祖先从未产生已合并事实） |
| receipt 存在但 `test_change_set` 为 null（无测试目标） | 该祖先贡献空集，前滚继续 |
| receipt 的 change/module/source 与当前提案身份失配 | fail-closed：稳定分类 `internal_failure` 族的前滚专用错误信息，seal/apply 拒绝，不静默跳过 |
| 留痕文件或 receipt 损坏不可解析 | fail-closed 拒绝，携带损坏路径；不猜测、不降级为快照 diff |
| 历史已固化的 `SPEC_MERGED` | 不迁移、不重写；新语义只作用于修复后发生的 apply |

### 2.61.4 权威与消费边界（authority: test-change-set.proposal-scope）

- 唯一 writer 不变：merge 事务 apply（`applyBaselineClosureBatch` 原子落盘）；前滚只发生在该 writer 内部。
- 消费者（`readTestChangeSet` / `validateTestChangeSet` / 切片校验 / slice-aware verify / slice-planner）只认当前 `SPEC_MERGED.test_change_set`；**禁止**读取归档事务/receipt 并集裁决、从 delta 或 Git 推导、手改 marker、把 `runner_selectors` 当归属权威（forbidden fallbacks）。
- 归档事务与 receipt 对消费者保持 audit-only——前滚是核心路径的受控读取，非消费者通道。

### 2.61.5 验收

- UT-S09-309～312、ST-S09-118～119（前滚规则、失配 fail-closed、无留痕不变、preflight 同源、全链与链式 reopen）。
- UT-S32-69～70、ST-S32-23（前滚后 owned⊆changed 通过、removed 后写胜出、reopen 后多切片全链成立）。
- SMOKE-core-191（安装态全链 + 固定 0.14.19 对照复现空 change set，防断言空转）。
