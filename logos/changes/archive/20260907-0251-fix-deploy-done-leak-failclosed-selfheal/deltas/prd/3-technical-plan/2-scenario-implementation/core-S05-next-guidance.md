# core-S05-next-guidance delta — fix-deploy-done-leak-failclosed-selfheal

## MODIFIED — deploy-done 对 next 的影响

当活跃提案处于 `ready-to-deploy` 时，`openlogos next` 的下一步仍然是部署授权，但详情必须说明部署完成后通过 CLI 写入 marker：

```text
部署是人类确认点。部署完成并写入 deployment-report.md 后，执行 openlogos deploy-done 标记部署完成。
```

当 `DEPLOY_DONE` 存在且 `[deploy]` section 已全部勾选：
- 若 `smoke_required=true`，`next` 返回 `ready-to-smoke`，提示明确授权执行 `openlogos smoke`。
- 若 `smoke_required=false`，`next` 返回 `deploy-done`，提示明确授权执行 `openlogos archive <slug>`。

`next` 不得建议用户或 AI 手写 `DEPLOY_DONE`。

### 矛盾事实的对账建议（不再沉默停滞）

20260907 事故暴露的第三处失效：`DEPLOY_DONE` 缺失时派生永远停在 `ready-to-deploy`，`SMOKE_PASS` 等下游强证据永不被评估——`next` 只会一遍遍重复「请执行部署任务」，而部署其实早已完成、smoke 也早已通过。人从输出里看不出到底缺什么，宿主面板因此长期僵死。

**触发条件（全部成立）**：活跃提案存在、派生停在 `ready-to-deploy`（`DEPLOY_DONE` 缺失）、且发现至少一项**矛盾的下游证据**：

- `SMOKE_PASS` 在场（smoke 已过却没有部署完成事实）；
- `SMOKE_FAIL` 在场（smoke 已跑过却没有部署完成事实）；
- `tasks.md` 的 `[deploy]` section 已全部勾选（部署任务已完成却没有 marker）。

**输出行为**：

1. `next` 在 `active_change` 上输出只读投影 `state_inconsistency`（`kind` / `evidence` / `remediation`，字段契约见 `spec/cli-json-output.md` 与 S11），供宿主面板结构化呈现。
2. `next` 的人类可读引导在既有部署授权文案之后**追加一行**显式对账建议，点明矛盾事实与一条可直接执行的补救命令：

```text
状态对账：检测到 SMOKE_PASS 在场但 DEPLOY_DONE 缺失。若部署已实际完成，请执行 openlogos deploy-done 补齐部署完成标记。
```

3. `next_step` / `proposal_step` 派生结果**不变**——仍是 `ready-to-deploy`。投影是旁挂说明，不是状态跃迁；下游门禁仍按缺标状态 fail-closed。

**不变量**：

- **只读**：每次调用即时派生，不落盘、不缓存、不写任何 marker——尤其不写 `DEPLOY_DONE`（`next` 是被动派生，不改项目状态）。
- **不自动修复**：`next` 只点名并给建议，落标仍只能由 `openlogos deploy-done` 这一唯一 writer 完成。
- **零漂移**：一致状态下不输出该字段（不是输出 `null`）、人读文案逐字不变，既有 golden 不受影响。
- **不建议手写 marker**：对账建议给出的是 `openlogos deploy-done` 命令，绝不建议用户或 AI 手写 `DEPLOY_DONE` 文件。

### EX-5.4: 孤儿 SMOKE_PASS 的 next 对账
- **触发条件**：`SMOKE_PASS` 在场、`DEPLOY_DONE` 缺失（历史版本 smoke 未设防或旁路写入所致）。
- **期望响应**：`next` 输出 `state_inconsistency`（`kind=deploy_done_missing_with_downstream_evidence`、`evidence` 含 `smoke_pass_marker_present`、`remediation="openlogos deploy-done"`），人读引导含补救建议行；`proposal_step` 仍为 `ready-to-deploy`。
- **副作用**：零——不写盘、不改派生。

### EX-5.5: 一致状态零投影
- **触发条件**：`DEPLOY_DONE` 缺失且无任何矛盾下游证据（正常的待部署状态）；或 `DEPLOY_DONE` 已在场。
- **期望响应**：输出**不含** `state_inconsistency` 字段，人读引导与修复前逐字一致。
- **副作用**：零。
