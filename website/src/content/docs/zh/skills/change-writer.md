---
title: change-writer
description: 遵循 Delta 工作流编写带影响分析的变更提案。
---

协助编写变更提案 —— 分析变更影响范围，生成结构化的 `proposal.md` 与分阶段的 `tasks.md`，确保变更可追溯、影响可控。

## Phase 与触发条件

- **Phase**：跨阶段（Delta 工作流）
- **触发条件**：
  - 用户已运行 `openlogos change <slug>` 并希望协助填写提案
  - 用户描述了修改、新增或移除某个场景/功能的需求
  - 用户提到「变更提案」「迭代」「需求变更」

## 前置条件

1. 项目已初始化（`logos/logos.config.json` 存在）
2. 变更提案目录已存在（`logos/changes/<slug>/`）
3. `logos/resources/` 中的主文档可读

如前置条件未满足，用户须先运行 `openlogos change <slug>`。

## 它做了什么

1. 理解用户意图的变更（改什么、为什么、涉及哪些场景）
2. 扫描 `logos/resources/` 中的现有文档，识别完整的受影响范围
3. 依据传播规则确定变更类型
4. 生成合规的 `proposal.md`
5. 按变更类型自动拆解 `tasks.md`
6. 提供可直接使用的提示词以驱动链式执行

## 变更类型与传播

| 变更类型 | 所需最小更新 |
|-------------|------------------------|
| 需求级 | 全链路：需求 → 设计 → 架构 → API/DB → 测试 → 代码 |
| 设计级 | 原型 + 场景 + API/DB + 测试 + 代码 |
| 接口级 | API/DB + 测试 + 代码 |
| 代码级修复 | 代码 + 重新验证 |

## 影响分析范围

此 Skill 扫描所有文档层以识别受影响的产物：

1. **需求文档**（`prd/1-product-requirements/`）—— 场景定义
2. **产品设计**（`prd/2-product-design/`）—— 功能规格与原型
3. **技术方案**（`prd/3-technical-plan/`）—— 时序图
4. **API 文档**（`api/`）—— 受影响端点
5. **DB 文档**（`database/`）—— 受影响表结构
6. **测试用例**（`test/`）—— 受影响测试用例
7. **编排测试**（`scenario/`）—— 受影响编排文件

## 生成的文件

### proposal.md

```markdown
# Change Proposal: [Change Name]

## Reason for Change
## Change Type
## Change Scope
- Affected requirement documents: [list]
- Affected functional specs: [list]
- Affected business scenarios: [scenario ID list]
- Affected APIs: [endpoint list]
- Affected DB tables: [table list]
- Affected test cases: [list]

## Change Summary
```

### tasks.md

使用区段标签的结构化清单 —— 只包含与本次变更相关的区段：

```markdown
# Implementation Tasks

## [delta] Spec Changes
- [ ] Output delta file to deltas/prd/1-product-requirements/ — Update acceptance criteria for S0x
- [ ] Output delta file to deltas/prd/3-technical-plan/2-scenario-implementation/ — Update sequence diagram for S0x
- [ ] Output delta file to deltas/api/ — Update API YAML
- [ ] Validate API YAML (all special chars double-quoted)
- [ ] Output delta file to deltas/database/ — Update DB DDL

## [code] Code Implementation
- [ ] Implement code changes in src/xxx
- [ ] Write corresponding tests
```

区段标签规则：
- `## [delta]` —— 仅 delta 输出任务。全部勾选 → `ready-to-merge`
- `## [code]` —— 仅代码实现任务。全部勾选 → `ready-to-verify`
- 仅代码修复：只有 `[code]` 区段，无 `[delta]` 区段（直接跳到 `ready-to-merge`）
- 严格区分 delta 任务与代码任务 —— 绝不混用

## 链式驱动执行

生成提案后，此 Skill 提供可直接使用的提示词，让用户启动顺序任务执行：

- **多阶段变更**：「按 tasks.md 帮我逐步更新 S0x 涉及的所有受影响文档」
- **代码级修复**：「帮我修复 S0x 的 [问题] 并重新验证」

AI 读取 `tasks.md`，顺序执行各项，每项完成后报告，并提示「继续下一项？」

## 产出

| 文件 | 位置 |
|------|----------|
| `proposal.md` | `logos/changes/<slug>/proposal.md` |
| `tasks.md` | `logos/changes/<slug>/tasks.md` |

## 最佳实践

- **高估影响范围** —— 漏掉一环比反复核对更危险
- **变更类型决定工作量** —— 开始前帮用户理解清楚
- **即使小变更也走流程** —— 「只是一行 API」也可能影响测试与代码
- **tasks.md 是执行清单** —— 完成时用 `[x]` 勾选各项

## 相关 Skill

- 任务完成后：[`merge-executor`](/zh/skills/merge-executor) —— 将 delta 合并进主文档
- 合并后：运行 `openlogos archive <slug>` 归档提案
