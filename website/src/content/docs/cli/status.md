---
title: "openlogos status"
description: Display current project phase, deliverables, active change proposals, and suggested next steps.
---

Show a dashboard of all 9 phases with completion status, list active change proposals, and suggest the next action.

## Synopsis

```bash
openlogos status
```

No arguments or options. Must be run from the project root.

## What it checks

The command scans 9 directories in `logos/resources/` to determine phase completion. A phase is **done** when its directory contains at least one non-`.gitkeep` file.

| Phase | Directory scanned |
|-------|-------------------|
| Phase 1 · Requirements | `logos/resources/prd/1-product-requirements/` |
| Phase 2 · Product Design | `logos/resources/prd/2-product-design/` |
| Phase 3-0 · Architecture | `logos/resources/prd/3-technical-plan/1-architecture/` |
| Phase 3-1 · Scenario Modeling | `logos/resources/prd/3-technical-plan/2-scenario-implementation/` |
| Phase 3-2 · API Design | `logos/resources/api/` |
| Phase 3-2 · DB Design | `logos/resources/database/` |
| Phase 3-3a · Test Cases | `logos/resources/test/` |
| Phase 3-3b · Orchestration | `logos/resources/scenario/` |
| Phase 3-5 · Verification | `logos/resources/verify/` |

**Note:** Phase 3-4 (Code Implementation + Test Code) is not tracked as a separate directory because code output goes into the project source tree. Its completion is validated indirectly through Phase 3-5 — when tests pass and `openlogos verify` reports Gate 3.5 PASS, Phase 3-4 is implicitly confirmed.

It also scans `logos/changes/` for active change proposals (excluding `archive/`).

## Example output (in progress)

```
📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · Requirements (WHY)
     └─ 01-requirements.md
✅  Phase 2 · Product Design (WHAT)
     └─ 1-feature-specs/01-feature-specs.md
     └─ 2-page-design/01-homepage-prototype.html
🔲  Phase 3-0 · Architecture
🔲  Phase 3-1 · Scenario Modeling
🔲  Phase 3-2 · API Design
🔲  Phase 3-2 · Database Design
🔲  Phase 3-3a · Test Case Design (Unit + Scenario)
🔲  Phase 3-3b · API Orchestration Tests
🔲  Phase 3-4 · Code Implementation + Test Code
🔲  Phase 3-5 · Test Acceptance (verify)
──────────────────────────────────────────────────

💡 Suggested next step: Phase 3-0 · Architecture
   → Tell AI: "Help me design the technical architecture"
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
✅  Phase 3-3a · Test Case Design
     └─ ...
✅  Phase 3-3b · API Orchestration Tests
     └─ ...
✅  Phase 3-4 · Code Implementation + Test Code
     └─ (validated via Phase 3-5)
✅  Phase 3-5 · Test Acceptance (verify)
     └─ acceptance-report.md
──────────────────────────────────────────────────

🎉 All phases complete! Run `openlogos verify` to check test acceptance.
   → Run `openlogos launch` to activate change management for future iterations.
```

## Active change proposals

When the lifecycle is `active` and there are open proposals in `logos/changes/`, they are displayed:

```
📝 Active Change Proposals
     └─ fix-redirect-bug (proposal.md ✓ | tasks.md ✓ | deltas: 3 files)
     └─ add-analytics-export (proposal.md ✓ | tasks.md ✗ | deltas: 0 files)
──────────────────────────────────────────────────
```

Each proposal shows:
- Whether `proposal.md` exists (✓/✗)
- Whether `tasks.md` exists (✓/✗)
- Number of delta files in `deltas/`

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `logos/logos.config.json not found` | Not in project root | `cd` to project root, or run `openlogos init` first |

## Related commands

- [`init`](/cli/init) — Create the project structure that `status` checks
- [`launch`](/cli/launch) — Activate change management (suggested when all phases are done)
- [`verify`](/cli/verify) — Run the Phase 3-5 verification check
