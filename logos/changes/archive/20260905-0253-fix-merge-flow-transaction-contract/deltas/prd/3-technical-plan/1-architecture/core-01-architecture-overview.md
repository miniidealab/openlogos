## ADDED — 四十七、merge 前沿推进判据与事务事实同源（marker 影子判据退休）

<a id="merge-frontier-transaction-fact"></a>

### 47.1 问题与边界

0.14.x 生产路径的 `openlogos merge` 唯一副作用是创建 / 推进合并事务（`MERGE_TRANSACTION.json`），但 flow 前沿的 done 裁决仍指向 0.13.x 的 `MERGE_PROMPT_GENERATED` / `MERGE_PROMPT.md`——生产路径永不产生的影子事实。这违反「判据只能有一个实现、且必须是真实产生的事实」（§四十一.4 同族），制造结构性死区。本节确立 merge 前沿事实的 authority cutover。

### 47.2 权威事实（fact: merge-frontier.generate-node-done）

| 要素 | 内容 |
|---|---|
| canonical_state | 「generate-merge-prompt 节点已完成」：活跃提案目录存在 `MERGE_TRANSACTION.json`（事务已创建 / 幂等在场 / 重建）；legacy 测试模式兼容既有 marker |
| sole_writer | `openlogos merge` 的 `createMergeTransaction()`（事务文件唯一写者，含终态归档让位重建） |
| mutation_entry | `openlogos merge <slug>` |
| decision_api | `launched.yaml` `done_when` 与 `flow-derive` step 推导——同一判据的两处声明，回归钉一致；单改任一处即缺陷 |
| projections | `proposal_step: merge-generated`、`next_node: apply-merge`、`status/next.data.merge_transaction`（活跃事务在场必挂） |
| freshness | status/next 每次调用重读事务文件与 marker，无缓存 |
| retired shadow sources | 生产语义下的 `MERGE_PROMPT_GENERATED` / `MERGE_PROMPT.md`（仅 legacy 测试模式保留，作为 done_when 兼容或项） |
| forbidden fallbacks | 宿主自行 stat 事务文件推导 step；把「exit 0 + 前沿暂不动」判为失败；生产路径写 MERGE_PROMPT marker；存量失配事务就地迁移 |

### 47.3 后置条件二分与宿主合同

`openlogos merge` 成功后置条件按情形二分（详见功能规格 §2.60.3）：no-delta 当场 `SPEC_MERGED` 前沿即进；有 delta 开事务、前沿推进 `merge-generated` 并停在 apply 前——该中间态合法，宿主以「exit 0 + 事务在盘且 phase 合法」判本跳成功。存量事务 contract/schema 失配一律 fail-closed + 稳定错误码 + abort 重开，不迁移（D10）。

### 47.4 cutover 与回退边界

- old_writer_stop：影子判据只存在于 flow 规格与 flow-derive 的死引用（生产本就无写者）；legacy 测试模式保留 marker 仅供 0.13.x 合同回归。
- new_writer_start：`done_when` 与 flow-derive 同步改认事务存在性；投影升格必挂。
- rollback_boundary：纯判据与规格文本变更、无数据迁移；回退须同时还原 `done_when`、flow-derive 与规格文本三处。
- exit_evidence：安装态 smoke 全链「merge 开事务 → submit → seal → apply → `SPEC_MERGED` → status/next step 前进」通过，且固定 0.14.18 对照复现 ready-to-merge 死区（防断言空转）。
