---
title: CLI Overview
description: Reference documentation for the OpenLogos command-line interface.
---

The `openlogos` CLI manages the project lifecycle — from initialization through phase progression, change management, and test verification.

## Installation

```bash
npm install -g @miniidealab/openlogos
```

Verify:

```bash
openlogos --version
# 0.5.6
```

## Global options

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show the help message |
| `--version`, `-v` | Show the version number |

## Command reference

### Project setup

| Command | Description |
|---------|-------------|
| [`init`](/cli/init) | Initialize a new OpenLogos project structure |
| [`sync`](/cli/sync) | Regenerate AI instruction files and Skills |
| [`status`](/cli/status) | Show project phase and suggest next steps |

### Verification & Launch

| Command | Description |
|---------|-------------|
| [`verify`](/cli/verify) | Verify test results against test case specs (Gate 3.5) |
| [`launch`](/cli/launch) | Activate change management after verification passes |

### Change management (Delta workflow)

| Command | Description |
|---------|-------------|
| [`change`](/cli/change) | Create a change proposal |
| [`merge`](/cli/merge) | Generate merge instructions for AI |
| [`archive`](/cli/archive) | Archive a completed change proposal |

## Project lifecycle

OpenLogos projects have two lifecycle states:

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  openlogos     Phase 1 → 2 → 3    openlogos     openlogos    │
│  init          (AI + Skills)       verify        launch       │
│  ────────► ┌──────────────────┐ ──────────► ──────────►       │
│            │   "initial"      │  Gate 3.5                     │
│            │ (No change       │   PASS                        │
│            │  proposals       │                               │
│            │  required)       │                               │
│            └──────────────────┘                               │
│                                                               │
│            ┌──────────────────┐                               │
│            │   "active"       │  ◄── openlogos change <slug>  │
│            │ (Change          │  ──► openlogos merge <slug>   │
│            │  proposals       │  ──► openlogos archive <slug> │
│            │  required)       │                               │
│            └──────────────────┘                               │
└───────────────────────────────────────────────────────────────┘
```

- **`initial`** — First development cycle. AI follows the phase progression (Phase 1 → 2 → 3) freely, without requiring change proposals. Ends with `openlogos verify` (Gate 3.5 must PASS).
- **`active`** — After `openlogos launch`. All modifications to existing documents must go through a change proposal (`change` → `merge` → `archive`).

## Phase progression

The development lifecycle progresses through **11 phases**. The `status` command tracks 9 of them by scanning `logos/resources/` directories; Phase 3-4 produces code in the project source tree and is validated indirectly through Phase 3-5 verification.

| Phase | Directory | Suggested AI prompt |
|-------|-----------|-------------------|
| Phase 1 · Requirements | `logos/resources/prd/1-product-requirements/` | "Help me write requirements" |
| Phase 2 · Product Design | `logos/resources/prd/2-product-design/` | "Do product design based on requirements" |
| Phase 3-0 · Architecture | `logos/resources/prd/3-technical-plan/1-architecture/` | "Help me design the technical architecture" |
| Phase 3-1 · Scenario Modeling | `logos/resources/prd/3-technical-plan/2-scenario-implementation/` | "Help me draw S01 sequence diagram" |
| Phase 3-2 · API Design | `logos/resources/api/` | "Help me design the API" |
| Phase 3-2 · DB Design | `logos/resources/database/` | "Help me design the database" |
| Phase 3-3a · Test Cases | `logos/resources/test/` | "Help me design test cases" |
| Phase 3-3b · Orchestration | `logos/resources/scenario/` | "Help me design orchestration tests" |
| Phase 3-4 · Code Implementation | *(project source tree)* | "Implement S01 based on the specs" |
| Phase 3-4 · Test Code | *(project source tree)* | "Write test code for S01 matching test-cases.md" |
| Phase 3-5 · Verification | `logos/resources/verify/` | Run tests, then `openlogos verify` |

Phase 3-4 is the core implementation step where AI generates **business code + test code** based on the full specification chain (sequence diagrams, API YAML, DB DDL, test case specs). Each batch of generated code must include an OpenLogos reporter that writes results to `logos/resources/verify/test-results.jsonl`. This phase does not have a dedicated `logos/resources/` directory because code output goes directly into the project source tree.

## Typical workflow

```bash
# 1. Initialize
openlogos init my-project
cd my-project

# 2. Work through phases with AI
#    Phase 1 → 2 → 3-0 → 3-1 → 3-2 → 3-3 (AI loads Skills automatically)
openlogos status          # check progress at any time

# 3. Implement code + test code (Phase 3-4)
#    AI generates business code and test code from full specification chain
#    Test reporter writes results to logos/resources/verify/test-results.jsonl

# 4. After all phases complete, verify test coverage
openlogos verify          # Gate 3.5 must PASS

# 5. Activate change management for future iterations
openlogos launch

# 6. For future changes, use the Delta workflow
openlogos change fix-redirect-bug
# ... AI fills proposal + creates deltas ...
openlogos merge fix-redirect-bug
# ... AI executes merge ...
openlogos archive fix-redirect-bug
```
