---
title: "openlogos deploy-done"
description: 在 verify 通过且人工确认部署后，受控地记录部署完成。
---

在 `verify` 通过且人工确认部署之后，`deploy-done` 以受控方式记录部署完成。它会复核 verify 是否通过、提案是否确实需要部署、部署方案与部署报告是否存在——全部满足后才勾选部署任务、写入 `DEPLOY_DONE` marker，并清理遗留的 smoke marker。

## 命令格式

```bash
openlogos deploy-done [--env <name>] [--format json]
```

必须在项目根目录下运行，且存在活跃变更提案（guard 文件存在）。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--env <name>` | 随完成记录一并保存的目标环境标签（例如 `staging`）。 |
| `--format json` | 输出结构化 JSON 信封，供 RunLogos 等工具使用。 |

## 功能说明

- 确认 verify 已通过——按 resolved `verify` 节点的 per-field 谓词求值（marker `VERIFY_PASS`/`VERIFY_FAIL`，或 `cmd:`-gate），取代硬编码的 marker 检查
- 要求存在活跃提案，且其部署决策解析为「需要部署」（决策冲突或无需部署时失败）
- 要求 `tasks.md` 中存在 `[deploy]` 任务 section，且部署报告位于 `logos/resources/verify/deployment-report.md`
- 勾选 `tasks.md` 中 `[deploy]` section 的每一项任务
- 写入 `logos/changes/<slug>/DEPLOY_DONE` marker
- 清理上一次运行遗留的 `SMOKE_PASS` / `SMOKE_FAIL` marker
- 报告 `next_step`：`ready-to-smoke`（运行 `openlogos smoke`）或 `deploy-done`（运行 `openlogos archive`）

这是人工触发的一次性命令——任一前置条件缺失即 fail loud，绝不部分记录完成。

## 示例

```bash
openlogos deploy-done --env staging
```

```
Deployment recorded

  Proposal: add-notify-webhook
  Environment: staging
  Marker: logos/changes/add-notify-webhook/DEPLOY_DONE
  Deploy tasks: 3/3 checked

Next: openlogos smoke --env staging
```

## 相关命令

- [`verify`](/zh/cli/verify) — Gate 3.6 验收（须先通过）
- [`smoke`](/zh/cli/smoke) — 部署后健康检查（Gate 3.8）
- [`archive`](/zh/cli/archive) — 归档已完成的提案
