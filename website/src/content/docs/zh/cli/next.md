---
title: "openlogos next"
description: 为当前 OpenLogos 项目展示最值得立即执行的单条下一步操作。
---

返回开发者或 AI 助手接下来应当采取的操作。它使用与 `status` 相同的阶段和提案状态检测逻辑，但将结果压缩为一条可执行的指令。

## 命令格式

```bash
openlogos next [--module <id>] [--auto] [--format json]
```

必须在项目根目录下运行。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--module <id>` | 将建议聚焦到单个模块。 |
| `--auto` | 全自动 / 无人值守模式：对整条提案链的 standing run-scoped 授权。详见下文。 |
| `--format json` | 输出结构化 JSON，供 RunLogos 等工具使用。 |

## 功能说明

- 为 initial 模块建议下一个阶段的提示词
- 为没有活跃提案的 launched 模块建议 `openlogos change <slug>`
- 跟踪活跃提案的步骤：填写提案、编写 delta、merge、编码、verify、archive
- 当其他模块持有活跃 guard 时，报告被阻塞的模块

## 全自动模式（--auto）

`openlogos next --auto` 即**全自动 / 无人值守模式**。传入 `--auto` 即对整条提案链授予一次 **standing、run-scoped 授权**——一次授权即让该提案全链路跑到底，无需逐步人类确认。不加 `--auto`（半自动 / 手动）时，所有人类确认点的行为完全不变。

在 `--auto` 模式下，`next`：

- **自动放行可跳的 human 门。** 当流程推进到某个 `skippable: true` 的 gate 边界时视为通过；`skippable: false` 的门仍然阻塞。
- **代码变绿后自动执行 CLI 盖章/发布步骤。** 作为 standing 授权，直接执行「代码已绿之后」的四样红线步骤——`verify`、`smoke`、`archive`、`git push`，无需人类确认（JSON 输出中 `auto_execute: true`）。`git push` 无需任何 marker 或 guard 改动：PreToolUse guard 安全白名单本就放行它。
- **写入 append-only `GATE_AUTO_PASSED` 审计。** 每次自动放行都向 `logos/changes/<slug>/GATE_AUTO_PASSED` 追加一行（gate id + 时间戳）。它是审计，不是状态源。
- **遵守 R2 安全闸。** 若流程仍卡在未完成节点（含 overlay-added 的 `active`/`failed` 节点），则不放行任何 gate。

### 硬红线——loop-exhausted

唯一**任何模式（含 `--auto`）都绝不自动放行**的退出门是 loop-exhausted：达到迭代上限（`max_iters`）仍未通过测试的代码（`gate:<subflow>:loop-exhausted`，默认 `skippable: false`）。它保持阻塞，以确保全自动只交付经过验证的成果。全自动**绝不放行未通过测试的代码。** 唯一的 opt-in 是显式的 overlay `set-loop` 且 `set.exhausted_gate.skippable: true`（高危，默认关闭）。

## 示例

```bash
openlogos next
```

```
Next Step
  Action: Run verification
  Detail: Explicitly request `openlogos verify` to run acceptance tests.
```

## 相关命令

- [`status`](/zh/cli/status) — 完整的仪表盘视图
- [`change`](/zh/cli/change) — 创建变更提案
- [`verify`](/zh/cli/verify) — 运行 Gate 3.5 验收
