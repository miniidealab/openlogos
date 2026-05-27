## ADDED — `openlogos verify --format json` 预跑状态
`verify` 的 `data` 部分新增 `pre_run` 字段：

```jsonc
{
  "pre_run": {
    "mode": "none", // "none" | "pre_run_command" | "two_phase"
    "commands": [
      {
        "stage": "pre_run", // "pre_run" | "regression" | "incremental"
        "command": "npm test",
        "status": "pass", // "pass" | "fail" | "skipped"
        "exit_code": 0,
        "duration_ms": 1200
      }
    ],
    "result_paths": {
      "final": "logos/resources/verify/test-results.jsonl",
      "regression": "logos/resources/verify/test-results.regression.jsonl",
      "incremental": "logos/resources/verify/test-results.incremental.jsonl"
    },
    "merge_strategy": "last-write-wins",
    "diagnostics": [
      "覆盖不足可能是因为只运行了局部测试，test-results.jsonl 未包含全部用例。"
    ],
    "suggestions": [
      "在 logos/logos.config.json 中配置 verify.pre_run_command 或 verify.regression_command。"
    ]
  }
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pre_run.mode` | string | 是 | verify 预跑模式 |
| `pre_run.commands` | array | 是 | 实际执行或跳过的命令阶段 |
| `pre_run.commands[].stage` | string | 是 | `pre_run`、`regression` 或 `incremental` |
| `pre_run.commands[].status` | string | 是 | `pass`、`fail` 或 `skipped` |
| `pre_run.result_paths.final` | string | 是 | 最终验收读取的 JSONL 路径 |
| `pre_run.merge_strategy` | string | 否 | 两阶段合并策略，当前为 `last-write-wins` |
| `pre_run.diagnostics` | string[] | 是 | 可展示给用户的问题诊断 |
| `pre_run.suggestions` | string[] | 是 | 可展示给用户的修复建议 |

兼容规则：
- 旧项目只配置 `verify.pre_run_command` 时，`mode="pre_run_command"`。
- 配置 `regression_command` 或 `incremental_command` 时，`mode="two_phase"`。
- 没有任何预跑命令时，`mode="none"`。
- 覆盖不足且 `mode="none"` 时，必须输出局部测试诊断和配置建议。
