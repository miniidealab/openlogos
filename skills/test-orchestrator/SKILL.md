# Skill: Test Orchestrator

> 基于业务场景和时序图设计 **API 编排测试**用例（Phase 3 Step 3b），覆盖正常/异常/边界场景，自动识别外部依赖并应用测试策略，作为端到端 API 验收标准。**仅适用于涉及 API 的项目。**

## 与 test-writer 的关系

本 Skill 负责测试金字塔的**顶层**——API 编排测试（HTTP 请求级别），执行于 Phase 3 Step 3b。

底层的单元测试和场景测试（函数调用级别）由 `test-writer` Skill 在 Step 3a 完成。Step 3a 是所有项目的必选步骤，Step 3b（本 Skill）仅在项目涉及 API 时执行。

## 触发条件

- 用户要求设计 API 编排测试
- 用户提到 "Phase 3 Step 3b"、"API 编排"、"编排测试"
- Step 3a（test-writer）完成后，AI 引导用户继续进入 Step 3b
- 用户需要验收已部署的 API 代码

## 前置依赖

- `logos/resources/test/` 中包含测试用例规格文档（Step 3a 已完成）
- `logos/resources/prd/3-technical-plan/2-scenario-implementation/` 中包含场景时序图
- `logos/resources/api/` 中包含 API 规格（OpenAPI YAML）
- `logos-project.yaml` 中包含 `external_dependencies`（如有）

如果项目不涉及 API（纯 CLI 工具、纯前端等），跳过此 Skill。

## 核心能力

1. 从时序图和 API YAML 设计正常流程编排
2. 基于异常用例（EX-N.M）设计异常流程编排
3. 设计边界用例（合法但非主路径的变体）
4. 定义变量提取和传递机制
5. **识别外部依赖并应用测试策略**：读取 `logos-project.yaml` 的 `external_dependencies`，在涉及外部服务的步骤中自动插入 `mock` 字段
6. 执行编排并验证结果

## 执行步骤

### Step 1: 读取场景上下文

读取以下文件建立完整上下文：

- 场景时序图（`logos/resources/prd/3-technical-plan/2-scenario-implementation/`）
- API YAML（`logos/resources/api/`）
- `logos-project.yaml` —— 重点读取 `external_dependencies` 字段

### Step 2: 识别外部依赖

将 `external_dependencies` 中的 `used_in` 与当前场景编号匹配。如果当前场景涉及外部依赖：

- 记录该依赖的 `test_strategy` 和 `test_config`
- 如果某个依赖声明了 `used_in` 但缺少 `test_strategy`，**主动询问用户**测试策略

如果 `logos-project.yaml` 中没有 `external_dependencies` 字段，但时序图中存在对外部服务的调用（如发送邮件、请求支付等），也应主动提醒用户补充。

### Step 3: 设计正常流程编排

按时序图的 Step 编号，逐步设计 API 调用链：

- 每步包含 method、url、headers、body、expected_status
- 涉及外部依赖的步骤，插入 `mock` 字段（见输出规范）
- 上一步响应中需要传递的变量，使用 `extract` 定义提取规则

### Step 4: 设计异常流程编排

为每个 EX 异常用例设计独立的编排，确保：

- 异常场景也能覆盖外部依赖的失败情况
- 使用 `mock` 字段模拟外部服务异常（如超时、返回错误等）

### Step 5: 设计边界用例编排

识别合法但非主路径的变体（如密码长度刚好在边界值、空字段等），补充编排。

### Step 6: 输出编排 JSON

按场景输出可执行的编排 JSON 文件。

## 输出规范

- 文件格式：JSON
- 存放位置：`logos/resources/scenario/`
- 按场景分文件：`user-auth.json`、`payment-flow.json`
- 编排中的每一步对应时序图的 Step 编号

### mock 字段结构

当某一步涉及外部依赖时，在该 step 中添加 `mock` 字段：

```json
{
  "step": "Step 2: 获取邮件验证码",
  "mock": {
    "dependency": "邮件服务",
    "strategy": "test-api",
    "config": "GET /api/test/latest-email?to={email}",
    "extract": { "code": "response.body.code" }
  },
  "method": "GET",
  "url": "/api/test/latest-email?to={{email}}",
  "expected_status": 200,
  "extract": {
    "verification_code": "body.code"
  }
}
```

`mock` 字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `dependency` | string | 对应 `external_dependencies` 中的 `name` |
| `strategy` | string | 测试策略（`test-api` / `fixed-value` / `env-disable` / `mock-callback` / `mock-service`） |
| `config` | string | 测试策略的具体配置，来自 `test_config` |
| `extract` | object | 从 mock 响应中提取变量（可选） |

不同策略的编排表现：

- **`test-api`**：该步骤的 url 替换为后门 API 地址
- **`fixed-value`**：该步骤不发起实际请求，直接在 `extract` 中注入固定值
- **`env-disable`**：该步骤标记为跳过，附带注释说明前提条件
- **`mock-callback`**：在前一步完成后插入一个额外的 mock 回调请求
- **`mock-service`**：该步骤的 url 替换为本地 mock 服务地址

## 实践经验

- **正常编排是骨架**：先完成正常流程编排，确保主路径可以跑通
- **异常编排是保障**：每个外部调用至少 1 个异常编排
- **变量传递**：前一步的响应中提取变量（如 token、user_id），传给后续步骤
- **测试数据**：编排开始前准备测试数据，结束后清理，保证幂等性
- **并发测试**：关键场景需要考虑并发情况（如：两人同时注册同一邮箱）
- **外部依赖先查清单**：开始设计编排前先读 `logos-project.yaml` 的 `external_dependencies`，没有声明的外部调用要主动提醒用户补充
- **mock 策略不要自行决定**：测试策略由 S12 技术架构设计（Phase 3 Step 0, architecture-designer）确定，编排测试阶段只负责消费，不要擅自更改
- **与 `openlogos verify` 的关系**：API 编排测试也可产出与 `spec/test-results.md` 相同格式的 JSONL 结果。编排测试运行后，结果同样写入 `logos/resources/verify/test-results.jsonl`，`openlogos verify` 统一读取并判定验收

## 推荐提示词

以下提示词可以直接复制给 AI 使用：

- `帮我设计编排测试`
- `基于 API 规格帮我生成 S01 的编排测试`
- `帮我把所有场景的正常路径编排出来`
- `帮我给 S02 补充异常路径的编排测试`
