---
title: Change Management
description: The Delta change management mechanism — change proposals, impact analysis, delta merging, and archival.
---

The Delta change management specification defines how OpenLogos projects handle feature iterations and bug fixes after the initial development cycle. Every change starts as a proposal, gets reviewed, then merges back into main documents — ensuring traceability, auditability, and rollback capability.

## Core Principles

1. **Never modify main documents directly** — every change starts as a proposal in `logos/changes/`
2. **Impact analysis first** — the `proposal.md` must clearly scope the change's blast radius
3. **Propagate on demand** — not every change requires a full-chain update; only affected layers are updated
4. **Archive for history** — completed changes are archived, preserving a full audit trail

## Lifecycle States

Change management is activated when the project transitions from `initial` to `active` lifecycle (via `openlogos launch`). During the initial development phase, changes flow through the Phase progression without proposals.

| Lifecycle | Behavior |
|-----------|----------|
| `initial` | Follow Phase 1 → 2 → 3 progression freely, no proposals needed |
| `active` | All changes require a proposal via `openlogos change <slug>` before modifying code |

## Directory Structure

```
logos/
├── resources/                    # Main documents (current "source of truth")
│
└── changes/                      # Change proposal workspace
    ├── add-remember-me/          # An active change proposal
    │   ├── proposal.md           # Change description + impact analysis
    │   ├── tasks.md              # Implementation task checklist
    │   └── deltas/               # Delta files (incremental modifications)
    │       ├── prd/
    │       ├── api/
    │       ├── database/
    │       └── scenario/
    │
    └── archive/                  # Completed change history
        └── add-remember-me/
```

## Guard Mechanism

When a change proposal is active, OpenLogos writes a `logos/.openlogos-guard` lock file to track the active change. This file:

- **Exists** → AI may modify code, but only within the proposal's scope
- **Does not exist** → modifying source code is forbidden; run `openlogos change <slug>` first

The guard file is created by `openlogos change` and removed by `openlogos archive`.

## File Specifications

### proposal.md

The change description document. Must include:

```markdown
# Change Proposal: [Change Name]

## Reason for Change
[Why is this change needed? What requirement/feedback/bug triggered it?]

## Change Scope
- Affected requirements documents: [list]
- Affected feature specs: [list]
- Affected scenarios: [list]
- Affected APIs: [list]
- Affected DB tables: [list]

## Change Summary
[1-3 paragraphs describing what specifically changes]
```

### tasks.md

Implementation task checklist using structured section tags:

```markdown
# Implementation Tasks

## [delta] Spec Changes
- [ ] Output delta file to deltas/prd/1-product-requirements/ — Update requirements
- [ ] Output delta file to deltas/api/ — Update API YAML

## [code] Code Implementation
- [ ] Implement business logic in src/xxx
- [ ] Write corresponding tests
```

Section tag rules:
- `## [delta]` — delta document output tasks only. All checked → `ready-to-merge`
- `## [code]` — code implementation tasks only. All checked → `ready-to-verify`
- Both sections are optional: code-only proposals have only `[code]`, spec-only proposals have only `[delta]`
- No `[delta]` section → proposal skips directly to `ready-to-merge`
- Old format (no section tags) → falls back to global all-checked logic for backward compatibility

> **Note**: `openlogos verify` is a separate CLI step. Do not add verify/acceptance tasks to `tasks.md`.

### deltas/ Directory

Delta files use a tagged format to describe incremental modifications:

```markdown
## ADDED — [New Content Title]
[Complete new content]

## MODIFIED — [Modified Content Title]
[Complete modified content, replaces the same-named section in the main document]

## REMOVED — [Removed Content Title]
[Reason for removal]
```

The delta directory structure mirrors the main document directory. `openlogos merge` recursively scans subdirectories, preserving nested paths:

| Delta path | Corresponds to |
|-----------|----------------|
| `deltas/prd/` | `logos/resources/prd/` |
| `deltas/api/` | `logos/resources/api/` |
| `deltas/database/` | `logos/resources/database/` |
| `deltas/scenario/` | `logos/resources/scenario/` |
| `deltas/test/` | `logos/resources/test/` |

`prd/` subdirectories map directly:

| Delta path | Corresponds to |
|-----------|----------------|
| `deltas/prd/1-product-requirements/` | `logos/resources/prd/1-product-requirements/` |
| `deltas/prd/2-product-design/1-feature-specs/` | `logos/resources/prd/2-product-design/1-feature-specs/` |
| `deltas/prd/3-technical-plan/1-architecture/` | `logos/resources/prd/3-technical-plan/1-architecture/` |
| `deltas/prd/3-technical-plan/2-scenario-implementation/` | `logos/resources/prd/3-technical-plan/2-scenario-implementation/` |

## Change Workflow

```
1. Create change proposal (CLI)
   └── openlogos change {slug}
   └── Generates logos/changes/{slug}/proposal.md + tasks.md + deltas/
   └── Writes logos/.openlogos-guard

2. AI-assisted proposal writing (change-writer Skill)
   └── AI analyzes impact scope, fills in proposal.md and tasks.md
   └── [delta] section: delta output tasks | [code] section: code tasks

3. Produce delta files per [delta] task
   └── For each completed task, write incremental changes to deltas/ subdirectories
   └── Check off each [delta] task when done → proposal_step: ready-to-merge

4. Generate merge instructions (CLI) [human confirmation point]
   └── openlogos merge {slug}
   └── Recursively scans deltas/, generates MERGE_PROMPT.md
   └── Writes MERGE_PROMPT_GENERATED marker → proposal_step: merge-generated

5. AI executes merge (merge-executor Skill)
   └── AI reads MERGE_PROMPT.md, merges each delta into logos/resources/
   └── Commits spec documents, then writes SPEC_MERGED marker
   └── proposal_step: coding

6. Implement code per [code] tasks
   └── Check off each [code] task when done → proposal_step: ready-to-verify

7. Run verification (CLI) [human confirmation point]
   └── openlogos verify
   └── Writes VERIFY_PASS or VERIFY_FAIL to proposal directory
   └── proposal_step: verify-passed or verify-failed

8. Archive change (CLI) [human confirmation point]
   └── openlogos archive {slug}
   └── Moves logos/changes/{slug}/ to logos/changes/archive/
```

**Human confirmation points**: `openlogos merge`, `openlogos verify`, `openlogos archive`, and `git push`. AI must not execute these without explicit user authorization.

## Change Propagation Rules

Not every change requires a full-chain update. The affected scope depends on the change type:

| Change Type | Minimum Update Scope | Description |
|------------|---------------------|-------------|
| Requirements-level | Full chain | Requirements changed — all downstream may be affected |
| Design-level | Prototypes + scenarios + API/DB + orchestration + code | Requirements unchanged, implementation approach adjusted |
| Interface-level | API/DB + orchestration + code | Design unchanged, interface details adjusted |
| Code-level fix | Code + re-verification | Bug fix, no design changes involved |

## MERGE_PROMPT.md Format

Auto-generated by `openlogos merge`, this instruction file tells AI how to apply deltas:

```markdown
# Merge Instruction

## Change Proposal
- Name: {slug}
- Directory: logos/changes/{slug}/

## Proposal Content
[Full content from proposal.md]

## Delta Files to Merge

### 1. {delta-relative-path}
- Delta file: `logos/changes/{slug}/deltas/{category}/{file}`
- Target directory: `logos/resources/{category}/`
- Action: Read ADDED / MODIFIED / REMOVED tags, merge into target main documents

## Execution Requirements
1. Process each delta file sequentially, report summary after each
2. For ADDED tags: Insert new content at the specified location
3. For MODIFIED tags: Replace the same-named section's content
4. For REMOVED tags: Delete the corresponding section
5. Maintain original formatting and style of main documents
6. Update "last updated" timestamps if present
7. After all changes, list the modification summary
8. Remind user to run `openlogos archive {slug}`
```

## Git Integration

- Each change proposal maps to a Git branch: `change/{change-name}`
- On branch merge, `logos/changes/{change-name}/` is moved to `logos/changes/archive/`
- Major changes are noted in the document header's "last updated" timestamp
- `logos/changes/archive/` provides complete change history

## CLI Commands

```bash
openlogos change add-remember-me   # Create change proposal
openlogos merge add-remember-me    # Generate merge instructions
openlogos archive add-remember-me  # Archive completed change
```

## Related Skills

| Skill | Role |
|-------|------|
| [`change-writer`](/skills/change-writer) | Used after `openlogos change` to fill in proposal.md and tasks.md |
| [`merge-executor`](/skills/merge-executor) | Used after `openlogos merge` to read MERGE_PROMPT.md and execute merges |
