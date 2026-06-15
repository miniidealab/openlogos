---
title: AGENTS.md 规格
description: AI 指令文件的内容结构、生成规则与多平台适配。
---

`AGENTS.md` 是放置在项目根目录的 AI 指令文件。当 AI 编码工具（Cursor、Claude Code、OpenCode、Codex 等）打开项目时，会读取此文件来理解项目的方法论、规则和工作流。

## 内容结构

生成的 `AGENTS.md` 遵循以下标准模板：

```markdown
# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`
- Tech Stack: [read from logos-project.yaml]

## Methodology Rules
[6 fixed rules — see below]

## Interaction Guidelines
[Phase detection logic + Step 4 batch execution rules]

## Document Edit Verification
[Fixed locale-specific paragraph: after each Markdown/text spec write, re-read from disk and show actual excerpts; no prose-only delivery; typo exception]

## Active Skills
[Dynamically generated based on aiTool setting]

## Change Management
[Varies by lifecycle: initial vs launched]

## Conventions
[Read from logos-project.yaml conventions field]
```

## 固定方法论规则

这些规则在所有 OpenLogos 项目中保持一致，不可自定义：

1. 在完成设计文档之前绝不写代码
2. 遵循 Why → What → How 推进
3. 所有 API 设计必须源自场景时序图
4. 所有代码变更必须有对应的 API 编排测试
5. 迭代使用 Delta 变更工作流
6. 所有生成的测试代码必须包含 OpenLogos reporter（见[测试结果格式](/zh/specs/test-results)）
7. 修改 Markdown 或文本规格后，从磁盘重新读取并向用户展示可验证的原文片段（生成的 **Document Edit Verification** 章节）

## 阶段检测逻辑

Interaction Guidelines 章节包含阶段检测逻辑，帮助 AI 判断当前项目阶段并建议下一步：

| 条件 | 建议阶段 | Skill |
|-----------|----------------|-------|
| `prd/1-product-requirements/` 为空 | Phase 1 | prd-writer |
| 需求存在，`2-product-design/` 为空 | Phase 2 | product-designer |
| 设计存在，`3-technical-plan/1-architecture/` 为空 | Phase 3 Step 0 | architecture-designer |
| 架构存在，`2-scenario-implementation/` 为空 | Phase 3 Step 1 | scenario-architect |
| 场景存在，`api/` 为空 | Phase 3 Step 2 | api-designer + db-designer |
| API 存在，`test/` 为空 | Phase 3 Step 3a | test-writer |
| 测试用例存在，`scenario/` 为空 | Phase 3 Step 3b | test-orchestrator |
| 以上全部完成 | Phase 3 Step 4 | code-implementor |
| 代码存在，`verify/` 为空 | Phase 3 Step 5 | 运行测试 → `openlogos verify` |

## Active Skills 章节

Active Skills 章节根据 `logos.config.json` 中的 `aiTool` 字段动态生成：

| aiTool 取值 | Skill 列表来源 | 路径格式 |
|-------------|-------------------|-------------|
| `cursor` | `.cursor/rules/*.mdc` | `skills/{name}/` → `.cursor/rules/{name}.mdc` |
| `claude-code` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |
| `opencode` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |
| `codex` | `.agents/skills/*/SKILL.md` | `.agents/skills/{name}/SKILL.md` |
| `other` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |
| `all` 或数组 | 所有已配置的工具目标 | 多工具 Skill 路径 |

全部 16 个内置 Skill 均带描述列出。

对于支持 Skill 绑定的工具（Claude Code、Cursor），阶段检测章节会包含直接文件路径，使 AI 能立即读取并执行 Skill 文件。

## 数据来源

| 章节 | 来源 |
|---------|--------|
| Tech Stack | `logos-project.yaml` → `tech_stack` |
| Active Skills | `logos.config.json` → `aiTool` + 已部署 Skill 扫描 |
| Conventions | `logos-project.yaml` → `conventions` |
| Methodology Rules | 固定内容（不可自定义） |

## 生成时机

| 事件 | 触发条件 |
|-------|---------|
| `openlogos init` | 项目初始化时首次生成 |
| `openlogos sync` | 项目配置变更时手动重新生成 |
| `project-init` Skill | AI 发起的项目初始化 |

## 多平台适配

不同 AI 工具使用不同的指令文件名，但内容一致：

| 工具 | 指令文件 | Skill 位置 | 部署 |
|------|-----------------|----------------|------------|
| **Cursor** | `AGENTS.md`（原生支持） | `.cursor/rules/*.mdc` | 由 `init` / `sync` 自动部署 |
| **Claude Code** | `CLAUDE.md` | `logos/skills/*/SKILL.md` | 由 `init` / `sync` 自动部署 |
| **OpenCode（兼容）** | `AGENTS.md` | `logos/skills/*/SKILL.md` | 由 `init` / `sync` 自动部署 |
| **OpenCode（插件）** | `opencode.json` + `.opencode/plugins/` | 插件加载 | 插件处理命令桥接，`AGENTS.md` 作为回退 |
| **Codex** | `AGENTS.md` + `.codex/config.toml` | `.agents/skills/*/SKILL.md` | 由 `init` / `sync` 自动部署 |
| **GitHub Copilot** | `.github/copilot-instructions.md` | 计划中 | 未来版本 |

`openlogos sync` 会同时生成所有需要的指令文件，确保各 AI 工具间指令一致。

## 与 logos-project.yaml 的关系

| 文件 | 格式 | 受众 | 内容 |
|------|--------|----------|---------|
| `logos-project.yaml` | 结构化 YAML | AI + 工具 | 资源索引、技术栈、约定 |
| `AGENTS.md` | 自然语言 Markdown | AI 助手 | 行为指令、规则、Skill 列表 |

二者互补：`AGENTS.md` 指引 AI 去读 `logos-project.yaml`；`logos-project.yaml` 为 AI 提供可消费的结构化数据。
