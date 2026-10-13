---
title: "openlogos deploy-done"
description: 在 verify 通过且人工确认部署后，受控地记录部署完成（Gate 3.7）。
---

在 `verify` 通过（Gate 3.6）且人工确认部署之后，`openlogos deploy-done` 以受控方式记录部署完成，对应 **Gate 3.7**（部署完成、部署报告已生成、部署标记已写入）。它会复核 verify 是否通过、提案是否确实需要部署、`[deploy]` 任务与部署报告是否存在——全部满足后才勾选部署任务、写入 `DEPLOY_DONE` marker，并清理遗留的 smoke marker。

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

项目 `locale` 为 `zh` 时输出中文：

```
OpenLogos deploy-done

  提案：add-notify-webhook
  环境：staging
  标记：logos/changes/add-notify-webhook/DEPLOY_DONE
  部署任务：3/3
  已清理过期 smoke 标记：-

下一步：明确授权执行 `openlogos smoke --env staging`。
```

提案不需要 smoke 时，最后一行改为建议 `openlogos archive <slug>`。

## 错误

| 错误码 | 原因 | 处理 |
|--------|------|------|
| `PROJECT_NOT_INITIALIZED` | 不在项目根目录 | `cd` 到项目根目录 |
| `NO_ACTIVE_CHANGE` / `CHANGE_NOT_FOUND` | 没有活跃提案，或提案目录不存在 | 仅在活跃提案 verify 通过后执行 |
| `VERIFY_NOT_PASSED` | verify 未通过（或 `cmd:` 形式的 verify 门失败） | 运行 `openlogos verify` 并解决 `VERIFY_FAIL` |
| `DEPLOYMENT_DECISION_CONFLICT` | `proposal.md` 与 `tasks.md` 的部署决策不一致 | 修正部署决策 |
| `DEPLOYMENT_NOT_REQUIRED` | 当前提案不需要部署 | verify 通过后直接归档 |
| `DEPLOY_TASKS_MISSING` | `tasks.md` 中没有非空 `[deploy]` section | 补充部署任务 |
| `DEPLOYMENT_REPORT_MISSING` | 缺少 `logos/resources/verify/deployment-report.md` | 先生成部署报告（deployment-executor） |

任一检查失败时，不勾选任务、不写标记。

## 相关命令

- [`verify`](/zh/cli/verify) — Gate 3.6 验收（须先通过）
- [`smoke`](/zh/cli/smoke) — 部署后健康检查（Gate 3.8）
- [`archive`](/zh/cli/archive) — 归档已完成的提案
