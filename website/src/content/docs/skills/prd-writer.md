---
title: prd-writer
description: Write scenario-driven requirements documents with GIVEN/WHEN/THEN acceptance criteria.
---

Assist in writing scenario-driven requirements documents — starting from user pain points, identifying core business scenarios, and defining GIVEN/WHEN/THEN acceptance criteria for each scenario. Scenario numbers carry through all subsequent phases.

## Phase & Trigger

- **Phase**: Phase 1 — WHY (Requirements)
- **Trigger conditions**:
  - User requests writing a requirements document, PRD, or discusses product positioning
  - User mentions "Phase 1", "requirements layer", or "WHY"
  - The project is in the requirements analysis phase

## What It Does

1. Guide product positioning and target user profiling
2. Extract user pain points with causal chains (`P01`, `P02`...)
3. Identify and define business scenarios (`S01`, `S02`...) from pain points
4. Write GIVEN/WHEN/THEN acceptance criteria for each scenario
5. Prioritize scenarios and identify constraints
6. Generate the complete requirements document

## Execution Steps

### Step 1: Understand Product Positioning

Confirm one-line positioning, target user persona, and core objectives.

### Step 2: Extract User Pain Points

Each pain point has a causal chain: Because [reason] → leads to [pain point] → results in [consequence]. Pain points are numbered `P01`, `P02`... for scenario traceability.

### Step 3: Identify and Define Scenarios

Scenarios are **complete user action paths** — not single API calls. Each scenario describes who triggers it, through what steps, to achieve what business outcome. Scenarios are numbered `S01`, `S02`... and this number carries through Phase 2 and Phase 3.

#### Scenario Granularity Self-Check

Every scenario must pass 4 tests before proceeding:

1. **Single-API Test**: Can it be done with 1 API call? → Not a scenario, merge it
2. **CRUD Test**: Is it just Create/Read/Update/Delete of one entity? → Too fine-grained, reorganize by user goals
3. **Business Value Test**: Does the user gain real value after completion? → If just "data was written/read", merge it
4. **Step Count Test**: Does the main path contain ≥3 user-perceivable steps? → Fewer means too fine

### Step 4: Write Acceptance Criteria

Every P0/P1 scenario must have ≥1 normal + ≥1 exception acceptance criterion:

```markdown
##### Normal: Complete registration flow
- **GIVEN** the user has not registered and is on the registration page
- **WHEN** the user fills in a valid email and password (≥8 chars) and clicks "Sign Up"
- **THEN** the system creates an account, sends a verification email

##### Exception: Email already registered
- **GIVEN** the email test@example.com is already registered
- **WHEN** the user attempts to register with that email
- **THEN** the page displays "This email is already registered"
```

### Step 5: Identify Constraints and Boundaries

Technical constraints, resource constraints, and the "won't-do" list for this phase.

### Step 6: Assemble the Document

Standard structure: Product Background → Pain Points → Scenario Overview → Scenario Details → Constraints.

## Outputs

| File | Location |
|------|----------|
| Requirements document | `logos/resources/prd/1-product-requirements/` |
| Naming convention | `{sequence}-{english-name}.md` |

## Best Practices

- **Scenarios ≠ Features ≠ APIs** — a scenario is a complete user action path; a single feature may contain multiple scenarios
- **Once assigned, a scenario number is never reused** — even deprecated scenarios keep their numbers
- **If you cannot write GIVEN/WHEN/THEN, the scenario is not yet well thought out**
- **The "won't-do" list is the hardest to write** — restraint is the most important skill

## Related Skills

- Previous: [`project-init`](/skills/project-init) — initialize the project
- Next: [`product-designer`](/skills/product-designer) — create product design specs
