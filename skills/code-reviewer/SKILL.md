# Skill: Code Reviewer

> 审查 AI 生成的代码，基于 OpenLogos 全链路规格（API YAML、时序图 EX 用例、DB DDL）进行系统性校验，确保代码与设计文档完全一致，覆盖所有异常路径，满足安全要求。

## 触发条件

- 用户要求审查代码或 Code Review
- 用户提到 "Phase 3 Step 4"、"代码审核"、"代码审查"
- AI 刚生成了一段代码，需要验证其质量
- 部署前的最终检查
- 编排测试失败后需要定位代码问题

## 前置依赖

- `logos/resources/api/` 中包含 API YAML 规格
- `logos/resources/prd/3-technical-plan/2-scenario-implementation/` 中包含场景时序图（含 EX 用例）
- `logos/resources/database/` 中包含 DB DDL
- 待审查的代码已可读取

无 API 的项目（纯 CLI / 库）可省略 API 一致性检查，聚焦时序图覆盖和异常处理。

## 核心能力

1. 校验代码实现与 API YAML 规格的一致性
2. 检查异常处理是否覆盖所有 EX 用例
3. 检查 DB 操作是否符合 DDL 设计
4. 检查安全策略（认证、RLS、输入校验）
5. 检查代码风格和最佳实践
6. 输出结构化的审查报告

## 执行步骤

### Step 1: 加载规格上下文

**前置检查 — YAML 有效性（优先于一切）：**

在加载 API 规格之前，先验证所有 `logos/resources/api/*.yaml` 文件是否为有效 YAML 且符合 OpenAPI 3.x 规范。如果任何文件解析失败（例如 `description` 字段中特殊字符未加引号），立即报告为 **Critical** 阻塞项——在 YAML 错误修复前不进行后续审查。

**然后**读取以下文件，建立代码审查的"参照基准"：

- **API YAML**（`logos/resources/api/*.yaml`）：提取端点清单，记录每个端点的路径、方法、请求体 schema、响应 schema、状态码
- **场景时序图**（`logos/resources/prd/3-technical-plan/2-scenario-implementation/`）：提取所有 EX 异常用例编号和预期行为
- **DB DDL**（`logos/resources/database/`）：提取表结构、字段类型、约束、索引
- **`logos-project.yaml`**：读取 `tech_stack` 确认技术栈，`external_dependencies` 确认外部依赖

汇总为审查检查清单：

```markdown
审查范围：S01 相关代码
- API 端点：4 个（auth.yaml）
- EX 异常用例：7 个（EX-2.1 ~ EX-5.2）
- DB 表：2 张（users, profiles）
- 安全策略：RLS 2 条
```

### Step 2: API 一致性审查

逐个端点对比代码实现与 API YAML 规格：

**检查项**：

| 检查项 | 说明 | 严重程度 |
|--------|------|---------|
| 路径匹配 | 代码中的路由路径是否与 YAML 中的 `paths` 完全一致 | Critical |
| HTTP 方法 | GET/POST/PUT/DELETE 是否匹配 | Critical |
| 请求体字段 | 代码是否读取了 YAML 中 `requestBody.schema` 定义的所有 required 字段 | Critical |
| 请求体校验 | 字段类型、format（email/uuid）、minLength 等约束是否在代码中有校验 | Warning |
| 响应字段 | 代码返回的 JSON 字段名和类型是否与 YAML 中 `responses.schema` 一致 | Critical |
| 状态码 | 正常和异常情况下返回的 HTTP 状态码是否与 YAML 定义一致 | Critical |
| 错误响应格式 | 错误响应是否遵循 `{ code, message, details? }` 统一格式 | Warning |
| YAML 有效性 | `logos/resources/api/*.yaml` 所有文件是否为有效 YAML 且符合 OpenAPI 3.x 规范——`description`/`summary` 值中未加引号的特殊字符（`:`、`→`、`#`）是常见故障点 | Critical |

**输出格式**：

```markdown
### API 一致性

| 端点 | 检查项 | 状态 | 说明 |
|------|--------|------|------|
| POST /api/auth/register | 请求体字段 | ✅ | email, password 均已读取 |
| POST /api/auth/register | 响应状态码 | ❌ Critical | 注册成功返回 200，YAML 定义为 201 |
| POST /api/auth/register | 错误码 | ❌ Warning | 邮箱重复返回通用 400，YAML 定义为 409 |
```

### Step 3: 异常处理覆盖审查

将时序图中的所有 EX 异常用例与代码中的错误处理逐一对应：

1. 列出该场景所有 EX 编号及其预期行为
2. 在代码中查找对应的 try/catch、if/else、error handler
3. 标注未覆盖的 EX 用例

**检查重点**：

- 每个 EX 用例是否有对应的代码分支
- 异常情况下是否返回了正确的 HTTP 状态码和错误码
- 是否有"静默吞掉异常"的情况（catch 块为空或只打日志不返回错误）
- 外部服务调用（DB、第三方 API）是否都有超时和错误处理
- 是否存在时序图中没有但代码中多出的异常处理（可能意味着时序图遗漏）

**输出格式**：

```markdown
### 异常处理覆盖

| EX 编号 | 异常描述 | 代码覆盖 | 说明 |
|---------|---------|---------|------|
| EX-2.1 | 邮箱已注册 | ✅ | 返回 409，格式正确 |
| EX-2.2 | Auth 服务不可用 | ❌ Critical | 无 try/catch 包裹 supabase.auth.signUp 调用 |
| EX-4.1 | profiles 写入失败 | ❌ Critical | INSERT 失败后未回滚 auth.users 记录 |
```

### Step 4: DB 操作审查

检查代码中的数据库操作是否符合 DDL 设计：

**检查项**：

- **表名和列名**：代码中引用的表名/列名是否与 DDL 一致（无拼写错误、大小写差异）
- **字段类型**：代码中传入的值类型是否与 DDL 定义匹配（如 DDL 中 `INTEGER` 的金额字段，代码是否传入分值而非元）
- **约束遵守**：NOT NULL 字段是否确保有值、UNIQUE 字段是否做了冲突处理、CHECK 约束中的枚举值是否在代码中有对应常量
- **事务使用**：涉及多表写入的操作是否包裹在事务中
- **迁移一致**：DDL 中的最新字段是否在代码中已使用（避免 DDL 更新了但代码忘记跟进）

### Step 5: 安全审查

检查代码的安全实现：

| 检查项 | 说明 | 严重程度 |
|--------|------|---------|
| 认证检查 | 需认证的端点是否在处理逻辑前验证了 token/session | Critical |
| 授权检查 | 用户是否只能访问自己的数据（owner check） | Critical |
| 输入校验 | 用户输入是否做了类型校验和长度限制（防注入、防 XSS） | Critical |
| 敏感数据 | 响应中是否泄露了密码哈希、内部 ID、堆栈信息 | Critical |
| RLS 依赖 | 如果依赖 PostgreSQL RLS，代码是否正确设置了 `auth.uid()` 上下文 | Warning |
| SQL 注入 | 是否使用参数化查询（禁止字符串拼接 SQL） | Critical |
| 速率限制 | 关键端点（登录、注册）是否有防暴力破解的速率限制 | Warning |

### Step 6: 输出审查报告

按严重程度汇总所有发现，生成结构化报告：

```markdown
# 代码审查报告：S01 用户注册

## 审查范围
- 场景：S01
- 端点：4 个
- EX 用例：7 个
- 代码文件：src/api/auth/register.ts, src/api/auth/login.ts

## 审查摘要

| 严重程度 | 数量 |
|---------|------|
| 🔴 Critical | 2 |
| 🟡 Warning | 3 |
| 🔵 Info | 1 |

## Critical 发现

### [C1] POST /api/auth/register 状态码不匹配
- **规格来源**：auth.yaml → register → responses.201
- **问题**：代码返回 200，规格定义为 201
- **修复建议**：将 `res.status(200)` 改为 `res.status(201)`

### [C2] EX-2.2 未处理：Auth 服务不可用
- **规格来源**：S01 时序图 → EX-2.2
- **问题**：`supabase.auth.signUp()` 调用未包裹 try/catch
- **修复建议**：添加 try/catch，超时或 5xx 时返回 503

## Warning 发现
...

## Info 发现
...
```

**报告原则**：
- Critical 必须修复后才能进入编排验收
- Warning 建议修复，但不阻塞交付
- Info 为改进建议，可后续处理
- 每条发现都必须引用规格来源（API YAML、EX 编号、DDL）

## 输出规范

- 审查报告直接输出到对话中（不写文件）
- 按严重程度分类：Critical / Warning / Info
- 每条发现格式：编号 + 规格来源 + 问题描述 + 修复建议
- 末尾给出总结和下一步建议（如"修复 2 个 Critical 后可运行编排验收"）

## 实践经验

- **一致性优先**：代码必须与 API YAML 完全一致——字段名、类型、状态码都不能偏差。大部分线上 Bug 来自代码和规格的微妙不一致
- **异常处理是重点**：大部分 Bug 都出在异常路径上，仔细检查每个 EX 用例是否有对应的 catch/error handler
- **安全不打折**：认证检查、RLS 策略、输入校验，任何一项缺失都是 Critical
- **不要过度审查**：代码风格问题标记为 Info，不阻塞交付。审查的核心目标是"代码与规格一致"，不是"代码完美"
- **审查前先跑一遍**：如果代码能跑起来，先运行一次编排测试，用失败的 case 反向定位问题，比逐行看代码高效
- **关注补偿逻辑**：多步写入（如先创建 auth user 再写 profile）如果中途失败，是否有回滚或补偿机制——这是最容易遗漏的 Critical 问题

## 推荐提示词

以下提示词可以直接复制给 AI 使用：

- `帮我做代码审查`
- `帮我检查这段代码是否符合 API YAML 规格`
- `Review 一下 S01 相关的代码实现`
- `帮我检查异常处理是否完整`
- `帮我检查安全策略是否到位`
