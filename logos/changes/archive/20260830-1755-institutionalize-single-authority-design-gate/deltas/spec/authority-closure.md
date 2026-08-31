## ADDED — Authority Closure 业务事实权威闭包规范

# Authority Closure 业务事实权威闭包规范

## 1. 目的

本规范用于防止同一业务事实、完成谓词或状态转换被多个组件独立裁决。它约束语义所有权，不限制物理副本数量。缓存、索引、marker、receipt、事件日志、读模型和备份均可存在，但必须是可验证、可重建且不可反向裁决的投影。

## 2. 规范关键词

“必须”“禁止”“不得”表示强制要求；“应”表示除非有证据化例外；“可以”表示兼容选择。`Authority Closure` 与 `baseline_closure` 是两个正交合同：前者回答“谁裁决事实”，后者回答“本次变更需要哪些规格目标”。

## 3. 术语

- **business fact**：能影响业务动作、完成状态、恢复或外部可观察结果的事实。
- **authority**：对某 fact 有最终裁决权的语义来源。
- **canonical state**：authority 用于作出裁决的状态载体。
- **sole writer**：唯一可直接改变 canonical state 的组件。
- **mutation entry**：所有变更必须经过的 command/API/事务入口。
- **decision API**：消费者获得允许/完成/下一动作等结论的同源入口。
- **projection**：由 authority 单向派生的 cache/index/marker/receipt/view/副本。
- **freshness proof**：将 projection 绑定到 authority generation/version/hash/receipt 的证明。
- **shadow authority**：能独立改变或裁决同一 fact 的未授权副本、parser、状态机或 fallback。
- **cutover**：writer/authority ownership 的有限迁移过程。

## 4. AC-01～AC-08

1. **AC-01 唯一语义权威**：每个 `fact_id` 恰有一个 authority owner 与 canonical state。
2. **AC-02 单一受控写入口**：恰有一个 sole writer；写入只经 mutation entry。
3. **AC-03 投影血缘**：每个 projection 声明来源、消费者、生成方向和只读边界。
4. **AC-04 新鲜度证明**：projection 必须校验权威 identity；mtime/存在性/扫描顺序不能单独证明新鲜。
5. **AC-05 决策同源**：同一结论的消费者调用 decision API/共享 evaluator，不复制谓词或状态机。
6. **AC-06 恢复同源**：响应丢失、重启、残留文件时只从 authority/receipt 恢复；projection 可丢弃重建。
7. **AC-07 有限切换**：迁移明确停止旧 writer、启用新入口、重建/校验投影、rollback boundary 和 exit evidence。
8. **AC-08 可证伪验收**：测试和审查必须尝试用冲突旧副本、滞后、并发、重启、回滚和反向推断推翻闭包。

## 5. Authority Registry

项目架构为适用 fact 维护唯一 Registry。每行固定包含：

```yaml
- fact_id: <stable.business.fact>
  semantic_scope: <该事实回答的问题>
  authority_owner: <组件>
  canonical_state: <载体>
  sole_writer: <组件>
  mutation_entry: <command/API/transaction>
  decision_api: <查询/动作入口>
  projections:
    - id: <projection>
      consumer: <consumer>
      freshness_proof: <generation/version/hash/receipt>
      rebuild_rule: <如何由 authority 重建>
      writable: false
  recovery_source: <authority/receipt>
  forbidden_shadow_sources: [<旧副本/扫描/本地谓词>]
  cutover_exit: <可验证完成证据>
```

Registry 行不得以文件名充当 semantic scope，也不得把多个互相独立 writer 写成“共同 owner”。同一 `fact_id` 的变更必须修改原行，不新增后缀 fact 规避冲突。

## 6. 适用性

proposal 满足任一条件时 `applicability: required`：跨边界共享 fact/完成谓词；新增或修改 projection；变更 owner/writer/mutation/recovery/cutover；存在消费者本地重算风险。

`not_applicable` 仅用于不改变事实归属的纯文案、纯视觉或局部机械实现，且必须含非空、可查询 evidence。未知、证据冲突或未来才决定时不能声明不适用，必须保留 unresolved 并阻断 plan。

## 7. openlogos/authority-impact@1

proposal 中只能有一个围栏外 YAML 根：

```yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [derived_projection]
  facts:
    - fact_id: example.fact
      change: create
      authority_ref: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md#authority-registry
      projections: [status]
      retired_shadow_sources: [status-local-parser]
      forbidden_fallbacks: [scan-marker-existence]
      cutover:
        old_writer_stop: <证据>
        new_writer_start: <证据>
        rollback_boundary: <边界>
        exit_evidence: <完成证据>
      tests: [UT-SXX-01, ST-SXX-01]
  unresolved: []
```

若当前 change 同时创建 authority target，`authority_ref` 可以指向当前唯一 Delta 映射后的 canonical target。required 分支必须有非空 facts；每个 fact_id 唯一；test ID 必须存在于 effective test view。not_applicable 分支必须有 `evidence[]`，不得含 facts/cutover 伪数据。

## 8. Plan Package evaluator

`AuthorityClosureEvaluator` 是结构完成判据唯一实现。它严格解析 YAML、解析 Registry/当前 CREATE target 引用、验证字段和测试 ID，返回不可变 evaluation：

```ts
interface AuthorityClosureEvaluation {
  schema: 'openlogos/authority-closure-evaluation@1';
  applicability: 'required' | 'not_applicable';
  facts_total: number;
  facts_closed: number;
  projections: number;
  retired_shadow_sources: number;
  unresolved: number;
  pass: boolean;
  issues: AuthorityClosureIssue[];
}
```

change-lint、status、next、flow 与 merge precheck 只能消费该 evaluation。不得以相同代码复制一份 evaluator，也不得在 JSON serializer 中补算 pass。

## 9. violation 合同

闭合枚举：

- `authority_impact_declaration_missing`
- `authority_impact_malformed`
- `authority_fact_reference_missing`
- `authority_closure_incomplete`
- `authority_cutover_unclosed`

每项含 `code/path/message/fix_hint`；按 Authority Closure 检查层、path、fact 源序、code、message 稳定排序。任一 violation 使 change-lint `pass:false`、exit 2。文件不可读/YAML parser 操作失败仍走 exit 1 error envelope，不伪装为可修复 violation。

## 10. 角色职责

- architecture-designer 生产 Registry。
- change-writer 生产 authority impact 与 Delta 计划。
- scenario-architect 生产 command/query/projection/recovery 时序。
- deployment-designer 生产有限 cutover 与 rollback。
- test-writer 生产 AC-08 故障矩阵与追溯。
- code-reviewer 查找旁路写、复制判据、反向推断、heuristic recovery 和遗留 writer；AC-01～AC-07 违规为 Critical。

Skill 必须引用本规范，不得复制整份 normative 表。中英文 Skill 是同一根 Skill 的语言投影；package/plugin/cache 必须由根源生成并受 manifest/hash 校验。

## 11. 场景与消费者规则

sequence diagram 必须把 command、mutation entry、authority、projection 和 consumer 作为可辨识参与者；消息标注 `fact_id` 和 read/write/refresh/decision。两个参与者都能对同一 fact 直接 write/decide 时，场景不得交付。

消费者可以读 projection 提升性能，但必须验证 freshness，失败后读 authority 或返回明确 unavailable；禁止读取另一个未经证明的副本作为 fallback。status 页面、marker 或 receipt 不能因为“更方便读取”而变成完成状态权威。

## 12. Cutover 与回滚

顺序固定为：冻结 identity/before facts → 停止旧 writer → 启用新 mutation entry → 重建 projection → freshness 与负向探针 → exit evidence。确需短暂 dual-write 时必须有单一协调 writer、有限窗口和冲突 fail-closed；两个独立 writer 均可成功不合法。

rollback boundary 必须说明何时还能恢复旧 writer；新 authority 已产生不可逆写入后不得重新开启旧 writer，只能前滚或启用兼容 reader。部署完成不等于 cutover 完成，exit evidence 必须单独验证。

## 13. 测试与审查

每个 required fact 至少覆盖：authority happy path、stale projection、conflicting old copy、concurrent/legacy writer、response lost + restart、projection rebuild、cutover rollback，以及 forbidden reverse inference。测试代码必须包含 OpenLogos reporter。

code review 要逐项证明 mutation entry 唯一、decision evaluator 同源、projection 只读、旧 writer/旧 parser 已删除或不可达。只增加注释、feature flag 永久保留两条 writer 路径或 catch 后扫描文件，均不能关闭 Critical。

## 14. 历史兼容

新 scaffold 和仍 writing 的提案严格要求声明。存在 `PLAN_APPROVED|SPEC_MERGED|MERGED|VERIFY_PASS` 或已归档的历史提案不倒退。存量项目按后续触达 fact 增补 Registry，不全库补写猜测性历史。

## 15. 验收

- required/not_applicable 正例与五类 violation 均有 UT。
- 同一输入下 change-lint/status/next/flow evaluation 等价。
- stale/conflict/restart/cutover 真实 ST 能推翻错误实现。
- candidate 包根规范、根 Skill、插件/cache 与 evaluator manifest/hash 一致。
- merge 前 lint 通过且 Delta 目标 P=T=D；部署与 smoke 仍需各自明确授权。
