---
name: code-implementor
description: "Generate business code and test code based on the full specification chain (sequence diagrams, API YAML, DB DDL, test case specs). Use when test cases exist in logos/resources/test/ but logos/resources/implementation/ is empty."
---

# Skill: Code Implementor

> Generate business code and test code based on the full specification chain (sequence diagrams, API YAML, DB DDL, test case specs). Ensure strict spec fidelity, embed OpenLogos reporter, and deliver closed-loop batches per scenario.

## Trigger Conditions

- User requests code implementation or code generation
- User mentions "Phase 3 Step 4", "code generation", "implement S01"
- Test case design is complete (`logos/resources/test/` is non-empty) and coding should begin
- User specifies a scenario number (e.g., S01) to implement

## Prerequisites

- `logos/resources/prd/3-technical-plan/2-scenario-implementation/` contains sequence diagrams (**required**)
- `logos/resources/api/` contains API specifications (read if present)
- `logos/resources/database/` contains DB DDL (read if present)
- `logos/resources/test/` contains test case specifications (**required**)
- `logos/logos-project.yaml` contains `tech_stack` (**required**)

If sequence diagrams or test case directories are empty, prompt the user to complete Phase 3 Step 1 (scenario-architect) and Step 3a (test-writer) first.

## Core Capabilities

1. Load full specification context to establish an implementation baseline
2. Plan batch execution strategy, splitting large tasks by scenario or module
3. Generate business code strictly consistent with API YAML (routes, status codes, error codes, fields)
4. Generate data access code strictly aligned with DB DDL (table names, column names, types, constraints)
5. Generate test code with IDs exactly matching test-cases.md
6. Embed OpenLogos reporter in test code (outputting to `test-results.jsonl`)
7. Self-check after each batch to ensure spec fidelity

## Relationship with test-writer and code-reviewer

This Skill sits in the middle of a three-Skill chain:

- **test-writer** (Step 3a): Designs test case **specification documents** (Markdown), defines UT/ST IDs — the "exam designer"
- **code-implementor** (Step 4, this Skill): Transforms all specs into **runnable business code and test code** — the "exam taker"
- **code-reviewer** (after Step 4): Audits generated business code against specs, outputs a review report — the "exam grader"

test-writer writes no code; code-implementor designs no test cases; code-reviewer modifies no code. Together they form a **Design → Execute → Review** closed loop.

## Execution Steps

### Step 1: Load Specification Context

**Before writing any line of code**, read the following documents to establish full context:

| Document | Path | Purpose |
|----------|------|---------|
| Architecture | `prd/3-technical-plan/1-architecture/` | Overall structure, framework, design patterns |
| Sequence diagrams | `prd/3-technical-plan/2-scenario-implementation/` | Implementation blueprint — Step sequence = code call chain |
| API specs | `logos/resources/api/*.yaml` | Endpoint contracts — routes, methods, status codes, fields |
| DB DDL | `logos/resources/database/*.sql` | Data layer contracts — table structures, constraints, indexes |
| Test case specs | `logos/resources/test/*-test-cases.md` | Verification targets — UT/ST IDs, expected inputs/outputs |
| Orchestration tests | `logos/resources/scenario/*.json` | End-to-end verification targets (API projects) |
| Project config | `logos/logos-project.yaml` | `tech_stack`, `external_dependencies` |
| Source roots | `logos/logos.config.json` → `sourceRoots` | Output root directories for business code and test code |

After loading, confirm:
- Which scenarios are in scope (S01, S02...)
- Which API endpoints and DB tables are involved
- Total UT/ST case count
- Technology stack confirmation (language, framework, test framework)
- Source output directories confirmed (read `sourceRoots.src` and `sourceRoots.test`; default to `src/` and `test/` if absent)

### Step 2: Plan Batch Strategy

**Large tasks must be batched, but each batch must be closed-loop.**

1. **Split dimension**: By scenario (S01, S02) or by module (auth, projects)
2. **Pre-batch declaration**: Before each batch, list the UT/ST case IDs covered, ensuring traceability to `logos/resources/test/*.md`
3. **Closed-loop requirement**: Each batch must deliver all three elements — business code + test code + reporter
4. **No deferred testing**: "Write all business code first, add tests later" is not allowed

### Step 3: Generate Business Code

Implement business logic following the sequence diagram Step sequence, strictly adhering to API YAML and DB DDL fidelity rules.

### Step 4: Generate Test Code

Every test file must embed the OpenLogos reporter per `logos/spec/test-results.md`:

- Output path: `logos/resources/verify/test-results.jsonl`
- Format: JSONL (one JSON object per line)
- Each case outputs: `{ "id": "UT-S01-01", "status": "pass"|"fail"|"skip", ... }`

### Step 5: Self-Check

After each batch, verify:
- [ ] API route paths and HTTP methods match YAML
- [ ] HTTP status codes match YAML
- [ ] DB operations use correct table/column names from DDL
- [ ] All pre-declared UT/ST IDs exist in test code
- [ ] Reporter is embedded with correct output path

### Step 6: Guide Next Steps

After all batches complete, guide the user to run `openlogos verify` for Gate 3.5 acceptance.

## Output Specification

- **Business code**: `sourceRoots.src` (default `src/`)
- **Test code**: `sourceRoots.test` (default `test/`)
- **JSONL results**: `logos/resources/verify/test-results.jsonl`
- **Implementation manifest**: `logos/resources/implementation/implementation-manifest.md`

## Recommended Prompts

- `Help me implement S01`
- `Execute Phase 3 Step 4, batch by scenario`
- `Please execute Phase 3 Step 4 for S01. Deliver business code + test code + OpenLogos reporter in each batch.`
