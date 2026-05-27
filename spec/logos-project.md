# logos-project.yaml 规范

> 版本：0.3.0
>
> logos-project.yaml 是 OpenLogos 项目的 AI 协作索引文件。它为 AI 助手提供项目的全局上下文，让 AI 打开项目就知道该读哪些资料、项目用了什么技术栈、遵循什么约定。

## 文件位置

`logos/logos-project.yaml`（位于 `logos/` 目录下）

## 字段定义

### 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `project` | object | 是 | 项目基本信息 |
| `tech_stack` | object | 是 | 技术栈描述 |
| `scenario_counter` | object | 否 | 全局场景编号计数器（多模块项目必填） |
| `modules` | array | 否 | 模块注册表（多模块项目必填） |
| `deployment_gates` | object | 否 | Initial 阶段 launch 前的部署与 smoke 门禁声明 |
| `scenarios` | array | 否 | 场景清单（单一真相来源，Phase 3-1 前写入） |
| `resource_index` | array | 是 | 资源索引列表 |
| `conventions` | array | 否 | 项目约定 |

### project

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 项目名称 |
| `description` | string | 是 | 项目一句话描述 |
| `methodology` | string | 否 | 遵循的方法论（默认 "OpenLogos"） |

### tech_stack

自由格式的键值对，描述项目使用的技术栈。推荐包含以下 key：

| Key | 说明 | 示例 |
|-----|------|------|
| `framework` | 主框架 | "Astro 5.x" |
| `language` | 主语言 | "TypeScript" |
| `hosting` | 部署平台 | "Cloudflare Pages" |
| `database` | 数据库 | "Supabase (PostgreSQL)" |
| `auth` | 认证方案 | "Supabase Auth" |
| `deployment` | 部署形态或发布方式 | "Docker Compose on VPS" |
| `smoke` | 冒烟测试命令或策略 | "npm run smoke" |

### external_dependencies

数组，声明项目依赖的外部服务及其测试策略。在架构设计阶段（S12）确定，供编排测试阶段（S06）自动消费。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 外部依赖名称（如"邮件服务"、"图形验证码"） |
| `provider` | string | 是 | 具体服务商（如"SendGrid"、"reCAPTCHA"） |
| `used_in` | array | 是 | 涉及的场景列表（如 `["S01-用户注册", "S03-忘记密码"]`） |
| `test_strategy` | string | 是 | 测试策略枚举值（见下表） |
| `test_config` | string | 是 | 测试策略的具体配置说明 |

`test_strategy` 枚举值：

| 值 | 说明 | 典型场景 |
|----|------|---------|
| `test-api` | 测试环境提供后门 API 获取验证码/回调等 | 邮件验证码、短信验证码 |
| `fixed-value` | 特定测试数据使用固定值 | 测试手机号固定验证码 |
| `env-disable` | 通过环境变量关闭该功能 | 图形验证码、滑块验证 |
| `mock-callback` | 编排中主动调用模拟回调端点 | 支付回调、Webhook |
| `mock-service` | 使用本地 mock 服务替代 | OAuth Provider、第三方 API |

### scenario_counter

对象，维护全局场景编号计数器。多模块项目必填，确保不同模块的场景编号全局唯一、不重复。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `next_id` | integer | 是 | 下一个场景的序号（整数），如 `19` 表示下一个场景从 `S19` 开始 |

**使用规则**：AI 每次生成新场景前必须读取此字段取号，生成后立即将 `next_id` 加 1 并写回，严禁不同模块从 S01 重新开始编号。

### modules

数组，模块注册表。多模块项目必填，统一在此文件维护，不另建 `modules.yaml`。`openlogos init` 时自动写入 `core` 模块初始数据。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 模块标识符，小写字母 + 连字符，如 `core`、`payment` |
| `name` | string | 是 | 模块名称（中文或英文均可） |
| `lifecycle` | string | 是 | 模块生命周期：`initial`（初始开发阶段，关注 phase 推进）或 `launched`（迭代开发阶段，关注变更提案） |
| `bootstrap` | string | 否 | 入场模式：`normal`（默认，完整走 Phase 1→3）或 `adopted`（存量项目接入，Initial 文档基线已跳过）。由 `openlogos adopt` 命令写入，不建议手动修改。历史值 `skipped` 仅用于兼容读取。 |
| `skip_phases` | array | 否 | 声明本模块不需要的阶段，phase 检测时跳过对应目录。由 `architecture-designer` Skill 在技术选型后填写。 |
| `deployment_required` | boolean | 否 | 是否需要部署执行门禁。软件项目默认 true；纯文档、纯库或明确无需部署的模块可设为 false。 |

**`bootstrap` 字段语义**：

| 值 | 含义 | 写入时机 |
|----|------|---------|
| `normal`（或缺省） | 完整走 Phase 1→3 文档基线再进入迭代 | `openlogos init` 创建的模块默认值 |
| `adopted` | 已有项目快速接入；OpenLogos 基础设施完整初始化，但 Initial 文档基线已跳过 | `openlogos adopt` 写入 |
| `skipped` | 历史兼容值，等价于 `adopted` 读取，不再新写入 | 旧版本 `openlogos adopt` 写入 |

`bootstrap: adopted` 时的行为约束：
- `status`：Phase 1、Phase 2 和 Phase 3-0 缺失不报错，显示「文档基线已跳过（存量项目接入）」
- `next`：无活跃提案时，固定建议先执行 `openlogos change add-baseline-docs` 补文档
- `launch`：豁免 Initial 文档门禁检查（不依赖 `lifecycle` 值）
- `detect/status --format json`：新项目输出 `bootstrap: adopted`；历史 `bootstrap: skipped` 至少必须被识别为同一种接入模式，不得回退为普通 launched 或 initial

`skip_phases` 允许值：

| 值 | 跳过的检查 | 适用场景 |
|----|-----------|---------|
| `api` | `logos/resources/api/` | 无 HTTP API 的项目（桌面应用、CLI 工具、前端库） |
| `database` | `logos/resources/database/` | 无数据库的项目（纯计算工具、无状态 CLI） |
| `scenario` | `logos/resources/scenario/` | 无 API 编排测试的项目（通常与 `api` 同时跳过） |
| `deployment` | 部署执行与 smoke 门禁 | 纯文档、无需发布运行环境的模块 |

> `deployment` skip 只跳过部署执行与 smoke 门禁，不跳过部署方案设计。Initial 软件项目仍应说明为什么不需要部署。

示例：

```yaml
modules:
  - id: core
    name: 核心功能
    lifecycle: initial
    skip_phases: [api, scenario]   # SQLite 桌面应用：有数据库，无 HTTP API
```

```yaml
modules:
  - id: core
    name: 核心功能
    lifecycle: launched
    bootstrap: adopted
    skip_phases: [api, database, scenario]   # 存量 CLI 项目接入
```

### deployment_gates

`deployment_gates` 用于声明 Initial 阶段 launch 前的部署门禁要求。字段可由 `deployment-designer` Skill 写入，供 `status` / `launch` 判断。

```yaml
deployment_gates:
  core:
    deployment_required: true
    smoke_required: true
    environments:
      - staging
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `deployment_required` | boolean | 是 | 是否需要部署执行 |
| `smoke_required` | boolean | 是 | 是否需要部署后冒烟测试 |
| `environments` | array | 否 | 需要覆盖的部署环境 |

若未声明 `deployment_gates`，软件模块默认需要部署方案；部署执行和 smoke 门禁由模块的 `deployment_required` 与部署方案内容共同决定。

### resource_index

数组，每个元素描述一个关键资源文件：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件相对路径 |
| `desc` | string | 是 | 一句话描述——告诉 AI 什么场景下需要读这个文件 |

### scenarios

数组，声明项目的**完整场景清单**。场景是 OpenLogos 方法论中最核心的设计元素，是后续各阶段产出物的组织单位。

**写入时机**：
1. 在 `architecture-designer` Skill 完成后，由 AI 引导用户确认场景清单并预先写入；
2. 在 `scenario-architect` Skill 开始建模时，强制检查并补全。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 场景唯一编号，格式为 `S` + 两位数字，如 `S01`、`S02` |
| `name` | string | 是 | 场景名称（一句话描述） |
| `module` | string | 否 | 所属模块 id，缺省为 `core`。多模块项目必填，用于 `openlogos status` 按模块计算 phase 进度。`openlogos sync` 会自动补全缺失的 `module` 字段。 |

**命名规则约定**（各阶段产出物通过 `<module>-SXX` 前缀与场景关联，无需在 yaml 中声明路径）：

| 阶段 | 产出物路径规则 | 示例 |
|------|-------------|------|
| Phase 3-1 场景建模 | `logos/resources/prd/3-technical-plan/2-scenario-implementation/<module>-SXX-*.md` | `core-S01-user-register.md` |
| Phase 3-2 API 设计 | `logos/resources/api/SXX-*.yaml` 或 `SXX-*.yml` | `S01-user-register.yaml` |
| Phase 3-3 部署方案 | `logos/resources/prd/3-technical-plan/3-deployment/<module>-01-deployment-plan.md` | `core-01-deployment-plan.md` |
| Phase 3-4a 测试用例 | `logos/resources/test/<module>-SXX-*.md` | `core-S01-test-cases.md` |
| Phase 3-4a 冒烟测试 | `logos/resources/test/smoke/<module>-smoke-test-cases.md` | `core-smoke-test-cases.md` |

**完成判断规则**：只有 `scenarios` 中每个 `id` 在对应阶段都存在匹配文件，该阶段才视为完成。若 `scenarios` 字段缺失，则降级为旧的"目录有文件即完成"逻辑（向后兼容）。

### conventions

数组，每个元素是一条项目约定（字符串格式）。

## 完整示例

```yaml
project:
  name: "My SaaS Product"
  description: "一个基于 OpenLogos 方法论构建的 SaaS 产品"
  methodology: "OpenLogos"

tech_stack:
  framework: "Next.js 15"
  language: "TypeScript"
  hosting: "Vercel"
  database: "Supabase (PostgreSQL)"
  auth: "Supabase Auth"
  payment: "Paddle"
  deployment: "Vercel + Supabase"
  smoke: "npm run smoke"

scenario_counter:
  next_id: 6

modules:
  - id: core
    name: 核心功能
    lifecycle: launched
  - id: payment
    name: 支付模块
    lifecycle: initial

deployment_gates:
  core:
    deployment_required: true
    smoke_required: true
    environments:
      - staging

external_dependencies:
  - name: "邮件服务"
    provider: "SendGrid"
    used_in: ["S01-用户注册", "S03-忘记密码"]
    test_strategy: "test-api"
    test_config: "GET /api/test/latest-email?to={email}"
  - name: "图形验证码"
    provider: "reCAPTCHA"
    used_in: ["S01-用户注册", "S02-密码登录"]
    test_strategy: "env-disable"
    test_config: "CAPTCHA_ENABLED=false"
  - name: "支付回调"
    provider: "Paddle"
    used_in: ["S05-订阅付费"]
    test_strategy: "mock-callback"
    test_config: "POST /api/test/simulate-payment-callback"

resource_index:
  - path: logos/resources/prd/1-product-requirements/core-01-requirements.md
    desc: 产品核心需求文档。涉及产品定位、目标用户、功能需求时必读。
  - path: logos/resources/prd/2-product-design/1-feature-specs/core-00-information-architecture.md
    desc: 信息架构文档。涉及页面结构、导航设计时必读。
  - path: logos/resources/api/auth.yaml
    desc: 认证相关 API 规格。涉及登录、注册、OAuth 接口设计时必读。
  - path: logos/resources/database/schema.sql
    desc: 数据库完整 Schema。涉及表结构、字段设计、RLS 策略时必读。
  - path: logos/resources/scenario/user-auth.json
    desc: 用户认证场景的 API 编排。涉及认证流程验收时必读。
  - path: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md
    desc: 核心模块部署方案。涉及部署拓扑、发布命令、回滚策略和 smoke 验证时必读。
  - path: logos/resources/test/smoke/core-smoke-test-cases.md
    desc: 核心模块部署后冒烟测试用例。涉及 openlogos smoke 或 launch 前门禁时必读。

conventions:
  - "所有 API 路径以 /api/ 开头"
  - "数据库金额字段使用 INTEGER 存储分值"
  - "时间字段统一使用 TIMESTAMPTZ"
  - "每次变更必须先创建 logos/changes/ 变更提案"
```

## 与 AGENTS.md 的关系

`logos-project.yaml` 是项目资源的结构化索引，`AGENTS.md` 是面向 AI 的自然语言指令。两者互补：

- AGENTS.md 告诉 AI "先读 `logos/logos-project.yaml`"
- logos-project.yaml 告诉 AI "这个项目有哪些关键文件、什么时候该读"
- `openlogos sync` 命令会根据 logos-project.yaml 的内容更新 AGENTS.md
