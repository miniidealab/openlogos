## MODIFIED — 2.1 init
显示目录创建进度、配置写入结果、verify 预跑配置推断结果和下一步提示。

当识别出常见测试栈时，init 输出应包含类似：

```text
✓ 写入 verify.pre_run_command: npm test
```

当无法推断测试命令时，init 输出应包含明确 TODO：

```text
⚠ 未能推断测试命令。请在 logos/logos.config.json 中配置 verify.pre_run_command 或 verify.regression_command，避免 openlogos verify 因局部 test-results.jsonl 覆盖不足而失败。
```

## MODIFIED — 2.2 sync
显示同步了哪些资产、补录了哪些索引、是否补齐 verify 预跑配置、是否有跳过项。

sync 不得覆盖用户已有的 verify 预跑命令。若旧项目缺少预跑配置且无法推断测试命令，必须输出可执行诊断。

## MODIFIED — 2.4 verify / smoke
显示覆盖度、失败项、缺失项、预跑命令状态和门禁结论。

verify 执行前置命令时：
- 配置 `pre_run_command`：显示单阶段预跑命令。
- 配置 `regression_command`：先显示并执行回归测试。
- 配置 `incremental_command`：后显示并执行增量测试。
- 同时配置 `pre_run_command` 与两阶段命令时，优先使用两阶段命令，并提示 `pre_run_command` 作为兼容配置未执行。

覆盖不足且未配置任何预跑命令时，必须显示诊断：

```text
⚠ 覆盖不足可能是因为只运行了局部测试，test-results.jsonl 未包含全部用例。
  建议配置 verify.pre_run_command，或配置 verify.regression_command + verify.incremental_command。
```

verify PASS 后的下一步由提案级部署决策决定：
- 无需部署：直接建议 archive。
- 需要部署：展示部署任务和人类确认提示。
- 需要部署且需要 smoke：部署完成后再建议 `openlogos smoke`。
- 部署决策冲突：提示修正提案资料，不进入部署、smoke 或 archive。

smoke 不替代 verify，不自动触发部署，也不应在无需部署的提案中作为下一步展示。

## MODIFIED — 2.5 adopt
`openlogos adopt` 为已有项目接入专用命令，体验分四段：

**检测与确认阶段**
```text
$ openlogos adopt

? 检测到已有项目：my-app（来自 package.json）
? 文档语言 (locale)：zh
? AI 工具：claude-code

✓ 读取项目信息完成
```

**创建阶段**
```text
✓ 创建 logos/ 标准目录结构
✓ 写入 logos.config.json
✓ 写入 logos-project.yaml（bootstrap: skipped, lifecycle: launched）
✓ 写入 AGENTS.md / CLAUDE.md
```

**verify 预跑配置阶段**
```text
✓ 检测到测试脚本：npm test
✓ 写入 verify.pre_run_command: npm test
```

无法推断时：

```text
⚠ 未能推断测试命令。请补充 verify.pre_run_command 或 verify.regression_command。
```

**接入报告与下一步**
```text
🎉 已有项目接入完成！

项目已进入快速接入模式（bootstrap: skipped）：
  · Phase 1~3 文档基线已跳过，不强制要求
  · 模块生命周期直接设为 launched

建议的下一步：先补充项目基线文档
  → openlogos change add-baseline-docs
  在变更提案中逐步补写需求、架构、场景、测试用例，
  把 TDD 思想贯彻到每一次迭代中。
```

## MODIFIED — 三、异常状态
- 已初始化项目再次 init。
- 已初始化项目执行 adopt（提示已初始化）。
- guard 冲突时创建 change。
- verify 无结果文件。
- verify 覆盖不足且未配置预跑命令（提示可能只运行局部测试）。
- verify 预跑命令执行失败（保留测试输出，并在诊断中暴露命令状态）。
- smoke 无 smoke 用例或无结果。
