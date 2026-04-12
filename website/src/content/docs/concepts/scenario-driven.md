---
title: Scenario-Driven + Test-First
description: "One scenario ID traces from requirements to verified code. Tests define 'done' before a line is written."
---

**Scenario-Driven + Test-First** is the most critical principle in OpenLogos. It guarantees accuracy, reliability, and maintainability by combining two complementary strategies:

1. **Scenario-Driven**: Every feature is decomposed into discrete scenarios (`S01`, `S02` …) that trace from requirements through design to implementation.
2. **Test-First**: For each scenario, a comprehensive test suite is designed *before* code is written, giving AI a precise definition of "done."

## The scenario journey

A single scenario ID (`S01`) travels through all three phases — no traceability matrix needed, because the ID **is** the trace:

| Phase | What S01 gets |
|-------|---------------|
| Phase 1 · WHY | Pain point, acceptance criteria (GIVEN/WHEN/THEN) |
| Phase 2 · WHAT | Interaction spec, page flow, prototype |
| Phase 3 · HOW | Sequence diagram → APIs → test cases (`UT-S01-001` …) → verified code |

Change a requirement for S01? You know exactly which API, tests, and code are affected.

## Test-first for AI

This is **not** traditional TDD (write one test → write code → refactor). OpenLogos designs the *entire test system* first:

| Layer | Scope | Example |
|-------|-------|---------|
| Unit tests (UT) | Function correctness | `UT-S01-001`: username min 2 chars |
| Scenario tests (ST) | Cross-module integration | `ST-S01-001`: full register → task view |
| Orchestration tests (OT) | End-to-end API flow | `OT-S01-001`: register → login → create task |

Then AI generates code with a precise, verifiable target — "pass these 12 test cases with specific IDs," not a vague "build a login feature."

### Why this matters

When you tell AI "write a registration feature," it guesses what "done" means. When you tell AI "write code that passes `UT-S01-001` through `ST-S01-012`," it has a **precise, verifiable target**. The output quality difference is dramatic.

## Automated verification

```bash
openlogos verify
```

Three-layer verification checks:

| Check | Description |
|-------|-------------|
| **Pass rate** | All tests pass |
| **Design-time coverage** | Every defined test case was executed |
| **AC traceability** | Requirements → test cases → results linked |

The result is a Gate 3.5 acceptance report — quality as a number, not a feeling.

## Test ID naming convention

```
{type}-S{scenario}-{number}
```

- **Type**: `UT` (unit), `ST` (scenario), `OT` (orchestration)
- **Scenario**: Two-digit scenario number (`S01`, `S02` …)
- **Number**: Sequential within the scenario (`001`, `002` …)

All test results are reported in JSONL format. See [Test Results Format](/specs/test-results) for the specification.

---

*See also: [Interactive deep dive — Scenario-Driven + Test-First](/deep-dive/scenario-test-first) →*
