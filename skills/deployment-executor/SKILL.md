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

- 勾选当前提案 `tasks.md` 中的 `[deploy]` 任务
- 写入 `logos/changes/<slug>/DEPLOY_DONE`

部署失败时：

- 不得写入 `DEPLOY_DONE`
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
- 部署失败后写入 `DEPLOY_DONE`
- 部署后直接 archive，跳过 `openlogos smoke`

## 推荐提示词

- `按部署方案部署到 staging`
- `执行当前提案的部署任务`
- `部署完成后帮我准备 smoke 命令`
