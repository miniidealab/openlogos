# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`
- Tech Stack: Node.js + TypeScript (CLI), Astro 5 (Website), Markdown (Skills & Specs)

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see logos/changes/ directory)
6. All generated test code must include an OpenLogos reporter (see spec/test-results.md)

## Project Structure
- `spec/` — Methodology specifications (the "source code" of OpenLogos)
- `skills/` — AI Skills (platform-agnostic Markdown)
- `cli/` — `@miniidea/openlogos` CLI tool (TypeScript + ESM)
- `website/` — openlogos.ai static site (Astro 5)
- `examples/` — Demo projects
- `logos/` — OpenLogos methodology assets for this project itself (dogfooding)

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
- `skills/project-init/` — Project initialization and structure setup
- `skills/prd-writer/` — Requirements document authoring
- `skills/product-designer/` — Product design and prototyping
- `skills/architecture-designer/` — Technical architecture and technology selection
- `skills/scenario-architect/` — Business scenario modeling and sequence diagrams
- `skills/api-designer/` — OpenAPI specification design
- `skills/db-designer/` — Database schema design
- `skills/test-writer/` — Unit test + scenario test case design (Step 3a, all projects)
- `skills/test-orchestrator/` — API orchestration test design (Step 3b, API projects only)
- `skills/code-reviewer/` — Code review and compliance checking
- `skills/change-writer/` — Change proposal writing and impact analysis
- `skills/merge-executor/` — Delta merge execution via MERGE_PROMPT.md

## Conventions
- 遵循 OpenLogos 三层推进模型（Why → What → How）
- 每次变更必须先创建 logos/changes/ 变更提案
- CLI 代码位于 cli/，使用 TypeScript + ESM
- 官网代码位于 website/，使用 Astro 静态输出
- 所有 Skill 使用 Markdown 格式，放在 skills/{skill-name}/SKILL.md
- 所有规范文档放在 spec/，是方法论的「源码」
- Commit 类型：feat | improve | fix | docs | refactor
- Markdown 嵌套代码块：当文档内容包含 ``` 代码围栏时，外层必须使用 4 个反引号（````），内层保持 3 个
