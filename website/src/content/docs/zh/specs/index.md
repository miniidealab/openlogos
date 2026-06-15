---
title: 规格总览
description: OpenLogos 规格文档参考，定义方法论的核心规则、文件格式与项目结构。
---

OpenLogos 规格是所有 Skill、CLI 命令和 AI 指令文件都必须遵循的权威规则。它们定义了开发工作流、项目结构、文件格式以及平台集成机制。

规格分为三类：

## 方法论

约束 OpenLogos 项目推进方式的核心规则：

| 规格 | 描述 |
|---------------|-------------|
| [工作流](/zh/specs/workflow) | 三层推进模型（WHY → WHAT → HOW）、场景串联、阶段检测、质量关卡 |
| [变更管理](/zh/specs/change-management) | Delta 变更提案、影响分析、合并工作流与归档 |

## 文件格式与结构

项目布局、配置文件和数据格式的约定：

| 规格 | 描述 |
|---------------|-------------|
| [项目结构](/zh/specs/project-structure) | 标准目录布局、文件命名约定、`logos.config.json` schema |
| [目录约定](/zh/specs/directory-convention) | 详细的目录结构与文件组织规则 |
| [模块命名约定](/zh/specs/module-naming-convention) | 多模块项目的模块前缀命名规则 |
| [logos-project.yaml](/zh/specs/logos-project) | AI 协作索引文件——schema、字段定义与示例 |
| [AGENTS.md](/zh/specs/agents-md) | AI 指令文件——内容结构、生成规则、多平台适配 |
| [测试结果格式](/zh/specs/test-results) | 跨框架测试结果上报的 JSONL 格式、reporter 代码模板 |
| [tasks.md 格式](/zh/specs/tasks-spec) | 变更提案任务文件的结构化格式——章节标记与状态检测 |
| [SQL 注释约定](/zh/specs/sql-comment-convention) | SQLite DDL 元数据注解的结构化注释格式 |
| [CLI JSON 输出](/zh/specs/cli-json-output) | CLI 命令的结构化 JSON 输出规格（status、verify、smoke、detect） |

## 平台集成

针对特定 AI 编码工具的集成规格：

| 规格 | 描述 |
|---------------|-------------|
| [OpenCode 插件](/zh/specs/opencode-plugin) | OpenCode 原生插件——命令桥接、hook 注入、双模式架构 |
| [Codex 插件](/zh/specs/codex-plugin) | Codex CLI 原生插件——SessionStart hook、阶段上下文注入、双模式架构 |
