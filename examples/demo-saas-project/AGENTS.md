# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`
- Tech Stack: Next.js 15, TypeScript, Supabase, Paddle

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see logos/changes/ directory)

## Active Skills
- `project-init` — Project initialization and structure setup
- `prd-writer` — Requirements document authoring
- `product-designer` — Product design and prototyping
- `scenario-architect` — Business scenario modeling and sequence diagrams
- `api-designer` — OpenAPI specification design
- `db-designer` — Database schema design
- `test-orchestrator` — API orchestration test design
- `code-reviewer` — Code review and compliance checking

## Conventions
- 遵循 OpenLogos 三层推进模型（Why → What → How）
- 每次变更必须先创建 logos/changes/ 变更提案
- 所有 API 路径以 /api/ 开头
- 数据库金额字段使用 INTEGER 存储分值
- 时间字段统一使用 TIMESTAMPTZ
