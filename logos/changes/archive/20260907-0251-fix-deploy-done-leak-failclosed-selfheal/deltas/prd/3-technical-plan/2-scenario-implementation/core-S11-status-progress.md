# core-S11-status-progress delta — fix-deploy-done-leak-failclosed-selfheal

## MODIFIED — deploy-done 对 status 的影响

`openlogos status` 在活跃提案中展示部署状态时必须遵守：

- `ready-to-deploy`：显示 `[deploy]` 进度，提示部署完成后执行 `openlogos deploy-done`。
- `deploy-done`：表示 `DEPLOY_DONE` 存在且 `[deploy]` 任务全勾，但提案无需 smoke。
- `ready-to-smoke`：表示 `DEPLOY_DONE` 存在且 `[deploy]` 任务全勾，且提案需要 smoke。
- `smoke-passed` / `smoke-failed`：只能由 `openlogos smoke` 写入的 marker 推进。

状态计算仍以 `detectProposalStep()` 为单一事实源。`deploy-done` 命令只是写入状态事实，不在 status 中临时推断部署完成。

JSON 输出中 `deployment_progress.status=done` 不等价于部署完成；只有同时存在 `DEPLOY_DONE` 才能离开 `ready-to-deploy`。

### state_inconsistency 只读对账投影

上述派生在 `DEPLOY_DONE` 缺失时永远停在 `ready-to-deploy`，下游强证据（`SMOKE_PASS` 等）永不被评估。20260907 事故中，这让「部署与 smoke 都已完成、只是漏跑 `openlogos deploy-done`」的矛盾状态**沉默停滞**：宿主面板长期显示「请执行部署任务」，无任何对账线索。本节新增只读投影，让矛盾**可见**——但不改派生、不自动修复。

**触发条件（全部成立）**：活跃提案存在、`proposal_step` 派生为 `ready-to-deploy`（`DEPLOY_DONE` 缺失）、且至少一项矛盾下游证据在场：

| 证据枚举值 | 含义 |
|---|---|
| `smoke_pass_marker_present` | `SMOKE_PASS` 在场——smoke 已过却无部署完成事实 |
| `smoke_fail_marker_present` | `SMOKE_FAIL` 在场——smoke 已跑过却无部署完成事实 |
| `deploy_tasks_all_checked` | `tasks.md` 的 `[deploy]` section 已全勾却无 marker |

**挂载位置与形态**：`modules[].active_change.state_inconsistency`（legacy 单模块输出可回退顶层 `state_inconsistency`）：

```jsonc
{
  "kind": "deploy_done_missing_with_downstream_evidence",
  "evidence": ["smoke_pass_marker_present", "deploy_tasks_all_checked"],
  "remediation": "openlogos deploy-done"
}
```

`evidence` 按固定顺序（`smoke_pass_marker_present` → `smoke_fail_marker_present` → `deploy_tasks_all_checked`）去重输出，保证同一磁盘事实下输出稳定可 golden。字段契约见 `spec/cli-json-output.md`。

**只读不变量（强制）**：

1. **不落盘、不缓存**——每次 `status` 调用即时派生，无新鲜度问题、无 shadow source、无 cutover。
2. **不改 `proposal_step` 派生**——`detectProposalStep()` 仍是单一事实源，投影是旁挂说明而非状态跃迁；`ready-to-deploy` 仍是 `ready-to-deploy`。
3. **不写任何 marker**——尤其不写 `DEPLOY_DONE`；status 是纯只读命令，本投影不破坏该性质。
4. **零漂移**——一致状态下字段**不出现**（不是输出 `null`），既有 status golden 逐字不受影响。
5. **`watch` 自动继承**——`watch` 复用 `collectStatusData`，无需单独实现；其只读性质同样保持。
6. **与既有诊断对象并列**——与 `plan_state`、`automation_diagnostic`、`merge_transaction` 等只读投影同构挂载，互不覆盖。

### EX-11.5: 孤儿 SMOKE_PASS 的 status 对账投影
- **触发条件**：`SMOKE_PASS` 在场、`DEPLOY_DONE` 缺失。
- **期望响应**：`status --format json` 的 `modules[].active_change.state_inconsistency` 在场且三字段齐备；`proposal_step` 仍为 `ready-to-deploy`；人类可读输出同步呈现对账提示。
- **副作用**：零——无写盘、无 marker 变化。

### EX-11.6: 一致状态零漂移
- **触发条件**：`DEPLOY_DONE` 已在场；或 `DEPLOY_DONE` 缺失但无任何矛盾下游证据。
- **期望响应**：输出**不含** `state_inconsistency` 字段，其余字段与修复前逐字一致。
- **副作用**：零。
