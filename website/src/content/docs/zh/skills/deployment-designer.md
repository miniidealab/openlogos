---
title: "deployment-designer"
description: 设计部署拓扑、环境配置、发布命令、回滚策略与部署后 smoke 测试计划（Phase 3 Step 3）。
---

在代码实现之前，产出一份完整的部署方案，涵盖部署拓扑、环境配置、发布命令、数据迁移、回滚策略与部署后 smoke 测试设计。此 Skill 是 **Phase 3 Step 3** 的入口。

## 触发条件

- 用户请求设计部署方案、发布方案或上线方案
- 用户提到「Phase 3 Step 3」「deployment plan」或「部署方案」
- API/DB 设计已完成，项目需要进入部署规划
- `logos/resources/prd/3-technical-plan/3-deployment/` 为空

## 前置条件

1. 架构概览存在于 `logos/resources/prd/3-technical-plan/1-architecture/`
2. 场景实现文档存在于 `logos/resources/prd/3-technical-plan/2-scenario-implementation/`
3. API/DB 设计已完成，或模块已通过 `skip_phases` 明确跳过这些阶段
4. `logos/logos-project.yaml` 可读

## 核心能力

1. 从架构、API、DB 与技术栈推导部署目标
2. 为 本地 / 测试 / 预发 / 生产 环境设计部署拓扑
3. 定义环境变量、密钥来源、构建命令与发布命令
4. 定义数据迁移、种子数据与回滚策略
5. 设计部署后验证清单
6. 设计供 `test-writer` 生成 `SMOKE-*` 用例的 smoke 测试输入
7. 更新 `logos-project.yaml` 的部署 gate 信息
8. 产出环境登记表 `logos/environments.yaml`，并为可由 OpenLogos 执行部署的环境写出 `deploy` 条目与部署脚本（见[环境登记表](/zh/specs/environments)）

## 执行步骤

### Step 1：阅读上下文

阅读架构概览、场景文档、API 规格、DB DDL 与现有部署方案。确认项目是否需要部署、存在哪些目标环境、需要哪些 smoke 覆盖。

### Step 2：确定部署 Gate

- 软件项目默认需要部署方案
- 含运行时环境的项目默认需要部署执行与 smoke
- 纯文档、纯规格或库类项目可声明 `deployment_required: false`

### Step 3：输出部署方案

写入 `logos/resources/prd/3-technical-plan/3-deployment/<module>-01-deployment-plan.md`：

- 部署拓扑图（Mermaid）
- 环境矩阵（本地 / 预发 / 生产）
- 构建与发布命令
- 环境变量与密钥
- 数据迁移策略
- 回滚方案
- 部署后清单
- Smoke 测试范围定义

Mermaid 部署拓扑图必须遵循与架构图相同的 `graph` / `flowchart` 语法安全规则：节点标签使用 `ID["标签文本"]` 形式，例如 `Pages["Cloudflare Pages"]`、`Worker["Cloudflare Worker<br/>staging"]`、`PROXY["/voice/api 代理"]`。避免 `PROXY[/voice/api 代理]`，因为 `[/` 是 Mermaid 形状语法，容易导致渲染失败。子图名称含空格、中文或符号时使用 `subgraph "预发环境"`。

### Step 4：更新 logos-project.yaml

写入 `deployment_gates` 段：

```yaml
deployment_gates:
  <module>:
    deployment_required: true
    smoke_required: true
    environments:
      - staging
```

### Step 4.1：产出环境登记表

部署方案涉及具体环境（测试、预发、生产等）时，Skill 产出或更新 `logos/environments.yaml`。只登记方案确实涉及的环境；方案没有环境划分时不产出登记表（登记表是 opt-in）。

```yaml
schema_version: 1
environments:
  - id: staging
    name: 预发环境
    tier: staging
    aliases: [预发]
    health: https://staging.example.com/healthz
    secrets: [STAGING_DEPLOY_TOKEN]   # 只写变量名，不写值
    deploy:
      mode: script
      script: deploy/staging.sh
      args: ["{env}", "{ref}"]
  - id: prod
    name: 生产环境
    tier: prod
    deploy:
      mode: ci
      provider: github-actions
      workflow: deploy.yml
```

- **选择执行方式**：仓库已有 GitHub Actions 部署工作流 → `mode: ci`、`provider: github-actions`；其他 CI → `mode: ci`、`provider: script`，编写仓库内的 `trigger_script` / `status_script`；没有流水线但步骤可脚本化 → `mode: script`；步骤暂时需要人工或 AI 判断 → `mode: agent`，`plan_section` 写部署方案中对应章节标题。
- **登记表不承载命令**：`deploy` 只引用仓库内的脚本与工作流，以及参数、超时等配置，不得写 `run`、`command`、`shell` 字段。登记表免立案可改，而脚本是受保护文件，因此改变部署实际执行的内容总要立案。
- **部署脚本**放在受跟踪的路径（默认 `deploy/<env>.sh`）并带可执行位，在目标版本的隔离工作树中运行（需自行安装依赖与构建），失败时非零退出，不打印密钥值，可重复执行；可读取 `OPENLOGOS_DEPLOY_ENV`、`OPENLOGOS_DEPLOY_REF`、`OPENLOGOS_DEPLOY_ID`、`OPENLOGOS_DEPLOY_CHANNEL`。
- **CI 工作流**须上传 `openlogos-deploy-result` artifact（`result.json` 含 `deployed_ref`），回报实际部署的提交；没有回报时部署版本记为未知。
- **晋级与审批门可选**：对 `tier: prod` 的环境，Skill *提示*可配置 `promote_from` 与 `require_approval: true`，并说明 `--auto` 运行遇到它们会停下等人；不会自行开启，由你决定。
- **`proposal_default_env` 只在你明确指定环境时写入。** Skill 说明该字段的作用（需要部署的提案未另行指定时默认部署到该环境，不再逐案询问），由你指定一个环境或选择不设；它不会自行设置、修改或删除该值。
- **自验证，不做真实部署**：对每个配置了 `deploy` 的环境运行只读的 `openlogos env check` 与 `openlogos deploy --env <id> --ref <commit> --dry-run`（受门环境报告 `DEPLOY_PROMOTION_UNVERIFIED` / `DEPLOY_APPROVAL_REQUIRED` 是预期结果），shell 脚本另做 `bash -n` 检查。不执行真实部署，也不执行 `openlogos approve` 或 `--force-promote`。

配置了 `deploy` 的环境，部署方案另增「部署脚本审阅摘要」一节：每个脚本或工作流做什么、动哪些外部资源、需要哪些密钥变量名、如何失败与回滚。

### Step 5：设计 Smoke 测试输入

输出一份 smoke 范围摘要，供 `test-writer` Skill 消费，以在 `logos/resources/test/smoke/` 中生成 `SMOKE-*` 测试用例 ID。

## 产出物

| 产出物 | 位置 |
|----------|----------|
| 部署方案 | `logos/resources/prd/3-technical-plan/3-deployment/<module>-01-deployment-plan.md` |
| logos-project.yaml 更新 | `deployment_gates` 段 |
| 环境登记表（方案涉及具体环境时） | `logos/environments.yaml` |
| 部署脚本（script 方式）/ CI 适配脚本 | 仓库内受跟踪路径，默认 `deploy/<env>.sh` |
| Smoke 范围输入 | 嵌入部署方案中，供 `test-writer` 消费 |

## 相关 Skill

- [`architecture-designer`](/zh/skills/architecture-designer) —— 提供此 Skill 读取的架构上下文
- [`test-writer`](/zh/skills/test-writer) —— 消费 smoke 范围以生成 `SMOKE-*` 用例
- [`deployment-executor`](/zh/skills/deployment-executor) —— 执行此 Skill 产出的方案
- [`openlogos env`](/zh/cli/env) / [`openlogos deploy`](/zh/cli/deploy) —— 校验登记表、对已配置的部署做 dry-run
