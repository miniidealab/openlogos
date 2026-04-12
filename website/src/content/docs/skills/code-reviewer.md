---
title: code-reviewer
description: Review code against the full OpenLogos specification chain for compliance.
---

Review AI-generated code by performing systematic validation against the full OpenLogos specification chain (API YAML, sequence diagram EX cases, DB DDL), ensuring code is fully consistent with design documents, covers all exception paths, and meets security requirements.

## Phase & Trigger

- **Phase**: Phase 3 — HOW (Implementation), after Step 4
- **Trigger conditions**:
  - User requests a code review
  - User mentions "code audit", "code review"
  - AI has just generated code that needs quality verification
  - Need to locate issues after orchestration test failures

## Prerequisites

- API specs in `logos/resources/api/`
- Sequence diagrams with EX cases in `logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- DB DDL in `logos/resources/database/`
- Code to be reviewed is accessible

For non-API projects, API consistency checks can be skipped; focus on sequence diagram coverage and exception handling.

## What It Does

1. **YAML validity pre-check** — verify all `logos/resources/api/*.yaml` are syntactically valid before proceeding
2. **API consistency review** — compare code against API YAML endpoint by endpoint
3. **Exception handling coverage** — map all EX cases to error handling in code
4. **DB operations review** — verify code conforms to DDL design
5. **Security review** — check authentication, authorization, input validation
6. **Structured report** — output findings categorized by severity

## Review Dimensions

### API Consistency

| Check | Severity |
|-------|----------|
| Route paths match YAML `paths` | Critical |
| HTTP methods match | Critical |
| Request body reads all required fields | Critical |
| Field validation (type, format, minLength) | Warning |
| Response fields and types match | Critical |
| HTTP status codes match | Critical |
| Error response format `{ code, message }` | Warning |

### Exception Handling

- Every EX case has a corresponding code branch
- Correct HTTP status codes and error codes are returned
- No "silently swallowed exceptions" (empty catch blocks)
- External service calls have timeout and error handling
- Exception handlers in code not in sequence diagrams → diagram may need updating

### DB Operations

- Table and column names match DDL (no typos, case differences)
- Value types match DDL definitions (e.g., cents not dollars for INTEGER amount)
- NOT NULL fields always have values; UNIQUE fields have conflict handling
- Multi-table writes are wrapped in transactions

### Security

| Check | Severity |
|-------|----------|
| Authentication verification before processing | Critical |
| Users can only access their own data | Critical |
| Input validation (type, length limits) | Critical |
| No sensitive data in responses (passwords, stack traces) | Critical |
| Parameterized queries (no SQL string concatenation) | Critical |
| Rate limiting on critical endpoints | Warning |

## Report Format

Findings are categorized as:

- **Critical** — must be fixed before proceeding
- **Warning** — recommended to fix but doesn't block delivery
- **Info** — improvement suggestions for later

Every finding includes: spec source reference, issue description, and fix suggestion.

## Outputs

The review report is output directly in the conversation (not written to a file), ending with a summary and next-step recommendation.

## Best Practices

- **Consistency first** — most production bugs come from subtle differences between code and specs
- **Exception handling is the focus** — most bugs occur in exception paths
- **Run tests before reviewing** — use failing test cases to pinpoint issues before reading code line by line
- **Watch for compensation logic** — multi-step writes failing midway without rollback is the most commonly missed Critical issue

## Related Skills

- Previous: [`code-implementor`](/skills/code-implementor) — generate code with spec fidelity (Phase 3 Step 4)
- Fix issues: [`change-writer`](/skills/change-writer) — create change proposals for fixes
