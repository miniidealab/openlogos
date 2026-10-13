---
title: "openlogos next"
description: 为当前 OpenLogos 项目展示最值得立即执行的单条下一步操作，支持半自动（默认）与全自动（--auto）两档。
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

- 为 `initial` 模块建议下一个阶段的提示词
- 为没有活跃提案的 `launched` 模块建议 `openlogos change <slug>`
- 跟踪活跃提案的步骤：填写提案 → 批准方案 → 编写 delta → merge → 规划 `[code]` 切片 → 实现 → verify → 部署 / smoke → archive
- 当其他模块持有活跃 guard 时，报告被阻塞的模块
- 多模块项目按模块并列给出建议（进行中的置顶）；没有进行中的模块时提示 `openlogos module add`

## 两档授权

### 半自动（默认，不带 `--auto`）

`openlogos merge`、`openlogos verify`、部署、`openlogos smoke`、`openlogos archive` 与 `git push` 都是**人类确认点**。AI 不得自行执行；只有你明确要求（包括使用对应的 slash command）时才可代为执行。「顺手完成流程」「按流程走完」这类隐式说法不构成授权。所有人类门的行为与 flow 声明完全一致。

### 全自动（`--auto`）

`openlogos next --auto` 是**全自动 / 无人值守模式**。选择 `--auto` 即对整条提案链给出一次 **standing run-scoped 授权**——一次授权，提案即可跑完，无需逐步确认。此模式下 `next`：

- **自动放行可跳的 flow 门**——`plan-exit`、`spec-exit`、`slice-exit` 与 `deliver-entry` 均为 `skippable: true`，driver 可越过它们继续推进（包括进入合并与部署）。`skippable: false` 的门照常阻塞。
- **自动执行「代码已绿之后」的 CLI 步骤**——提案处于 `ready-to-verify`、`ready-to-smoke`，或已验收 / 已部署 / smoke 通过时，`next` 返回对应命令（`openlogos verify`、`openlogos smoke`、`openlogos archive <slug>`）并标记 `auto_execute: true`。`git push` 同属 standing 授权范围，无需额外 marker。
- **追加写入 `GATE_AUTO_PASSED` 审计**——每次自动放行向 `logos/changes/<slug>/GATE_AUTO_PASSED` 追加一行（gate id + 时间戳）。它是审计记录，不是状态源。
- **遵守安全闩**——流程仍卡在未完成节点（含 overlay 新增的 `active` / `failed` 节点）、循环阻塞或切片清单有问题时，不自动放行、也不自动执行。

standing 授权**不覆盖**修改 guard 保护范围（`openlogos ignore|exempt add|remove`）；这类命令始终需要在宿主自己的权限弹窗中由用户批准。

### 硬红线——loop-exhausted

**任何模式（含 `--auto`）都绝不自动放行**的唯一退出门是 `gate:implement:loop-exhausted`：迭代达到上限（`max_iters`）仍未通过测试的代码。它保持阻塞，保证全自动只交付经过验证的成果——**未通过测试的代码绝不放行**。唯一的 opt-in 是显式 overlay `set-loop` 并设置 `set.exhausted_gate.skippable: true`（高风险，默认关闭）。

## JSON 字段

使用 `--format json` 时，envelope 携带 `action`、`command`、`detail`、`active_change` 与 `proposal_step`。带 `--auto` 时追加 `auto: true`、`gate_id`、`skippable`、`gate_auto_passed`；需要直接执行代码已绿后的命令时再加 `auto_execute: true`。`gate_auto_passed`（flow 门）与 `auto_execute`（命令步骤）不会在同一响应中同时为真。

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

- [`status`](/zh/cli/status) — 完整仪表盘视图
- [`change`](/zh/cli/change) — 创建变更提案
- [`verify`](/zh/cli/verify) — 运行 Gate 3.6 验收
- [可编排研发流程](/zh/concepts/orchestratable-flow) — 门、循环与两档授权
