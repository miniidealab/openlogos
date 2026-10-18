---
title: "openlogos env"
description: 列出、查看并校验 logos/environments.yaml 中登记的部署环境。
---

`openlogos env` 是项目**环境登记表**（`logos/environments.yaml`）的只读视图：查看每个环境当前部署的版本、最近一次部署与 smoke，并校验登记表。登记表的完整格式见[环境登记表](/zh/specs/environments)。

环境管理是 **opt-in**：项目里没有 `logos/environments.yaml` 时，`deploy-done`、`smoke`、`status` 的输出与退出码与以前完全相同。

## 命令格式

```bash
openlogos env list [--format json]
openlogos env show <id|alias> [--format json]
openlogos env check [<id|alias>] [--probe] [--format json]
```

三个子命令都只读、不要求活跃提案，在项目根目录下运行。

## 子命令

| 子命令 | 说明 |
|--------|------|
| `openlogos env list` | 列出全部已登记环境，含别名、当前版本、最近一次部署与 smoke。登记表不存在时返回空列表（退出码 0）。 |
| `openlogos env show <id\|alias>` | 查看单个环境：登记表配置、下文的视图字段与最近 20 条账本记录（新到旧）。 |
| `openlogos env check [<id\|alias>]` | 校验登记表：格式、id / alias 冲突、`logos-project.yaml` 中 `deployment_gates` 的引用、`secrets` 声明的变量名在当前进程环境中是否存在（只报名字，从不读取或输出值）。 |
| `env check --probe` | 另对各环境的 `health` 与 `version` 地址发 HTTP GET（超时 5 秒）。不加 `--probe` 不发起任何网络请求。 |

登记表不存在时 `env show` 与 `env check` 报 `ENV_REGISTRY_NOT_FOUND`；`env show` 的参数解析不到时报 `ENV_UNKNOWN`。`env check` 发现任一 error 时退出码为 1。

## 提案默认部署环境

登记表顶层写了 `proposal_default_env` 时，需要部署、又没有另行指定目标环境的提案默认部署到该环境（change-writer Skill 直接读取它，不再逐案询问）。

- `openlogos env list --format json` 在 `data` 顶层输出 `proposal_default_env`；未配置时不输出该键。
- 文本模式在该环境行后标注 **（提案默认）**，英文为 `(proposal default)`。

取值必须与某个环境的 `id` 完全相等（不接受 alias）。取值非法时 `env check` 报 `ENV_FIELD_INVALID`（`field=proposal_default_env`），整个登记表按非法处理。

## 环境视图（EnvView）

`env list`、`env show` 与 `status --format json`（`environments` 下）对每个环境输出同一组字段：

| 字段 | 含义 |
|------|------|
| `id` / `name` / `tier` / `aliases` | 来自登记表 |
| `current_ref` | 最近一次**成功**且版本已确认的部署所对应的 commit；从未部署或版本未确认时为 `null` |
| `previous_ref` | `current_ref` 之前的上一个成功版本——`openlogos deploy --rollback` 的目标 |
| `deploy_mode` | 该环境 `deploy` 配置的 `script` / `ci` / `agent`，未配置为 `null` |
| `deploy_in_progress` | 当前占用该环境的部署，没有为 `null` |
| `last_deploy` | 最近一条任意结果的部署记录（`deploy_id`、`slug`、`ref`、`result`、`channel`、`mode`、`ref_requested`、`failure_reason` 等） |
| `last_smoke` | 最近一次 smoke 记录（`result`、`env_evidence`、`fresh_results`、`deploy_env_confirmed`、`verified` 等） |
| `promote_from` / `require_approval` / `open_approvals` / `promotion` | 只在配置了晋级或审批门禁的环境上出现，见 [`deploy`](/zh/cli/deploy) 与 [`approve`](/zh/cli/approve) |

`previous_ref`、`deploy_mode`、`deploy_in_progress` 只在启用部署执行后输出（某个环境配置了 `deploy`，或账本中已有 `openlogos deploy` 写出的记录）。`env show --format json` 另输出该环境经校验的 `deploy` 配置（脚本、工作流、方案章节等引用，不含命令与密钥值）。

## 示例

```bash
openlogos env list
```

```
环境（logos/environments.yaml）

  test  测试环境  [test]  （提案默认）
      别名：测试, qa
      当前版本：02355709cf74
      最近部署：2026-10-16T14:30:37.505Z（add-notify-webhook）
      最近 smoke：pass（已验证），2026-10-16T14:33:27.596Z
  prod  生产环境  [prod]
      别名：生产, production
      当前版本：无
```

```bash
openlogos env check --probe --format json
```

```json
{ "command": "env check", "data": { "scope": null, "ok": true, "errors": [], "warnings": [], "secrets": [], "probes": [] } }
```

## 错误与警告

| 代码 | 原因 |
|------|------|
| `ENV_REGISTRY_NOT_FOUND` | 没有 `logos/environments.yaml` 时执行 `env show` / `env check` |
| `ENV_REGISTRY_INVALID` | 登记表存在但非法（YAML 错误、`schema_version` 不对、字段缺失或非法等） |
| `ENV_FIELD_INVALID` | 单个字段非法（`env check` 逐字段报告） |
| `ENV_DUPLICATE_ID_OR_ALIAS` | id / alias 冲突（不区分大小写） |
| `ENV_GATE_REFERENCE_UNKNOWN` | `deployment_gates.<module>.environments` 引用了未登记的环境 |
| `ENV_SECRET_MISSING` | `secrets` 声明的变量名在当前环境中不存在 |
| `ENV_PROBE_FAILED` | `--probe` 请求失败、超时或返回非 2xx |
| `ENV_UNKNOWN` | id 或 alias 解析不到 |
| `ENV_UNKNOWN_FIELD` | 仅警告：登记表含未知字段 |

## 相关命令

- [`deploy`](/zh/cli/deploy) —— 按环境配置执行部署
- [`approve`](/zh/cli/approve) —— 为要求审批的环境批准某个 commit
- [`deploy-done`](/zh/cli/deploy-done) —— 记录在 `openlogos deploy` 之外完成的部署
- [`smoke`](/zh/cli/smoke) —— 带 `--env` 的部署后检查
- [环境登记表](/zh/specs/environments) —— 登记表格式、账本与门禁
