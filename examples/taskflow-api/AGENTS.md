# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`

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

## Conventions
- Follow the OpenLogos three-layer progression (Why → What → How)
- Every change must start with a logos/changes/ change proposal
