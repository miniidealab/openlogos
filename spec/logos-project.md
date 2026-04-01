# logos-project.yaml 规范

> 版本：0.1.0
>
> logos-project.yaml 是 OpenLogos 项目的 AI 协作索引文件。它为 AI 助手提供项目的全局上下文，让 AI 打开项目就知道该读哪些资料、项目用了什么技术栈、遵循什么约定。

## 文件位置

项目根目录：`logos-project.yaml`

## 字段定义

### 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `project` | object | 是 | 项目基本信息 |
| `tech_stack` | object | 是 | 技术栈描述 |
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

### resource_index

数组，每个元素描述一个关键资源文件：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件相对路径 |
| `desc` | string | 是 | 一句话描述——告诉 AI 什么场景下需要读这个文件 |

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

resource_index:
  - path: resources/prd/1-product-requirements/01-requirements.md
    desc: 产品核心需求文档。涉及产品定位、目标用户、功能需求时必读。
  - path: resources/prd/2-product-design/1-feature-specs/01-information-architecture.md
    desc: 信息架构文档。涉及页面结构、导航设计时必读。
  - path: resources/api/auth.yaml
    desc: 认证相关 API 规格。涉及登录、注册、OAuth 接口设计时必读。
  - path: resources/database/schema.sql
    desc: 数据库完整 Schema。涉及表结构、字段设计、RLS 策略时必读。
  - path: resources/scenario/user-auth.json
    desc: 用户认证场景的 API 编排。涉及认证流程验收时必读。

conventions:
  - "所有 API 路径以 /api/ 开头"
  - "数据库金额字段使用 INTEGER 存储分值"
  - "时间字段统一使用 TIMESTAMPTZ"
  - "每次变更必须先创建 changes/ 变更提案"
```

## 与 AGENTS.md 的关系

`logos-project.yaml` 是项目资源的结构化索引，`AGENTS.md` 是面向 AI 的自然语言指令。两者互补：

- AGENTS.md 告诉 AI "先读 logos-project.yaml"
- logos-project.yaml 告诉 AI "这个项目有哪些关键文件、什么时候该读"
- `openlogos sync` 命令会根据 logos-project.yaml 的内容更新 AGENTS.md
