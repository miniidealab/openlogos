---
title: test-writer
description: Design unit test and scenario test cases before code generation.
---

Based on sequence diagrams, API specifications, and DB constraints, design unit test cases and scenario test cases for each business scenario. Applicable to all project types (API services, CLI tools, frontend applications, libraries), this is a **mandatory prerequisite step** before code generation.

## Phase & Trigger

- **Phase**: Phase 3 — HOW (Implementation), Step 3a
- **Trigger conditions**:
  - User requests test case or test plan design
  - User mentions "Phase 3 Step 3", "Step 3a", "test-first"
  - Sequence diagrams exist and tests are needed before writing code

## Prerequisites

- Sequence diagrams in `logos/resources/prd/3-technical-plan/2-scenario-implementation/` (required)
- API specs in `logos/resources/api/` (if present)
- DB DDL in `logos/resources/database/` (if present)
- Requirements documents in `logos/resources/prd/1-product-requirements/` (for AC tracing)

**Cannot be skipped** regardless of project type.

## What It Does

1. Extract unit test cases from API field constraints (type, format, length, enum)
2. Extract unit test cases from DB constraints (UNIQUE, CHECK, NOT NULL, FK)
3. Extract unit test cases from business rules and EX exception cases
4. Extract scenario test cases from sequence diagram Step sequences (happy path)
5. Extract scenario test cases from EX exception cases (exception paths)
6. Reverse-validate coverage against Phase 1/2 acceptance criteria
7. Build acceptance criteria traceability table

## Test Case ID Convention

| Type | Format | Example |
|------|--------|---------|
| Unit test | `UT-{scenario}-{seq}` | `UT-S01-01` |
| Scenario test | `ST-{scenario}-{seq}` | `ST-S01-01` |
| Acceptance criteria | `{scenario}-AC-{seq}` | `S01-AC-01` |

These IDs are a **binding contract** between design documents and runtime — they carry through from test-cases.md → test code → test-results.jsonl → acceptance-report.md.

## Unit Test Sources

### API Field Constraints
- `type` → Type error cases
- `format` (email, uuid) → Format validation cases
- `minLength` / `maxLength` → Boundary value cases
- `required` → Required field missing cases
- `enum` → Valid + invalid value cases

### DB Constraints
- `UNIQUE` → Duplicate insertion cases
- `NOT NULL` → Null value cases
- `CHECK` → Constraint violation cases
- `FOREIGN KEY` → Non-existent reference cases

### Business Rules
- Permission checks, state machine transitions, rate limiting, computation logic

## Scenario Test Sources

### Happy Path
The complete Step 1 → Step N sequence from the sequence diagram as an end-to-end call chain, verifying final state (DB records, return values).

### Exception Paths
Each EX exception case expanded into a scenario test: which Step triggers the exception, what happens after, whether other data integrity is preserved.

## Coverage Validation Checklist

- [ ] Each normal AC from Phase 1 → at least 1 ST case
- [ ] Each exception AC from Phase 1 → at least 1 ST or UT case
- [ ] Each EX case → at least 1 ST case
- [ ] Each `required` API field → at least 1 UT case
- [ ] Each `UNIQUE`/`CHECK` DB constraint → at least 1 UT case

## Acceptance Criteria Traceability

```markdown
| AC ID | Acceptance Criterion | Covered By |
|-------|----------------------|------------|
| S01-AC-01 | Normal: Fresh project init — create directory structure | ST-S01-01 |
| S01-AC-02 | Exception: Already initialized — display error | ST-S01-03, UT-S01-05 |
```

`openlogos verify` parses this table and links AC → test case ID → execution result to generate the acceptance report.

## Outputs

| File | Location |
|------|----------|
| Test case documents | `logos/resources/test/` |
| Naming convention | `{scenario-number}-test-cases.md` |

## Best Practices

- **Test cases are design documents, not code** — actual test code is written during Step 4
- **Unit first, then scenario** — ensure building blocks are correct, then verify they fit together
- **Don't overlook DB constraints** — many bugs originate from database-level violations
- **Scenario tests focus on data passing between Steps** — this is where errors most commonly occur
- **Boundary values first** — prioritize boundary values over random values
- **Case IDs are cross-phase contracts** — any inconsistency causes `openlogos verify` to report incomplete results

## Related Skills

- Previous: [`api-designer`](/skills/api-designer) / [`db-designer`](/skills/db-designer) — design specs
- Next (API projects): [`test-orchestrator`](/skills/test-orchestrator) — design API orchestration tests
- Next (all projects): [`code-implementor`](/skills/code-implementor) — generate code with spec fidelity (Phase 3 Step 4)
