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
  "result_source": "executed" | "reused" | "none",
  "commit": { "head": "000ac05…", "dirty": false },
  "cli_version": "0.16.20",
  "raw_location": "proposal" | "local" | "none"
}
```

`result_source: "none"`（verify-self-sufficient-cases）只出现在 verify 因环境预检类原因（`verify_requirements_invalid`、`acceptance_requirement_undeclared`、`verify_env_not_ready`）判 FAIL 的记录中：本次既未执行命令也未读取结果，`outcome` 为 `"completed"`，`gate.result` 为 `"FAIL"`、`gate.reason` 为该原因，`counts` 各项为 null，三个 ID 数组为空。`history show` 对这类记录不给出逐用例结果；报告快照按既有留存策略提供——有活跃提案时从提案完整记录（`raw_in_proposal: true`）或本机原文目录（`raw_in_proposal: false`）读取，无活跃提案时只有中央索引、注明本次没有完整记录。0.16.24 之前的读取方把它当作损坏记录跳过并提示。
