# Skill: API Designer

> 基于时序图设计 OpenAPI 3.0+ YAML 规格，让 API 从场景中自然浮现而非凭空定义。每个端点可追溯到时序图的 Step 编号，确保"无场景不设计 API"。

## 触发条件

- 用户要求设计 API 或编写 API 文档
- 用户提到 "Phase 3 Step 2"、"API 设计"
- 已有场景时序图，需要细化 API 规格
- 用户提供了一个 API 端点需要详细设计

## 前置依赖

- `logos/resources/prd/3-technical-plan/2-scenario-implementation/` 中包含场景时序图
- `logos/resources/prd/3-technical-plan/1-architecture/` 中包含架构概要（确认前后端分离方式、认证方案等）
- `logos-project.yaml` 的 `tech_stack` 已填写

如果时序图目录为空，提示用户先完成 Phase 3 Step 1（scenario-architect）。

## 核心能力

1. 从时序图中提取所有跨系统边界的 API 调用
2. 去重、合并、按领域分组，形成端点清单
3. 设计 OpenAPI 3.0+ YAML 规格（路径、参数、请求体、响应结构）
4. 定义统一的错误响应格式和错误码体系
5. 设计认证方案（Bearer Token / API Key / Cookie）
6. 设计分页、排序、过滤的标准化参数

## 执行步骤

### Step 1: 读取场景上下文

读取以下文件建立完整上下文：

- **场景时序图**（`logos/resources/prd/3-technical-plan/2-scenario-implementation/`）：提取所有跨系统边界的箭头
- **架构概要**（`logos/resources/prd/3-technical-plan/1-architecture/`）：确认认证方案、前后端分离方式、API 网关等
- **`logos-project.yaml`**：读取 `tech_stack` 确认后端框架和部署方式

### Step 2: 提取端点清单

遍历所有场景时序图，收集每个跨系统边界的调用箭头：

1. 识别"跨系统边界"的箭头——客户端到服务端、服务端到外部服务、服务间调用
2. 为每个箭头提取：HTTP 方法、路径、所属场景编号和 Step 编号
3. 去重合并——同一个端点可能在多个场景中出现（如 `POST /api/auth/login` 可能在 S02 和 S03 都有）
4. 输出端点清单摘要供用户确认：

```markdown
从时序图中识别到 N 个 API 端点：

| # | 方法 | 路径 | 来源场景 | 领域 |
|---|------|------|---------|------|
| 1 | POST | /api/auth/register | S01 Step 2 | auth |
| 2 | POST | /api/auth/login | S02 Step 1 | auth |
| 3 | GET  | /api/projects | S04 Step 1 | projects |
```

### Step 3: 按领域分组

将端点按业务领域分组，每组对应一个 YAML 文件：

- `auth.yaml` — 认证相关（注册、登录、登出、重置密码）
- `projects.yaml` — 核心业务对象的 CRUD
- `billing.yaml` — 支付和订阅

分组原则：
- 同一数据实体的操作放在一起
- 认证/授权独立分组
- 第三方服务回调（如支付回调）放在对应业务领域

### Step 4: 设计统一约定

在生成具体端点前，先确定全局约定：

**认证方案**（从架构概要中读取）：

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

**统一错误响应**：

```yaml
components:
  schemas:
    ErrorResponse:
      type: object
      required: [code, message]
      properties:
        code:
          type: string
          description: 机器可读的错误码（如 EMAIL_EXISTS）
        message:
          type: string
          description: 人类可读的错误描述
        details:
          type: object
          description: 附加错误信息（如字段级校验错误）
```

**分页参数**（适用于列表端点）：

```yaml
parameters:
  - name: page
    in: query
    schema: { type: integer, minimum: 1, default: 1 }
  - name: per_page
    in: query
    schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
```

### Step 5: 逐端点设计详细规格

为每个端点设计完整的 OpenAPI 规格，**逐领域输出**，每完成一个领域暂停让用户 review：

每个端点必须包含：
- `operationId`：唯一标识符，用于代码生成
- `summary`：一句话描述
- `description`：标注来源时序图步骤（如 `来源：S01 Step 2 → Step 3`）
- `requestBody`：包含所有字段的 schema（含 required、类型、校验规则如 minLength/format）
- `responses`：覆盖正常响应 + 所有已知异常（从时序图的 EX 用例中提取）

**示例**：

```yaml
paths:
  /api/auth/register:
    post:
      operationId: register
      summary: 用户注册
      description: "来源：S01 Step 2 → Step 3"
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
          description: "邮箱已被注册（EX-2.1）"
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '422':
          description: 请求参数校验失败
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
```

### Step 6: 验证追溯完整性

输出完成后，做一次追溯检查：

1. **正向检查**：每个时序图中的跨系统箭头都有对应的 API 端点
2. **反向检查**：每个 API 端点的 `description` 都标注了来源 Step
3. **异常覆盖**：时序图中的每个 EX 用例都有对应的 HTTP 错误响应

如果发现遗漏，补充后再输出最终版本。

## 输出规范

- 文件格式：OpenAPI 3.1 YAML
- 存放位置：`logos/resources/api/`
- 按领域分文件：`auth.yaml`、`projects.yaml`、`billing.yaml`
- 每个文件包含完整的 `openapi`、`info`、`paths`、`components` 段
- 错误响应统一引用 `$ref: '#/components/schemas/ErrorResponse'`
- 每个端点的 `description` 必须标注来源时序图步骤

## YAML 格式规则（必须遵守）

YAML 对空白和特殊字符敏感。AI 生成的 YAML 经常因为特殊字符未加引号而导致解析失败。**必须严格遵守以下规则：**

1. **`description` 和 `summary` 的值必须用双引号包裹** — 任何包含 `:`、`→`、`#`、`&`、`*`、`!`、`>`、`|`、`%`、`@`、`` ` ``、`{`、`}`、`[`、`]` 的字符串都必须用 `"..."` 包裹。
   ```yaml
   # ❌ 错误 — 冒号和箭头导致 YAML 解析失败
   description: 来源：S05 Step 1 → Step 4.

   # ✅ 正确
   description: "来源：S05 Step 1 → Step 4."
   ```
2. **响应状态码 key 必须加引号** — 使用 `'201'` 而非 `201`，防止 YAML 将其解析为整数。
3. **生成后自检** — 每生成一个 YAML 文件后，重新审视是否存在未加引号的特殊字符。尤其注意引用场景步骤的 `description` 字段（它们总是包含 `:`）。
4. **拿不准就加引号** — 给安全字符串加引号无害，但漏掉危险字符串的引号会导致整个文件解析失败。

## 实践经验

- **API 从时序图浮现**：如果一个 API 在时序图中找不到出处，它大概率不应该存在。先画时序图再设计 API，而非反过来
- **路径命名**：RESTful 风格，使用复数名词，`/api/{resource}`
- **版本前缀**：初期不加版本前缀（`/api/auth/register`），需要版本管理时再加 `/api/v2/`
- **状态码语义**：严格遵循 HTTP 状态码语义——200 成功、201 创建、400 参数错误、401 未认证、403 无权限、404 不存在、409 冲突、422 校验失败、500 服务错误
- **幂等设计**：PUT/DELETE 操作必须幂等
- **敏感数据**：响应中不包含密码、token 等敏感信息的明文
- **逐领域输出**：不要一次输出所有端点——按领域分批输出，每批让用户 review 后再继续
- **字段命名一致**：API 中的字段名要与后续 DB 设计中的列名保持一致（或有明确的映射规则），避免代码层出现不必要的字段转换

## 推荐提示词

以下提示词可以直接复制给 AI 使用：

- `帮我设计 API`
- `基于时序图帮我生成 OpenAPI YAML`
- `帮我设计 S01 相关的 API 规格`
- `帮我把所有时序图中的跨系统调用提取为 API`

## ⚠️ 收尾步骤（强制）：更新 resource_index

完成本 Skill 的所有 OpenAPI YAML 产出后，**必须**将新生成的文件追加写入 `logos/logos-project.yaml` 的 `resource_index` 字段：

```yaml
resource_index:
  # ...已有条目...
  - path: logos/resources/api/<文件名>.yaml
    desc: <领域名称> API 规格（OpenAPI 3.x）。涉及 <相关端点> 的请求/响应结构、状态码、认证方式时必读。
```

**不执行此步骤将导致后续 test-writer/code-implementor 无法感知 API 规格文件，AI 将无法基于正确的接口定义编写测试和代码。**
