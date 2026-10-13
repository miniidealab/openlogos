---
title: "openlogos status"
description: Display current project phase, deliverables, active change proposals, and suggested next steps.
---

Show a dashboard of every phase with its completion status, list active change proposals, and suggest the next action. In multi-module projects, also shows per-module phase progress.

## Synopsis

```bash
openlogos status [--module <id>] [--format json]
```

Must be run from the project root.

## Options

| Option | Description |
|--------|-------------|
| `--module <id>` | Filter output to a single module. Shows only that module's phase progress and suggestion. |
| `--format json` | Output structured JSON instead of human-readable text. |

## What it checks

The command scans 11 directories in `logos/resources/` to determine phase completion.

**Single-module projects** — a phase is **done** when its directory contains at least one non-`.gitkeep` file.

**Multi-module projects** — phase completion is module-aware:
- **Scenario phases** (`phase.3-1`, `phase.3-4a`): done when every scenario belonging to the module has a matching `<moduleId>-SXX-*.md` file.
- **All other phases**: done when the directory contains at least one file with a `<moduleId>-` prefix (e.g., `admin-01-requirements.md`). Files belonging to other modules are ignored.

| Phase | Directory scanned |
|-------|-------------------|
| Phase 1 · Requirements | `logos/resources/prd/1-product-requirements/` |
| Phase 2 · Product Design | `logos/resources/prd/2-product-design/` |
| Phase 3-0 · Architecture | `logos/resources/prd/3-technical-plan/1-architecture/` |
| Phase 3-1 · Scenario Modeling | `logos/resources/prd/3-technical-plan/2-scenario-implementation/` |
| Phase 3-2 · API Design | `logos/resources/api/` |
| Phase 3-2 · DB Design | `logos/resources/database/` |
| Phase 3-3 · Deployment Plan | `logos/resources/prd/3-technical-plan/3-deployment/` |
| Phase 3-4a · Test Cases | `logos/resources/test/` |
| Phase 3-4b · Orchestration | `logos/resources/scenario/` |
| Phase 3-6 · Verification | `logos/resources/verify/` |
| Phase 3-8 · Smoke Test | `logos/resources/verify/smoke-report.md` |

**Note:** Phase 3-5 (Code Implementation + Test Code) is not tracked as a separate directory because code output goes into the project source tree. Its completion is validated indirectly through Phase 3-6 — when tests pass and `openlogos verify` reports Gate 3.6 PASS, Phase 3-5 is implicitly confirmed. Phase 3-7 (Deployment Execution) is tracked via the deployment report.

It also scans `logos/changes/` for active change proposals (excluding `archive/`).

## Example output (in progress)

```
📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · Requirements (WHY)
     └─ core-01-requirements.md
✅  Phase 2 · Product Design (WHAT)
     └─ 1-feature-specs/core-01-feature-specs.md
🔲  Phase 3-0 · Architecture
🔲  Phase 3-1 · Scenario Modeling
🔲  Phase 3-2 · API Design
🔲  Phase 3-2 · Database Design
🔲  Phase 3-3 · Deployment Plan
🔲  Phase 3-4a · Test Case Design (Unit + Scenario)
🔲  Phase 3-4b · API Orchestration Tests
🔲  Phase 3-5 · Code Implementation
🔲  Phase 3-6 · Test Acceptance (verify)
──────────────────────────────────────────────────

🧩 Modules

  🔄  core (Core)  [initial → Phase 3-0 · Architecture]
       💡 Tell AI: "Help me design the technical architecture"

💡 Suggested next step: Phase 3-0 · Architecture
   → Tell AI: "Help me design the technical architecture"
```

## Example output (multi-module)

When multiple modules are registered, each module's phase progress is shown independently:

```
📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · Requirements (WHY)
✅  Phase 2 · Product Design (WHAT)
✅  Phase 3-0 · Architecture
...
──────────────────────────────────────────────────

🧩 Modules

  ✅  core (Core)  [launched]
       💡 Run openlogos change <slug> to create a new change proposal
  🔄  admin (Admin)  [initial → Phase 1 · Requirements (WHY)]
       💡 Tell AI: "Help me write requirements"
```

Use `--module admin` to focus on a single module:

```bash
openlogos status --module admin
```

```
🧩 Modules

  🔄  admin (Admin)  [initial → Phase 1 · Requirements (WHY)]
       💡 Tell AI: "Help me write requirements"
```

## Example output (all done)

```
📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · Requirements (WHY)
     └─ 01-requirements.md
✅  Phase 2 · Product Design (WHAT)
     └─ ...
✅  Phase 3-0 · Architecture
     └─ 01-architecture-overview.md
✅  Phase 3-1 · Scenario Modeling
     └─ ...
✅  Phase 3-2 · API Design
     └─ openapi.yaml
✅  Phase 3-2 · Database Design
     └─ schema.sql
✅  Phase 3-3 · Deployment Plan
     └─ ...
✅  Phase 3-4a · Test Case Design (Unit + Scenario)
     └─ ...
✅  Phase 3-4b · API Orchestration Tests
     └─ ...
✅  Phase 3-5 · Code Implementation
     └─ (validated via Phase 3-6)
✅  Phase 3-6 · Test Acceptance (verify)
     └─ acceptance-report.md
──────────────────────────────────────────────────

🎉 All phases complete! Run `openlogos verify` to check test acceptance.
   → Run `openlogos launch` to activate change management for future iterations.
```

## Active change proposals

When the lifecycle is `launched` and there are open proposals in `logos/changes/`, the proposal step is shown:

```
📝 Active Change Proposals
     └─ fix-redirect-bug (proposal.md ✓ | tasks.md ✓ | deltas: 3 files)
──────────────────────────────────────────────────
```

### Proposal steps

The proposal step tracks where a change proposal is in its lifecycle:

| Step | Meaning |
|------|---------|
| `writing` | `proposal.md` or `tasks.md` is missing, or still fails the plan-package check (template placeholders, missing sections) |
| `ready-to-delta` | Plan complete; waiting at the `plan-exit` gate (approve the plan before writing deltas) |
| `delta-writing` | Plan approved; `[delta]` section tasks not yet all checked |
| `ready-to-merge` | All `[delta]` tasks checked; waiting at `spec-exit` — explicitly request `openlogos merge <slug>` |
| `spec-complete-required` | No `[delta]` but code is required — run the no-delta `openlogos merge <slug>` to write `SPEC_MERGED` first |
| `test-id-required` | Specs merged, but no real `UT-*` / `ST-*` / `SMOKE-*` IDs to slice against yet |
| `ready-to-implement` | Specs merged; `[code]` slices not planned yet, or planned but waiting at `slice-exit` for approval |
| `coding` | Slices approved (`SLICES_APPROVED`); `[code]` tasks not yet all checked |
| `ready-to-verify` | All `[code]` tasks checked (or no `[code]` section) — explicitly request `openlogos verify` |
| `verify-passed` | `openlogos verify` passed (`VERIFY_PASS`) and no deployment is required |
| `verify-failed` | `openlogos verify` failed (`VERIFY_FAIL`) |
| `ready-to-deploy` | Verify passed and the proposal requires deployment — deployment needs explicit human authorization |
| `deploy-done` | Deployment recorded with `openlogos deploy-done`; no smoke required |
| `ready-to-smoke` | Deployed; explicitly request `openlogos smoke` |
| `smoke-passed` / `smoke-failed` | `openlogos smoke` result (`SMOKE_PASS` / `SMOKE_FAIL`) |
| `merge-generated` | Legacy only: shown when a proposal directory still carries a pre-0.15 merge marker and `SPEC_MERGED` is absent. Current `openlogos merge` never produces this step; run `openlogos merge <slug>` to finish the merge |

`merge` is a single atomic call, so there is no intermediate "merge in progress" step: a proposal goes straight from `ready-to-merge` (or `spec-complete-required`) to `test-id-required` / `ready-to-implement` once `SPEC_MERGED` exists.

### Incremental amendment projection (`spec_amend`)

Once a proposal has `SPEC_MERGED`, `openlogos status --format json` adds a read-only `modules[].active_change.spec_amend` object (absent before merge):

| Field | Meaning |
|-------|---------|
| `merged_delta_digest` / `current_delta_digest` | Digest of the deltas at the last merge vs. now |
| `pending` | `true` when the deltas changed since the last merge — rerunning `openlogos merge <slug>` will amend (`result:"amended"`). `null` when no merge baseline exists, which is "cannot tell", not `false` |
| `blocked_reason` | Why an amendment would be refused: `drift`, `baseline-missing`, `baseline-unreadable`, `create-withdraw`, `prototype-changed`; otherwise `null` |
| `amend_count` | How many amendments have been applied |

The projection never writes files and does not change `proposal_step`. See [`openlogos merge`](/cli/merge#amending-an-already-merged-proposal).

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `logos/logos.config.json not found` | Not in project root | `cd` to project root, or run `openlogos init` first |
| `Module 'admin' not found in logos-project.yaml` | `--module` value doesn't match any registered module | Run `openlogos module list` to see valid module IDs |

## Related commands

- [`init`](/cli/init) — Create the project structure that `status` checks
- [`module`](/cli/module) — Manage modules (list / add / rename / remove)
- [`launch`](/cli/launch) — Activate change management (suggested when all phases are done)
- [`verify`](/cli/verify) — Run Gate 3.6 acceptance (Phase 3-6)
