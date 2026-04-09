# AGENTS.md 生成规范

> 版本：0.3.0
>
> 本文档定义 AGENTS.md 的内容结构、生成规则和多平台适配机制。AGENTS.md 是面向 AI 助手的指令文件，让 AI 工具打开项目就知道该遵循什么规范。

## 概述

AGENTS.md 放在项目根目录。当 AI 工具（Cursor、Claude Code、OpenCode 等）打开项目时，自动读取此文件，了解项目遵循的规范和工作方式。

## 内容结构

```markdown
# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`
- Tech Stack: [从 logos-project.yaml 读取]

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see logos/changes/ directory)

## Interaction Guidelines
When the user's request is vague or they ask "what should I do next":
1. Scan `logos/resources/` to determine the current project phase
2. Suggest the specific next step based on what's missing
3. Provide a ready-to-use prompt the user can directly say
4. Never start generating documents without confirming key information

Phase detection logic:
- `logos/resources/prd/1-product-requirements/` is empty → suggest Phase 1 (prd-writer)
- requirements exist but `2-product-design/` is empty → suggest Phase 2 (product-designer)
- design exists but `3-technical-plan/1-architecture/` is empty → suggest Phase 3 Step 0 (architecture-designer)
- architecture exists but `3-technical-plan/2-scenario-implementation/` is empty → suggest Phase 3 Step 1 (scenario-architect)
- scenarios exist but `logos/resources/api/` is empty → suggest Phase 3 Step 2 (api-designer + db-designer)
- API exists but `logos/resources/test/` is empty → suggest Phase 3 Step 3a (test-writer)
- test cases exist but `logos/resources/scenario/` is empty → suggest Phase 3 Step 3b (test-orchestrator, API projects only)
- All above exist → suggest Phase 3 Step 4 (code generation)
- code generated but `logos/resources/verify/` is empty → suggest Phase 3 Step 5 (run tests then `openlogos verify`)

Step 4 execution rules (large tasks):
1. Large implementation can be split by scenario/module, but each batch must be closed-loop
2. Each batch must include business code + UT/ST test code + OpenLogos reporter
3. Before generating code, list the UT/ST case IDs covered in this batch and keep IDs aligned with `logos/resources/test/*.md`
4. Do not postpone all tests to the final batch

Ready-to-use prompt for Step 4 batch execution:
`Please execute Phase 3 Step 4 for this scope. If the task is large, split into batches, but each batch must deliver: (1) business code, (2) matching UT/ST test code, (3) OpenLogos reporter writing to logos/resources/verify/test-results.jsonl. Before outputting code, list the UT/ST IDs covered in this batch.`

## Active Skills
[根据 `logos.config.json` 的 `aiTool` 字段动态生成]

当 aiTool = "cursor" 时，列出 `.cursor/rules/` 下部署的 `.mdc` 文件：
- `skills/prd-writer` — `.cursor/rules/prd-writer.mdc`
- `skills/product-designer` — `.cursor/rules/product-designer.mdc`
- ...（共 12 项）

当 aiTool = "claude-code" 或 "other" 时，列出 `logos/skills/` 下部署的 `SKILL.md` 文件：
- `skills/prd-writer` — `logos/skills/prd-writer/SKILL.md`
- `skills/product-designer` — `logos/skills/product-designer/SKILL.md`
- ...（共 12 项）

当 aiTool = "opencode" 时：
- **兼容模式**：继续使用 `AGENTS.md` + `logos/skills/*/SKILL.md`
- **原生插件模式（推荐）**：通过 `opencode.json` 的 `plugin` 字段或 `.opencode/plugins/` 加载 OpenLogos 插件；`AGENTS.md` 作为兜底指令保留

## Conventions
- [从 logos-project.yaml 的 conventions 段读取]
- When writing Markdown files that contain triple-backtick code blocks inside other code blocks, use 4-backtick fences (````) for the outer block
```

## 生成规则

### 数据来源

AGENTS.md 的内容从以下文件中自动提取：

| 字段 | 来源 |
|------|------|
| Tech Stack | `logos-project.yaml` → `tech_stack` |
| Active Skills | `logos.config.json` → `aiTool` 字段决定路径前缀 + 扫描项目中已部署的 Skills |
| Conventions | `logos-project.yaml` → `conventions` |
| Methodology Rules | 固定内容（OpenLogos 核心规则） |

### 核心规则（固定内容）

以下规则在所有 OpenLogos 项目中一致，不可自定义：

1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations
6. All generated test code must include an OpenLogos reporter (see spec/test-results.md)

### 生成时机

- `openlogos init`：初始化项目时首次生成（含 Active Skills 段，Skills 同步部署）
- `openlogos sync`：手动触发重新生成（当项目配置变化时，同时重新部署 Skills 并刷新 Active Skills 段）
- `project-init` Skill：AI 初始化项目时生成

## 多平台适配

不同 AI 工具使用不同的指令文件名，但内容一致：

| 工具 | 指令文件 | Skills 部署位置 | 处理方式 |
|------|---------|---------------|---------|
| **Cursor** | `AGENTS.md`（原生支持） | `.cursor/rules/*.mdc` | `init` / `sync` 自动部署 |
| **Claude Code** | `CLAUDE.md` | `logos/skills/*/SKILL.md` | `init` / `sync` 自动部署 |
| **OpenCode（兼容模式）** | `AGENTS.md` | `logos/skills/*/SKILL.md` | `init` / `sync` 自动部署 |
| **OpenCode（原生插件模式）** | `opencode.json` + `.opencode/plugins/` | 插件内置/按需加载 | 由插件负责命令桥接与会话注入，`AGENTS.md` 作为兜底 |
| **GitHub Copilot** | `.github/copilot-instructions.md` | 规划中 | Phase 1.5 |

`openlogos sync` 命令会同时生成所有需要的指令文件，确保不同 AI 工具看到的指令一致。对于 OpenCode 原生插件模式，`sync` 仍保留 `AGENTS.md` 作为降级路径，避免插件不可用时流程中断。

## 与 logos-project.yaml 的关系

| 文件 | 格式 | 受众 | 内容 |
|------|------|------|------|
| `logos-project.yaml` | 结构化 YAML | AI + 工具 | 资源索引、技术栈、约定 |
| `AGENTS.md` | 自然语言 Markdown | AI 助手 | 行为指令、规则、Skill 列表 |

两者互补：AGENTS.md 引导 AI 去读 logos-project.yaml，logos-project.yaml 提供结构化数据。
