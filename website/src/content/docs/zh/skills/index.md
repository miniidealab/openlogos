---
title: Skills 总览
description: 全部 16 个 OpenLogos 内置 AI Skill 的参考文档。
---

OpenLogos 内置 **16 个 AI Skill** —— 它们是结构化的 Markdown 指令文件（`SKILL.md`），引导 AI 编码工具走完开发生命周期的每个阶段。Skill 在 `openlogos init` 时自动部署，并通过 `openlogos sync` 同步。

## Skill 的工作方式

每个 Skill 都是一份自包含的指令集，存放在 `skills/<skill-name>/SKILL.md` 中。当 AI 编码工具遇到与某个 Skill 触发条件匹配的任务时，它会读取并遵循其中的指令，从而产出一致、高质量的结果。

Skill 的组织遵循 OpenLogos 的**三层推进模型**（WHY → WHAT → HOW）：

## Phase 1 — WHY（需求）

| Skill | 用途 | 触发条件 |
|-------|---------|---------|
| [`project-init`](/zh/skills/project-init) | 初始化项目结构与配置 | 新建项目或 `openlogos init` |
| [`prd-writer`](/zh/skills/prd-writer) | 编写带 GIVEN/WHEN/THEN 验收标准的场景驱动需求 | 需求分析阶段 |

## Phase 2 — WHAT（产品设计）

| Skill | 用途 | 触发条件 |
|-------|---------|---------|
| [`product-designer`](/zh/skills/product-designer) | 根据产品类型创建交互规格与原型 | 需求已存在、需要设计 |

## Phase 3 — HOW（技术实现）

| Skill | 用途 | 触发条件 |
|-------|---------|---------|
| [`architecture-designer`](/zh/skills/architecture-designer) | 设计系统架构并完成技术选型 | 产品设计完成，Step 0 |
| [`scenario-architect`](/zh/skills/scenario-architect) | 将场景展开为技术时序图 | 架构完成，Step 1 |
| [`api-designer`](/zh/skills/api-designer) | 基于时序图设计 OpenAPI 规格 | 时序图完成，Step 2 |
| [`db-designer`](/zh/skills/db-designer) | 从 API 规格推导数据库 DDL | API 规格完成，Step 2 |
| [`test-writer`](/zh/skills/test-writer) | 设计单元测试与场景测试用例 | 规格完成，Step 4a（所有项目） |
| [`test-orchestrator`](/zh/skills/test-orchestrator) | 设计 API 编排测试场景 | 测试用例完成，Step 4b（仅 API 项目） |
| [`code-implementor`](/zh/skills/code-implementor) | 生成忠于规格的业务代码与测试代码 | 测试设计完成，Step 5 |
| [`code-reviewer`](/zh/skills/code-reviewer) | 对照完整规格链审查代码 | 代码生成后，Step 5+ |

## 部署与验证

| Skill | 用途 | 触发条件 |
|-------|---------|---------|
| [`deployment-designer`](/zh/skills/deployment-designer) | 设计部署拓扑、发布命令、回滚策略与 smoke 范围 | API/DB 完成，Step 3 |
| [`deployment-executor`](/zh/skills/deployment-executor) | verify 通过后经人工授权执行部署 | Gate 3.6 PASS 之后，Step 7 |

## 跨阶段（Delta 变更工作流）

| Skill | 用途 | 触发条件 |
|-------|---------|---------|
| [`change-writer`](/zh/skills/change-writer) | 编写带影响分析的变更提案 | launched 生命周期中的任何迭代 |
| [`merge-executor`](/zh/skills/merge-executor) | 将 delta 文件合并进主文档 | `openlogos merge <slug>` 之后 |

## 设计智能

| Skill | 用途 | 触发条件 |
|-------|---------|---------|
| [`ui-ux-pro-max`](/zh/skills/ui-ux-pro-max) | 全面的 UI/UX 设计指南（67 种风格、96 套调色板、57 组字体配对、25 种图表类型） | Phase 2 的 GUI 产品设计，由 product-designer 调用 |

## Skill 文件位置

执行 `openlogos init` 后，Skill 会部署到各平台特定的位置：

| AI 工具 | Skill 位置 |
|---------|---------------|
| Claude Code | `logos/skills/`（原生插件） |
| OpenCode | `logos/skills/`（hooks 集成） |
| Codex | `.agents/skills/`（原生 Codex Skills） |
| Cursor | `.cursor/rules/`（规则文件） |

更新后运行 `openlogos sync` 可重新部署 Skill。
