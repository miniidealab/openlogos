---
title: 简介
description: OpenLogos 是什么、它解决什么问题、如何运作，以及包含哪些内容。
---

**OpenLogos** 是一套面向 AI 时代的开源软件工程方法论。它通过在开发的每个阶段提供结构化、明确的上下文，把 AI 编码工具——Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy 等——从"猜测机器"转变为精密工具。

## 问题所在：凭感觉编码（Vibe Coding）

当你不给上下文就让 AI"做一个登录功能"时，每个决策都是一次猜测：需求、UI 设计、API 结构、边界情况、错误处理。一个功能涉及 10 个决策，就有 2^10 = 1,024 条可能的路径——其中大多数都是错的。

这就是**凭感觉编码（Vibe Coding）**：开头很快，收尾很痛。代码生成得很快，却充满了各种假设、遗漏的边界情况和未记录的决策。文档与现实渐行渐远。测试沦为事后补救。每次改动都会破坏没人记得的东西。

## 解决之道：结构化上下文

OpenLogos 为 AI 提供完整的全貌——需求、设计、API 规格、测试用例——使其生成的代码正确、经过测试且可追溯。相同的文档、相同的上下文，带来一致的结果。

该方法论建立在**四大核心原则**之上：

### 1. WHY → WHAT → HOW（三层推进模型）

每个项目都经历三个阶段，每个阶段的产出都成为下一阶段的输入：

- **Phase 1 · WHY** —— 需求：用户画像、痛点、场景（`S01`、`S02` …）、验收标准
- **Phase 2 · WHAT** —— 产品设计：功能规格、交互流程、HTML 原型
- **Phase 3 · HOW** —— 实现：架构 → 时序图 → API/DB → 测试用例 → 代码 → 验证

阶段之间的质量门禁防止模糊性不断累积。[了解更多 →](/zh/concepts/three-layer-model)

### 2. 场景驱动 + 测试先行

每个功能都被拆解为场景。一个场景 ID（`S01`）可以从第一条需求一路追溯到最后一行经过验证的代码——无需额外的追溯矩阵。

测试在代码*之前*设计：单元测试、场景测试和编排测试。AI 针对一个精确、可验证的目标生成代码——是"通过这 12 个测试用例"，而不是"做一个登录功能"。[了解更多 →](/zh/concepts/scenario-driven)

### 3. 文档即上下文

每个决策都存放在 `logos/` 目录下的文档中——Markdown、YAML、JSON。可审阅、可复现、可累积。AI 读的是文档，而不是你的心思。

`AGENTS.md` 充当 AI 导航器：它检测当前阶段、建议下一步，并自动加载合适的 Skill。[了解更多 →](/zh/concepts/documents-as-context)

### 4. 工程根基

并非凭空发明。它建立在 40 多年经过验证的理论之上——BDD、TDD、DDD、Stage-Gate、Docs-as-Code——为 AI 执行重新编译。[了解更多 →](/zh/concepts/engineering-foundation)

## 如何运作

```
你 + AI 编码工具
        │
        ▼
   AGENTS.md        ← AI 首先读取这个文件
        │
        ▼
   检测阶段          ← 扫描 logos/resources/
        │
        ▼
   加载 Skill        ← 例如 prd-writer、api-designer
        │
        ▼
   遵循流程          ← Skill 提供分步指引
        │
        ▼
   产出制品          ← requirements.md、api.yaml、测试、代码
```

1. 你运行 `openlogos init` 创建项目结构
2. 在你的 AI 编码工具中打开项目（Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy 等）
3. AI 读取 `AGENTS.md`，检测当前阶段，并加载合适的 Skill
4. 你与 AI 一起逐阶段协作——它会遵循 Skill 定义的结构化流程
5. 每个阶段产出的制品成为下一阶段的上下文
6. `openlogos verify` 依据你设计的测试用例核对测试结果（Gate 3.6）

## AI Skills

Skills 是与平台无关的 Markdown 文件（`SKILL.md`），为 AI 提供每项任务的操作指令。OpenLogos 内置以下 Skill：

| 阶段 | Skills |
|-------|--------|
| **WHY**（需求） | `project-init`、`prd-writer` |
| **WHAT**（设计） | `product-designer`、`ui-ux-pro-max` |
| **HOW**（实现） | `architecture-designer`、`scenario-architect`、`api-designer`、`db-designer`、`deployment-designer`、`test-writer`、`test-orchestrator`、`code-implementor`、`code-reviewer` |
| **部署** | `deployment-executor` |
| **跨阶段** | `change-writer`、`merge-executor`、`slice-planner` |
| **已有项目（可选）** | `brownfield-adopter` |

Skills 可与任何能读取项目文件的 AI 工具配合使用。没有厂商锁定。[完整 Skills 参考 →](/zh/skills)

## CLI

`openlogos` CLI 提供一组顶层命令，用于项目生命周期管理。最常用的有：

| 命令 | 用途 |
|---------|---------|
| `init` | 初始化项目结构 |
| `adopt` | 接入已有项目（bootstrap: adopted） |
| `sync` | 同步指令文件、Skills、规格和工具集成 |
| `status` | 显示当前阶段和进度 |
| `next` | 显示最值得执行的单一下一步 |
| `verify` | 依据设计好的测试用例核对测试结果（Gate 3.6） |
| `deploy-done` | 标记活跃提案的部署已完成（Gate 3.7） |
| `smoke` | 校验部署后的健康状况（Gate 3.8） |
| `launch` | 在验证通过后激活变更管理 |
| `change` | 创建变更提案（delta） |
| `change-lint` | 只读检查活跃提案的 proposal / tasks / delta |
| `merge` | 一次调用、原子地把规格 delta 合并进基线 |
| `slice plan` | 把已合并提案的 `[code]` 切片写入 `tasks.md` |
| `archive` | 归档已完成的变更提案 |
| `ignore` / `exempt` | 管理哪些路径不进版本控制、哪些路径无需立案 |
| `detect` | 显示 CLI 版本和项目检测信息 |
| `index` | 生成可供 AI 使用的提示词以重建资源索引 |
| `module` | 管理项目模块 |

[完整 CLI 参考 →](/zh/cli)

## Delta 变更工作流

首轮构建完成后，每次迭代都遵循一套结构化的变更流程：

1. `openlogos change <slug>` —— 创建一个带影响分析的提案
2. 编写 `proposal.md`（改了什么、为什么改）和 `tasks.md`（基于阶段的清单）
3. 为受影响的制品产出 delta 文件（写作过程中用 `openlogos change-lint` 检查）
4. `openlogos merge <slug>` —— 一次调用、原子地把全部 delta 应用到主制品
5. 规划 `[code]` 切片（`openlogos slice plan --file <slices.json>`），再逐片实现代码 + 测试
6. `openlogos verify` —— 验收门禁（Gate 3.6）
7. `openlogos archive <slug>` —— 关闭提案

关键洞见：**影响分析会评估整个制品链上的连锁反应**——需求、设计、API、DB、测试、代码。没有任何制品会失去同步。这正是结构化迭代区别于"改完代码就把文档抛在脑后"的地方。

## 项目结构

```
logos/
├── logos.config.json         # 项目配置
├── logos-project.yaml        # AI 协作索引
├── resources/                # 所有阶段的制品
│   ├── prd/                  # 需求 → 设计 → 技术方案
│   ├── api/                  # OpenAPI YAML 规格
│   ├── database/             # SQL DDL / schema
│   ├── test/                 # 测试用例文档
│   ├── scenario/             # API 编排测试
│   └── verify/               # 验收报告
├── changes/                  # Delta 变更提案 + 归档
├── skills/                   # AI Skills（每个 skill 一个 SKILL.md）
└── spec/                     # 方法论规格
```

[完整项目结构 →](/zh/specs/project-structure)

## 平台支持

OpenLogos 与工具无关。内置对以下平台的集成支持：

| 平台 | 集成机制 |
|----------|----------------------|
| **Claude Code** | 原生 `.claude/` 命令、agent 与 hooks（SessionStart 上下文、PreToolUse 写入门禁、执行后检查） |
| **OpenCode** | `.opencode/plugins/` 插件与 `.opencode/commands/` 斜杠命令 |
| **Codex** | `.agents/skills/` 加 `.codex-plugin/` 钩子集成 |
| **Cursor** | `.cursor/skills/` Agent Skills、`.cursor/agents/` subagent、`.cursor/hooks.json`（部分强度门禁：`beforeShellExecution` / `afterShellExecution` / `afterFileEdit`） |
| **ZCode** | 项目插件 `.zcode/plugins/openlogos/`（Skills、命令、agent、SessionStart + PreToolUse hooks） |
| **Qoder** | 项目插件 `.qoder/plugins/openlogos/`（Skills、命令、agent、SessionStart + PreToolUse hooks） |
| **WorkBuddy** | 项目插件 `.workbuddy/plugins/openlogos/`（Skills、命令、agent、SessionStart + PreToolUse hooks） |
| **其他工具** | `AGENTS.md` 作为通用入口 |

各宿主写入门禁的行为差异见 [PreToolUse Guard](/zh/specs/pretooluse-guard)。

## 后续步骤

- **[快速开始](/zh/getting-started/quick-start)** —— 10 分钟内安装并创建你的第一个项目
- **[从 0.13.x 升级](/zh/getting-started/upgrade-from-0-13)** —— 已在用 0.13.x？按升级指南迁移到 0.16.0
- **[首次 AI 协作](/zh/getting-started/first-collaboration)** —— 完整走一遍开发流程
- **[导览](/zh/tour)** —— 看看 OpenLogos 在真实项目中的应用（FlowTask + Money-Log）
