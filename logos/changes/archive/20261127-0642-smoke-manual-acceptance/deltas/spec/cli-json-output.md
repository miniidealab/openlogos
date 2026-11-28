## ADDED — 冒烟阶段人工验收 JSON 增量（smoke-manual-acceptance）

> 来源变更：smoke-manual-acceptance（决策 C01、C02；proposal-r1 F1～F6、proposal-r2 F3/F6 处置）。行为与判据的权威定义见 `spec/environments.md` §15 与功能规格 §2.107；本节只定义 JSON 形态。信封沿用 §1.2，错误沿用 §6 通用错误 envelope。未配置 `manual_acceptance` 且没有人工用例的项目：`smoke` 只多出值为默认的 `data.manual_acceptance`，其余命令输出与引入前逐字一致。

### smoke 增量

- `data.gate.result` 取值新增 `"PENDING"`，此时退出码为 1。
- `data.gate.reason` 取值新增 `"manual_scope_unresolved"`、`"manual_regression_unresolved"`、`"manual_cases_failed"`、`"manual_acceptance_pending"`。
- `data.diagnostics[].code` 新增 `"manual_smoke_result_id"`，门禁 FAIL。
- 新增 `data.manual_acceptance`（总是输出）：

```jsonc
"manual_acceptance": {
  "enabled": true,                       // 环境是否开启人工验收；无登记表或未配置为 false
  "environment": "prod",                 // 未传 --env 时为 null
  "deploy_id": "6f1c…",                  // 当前部署（最近一条 deploy 记录）；没有时为 null
  "deploy_confirmed": true,              // 当前部署结果是否为 done；false 时开启环境判 manual_scope_unresolved
  "ref": "<40 位 commit> | null",        // 已部署版本 R
  "baseline_ref": "<40 位 commit> | null", // 基线 B；首次开启为 null
  "pending": ["ST-S01-05", "SMOKE-core-901"], // P(E, D)（开启时）；关闭时为 []
  "passed": ["ST-S01-05"],               // P 中在 D 上最后结果为 pass 的 ID
  "failed": [{ "id": "SMOKE-core-901", "note": "首启白屏" }],
  "remaining": [],                       // P 中尚无 D 记录的 ID
  "regression_unresolved": [],           // 开启时失效的回归 ID
  "unexecuted": [],                      // 关闭时「未执行的人工用例」；开启时为 []
  "warnings": [                          // manual_regression_unknown / manual_baseline_unavailable / manual_deployment_replaced / manual_scope_unresolved（关闭时）
    { "code": "manual_baseline_unavailable", "message": "…" }
  ]
}
```

- 自动用例为零、只有人工用例时：`data.summary.defined_count=0`、`executed_count=0`，不报 `NO_SMOKE_RESULTS` / `NO_SMOKE_CASES`。
- 账本写入证据 `data.evidence`（既有）在 PENDING 时同样给出 `ledger_written`；提案通道清除的旧标记列在 `data.evidence.markers_cleared`（新增，字符串数组，可为空）。

### `openlogos accept --format json`

用法：

```bash
openlogos accept --env <id|alias> --deploy <deploy_id> --case <ID>[,<ID>…] --result pass|fail [--note <文字>] [--evidence <路径>]… --format json
```

成功输出（stdout，退出码 0）：

```jsonc
{
  "command": "accept",
  "version": "<cli-version>",
  "timestamp": "<ISO-8601>",
  "data": {
    "environment": "prod",
    "deploy_id": "6f1c…",
    "ref": "<40 位 commit> | null",
    "recorded": [
      { "case_id": "ST-S01-05", "result": "pass" },
      { "case_id": "SMOKE-core-901", "result": "pass" }
    ],
    "remaining": [],                     // 记录后 P 中仍无 D 记录的 ID
    "expired_pass": false,               // true：本次追加前 D 已有未过期的通过记录（两种通道相同；提案通道另删除 SMOKE_PASS）
    "recorder": "Alice <alice@example.com>", // 只作展示，可为 null
    "warnings": [ { "code": "accept_evidence_missing", "path": "shots/first-run.png" } ]
  }
}
```

失败输出（stderr，退出码 1）：通用错误 envelope。错误码包括：
- `PROJECT_NOT_INITIALIZED`、`ENV_REGISTRY_NOT_FOUND`、`ENV_REGISTRY_INVALID`、`ENV_REQUIRED`、`ENV_UNKNOWN`；
- `ACCEPT_ARGS_INVALID`、`ACCEPT_NOTE_REQUIRED`、`ACCEPT_NOT_ENABLED`、`ACCEPT_NO_DEPLOYMENT`；
- `ACCEPT_DEPLOYMENT_UNCONFIRMED`（`details` 含 `environment`、`deploy_id`、`result`：最近一条 deploy 记录结果为 `unknown` / `failed`）；
- `ACCEPT_LEDGER_WRITE_FAILED`；
- 带 `details` 的两个：

```jsonc
"error": { "code": "ACCEPT_DEPLOY_CHANGED", "message": "…",
  "details": { "environment": "prod", "expected": "<--deploy 给出的 deploy_id>", "current": "<锁内读取的当前 deploy_id>" } }
```

```jsonc
"error": { "code": "ACCEPT_CASE_NOT_PENDING", "message": "…",
  "details": { "environment": "prod", "deploy_id": "6f1c…", "not_pending": ["UT-S01-99"], "reason": "not_in_list | scope_unresolved" } }
```

- 文本模式：成功时打印环境、部署、已记录用例与剩余清单；错误打印 `Error: [<code>] <message>`。
- AI 宿主内调用受 guard 宿主原生审批约束（`spec/pretooluse-guard.md`「保护范围变更的宿主原生审批（C14）」），被阻断时命令不执行，不产生本节输出。

### EnvView 增量（`env show` / `env list` / `status`）

- 只在配置了 `manual_acceptance` 的环境上新增：

```jsonc
"manual_acceptance": {
  "enabled": true,
  "regression": ["ST-S01-05"],
  "waiting": { "deploy_id": "6f1c…", "remaining": ["SMOKE-core-901"] }   // 当前部署最近 smoke 记录不是 pending 时为 null
}
```

- `last_smoke.result` 取值新增 `"pending"`（此时 `verified=false`）；`last_smoke` 可选新增 `manual_passed`、`manual_pending`。
- 未配置该字段的环境不出现该键；`status.schema.json` 同步。

### next / status 增量

- `proposal_step` / 驻留态新增 `"awaiting-manual-acceptance"`（label「等待人工验收」 / "Awaiting manual acceptance"）。
- 剩余非空时：
  - `next_node` 的建议命令为 `openlogos accept --env <E> --deploy <deploy_id> --case <ID,…> --result '<pass 或 fail>'`：结果不预填，占位符整体加单引号；原样执行时 CLI 收到 `<pass 或 fail>`，以 `ACCEPT_ARGS_INVALID` 拒绝且零写入，人须按实际结果替换为 `pass` 或 `fail`（失败加 `--note`）；
  - `auto_execute=false`；`--auto` 下 `gate_auto_passed` 不为 true；
  - `data.manual_acceptance = {environment, deploy_id, remaining[]}` 随 `active_change` 输出。
- 剩余为空时：建议命令为 `openlogos smoke --env <E>`，`auto_execute` 与 `ready-to-smoke` 同口径。
- `next.schema.json` 的驻留态枚举同步。

### archive 错误细化

`ARCHIVE_SMOKE_NOT_PASSED` 在账本核对失败时带 `error.details`：

```jsonc
{ "reason": "smoke_pass_expired", "environment": "prod", "deploy_id": "6f1c…" }
```

既有触发（`SMOKE_PASS` 缺失或 `SMOKE_FAIL` 在场）不带 `details`，形态不变。
