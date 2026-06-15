---
title: product-designer
description: 根据产品类型创建交互规格与原型。
---

基于 Phase 1 需求文档中的场景，细化交互流程与功能规格，并生成原型。原型格式会根据产品类型（Web/CLI/Library/AI Skills 等）自动适配。

## Phase 与触发条件

- **Phase**：Phase 2 — WHAT（产品设计）
- **触发条件**：
  - 用户请求产品设计、功能规格或原型
  - 用户提到「Phase 2」「产品设计层」或「WHAT」
  - 需求文档已存在且包含场景定义

## 它做了什么

1. 识别产品类型并确定对应的原型格式
2. 设计信息架构（页面结构 / 命令树 / API 分组）
3. 基于 Phase 1 逐场景细化交互流程
4. 补充交互层级的 GIVEN/WHEN/THEN 验收标准
5. 生成适配产品类型的原型
6. 必要时将粗粒度场景拆分为子场景（`S01.1`、`S01.2`）

## 产品类型适配

| 产品类型 | 原型格式 | 交互重点 |
|-------------|-----------------|-------------------|
| Web 应用 | 交互式 HTML 页面 | 页面导航、表单校验、状态变化 |
| CLI 工具 | 终端交互示例 | 命令格式、参数设计、输出格式 |
| AI Skills / 对话式 | 对话流程图 + 示例脚本 | 对话步骤、AI 提问策略 |
| Library / SDK | API 用法示例（代码片段） | 公共接口、参数设计、返回值 |
| 移动应用 | HTML 页面（移动视口） | 手势交互、导航模式 |
| 混合型 | 按交付物混用格式 | 交付物之间的交互衔接 |

## 执行步骤

### Step 1：阅读需求并识别产品类型

从 `logos-project.yaml` 中提取场景列表、约束与 `tech_stack`。运行场景粒度检查 —— 如果场景实际上是单个 CRUD 操作，建议回到 Phase 1 重新组织。

### Step 2：设计信息架构

按产品类型设计架构：页面结构（Web）、命令树（CLI）、技能触发关系（AI Skills）或模块结构（Library）。

### Step 3：逐场景细化交互规格

为每个场景定义完整的交互细节。Web 场景指定页面、表单字段与导航。CLI 场景指定命令、参数与终端输出模拟。AI 场景指定对话流程与 AI 行为准则。

### Step 4：补充交互层级验收标准

将 Phase 1 的 GIVEN/WHEN/THEN 细化到交互元素层级（具体按钮、字段、加载状态）。

### Step 5：生成原型

以匹配产品类型的格式产出原型。

### Step 6：输出设计文档

按场景组织，每个场景包含其交互规格 + 对应原型。

## 产出

| 文件 | 位置 |
|------|----------|
| 功能规格 | `logos/resources/prd/2-product-design/1-feature-specs/` |
| 原型 | `logos/resources/prd/2-product-design/2-page-design/` |
| 命名 | `{number}-{name}-design.md` + `{number}-{name}-prototype.{ext}` |

原型文件扩展名因类型而异：`.html`（Web）、`-terminal.md`（CLI）、`-dialogue.md`（AI Skills）、`-api-examples.md`（Library）。

## 最佳实践

- **按场景组织，而非按页面** —— 场景是主干
- **Phase 1 验收标准是输入** —— Phase 2 是细化它们，而非重写
- **CLI 的「原型」是终端输出模拟** —— 用代码块即可，无需 HTML
- **AI Skills 的「原型」是对话脚本** —— 模拟多轮对话
- **嵌套 Markdown 代码块** —— 当内容包含 ` ``` ` 时，外层围栏使用 4 个反引号

## 相关 Skill

- 上一步：[`prd-writer`](/zh/skills/prd-writer) —— 编写需求
- 下一步：[`architecture-designer`](/zh/skills/architecture-designer) —— 设计技术架构
