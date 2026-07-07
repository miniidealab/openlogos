---
title: change-writer
description: Write change proposals with impact analysis following the Delta workflow.
---

Assist in writing change proposals — analyze the scope of change impact, generate a structured `proposal.md` and a phase-based `tasks.md`, ensuring changes are traceable and impact is controllable.

## Phase & Trigger

- **Phase**: Cross-phase (Delta workflow)
- **Trigger conditions**:
  - User has run `openlogos change <slug>` and wants help filling in the proposal
  - User describes a need to modify, add, or remove a scenario/feature
  - User mentions "change proposal", "iteration", "requirement change"

## Prerequisites

1. Project is initialized (`logos/logos.config.json` exists)
2. Change proposal directory exists (`logos/changes/<slug>/`)
3. Main documents in `logos/resources/` are readable

If prerequisites are not met, the user must first run `openlogos change <slug>`.

## What It Does

1. Understand the user's intended change (what, why, which scenarios)
2. Scan existing documents in `logos/resources/` to identify the full affected scope
3. Determine the change type based on propagation rules
4. Generate a compliant `proposal.md`
5. Automatically break down `tasks.md` by change type
6. Provide a ready-to-use prompt for chain-driven execution

## Change Types and Propagation

| Change Type | Minimum Updates Required |
|-------------|------------------------|
| Requirement-level | Full chain: Requirements → Design → Architecture → API/DB → Tests → Code |
| Design-level | Prototypes + Scenarios + API/DB + Tests + Code |
| Interface-level | API/DB + Tests + Code |
| Code-level fix | Code + Re-verification |

## Impact Analysis Scope

The Skill scans all document layers to identify affected artifacts:

1. **Requirement documents** (`prd/1-product-requirements/`) — scenario definitions
2. **Product design** (`prd/2-product-design/`) — feature specs and prototypes
3. **Technical plans** (`prd/3-technical-plan/`) — sequence diagrams
4. **API documents** (`api/`) — affected endpoints
5. **DB documents** (`database/`) — affected table structures
6. **Test cases** (`test/`) — affected test cases
7. **Orchestration tests** (`scenario/`) — affected orchestration files

## Generated Files

### proposal.md

```markdown
# Change Proposal: [Change Name]

## Reason for Change
## Change Type
## Change Scope
- Affected requirement documents: [list]
- Affected functional specs: [list]
- Affected business scenarios: [scenario ID list]
- Affected APIs: [endpoint list]
- Affected DB tables: [table list]
- Affected test cases: [list]

## Change Summary
```

### tasks.md

A structured checklist using section tags — only include sections relevant to the change:

```markdown
# Implementation Tasks

## [delta] Spec Changes
- [ ] Output delta file to deltas/prd/1-product-requirements/ — Update acceptance criteria for S0x
- [ ] Output delta file to deltas/prd/3-technical-plan/2-scenario-implementation/ — Update sequence diagram for S0x
- [ ] Output delta file to deltas/api/ — Update API YAML
- [ ] Validate API YAML (all special chars double-quoted)
- [ ] Output delta file to deltas/database/ — Update DB DDL

## [code] Code Implementation
- [ ] Implement code changes in src/xxx
- [ ] Write corresponding tests
```

Section tag rules:
- `## [delta]` — delta output tasks only. All checked → `ready-to-merge`
- `## [code]` — code implementation anchor only during planning. Real `[code]` slices are written later by `slice-planner`, after spec-complete.
- Code-only fixes: keep an empty `## [code]` section and no `[delta]` section. They do **not** skip directly to implementation; after plan approval, run no-delta `openlogos merge <slug>` so the CLI writes `SPEC_MERGED` with `type:"no_delta_spec_complete"`, then let `slice-planner` cut slices from merged specs + real test IDs.
- Keep delta tasks and code tasks strictly separated — never mix them

Do not fill `[code]` slice lines in `write-tasks`. Early slices are based on draft specs or placeholder tests and will be reset by the CLI on merge (`CODE_AUTORESET`). If the code change needs new or reused tests, list the real `UT-*` / `ST-*` / `SMOKE-*` IDs in the proposal or test delta before slice planning; otherwise `next/status` must stop at `test-id-required`.

## Chain-Driven Execution

After generating the proposal, the Skill provides a ready-to-use prompt so the user can kick off sequential task execution:

- **Multi-phase changes**: "Follow tasks.md and help me progressively update all affected documents for S0x"
- **Code-level fixes**: "Help me fix [issue] for S0x and re-verify"

The AI reads `tasks.md`, executes items sequentially, reports after each task, and prompts "Continue to the next item?"

## Outputs

| File | Location |
|------|----------|
| `proposal.md` | `logos/changes/<slug>/proposal.md` |
| `tasks.md` | `logos/changes/<slug>/tasks.md` |

## Best Practices

- **Overestimate the impact scope** — missing one link is more dangerous than double-checking
- **Change type determines workload** — help users understand before starting
- **Follow the process even for small changes** — "just one API line" may affect tests and code
- **tasks.md is the execution checklist** — check off items with `[x]` as they complete

## Related Skills

- After tasks complete: [`merge-executor`](/skills/merge-executor) — merge deltas into main documents
- After merge: Run `openlogos archive <slug>` to archive the proposal
