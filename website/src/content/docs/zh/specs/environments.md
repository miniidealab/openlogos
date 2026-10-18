---
title: 环境登记表
description: 环境登记表 logos/environments.yaml、本机部署账本、smoke 环境证据、晋级与审批门禁，以及 guard 如何保护它们。
---

OpenLogos 可以记录项目的每个版本**部署到了哪里**。在 `logos/environments.yaml` 中登记环境；[`openlogos deploy`](/zh/cli/deploy)、[`deploy-done`](/zh/cli/deploy-done) 与 [`smoke`](/zh/cli/smoke) 把每次部署与 smoke 写入本机账本；[`openlogos env`](/zh/cli/env) 与 `status --format json` 展示结果。

本页是面向用户的摘要，规范性定义见 `logos/spec/environments.md`（由 `init` / `sync` 部署到你的项目中）。

## opt-in 与适用范围

- 环境管理是 **opt-in**：存在 `logos/environments.yaml` 即启用。没有该文件时，`deploy-done`、`smoke`、`status` 的行为与以前完全相同。`openlogos deploy` 与 `openlogos approve` 要求登记表存在。
- 只覆盖**单机**：环境定义进仓库（可共享），部署状态与历史只存在本机运行态目录，不进 git、不做同步。
- 没有写 `promote_from` / `require_approval` 的项目完全不涉及门禁行为。

## 登记表 `logos/environments.yaml`

```yaml
schema_version: 1
proposal_default_env: staging        # 可选：需要部署的提案默认部署到哪个环境
environments:
  - id: staging
    name: 预发环境
    tier: staging
    aliases: [stage, 预发]
    health: https://staging.example.com/healthz
    secrets: [STAGING_DEPLOY_TOKEN]   # 只写变量名，不写值
    deploy:
      mode: script
      script: deploy/deploy.sh
      args: ["{env}", "{ref}"]
  - id: prod
    name: 生产环境
    tier: prod
    aliases: [production, 生产]
    deploy:
      mode: ci
      provider: github-actions
      workflow: deploy.yml
    promote_from: staging
    require_approval: true
```

| 字段 | 说明 |
|------|------|
| `schema_version` | 只接受 `1` |
| `proposal_default_env` | 可选。必须与某个环境的 `id` 完全相等（不接受 alias）。需要部署、又未指定目标环境的提案默认部署到该环境 |
| `environments[].id` | `^[a-z0-9][a-z0-9-]*$`，全表唯一 |
| `name` / `tier` | 必填；`tier` 为 `dev`、`test`、`staging` 或 `prod` |
| `aliases` | 可选；id 与 alias 不区分大小写地全局唯一 |
| `description` / `health` / `version` | 可选；`health` / `version` 为 http(s) 地址，供 `env check --probe` 探测 |
| `secrets` | 可选，部署所需环境变量的**名字** |
| `deploy` | 可选的部署配置——`mode: script \| ci \| agent` 及各方式的引用（`script`、`args`、`workdir`、`timeout_sec`、`provider`、`workflow`、`workflow_ref`、`inputs`、`trigger_script`、`status_script`、`plan_section`）。`run`、`shell` 等命令字符串字段会被拒绝 |
| `promote_from` | 可选，只在配置了 `deploy` 时合法。另一个环境的 `id`，不得指向自身、不得成环 |
| `require_approval` | 可选布尔值，只在配置了 `deploy` 时合法 |

未知字段只产生 `ENV_UNKNOWN_FIELD` 警告。登记表非法（`ENV_REGISTRY_INVALID`）时 `deploy-done`、`smoke`、`deploy` 与 `approve` 拒绝执行（fail-closed），`status` 不崩溃，改为输出 `environment_registry_error`。`promote_from` 与 `require_approval` 必须以普通键名书写，转义写法的键会被拒绝。

## `--env` 解析

- 没有登记表时，`--env <label>` 是自由标签。
- 有登记表时，输入先与各 id、再与各 alias 不区分大小写比较，都不命中报 `ENV_UNKNOWN`。有登记表后 `deploy-done` 与 `smoke` 必须传 `--env`（`ENV_REQUIRED`），不做「只有一个环境就默认选它」的推断。

## `DEPLOY_DONE` 内容

`deploy-done --env <id> [--ref <revision>]` 与 `openlogos deploy` 的提案通道把标记写成一行 JSON：

```json
{"deploy_id":"6f1c…","environment":"staging","ref":"<40 位 commit>","ref_source":"explicit","recorded_at":"2026-10-14T08:00:00.000Z"}
```

`ref` 是实际部署的版本；未传 `--ref` 时为 `null`——不会把当前 `HEAD` 当成部署版本。非空但损坏的标记会让 `smoke` 以 `SMOKE_DEPLOY_MARKER_INVALID` 停止；旧版 CLI 写的空标记仍然接受。

## 部署账本 `deployments.jsonl`

`logos/.openlogos-runtime/deployments.jsonl` 是只追加的本机账本，只由 CLI 写入（AI 编辑工具对该目录恒阻断）：

| `kind` | 写入者 | 主要字段 |
|--------|--------|---------|
| `deploy` | `deploy-done --env`、`openlogos deploy` | `deploy_id`、`ref`（已确认版本）、`ref_requested`、`result`（`done` / `failed` / `unknown`）、`channel`、`mode`、`rollback`、`failure_reason`、`log_path` |
| `smoke` | `smoke --env` | `deploy_id`、`ref`、`result`、`env_evidence`、`fresh_results`、`deploy_env_confirmed`、`verified` |
| `approval` | `openlogos approve` | `approval_id`、`ref`、`approver`、`note` |

smoke 记录只有在以下条件同时满足时才是**已验证**（`verified`）：smoke 通过、环境证据为 `declared`、结果来自本次运行（`fresh_results`）、部署环境已确认、版本已知。只有已验证的 smoke 才算「该 commit 已在该环境通过 smoke」——晋级检查依据的正是它。

账本为每个环境算出 `current_ref`（最近一次成功且版本已确认的部署）与 `previous_ref`（回滚目标）。格式不合法的行被跳过并计入 `corrupt_lines`。

## smoke 环境证据

- `openlogos smoke --env <id>` 以 `OPENLOGOS_SMOKE_ENV=<id>` 运行 `smoke.command`。
- smoke runner 在每条结果行写 `target_environment`，声明它实际验证的环境。
- 任一行声明了别的环境，门禁以 `SMOKE_ENV_EVIDENCE_MISMATCH` 失败；全部行声明了正确环境时证据为 `declared`；有行缺少该字段时为 `missing`——门禁照旧计算，但该次 smoke 不算 `verified`。
- 提案落标后同一环境又被部署过时，smoke 以 `SMOKE_DEPLOY_SUPERSEDED` 停止。

## 晋级与审批

- **晋级**（`promote_from`）：把 commit X 部署到该环境，要求上游环境已有 X 的已验证 smoke，否则 `DEPLOY_PROMOTION_UNVERIFIED`。只检查直接上游。`--rollback` 不做晋级检查；人可以用 `deploy --force-promote "<理由>"` 留痕越过。
- **审批**（`require_approval: true`）：把 commit X 部署到该环境，要求有 [`openlogos approve`](/zh/cli/approve) 写入的 X 的未使用审批，否则 `DEPLOY_APPROVAL_REQUIRED`，并给出可直接执行的 approve 命令。第一次成功部署使用该审批；回滚同样需要审批。
- 两项检查都在任何执行之前进行，取得环境锁后再复核一次。`deploy-done --env` 对受门环境以 `DEPLOY_DONE_GATED_ENV` 拒绝，请改用 `openlogos deploy`。
- 无人值守的 `--auto` 在任何模式下都把「缺审批」「晋级未满足」视为硬停点。AI 不得自行审批、越过晋级、换环境或版本、改用手工部署，也不得修改已配置门禁的登记表来绕过。

## guard 规则

- `logos/environments.yaml` 是 `guard.exempt` 的内置默认：它属于运维配置，修改不需立案。已显式配置 `guard.exempt` 的项目需执行 `openlogos exempt add logos/environments.yaml` 才获得该豁免。
- 登记表一旦出现 `promote_from` 或 `require_approval`（或任何反斜杠字符——此时 guard 无法证明没有门禁），即成为**门禁策略来源**：豁免不再适用，有活跃提案也不放行，AI 对它的直接修改、删除或移动须经宿主原生审批（非交互模式下阻断）。
- `openlogos approve` 与 `openlogos deploy --force-promote` 是 guard 受限命令，只能由人授权。
- `deploy` 只执行仓库内被跟踪的脚本与工作流，它们本就受 guard 保护——改变部署实际执行的内容必然需要立案。

## 相关内容

- [`env`](/zh/cli/env) · [`deploy`](/zh/cli/deploy) · [`approve`](/zh/cli/approve) · [`deploy-done`](/zh/cli/deploy-done) · [`smoke`](/zh/cli/smoke)
- [变更管理](/zh/specs/change-management) · [PreToolUse Guard](/zh/specs/pretooluse-guard)
- [deployment-designer](/zh/skills/deployment-designer) · [deployment-executor](/zh/skills/deployment-executor)
