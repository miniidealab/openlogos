# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`

## Language Policy
本项目的文档语言配置于 `logos/logos.config.json` 的 `locale` 字段（当前值：`"zh"`）。
- 所有生成的文档、注释和 AI 回复**必须使用中文**
- Skill 文件可能使用任何语言编写，但你的输出必须遵循 locale 设置
- 生成文档前请先检查 `logos/logos.config.json`

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see logos/changes/ directory)
6. All generated test code must include an OpenLogos reporter (see spec/test-results.md)

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

## Active Skills
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

## ⚠️ 变更管理（必须遵守）

**修改任何源代码或 Skill 文件之前，必须先创建变更提案：**

1. 运行 `openlogos change <slug>` 创建提案目录
2. 使用 change-writer Skill 填写 `proposal.md` + `tasks.md`
3. 用户确认后再开始编码
4. 完成后运行 `openlogos merge <slug>` → `openlogos archive <slug>`

唯一例外：纯 typo 修复、README 等非方法论文件的修改。
**跳过此步骤将违反 OpenLogos 核心方法论。**

## Conventions
- 遵循 OpenLogos 三层推进模型（Why → What → How）
- 每次变更必须先创建 logos/changes/ 变更提案
