## ADDED — verify 预跑配置初始化规则
项目初始化或已有项目接入时，必须为后续 `openlogos verify` 准备完整测试结果生成路径。

执行规则：

1. 创建 `logos.config.json` 时始终写入 `verify.result_path`。
2. 检测常见测试栈：
   - `package.json` 且存在 `scripts.test` → 写入 `verify.pre_run_command: "npm test"`
   - Vitest → 可写入 `npx vitest run`
   - Jest → 可写入 `npx jest`
   - pytest → 可写入 `pytest`
   - Go → 可写入 `go test ./...`
   - Cargo → 可写入 `cargo test`
3. 已有用户配置时不得覆盖。
4. 无法推断时，必须在输出中生成 TODO，提示用户补充 `verify.pre_run_command` 或 `verify.regression_command`。
5. 如果项目明确使用“回归 + 增量”模型，可写入 `verify.regression_command` 与 `verify.incremental_command`，并说明阶段结果合并策略。

原因说明：

`openlogos verify` 以 `logos/resources/test/*.md` 的全量用例作为覆盖分母。如果 reporter 只写入局部测试结果，verify 会正确报告覆盖不足，但用户容易误以为业务测试失败。初始化阶段尽早补齐预跑配置，可以让验收默认生成完整 JSONL。
