---
title: "openlogos flow show"
description: 展示研发流程编排（内置模板或应用 overlay 后的解析结果）。
---

以只读方式将研发流程编排展示为 subflow / node / gate / loop 的树状结构。默认打印内置 flow 模板；加 `--resolved` 则叠加项目的 `logos/flow` overlay，展示 `status`、`next`、`watch` 真正据以派生的生效流程。

## 命令格式

```bash
openlogos flow show [--resolved] [--lifecycle <initial|launched>] [--format json]
```

必须在项目根目录下运行。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--resolved` | 在内置 flow 之上应用项目 overlay，展示合并后的生效编排。不加时展示原始内置 flow。 |
| `--lifecycle <initial\|launched>` | 选择展示哪个 flow。默认根据项目状态推断。 |
| `--format json` | 输出结构化 JSON 信封，供 RunLogos 等工具使用。 |

## 功能说明

- 打印每个 subflow 及其 gate（`human` / `cmd` / 无），并标注 `entry` 位置与 `skippable`
- 列出每个 node 及其 `skill`、`for_each`、`when` 属性
- 在 `--resolved` 模式下，标注 overlay 操作（`[add]` / `[modify]` / `[skip]` / `[reorder]`）并标记被跳过的 node
- 呈现 flow 告警（例如 overlay 的 `@vN` 与当前 `builtin_version` 不匹配）
- JSON 信封携带 `lifecycle`、`resolved`、`overlay_applied`、`builtin_version`、`warnings` 及完整的 `flow` 树

本命令纯观察性：绝不执行 `cmd:` 节点、不写 marker、不推进状态。

## 示例

```bash
openlogos flow show --resolved
```

```
Flow: launched（overlay applied）

▸ implement    gate: human (skippable)
    · code                 code     skill: code-implementor
    · verify               verify   when: code_present
```

## 相关命令

- [`watch`](/zh/cli/watch) — 实时流式输出派生的 dev-flow 状态
- [`next`](/zh/cli/next) — 显示最值得执行的单条下一步
- [`status`](/zh/cli/status) — 完整的仪表盘视图
