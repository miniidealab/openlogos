---
title: Workflow Specification
description: The three-layer progression model (WHY → WHAT → HOW), phase detection logic, and quality gates.
---

The Workflow specification defines how OpenLogos projects progress through three phases — **WHY → WHAT → HOW** — with scenarios as the unifying thread from requirements to verification.

## Core Design: Scenario Threading

**Scenarios are the anchor that runs through the entire development lifecycle.** The same scenario is progressively expanded across all three phases:

```
Scenario S01: Email Registration

Phase 1 (WHY)  → Who needs it? What pain point? What are normal/exception expectations?
Phase 2 (WHAT) → What pages does the user see? What's the interaction flow?
Phase 3 (HOW)  → What's the system call chain? API contracts? DB schema? How to test?
```

Scenario IDs (`S01`, `S02`...) are globally unique, defined in Phase 1 and carried through to Phase 3 verification. No separate traceability matrix is needed — **the scenario itself is the trace chain**.

## Phase Overview

```
Phase 1: WHY — Why are we building this?
├── User research → Pain point extraction → Scenario identification → Prioritization
├── Output: Requirements document (scenario-driven + GIVEN/WHEN/THEN acceptance criteria)
└── Quality gate → Gate 1

Phase 2: WHAT — What are we building?
├── Information architecture → Interaction refinement → Feature specs → HTML prototypes
├── Output: Product design docs + HTML prototypes (organized by scenario)
└── Quality gate → Gate 2

Phase 3: HOW — How do we build it?
├── Step 0: Architecture overview (system architecture, tech stack, deployment)
├── Step 1: Scenario → Sequence diagram → APIs emerge
├── Step 2: API spec design → DB schema derivation
├── Step 3: Test design (test-first)
│   ├── 3a: Unit test + scenario test case design (all projects)
│   └── 3b: API orchestration test design (API projects only)
├── Step 4: Code generation + test code (code-implementor Skill)
├── Step 5: Test verification (openlogos verify)
└── Quality gates → Gate 3.0 ~ Gate 3.5
```

## Scenario ID Convention

| Rule | Format | Example |
|------|--------|---------|
| Standard | `S{two digits}` | `S01`, `S02` |
| Sub-scenario | `S{id}.{sub}` | `S01.1`, `S01.2` |
| Scope | Globally unique per project lifecycle | — |

A scenario is not the same as a feature — one feature may involve multiple scenarios, and one scenario may span multiple features.

## Phase 1: WHY — Requirements

### Goal

Identify what problem to solve, define core business scenarios, and write business-level acceptance criteria for each.

### Activities

1. **User research** — Understand target users, pain points, usage contexts
2. **Pain point extraction** — Each pain point has a causal chain (cause → pain → consequence)
3. **Scenario identification** — Transform pain points into concrete user scenarios, assign IDs
4. **Prioritization** — Rank scenarios by priority (P0 / P1 / P2)
5. **Acceptance criteria** — Write GIVEN/WHEN/THEN for each core scenario

### Outputs

Requirements document stored in `logos/resources/prd/1-product-requirements/`:

- Product background and goals (positioning, core objectives, user personas)
- User pain point analysis (causal chain format)
- Core scenario definitions (scenario table + acceptance criteria per scenario)
- Constraints and boundaries (technical/resource constraints + "won't do" list)

### Scenario Definition Format (Phase 1 Granularity)

```markdown
### S01: Scenario Name

- **Trigger**: Who enters this scenario, under what conditions
- **User value**: What pain point it solves (trace to pain point ID)
- **Priority**: P0
- **Happy path**: [Natural language description of normal flow]

#### Acceptance Criteria

##### Normal: [Scenario name]
- **GIVEN** [Initial condition]
- **WHEN** [User action]
- **THEN** [Expected result]

##### Exception: [Exception scenario name]
- **GIVEN** [Initial condition]
- **WHEN** [Action] + [Exception trigger]
- **THEN** [Error handling behavior]
```

### Gate 1 Checklist

- [ ] Every pain point has a causal chain
- [ ] Core scenarios identified and numbered (`S01`, `S02`...)
- [ ] Every P0/P1 scenario has GIVEN/WHEN/THEN criteria (at least 1 normal + 1 exception)
- [ ] Target user persona is specific enough to describe a real person
- [ ] Scenario priorities are ranked
- [ ] "Won't do" list is explicit

## Phase 2: WHAT — Product Design

### Goal

Design the concrete solution. Using Phase 1 scenarios as the skeleton, refine interaction flows, page designs, and feature specs for each scenario.

### Activities

1. **Information architecture** — Product structure, navigation hierarchy, content organization
2. **Interaction refinement** — Complete page flows and interaction details per scenario
3. **Feature specs** — Detailed descriptions + UI-level GIVEN/WHEN/THEN
4. **HTML prototyping** — AI-generated HTML pages as product prototypes
5. **Design standards** — Global UI conventions

### Outputs

Stored in `logos/resources/prd/2-product-design/`:

- `1-feature-specs/` — Product design docs (information architecture + feature specs, organized by scenario)
- `2-page-design/` — HTML prototypes

### Scenario Expansion (Phase 2 Granularity)

Phase 2 adds interaction details on top of Phase 1 scenarios:

- Which pages/components are involved
- Page-to-page navigation logic
- Form fields and validation rules
- State displays (loading, empty, error)
- Finer GIVEN/WHEN/THEN (down to button and UI element level)

If a Phase 1 scenario is too large, it can be split into sub-scenarios (`S01.1`, `S01.2`) at this stage.

### Gate 2 Checklist

- [ ] Every P0/P1 scenario has detailed interaction specs + GIVEN/WHEN/THEN
- [ ] All core pages have HTML prototypes
- [ ] Exception states considered (error / empty / loading)
- [ ] Scenario IDs consistent with Phase 1 (sub-scenario splits allowed)

## Phase 3: HOW — Technical Implementation

### Step 0: Architecture Overview

Establish the project's technical global view before entering per-scenario implementation. This ensures all subsequent sequence diagrams, API designs, and code generation operate under consistent architectural constraints.

**Activities:**

1. **System architecture diagram** — Overall topology (frontend, backend, database, third-party services), system boundaries and interaction patterns
2. **Tech stack decisions** — Language, framework, database, deployment — each with rationale
3. **Deployment topology** — Dev / test / production environment plans
4. **Non-functional constraints** — Performance targets, security requirements, scalability, observability
5. **Update `logos-project.yaml`** — Write confirmed tech stack to the `tech_stack` field

**Output:** `logos/resources/prd/3-technical-plan/1-architecture/01-architecture-overview.md`

**Scaling strategy:**
- Simple projects (monolith + single DB): A paragraph + a simple diagram is sufficient
- Complex projects (microservices, multiple DBs, message queues): Detailed architecture decision records needed

**Gate 3.0**: Architecture document complete, tech stack confirmed and written to `logos-project.yaml`.

### Step 1: Scenario Modeling (Sequence Diagrams)

Expand Phase 1/2 scenarios into Mermaid sequence diagrams. Cross-system call arrows in the diagram are the APIs that need to be built. Participants should match the system components from Step 0.

**Sequence diagram rules:**
- Every arrow has a `Step N:` prefix
- Every arrow includes a one-line behavior description
- Participants are clearly labeled as system components
- Document title preserves scenario ID: `S01: Email Registration — Sequence Diagram`

**Gate 3.1**: All core scenario sequence diagrams complete, API endpoints clearly visible.

### Step 2: API Spec Design → DB Derivation

Based on API endpoints that emerged from sequence diagrams, design detailed specs (OpenAPI 3.0 YAML). Once API request/response structures are defined, DB table structures are naturally derived.

**Gate 3.2**: API YAML and DB DDL complete and mutually consistent.

### Step 3: Test Design (Test-First)

Before writing code, design the complete test system. Test design splits into two sub-steps covering the test pyramid:

#### Step 3a: Unit Test + Scenario Test Case Design (All Projects)

**Scope**: All project types (API services, CLI tools, frontend apps, libraries). Cannot be skipped.

Design two types of test cases per scenario:

- **Unit test cases** — Single function/method input-output correctness
  - Sources: API field constraints (type, format, length), DB constraints (UNIQUE, CHECK, NOT NULL), business rules, EX exception case error handling
  - Focus: Boundary values, invalid inputs, exception returns

- **Scenario test cases** — Complete scenario flow at the code level
  - Sources: Sequence diagram Step sequences (happy path), EX exception cases (exception paths), Phase 1/2 acceptance criteria
  - Focus: Cross-module call chain correctness, data passing between Steps, compensation/rollback on failure

**Output**: Test case spec documents (Markdown) in `logos/resources/test/`, one file per scenario (e.g., `S01-test-cases.md`).

**Gate 3.3a**: Unit and scenario test cases designed for core scenarios, covering all P0 happy paths + core EX exception paths.

#### Step 3b: API Orchestration Test Design (API Projects Only)

**Scope**: Projects involving APIs. Pure CLI tools, frontend libraries without APIs can skip this step.

Design API orchestration test cases per scenario:

- **Happy path orchestration**: Main path API call chain
- **Exception path orchestration**: `EX-{step}.{seq}` format
- **Boundary cases**: Valid but non-main-path variants

**Output**: Orchestration test files (JSON) in `logos/resources/scenario/`.

**Gate 3.3b**: Orchestration covers all happy paths + core exception paths.

### Step 4: Code Generation + Test Code

With full context available (prototypes + scenarios + API + DB + test cases + orchestration), AI-generated code quality is far superior to coding without context. Generate and verify scenario by scenario, driven by the [`code-implementor`](/skills/code-implementor) Skill.

Code generation includes:

- **Business code** — Implement step by step following the sequence diagram
- **Unit test code** — Based on Step 3a unit test case specs
- **Scenario test code** — Based on Step 3a scenario test case specs
- **OpenLogos reporter** — Embedded in test code, writes results to `logos/resources/verify/test-results.jsonl` (see [Test Results Format](/specs/test-results))

**Step 4 delivery standard (non-negotiable):**

- Business code only, without corresponding test code → **Step 4 incomplete**
- Test code only, without corresponding business code → **Step 4 incomplete**
- Delivery must include all three: business code + UT/ST test code + reporter

**Batch execution rules (batching allowed, each batch closed-loop):**

- Large tasks can be split by scenario or sub-module into multiple batches
- Each batch must form a minimum closed loop: **batch business code + batch tests + batch reporter functional**
- Before each batch, declare the UT/ST case IDs covered, ensuring traceability to `logos/resources/test/*.md`
- Deferring all tests to a final batch is not allowed

**Gate 3.4**: Code reviewed, unit tests pass, test environment deployed.

### Step 5: Test Verification

Run all tests to verify code, using `openlogos verify` for automated acceptance.

**Prerequisites for entering Step 5:**

- Only when Step 4 achieves complete delivery (business code + UT/ST test code + reporter) can Step 5 proceed
- If "business code only, no tests" or "test code missing reporter" is discovered, return to Step 4 first
- Step 5 does not write test code — its job is automated judgment of Step 4 deliverables

**Verification flow:**

1. AI embeds OpenLogos reporter in test code during Step 4 (see [Test Results Format](/specs/test-results))
2. User runs tests (`npm test`, `pytest`, etc.) → reporter writes each case result to `logos/resources/verify/test-results.jsonl`
3. User runs `openlogos verify` → CLI reads JSONL + case IDs from `logos/resources/test/*.md` → calculates acceptance result

**Three-tier acceptance judgment:**

| Metric | Definition |
|--------|-----------|
| Coverage | Case IDs in JSONL / total case IDs defined in test-cases.md |
| Pass rate | Cases with `status=pass` / total cases in JSONL |
| Requirements tracing (optional) | Whether test-cases.md coverage spans Phase 1 acceptance criteria |

**Acceptance outcomes:**

- All pass → generates `logos/resources/verify/acceptance-report.md`, terminal outputs PASS
- Failures or gaps → generates report listing issues, terminal outputs FAIL, exit code 1

**Gate 3.5**: `openlogos verify` outputs PASS (all cases pass + 100% coverage).

## Three-Level Scenario Expansion

The same scenario is progressively refined across three phases:

| Phase | Perspective | Focus | Acceptance Granularity |
|-------|------------|-------|----------------------|
| Phase 1 | Business | Who needs it? Why? What result? | Business behavior GIVEN/WHEN/THEN |
| Phase 2 | Interaction | What do they see? How do they interact? | UI element GIVEN/WHEN/THEN |
| Phase 3 | Technical | Call chain? API response? DB writes? | Three-layer tests (unit + scenario + orchestration) + `openlogos verify` |

Acceptance criteria refine layer by layer, becoming automatically executable in Phase 3 tests. Test results output via standardized JSONL format (see [Test Results Format](/specs/test-results)), and `openlogos verify` reads them to generate the acceptance report. No separate traceability matrix needed — **scenario IDs are the trace chain, case IDs are the acceptance anchors**.

## Iteration Rules

Feature iterations **must** follow the same layered workflow, using the Delta change management system (see [Change Management](/specs/change-management)). Skipping intermediate steps to modify code directly is not allowed.

Iterations may cause scenario changes: new scenarios, modified scenarios, or deprecated scenarios. All changes are managed through `logos/changes/` proposals. Once assigned, scenario IDs are never reused.
