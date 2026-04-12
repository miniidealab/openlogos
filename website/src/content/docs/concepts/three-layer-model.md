---
title: Three-Layer Progression Model
description: "WHY → WHAT → HOW: the structured progression that eliminates ambiguity in AI-assisted development."
---

The Three-Layer Model is the backbone of OpenLogos. Every project progresses through three phases — **WHY → WHAT → HOW** — where each phase's output becomes the next phase's input. Skip a layer and ambiguity grows exponentially; complete each layer and AI receives the precise context it needs.

## Phase 1 — WHY (Requirements)

Understand the problem before solving it. Who needs this? What pain does it solve? What does "done" look like?

**Key outputs:**

- User persona & pain point analysis (causal chains)
- Scenario identification with priority (`S01`, `S02` …)
- GIVEN/WHEN/THEN acceptance criteria per scenario
- "Won't do" list to bound scope

**Quality gate:** Every P0 scenario has acceptance criteria.

**Skill:** [`prd-writer`](/skills/prd-writer)

## Phase 2 — WHAT (Product Design)

Design the solution. For each scenario, define what users see, how they interact, and what state changes.

**Key outputs:**

- Information architecture & navigation
- Feature specifications per scenario
- HTML prototypes (AI-generated)
- UI-level GIVEN/WHEN/THEN (buttons, forms, states)

**Quality gate:** Every P0 scenario has interaction specs + prototype.

**Skill:** [`product-designer`](/skills/product-designer)

## Phase 3 — HOW (Implementation)

Build the solution in 6 precise steps. Scenario-driven, test-first. AI generates code with full context.

| Step | Activity | Skill |
|------|----------|-------|
| 0 | Architecture overview & tech stack | [`architecture-designer`](/skills/architecture-designer) |
| 1 | Scenario → Sequence diagram → APIs emerge | [`scenario-architect`](/skills/scenario-architect) |
| 2 | API specs (OpenAPI YAML) + DB schema | [`api-designer`](/skills/api-designer), [`db-designer`](/skills/db-designer) |
| 3 | Test case design (before code!) | [`test-writer`](/skills/test-writer), [`test-orchestrator`](/skills/test-orchestrator) |
| 4 | Business code + test code generation | [`code-implementor`](/skills/code-implementor), [`code-reviewer`](/skills/code-reviewer) (post-review) |
| 5 | `openlogos verify` → automated acceptance | — |

**Quality gate (Gate 3.5):** All tests pass, 100% design-time coverage, acceptance criteria traced.

## Phase detection

OpenLogos CLI and `AGENTS.md` automatically detect the current phase by scanning the `logos/resources/` directory:

```
logos/resources/prd/1-product-requirements/  → empty? → Phase 1
logos/resources/prd/2-product-design/        → empty? → Phase 2
logos/resources/prd/3-technical-plan/        → empty? → Phase 3 Step 0
logos/resources/api/                         → empty? → Phase 3 Step 2
logos/resources/test/                        → empty? → Phase 3 Step 3
```

When a developer asks AI "what should I do next?", the AI reads `AGENTS.md`, detects the phase, and suggests the specific next step.

## Not waterfall

Waterfall sequences **all requirements** before **any design** before **any code**. OpenLogos sequences per **scenario** — S01 can be in Phase 3 while S04 is still in Phase 1. The phases are a progression model, not a schedule.

## Why it matters for AI

When AI works without context, every decision is a guess. With 10 decisions per feature, that's 2^10 = 1,024 possible paths — most of them wrong. The three-layer model collapses this exponential space into one deliberate path by providing explicit, structured context at every stage.

---

*See also: [Interactive deep dive — WHY → WHAT → HOW](/deep-dive/three-layer-model) →*
