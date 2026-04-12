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

After loading, confirm:
- Which scenarios are in scope (S01, S02...)
- Which API endpoints and DB tables are involved
- Total UT/ST case count
- Technology stack confirmation (language, framework, test framework)

### Step 2: Plan Batch Strategy

**Large tasks must be batched, but each batch must be closed-loop.**

1. **Split dimension**: By scenario (S01, S02) or by module (auth, projects)
2. **Pre-batch declaration**: Before each batch, list the UT/ST case IDs covered, ensuring traceability to `logos/resources/test/*.md`
3. **Closed-loop requirement**: Each batch must deliver all three elements — business code + test code + reporter
4. **No deferred testing**: "Write all business code first, add tests later" is not allowed

Output format example:

```markdown
## Batch Scope

- Scenario: S01 (User Registration)
- Endpoints: POST /api/auth/register, POST /api/auth/verify-email
- DB tables: users, profiles
- Covered cases: UT-S01-01 ~ UT-S01-08, ST-S01-01 ~ ST-S01-03
```

### Step 3: Generate Business Code

Implement business logic following the sequence diagram Step sequence, **strictly adhering to these spec fidelity rules**:

#### API Fidelity (mandatory)

| Rule | Description |
|------|-------------|
| Route paths | Code routes must exactly match API YAML `paths` |
| HTTP methods | GET/POST/PUT/DELETE must match |
| Request body fields | Code must read all `required` fields from YAML `requestBody.schema` |
| Field validation | `type`, `format` (email/uuid), `minLength` constraints must be validated in code |
| Response fields | Returned JSON field names and types must match YAML `responses.schema` |
| HTTP status codes | Normal and error status codes must match YAML definitions (don't return 200 when spec says 201) |
| Error response format | Must follow the unified `{ code, message, details? }` format |

#### DB Fidelity (mandatory)

| Rule | Description |
|------|-------------|
| Table and column names | Names referenced in code must match DDL exactly (no typos, no case mismatches) |
| Field types | Value types in code must match DDL definitions (e.g., cents not dollars for INTEGER amounts) |
| Constraint compliance | NOT NULL fields must always have values; UNIQUE fields must handle conflicts; CHECK enum values need corresponding constants |
| Transaction usage | Multi-table write operations must be wrapped in transactions |
| Parameterized queries | String-concatenated SQL is prohibited; use parameterized queries |

#### Exception Handling (mandatory)

- Every EX exception case in sequence diagrams must have a corresponding error handling branch in code
- External service calls (DB, third-party APIs) must have timeout and error handling
- Empty catch blocks (silently swallowed exceptions) are not allowed
- Multi-step write failures need compensation/rollback mechanisms

### Step 4: Generate Test Code

#### Test ID Contract

Test case IDs in code must **exactly match** those defined in `test-cases.md`:

- `UT-S01-01` must be used verbatim in test code — no renaming, abbreviating, or reordering
- These IDs are a cross-phase contract: test-cases.md → test code → test-results.jsonl → acceptance-report.md

#### OpenLogos Reporter Embedding

Every test file must embed the OpenLogos reporter, implemented per the template in `logos/spec/test-results.md`:

- Output path: `logos/resources/verify/test-results.jsonl`
- Format: JSONL (one JSON object per line)
- Each case outputs: `{ "id": "UT-S01-01", "status": "pass"|"fail"|"skip", ... }`
- First run truncates the file, subsequent writes append
- Ensure `logos/resources/verify/` directory exists before writing

Select the reporter template for the appropriate language (TypeScript/Python/Go, etc.) based on `tech_stack` (templates in `logos/spec/test-results.md`).

#### Test Code Structure

- Unit tests: Each UT case maps to an independent test function
- Scenario tests: Each ST case maps to an end-to-end flow test
- Test data: Each test prepares isolated test data and cleans up afterward, ensuring idempotency

### Step 5: Self-Check

After each batch, run through this checklist (a lightweight pre-check before code-reviewer):

- [ ] API route paths and HTTP methods match YAML
- [ ] HTTP status codes (normal + error) match YAML
- [ ] Error response format follows `{ code, message }` convention
- [ ] DB operations use correct table and column names from DDL
- [ ] Multi-table writes use transactions
- [ ] All pre-declared UT/ST IDs exist in test code
- [ ] Reporter is embedded with correct output path
- [ ] No hardcoded sensitive data (passwords, keys, test fixtures)

If any inconsistency is found, **fix it immediately before delivery** — don't wait for the code-reviewer phase.

### Step 6: Guide Next Steps

After each batch:

1. **Prompt to run tests**: Tell the user the test command (e.g., `npm test`, `pytest`)
2. **Prompt to check results**: Confirm `logos/resources/verify/test-results.jsonl` was generated
3. **After all batches complete**: Guide the user to run `openlogos verify` for Gate 3.5 acceptance

If the user wants a quality audit, suggest using the `code-reviewer` Skill.

## Output Specification

- **Business code**: Output to the project source tree (directory structure follows architecture design conventions)
- **Test code**: Output to the project test directory
- **Reporter**: Embedded in test code (not a standalone file)
- **JSONL results**: `logos/resources/verify/test-results.jsonl`
- This Skill does not produce files under `logos/resources/` (code goes to the project source tree; JSONL is produced at test runtime)

## Best Practices

- **Spec fidelity is the #1 priority**: Code must strictly match API YAML / DB DDL — most production bugs come from subtle inconsistencies between code and specs
- **Writing business code before test code within a batch is fine**, but both must be completed in the same batch — never split across batches
- **Don't forget the reporter**: This is the key to `openlogos verify` automated acceptance — no reporter means no automated verification
- **Don't invent test IDs**: IDs in test code must come from test-cases.md — never add new ones or rename existing ones
- **Don't skip exception handling**: Every EX case in the sequence diagram must have a corresponding code branch
- **Self-check is cheaper than rework**: A 5-minute Step 5 self-check can prevent 30 minutes of rework during code-reviewer
- **Batch granularity**: One scenario per batch is a good default; one API endpoint per batch is too granular

## Recommended Prompts

The following prompts can be copied directly for AI use:

- `Help me implement S01`
- `Generate business code and test code for S01 based on the specs`
- `Execute Phase 3 Step 4, batch by scenario`
- `Implement S01, ensuring consistency with API YAML and DB DDL`
- `Please execute Phase 3 Step 4 for S01. Deliver business code + test code + OpenLogos reporter in each batch.`
