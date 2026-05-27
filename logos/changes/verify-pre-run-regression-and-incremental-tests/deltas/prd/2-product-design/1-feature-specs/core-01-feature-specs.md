## ADDED — 2.7 verify 预执行模型
- `openlogos verify` 必须在读取 JSONL 前处理 verify 预执行配置。
- 旧字段 `verify.pre_run_command` 保持兼容：配置后按单阶段全量测试执行。
- 新字段 `verify.regression_command` 与 `verify.incremental_command` 用于两阶段模型：回归测试先执行，增量测试后执行。
- 两阶段结果必须可合并，最终验收仍只读取一个逻辑结果集合；重复用例 ID 以最后一次结果生效。
- `verify.result_path` 表示最终合并结果路径；`verify.regression_result_path` 和 `verify.incremental_result_path` 可用于阶段化结果文件，避免第二阶段 reporter 清空第一阶段结果。
- 未配置任何预跑命令时，verify 仍保持兼容可执行，但覆盖不足时必须输出清晰诊断和修复建议。

## ADDED — 2.8 init / sync / adopt 预跑配置补齐
- `openlogos init` 与 `openlogos adopt` 应识别常见测试栈并写入合理的 verify 预跑配置。
- Node 项目优先读取 `package.json` 的 `test` 脚本；若检测到 Vitest/Jest，可建议或写入 `npm test` / `npx vitest run` / `npx jest`。
- Python 项目优先识别 pytest，Go 项目使用 `go test ./...`，Rust 项目使用 `cargo test`。
- `openlogos sync` 应对旧项目补齐缺失的 verify 预跑配置；无法推断时输出 TODO，不应静默跳过。
- 自动补齐不得覆盖用户已有的 `pre_run_command`、`regression_command` 或 `incremental_command`。

## MODIFIED — S13
verify 必须关联测试用例与运行结果，并负责在读取结果前触发配置的测试预跑命令。若配置了 `regression_command` 与 `incremental_command`，verify 必须按顺序执行并合并结果；若覆盖不足且无预跑配置，必须诊断可能只运行了局部测试，并给出配置建议。

## MODIFIED — S16
JSON 输出必须与文本输出共享同一事实源。`openlogos verify --format json` 必须暴露预跑命令执行状态、阶段结果路径、合并策略、覆盖不足诊断与修复建议，供 RunLogos 展示，不要求客户端复刻测试编排逻辑。

## MODIFIED — S20
adopt 后必须生成完整 `logos/` 目录、`bootstrap: skipped` 标记和 AI 指令文件；同时应为可识别测试栈写入 verify 预跑配置，无法推断时输出 TODO。目录已存在 `logos/logos.config.json` 时必须拒绝重复执行并报错。
