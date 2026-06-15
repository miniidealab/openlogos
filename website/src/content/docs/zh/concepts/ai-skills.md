---
title: AI Skills
description: "与平台无关的 Markdown 文件，把 AI 编码工具从猜测机器变成精密仪器。"
---

AI Skills 是让 OpenLogos **可执行**的机制 —— 它不只是一套需要你记住的原则，而是 AI 智能体能够自动读取并遵循的操作指令。

## 什么是 Skill？

Skill 是一个存放在项目 `skills/` 目录下的 Markdown 文件（`SKILL.md`）。每个 Skill 对应 OpenLogos 工作流中某个特定的阶段或任务。当开发者要求 AI 工具执行某项任务时，工具会读取相关的 Skill 并遵循其结构化指令。

关键特性：

- **与平台无关**：适用于 Claude Code、OpenCode、Codex、Cursor 或任何能读取项目文件的工具
- **阶段感知**：每个 Skill 都知道自己属于哪个阶段、期望什么输入
- **带护栏**：Skill 会强制执行方法论规则（例如「没有测试用例就不要生成代码」）
- **自包含**：每个 Skill 都包含自己的指令、输出模板和质量检查

## 内置 Skills

OpenLogos 包含 13 个 Skill，覆盖整个生命周期：

### Phase 1 —— WHY

| Skill | 用途 |
|-------|---------|
| [`project-init`](/zh/skills/project-init) | 初始化项目结构与配置 |
| [`prd-writer`](/zh/skills/prd-writer) | 编写带场景驱动验收标准的产品需求 |

### Phase 2 —— WHAT

| Skill | 用途 |
|-------|---------|
| [`product-designer`](/zh/skills/product-designer) | 创建功能规格、交互流程与 HTML 原型 |

### Phase 3 —— HOW

| Skill | 用途 |
|-------|---------|
| [`architecture-designer`](/zh/skills/architecture-designer) | 设计技术架构并选择技术栈 |
| [`scenario-architect`](/zh/skills/scenario-architect) | 将场景建模为带 API 调用的时序图 |
| [`api-designer`](/zh/skills/api-designer) | 设计从时序图推导出的 OpenAPI 规格 |
| [`db-designer`](/zh/skills/db-designer) | 根据 API 与场景需求设计数据库 schema |
| [`test-writer`](/zh/skills/test-writer) | 编写单元 + 场景测试用例文档（先于代码） |
| [`test-orchestrator`](/zh/skills/test-orchestrator) | 设计 API 编排测试（仅 API 项目） |
| [`code-implementor`](/zh/skills/code-implementor) | 忠实于规格地生成业务代码与测试代码 |
| [`code-reviewer`](/zh/skills/code-reviewer) | 对照完整规格链审查代码 |

### 跨阶段

| Skill | 用途 |
|-------|---------|
| [`change-writer`](/zh/skills/change-writer) | 编写带影响分析的变更提案 |
| [`merge-executor`](/zh/skills/merge-executor) | 将 delta 文件合并进主文档 |

## Skill 如何被加载

1. 开发者要求 AI 执行某项任务（例如「写需求」）
2. AI 读取 `AGENTS.md` → 检测当前阶段 → 识别相关 Skill
3. AI 读取 `SKILL.md` 文件以获取操作指令
4. AI 遵循该 Skill 的分步流程，使用 Skill 的输出模板和质量检查

加载机制因平台而异：

| 平台 | 机制 |
|----------|-----------|
| Claude Code | 原生 `.claude/` 插件系统 |
| OpenCode | `hooks/` 与命令集成 |
| Codex | `.agents/skills/` 加上 `.codex-plugin/` 钩子集成 |
| Cursor | `.cursor/rules/` 自动附加的、引用 Skill 的规则 |
| 其他工具 | 以 `AGENTS.md` 作为通用入口 |

## Skill 剖析

一个典型的 `SKILL.md` 包含：

```markdown
# Skill Name

## Trigger
When to activate this Skill.

## Inputs
What documents/artifacts this Skill reads.

## Process
Step-by-step instructions the AI follows.

## Output Template
The expected format of the output document.

## Quality Checks
Self-verification before marking the task complete.
```

## 自定义 Skill

你可以通过在 `skills/` 目录下添加 `SKILL.md` 文件、并在 `logos-project.yaml` 中引用它们，来创建项目专属的 Skill。自定义 Skill 遵循与内置 Skill 相同的格式。

---

*另见：[完整 Skills 参考](/zh/skills)，查看每个 Skill 的详细文档 →*
