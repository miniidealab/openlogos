---
title: logos-project.yaml
description: 为 AI 工具提供项目全局上下文的 AI 协作索引文件的 schema 定义。
---

`logos-project.yaml` 是 OpenLogos 项目的 AI 协作索引文件。它为 AI 助手提供项目的全局上下文——该读哪些关键文件、用了什么技术栈、要遵循哪些约定。

## 文件位置

```
logos/logos-project.yaml
```

## Schema 总览

```yaml
project:            # Project basics (required)
tech_stack:         # Technology stack (required)
scenario_counter:   # Global scenario ID counter (required for multi-module)
modules:            # Module registry (required for multi-module)
scenarios:          # Scenario list (optional, written before Phase 3-1)
external_dependencies:  # External service dependencies (optional)
resource_index:     # Resource file index (required)
conventions:        # Project conventions (optional)
```

## 字段定义

### project

| 字段 | 类型 | 必填 | 描述 |
|-------|------|----------|-------------|
| `name` | string | 是 | 项目名称 |
| `description` | string | 是 | 一行项目描述 |
| `methodology` | string | 否 | 遵循的方法论（默认：`"OpenLogos"`） |

### tech_stack

描述项目技术栈的自由键值对。推荐的键：

| 键 | 描述 | 示例 |
|-----|-------------|---------|
| `framework` | 主要框架 | `"Next.js 15"` |
| `language` | 主要语言 | `"TypeScript"` |
| `hosting` | 部署平台 | `"Cloudflare Pages"` |
| `database` | 数据库 | `"Supabase (PostgreSQL)"` |
| `auth` | 认证方案 | `"Supabase Auth"` |

### external_dependencies

外部服务依赖及其测试策略的数组。在架构设计阶段（Step 0）定义，由测试编排阶段（Step 3b）消费。

| 字段 | 类型 | 必填 | 描述 |
|-------|------|----------|-------------|
| `name` | string | 是 | 依赖名称（如 "Email Service"、"CAPTCHA"） |
| `provider` | string | 是 | 具体提供方（如 "SendGrid"、"reCAPTCHA"） |
| `used_in` | array | 是 | 使用该依赖的场景（如 `["S01-User Registration"]`） |
| `test_strategy` | string | 是 | 测试策略枚举（见下表） |
| `test_config` | string | 是 | 测试策略配置细节 |

#### test_strategy 取值

| 取值 | 描述 | 典型用例 |
|-------|-------------|-----------------|
| `test-api` | 测试环境提供后门 API 用于获取验证码/回调 | 邮件/短信验证码 |
| `fixed-value` | 特定测试数据使用固定值 | 测试手机号配固定验证码 |
| `env-disable` | 通过环境变量禁用功能 | 图形验证码、滑块验证 |
| `mock-callback` | 编排主动调用 mock 回调端点 | 支付回调、Webhook |
| `mock-service` | 本地 mock 服务替代真实服务 | OAuth 提供商、第三方 API |

### resource_index

AI 应当知晓的关键资源文件数组：

| 字段 | 类型 | 必填 | 描述 |
|-------|------|----------|-------------|
| `path` | string | 是 | 相对于项目根目录的文件路径 |
| `desc` | string | 是 | 一行描述——告诉 AI 何时该读此文件 |

### scenario_counter

维护全局唯一场景 ID 计数器的对象。多模块项目必填，以确保场景 ID 在模块间永不冲突。

| 字段 | 类型 | 必填 | 描述 |
|-------|------|----------|-------------|
| `next_id` | integer | 是 | 下一个要用的场景编号（如 `8` 表示下一个场景是 `S08`） |

AI 在生成新场景之前必须读取此字段，生成后立即递增并写回。绝不能在新模块中从 `S01` 重新编号。

### modules

已注册模块的数组。多模块项目必填。`openlogos init` 会自动写入初始的 `core` 模块条目。

| 字段 | 类型 | 必填 | 描述 |
|-------|------|----------|-------------|
| `id` | string | 是 | 模块标识符——小写字母、数字、连字符（如 `core`、`admin`） |
| `name` | string | 是 | 人类可读的模块名称 |
| `lifecycle` | string | 是 | `initial`（阶段驱动开发）或 `launched`（变更提案驱动） |
| `bootstrap` | string | 否 | 接入模式：`normal`（默认，完整 Phase 1→3）或 `adopted`（已有项目，跳过初始文档基线）。由 `openlogos adopt` 写入。历史值 `skipped` 与 `adopted` 读兼容。 |
| `skip_phases` | array | 否 | 该模块不需要的阶段。由 `architecture-designer` Skill 在技术栈选定后写入。 |
| `deployment_required` | boolean | 否 | 该模块是否需要部署执行关卡。软件项目默认 `true`；纯文档或库可设为 `false`。 |

`bootstrap` 字段语义：

| 取值 | 含义 | 写入者 |
|-------|---------|------------|
| `normal`（或缺省） | 迭代前的完整 Phase 1→3 文档基线 | `openlogos init`（默认） |
| `adopted` | 已有项目接入；OpenLogos 基础设施完全初始化，但跳过初始文档基线 | `openlogos adopt` |
| `skipped` | 历史兼容值，读取等价于 `adopted`，不再写入 | 旧版 `openlogos adopt` |

当 `bootstrap: adopted` 时：
- `status`：Phase 1、2、3-0 缺失文档不报错——显示「已跳过文档基线（已有项目接入）」
- `next`：无活跃提案时，建议 `openlogos change add-baseline-docs`
- `launch`：豁免初始文档关卡检查
- `detect/status --format json`：输出 `bootstrap: "adopted"`

`skip_phases` 允许的取值：

| 取值 | 跳过 | 何时使用 |
|-------|-------|-------------|
| `api` | `logos/resources/api/` | 无 HTTP API（桌面应用、CLI 工具、前端库） |
| `database` | `logos/resources/database/` | 无数据库（无状态 CLI、纯计算） |
| `scenario` | `logos/resources/scenario/` | 无 API 编排测试（通常与 `api` 搭配） |
| `deployment` | 部署执行 + smoke 关卡 | 纯文档，无需运行时环境 |

### scenarios

声明项目完整场景列表的数组。场景是 OpenLogos 方法论的中心组织单元——所有阶段交付物都以场景 ID 为键。

**何时写入**：在 `architecture-designer` Skill 完成之后、`scenario-architect` Skill 开始之前。

| 字段 | 类型 | 必填 | 描述 |
|-------|------|----------|-------------|
| `id` | string | 是 | 全局唯一的场景 ID，格式为 `S` + 两位数字（如 `S01`、`S08`） |
| `name` | string | 是 | 一行场景描述 |
| `module` | string | 否 | 所属模块 ID。缺省时默认为 `core`。多模块项目必填，以便 `openlogos status` 正确计算每个模块的阶段进度。 |

`openlogos sync` 会扫描 `logos/resources/prd/3-technical-plan/2-scenario-implementation/` 中的 `<moduleId>-SXX-*.md` 文件，自动回填缺失的 `module` 字段。无匹配时回退到 `core`。

### conventions

项目约定数组（字符串格式）。每个元素是一条约定规则。

### deployment_gates

声明初始阶段（`openlogos launch` 之前）的部署和 smoke 关卡要求。由 `deployment-designer` Skill 写入，由 `status` / `launch` 消费。

```yaml
deployment_gates:
  core:
    deployment_required: true
    smoke_required: true
    environments:
      - staging
```

| 字段 | 类型 | 必填 | 描述 |
|-------|------|----------|-------------|
| `<module_id>` | object | 是 | 每个模块的关卡配置 |
| `deployment_required` | boolean | 是 | launch 之前是否需要执行部署 |
| `smoke_required` | boolean | 是 | 部署后是否需要 smoke 验证 |
| `environments` | array | 否 | 目标部署环境 |

如果未声明 `deployment_gates`，软件模块默认要求一份部署方案；部署执行和 smoke 关卡由模块的 `deployment_required` 字段和部署方案内容决定。

## 完整示例

```yaml
project:
  name: "My SaaS Product"
  description: "A SaaS product built with OpenLogos methodology"
  methodology: "OpenLogos"

tech_stack:
  framework: "Next.js 15"
  language: "TypeScript"
  hosting: "Vercel"
  database: "Supabase (PostgreSQL)"
  auth: "Supabase Auth"
  payment: "Paddle"

scenario_counter:
  next_id: 8

modules:
  - id: core
    name: Core
    lifecycle: launched
  - id: admin
    name: Admin
    lifecycle: initial

scenarios:
  - id: S01
    name: User Registration
    module: core
  - id: S02
    name: Password Login
    module: core
  - id: S03
    name: Forgot Password
    module: core
  - id: S08
    name: Admin Dashboard
    module: admin

external_dependencies:
  - name: "Email Service"
    provider: "SendGrid"
    used_in: ["S01-User Registration", "S03-Forgot Password"]
    test_strategy: "test-api"
    test_config: "GET /api/test/latest-email?to={email}"
  - name: "CAPTCHA"
    provider: "reCAPTCHA"
    used_in: ["S01-User Registration", "S02-Password Login"]
    test_strategy: "env-disable"
    test_config: "CAPTCHA_ENABLED=false"
  - name: "Payment Callback"
    provider: "Paddle"
    used_in: ["S05-Subscription Payment"]
    test_strategy: "mock-callback"
    test_config: "POST /api/test/simulate-payment-callback"

resource_index:
  - path: logos/resources/prd/1-product-requirements/core-01-requirements.md
    desc: Core product requirements. Read when dealing with product positioning, target users, or feature requirements.
  - path: logos/resources/prd/2-product-design/1-feature-specs/core-01-information-architecture.md
    desc: Information architecture document. Read when dealing with page structure or navigation design.
  - path: logos/resources/api/auth.yaml
    desc: Authentication API specs. Read when dealing with login, registration, or OAuth interfaces.
  - path: logos/resources/database/schema.sql
    desc: Complete database schema. Read when dealing with table structure, field design, or RLS policies.
  - path: logos/resources/scenario/user-auth.json
    desc: User auth scenario API orchestration. Read when dealing with auth flow verification.

conventions:
  - "All API paths start with /api/"
  - "Monetary amounts stored as INTEGER in cents"
  - "Time fields use TIMESTAMPTZ uniformly"
  - "Every change must create a logos/changes/ proposal first"
```

## 与 AGENTS.md 的关系

`logos-project.yaml` 是结构化的资源索引；`AGENTS.md` 是自然语言的指令文件。二者互补：

- `AGENTS.md` 指引 AI：「先读 `logos/logos-project.yaml`」
- `logos-project.yaml` 告诉 AI：「这些是关键文件；这是各自该读的时机」
- `openlogos sync` 会基于 `logos-project.yaml` 内容更新 `AGENTS.md`

指令文件格式见 [AGENTS.md 规格](/zh/specs/agents-md)。
