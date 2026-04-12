---
title: test-orchestrator
description: Design API orchestration test scenarios as executable JSON (API projects only).
---

Design API orchestration test cases based on business scenarios and sequence diagrams, covering normal/exception/boundary scenarios. Automatically identify external dependencies and apply test strategies. **Only applicable to projects involving APIs.**

## Phase & Trigger

- **Phase**: Phase 3 — HOW (Implementation), Step 3b
- **Trigger conditions**:
  - User requests API orchestration test design
  - User mentions "Phase 3 Step 3b", "API orchestration"
  - After Step 3a ([`test-writer`](/skills/test-writer)) is complete

## Prerequisites

- Test case specs in `logos/resources/test/` (Step 3a completed)
- Sequence diagrams in `logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- API specs in `logos/resources/api/`
- `external_dependencies` in `logos-project.yaml` (if applicable)

If the project does not involve APIs (pure CLI, pure frontend), skip this Skill.

## Relationship with test-writer

This Skill handles the **top layer** of the test pyramid — API orchestration tests at the HTTP request level.

[`test-writer`](/skills/test-writer) handles the lower layers — unit tests and scenario tests at the function call level. Step 3a is mandatory for all projects; Step 3b (this Skill) only runs when the project has APIs.

## What It Does

1. Design normal flow orchestration from sequence diagrams and API YAML
2. Design exception flow orchestration based on EX cases
3. Design boundary cases (valid but non-happy-path variations)
4. Define variable extraction and passing between steps
5. Identify external dependencies and apply test strategies from `logos-project.yaml`
6. Output executable orchestration JSON files

## External Dependency Handling

The `mock` field is inserted into steps involving external services:

```json
{
  "step": "Step 2: Get email verification code",
  "mock": {
    "dependency": "Email Service",
    "strategy": "test-api",
    "config": "GET /api/test/latest-email?to={email}",
    "extract": { "code": "response.body.code" }
  },
  "method": "GET",
  "url": "/api/test/latest-email?to={{email}}",
  "expected_status": 200
}
```

Supported strategies: `test-api`, `fixed-value`, `env-disable`, `mock-callback`, `mock-service`.

If a dependency in a sequence diagram is missing from `external_dependencies`, the Skill proactively asks the user to define it.

## Outputs

| File | Location |
|------|----------|
| Orchestration JSON | `logos/resources/scenario/` |
| Split by scenario | `user-auth.json`, `payment-flow.json` |

Each step in the orchestration corresponds to a Step number in the sequence diagram.

Orchestration test results are also written to `logos/resources/verify/test-results.jsonl` in the same format as unit/scenario tests, and `openlogos verify` reads them uniformly.

## Best Practices

- **Normal orchestration is the skeleton** — complete the happy path first
- **At least 1 exception orchestration per external call**
- **Variable passing** — extract from previous step's response (token, user_id) for subsequent steps
- **Test data** — prepare before orchestration, clean up after, ensuring idempotency
- **Don't invent mock strategies** — test strategies are defined in [`architecture-designer`](/skills/architecture-designer), only consume them here

## Related Skills

- Previous: [`test-writer`](/skills/test-writer) — design unit/scenario tests
- Next: [`code-implementor`](/skills/code-implementor) — generate code with spec fidelity (Phase 3 Step 4)
- Review: [`code-reviewer`](/skills/code-reviewer) — review generated code
