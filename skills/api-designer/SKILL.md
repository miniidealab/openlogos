# Skill: API Designer

> [WIP] 基于时序图设计 OpenAPI 3.0 YAML 规格，定义请求/响应结构、错误码体系、认证方案。

## 触发条件

- 用户要求设计 API 或编写 API 文档
- 用户提到 "Phase 3 Step 2"、"API 设计"
- 已有场景时序图，需要细化 API 规格
- 用户提供了一个 API 端点需要详细设计

## 核心能力

1. 从时序图中提取 API 端点列表
2. 设计 OpenAPI 3.0 YAML 规格（路径、参数、响应结构）
3. 定义统一的错误响应格式：`{ code, message, details? }`
4. 设计认证方案（Bearer Token / API Key）
5. 设计分页、排序、过滤的标准化参数

## 执行步骤

> 详细步骤待完善。核心流程：
>
> 1. 收集所有时序图中跨系统边界的调用
> 2. 去重和合并，形成 API 端点清单
> 3. 按领域分组（auth, payment, license 等）
> 4. 为每个端点设计详细规格
> 5. 输出 OpenAPI YAML 文件

## 输出规范

- 文件格式：OpenAPI 3.0 YAML
- 存放位置：`resources/api/`
- 按领域分文件：`auth.yaml`、`payment.yaml`
- 错误响应统一格式：`{ code: string, message: string, details?: object }`

## 实践经验

- **路径命名**：RESTful 风格，使用复数名词，`/api/{resource}`
- **版本前缀**：初期不加版本前缀（`/api/auth/register`），需要版本管理时再加 `/api/v2/`
- **状态码语义**：严格遵循 HTTP 状态码语义（201 创建成功、409 冲突、422 验证失败）
- **幂等设计**：PUT/DELETE 操作必须幂等
- **敏感数据**：响应中不包含密码、token 等敏感信息的明文
