---
title: code-implementor
description: Generate business code and test code with strict spec fidelity based on the full specification chain.
---

Generate business code and test code based on the full specification chain (sequence diagrams, API YAML, DB DDL, test case specs). Ensure strict spec fidelity, embed OpenLogos reporter, and deliver closed-loop batches per scenario.

## Phase & Trigger

- **Phase**: Phase 3 — HOW (Implementation), Step 4
- **Trigger conditions**:
  - User requests code implementation or code generation
  - User mentions "Phase 3 Step 4", "implement S01", "generate code"
  - Test case design is complete (`logos/resources/test/` non-empty)

## Prerequisites

- Sequence diagrams in `logos/resources/prd/3-technical-plan/2-scenario-implementation/` (required)
- API specs in `logos/resources/api/` (if present)
- DB DDL in `logos/resources/database/` (if present)
- Test case specs in `logos/resources/test/` (required)
- `logos/logos-project.yaml` with `tech_stack` (required)

If sequence diagrams or test cases are missing, prompt the user to complete Step 1 (scenario-architect) and Step 3a (test-writer) first.

## Relationship with test-writer and code-reviewer

This Skill sits in the middle of a three-Skill chain:

| Skill | Role | Analogy |
|-------|------|---------|
| [`test-writer`](/skills/test-writer) (Step 3a) | Designs test case **specification documents** — defines UT/ST IDs | Exam designer |
| **code-implementor** (Step 4) | Transforms all specs into **runnable business code and test code** | Exam taker |
| [`code-reviewer`](/skills/code-reviewer) (after Step 4) | Audits generated code against specs — outputs review report | Exam grader |

test-writer writes no code; code-implementor designs no test cases; code-reviewer modifies no code. Together they form a **Design → Execute → Review** closed loop.

## What It Does

1. Load full specification context (7 document types) to establish an implementation baseline
2. Decide the batches: in the `initial` phase, plan them by scenario or module; under a `launched` change, consume the `[code]` slices written by `slice-planner`
3. Generate business code strictly consistent with API YAML (routes, status codes, error codes, fields)
4. Generate data access code strictly aligned with DB DDL (table names, column names, types, constraints)
5. Generate test code with IDs exactly matching test-cases.md
6. Embed OpenLogos reporter in test code (outputting to `test-results.jsonl`)
7. Self-check after each batch to ensure spec fidelity

## Execution Steps

### Step 1: Load Specification Context

Before writing any code, read these documents to establish full context:

| Document | Path | Purpose |
|----------|------|---------|
| Architecture | `prd/3-technical-plan/1-architecture/` | Structure, framework, patterns |
| Sequence diagrams | `prd/3-technical-plan/2-scenario-implementation/` | Implementation blueprint |
| API specs | `logos/resources/api/*.yaml` | Endpoint contracts |
| DB DDL | `logos/resources/database/*.sql` | Data layer contracts |
| Test case specs | `logos/resources/test/*-test-cases.md` | Verification targets |
| Orchestration tests | `logos/resources/scenario/*.json` | E2E targets (API projects) |
| Project config | `logos/logos-project.yaml` | Tech stack, dependencies |

### Step 2: Plan Batch Strategy (`initial` only)

> **Scope:** this step applies **only to the `initial` phase**, the first 0-to-1 development cycle. There is no change proposal and no `tasks.md` yet, so the implementer plans the batches.
>
> **Under a `launched` change this step does not apply.** After merge, [`slice-planner`](/skills/slice-planner) has already decided the slices with six-dimension scoring, the vertical/horizontal discriminator and the delete-the-rest gate. `openlogos slice plan` wrote them into the `[code]` section of `tasks.md`, one unchecked line per slice. That section is the single source of truth. code-implementor **must not re-score and must not re-batch**. It consumes the `[code]` slices line by line, in order. Which slice to do, and how many slices there are, always comes from `[code]`. If the slicing looks wrong, stop and ask for re-planning with `slice-planner` instead of splitting or merging slices yourself.

In the `initial` phase, batch only big tasks: a task scoring 8 or more on the six dimensions (blast radius, behavioral complexity, contract change, test size, risk, uncertainty). Each batch must be **closed-loop**:

1. **Split dimension**: By scenario (S01, S02) or by module (auth, projects)
2. **Pre-batch declaration**: List UT/ST case IDs covered, ensuring traceability to `logos/resources/test/*.md`
3. **Closed-loop requirement**: Each batch delivers business code + test code + reporter
4. **No deferred testing**: "Write all business code first, add tests later" is forbidden

#### Consuming `[code]` slices (`launched`)

- Each unchecked `[code]` line is one slice. Its business code, its UT/ST tests (the IDs at the end of the line) and the reporter are delivered together.
- **When the host injects one slice at a time** (`openlogos next` returns `next_node.slice`), implement only that slice in this round.
- **When nothing injects slices** (manual run, no driver), implement **all** unchecked slices in this session, each still closed-loop, before you hand over to verify. Do not stop after the first line and wait for a next round that will never come.
- When the change has two or more slices with a `TEST_SLICE_MANIFEST.json`, `openlogos verify` runs a **slice checkpoint**: baseline regression + tests of the slices already confirmed + tests of the current slice. Tests of later slices are pending. After the last slice, verify runs full final acceptance. See [Test Slice Manifest](/specs/test-slice-manifest).
- Tick a slice only after its tests and the regression are green. Never edit `[code]` text or the manifest.

### Step 3: Generate Business Code

Follow the sequence diagram Step sequence, adhering to:

**API Fidelity** — Route paths, HTTP methods, request/response fields, status codes, and error formats must exactly match API YAML definitions.

**DB Fidelity** — Table names, column names, types, and constraints must match DDL. Multi-table writes must use transactions. All queries must be parameterized.

**Exception Handling** — Every EX case in sequence diagrams needs a corresponding error handling branch. No empty catch blocks. Multi-step failures need compensation/rollback.

### Step 4: Generate Test Code

**Test ID Contract**: IDs in test code must exactly match `test-cases.md` — `UT-S01-01` used verbatim, no renaming or abbreviation. These IDs form a cross-phase contract: test-cases.md → test code → test-results.jsonl → acceptance-report.md.

**OpenLogos Reporter**: Every test file embeds the reporter per `logos/spec/test-results.md` templates. Output: `logos/resources/verify/test-results.jsonl` in JSONL format.

### Step 5: Self-Check

After each batch, verify:

- [ ] API routes and status codes match YAML
- [ ] DB operations use correct names from DDL
- [ ] Multi-table writes use transactions
- [ ] All pre-declared UT/ST IDs exist in test code
- [ ] Reporter is embedded with correct output path
- [ ] No hardcoded sensitive data

### Step 6: Guide Next Steps

1. Prompt user to run tests (e.g., `npm test`, `pytest`)
2. Confirm `test-results.jsonl` was generated
3. After all batches or slices: guide the user to run `openlogos verify` (Gate 3.6)
4. If code quality audit needed: suggest [`code-reviewer`](/skills/code-reviewer)

## Outputs

| Output | Destination |
|--------|-------------|
| Business code | Project source tree |
| Test code | Project test directory |
| Reporter | Embedded in test code |
| JSONL results | `logos/resources/verify/test-results.jsonl` (generated at test runtime) |

This Skill does not produce files under `logos/resources/` — code goes to the project source tree; JSONL is produced when tests run.

## Best Practices

- **Spec fidelity is the #1 priority** — most production bugs come from subtle inconsistencies between code and specs
- **Business code before test code within a batch is fine**, but both must complete in the same batch
- **Don't forget the reporter** — no reporter means no automated verification via `openlogos verify`
- **Don't invent test IDs** — IDs must come from test-cases.md, never self-created
- **Don't skip exception handling** — every EX case in the sequence diagram needs a code branch
- **Self-check is cheaper than rework** — 5 minutes of Step 5 prevents 30 minutes of code-reviewer rework
- **Batch granularity** — one scenario per batch is the sweet spot; one endpoint per batch is too granular

## Related Skills

- Previous: [`test-writer`](/skills/test-writer) / [`test-orchestrator`](/skills/test-orchestrator) — design test specs
- Next: [`code-reviewer`](/skills/code-reviewer) — audit generated code against specs
