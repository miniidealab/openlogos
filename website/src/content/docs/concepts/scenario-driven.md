---
title: Scenario-Driven + Test-First
description: One scenario ID traces from requirements to verified code. Tests define "done" before a line is written.
---

**Scenario-Driven + Test-First** is the most critical principle in OpenLogos. It guarantees accuracy, reliability, and maintainability by combining two complementary strategies:

1. **Scenario-Driven**: Every feature is decomposed into discrete scenarios (S01, S02...) that trace from requirements through design to implementation.
2. **Test-First**: For each scenario, a comprehensive test suite is designed *before* code is written, giving AI a precise definition of "done."

## The Scenario Journey

A single scenario ID (`S01`) travels through all three phases:

- **Phase 1**: S01 gets acceptance criteria (GIVEN/WHEN/THEN)
- **Phase 2**: S01 gets interaction specs and prototypes
- **Phase 3**: S01 gets sequence diagrams, APIs, test cases (UT-S01-001...), and verified code

No traceability matrix needed — the scenario ID *is* the trace.

## Test-First for AI

This is not traditional TDD (write one test → write code → refactor). OpenLogos designs the *entire test system* first:

- Unit tests (function correctness)
- Scenario tests (cross-module integration)
- API orchestration tests (end-to-end flow)

Then AI generates code with a precise, verifiable target — 12 test cases with specific IDs, not a vague "build a login feature."

## Automated Verification

```bash
openlogos verify
```

Three-layer verification checks:
- **Pass rate**: All tests pass
- **Design-time coverage**: Every defined test case was executed
- **Acceptance criteria traceability**: Requirements → test cases → results

---

**Deep dive**: See the full interactive page at [Scenario-Driven + Test-First](/concepts/scenario-test-first) for visual walkthroughs, comparisons, and real examples from the OpenLogos CLI project.
