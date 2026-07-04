---
title: "openlogos watch"
description: 实时流式输出派生的 dev-flow 状态（status 的实时版）。
---

轮询与 `status` 相同的派生源，把一次性快照变成实时流。它是 `status` 的实时版：启动时先输出一次初始快照，之后仅当派生状态（loop、slice、`next_node`、提案步骤、阶段）真正发生变化时才输出一条事件。只读——绝不写文件、不推进状态、无写副作用。

## 命令格式

```bash
openlogos watch [--interval <seconds>] [--module <id>] [--format json]
```

必须在项目根目录下运行。用 Ctrl-C（SIGINT）退出——它会优雅停止。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--interval <seconds>` | 轮询间隔。默认 `2` 秒。 |
| `--module <id>` | 将流聚焦到单个模块。 |
| `--format json` | 每个事件输出一条 JSON 信封，而非文本摘要。 |

## 功能说明

- 先输出一条初始 `snapshot` 事件（`seq=0`），此后每当派生 data 与上一次 tick 不同即输出一条 `change` 事件（`seq` 递增）
- 变化判定为相邻两次 tick 的深比较（JSON 等价）
- 每条 JSON 载荷携带 `seq`、`event`（`snapshot` | `change`）、`module` 及完整的 `status` 派生
- 遇到 `cmd:` 节点不执行——该节点态保持 `pending`（仅 `next` 会求值 `cmd:` 谓词）
- 遇到 flow 配置错误（`FlowError`）时输出错误信封并停止轮询，而非在损坏的 flow 上空转

## 示例

```bash
openlogos watch --interval 5 --format json
```

```json
{"command":"watch","ok":true,"data":{"seq":0,"event":"snapshot","module":null,"status":{ ... }}}
```

## 相关命令

- [`status`](/zh/cli/status) — 一次性仪表盘快照
- [`next`](/zh/cli/next) — 显示最值得执行的单条下一步
- [`flow show`](/zh/cli/flow-show) — 展示解析后的编排
