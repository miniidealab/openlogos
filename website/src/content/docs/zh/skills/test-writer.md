---
title: test-writer
description: 在代码生成前设计单元测试与场景测试用例。
---

基于时序图、API 规格与 DB 约束，为每个业务场景设计单元测试用例与场景测试用例。适用于所有项目类型（API 服务、CLI 工具、前端应用、库），这是代码生成前的**强制前置步骤**。

## Phase 与触发条件

- **Phase**：Phase 3 — HOW（实现），Step 3a
- **触发条件**：
  - 用户请求测试用例或测试计划设计
  - 用户提到「Phase 3 Step 3」「Step 3a」「测试先行」
  - 时序图已存在且需要在编写代码前先有测试

## 前置条件

- 时序图位于 `logos/resources/prd/3-technical-plan/2-scenario-implementation/`（必需）
- API 规格位于 `logos/resources/api/`（如有）
- DB DDL 位于 `logos/resources/database/`（如有）
- 需求文档位于 `logos/resources/prd/1-product-requirements/`（用于 AC 溯源）

无论项目类型如何，**都不可跳过**。

## 它做了什么

1. 从 API 字段约束（类型、格式、长度、枚举）提取单元测试用例
2. 从 DB 约束（UNIQUE、CHECK、NOT NULL、FK）提取单元测试用例
3. 从业务规则与 EX 异常情况提取单元测试用例
4. 从时序图 Step 序列提取场景测试用例（正常路径）
5. 从 EX 异常情况提取场景测试用例（异常路径）
6. 对照 Phase 1/2 验收标准反向验证覆盖度
7. 构建验收标准可追溯性表格

## 测试用例 ID 约定

| 类型 | 格式 | 示例 |
|------|--------|---------|
| 单元测试 | `UT-{scenario}-{seq}` | `UT-S01-01` |
| 场景测试 | `ST-{scenario}-{seq}` | `ST-S01-01` |
| 验收标准 | `{scenario}-AC-{seq}` | `S01-AC-01` |

这些 ID 是设计文档与运行时之间的**绑定契约** —— 它们从 test-cases.md → 测试代码 → test-results.jsonl → acceptance-report.md 一路贯穿。

## 单元测试来源

### API 字段约束
- `type` → 类型错误用例
- `format`（email、uuid） → 格式校验用例
- `minLength` / `maxLength` → 边界值用例
- `required` → 必填字段缺失用例
- `enum` → 有效值 + 无效值用例

### DB 约束
- `UNIQUE` → 重复插入用例
- `NOT NULL` → 空值用例
- `CHECK` → 约束违反用例
- `FOREIGN KEY` → 不存在引用用例

### 业务规则
- 权限检查、状态机转换、限流、计算逻辑

## 场景测试来源

### 正常路径
将时序图中完整的 Step 1 → Step N 序列作为端到端调用链，验证最终状态（DB 记录、返回值）。

### 异常路径
将每个 EX 异常情况展开为一个场景测试：哪一步触发异常、之后发生什么、其他数据完整性是否得到保持。

## 覆盖验证清单

- [ ] Phase 1 的每个正常 AC → 至少 1 个 ST 用例
- [ ] Phase 1 的每个异常 AC → 至少 1 个 ST 或 UT 用例
- [ ] 每个 EX 情况 → 至少 1 个 ST 用例
- [ ] 每个 `required` API 字段 → 至少 1 个 UT 用例
- [ ] 每个 `UNIQUE`/`CHECK` DB 约束 → 至少 1 个 UT 用例

## 验收标准可追溯性

```markdown
| AC ID | Acceptance Criterion | Covered By |
|-------|----------------------|------------|
| S01-AC-01 | Normal: Fresh project init — create directory structure | ST-S01-01 |
| S01-AC-02 | Exception: Already initialized — display error | ST-S01-03, UT-S01-05 |
```

`openlogos verify` 会解析此表，并将 AC → 测试用例 ID → 执行结果关联起来，生成验收报告。

## 产出

| 文件 | 位置 |
|------|----------|
| 测试用例文档 | `logos/resources/test/` |
| 命名规范 | `{scenario-number}-test-cases.md` |

## 最佳实践

- **测试用例是设计文档，不是代码** —— 实际测试代码在 Step 4 编写
- **先单元，后场景** —— 先确保积木正确，再验证它们能拼合
- **不要忽视 DB 约束** —— 许多 bug 源于数据库层面的违反
- **场景测试关注 Step 之间的数据传递** —— 这是最常出错的地方
- **边界值优先** —— 优先选边界值而非随机值
- **用例 ID 是跨阶段契约** —— 任何不一致都会导致 `openlogos verify` 报告结果不完整

## 相关 Skill

- 上一步：[`api-designer`](/zh/skills/api-designer) / [`db-designer`](/zh/skills/db-designer) —— 设计规格
- 下一步（API 项目）：[`test-orchestrator`](/zh/skills/test-orchestrator) —— 设计 API 编排测试
- 下一步（所有项目）：[`code-implementor`](/zh/skills/code-implementor) —— 忠于规格生成代码（Phase 3 Step 4）
