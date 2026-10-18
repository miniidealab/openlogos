---
title: "openlogos deploy"
description: 按 logos/environments.yaml 中环境的部署配置执行部署，写入部署账本，并可回滚到上一个版本。
---

`openlogos deploy` 按环境在 `logos/environments.yaml` 中 `deploy` 下声明的方式执行部署，把结果写入本机部署账本；在提案通道下还会替你写部署报告与 `DEPLOY_DONE` 标记。它同时执行该环境的晋级与审批门禁。登记表格式见[环境登记表](/zh/specs/environments)。

## 命令格式

```bash
openlogos deploy --env <id|alias> [--ref <revision>] [--rollback] [--channel proposal|version] [--dry-run] [--format json]
openlogos deploy --env <id|alias> --complete <deploy_id> --result done|failed [--format json]   # agent 方式
openlogos deploy --env <id|alias> --abandon <deploy_id> [--format json]                         # 放弃未决记录
openlogos deploy --env <id|alias> --reconcile [--format json]                                   # 补记结果未知的 CI 部署
```

要求存在 `logos/environments.yaml`、目标环境配置了 `deploy`，且项目是 git 仓库。在项目根目录下运行。

## 选项

| 选项 | 说明 |
|------|------|
| `--env <id\|alias>` | 目标环境（必填；不做「只有一个环境就默认选它」的推断）。 |
| `--ref <revision>` | 要部署的版本，解析为完整 commit。版本通道必填；提案通道默认 `HEAD`。 |
| `--rollback` | 重新部署该环境的 `previous_ref`（版本通道），与 `--ref` 互斥。 |
| `--channel proposal\|version` | 显式指定通道。 |
| `--dry-run` | 完成全部检查并输出执行计划（通道、commit、脚本或工作流、参数展开结果），不建工作树、不执行、不写任何文件。 |
| `--force-promote "<理由>"` | 留痕越过晋级检查。**只能由人执行**，见下文。 |
| `--complete <deploy_id> --result done\|failed` | agent 方式：写入执行者完成部署后的结果。 |
| `--abandon <deploy_id>` | 解除不会再结束的未决记录（agent 或 CI），记为 `result=unknown`、`failure_reason=abandoned`。 |
| `--reconcile` | 查询结果未知的部署对应的远程 CI 运行，补记终态。 |
| `--format json` | 输出结构化 JSON 信封。 |

## 执行方式

| `deploy.mode` | CLI 的行为 |
|---------------|-----------|
| `script` | 以 `git worktree add --detach` 在隔离工作树中检出请求 commit，在其中以参数数组（不经 shell）执行仓库内脚本。工作树里没有未跟踪文件，脚本需自行安装依赖与构建。`workdir: in-place` 改为在项目目录执行，但仅当 `HEAD` 等于请求 commit 且工作区干净时允许。 |
| `ci` | `provider: github-actions` 用 `gh` 调度工作流，从调度响应取得运行身份并轮询到结束；`provider: script` 通过触发脚本与状态脚本适配其他 CI。只有运行回报了实际部署的 commit，版本才算已确认。 |
| `agent` | 登记未决记录并返回部署方案章节（`status: awaiting-agent`），执行者按方案完成后执行 `--complete <deploy_id> --result done\|failed`。 |

所有方式都向子进程注入 `OPENLOGOS_DEPLOY_ENV`、`OPENLOGOS_DEPLOY_REF`（请求 commit）、`OPENLOGOS_DEPLOY_ID`、`OPENLOGOS_DEPLOY_CHANNEL`。`deploy` 配置只能引用仓库内被跟踪的脚本与 `.github/workflows` 下的工作流，不能写命令字符串——因此改变部署实际执行的内容，必然要修改受 guard 保护的文件。

## 通道

- **提案通道**——活跃提案已到可部署阶段时的默认通道。执行前检查提案（verify 已通过、需要部署、存在 `[deploy]` 任务）。`script` / `ci` 方式执行后向 `logos/resources/verify/deployment-report.md` 追加一节部署报告；成功时勾选 `[deploy]` 并写 `DEPLOY_DONE`，之后无需再执行 `deploy-done`。
- **版本通道**——其余情况的默认通道。按 `--ref`（或 `--rollback`）部署，不依附提案，结果只进账本与部署日志。

## 回滚

```bash
openlogos deploy --env staging --rollback
```

重新部署该环境的 `previous_ref`，执行的是那个版本自己的脚本；账本记录 `rollback: true` 与 `rollback_from`。回滚到更早的版本直接用 `--ref`。没有部署快照——回滚就是又一次部署。

## 晋级与审批门禁

环境可声明两道门禁（见[环境登记表](/zh/specs/environments)）：

- `promote_from: <上游环境 id>`——请求 commit 必须已在上游环境通过**已验证**的 smoke，否则以 `DEPLOY_PROMOTION_UNVERIFIED` 结束，零执行。
- `require_approval: true`——该 commit 须有 [`openlogos approve`](/zh/cli/approve) 写入的未使用审批，否则以 `DEPLOY_APPROVAL_REQUIRED` 结束；`error.details.approve_command` 给出可由人直接执行的命令原文。一份审批被一次成功部署使用。

`--force-promote "<理由>"` 只越过晋级检查，并记录 `promotion_override_reason`。`openlogos approve` 与 `deploy --force-promote` 都是 **guard 受限命令**：AI 助手不经宿主原生审批无法执行，无人值守的 `--auto` 运行停在这两道门前，不会自动放行。

## 日志与密钥

完整输出写入 `logos/.openlogos-runtime/deploy-logs/<deploy_id>.log`；文本模式实时输出到终端，JSON 模式只带末尾 80 行或 8 KiB 并给出 `log_path`。密钥只从进程环境提供；凡是该环境 `secrets` 声明的变量值，在捕获的输出、日志与 JSON 中一律替换为 `***`（不足 4 个字符的值不替换）。

同一环境同一时间只允许一次部署（`DEPLOY_IN_PROGRESS`）。结果未知的 CI 部署会一直占用环境，直到 `--reconcile` 补记终态或 `--abandon` 解除。

## 示例

```bash
openlogos deploy --env staging --ref v1.2.0 --dry-run
openlogos deploy --env staging --ref v1.2.0
openlogos deploy --env prod --ref v1.2.0 --format json
```

## 错误码

| 错误码 | 原因 |
|--------|------|
| `ENV_REGISTRY_NOT_FOUND` / `ENV_REGISTRY_INVALID` | 没有登记表，或登记表非法 |
| `ENV_REQUIRED` / `ENV_UNKNOWN` | 未传 `--env` 或解析不到 |
| `DEPLOY_NOT_CONFIGURED` | 目标环境未配置 `deploy` |
| `DEPLOY_ARGS_CONFLICT` | 参数互斥或组合非法（如同时给出 `--ref` 与 `--rollback`） |
| `DEPLOY_REF_REQUIRED` / `ENV_REF_UNRESOLVED` | 版本通道未给 `--ref` / `--rollback`，或版本无法解析 |
| `DEPLOY_ROLLBACK_TARGET_MISSING` | `--rollback` 但没有 `previous_ref` |
| `DEPLOY_PROMOTION_UNVERIFIED` | 晋级检查未通过，零执行 |
| `DEPLOY_APPROVAL_REQUIRED` | 该 commit 没有未使用的审批，零执行 |
| `DEPLOY_SECRETS_MISSING` | 声明的密钥变量未设置（只列名字） |
| `DEPLOY_SCRIPT_MISSING` / `DEPLOY_SCRIPT_NOT_EXECUTABLE` | 请求 commit 中脚本不存在或不可执行 |
| `DEPLOY_WORKTREE_MISMATCH` | `workdir: in-place` 时 `HEAD` 不一致或有未提交改动 |
| `DEPLOY_CI_UNAVAILABLE` / `DEPLOY_CI_REF_NOT_DISPATCHABLE` | `gh` 不可用或未登录，或调度 ref 解析出的 commit 不等于请求 commit |
| `DEPLOY_IN_PROGRESS` | 环境正被另一次部署占用 |
| `DEPLOY_PENDING_NOT_FOUND` | `--complete` / `--abandon` / `--reconcile` 找不到对应的未决记录 |
| `DEPLOY_FAILED` | 部署已执行但失败（记为 `result=failed`） |
| `DEPLOY_RESULT_UNKNOWN` | 已触发但结果未知（记为 `result=unknown`，环境保持占用） |
| `DEPLOY_RECORD_FAILED` | 已部署但账本或标记写入失败——按提示重新执行以补记 |

警告 `DEPLOY_REF_UNCONFIRMED`（部署成功但实际版本未确认）与 `DEPLOY_WORKTREE_CLEANUP_FAILED` 不影响退出码。

## 相关命令

- [`env`](/zh/cli/env) —— 查看环境、`current_ref` 与 `previous_ref`
- [`approve`](/zh/cli/approve) —— 为受门环境批准某个 commit
- [`smoke`](/zh/cli/smoke) —— 以 `--env` 验证部署
- [`deploy-done`](/zh/cli/deploy-done) —— 记录在 `openlogos deploy` 之外完成的部署
- [deployment-executor](/zh/skills/deployment-executor) —— 驱动部署的 Skill
