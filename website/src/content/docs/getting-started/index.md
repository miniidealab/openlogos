---
title: Introduction
description: What OpenLogos is, the problem it solves, how it works, and what's included.
---

**OpenLogos** is an open-source software engineering methodology for the AI era. It turns AI coding tools — Claude Code, OpenCode, Cursor, and others — from guessing machines into precision instruments by providing structured, explicit context at every stage of development.

## The problem: Vibe Coding

When you tell AI "build a login feature" without context, every decision is a guess: requirements, UI design, API structure, edge cases, error handling. With 10 decisions per feature, that's 2^10 = 1,024 possible paths — most of them wrong.

This is **Vibe Coding**: fast to start, painful to finish. Code gets generated quickly but is riddled with assumptions, missing edge cases, and undocumented decisions. Documentation drifts from reality. Tests are an afterthought. Changes break things nobody remembers.

## The solution: structured context

OpenLogos provides AI with the full picture — requirements, design, API specs, test cases — so it generates code that's correct, tested, and traceable. Same documents, same context, consistent results.

The methodology rests on **four core principles**:

### 1. WHY → WHAT → HOW (Three-Layer Progression)

Every project progresses through three phases where each phase's output feeds the next:

- **Phase 1 · WHY** — Requirements: personas, pain points, scenarios (`S01`, `S02` …), acceptance criteria
- **Phase 2 · WHAT** — Product Design: feature specs, interaction flows, HTML prototypes
- **Phase 3 · HOW** — Implementation: architecture → sequence diagrams → API/DB → test cases → code → verify

Quality gates between phases prevent ambiguity from accumulating. [Learn more →](/concepts/three-layer-model)

### 2. Scenario-Driven + Test-First

Every feature is decomposed into scenarios. One scenario ID (`S01`) traces from the first requirement to the last line of verified code — no traceability matrix needed.

Tests are designed *before* code: unit tests, scenario tests, and orchestration tests. AI generates code against a precise, verifiable target — "pass these 12 test cases," not "build a login feature." [Learn more →](/concepts/scenario-driven)

### 3. Documents as Context

Every decision lives in a document inside the `logos/` directory — Markdown, YAML, JSON. Reviewable, reproducible, cumulative. AI reads the docs, not your mind.

`AGENTS.md` acts as the AI navigator: it detects the current phase, suggests the next step, and loads the right Skill automatically. [Learn more →](/concepts/documents-as-context)

### 4. Engineering Foundation

Not invented from scratch. Built on 40+ years of proven theory — BDD, TDD, DDD, Stage-Gate, Docs-as-Code — recompiled for AI execution. [Learn more →](/concepts/engineering-foundation)

## How it works

```
You + AI coding tool
        │
        ▼
   AGENTS.md        ← AI reads this first
        │
        ▼
   Detect phase     ← Scans logos/resources/
        │
        ▼
   Load Skill       ← e.g. prd-writer, api-designer
        │
        ▼
   Follow process   ← Skill provides step-by-step instructions
        │
        ▼
   Produce artifact ← requirements.md, api.yaml, tests, code
```

1. You run `openlogos init` to create the project structure
2. Open the project in your AI coding tool (Claude Code, OpenCode, Cursor, etc.)
3. AI reads `AGENTS.md`, detects the current phase, and loads the appropriate Skill
4. You collaborate with AI through each phase — it follows the Skill's structured process
5. Each phase produces artifacts that become context for the next phase
6. `openlogos verify` validates the final result against acceptance criteria

## AI Skills

Skills are platform-agnostic Markdown files (`SKILL.md`) that give AI operational instructions for each task. OpenLogos includes **13 built-in Skills**:

| Phase | Skills |
|-------|--------|
| **WHY** (Requirements) | `project-init`, `prd-writer` |
| **WHAT** (Design) | `product-designer` |
| **HOW** (Implementation) | `architecture-designer`, `scenario-architect`, `api-designer`, `db-designer`, `test-writer`, `test-orchestrator`, `code-implementor`, `code-reviewer` |
| **Cross-phase** | `change-writer`, `merge-executor` |

Skills work with any AI tool that can read project files. No vendor lock-in. [Full Skills Reference →](/skills)

## CLI

The `openlogos` CLI provides 8 commands for project lifecycle management:

| Command | Purpose |
|---------|---------|
| `init` | Initialize project structure |
| `sync` | Synchronize AGENTS.md with config |
| `status` | Show current phase and progress |
| `verify` | Validate test results against acceptance criteria (Gate 3.5) |
| `launch` | Activate change management after verification passes |
| `change` | Create a change proposal (delta) |
| `merge` | Merge approved changes into main artifacts |
| `archive` | Archive completed change proposals |

[Full CLI Reference →](/cli)

## Delta change workflow

After the initial build, every iteration follows a structured change process:

1. `openlogos change <slug>` — create a proposal with impact analysis
2. Write `proposal.md` (what changed and why) and `tasks.md` (phase-based checklist)
3. Produce delta files for affected artifacts
4. `openlogos merge` — apply deltas to main artifacts
5. Implement code + run tests
6. `openlogos archive` — close the proposal

The key insight: **impact analysis evaluates the ripple effect across the entire artifact chain** — requirements, design, API, DB, tests, code. No artifact falls out of sync. This is what separates structured iteration from "fix the code and forget the docs."

## Project structure

```
logos/
├── logos.config.json         # Project configuration
├── logos-project.yaml        # AI collaboration index
├── resources/                # All phase artifacts
│   ├── prd/                  # Requirements → Design → Technical plan
│   ├── api/                  # OpenAPI YAML specs
│   ├── database/             # SQL DDL / schema
│   ├── test/                 # Test case documents
│   ├── scenario/             # API orchestration tests
│   └── verify/               # Acceptance reports
├── changes/                  # Delta change proposals + archive
├── skills/                   # AI Skills (SKILL.md per skill)
└── spec/                     # Methodology specifications
```

[Full Project Structure →](/specs/project-structure)

## Platform support

OpenLogos is tool-agnostic. Built-in integration support for:

| Platform | Integration mechanism |
|----------|----------------------|
| **Claude Code** | Native `.claude/` plugin system |
| **OpenCode** | `hooks/` and command integration |
| **Cursor** | `.cursor/rules/` auto-attached rules |
| **Other tools** | `AGENTS.md` as universal entry point |

## Next steps

- **[Quick Start](/getting-started/quick-start)** — Install and create your first project in under 10 minutes
- **[First AI Collaboration](/getting-started/first-collaboration)** — Walk through a complete development session
- **[Tour](/tour)** — See OpenLogos applied to real projects (FlowTask + Money-Log)
