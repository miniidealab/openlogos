## ADDED — Plan Package evaluator 驱动的 plan 谓词与 completion

### 谓词收敛

- `proposal_filled` 投影 `plan_package.proposal.filled`。
- `tasks_delta_filled` 投影 `plan_package.tasks.plan_filled`。
- `code_required` 投影 `plan_package.tasks.code_required`。
- `tasks_code_filled` 仅在 spec-complete 后投影 `plan_package.tasks.code_slices_filled`。

flow engine 不读取 Markdown 标题、模板行或 clarification YAML；旧函数只可作为 evaluator wrapper。

### plan 前沿

`plan_package.ready=false` 时 `write-proposal/write-tasks` 至少一个仍 active，`proposal_step=writing`。ready=true 且尚无 Delta/approval 时到达 `plan-exit`，`proposal_step=ready-to-delta`。更高优先级操作错误与历史 marker 规则保持现有顺序。

### dispatch completion 自描述

plan producer 节点的 resolved dispatch 可包含：

```json
{
  "completion": {
    "command": "openlogos change-lint --slug <slug> --format json",
    "expected": {
      "/data/pass": true,
      "/data/plan_package/ready": true
    },
    "expected_proposal_step": "ready-to-delta"
  }
}
```

completion 是声明，不由 OpenLogos driver 执行。宿主执行失败时可重派原 producer，但重试预算、WorkUnit 状态与用户展示属于宿主。

### 历史旁路与不变量

存在 `PLAN_APPROVED|SPEC_MERGED|MERGED|VERIFY_PASS` 时按真实后续前沿继续，模板新规则不得使已通过节点重新 active。status/next/flow 派生保持 A 被动、只读与零 marker 副作用。
