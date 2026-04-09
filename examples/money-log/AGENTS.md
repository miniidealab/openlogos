# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`

## ⚠️ 语言策略（最高优先级）

本项目的文档语言为 **中文**（配置于 `logos/logos.config.json` → `locale: "zh"`）。

**你的所有输出——包括生成的文档、代码注释、回复消息——必须使用中文。**
即使 Skill 文件使用其他语言编写，你的输出也必须是中文。
违反此规则将导致产出不可用。

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see logos/changes/ directory)
6. All generated test code must include an OpenLogos reporter (see logos/spec/test-results.md)

## Interaction Guidelines
When the user's request is vague or they ask "what should I do next":
1. Scan `logos/resources/` to determine the current project phase
2. Suggest the specific next step based on what's missing
3. Provide a ready-to-use prompt the user can directly say
4. Never start generating documents without confirming key information

Phase 检测逻辑（检测到对应阶段时，**必须先读取** Skill 文件并按其步骤执行）：
- `logos/resources/prd/1-product-requirements/` 为空 → Phase 1 → **读取 `logos/skills/prd-writer/SKILL.md` 并按其步骤执行**
- 需求存在但 `2-product-design/` 为空 → Phase 2 → **读取 `logos/skills/product-designer/SKILL.md` 并按其步骤执行**
- 设计存在但 `3-technical-plan/1-architecture/` 为空 → Phase 3 Step 0 → **读取 `logos/skills/architecture-designer/SKILL.md` 并按其步骤执行**
- 架构存在但 `3-technical-plan/2-scenario-implementation/` 为空 → Phase 3 Step 1 → **读取 `logos/skills/scenario-architect/SKILL.md` 并按其步骤执行**
- 场景存在但 `logos/resources/api/` 为空 → Phase 3 Step 2 → **读取 `logos/skills/api-designer/SKILL.md` 和 `logos/skills/db-designer/SKILL.md` 并按其步骤执行**
- API 存在但 `logos/resources/test/` 为空 → Phase 3 Step 3a → **读取 `logos/skills/test-writer/SKILL.md` 并按其步骤执行**
- 测试用例存在但 `logos/resources/scenario/` 为空 → Phase 3 Step 3b → **读取 `logos/skills/test-orchestrator/SKILL.md` 并按其步骤执行**（仅 API 项目）
- 以上全部完成 → Phase 3 Step 4（代码生成）→ **读取 `logos/skills/code-reviewer/SKILL.md` 进行代码审查**
- 代码已生成但 `logos/resources/verify/` 为空 → Phase 3 Step 5（运行测试后 `openlogos verify`）

## Active Skills
**重要**：当你识别到当前 Phase 后，必须先读取对应的 Skill 文件（使用上方 Phase 检测逻辑中指定的路径），按 Skill 中定义的步骤逐步执行。不要跳过 Skill 文件直接生成内容。

- `skills/project-init/` — 项目初始化与结构搭建
- `skills/prd-writer/` — 需求文档编写
- `skills/product-designer/` — 产品设计与原型
- `skills/architecture-designer/` — 技术架构与技术选型
- `skills/scenario-architect/` — 业务场景建模与时序图
- `skills/api-designer/` — OpenAPI 规格设计
- `skills/db-designer/` — 数据库 Schema 设计
- `skills/test-writer/` — 单元测试 + 场景测试用例设计（Step 3a）
- `skills/test-orchestrator/` — API 编排测试设计（Step 3b，仅 API 项目）
- `skills/code-reviewer/` — 代码审查与规范检查
- `skills/change-writer/` — 变更提案编写与影响分析
- `skills/merge-executor/` — 通过 MERGE_PROMPT.md 执行 Delta 合并

## ⛔ 变更管理（强制执行）

### Guard 机制
本项目使用 `logos/.openlogos-guard` 锁文件来追踪活跃变更。
- **有 guard 文件** → 可以修改代码，但 **只能在该提案范围内** 修改
- **无 guard 文件** → **禁止修改任何源代码**，必须先运行 `openlogos change <slug>`

### 变更流程
1. 运行 `openlogos change <slug>` 创建提案（自动写入 guard 文件）
2. 使用 change-writer Skill 填写 `proposal.md` + `tasks.md`
3. **等待用户确认后** 再开始编码
4. 完成后运行 `openlogos merge <slug>` → `openlogos archive <slug>`（自动删除 guard 文件）

### 行为约束
- **发现 bug/问题时**：只输出分析和修复方案，**禁止直接修改代码**，等待用户决定是否创建变更提案
- **修改代码前**：先确认 guard 文件存在且当前修改在提案范围内
- **唯一例外**：纯 typo 修复（不改变语义）、`.gitignore`/`README.md` 等非方法论文件

**违反此规则将破坏项目的变更可追溯性。**

## ⚠️ openlogos CLI 规则

运行任何 `openlogos` 命令之前，**必须先 cd 到项目根目录**（OpenLogos monorepo 内为 `examples/money-log/`，即同时包含 `logos/logos.config.json` 与 `package.json` 的目录）。
在子目录（如 `src/main/`、`src/renderer/`）下直接运行会导致 `logos.config.json not found` 错误。

正确写法：
```bash
cd <项目根目录> && openlogos <command>
```

## Conventions
- 遵循 OpenLogos 三层推进模型（Why → What → How）
- 每次变更必须先创建 logos/changes/ 变更提案
