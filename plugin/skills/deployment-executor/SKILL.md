---
name: deployment-executor
description: "Execute human-confirmed deployment tasks after openlogos verify passes, running openlogos deploy (script / ci / agent) per the merged deployment plan, then guide openlogos smoke. Use only in the deployment execution stage."
---

# Skill: Deployment Executor

> 在 `openlogos verify` 通过后，按已合并的部署方案执行经人类明确确认的部署任务，并引导运行 `openlogos smoke`。该 Skill 只在部署执行阶段使用。

## 触发条件

- 用户明确要求执行部署
- 用户说“按部署方案部署”“执行当前提案的部署任务”“部署到 staging / production”
- 当前提案 `tasks.md` 存在 `[deploy]` section
- Initial 阶段 verify 通过后需要部署到目标环境

## 前置依赖

1. 用户明确授权部署
2. `logos/resources/prd/3-technical-plan/3-deployment/` 中存在部署方案
3. 当前提案已 `VERIFY_PASS`
4. 当前提案 `tasks.md` 中存在 `[deploy]` section
5. 部署所需命令、环境变量和回滚策略已在部署方案中声明

如果任一条件不满足，停止并说明缺少哪一项。

## 部署授权来源（change-flow-redesign）

> 插入到「前置依赖」之后。本节修订「前置依赖」第 1 条与「禁止行为」第 1 条对"部署必须用户明确授权 / 禁止自动部署"的绝对表述，明确在无人值守模式下的**受限授权来源**。

部署执行的授权可来自以下两者之一：

1. **默认 / 手动模式（半自动）**：用户明确授权部署（前置依赖原义；生产环境强烈建议走此路径）。半自动下部署执行、`openlogos smoke` 等仍逐次须人类明确授权，行为**完全不变**。
2. **无人值守 `openlogos next --auto` 模式（全自动 / standing 授权）**：`--auto` 的含义被重定义为一次性的 **standing run-scoped 授权**——用户选择 `--auto` 即在本次运行域内一次性授权全链路自动到底。本次 `next --auto` 响应对 deliver 入口门（`deliver-entry`，`skippable:true`）输出 **`gate_auto_passed === true`** 时，即构成对**本次**部署的放行依据（部署目标可能是测试环境而非生产）。

全自动 `--auto` 下，同一 standing 授权也覆盖"代码已绿后的盖章 / 发布"动作：部署完成后的 `openlogos smoke`、以及更下游的 `git push`（`plugin/bin/guard-check` 的安全白名单本就放行 `git push`，**无需任何 marker / guard 改动**，全自动下纯由指令文本授权）均可经此授权自动执行，无需逐次人类再确认；可跳门每次放行向 `GATE_AUTO_PASSED` 追加一行审计。

受限约束（必须遵守）：
- 授权依据是**本次 `--auto` 响应的 `gate_auto_passed === true`**这一 live 决策，**不是** `GATE_AUTO_PASSED` 文件的存在；**历史审计行不构成对后续部署 / smoke / push 的授权**（与默认 `next` 忽略 `GATE_AUTO_PASSED` 一致）。
- 仍须满足其它前置依赖（`VERIFY_PASS`、部署方案、`[deploy]` section、部署决策无冲突）。
- 仍禁止：跳过部署方案凭经验执行、部署失败后写 `DEPLOY_DONE`、手写 `DEPLOY_DONE`、**跳过需要的 smoke**（全自动只是把 smoke 的"授权"前置到用户选择 `--auto`，并不允许略过 smoke 本身）。
- **硬红线不受 `--auto` 影响**：代码未收敛 / 未绿（`gate:implement:loop-exhausted`）在任何模式下都绝不自动放行，自动放行只发生在"代码已绿"之后。
- **审批与晋级是第二条硬红线**（来源变更 environment-promotion-approval，D14）：目标环境要求审批而该版本未获审批（`DEPLOY_APPROVAL_REQUIRED`），或晋级检查未通过（`DEPLOY_PROMOTION_UNVERIFIED`）时，`--auto` 的 standing 授权**不覆盖**——停止并报告「等待审批」或「晋级未满足」，等人批准后由宿主重新驱动。standing 授权也不覆盖执行 `openlogos approve`、加 `--force-promote` 或修改已配置门禁的 `logos/environments.yaml`；guard 在无人值守模式下会阻断这些调用，不要尝试绕开。
- 部署完成后仍调用 `openlogos deploy-done` 受控落标，不手写 marker。

> 据此，「前置依赖」第 1 条「用户明确授权部署」在 `--auto` 下由「本次响应 `gate_auto_passed=true`」满足；「禁止行为」第 1 条「未经用户明确确认自动部署」的"明确确认"在 `--auto` 下等价于用户选择 `--auto` + 本次放行，而非凭 AI 自行决定。

## 核心能力

1. 读取部署方案和当前提案部署任务
2. 将部署任务拆解为可执行步骤
3. 在关键命令前说明目的、影响环境和回滚点
4. 执行部署命令并记录结果
5. 生成部署报告
6. 写入部署完成标记
7. 引导用户运行 `openlogos smoke`

## 执行步骤

### Step 1: 确认授权

部署是人类确认点。必须看到用户明确表达，例如：

- `执行部署`
- `部署到 staging`
- `按部署方案部署`

不能因为用户说“继续”“按流程走完”而自动部署。

### Step 2: 读取部署上下文

必须读取：

- `logos/resources/prd/3-technical-plan/3-deployment/*.md`
- 当前提案 `proposal.md`
- 当前提案 `tasks.md` 的 `[deploy]` section
- 已合并后的相关主规格

### Step 3: 执行前检查

检查：

- 当前是否 `VERIFY_PASS`
- 是否存在未完成代码任务
- 部署目标环境是否明确：项目存在 `logos/environments.yaml` 时，把用户所说的目标（如「发布到测试环境」）按 id 或别名解析为登记表中的环境 id（可先运行只读命令 `openlogos env show <别名>` 确认）；解析不到时停止并请用户确认，不得自行猜测或默认选一个环境
- 回滚策略是否可执行
- 必要环境变量和密钥是否已由用户确认
- smoke 测试命令是否配置或已有替代说明
- 实际要部署的版本（git revision）是否明确：部署 CI 指定提交或既有制品时，以该提交为准，而不是当前工作区 HEAD

### Step 4: 执行部署

先确定目标环境的执行方式（来源变更 environment-deploy，见 `spec/environments.md` §11）：项目存在 `logos/environments.yaml` 时运行只读命令 `openlogos env show <id> --format json`，读取 `deploy_mode`。

**目标环境配置了 `deploy.mode: script` 或 `ci`**——调用 OpenLogos 执行部署，**不得再手工执行部署方案中的步骤**：

```bash
openlogos deploy --env <id> --format json
```

- 提案处于 ready-to-deploy 时默认走提案通道：CLI 自己做可执行性检查、执行脚本或触发并观察 CI、按实际结果写部署报告、成功后勾选 `[deploy]` 并写 `DEPLOY_DONE`。不要预先手写部署报告，也不要再执行 `openlogos deploy-done`。
- 关键命令前说明目的、影响环境与失败后的处置；可先运行 `openlogos deploy --env <id> --dry-run --format json` 向用户展示将要执行的内容。
- 失败（`DEPLOY_FAILED`）时如实上报 `details`（`failure_reason`、`log_path`、输出尾部）与回滚建议，**不得改用手工部署兜底**，不得换环境或换版本重试。
- 结果未知（`DEPLOY_RESULT_UNKNOWN`，CI 观察超时或缺运行身份）时报告运行 URL，等待用户或稍后以 `openlogos deploy --env <id> --reconcile` 补记；确认远程不会再运行时才可 `--abandon <deploy_id>`。
- `DEPLOY_IN_PROGRESS` 时停止并报告持有者，不得删除锁或未决记录。
- `DEPLOY_RECORD_FAILED` 表示已部署但记录失败：按 `details` 提示重新执行 `deploy` 或 `deploy-done --env --ref` 补记，不得手写 marker。
- `DEPLOY_REF_UNCONFIRMED` 警告表示 CI 没有回报实际部署的提交，部署版本记为未知；如实告知用户，后续 smoke 不会得到已验证事实。
- **晋级与审批门**（来源变更 environment-promotion-approval，见 `spec/environments.md` §12）：
  - `DEPLOY_PROMOTION_UNVERIFIED`：该版本尚未在上游环境（`details.promote_from`）以 smoke 验证。停止并报告「晋级未满足」，给出 `details.upstream_candidate_ref`（上游最近一个已验证版本）供用户决定；不得自行先部署上游再继续，除非部署方案与用户明确要求。
  - `DEPLOY_APPROVAL_REQUIRED`：该环境要求审批而该版本未获审批。停止并报告「等待审批」，把 `details.approve_command` 原文交给用户，由用户在终端以 `! <命令原文>` 执行或经 RunLogos 界面批准；审批写入后再重新执行本步。
  - **任何模式（含 `--auto`）下都不得**：自行执行 `openlogos approve`、给 `deploy` 加 `--force-promote`、换环境或换版本、改用手工部署、改用 `deploy-done`（受门环境会以 `DEPLOY_DONE_GATED_ENV` 拒绝）、修改 `logos/environments.yaml` 关闭门禁。`--force-promote` 只能由用户本人带理由执行。

**目标环境配置了 `deploy.mode: agent`**——两段式：

1. 执行 `openlogos deploy --env <id> --format json`，得到 `status: awaiting-agent`、`deploy_id` 与部署方案章节（`plan.plan_section`）。
2. 按该章节逐项执行（每个关键命令前说明目的、影响环境与失败处置；不得执行方案中没有定义的命令），按 Step 5 写部署报告。
3. 成功执行 `openlogos deploy --env <id> --complete <deploy_id> --result done`；失败执行 `--result failed` 并输出失败点与回滚建议；放弃执行 `--abandon <deploy_id>`。不再单独执行 `openlogos deploy-done`。

**项目没有登记表，或目标环境未配置 `deploy`**——沿用既有做法：按部署方案逐项执行。每个关键命令前必须说明命令目的、影响环境、失败后的中止或回滚方式；不得执行部署方案中没有定义的命令；完成后按 Step 5、Step 6 写报告并落标。

### Step 5: 生成部署报告

写入：

`logos/resources/verify/deployment-report.md`

- **script / ci 方式**：部署报告由 `openlogos deploy` 在执行结束后按实际结果自动追加（来源变更 environment-deploy），本 Skill 不再手写；可在报告末尾补充 CLI 无法得知的信息（如人工确认的业务检查、未解决风险），不得改写 CLI 写出的结果。
- **agent 方式与未配置 `deploy` 的环境**：由本 Skill 写入，报告包含：
  - 部署时间
  - 目标环境
  - 执行命令摘要
  - 迁移结果
  - 服务启动结果
  - 回滚点
  - 未解决风险

### Step 6: 写入部署完成标记

**script / ci 方式**：`openlogos deploy` 的提案通道成功时已完成落标（勾选 `[deploy]`、写 `DEPLOY_DONE`、追加账本），本步骤只核对输出中的 `proposal.marker_path` 与 `ledger_written`，不再执行 `openlogos deploy-done`。

**agent 方式**：`openlogos deploy --complete <deploy_id> --result done` 在提案通道下同样完成落标（要求部署报告已写出），不再执行 `openlogos deploy-done`。

**项目没有登记表，或目标环境未配置 `deploy`**——部署成功后：

- 确认 `logos/resources/verify/deployment-report.md` 已写入并记录目标环境、执行命令摘要、回滚点和未解决风险
- 执行受控命令写入部署完成状态：

```bash
openlogos deploy-done
```

如有目标环境：

```bash
openlogos deploy-done --env staging
```

项目存在 `logos/environments.yaml` 时**必须**传入解析后的环境 id，并用 `--ref` 声明这次实际部署的版本（environment-registry，见 `spec/environments.md` §4）：

```bash
openlogos deploy-done --env staging --ref <实际部署的 git revision>
```

- `--ref` 取实际部署的提交（CI 指定提交、制品对应提交），不要默认填当前 HEAD；确实无法确认实际版本时不传 `--ref`，版本记为未知，基于该部署的 smoke 不会被视为「已验证」。
- 遇到 `ENV_UNKNOWN` / `ENV_REQUIRED` / `ENV_REF_UNRESOLVED` 时停止并向用户报告，不得改用其他环境或其他 revision 重试。

`openlogos deploy-done` 负责：

- 勾选当前提案 `tasks.md` 中的 `[deploy]` 任务
- 写入 `logos/changes/<slug>/DEPLOY_DONE`（单行 JSON，含环境与版本）
- 传入 `--env` 时向本机账本 `logos/.openlogos-runtime/deployments.jsonl` 追加部署记录
- 清理过期的 `SMOKE_PASS` / `SMOKE_FAIL`
- 输出下一步 smoke 或 archive 建议

部署失败时（任何方式）：

- 不得执行 `openlogos deploy-done`
- 不得手写 `DEPLOY_DONE`
- 输出失败点和回滚建议
- 部署报告记录失败摘要（script / ci 方式由 `openlogos deploy` 自动写入）

### Step 7: 引导 smoke

部署完成后提示用户明确授权运行：

```bash
openlogos smoke
```

如有目标环境：

```bash
openlogos smoke --env staging
```

项目存在 `logos/environments.yaml` 时必须传入与部署相同的环境；CLI 会把目标环境以 `OPENLOGOS_SMOKE_ENV` 注入 smoke 命令。smoke runner 应在结果行写入 `target_environment`（其实际验证的环境 id，见 `spec/test-results.md`「Smoke 结果与覆盖预检」）；结果声明不一致时门禁 FAIL，缺少声明时该次结果不算「已在该环境验证」。遇到以下错误时停止并报告，不得手写或修补 `DEPLOY_DONE`：

- `SMOKE_ENV_MISMATCH`：部署与 smoke 的目标不一致。
- `SMOKE_DEPLOY_MARKER_INVALID`：确认真实部署环境与版本后重新落标（script / ci 方式重新执行 `openlogos deploy`，其余执行 `openlogos deploy-done`）。
- `SMOKE_DEPLOY_SUPERSEDED`（来源变更 environment-deploy）：提案落标之后该环境又被部署过（如版本通道发布），环境上运行的已不是本提案部署的版本；需在提案通道重新部署后再执行 smoke。

**半自动 / 手动模式**：AI 不得自动运行 `openlogos smoke`，除非用户明确授权。

**全自动 `openlogos next --auto` 模式**：`smoke` 属"代码已绿后的盖章"动作，由用户选择 `--auto` 的 standing 授权覆盖，可经编排器凭本次 `next --auto` 响应的 `gate_auto_passed=true` 自动执行（放行时写 `GATE_AUTO_PASSED` 审计），无需逐次人类再确认；唯部署 / 代码本身未绿时不在此列。

## 禁止行为

- 未经用户明确确认自动部署
- 跳过部署方案，凭经验执行命令
- 自动执行涉及生产、远程服务器、密钥、发布、域名或数据迁移的命令
- 部署失败后执行 `openlogos deploy-done`
- 手写 `logos/changes/<slug>/DEPLOY_DONE` 作为推荐路径
- 部署后直接 archive，跳过需要的 `openlogos smoke`

## 推荐提示词

- `按部署方案部署到 staging`
- `执行当前提案的部署任务`
- `部署完成后帮我准备 smoke 命令`
