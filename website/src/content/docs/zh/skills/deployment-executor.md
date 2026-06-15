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
- 目标环境定义清晰
- 回滚策略可执行

### Step 4：执行部署

对每个部署步骤：
1. 说明将发生什么、影响哪个环境
2. 执行命令
3. 记录成功/失败与耗时
4. 若发生失败，建议回滚或修复

### Step 5：生成部署报告

写入 `logos/resources/verify/deployment-report.md`：
- 已执行的部署步骤
- 每步的成功/失败状态
- 耗时与环境细节
- 任何警告或需要人工跟进的事项

### Step 6：引导 Smoke 验证

部署成功后：
- 提醒用户 `openlogos smoke` 是下一个人工确认点
- 未经明确授权不要自动运行 smoke

## 产出物

| 产出物 | 位置 |
|----------|----------|
| 部署报告 | `logos/resources/verify/deployment-report.md` |
| 提案标记 | `logos/changes/<slug>/DEPLOY_DONE`（如适用） |

## 相关 Skill

- [`deployment-designer`](/zh/skills/deployment-designer) —— 产出此 Skill 执行的方案
- [`test-writer`](/zh/skills/test-writer) —— 设计部署后验证的 smoke 用例
