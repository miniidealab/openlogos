## ADDED — verify 失败用例复跑与偶发（verify-flaky-rerun）

> 规则权威见功能规格 §2.108。以下字段加在 `openlogos verify --format json` 的 `data` 中，全部为新增，既有字段的含义不变。

```jsonc
{
  "rerun": {
    "attempted": true,                 // 是否执行了复跑
    "skipped_reason": null,            // 未复跑的原因，见下表；attempted 为 true 时为 null
    "max_cases": 10,                   // 生效的上限
    "requested_ids": ["UT-S01-01"],    // 复跑集合 R，按 ID 字典序；无失败用例时为空数组
    "commands": [                      // 分派到复跑用例的命令组（含因执行环境不可用而未执行的）；没有分派时为空数组
      {
        "stage": "pre_run",            // "pre_run" | "regression" | "incremental"
        "modules": null,               // 命令组服务的模块 id 数组；未启用模块范围时为 null
        "ids": ["UT-S01-01"],          // 该命令组对应的 R 子集
        "first_exit_code": 1,          // 首跑退出码
        "rerun_exit_code": 0,          // 复跑退出码；未复跑时为 null
        "skipped_reason": null,        // 该命令组未复跑的原因：null | "sandbox_unavailable"
        "status_after": "pass"         // 门禁采用的命令组状态："pass" | "fail"；按 §2.108.7 改判，未改判时为首跑状态
      }
    ]
  },
  "flaky_cases": [                     // 为空时不出现
    { "id": "UT-S01-01", "module": "core", "first_error": "Expected 200, got 500" }
  ]
}
```

| 字段 | 类型 | 必有 | 说明 |
|---|---|---|---|
| `rerun` | object | 是 | 0.16.26 起恒输出，包括环境预检类原因判 FAIL 的响应 |
| `rerun.attempted` | boolean | 是 | 是否执行了复跑 |
| `rerun.skipped_reason` | string \| null | 是 | 见下表 |
| `rerun.max_cases` | integer | 是 | 生效的 `verify.rerun_failed.max_cases` |
| `rerun.requested_ids` | string[] | 是 | 复跑集合；因 `too_many_failures` 未复跑时仍列出 |
| `rerun.commands` | array | 是 | 分派到复跑用例的命令组；每项 `{stage, modules, ids, first_exit_code, rerun_exit_code, skipped_reason, status_after}`。`ids` 为分派给该命令组的用例（每个用例只分派给其生效记录的来源）；因首跑执行环境不可用而未复跑时 `rerun_exit_code` 为 null、`skipped_reason` 为 `"sandbox_unavailable"`，该项仍保留；`status_after` 取首跑的命令组状态（§2.108.7「其余情况」，未执行复跑不改判，也不强制为 `"fail"`）。`rerun.attempted=false` 时 `commands` 只在 `skipped_reason="sandbox_unavailable"` 下非空 |
| `flaky_cases` | array | 否 | 偶发用例，每项 `{id, module, first_error}`；`module` 无法归属时为 null，`first_error` 取首跑记录的 `error`，没有则为 null；为空时不出现 |

`rerun.skipped_reason` 取值：

| 取值 | 含义 |
|---|---|
| `"precheck_failed"` | 环境预检类原因命中，未执行预跑 |
| `"disabled"` | `verify.rerun_failed.enabled` 为 false |
| `"no_command"` | 本次没有执行任何预跑命令 |
| `"gate_blocked"` | `test_change_set_invalid` 命中 |
| `"no_failed_cases"` | 结果中没有失败的规格内 UT/ST（含测试入口回滚了结果账本的情形） |
| `"too_many_failures"` | 复跑集合超过上限 |
| `"sandbox_unavailable"` | 需要复跑的命令组，其首跑执行环境全部无法继续使用；相关用例维持失败 |

既有字段在复跑后的取值：

- `failed_cases`：合并后仍失败的用例；偶发用例不在其中。
- `pre_run.commands[]`：`status` 与 `exit_code` 仍是首跑的事实，不改写。
- `gate`：以合并后的结果与 `rerun.commands[].status_after` 判定；不新增 `gate.reason` 取值。首跑账本的一致性诊断（如非法行）保留到最终门禁，偶发判定不抵消 `result_ledger_inconsistent`。
- `consistency`：包含首跑与复跑中的非法行，复跑中的注明来源。
- `summary` 等计数：偶发用例计入通过。

新增警告码（`warnings[]`）：

| 警告码 | 含义 |
|---|---|
| `flaky_cases_present` | 门禁 PASS 且存在偶发用例；详情列出用例 ID |
| `rerun_config_invalid` | `verify.rerun_failed` 取值非法，非法项已按缺省值处理；详情指出字段 |

消费方约定：0.16.26 之前的输出没有 `rerun`，按「未复跑」处理；宿主展示验收结果时，应把 `flaky_cases` 与失败、跳过并列展示，不要并入通过。

## MODIFIED — 共用对象：run

`history list` 的元素与 `history show` 的 `run` 为中央索引记录本身（`schema: "openlogos/verification-run@1"`，字段闭合，见功能规格 §2.104.3）：

```jsonc
{
  "schema": "openlogos/verification-run@1",
  "run_id": "20261122T061530123Z-verify-a1b2c3",
  "kind": "verify" | "smoke",
  "started_at": "2026-11-22T06:15:30.123Z",
  "finished_at": "2026-11-22T06:16:02.004Z",
  "outcome": "completed" | "aborted",
  "gate": { "result": "PASS" | "FAIL" | null, "reason": "failed_cases" },
  "error_code": null,
  "proposal": { "slug": "vh-demo", "run_dir": "verify-runs/20261122T061530123Z-verify-a1b2c3" },  // 或 null
  "module_scope": ["core"],                // 或 null
  "verify_mode": "slice-checkpoint" | "final" | null,
  "attempted_slice_id": "slice-01-demo",   // 或 null
  "environment": null,                     // smoke 为目标环境 id
  "deploy_id": null,                       // smoke 为核对的 deploy_id
  "counts": { "defined": 3, "executed": 3, "passed": 1, "failed": 2, "skipped": 0, "uncovered": 0 },
  "failed_ids": ["UT-S01-01", "UT-S01-02"],
  "skipped_ids": [],
  "uncovered_ids": [],
  "flaky_ids": [],                         // 可选；verify 判为偶发的用例 ID（verify-flaky-rerun）
  "result_source": "executed" | "reused" | "none",
  "commit": { "head": "000ac05…", "dirty": false },
  "cli_version": "0.16.20",
  "raw_location": "proposal" | "local" | "none"
}
```

`result_source: "none"`（verify-self-sufficient-cases）只出现在 verify 因环境预检类原因（`verify_requirements_invalid`、`acceptance_requirement_undeclared`、`verify_env_not_ready`）判 FAIL 的记录中：本次既未执行命令也未读取结果，`outcome` 为 `"completed"`，`gate.result` 为 `"FAIL"`、`gate.reason` 为该原因，`counts` 各项为 null，三个 ID 数组为空。`history show` 对这类记录不给出逐用例结果；报告快照按既有留存策略提供——有活跃提案时从提案完整记录（`raw_in_proposal: true`）或本机原文目录（`raw_in_proposal: false`）读取，无活跃提案时只有中央索引、注明本次没有完整记录。0.16.24 之前的读取方把它当作损坏记录跳过并提示。

`flaky_ids`（verify-flaky-rerun）：0.16.26 起的 verify 记录恒写入，没有偶发用例时为空数组；smoke 记录不写。数组内的用例计入 `counts.passed`，不在 `failed_ids` 中。读取方遇到缺少该字段的记录按空数组处理；0.16.26 之前的读取方忽略该字段，照常读取记录。
