---
title: "openlogos deploy-done"
description: 在 verify 通过且人工确认部署后，受控地记录部署完成（Gate 3.7）。
---

在 `verify` 通过（Gate 3.6）且人工确认部署之后，`openlogos deploy-done` 以受控方式记录部署完成，对应 **Gate 3.7**（部署完成、部署报告已生成、部署标记已写入）。它会复核 verify 是否通过、提案是否确实需要部署、`[deploy]` 任务与部署报告是否存在——全部满足后才勾选部署任务、写入 `DEPLOY_DONE` marker，并清理遗留的 smoke marker。

## 命令格式

```bash
openlogos deploy-done [--env <name>] [--ref <git revision>] [--format json]
```

必须在项目根目录下运行，且存在活跃变更提案（guard 文件存在）。

`deploy-done` 记录的是由别处完成的部署（人工、CI 流水线、tag 驱动的发布）。环境在 `logos/environments.yaml` 中配置了 `deploy` 时，优先使用 [`openlogos deploy`](/zh/cli/deploy)：在提案通道下它会执行部署并一步完成落标。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--env <name>` | 随完成记录一并保存的目标环境（例如 `staging`）。没有登记表时是自由标签；存在 `logos/environments.yaml` 时必须是环境 id 或别名，且**必填**。 |
| `--ref <git revision>` | 实际部署的版本（tag、分支或 commit），解析为 40 位完整 commit 后写入 `DEPLOY_DONE` 与部署账本。不传时版本记为未知（`null`），不会用调用时的 HEAD 代替。 |
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

## 环境登记表与部署账本

项目存在 `logos/environments.yaml` 登记表时（见[环境登记表](/zh/specs/environments)）：

- `--env` 先与环境 id、再与别名不区分大小写地匹配；匹配不到报 `ENV_UNKNOWN`，未传报 `ENV_REQUIRED`。不做「只有一个环境就默认选它」的推断。
- `DEPLOY_DONE` 写为单行 JSON，每次运行整体重写：

  ```json
  {"deploy_id":"6f1c…","environment":"prod","ref":"<40 位 commit>","ref_source":"explicit","recorded_at":"2026-10-14T08:00:00.000Z"}
  ```

- 向本机部署账本 `logos/.openlogos-runtime/deployments.jsonl` 追加一条 deploy 记录（与 `smoke --env`、`deploy`、`env` 共用同一账本）。先写账本、最后写 `DEPLOY_DONE`，因此 marker 在场即意味着账本记录已写入；任一步失败时恢复任务勾选、marker 与本次账本行，并以 `DEPLOY_DONE_WRITE_FAILED` 结束。
- `--format json` 新增 `deployment` 对象（`deploy_id`、`environment`、`ref`、`ref_source`、`observed_head`、`ledger_written`）。
- 配置了晋级或审批门禁（`promote_from`，或 `require_approval: true`）的环境不能手工落标：`deploy-done --env` 以 `DEPLOY_DONE_GATED_ENV` 拒绝。这类环境请用 [`openlogos deploy`](/zh/cli/deploy) 部署，它会先检查门禁。

没有登记表时，`deploy-done` 的行为与以前完全一致：`--env` 只作为普通标签保存，不写账本。

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
| `ENV_REGISTRY_INVALID` | `logos/environments.yaml` 存在但不合法 | 修正登记表；`openlogos env check` 会逐条列出问题 |
| `ENV_REQUIRED` / `ENV_UNKNOWN` | 有登记表但未传 `--env`，或传入值匹配不到任何 id / 别名 | 传入已登记的 id 或别名 |
| `ENV_REF_UNRESOLVED` | `--ref` 无法解析为 commit | 传入存在的 tag、分支或 commit |
| `DEPLOY_DONE_GATED_ENV` | 目标环境配置了 `promote_from` 或 `require_approval: true` | 改用 `openlogos deploy --env <id>` |
| `DEPLOY_DONE_WRITE_FAILED` | 检查通过后某个写入步骤失败 | 按消息确认已恢复的内容后重跑 |

任一检查失败时，不勾选任务、不写标记、不写账本。

## 相关命令

- [`verify`](/zh/cli/verify) — Gate 3.6 验收（须先通过）
- [`smoke`](/zh/cli/smoke) — 部署后健康检查（Gate 3.8）
- [`deploy`](/zh/cli/deploy) — 按环境配置执行部署
- [`env`](/zh/cli/env) — 查看各环境当前运行的版本
- [`archive`](/zh/cli/archive) — 归档已完成的提案
