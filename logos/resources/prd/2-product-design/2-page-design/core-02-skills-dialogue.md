# AI Skills 对话流程脚本

> Phase 2 产品设计 · AI Skills 原型
>
> 涵盖场景：S02、S03、S12、S04、S05、S06（test-writer + test-orchestrator）、S07、S09（change-writer / merge-executor）
>
> 最后更新：2026-04-02

---

## S02: prd-writer 对话脚本

### 场景 A：用户信息充分

```
👤 用户：
帮我写需求文档。我要做一个面向独立开发者的 AI 代码审查工具，
主要解决代码质量不可控的问题。目标用户是使用 AI 写代码但缺乏
经验的独立开发者。

🤖 AI：
[读取 prd-writer Skill]
[检查 logos/resources/prd/1-product-requirements/ → 空目录]
[信息充分：有定位 + 目标用户 + 核心痛点 → 直接输出]

收到，信息足够清晰。我来帮你梳理需求文档。

[输出完整的需求文档到 logos/resources/prd/1-product-requirements/01-requirements.md]

需求文档初稿已生成到 `logos/resources/prd/1-product-requirements/01-requirements.md`。

我识别了 6 个核心场景（S01-S06），其中 4 个标记为 P0。
请 review 后告诉我需要修改的地方。
```

### 场景 B：用户信息不足

```
👤 用户：
帮我写需求文档

🤖 AI：
[读取 prd-writer Skill]
[检查 logos/resources/prd/1-product-requirements/ → 空目录]
[信息不足 → 进入追问流程]

好的，在写需求文档之前，我需要了解一些关键信息。

请先告诉我：这个产品要解决什么人的什么问题？
比如：「面向独立开发者，解决 AI 生成代码质量不可控的问题」

👤 用户：
我想做一个记账 App，给年轻人用的

🤖 AI：
明白了。还有两个关键问题：

1. 年轻人记账最大的痛点是什么？现有方案（如随手记）哪里不好？
2. 有什么技术或资源上的约束吗？比如只做移动端、不做社交功能等

👤 用户：
痛点是现有记账软件太复杂，年轻人懒得记。我想做一个极简的，
拍照就能记账的。只做 iOS，先不做安卓。

🤖 AI：
[信息充分 → 输出需求文档]

信息清晰了，我来梳理需求。

[输出完整需求文档]

需求文档初稿已生成。请 review，特别关注：
- 痛点分析是否准确
- 场景优先级是否合理
- "不做"清单是否遗漏
```

### 场景 C：已有需求文档

```
👤 用户：
帮我写需求文档

🤖 AI：
[检查 logos/resources/prd/1-product-requirements/ → 发现 01-requirements.md]

已存在需求文档 `01-requirements.md`。你是想：
1. 在现有文档基础上修改（告诉我要改什么）
2. 全部重写

👤 用户：
在现有基础上修改，我想增加一个新的场景

🤖 AI：
好的，请描述这个新场景——谁在什么情况下需要做什么？
```

---

## S03: product-designer 对话脚本

### 场景 A：正常执行

```
👤 用户：
基于需求文档做产品设计

🤖 AI：
[读取 product-designer Skill]
[检查 logos/resources/prd/1-product-requirements/ → 存在]
[读取需求文档，提取场景清单]

从需求文档中识别到 8 个核心场景。根据约束与边界，产品类型为**混合型**：
- CLI 场景（S01、S08、S09、S11）→ 终端交互模拟
- AI Skill 场景（S02-S07、S12）→ 对话流程脚本

建议先从 CLI 场景开始设计（结构更确定），然后设计 AI Skill 的对话流程。
先从 S01 CLI 初始化项目开始？

👤 用户：
好的

🤖 AI：
[逐场景输出交互规格 + 原型]

### S01: CLI 初始化项目 — 交互规格

**命令格式**：`openlogos init [name]`
...

S01 的产品设计已完成。继续 S08 同步指令文件？
```

### 场景 B：缺少需求文档

```
👤 用户：
帮我做产品设计

🤖 AI：
[检查 logos/resources/prd/1-product-requirements/ → 空目录]

未找到需求文档。产品设计需要基于 Phase 1 的场景定义。

建议先完成 Phase 1：对我说「帮我写需求文档」。
```

---

## S12: architecture-designer 对话脚本

### 场景 A：用户有技术偏好

```
👤 用户：
帮我设计技术架构，我打算用 Next.js + Supabase

🤖 AI：
[读取 architecture-designer Skill]
[检查 Phase 2 文档 → 存在]
[读取需求文档 + 产品设计]

了解，基于你的产品特征和技术偏好，我来设计架构方案。

[输出架构概要：系统架构图 + 选型表 + 部署拓扑]

架构概要已生成到 `logos/resources/prd/3-technical-plan/1-architecture/01-architecture-overview.md`。

技术栈已写入 `logos-project.yaml`：
- 前端：Next.js 15 (App Router)
- 后端：Supabase (Auth + Database + Edge Functions)
- 数据库：PostgreSQL (via Supabase)
- 部署：Vercel + Supabase Cloud

需要调整吗？
```

### 场景 B：用户无偏好

```
👤 用户：
帮我设计技术架构

🤖 AI：
[检查 Phase 2 文档 → 存在]
[读取需求文档 + 产品设计]

根据你的产品特征（个人 SaaS、Web 端、需要用户认证和数据存储），
我推荐以下方案，请选择一个方向：

| 方案 | 技术栈 | 适合场景 | 运维复杂度 |
|------|--------|---------|-----------|
| A | Next.js + Supabase | 快速上线、零运维 | 低 |
| B | Next.js + Hono + PostgreSQL | 更灵活、可自托管 | 中 |
| C | Astro + Node.js API + PostgreSQL | 内容优先、SEO 友好 | 中 |

你倾向哪个？或者有其他偏好？

👤 用户：
方案 A

🤖 AI：
[按方案 A 输出架构概要]
```

### 场景 C：识别外部依赖并确定测试策略

```
👤 用户：
帮我设计技术架构，用 Next.js + Supabase

🤖 AI：
[读取 architecture-designer Skill]
[检查 Phase 2 文档 → 存在]
[读取需求文档 + 产品设计]
[输出架构概要：系统架构图 + 选型表 + 部署拓扑]

架构概要已生成。

在分析架构时，我发现项目依赖以下外部服务：

| # | 外部依赖 | 服务商 | 涉及场景 |
|---|---------|--------|---------|
| 1 | 邮件服务 | SendGrid | S01-用户注册, S03-忘记密码 |
| 2 | 图形验证码 | reCAPTCHA | S01-用户注册, S02-密码登录 |
| 3 | 支付 | Stripe | S05-订阅付费 |

为了后续编排测试（Phase 3 Step 3）能顺利自动化执行，需要为每个依赖
确定测试策略。

**邮件服务 (SendGrid)**：推荐使用 `test-api` 策略——在测试环境部署一个
后门 API `GET /api/test/latest-email?to={email}` 来获取最近发送的邮件
验证码。你同意吗？

👤 用户：
同意

🤖 AI：
**图形验证码 (reCAPTCHA)**：推荐使用 `env-disable` 策略——测试环境
通过 `CAPTCHA_ENABLED=false` 直接关闭验证码。你同意吗？

👤 用户：
同意

🤖 AI：
**支付 (Stripe)**：推荐使用 `mock-callback` 策略——编排测试中通过
`POST /api/test/simulate-payment-callback` 模拟 Stripe 的支付回调。
你同意吗？

👤 用户：
同意

🤖 AI：
好的，我已将技术栈和外部依赖测试策略写入 `logos-project.yaml`：
- `tech_stack`：Next.js 15, Supabase, PostgreSQL...
- `external_dependencies`：3 个依赖，全部已声明测试策略

后续编排测试阶段 AI 会自动读取这些配置，在涉及外部服务的步骤中
生成带 mock 标记的编排 JSON。

需要调整吗？
```

---

## S04: scenario-architect 对话脚本

### 场景 A：指定场景建模

```
👤 用户：
帮我画 S01 的时序图

🤖 AI：
[读取 scenario-architect Skill]
[检查前置文档：需求 ✓、产品设计 ✓、架构概要 ✓]
[读取 S01 的需求定义 + 产品设计 + 架构图]

# S01: CLI 初始化项目 — 场景实现

## 参与方（对齐架构图）

| 别名 | 组件 | 说明 |
|------|------|------|
| U | 用户终端 | 执行 CLI 命令的终端 |
| CLI | openlogos CLI | 命令行工具主进程 |
| FS | 本地文件系统 | 目录和文件操作目标 |

## 时序图

sequenceDiagram
    participant U as 用户终端
    participant CLI as openlogos CLI
    participant FS as 本地文件系统

    U->>CLI: openlogos init [name]
    CLI->>FS: 检查 logos/logos.config.json 是否存在
    FS-->>CLI: 存在/不存在

    alt logos.config.json 已存在
        CLI-->>U: Error: already initialized (exit 1)
    else 不存在
        CLI->>CLI: 语言选择交互
        CLI->>CLI: 解析项目名（参数 > package.json > 目录名）

        opt 用户传入 name 且与配置文件不一致
            CLI-->>U: 提示冲突，等待选择
            U->>CLI: 选择 1 或 2
        end

        loop 创建目录结构
            CLI->>FS: mkdirSync(logos/resources/...)
            CLI->>FS: writeFileSync(.gitkeep)
        end
        CLI->>FS: 写入 logos.config.json
        CLI->>FS: 写入 logos-project.yaml
        CLI->>FS: 写入 AGENTS.md + CLAUDE.md
        CLI-->>U: 输出文件清单 + Next steps
    end

## 步骤说明

| Step | 动作 | 输入 | 输出 | 异常分支 |
|------|------|------|------|---------|
| 1 | 用户运行 `openlogos init [name]` | CLI 命令 + 可选项目名 | — | — |
| 2 | 检查 `logos/logos.config.json` | 文件系统路径 | 存在/不存在 | EX-2.1: 已存在 → 报错退出 |
| 3 | 语言选择交互 | stdin | locale (en/zh) | 非 TTY → 默认 en |
| 4 | 解析项目名 | 参数、package.json、目录名 | 确定的项目名 | EX-4.1: 冲突 → 用户确认 |
| 5 | 创建目录结构 + 配置文件 | 项目名、locale | logos/ 目录树 | — |
| 6 | 输出结果 | 创建结果 | 文件清单 + Next steps | — |

## 异常用例

### EX-2.1: 项目已初始化
- **触发**: Step 2 检测到 `logos/logos.config.json` 已存在
- **处理**: 输出错误到 stderr，退出码 1
- **输出**: `Error: logos/logos.config.json already exists in current directory.`

### EX-4.1: 项目名冲突
- **触发**: Step 4 用户传入的名称与 package.json 中的名称不一致
- **处理**: 提示用户选择（默认使用用户传入的名称）
- **恢复**: 用户选择后继续 Step 5

文件已保存到 `logos/resources/prd/3-technical-plan/2-scenario-implementation/S01-cli-init.md`。

需要调整吗？还是继续画 S02？
```

---

## S05: api-designer + db-designer 对话脚本

### 场景 A：API + DB 连续设计

```
👤 用户：
帮我设计 API

🤖 AI：
[读取 api-designer Skill]
[检查时序图 → 存在]
[从时序图中提取跨系统调用]

从时序图中识别到 12 个 API 端点，按领域分为 3 组：
- auth（4 个端点）
- projects（5 个端点）
- billing（3 个端点）

开始生成 OpenAPI YAML？

👤 用户：
好的

🤖 AI：
好的，按领域逐组生成。先输出 auth 模块：

### logos/resources/api/auth.yaml

openapi: 3.1.0
info:
  title: Auth API
  version: 0.1.0
paths:
  /api/auth/register:
    post:
      operationId: register
      summary: 用户注册
      description: 来源：S01 Step 2 → Step 3
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email: { type: string, format: email }
                password: { type: string, minLength: 8 }
      responses:
        '201':
          description: 注册成功，发送验证邮件
          content:
            application/json:
              schema:
                type: object
                properties:
                  userId: { type: string, format: uuid }
                  message: { type: string }
        '409':
          description: 邮箱已被注册
  /api/auth/login:
    post:
      operationId: login
      summary: 密码登录
      description: 来源：S02 Step 1 → Step 3
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email: { type: string, format: email }
                password: { type: string }
      responses:
        '200':
          description: 登录成功
          content:
            application/json:
              schema:
                type: object
                properties:
                  accessToken: { type: string }
                  refreshToken: { type: string }
        '401':
          description: 邮箱或密码错误
  # ...POST /api/auth/logout, POST /api/auth/reset-password

auth 模块完成（4 个端点）。继续输出 projects 和 billing 模块...

[输出 projects.yaml 和 billing.yaml]

API 设计完成，3 个 YAML 文件已保存到 `logos/resources/api/`：
- auth.yaml（4 个端点）
- projects.yaml（5 个端点）
- billing.yaml（3 个端点）

每个端点的 `description` 字段标注了来源时序图步骤，方便追溯。
是否继续推导数据库 DDL？数据库类型将使用 `logos-project.yaml` 中
配置的 PostgreSQL。

👤 用户：
继续

🤖 AI：
[读取 db-designer Skill + tech_stack.database → PostgreSQL]
[从 API schema 推导实体关系]

好的，从 API 端点的 requestBody/response 推导出 8 张表。
先输出核心的 users 和 projects 表：

### logos/resources/database/schema.sql

-- ============================================
-- OpenLogos Auto-generated DDL (PostgreSQL)
-- Source: logos/resources/api/*.yaml
-- ============================================

-- 用户表（来源：auth.yaml → register, login）
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  password    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'disabled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 项目表（来源：projects.yaml → create, list, get）
CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_owner ON projects(owner_id);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- ...subscriptions, invoices, password_resets 等 6 张表

DB 设计完成，DDL 已保存到 `logos/resources/database/schema.sql`。
共 8 张表、所有表已启用 RLS、外键和索引已就绪。

请 review，特别关注：
- 字段类型和约束是否合理
- 索引策略是否满足查询需求
- RLS 策略是否需要细化
```

---

## S06: 测试设计对话脚本

S06 分为两个子步骤，分别由 `test-writer`（Step 3a）和 `test-orchestrator`（Step 3b）完成。

### Step 3a: test-writer — 场景 A：正常生成测试用例

```
👤 用户：
帮我设计测试用例

🤖 AI：
[读取 test-writer Skill]
[检查前置文档：时序图 ✓、API YAML ✓、DB DDL ✓]
[读取 S01 时序图 + API YAML + DB DDL]

从 S01 的上下文中识别到：
- 时序图：6 个 Step + 2 个 EX 异常用例
- API 端点：POST /api/auth/register（8 个字段约束）
- DB 表：users（3 个约束：UNIQUE email、CHECK status、NOT NULL）

将为 S01 设计两类测试用例：
- **单元测试**：基于 API 字段约束 + DB 约束 + 业务规则
- **场景测试**：基于时序图 Step 序列 + EX 异常路径

开始设计？

👤 用户：
开始

🤖 AI：
### logos/resources/test/S01-test-cases.md

# S01: 用户注册 — 测试用例

## 一、单元测试用例

### 1.1 邮箱校验

| ID | 描述 | 输入 | 预期 |
|----|------|------|------|
| UT-S01-01 | 合法邮箱 | user@example.com | 校验通过 |
| UT-S01-02 | 无 @ 符号 | userexample.com | 返回 400 格式错误 |
| UT-S01-03 | 空字符串 | "" | 返回 400 必填 |

### 1.2 密码强度

| ID | 描述 | 输入 | 预期 |
|----|------|------|------|
| UT-S01-04 | 满足最小长度 | "Abcd1234" (8字符) | 校验通过 |
| UT-S01-05 | 低于最小长度 | "Ab1" (3字符) | 返回 400 密码太短 |

### 1.3 DB 约束

| ID | 描述 | 前置条件 | 操作 | 预期 |
|----|------|---------|------|------|
| UT-S01-06 | 唯一邮箱约束 | 已存在 user@example.com | 再次插入同邮箱 | UNIQUE 冲突 |
| UT-S01-07 | status 枚举约束 | — | 插入 status='unknown' | CHECK 失败 |

## 二、场景测试用例

### 2.1 主路径：注册成功

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S01-01 | 正常注册流程 | Step 1→6 | 无已注册用户 | 提交合法邮箱+密码 → 验证邮件发送 → 点击激活链接 | 用户状态变为 active |

### 2.2 异常路径

| ID | 描述 | 覆盖 EX | 前置条件 | 触发条件 | 预期结果 |
|----|------|--------|---------|---------|---------|
| ST-S01-02 | 重复邮箱注册 | EX-2.1 | user@example.com 已注册 | 提交同邮箱 | 返回 409 + 不创建新记录 |
| ST-S01-03 | 验证链接过期 | EX-4.1 | 用户已注册未激活 | 24h 后点击链接 | 返回错误 + 提示重新发送 |

S01 测试用例已设计完成：
- 7 个单元测试用例
- 3 个场景测试用例
- 文件保存到 `logos/resources/test/S01-test-cases.md`

当前项目涉及 API，继续进入 Step 3b 设计 API 编排测试？
```

### Step 3a: test-writer — 场景 B：非 API 项目

```
👤 用户：
帮我设计测试用例

🤖 AI：
[读取 test-writer Skill]
[检查前置文档：时序图 ✓、API YAML → 无（纯 CLI）、DB DDL → 无]

从 S01 的时序图中识别到 6 个 Step + 2 个 EX。当前为 CLI 项目，
将基于时序图 Step 和业务规则设计测试用例。

[输出测试用例规格文档]

S01 测试用例设计完成：
- 5 个单元测试用例（参数解析、配置验证等）
- 3 个场景测试用例（主路径 + 2 个异常路径）
- 文件保存到 `logos/resources/test/S01-test-cases.md`

当前项目不涉及 API，编排测试（Step 3b）跳过。
测试设计已全部完成，建议进入代码生成：
对我说「按 S01 的规格帮我实现」。
```

### Step 3b: test-orchestrator — 场景 A：正常生成编排（含外部依赖）

```
👤 用户：
继续设计编排测试

🤖 AI：
[读取 test-orchestrator Skill]
[检查 logos/resources/api/ → 存在]
[读取 API YAML + 时序图]
[读取 logos-project.yaml → external_dependencies 存在，3 个依赖]

从 API 规格中识别到 5 个核心场景的调用链，其中 4 个步骤涉及外部依赖
（已从 `logos-project.yaml` 匹配到 mock 策略）：

| 步骤 | 外部依赖 | 测试策略 |
|------|---------|---------|
| S01 Step 3: 发送验证邮件 | 邮件服务 | test-api |
| S01 Step 4: 验证图形验证码 | 图形验证码 | env-disable |
| S03 Step 2: 发送重置邮件 | 邮件服务 | test-api |
| S05 Step 5: 等待支付回调 | 支付 | mock-callback |

开始生成编排测试？

👤 用户：
开始

🤖 AI：
[逐场景输出编排 JSON，涉及外部依赖的步骤自动插入 mock 字段]

编排测试完成：
- 5 个正常流程编排
- 11 个异常流程编排
- 4 个步骤使用了 mock 策略（test-api ×2, env-disable ×1, mock-callback ×1）

文件已保存到 `logos/resources/scenario/`。

测试设计全部完成（Step 3a + 3b），建议进入代码生成：
对我说「按 S01 的规格帮我实现」。
```

### Step 3b: test-orchestrator — 场景 B：外部依赖缺少测试策略

````
👤 用户：
继续设计编排测试

🤖 AI：
[读取 test-orchestrator Skill]
[检查 logos/resources/api/ → 存在]
[读取 API YAML + 时序图]
[读取 logos-project.yaml → external_dependencies 存在，但部分不完整]

从 API 规格中识别到 5 个核心场景的调用链。

⚠️ 发现 1 个外部依赖缺少测试策略：

- **短信验证码 (Twilio)**：在 S02-手机登录 中使用，但 `logos-project.yaml`
  的 `external_dependencies` 中未声明 `test_strategy`。

编排测试需要知道如何处理这个依赖。请选择测试策略：
1. `test-api` — 测试环境提供后门 API 获取验证码
2. `fixed-value` — 指定测试手机号使用固定验证码（如 13800000000 → 123456）
3. `env-disable` — 通过环境变量关闭短信验证
4. `mock-service` — 使用本地 mock 服务替代 Twilio

👤 用户：
用 fixed-value，测试号码 13800000000，固定验证码 123456

🤖 AI：
好的，我已记录短信验证码的测试策略。建议你同步更新 `logos-project.yaml`
的 `external_dependencies`：

```yaml
- name: "短信验证码"
  provider: "Twilio"
  used_in: ["S02-手机登录"]
  test_strategy: "fixed-value"
  test_config: "测试号码 13800000000，固定验证码 123456"
```

继续生成编排测试，将在 S02 的验证码步骤中直接注入固定值 123456。

编排测试完成：
- 5 个正常流程编排
- 11 个异常流程编排
- 5 个步骤使用了 mock 策略

文件已保存到 `logos/resources/scenario/`。

测试设计全部完成（Step 3a + 3b），建议进入代码生成：
对我说「按 S01 的规格帮我实现」。
````

---

## S07: 代码 + 测试代码生成对话脚本

### 场景 A：完整上下文

```
👤 用户：
按 S01 的规格帮我实现

🤖 AI：
[检查 S01 的上下文文档]
S01 上下文已加载：
- ✅ 需求定义（Phase 1）
- ✅ 交互规格（Phase 2）
- ✅ 架构概要（Phase 3 Step 0）
- ✅ 时序图（6 个 Step + 2 个 EX）
- ✅ API YAML（2 个端点）
- ✅ DB DDL（1 张表）
- ✅ 测试用例规格（7 个单元测试 + 3 个场景测试）
- ✅ 编排测试（1 正常 + 2 异常）

开始按时序图 Step 逐步生成业务代码 + 测试代码？

👤 用户：
开始

🤖 AI：
[按 Step 逐步生成业务代码 + 单元测试代码 + 场景测试代码]

S01 代码生成完成：
- 业务代码：覆盖 6 个 Step + 2 个 EX
- 单元测试：7 个用例（对应 UT-S01-01 ~ UT-S01-07）
- 场景测试：3 个用例（对应 ST-S01-01 ~ ST-S01-03）
- OpenLogos reporter 已内嵌（运行测试后结果自动写入 test-results.jsonl）

请 review。测试通过后运行 `openlogos verify` 查看验收报告。
要继续 S02 吗？
```

### 场景 B：上下文不完整（缺少测试用例）

```
👤 用户：
帮我实现 S01

🤖 AI：
S01 的上下文检查结果：
- ✅ 需求定义
- ✅ 交互规格
- ✅ 架构概要
- ✅ 时序图
- ✅ API YAML
- ✅ DB DDL
- ❌ 测试用例规格（缺失：logos/resources/test/S01-test-cases.md）
- ❌ 编排测试（缺失）

建议先补全测试设计再生成代码。
对我说「帮我设计 S01 的测试用例」，
我会先完成测试用例设计（Step 3a → 3b），然后再回来生成代码。
```

---

## S09: 变更管理（change-writer + merge-executor）

### change-writer — 场景 A：完整填写变更提案

```
👤 用户：
帮我填写变更提案 add-remember-me

🤖 AI：
好的，我来帮你填写变更提案。先了解下变更意图：

1. 你要做什么变更？（新增功能 / 修改现有功能 / 修复 Bug）
2. 涉及哪些场景？（S01, S02... 如果还不确定也可以描述功能）
3. 变更的原因是什么？

👤 用户：
我想给 S02 登录场景加一个"记住密码"功能，用户反馈每次都要重新输密码很麻烦

🤖 AI：
明白了。让我分析影响范围...

扫描 logos/resources/ 中与 S02 相关的文档：
- ✅ 需求文档：S02 密码登录（logos/resources/prd/1-product-requirements/01-requirements.md）
- ✅ 功能规格：S02 交互设计（logos/resources/prd/2-product-design/1-feature-specs/...）
- ✅ 时序图：S02 登录时序（logos/resources/prd/3-technical-plan/2-scenario-implementation/...）
- ✅ API：POST /api/auth/login（logos/resources/api/auth.yaml）
- ✅ DB：users 表（logos/resources/database/schema.sql）
- ✅ 编排测试：login.json（logos/resources/scenario/login.json）

**判定：需求级变更**——需要新增验收条件和交互流程，影响全链路。

已生成：
- ✓ logos/changes/add-remember-me/proposal.md（变更原因 + 影响范围）
- ✓ logos/changes/add-remember-me/tasks.md（8 项任务，按 Phase 排列）

对我说「按 tasks.md 帮我逐步更新 S02 的所有受影响文档」，
我会按顺序逐项执行，每完成一项向你汇报并继续下一项。
```

### change-writer — 场景 B：信息不足

```
👤 用户：
帮我填写变更提案 fix-login-bug

🤖 AI：
好的，我来帮你填写。请描述一下这个变更：

1. 具体是什么 Bug？
2. 涉及哪些场景？
3. 是代码问题还是设计问题？

👤 用户：
登录接口偶尔返回 500

🤖 AI：
了解。这看起来是代码级修复：
- 涉及场景：S02 密码登录
- 影响范围：代码 + 重新验收
- 不需要改需求、设计或 API 定义

**判定：代码级修复**——只需修代码和重新跑编排验收。

已生成：
- ✓ logos/changes/fix-login-bug/proposal.md
- ✓ logos/changes/fix-login-bug/tasks.md（2 项任务）

对我说「帮我修复 S02 登录接口的 500 错误并重新验收」，
我会定位问题、修复代码，然后跑编排测试验证。
```

### merge-executor — 场景 A：正常合并

```
👤 用户：
读取 logos/changes/add-remember-me/MERGE_PROMPT.md 并执行合并

🤖 AI：
读取合并指令...

提案：add-remember-me
共 3 个 Delta 文件需要合并。

**[1/3] deltas/prd/requirements-delta.md → logos/resources/prd/1-product-requirements/01-requirements.md**
- MODIFIED: 更新 S02 验收条件，新增"记住密码"正常/异常路径
- ADDED: 场景总览表新增 S02.1 子场景

修改摘要：第 73 行插入 S02.1 行，第 145-170 行替换 S02 验收条件。
继续处理下一个？

👤 用户：
继续

🤖 AI：
**[2/3] deltas/api/auth-delta.yaml → logos/resources/api/auth.yaml**
- ADDED: 新增 POST /api/auth/remember-token 端点
- MODIFIED: 更新 POST /api/auth/login 的 requestBody 增加 rememberMe 字段

修改摘要：新增端点 + 更新 login 端点 schema。
继续处理下一个？

👤 用户：
继续

🤖 AI：
**[3/3] deltas/database/auth-delta.sql → logos/resources/database/schema.sql**
- ADDED: CREATE TABLE remember_tokens (...)

修改摘要：文件末尾追加新表定义。

合并完成：
- 01-requirements.md：新增 1 节，修改 1 节
- auth.yaml：新增 1 端点，修改 1 端点
- schema.sql：新增 1 表

请确认修改无误后，运行 `openlogos archive add-remember-me` 归档提案。
```

### merge-executor — 场景 B：delta 引用的章节找不到

```
👤 用户：
读取 logos/changes/add-remember-me/MERGE_PROMPT.md 并执行合并

🤖 AI：
读取合并指令...

**[1/2] deltas/prd/requirements-delta.md → logos/resources/prd/1-product-requirements/01-requirements.md**
- MODIFIED: 更新「S02: 密码登录」验收条件

⚠️ 主文档中未找到标题「S02: 密码登录」（可能已被重命名为「S02: 用户登录」）。

请确认：
1. 使用「S02: 用户登录」作为目标章节？
2. 手动指定要修改的位置？
3. 跳过此 delta，稍后手动处理？
```
