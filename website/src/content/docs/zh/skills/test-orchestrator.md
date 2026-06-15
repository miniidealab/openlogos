---
title: test-orchestrator
description: 将 API 编排测试场景设计为可执行的 JSON（仅 API 项目）。
---

基于业务场景与时序图设计 API 编排测试用例，覆盖正常/异常/边界场景。自动识别外部依赖并应用测试策略。**仅适用于涉及 API 的项目。**

## Phase 与触发条件

- **Phase**：Phase 3 — HOW（实现），Step 3b
- **触发条件**：
  - 用户请求 API 编排测试设计
  - 用户提到「Phase 3 Step 3b」「API 编排」
  - Step 3a（[`test-writer`](/zh/skills/test-writer)）已完成之后

## 前置条件

- 测试用例规格位于 `logos/resources/test/`（Step 3a 已完成）
- 时序图位于 `logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- API 规格位于 `logos/resources/api/`
- `logos-project.yaml` 中的 `external_dependencies`（如适用）

如果项目不涉及 API（纯 CLI、纯前端），跳过此 Skill。

## 与 test-writer 的关系

此 Skill 处理测试金字塔的**顶层** —— HTTP 请求层级的 API 编排测试。

[`test-writer`](/zh/skills/test-writer) 处理下层 —— 函数调用层级的单元测试与场景测试。Step 3a 对所有项目都是强制的；Step 3b（此 Skill）仅在项目有 API 时运行。

## 它做了什么

1. 从时序图与 API YAML 设计正常流程编排
2. 基于 EX 情况设计异常流程编排
3. 设计边界用例（有效但非正常路径的变体）
4. 定义步骤之间的变量提取与传递
5. 识别外部依赖并应用 `logos-project.yaml` 中的测试策略
6. 输出可执行的编排 JSON 文件

## 外部依赖处理

`mock` 字段会插入到涉及外部服务的步骤中：

```json
{
  "step": "Step 2: Get email verification code",
  "mock": {
    "dependency": "Email Service",
    "strategy": "test-api",
    "config": "GET /api/test/latest-email?to={email}",
    "extract": { "code": "response.body.code" }
  },
  "method": "GET",
  "url": "/api/test/latest-email?to={{email}}",
  "expected_status": 200
}
```

支持的策略：`test-api`、`fixed-value`、`env-disable`、`mock-callback`、`mock-service`。

如果时序图中的某个依赖在 `external_dependencies` 中缺失，此 Skill 会主动请用户定义它。

## 产出

| 文件 | 位置 |
|------|----------|
| 编排 JSON | `logos/resources/scenario/` |
| 按场景拆分 | `user-auth.json`、`payment-flow.json` |

编排中的每个步骤都对应时序图中的一个 Step 编号。

编排测试结果同样以与单元/场景测试相同的格式写入 `logos/resources/verify/test-results.jsonl`，并由 `openlogos verify` 统一读取。

## 最佳实践

- **正常编排是骨架** —— 先完成正常路径
- **每个外部调用至少 1 个异常编排**
- **变量传递** —— 从上一步响应中提取（token、user_id）供后续步骤使用
- **测试数据** —— 编排前准备、编排后清理，确保幂等性
- **不要臆造 mock 策略** —— 测试策略在 [`architecture-designer`](/zh/skills/architecture-designer) 中定义，此处仅消费

## 相关 Skill

- 上一步：[`test-writer`](/zh/skills/test-writer) —— 设计单元/场景测试
- 下一步：[`code-implementor`](/zh/skills/code-implementor) —— 忠于规格生成代码（Phase 3 Step 4）
- 审查：[`code-reviewer`](/zh/skills/code-reviewer) —— 审查生成的代码
