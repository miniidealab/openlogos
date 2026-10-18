---
title: "openlogos approve"
description: 为部署前要求审批的环境批准某一个 commit。只能由人执行。
---

`openlogos approve` 为 `logos/environments.yaml` 中写了 `require_approval: true` 的环境记录一条人工审批，批准把一个确切的 commit 部署到该环境。没有匹配的未使用审批时，[`openlogos deploy`](/zh/cli/deploy) 会以 `DEPLOY_APPROVAL_REQUIRED` 拒绝部署该环境。

## 命令格式

```bash
openlogos approve --env <id|alias> --ref <revision> [--note <文字>] [--format json]
```

在项目根目录下运行，不要求活跃提案。

## 选项

| 选项 | 说明 |
|------|------|
| `--env <id\|alias>` | 目标环境（必填），必须配置了 `require_approval: true`。 |
| `--ref <revision>` | 要批准的 commit（必填），经 `git rev-parse <revision>^{commit}` 解析为 40 位完整 commit。 |
| `--note <文字>` | 可选备注，随审批保存。 |
| `--format json` | 输出结构化 JSON 信封。 |

## 功能说明

- 向本机部署账本 `logos/.openlogos-runtime/deployments.jsonl` 写入一条 `kind=approval` 记录：新的 `approval_id`、commit、`--ref` 原文、审批人（`git config user.name <user.email>`，只作展示，不作身份认证）与备注。
- **幂等**：该环境已有同一 commit 的未使用审批时，返回那份审批并标 `created=false`，不写新行；并发执行只写出一条。
- 审批绑定一个确切的 commit，**被该 commit 部署到该环境的第一次成功部署使用**。再次部署同一 commit 需要重新审批；其他 commit 的审批不能放行它。失败或结果未知的部署不使用审批。
- 不提供撤销与过期。

`openlogos env show <id>` 在 `open_approvals` 下列出未使用的审批。

## 只能由人执行

`openlogos approve` 是 **guard 受限命令**。AI 助手试图执行时，宿主会弹出原生审批（无人值守模式下直接阻断）。请自己在终端执行——例如在 Claude Code 中输入 `! openlogos approve --env prod --ref v1.2.0`——或在 RunLogos 界面中执行。无人值守的 `--auto` 运行会停在要求审批的环境前，你完成审批并重新驱动后即可继续。

## 示例

```bash
openlogos approve --env prod --ref v1.2.0 --note "发布检查单已签字"
```

```json
{ "command": "approve", "data": { "environment": "prod", "approval_id": "3b0c…", "created": true, "ref": "<40 位 commit>", "ref_input": "v1.2.0" } }
```

部署前再次执行同一命令，返回同一个 `approval_id`，且 `"created": false`。

## 错误码

| 错误码 | 原因 |
|--------|------|
| `ENV_REGISTRY_NOT_FOUND` / `ENV_REGISTRY_INVALID` | 没有登记表，或登记表非法 |
| `ENV_REQUIRED` / `ENV_UNKNOWN` | 未传 `--env` 或解析不到 |
| `APPROVAL_NOT_REQUIRED` | 目标环境未配置 `require_approval: true` |
| `APPROVAL_REF_REQUIRED` | 未传 `--ref` |
| `ENV_REF_UNRESOLVED` | 版本无法解析为 commit |
| `APPROVAL_WRITE_FAILED` | 追加账本失败（含账本锁等待超时），账本保持不变 |

## 相关命令

- [`deploy`](/zh/cli/deploy) —— 带晋级与审批门禁的部署
- [`env`](/zh/cli/env) —— `open_approvals` 与环境视图
- [环境登记表](/zh/specs/environments) —— `require_approval`、`promote_from` 与账本
