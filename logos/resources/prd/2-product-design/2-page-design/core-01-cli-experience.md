# core-01-cli-experience

## 一、交互原则
- 先给确定动作，再给解释。
- 错误信息必须明确到命令和原因。
- 退出码与文本输出必须一致。

## 二、核心终端体验
### 2.1 init
显示目录创建进度、配置写入结果、verify 预跑配置推断结果和下一步提示。

当识别出常见测试栈时，init 输出应包含类似：

```text
✓ 写入 verify.pre_run_command: npm test
```

当无法推断测试命令时，init 输出应包含明确 TODO：

```text
⚠ 未能推断测试命令。请在 logos/logos.config.json 中配置 verify.pre_run_command 或 verify.regression_command，避免 openlogos verify 因局部 test-results.jsonl 覆盖不足而失败。
```

### 2.2 sync
显示同步了哪些资产、补录了哪些索引、是否补齐 verify 预跑配置、是否有跳过项。

sync 不得覆盖用户已有的 verify 预跑命令。若旧项目缺少预跑配置且无法推断测试命令，必须输出可执行诊断。

### 2.3 status / next
显示阶段进度、活跃变更步骤、提案级部署决策和最优下一步建议。

活跃提案存在时：
- `proposal_step=delta-writing`：提示继续产出 delta，完成后明确授权 `openlogos merge <slug>`。
- `proposal_step=ready-to-verify`：提示代码已完成，明确授权执行 `openlogos verify`。
- `proposal_step=verify-passed` 且提案无需部署：提示明确授权执行 `openlogos archive <slug>`。
- `proposal_step=ready-to-deploy`：提示验收通过且存在部署任务，部署必须由用户明确授权。
- `proposal_step=ready-to-smoke`：提示部署已完成，明确授权执行 `openlogos smoke`。
- `proposal_step=smoke-passed`：提示明确授权执行 `openlogos archive <slug>`。

当 `proposal.md` 的部署影响与 `tasks.md` 的 `[deploy]` section 不一致时，文本模式必须展示警告；JSON 模式必须暴露可被客户端消费的部署决策来源与冲突状态。冲突态下主动作必须切换为“修正 proposal.md / tasks.md”，不得继续提示 deploy、smoke 或 archive。

### 2.4 verify / smoke
显示覆盖度、失败项、缺失项、预跑命令状态、沙箱状态和门禁结论。

verify 执行前置命令时：
- 配置 `pre_run_command`：显示单阶段预跑命令。
- 配置 `regression_command`：先显示并执行回归测试。
- 配置 `incremental_command`：后显示并执行增量测试。
- 同时配置 `pre_run_command` 与两阶段命令时，优先使用两阶段命令，并提示 `pre_run_command` 作为兼容配置未执行。

verify / smoke 启用沙箱时：
- `sandbox_mode=off`：不显示隔离成功文案，仅保留历史行为。
- `sandbox_mode=auto`：显示是否启用沙箱；若降级执行，必须显示告警。
- `sandbox_mode=always`：显示强制隔离要求；无法隔离或检测到非白名单写入时，必须显示失败原因和沙箱路径。

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

### 2.5 adopt

`openlogos adopt` 为已有项目接入专用命令。它不是轻量补丁命令，而是“只跳过 Initial 文档门禁的 init”：必须完成与 `init` 同级别的 OpenLogos 基础设施初始化，然后用 `bootstrap: adopted` 标记存量项目接入来源。

**检测与确认阶段**
```text
$ openlogos adopt

? 检测到已有项目：my-app（来自 package.json）
? 文档语言 (locale)：zh
? AI 工具：claude-code

✓ 读取项目信息完成
```

非交互场景应使用显式参数：

```text
openlogos adopt --locale zh --ai-tool all
```

**创建阶段**
```text
✓ 创建 logos/ 标准目录结构
✓ 写入 logos.config.json
✓ 写入 logos-project.yaml（bootstrap: adopted, lifecycle: launched）
✓ 写入 AGENTS.md / CLAUDE.md
✓ 部署所选 AI tools 的 Skills / 插件 / 命令资产
✓ 部署 OpenLogos 规范文件到 logos/spec/
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

若要展示推荐沙箱配置，可附带：

```text
✓ 写入 verify.sandbox_mode: auto
✓ 写入 verify.sandbox_root: /private/tmp
✓ 写入 verify.sandbox_deny_workspace_write: true
```

**接入报告与下一步**
```text
🎉 已有项目接入完成！

项目已进入存量项目接入模式（bootstrap: adopted）：
  · OpenLogos 基础设施已完整初始化
  · Initial 文档基线已跳过，不强制要求
  · 模块生命周期直接设为 launched

建议的下一步：先补充项目基线文档
  → openlogos change add-baseline-docs
  在变更提案中逐步补写需求、架构、场景、测试用例，
  把 TDD 思想贯彻到每一次迭代中。
```

**异常：logos/ 已存在**
```text
✗ 该项目已初始化（logos/logos.config.json 已存在）
  若要重新配置，请先备份并删除 logos/ 目录。
```

### 2.6 next（存量项目接入无提案时）

`bootstrap: adopted` 且无活跃提案时，`openlogos next` 输出固定引导。历史 `bootstrap: skipped` 项目按相同逻辑兼容处理。

```text
$ openlogos next

📌 当前状态：已接入（存量项目接入模式），尚无活跃变更提案

建议的下一步：先补充项目基线文档
  → openlogos change add-baseline-docs
  在变更提案中逐步补写需求、架构、场景、测试用例，
  把 TDD 思想贯彻到每一次迭代中。

补文档提案归档后，openlogos next 将恢复正常阶段建议。
```

## 三、异常状态
- 已初始化项目再次 init。
- 已初始化项目执行 adopt（提示已初始化）。
- guard 冲突时创建 change。
- verify 无结果文件。
- verify 覆盖不足且未配置预跑命令（提示可能只运行局部测试）。
- verify 预跑命令执行失败（保留测试输出，并在诊断中暴露命令状态）。
- smoke 无 smoke 用例或无结果。

## 四、输出要求
- 文本模式用于人读。
- JSON 模式用于机器读。
- 错误输出不得吞掉上下文。
