## ADDED — reopen 后 test change set 提案级前滚需求

### 用户价值

对 completed 合并事务执行受控 `reopen` 修正部分目标后，重合并写出的 `SPEC_MERGED.test_change_set` 必须仍然表达「**本提案**引入/修改/删除了哪些测试 ID」，而非「最近一次事务改了哪些」。否则幂等重放的测试目标被算作零变化，`changed_test_ids` 为空或严重缺失，切片规划被迫单切、`owned_test_ids` 维度失真，多切片方案的删后续证伪门必然无法成立（来源：`openlogos-merge-reopen-empty-test-change-set-bug-report.md`，cursor-adapter-parity 0.14.17 现场实测）。

### 前滚合并要求

1. 提案存在 reopen 留痕（`MERGE_REOPENS.jsonl`）时，重合并 apply 写出的 change set 必须由**核心受控路径**按重开时序前滚合并各归档 receipt 携带的 `test_change_set`：`changed = (prev_changed ∖ cur_removed) ∪ cur_changed`、`removed = (prev_removed ∖ cur_changed) ∪ cur_removed`。
2. `targets` 与 before/after hash 保持**当前事务**快照；`sha256` 按前滚后 payload 重算；changed/removed 保持 ASCII 排序、去重、不相交。
3. 前滚发生在 seal 与 apply 共用的唯一构建点：preflight 的 `test_change_set_sha256` 与最终 `SPEC_MERGED.test_change_set` 必须同源一致。
4. 祖先 receipt 身份（change/module/source）失配时 fail-closed 稳定码拒绝，不得静默跳过或猜测；abort 归档的事务无 receipt，天然不参与前滚。
5. 无 reopen 留痕的提案行为逐字节不变；schema `openlogos/test-change-set@1` 不变。

### 权威与消费边界

1. `SPEC_MERGED.test_change_set` 仍是唯一持久化测试变化事实；消费者（切片校验、slice-aware verify、slice-planner）只认当前 marker，**禁止**自行读取归档事务/receipt 并集裁决（归档对消费者保持 audit-only）。
2. 前滚是核心 apply writer 内部的受控读取，不构成消费者归档通道，不违反 audit-only 契约。
3. 历史已固化的 `SPEC_MERGED` 不迁移、不重写；新语义只作用于修复后发生的 apply。

### 场景验收条件

#### S09 merge 事务生命周期

- reopen → 部分幂等重合并（其余目标 before==after）后，`SPEC_MERGED.changed_test_ids` 仍包含首轮引入的全部测试 ID；多次 reopen 链式前滚同样成立。
- 祖先 receipt 身份失配 → seal/apply fail-closed，错误码稳定并给出处置；无留痕提案与 0.14.19 行为逐字节一致。

#### S32 切片规划

- reopen 重合并后的提案可正常多切片：`owned_test_ids ⊆ changed_test_ids` 校验对本提案真实新增 ID 全部通过，删后续证伪门可成立；`removed` 后写胜出语义在消费侧如实体现。

### 部署与非目标

- 修复必须随 `0.14.20` 部署到本机全局（隔离矩阵含 reopen 前滚全链与固定 `0.14.19` 空 change set 零回归对照；回滚制品固定 0.14.19 tarball）后经独立 smoke 验收。
- 非目标：不改 `openlogos/test-change-set@1` schema；不为消费者开放归档读取通道；不迁移历史 marker；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
