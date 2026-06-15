---
title: api-designer
description: 基于时序图中跨边界调用设计 OpenAPI 规格。
---

基于时序图设计 OpenAPI 3.0+ YAML 规格，让 API 从场景中自然浮现，而非孤立定义。每个端点都可追溯到时序图中的 Step 编号，确保「无场景，不设计 API」。

## Phase 与触发条件

- **Phase**：Phase 3 — HOW（实现），Step 2
- **触发条件**：
  - 用户请求 API 设计或 API 文档
  - 用户提到「Phase 3 Step 2」或「API 设计」
  - 场景时序图已存在

## 前置条件

- 时序图位于 `logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 架构概览位于 `logos/resources/prd/3-technical-plan/1-architecture/`
- `logos-project.yaml` 中已填写 `tech_stack`

## 它做了什么

1. 从时序图中提取所有跨系统边界的 API 调用
2. 去重、合并并按领域分组成端点清单
3. 设计 OpenAPI 3.0+ YAML 规格（路径、参数、请求体、响应）
4. 定义统一错误响应格式与错误码体系
5. 设计认证方案（Bearer Token / API Key / Cookie）
6. 设计分页、排序与过滤约定

## 执行步骤

### Step 1：阅读场景上下文

阅读时序图、架构概览与 `logos-project.yaml` 以建立上下文。

### Step 2：提取端点清单

遍历所有时序图，收集跨边界箭头，去重，并输出汇总表：

```markdown
| # | Method | Path | Source Scenario | Domain |
|---|--------|------|-----------------|--------|
| 1 | POST | /api/auth/register | S01 Step 2 | auth |
| 2 | POST | /api/auth/login | S02 Step 1 | auth |
```

### Step 3：按领域分组

将端点按业务领域分组，每组成为一个 YAML 文件（`auth.yaml`、`projects.yaml`、`billing.yaml`）。

### Step 4：设计统一约定

在设计单个端点之前先确立全局约定：安全方案、统一错误响应（`{ code, message, details? }`）与分页参数。

### Step 5：设计端点规格

每个端点包含：`operationId`、`summary`、`description`（标注来源时序图步骤）、`requestBody`，以及覆盖正常 + 来自 EX 情况的所有已知异常的 `responses`。

### Step 6：验证可追溯性

- **正向**：每个跨系统箭头都有对应的 API 端点
- **反向**：每个端点的 `description` 都标注其来源 Step
- **异常**：每个 EX 情况都有对应的 HTTP 错误响应

## YAML 格式规则

1. **`description` 与 `summary` 始终用双引号包裹** —— 任何包含 `:`、`→`、`#` 或其他特殊字符的字符串都必须放入 `"..."`
2. **响应状态码键加引号** —— 使用 `'201'` 而非 `201`
3. **生成后自检** —— 确认没有未加引号的特殊字符
4. **拿不准就加引号** —— 给安全字符串加引号无害

## 产出

| 文件 | 位置 |
|------|----------|
| API YAML 文件 | `logos/resources/api/` |
| 按领域拆分 | `auth.yaml`、`projects.yaml` 等 |
| 格式 | OpenAPI 3.1 YAML |

## 最佳实践

- **API 从时序图中浮现** —— 先设计图，再设计 API
- **RESTful 路径命名** —— 使用复数名词，`/api/{resource}`
- **初期不加版本前缀** —— 当确有版本化需要时再加 `/api/v2/`
- **严格的 HTTP 状态码语义** —— 201 创建、409 冲突、422 校验失败
- **按领域输出** —— 让用户在继续前逐批审查
- **字段名与 DB 对齐** —— 减少代码中不必要的转换

## 相关 Skill

- 上一步：[`scenario-architect`](/zh/skills/scenario-architect) —— 创建时序图
- 并行：[`db-designer`](/zh/skills/db-designer) —— 设计数据库 schema
- 下一步：[`test-writer`](/zh/skills/test-writer) —— 设计测试用例
