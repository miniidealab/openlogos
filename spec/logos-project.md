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

**命名规则约定**（各阶段产出物通过 `SXX` 前缀与场景关联，无需在 yaml 中声明路径）：

| 阶段 | 产出物路径规则 | 示例 |
|------|-------------|------|
| Phase 3-1 场景建模 | `logos/resources/prd/3-technical-plan/2-scenario-implementation/SXX-*.md` | `S01-user-register.md` |
| Phase 3-2 API 设计 | `logos/resources/api/SXX-*.yaml` 或 `SXX-*.yml` | `S01-user-register.yaml` |
| Phase 3-3a 测试用例 | `logos/resources/test/SXX-*.md` | `S01-test-cases.md` |

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
  - path: logos/resources/prd/1-product-requirements/01-requirements.md
    desc: 产品核心需求文档。涉及产品定位、目标用户、功能需求时必读。
  - path: logos/resources/prd/2-product-design/1-feature-specs/01-information-architecture.md
    desc: 信息架构文档。涉及页面结构、导航设计时必读。
  - path: logos/resources/api/auth.yaml
    desc: 认证相关 API 规格。涉及登录、注册、OAuth 接口设计时必读。
  - path: logos/resources/database/schema.sql
    desc: 数据库完整 Schema。涉及表结构、字段设计、RLS 策略时必读。
  - path: logos/resources/scenario/user-auth.json
    desc: 用户认证场景的 API 编排。涉及认证流程验收时必读。

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
