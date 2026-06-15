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

### Step 5：设计 Smoke 测试输入

输出一份 smoke 范围摘要，供 `test-writer` Skill 消费，以在 `logos/resources/test/smoke/` 中生成 `SMOKE-*` 测试用例 ID。

## 产出物

| 产出物 | 位置 |
|----------|----------|
| 部署方案 | `logos/resources/prd/3-technical-plan/3-deployment/<module>-01-deployment-plan.md` |
| logos-project.yaml 更新 | `deployment_gates` 段 |
| Smoke 范围输入 | 嵌入部署方案中，供 `test-writer` 消费 |

## 相关 Skill

- [`architecture-designer`](/zh/skills/architecture-designer) —— 提供此 Skill 读取的架构上下文
- [`test-writer`](/zh/skills/test-writer) —— 消费 smoke 范围以生成 `SMOKE-*` 用例
- [`deployment-executor`](/zh/skills/deployment-executor) —— 执行此 Skill 产出的方案
