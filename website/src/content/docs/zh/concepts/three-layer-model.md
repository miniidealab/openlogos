---
title: 三层推进模型
description: "WHY → WHAT → HOW：消除 AI 辅助开发中模糊性的结构化推进路径。"
---

三层模型是 OpenLogos 的骨架。每个项目都会经历三个阶段 —— **WHY → WHAT → HOW** —— 其中每个阶段的产出都成为下一阶段的输入。跳过某一层，模糊性就会指数级增长；完成每一层，AI 就能获得它所需的精确上下文。

## Phase 1 —— WHY（需求）

在解决问题之前先理解问题。谁需要它？它解决了什么痛点？「完成」是什么样子？

**关键产出：**

- 用户画像与痛点分析（因果链）
- 带优先级的场景识别（`S01`、`S02` …）
- 每个场景的 GIVEN/WHEN/THEN 验收标准
- 用于界定范围的「不做」清单

**质量关卡：** 每个 P0 场景都有验收标准。

**Skill：** [`prd-writer`](/zh/skills/prd-writer)

## Phase 2 —— WHAT（产品设计）

设计解决方案。针对每个场景，定义用户看到什么、如何交互、状态如何变化。

**关键产出：**

- 信息架构与导航
- 每个场景的功能规格
- HTML 原型（AI 生成）
- 界面级 GIVEN/WHEN/THEN（按钮、表单、状态）

**质量关卡：** 每个 P0 场景都有交互规格 + 原型。

**Skill：** [`product-designer`](/zh/skills/product-designer)

## Phase 3 —— HOW（实现）

用 6 个精确步骤构建解决方案。场景驱动、测试先行。AI 在完整上下文下生成代码。

| Step | 活动 | Skill |
|------|----------|-------|
| 0 | 架构总览与技术选型 | [`architecture-designer`](/zh/skills/architecture-designer) |
| 1 | 场景 → 时序图 → API 浮现 | [`scenario-architect`](/zh/skills/scenario-architect) |
| 2 | API 规格（OpenAPI YAML）+ DB schema | [`api-designer`](/zh/skills/api-designer)、[`db-designer`](/zh/skills/db-designer) |
| 3 | 测试用例设计（先于代码！） | [`test-writer`](/zh/skills/test-writer)、[`test-orchestrator`](/zh/skills/test-orchestrator) |
| 4 | 业务代码 + 测试代码生成 | [`code-implementor`](/zh/skills/code-implementor)、[`code-reviewer`](/zh/skills/code-reviewer)（事后审查） |
| 5 | `openlogos verify` → 自动化验收 | — |

**质量关卡（Gate 3.5）：** 全部测试通过、设计时覆盖率 100%、验收标准可追溯。

## 阶段检测

OpenLogos CLI 和 `AGENTS.md` 通过扫描 `logos/resources/` 目录自动检测当前阶段：

```
logos/resources/prd/1-product-requirements/  → empty? → Phase 1
logos/resources/prd/2-product-design/        → empty? → Phase 2
logos/resources/prd/3-technical-plan/        → empty? → Phase 3 Step 0
logos/resources/api/                         → empty? → Phase 3 Step 2
logos/resources/test/                        → empty? → Phase 3 Step 3
```

当开发者问 AI「我接下来该做什么？」时，AI 会读取 `AGENTS.md`，检测当前阶段，并给出具体的下一步建议。

## 不是瀑布模型

瀑布模型要求在**任何设计**之前完成**全部需求**，在**任何代码**之前完成全部设计。而 OpenLogos 是按**场景**逐个推进的 —— S01 可以处于 Phase 3，而 S04 还停留在 Phase 1。这些阶段是一个推进模型，而非时间表。

## 它对 AI 为何重要

当 AI 在缺乏上下文的情况下工作时，每个决策都是一次猜测。每个功能 10 个决策，就是 2^10 = 1024 条可能的路径 —— 其中大多数是错的。三层模型通过在每个阶段提供显式、结构化的上下文，把这个指数级空间坍缩成一条经过深思熟虑的路径。

---

*另见：[交互式深入解读 —— WHY → WHAT → HOW](/zh/deep-dive/three-layer-model) →*
