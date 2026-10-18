---
title: CLI Overview
description: Reference documentation for the OpenLogos command-line interface.
---

The `openlogos` CLI manages the project lifecycle — from initialization through phase progression, change management, and test verification.

## Installation

```bash
npm install -g @miniidealab/openlogos@latest
```

Verify:

```bash
openlogos --version
# 0.16.7
```

After upgrading the CLI, run `openlogos sync` in each existing project to refresh its guard, hooks and Skills.

## Global options

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show the help message |
| `--version`, `-v` | Show the version number |
| `--format json` | Structured JSON output (supported by most read and gate commands, e.g. `status`, `next`, `verify`, `merge`, `change-lint`, `impact`, `env`, `deploy`, `approve`) |

Apart from `init` (and `detect`, which also works elsewhere), commands must be run from the project root (the directory containing `logos/logos.config.json`).

## Command reference

### Project setup & navigation

| Command | Description |
|---------|-------------|
| [`init`](/cli/init) | Initialize a new OpenLogos project structure |
| [`adopt`](/cli/adopt) | Onboard an existing project (bootstrap: adopted) |
| [`sync`](/cli/sync) | Regenerate AI instruction files, guard, hooks and Skills from the current config |
| [`status`](/cli/status) | Show project phase, active proposal step and suggestions |
| [`next`](/cli/next) | Show the single most actionable next step (`--auto` for full-auto) |
| [`watch`](/cli/watch) | Stream live derived dev-flow state (read-only) |
| [`flow show`](/cli/flow-show) | Show the built-in or overlay-resolved dev-flow orchestration |
| [`detect`](/cli/detect) | Show CLI version and project detection information |
| [`index`](/cli/index-command) | Generate an AI-ready prompt to rebuild the `logos-project.yaml` resource index |
| [`module`](/cli/module) | Manage project modules (list / add / rename / remove / set-product-type) |
| [`feature list` / `feature-backfill`](/cli/feature) | List feature groups; generate a prompt to backfill them |

### Verification & launch

| Command | Description |
|---------|-------------|
| [`verify`](/cli/verify) | Verify test results against test case specs (Gate 3.6) |
| [`deploy-done`](/cli/deploy-done) | Record controlled deployment completion (Gate 3.7) |
| [`smoke`](/cli/smoke) | Verify post-deployment health against smoke specs (Gate 3.8) |
| [`launch`](/cli/launch) | Activate change management after verification passes |

### Environments & deployment

These commands are opt-in: they only apply once the project has a `logos/environments.yaml` registry (see [Environment Registry](/specs/environments)).

| Command | Description |
|---------|-------------|
| [`env list` / `env show` / `env check`](/cli/env) | List and inspect registered environments; validate the registry (read-only) |
| [`deploy`](/cli/deploy) | Run the deployment configured for an environment (script / ci / agent), roll back, dry-run |
| [`approve`](/cli/approve) | Approve one commit for an environment that requires approval (human-only) |

### Change management (Delta workflow)

| Command | Description |
|---------|-------------|
| [`change`](/cli/change) | Create a change proposal and set the active-change guard |
| [`change-lint`](/cli/change-lint) | Read-only delivery check of proposal, tasks and deltas (L0–L9) |
| [`merge`](/cli/merge) | Merge spec deltas into the main documents in one atomic call; amend an already-merged proposal |
| [`slice plan`](/cli/slice) | Write `[code]` slices and `TEST_SLICE_MANIFEST.json` from `slices.json` |
| [`archive`](/cli/archive) | Archive a completed change proposal and release the guard |

### Spec checks, CI & protection scope

| Command | Description |
|---------|-------------|
| [`lint-specs`](/cli/lint-specs) | Read-only structural check of test specs (duplicate IDs / table columns / ID format) |
| [`impact`](/cli/impact) | Classify a git change range as lifecycle-only bookkeeping (for CI) |
| [`ignore` / `exempt`](/cli/ignore-exempt) | Manage paths kept out of version control, and committed paths that do not need a proposal (`add` / `remove` need host approval) |

## Project lifecycle

OpenLogos projects have two lifecycle states:

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  openlogos     Phase 1 → 2 → 3    openlogos     openlogos    │
│  init          (AI + Skills)       verify        launch       │
│  ────────► ┌──────────────────┐ ──────────► ──────────►       │
│            │   "initial"      │  Gate 3.6                     │
│            │ (No change       │   PASS                        │
│            │  proposals       │                               │
│            │  required)       │                               │
│            └──────────────────┘                               │
│                                                               │
│            ┌──────────────────┐                               │
│            │   "launched"     │  ◄── openlogos change <slug>  │
│            │ (Change          │  ──► openlogos merge <slug>   │
│            │  proposals       │  ──► openlogos archive <slug> │
│            │  required)       │                               │
│            └──────────────────┘                               │
└───────────────────────────────────────────────────────────────┘
```

- **`initial`** — First development cycle. AI follows the phase progression (Phase 1 → 2 → 3) freely, without requiring change proposals. Ends with `openlogos verify` (Gate 3.6 must PASS).
- **`launched`** — After `openlogos launch`. All modifications to existing documents must go through a change proposal (`change` → `merge` → `archive`).

## Phase progression

The development lifecycle progresses through **13 phases**. The `status` command tracks 11 of them by scanning `logos/resources/` directories; Phase 3-5 produces code in the project source tree and is validated indirectly through Phase 3-6 verification.

| Phase | Directory | Suggested AI prompt |
|-------|-----------|-------------------|
| Phase 1 · Requirements | `logos/resources/prd/1-product-requirements/` | "Help me write requirements" |
| Phase 2 · Product Design | `logos/resources/prd/2-product-design/` | "Do product design based on requirements" |
| Phase 3-0 · Architecture | `logos/resources/prd/3-technical-plan/1-architecture/` | "Help me design the technical architecture" |
| Phase 3-1 · Scenario Modeling | `logos/resources/prd/3-technical-plan/2-scenario-implementation/` | "Help me draw S01 sequence diagram" |
| Phase 3-2 · API Design | `logos/resources/api/` | "Help me design the API" |
| Phase 3-2 · DB Design | `logos/resources/database/` | "Help me design the database" |
| Phase 3-3 · Deployment Plan | `logos/resources/prd/3-technical-plan/3-deployment/` | "Help me design the deployment plan" |
| Phase 3-4a · Test Cases | `logos/resources/test/` | "Help me design test cases" |
| Phase 3-4b · Orchestration | `logos/resources/scenario/` | "Help me design orchestration tests" |
| Phase 3-5 · Code Implementation | *(project source tree)* | "Implement S01 based on the specs" |
| Phase 3-6 · Verification | `logos/resources/verify/` | Run tests, then `openlogos verify` |
| Phase 3-7 · Deployment Execution | *(deployment report)* | Execute deployment with human authorization |
| Phase 3-8 · Smoke Test | `logos/resources/verify/smoke-report.md` | `openlogos smoke` after deployment |

Phase 3-5 is the core implementation step where AI generates **business code + test code** based on the full specification chain (sequence diagrams, API YAML, DB DDL, test case specs). Each batch of generated code must include an OpenLogos reporter that writes results to `logos/resources/verify/test-results.jsonl`. This phase does not have a dedicated `logos/resources/` directory because code output goes directly into the project source tree.

## Typical workflow

```bash
# 1. Initialize
openlogos init my-project
cd my-project

# 2. Work through phases with AI
#    Phase 1 → 2 → 3-0 → 3-1 → 3-2 → 3-3 (AI loads Skills automatically)
openlogos status          # check progress at any time
openlogos next            # ask for the single next action

# 3. Implement code + test code (Phase 3-5)
#    AI generates business code and test code from full specification chain
#    Test reporter writes results to logos/resources/verify/test-results.jsonl

# 4. After all phases complete, verify test coverage
openlogos verify          # Gate 3.6 must PASS

# 5. Activate change management for future iterations
openlogos launch

# 6. For future changes, use the Delta workflow
openlogos change fix-redirect-bug
# ... AI fills proposal + tasks, then writes deltas ...
openlogos change-lint                      # must exit 0 before handing over
openlogos merge fix-redirect-bug           # one atomic call, writes SPEC_MERGED
openlogos slice plan --file slices.json    # slice-planner writes [code] slices
# ... AI implements code + tests ...
openlogos verify                           # Gate 3.6
openlogos archive fix-redirect-bug
```

In semi-auto mode, `merge`, `verify`, deployment, `smoke`, `archive` and `git push` are run only after you explicitly authorize them; `openlogos next --auto` grants a standing authorization for the whole chain (see [`next`](/cli/next)).
