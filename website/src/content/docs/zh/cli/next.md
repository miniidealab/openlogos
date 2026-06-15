---
title: "openlogos next"
description: 为当前 OpenLogos 项目展示最值得立即执行的单条下一步操作。
---

返回开发者或 AI 助手接下来应当采取的操作。它使用与 `status` 相同的阶段和提案状态检测逻辑，但将结果压缩为一条可执行的指令。

## 命令格式

```bash
openlogos next [--module <id>] [--format json]
```

必须在项目根目录下运行。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--module <id>` | 将建议聚焦到单个模块。 |
| `--format json` | 输出结构化 JSON，供 RunLogos 等工具使用。 |

## 功能说明

- 为 initial 模块建议下一个阶段的提示词
- 为没有活跃提案的 launched 模块建议 `openlogos change <slug>`
- 跟踪活跃提案的步骤：填写提案、编写 delta、merge、编码、verify、archive
- 当其他模块持有活跃 guard 时，报告被阻塞的模块

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
