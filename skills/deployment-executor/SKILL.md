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

1. **默认/手动模式**：用户明确授权部署（前置依赖原义；生产环境强烈建议走此路径）。
2. **无人值守 `openlogos next --auto` 模式（受限）**：本次 `next --auto` 响应对 deliver 入口门（`deliver-entry`，`skippable:true`）输出 **`gate_auto_passed === true`** 时，即构成对**本次**部署的放行依据（部署目标可能是测试环境而非生产）。

受限约束（必须遵守）：
- 授权依据是**本次 `--auto` 响应的 `gate_auto_passed === true`**这一 live 决策，**不是** `GATE_AUTO_PASSED` 文件的存在；**历史审计行不构成对后续部署的授权**（与默认 `next` 忽略 `GATE_AUTO_PASSED` 一致）。
- 仍须满足其它前置依赖（`VERIFY_PASS`、部署方案、`[deploy]` section、部署决策无冲突）。
- 仍禁止：跳过部署方案凭经验执行、部署失败后写 `DEPLOY_DONE`、手写 `DEPLOY_DONE`、跳过需要的 smoke。
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
- 部署目标环境是否明确
- 回滚策略是否可执行
- 必要环境变量和密钥是否已由用户确认
- smoke 测试命令是否配置或已有替代说明

### Step 4: 执行部署

按部署方案逐项执行。

每个关键命令前必须说明：

- 命令目的
- 影响环境
- 失败后的中止或回滚方式

不得执行部署方案中没有定义的命令。

### Step 5: 生成部署报告

写入：

`logos/resources/verify/deployment-report.md`

报告包含：

- 部署时间
- 目标环境
- 执行命令摘要
- 迁移结果
- 服务启动结果
- 回滚点
- 未解决风险

### Step 6: 写入部署完成标记

部署成功后：

- 确认 `logos/resources/verify/deployment-report.md` 已写入并记录目标环境、执行命令摘要、回滚点和未解决风险
- 执行受控命令写入部署完成状态：

```bash
openlogos deploy-done
```

如有目标环境：

```bash
openlogos deploy-done --env staging
```

`openlogos deploy-done` 负责：

- 勾选当前提案 `tasks.md` 中的 `[deploy]` 任务
- 写入 `logos/changes/<slug>/DEPLOY_DONE`
- 清理过期的 `SMOKE_PASS` / `SMOKE_FAIL`
- 输出下一步 smoke 或 archive 建议

部署失败时：

- 不得执行 `openlogos deploy-done`
- 不得手写 `DEPLOY_DONE`
- 输出失败点和回滚建议
- 以 `logos/resources/verify/deployment-report.md` 记录失败摘要

### Step 7: 引导 smoke

部署完成后提示用户明确授权运行：

```bash
openlogos smoke
```

如有目标环境：

```bash
openlogos smoke --env staging
```

AI 不得自动运行 `openlogos smoke`，除非用户明确授权。

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
