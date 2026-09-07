# spec/cli-json-output.md delta — fix-deploy-done-leak-failclosed-selfheal

## ADDED — 3.17 `state_inconsistency` 对账投影字段（lifecycle-failclosed-reconciliation）

`status` / `next`（以及复用 `collectStatusData` 的 `watch`）在检测到**活跃提案的事实矛盾**时输出的只读投影，供宿主面板呈现对账提示。它不改变任何既有字段的语义。

### 挂载位置

- `modules[].active_change.state_inconsistency`（权威位置）。
- legacy 单模块输出可回退顶层 `state_inconsistency`（与 `plan_state` 的回退规则同构）。
- 与 `plan_state`、`automation_diagnostic`、`merge_transaction`、`slice_transaction` 等既有只读投影**并列挂载**，互不覆盖。

### 出现条件

全部成立才出现：

1. 存在活跃提案；
2. `proposal_step === "ready-to-deploy"`（即 `DEPLOY_DONE` 缺失）；
3. 至少一项**矛盾的下游证据**在场（见 `evidence` 枚举）。

**零漂移边界**：不满足时该键**不出现**（不是输出 `null`）。既有 `status` / `next` golden 因此逐字不受影响。

### Schema

```jsonc
{
  "kind": "deploy_done_missing_with_downstream_evidence",
  "evidence": ["smoke_pass_marker_present", "deploy_tasks_all_checked"],
  "remediation": "openlogos deploy-done"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | string | 是 | 矛盾类型。当前唯一取值 `deploy_done_missing_with_downstream_evidence`；未来新增取值时消费方按未知值保守处理（呈现但不据其自动动作） |
| `evidence` | string[] | 是 | 非空、去重、**按固定顺序**输出的证据枚举（顺序：`smoke_pass_marker_present` → `smoke_fail_marker_present` → `deploy_tasks_all_checked`），保证同一磁盘事实下输出稳定可 golden |
| `remediation` | string | 是 | 一条可直接执行的补救命令；当前恒为 `"openlogos deploy-done"` |

`evidence` 取值：

| 值 | 磁盘事实 |
|---|---|
| `smoke_pass_marker_present` | 提案目录存在 `SMOKE_PASS` |
| `smoke_fail_marker_present` | 提案目录存在 `SMOKE_FAIL` |
| `deploy_tasks_all_checked` | `tasks.md` 的 `[deploy]` section 全部条目已勾选 |

### 派生规则与不变量

1. **即时只读派生**：每次命令调用重新计算，**不落盘、不缓存**，无新鲜度问题、无 shadow source。
2. **不改 `proposal_step`**：投影是旁挂说明而非状态跃迁；`ready-to-deploy` 仍是 `ready-to-deploy`，下游门禁仍按缺标状态 fail-closed。
3. **不写任何 marker**：尤其不写 `DEPLOY_DONE`——`status` / `next` 是被动派生，本字段不破坏该性质。
4. **`DEPLOY_DONE` 唯一 writer 不变**：补救只能由 `openlogos deploy-done` 完成；消费方不得据本字段自动补写 marker。
5. `status` schema 为 `additionalProperties: true`，本字段为 additive、向后兼容；旧消费方忽略即可。

### 消费方契约

- 面板应把 `evidence` 呈现为「检测到什么矛盾事实」，把 `remediation` 呈现为可一键复制/执行的补救命令。
- 消费方**不得**据本字段推断部署已完成，也不得据其跳过任何 fail-closed 门。
- `next` 的人类可读输出在既有引导之后追加一行对账建议；文本形态非机器契约，机器消费一律走本字段。

## ADDED — 5.5 smoke 前置 fail-closed 错误语义（lifecycle-failclosed-reconciliation）

`openlogos smoke` 在执行 `smoke.command` **之前**完成前置校验；任一不满足即 fail-closed 拒绝，走 §6 通用错误 envelope（stderr + 非零退出），**不产生任何 success envelope**。

判定顺序固定 ①→②→③→④，命中即停，只报第一个错误码：

| # | 前置 | 错误码 | message 必须含的补救命令 |
|---|---|---|---|
| ① | 提案声明需要 smoke（`smoke_required=true`） | `SMOKE_NOT_REQUIRED` | `openlogos archive <slug>` |
| ② | 提案部署决策无冲突 | `SMOKE_DEPLOY_DECISION_CONFLICT` | 先修正 `proposal.md` / `tasks.md` |
| ③ | `DEPLOY_DONE` 存在 | `SMOKE_DEPLOY_NOT_DONE` | `openlogos deploy-done` |
| ④ | `tasks.md` 的 `[deploy]` section 全勾 | `SMOKE_DEPLOY_TASKS_INCOMPLETE` | 补齐 `[deploy]` 任务后 `openlogos deploy-done` |

**零副作用（强制）**：任一 fail-closed 分支都不得执行 `smoke.command`、不得进入 sandbox、不得写 `SMOKE_PASS` / `SMOKE_FAIL`、不得生成 `smoke-report.md`、不得追加 `smoke-results.jsonl`。

**禁止 auto-heal**：`openlogos smoke` 在任何分支下都不得写入 `DEPLOY_DONE`。

**零回归**：四项前置全满足时进入既有执行路径，§5.2 data schema、§5.3 字段说明与 §5.4 兼容规则逐项不变。

## ADDED — 6.3 生命周期 fail-closed 错误码（lifecycle-failclosed-reconciliation）

以下错误码与 §6.1 表并列生效，均为**前置门未过**的 fail-closed 拒绝，共同不变量是「零副作用」：拒绝分支不产生任何状态更新。

| 错误码 | 命令 | 说明 |
|--------|------|------|
| `SMOKE_NOT_REQUIRED` | `smoke` | 提案声明无需 smoke；建议直接归档 |
| `SMOKE_DEPLOY_DECISION_CONFLICT` | `smoke` | 提案部署决策冲突；须先修正 `proposal.md` / `tasks.md` |
| `SMOKE_DEPLOY_NOT_DONE` | `smoke` | `DEPLOY_DONE` 缺失；须先完成部署并执行 `openlogos deploy-done` |
| `SMOKE_DEPLOY_TASKS_INCOMPLETE` | `smoke` | `tasks.md` 的 `[deploy]` section 未全勾 |
| `ARCHIVE_VERIFY_NOT_PASSED` | `archive` | `VERIFY_PASS` 缺失或 `VERIFY_FAIL` 在场 |
| `ARCHIVE_DEPLOY_NOT_DONE` | `archive` | 需部署提案的 `DEPLOY_DONE` 缺失（`SMOKE_PASS` 在场也不例外） |
| `ARCHIVE_SMOKE_NOT_PASSED` | `archive` | 需 smoke 提案的 `SMOKE_PASS` 缺失或 `SMOKE_FAIL` 在场 |

**输出通道**：

- `SMOKE_*` 走 §6 通用错误 envelope（`--format json` 下 stderr JSON；默认文本下 stderr 文本），非零退出。
- `ARCHIVE_*` 与既有 `ARCHIVE_WATCH_*` 一致——`openlogos archive` **仍是纯文本命令，不新增 stdout JSON envelope**；以稳定错误码文本写 stderr 并非零退出。

**archive 链条判定顺序**固定 `ARCHIVE_VERIFY_NOT_PASSED` → `ARCHIVE_DEPLOY_NOT_DONE` → `ARCHIVE_SMOKE_NOT_PASSED`，命中即停；后两者只对 `deployment_required=true`（及 `smoke_required=true`）的提案适用。链条校验在 Windows 归档握手**之前**执行：顺序为「链条校验 → 握手（`ARCHIVE_WATCH_*`）→ rename」，链条不满足时不建立握手请求。

**`--auto` 语义**：standing 授权放行的是「运行该命令这个动作」，**不跳过**上述前置门；前置不满足时 `--auto` 同样 fail-closed 拒绝，`GATE_AUTO_PASSED` 审计行不构成对缺口状态的放行依据。
