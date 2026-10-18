---
title: "deployment-executor"
description: verify 通过后，在明确的人工授权下执行部署任务，并引导 smoke 验证。
---

在 `openlogos verify` 通过后，依据已合并的部署方案执行部署任务 —— 仅在明确的人工授权下进行。此 Skill 处理 **Phase 3 Step 7**（部署执行），并引导用户走向 `openlogos smoke`（Phase 3 Step 8）。

## 触发条件

- 用户明确请求执行部署
- 用户说「执行部署」「部署到 staging/production」或「按部署方案部署」
- 当前提案的 `tasks.md` 含有 `[deploy]` 段
- 初始阶段 verify 已通过，需要部署到目标环境

## 前置条件

1. **明确的人工授权** —— 部署是一个人工确认点
2. 部署方案存在于 `logos/resources/prd/3-technical-plan/3-deployment/`
3. 当前提案有 `VERIFY_PASS` 标记
4. `tasks.md` 含有 `[deploy]` 段
5. 方案中已声明所需命令、环境变量与回滚策略

如有任一前置条件未满足，此 Skill 停止并说明缺失项。

## 核心能力

1. 阅读部署方案与当前提案的部署任务
2. 将部署任务拆解为可执行的步骤
3. 在关键命令前说明目的、受影响环境与回滚点
4. 执行部署命令并记录结果
5. 生成部署报告
6. 写入部署完成标记
7. 引导用户运行 `openlogos smoke`

## 执行步骤

### Step 1：确认授权

部署是一个人工确认点。必须看到明确的用户意图：
- 「执行部署」
- 「部署到 staging」
- 「按部署方案部署」

不能因为用户说了「继续」或「完成工作流」就自动部署。

### Step 2：阅读部署上下文

阅读：
- `logos/resources/prd/3-technical-plan/3-deployment/*.md`
- 当前提案的 `proposal.md`
- 当前提案 `tasks.md` 的 `[deploy]` 段
- 已合并的主规格

### Step 3：起飞前检查

验证：
- 当前提案为 `VERIFY_PASS`
- 没有未完成的代码任务
- 目标环境定义清晰——存在 `logos/environments.yaml` 登记表时，把你说的目标（如「发布到测试环境」）解析为已登记的环境 id（可借助只读命令 `openlogos env show <别名>`）；解析不到时停止并请你确认，不猜测
- 回滚策略可执行
- 实际要部署的版本明确——CI 部署指定提交或既有制品时以该提交为准，而不是工作区 HEAD

### Step 4：执行部署

Skill 先用 `openlogos env show <id> --format json` 读取目标环境的执行方式。

**目标环境配置了 `deploy.mode: script` 或 `ci`**——由 OpenLogos 执行部署，Skill **不再**手工执行方案中的步骤：

```bash
openlogos deploy --env <id> --dry-run --format json   # 可选：先展示将要执行的内容
openlogos deploy --env <id> --format json
```

提案处于待部署状态时走提案通道：CLI 做可执行性检查、执行脚本或触发并观察 CI、按实际结果追加部署报告，成功后勾选 `[deploy]` 并写 `DEPLOY_DONE`。Skill 不预先手写报告，事后也不再执行 `openlogos deploy-done`。

- `DEPLOY_FAILED`——如实报告 `failure_reason`、`log_path`、输出尾部与回滚建议。不得改用手工部署兜底，不得换环境或换版本重试。
- `DEPLOY_RESULT_UNKNOWN`——报告 CI 运行 URL，稍后用 `openlogos deploy --env <id> --reconcile` 补记；确认远程不会再运行时才 `--abandon <deploy_id>`。
- `DEPLOY_IN_PROGRESS`——停止并报告持有者，不删除锁或未决记录。
- `DEPLOY_RECORD_FAILED`——已部署但记录失败：按 `details` 重新执行 `deploy`（或 `deploy-done --env --ref`）补记，不手写 marker。
- `DEPLOY_PROMOTION_UNVERIFIED`——「晋级未满足」：停止，给出上游最近一个已验证版本（`details.upstream_candidate_ref`）由你决定。
- `DEPLOY_APPROVAL_REQUIRED`——「等待审批」：停止，把 `details.approve_command` 原文交给你自行执行（Claude Code 中用 `! <命令原文>`，或经 RunLogos 界面），审批写入后再重新执行本步。

**任何模式（含 `--auto`）**下，Skill 都不会自行执行 `openlogos approve`、不会加 `--force-promote`、不会换环境或换版本、不会为越过门禁改用手工部署或 `deploy-done`，也不会修改 `logos/environments.yaml` 关闭门禁。

**目标环境配置了 `deploy.mode: agent`**——两段式：`openlogos deploy --env <id>` 返回 `status: awaiting-agent`、`deploy_id` 与方案章节；Skill 按该章节逐项执行并写报告，再以 `openlogos deploy --env <id> --complete <deploy_id> --result done`（或 `--result failed`，或 `--abandon <deploy_id>`）记录结果。

**没有登记表，或目标环境未配置 `deploy`**——沿用既有做法逐项执行方案：每步说明将发生什么、影响哪个环境，只执行方案中定义的命令，记录结果，失败时建议回滚或修复。

### Step 5：生成部署报告

`logos/resources/verify/deployment-report.md`：
- **script / ci**：由 `openlogos deploy` 按实际结果自动追加（时间、环境、通道与方式、`deploy_id`、请求与已确认的版本、脚本或工作流与运行 URL、耗时、结果、日志路径、回滚点）。Skill 可补充 CLI 无法得知的内容（人工业务检查、未解决风险），但不改写 CLI 写出的结果。
- **agent，或未配置 `deploy`**：由 Skill 写入——已执行的步骤、每步成败、耗时与环境细节、警告与需人工跟进的事项。

### Step 6：记录完成

- **script / ci / agent**：`openlogos deploy`（或 `--complete … --result done`）在提案通道下已完成落标，Skill 只核对输出中的 `proposal.marker_path` 与 `ledger_written`。
- **未配置 `deploy`**：Skill 执行 [`openlogos deploy-done`](/zh/cli/deploy-done)。有登记表时必须传入解析后的环境与实际部署的版本：`openlogos deploy-done --env staging --ref <revision>`；确实无法确认实际版本时不传 `--ref`，之后的 smoke 不会算作已验证。
- 部署失败后：不执行 `deploy-done`，不手写 `DEPLOY_DONE`。

### Step 7：引导 Smoke 验证

部署成功后：
- 提醒用户 `openlogos smoke` 是下一个人工确认点；有登记表时必须针对同一环境：`openlogos smoke --env <id>`
- 未经明确授权不要自动运行 smoke（`--auto` 下由 standing 授权覆盖）
- 遇到 `SMOKE_ENV_MISMATCH`、`SMOKE_DEPLOY_MARKER_INVALID`、`SMOKE_DEPLOY_SUPERSEDED` 时停止并报告，不手工修补 `DEPLOY_DONE`

## 产出物

| 产出物 | 位置 |
|----------|----------|
| 部署报告 | `logos/resources/verify/deployment-report.md` |
| 提案标记 | `logos/changes/<slug>/DEPLOY_DONE`（如适用） |
| 部署账本记录 | `logos/.openlogos-runtime/deployments.jsonl`（存在登记表时由 CLI 写入） |

## 相关 Skill

- [`deployment-designer`](/zh/skills/deployment-designer) —— 产出此 Skill 执行的方案
- [`test-writer`](/zh/skills/test-writer) —— 设计部署后验证的 smoke 用例
- [`openlogos deploy`](/zh/cli/deploy) / [`openlogos deploy-done`](/zh/cli/deploy-done) / [`openlogos smoke`](/zh/cli/smoke) —— 本 Skill 驱动的命令
