## ADDED — Authority Closure plan 前沿派生

## Authority Closure plan 前沿派生

### 拓扑不变

不新增 flow node/subflow/gate/marker。Authority Closure 作为 write-proposal 的产物和 PlanPackageEvaluator 的子结果，进入现有 `proposal_filled` / plan-exit 判据。

### 派生规则

对新或仍 writing 的 proposal：

```text
proposal_filled = existing_plan_requirements
  AND authority_closure_evaluation.pass
  AND authority_closure_evaluation.unresolved == 0
```

evaluation 由唯一 AuthorityClosureEvaluator 提供。flow-derive、status 与 next 不解析 `authority_impact`，不按区块存在性、关键词或 issue message 重算 pass。

失败时前沿保持 write-proposal/plan 未完成，并透出共享 completion issues；不得写 `PLAN_APPROVED`。通过时按既有 clarification、baseline/UI/tasks 等其余条件继续求值，Authority Closure 通过不短路其它门。

### 历史与自动化

已越过 plan 的历史 proposal 保持当前前沿。`next --auto` 只能在全量 Plan Package ready 时消费 plan-exit；Authority Closure failure 不可由 auto 跳过。历史 `GATE_AUTO_PASSED` 不构成 authority 方案授权。

### 同源不变量

同一 proposal/tasks/effective view 下，change-lint、status、next、flow 的 authority summary/issues 等价。任何消费者本地 fallback 都是 shadow authority，按本规范自身 fail closed。
