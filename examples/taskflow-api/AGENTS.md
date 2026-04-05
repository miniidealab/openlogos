# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context

- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`
- Stack: Hono 4, TypeScript ESM, SQLite + Drizzle, Vitest

## Methodology Rules

1. Never write code without first completing the design documents under `logos/resources/`
2. Follow the Why → What → How progression
3. API shapes must align with `logos/resources/api/openapi.yaml` and scenario sequence diagrams
4. All test case IDs in code must match `*-test-cases.md` and append results to `logos/resources/verify/test-results.jsonl`
5. Use Delta change workflow for iterations (`logos/changes/`)

## Active Skills (reference)

- `prd-writer`, `product-designer`, `architecture-designer`, `scenario-architect`
- `api-designer`, `db-designer`, `test-writer`, `test-orchestrator`, `code-reviewer`

## Local Commands

```bash
npm install
npm test
npm run verify   # requires ../../cli built: cd ../../cli && npm run build
```
