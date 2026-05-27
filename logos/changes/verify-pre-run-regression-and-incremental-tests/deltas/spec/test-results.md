## MODIFIED — `verify.pre_run_command`（兼容配置）
`verify.pre_run_command` 保持兼容，用于单阶段全量测试。配置后，`openlogos verify` 在读取 `verify.result_path` 前执行该命令：

```json
{
  "verify": {
    "result_path": "logos/resources/verify/test-results.jsonl",
    "pre_run_command": "npx vitest run"
  }
}
```

此字段适用于只需要一条命令生成完整 `test-results.jsonl` 的项目。若同时配置两阶段字段，`openlogos verify` 优先执行两阶段模型，并在输出中标记 `pre_run_command` 作为兼容配置保留。

## ADDED — `verify.regression_command` 与 `verify.incremental_command`
两阶段模型用于先运行回归测试，再运行增量测试：

```json
{
  "verify": {
    "result_path": "logos/resources/verify/test-results.jsonl",
    "regression_command": "npm test",
    "incremental_command": "npm run test:changed",
    "regression_result_path": "logos/resources/verify/test-results.regression.jsonl",
    "incremental_result_path": "logos/resources/verify/test-results.incremental.jsonl",
    "merge_results": "last-write-wins"
  }
}
```

执行语义：
1. 若配置 `regression_command`，先执行回归测试。
2. 若配置 `incremental_command`，再执行增量测试。
3. CLI 合并阶段结果，写入 `result_path`。
4. 同一个用例 ID 多次出现时，最后一次结果生效。
5. 若未配置阶段结果路径，CLI 必须用临时快照或等价机制避免第二阶段 reporter 清空第一阶段结果。

## ADDED — 覆盖不足诊断
当项目没有配置 `pre_run_command`、`regression_command` 或 `incremental_command`，且 verify 发现覆盖不足时，CLI 必须诊断这可能是只运行了局部测试导致，并建议配置 verify 预跑命令。

该诊断不改变 Gate 判定：覆盖不足仍为 FAIL。

## MODIFIED — 清空策略
每次完整测试运行前，reporter 应清空对应阶段的结果文件。两阶段模型下，回归阶段和增量阶段可以写入不同结果文件；如果两个阶段都写入默认 `result_path`，CLI 必须在阶段之间保留快照，确保最终合并结果不会丢失第一阶段覆盖。
