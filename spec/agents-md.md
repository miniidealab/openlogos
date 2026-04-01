# AGENTS.md 生成规范

> 版本：0.1.0
>
> 本文档定义 AGENTS.md 的内容结构、生成规则和多平台适配机制。AGENTS.md 是面向 AI 助手的指令文件，让 AI 工具打开项目就知道该遵循什么规范。

## 概述

AGENTS.md 放在项目根目录。当 AI 工具（Cursor、Claude Code、OpenCode 等）打开项目时，自动读取此文件，了解项目遵循的规范和工作方式。

## 内容结构

```markdown
# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos.config.json`
- Resource Index: `logos-project.yaml`
- Tech Stack: [从 logos-project.yaml 读取]

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see changes/ directory)

## Active Skills
- [列出项目中启用的 Skills 及其路径]

## Conventions
- [从 logos-project.yaml 的 conventions 段读取]
```

## 生成规则

### 数据来源

AGENTS.md 的内容从以下文件中自动提取：

| 字段 | 来源 |
|------|------|
| Tech Stack | `logos-project.yaml` → `tech_stack` |
| Active Skills | 扫描项目中的 `SKILL.md` 文件 |
| Conventions | `logos-project.yaml` → `conventions` |
| Methodology Rules | 固定内容（OpenLogos 核心规则） |

### 核心规则（固定内容）

以下规则在所有 OpenLogos 项目中一致，不可自定义：

1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations

### 生成时机

- `openlogos init`：初始化项目时首次生成
- `openlogos sync`：手动触发重新生成（当项目配置变化时）
- `project-init` Skill：AI 初始化项目时生成

## 多平台适配

不同 AI 工具使用不同的指令文件名，但内容一致：

| 工具 | 指令文件 | 处理方式 |
|------|---------|---------|
| **Cursor** | `AGENTS.md`（原生支持） | 直接读取 |
| **Claude Code** | `CLAUDE.md` | CLI 同步生成 |
| **OpenCode** | `AGENTS.md` | 直接读取 |
| **GitHub Copilot** | `.github/copilot-instructions.md` | CLI 同步生成（规划中） |

`openlogos sync` 命令会同时生成所有需要的指令文件，确保不同 AI 工具看到的指令一致。

## 与 logos-project.yaml 的关系

| 文件 | 格式 | 受众 | 内容 |
|------|------|------|------|
| `logos-project.yaml` | 结构化 YAML | AI + 工具 | 资源索引、技术栈、约定 |
| `AGENTS.md` | 自然语言 Markdown | AI 助手 | 行为指令、规则、Skill 列表 |

两者互补：AGENTS.md 引导 AI 去读 logos-project.yaml，logos-project.yaml 提供结构化数据。
