---
title: "openlogos change"
description: Create a structured change proposal for iterative updates to an existing project.
---

Scaffold a new change proposal directory with `proposal.md`, `tasks.md`, and `deltas/` subdirectories. This is the entry point for the Delta workflow.

## Synopsis

```bash
openlogos change <slug>
```

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `slug` | **Yes** | A kebab-case identifier for the change (e.g., `fix-redirect-bug`, `add-remember-me`) |

## What it creates

```
logos/changes/<slug>/
├── proposal.md          # Change proposal template
├── tasks.md             # Implementation task checklist
├── deltas/
│   ├── prd/             # Delta files for requirements/design docs
│   ├── api/             # Delta files for API specs
│   ├── database/        # Delta files for DB schema
│   └── scenario/        # Delta files for orchestration tests
```

Additionally creates `logos/.openlogos-guard` — a JSON file that records the active change:

```json
{
  "activeChange": "fix-redirect-bug",
  "createdAt": "2026-04-10T12:00:00.000Z"
}
```

The guard file is used by AI instructions to enforce that code changes stay within the proposal scope.

## Generated templates

### proposal.md

```markdown
# Change Proposal: fix-redirect-bug

## Reason
[Why is this change needed? Which requirement/feedback/bug triggered it?]

## Change Type
[Requirements / Design / Interface / Code]

## Scope
- Affected requirements: [list]
- Affected feature specs: [list]
- Affected scenarios: [list]
- Affected APIs: [list]
- Affected DB tables: [list]
- Affected orchestration tests: [list]

## Summary
[Describe what will change in 1-3 paragraphs]
```

### tasks.md

```markdown
# Implementation Tasks

## Phase 1: Document Changes
- [ ] Update requirements scenarios and acceptance criteria
- [ ] Update product design feature specs

## Phase 2: Design Changes
- [ ] Update prototypes
- [ ] Update scenario sequence diagrams
- [ ] Update API YAML
- [ ] Update DB DDL

## Phase 3: Orchestration & Code
- [ ] Update API orchestration test cases
- [ ] Implement code changes
- [ ] Deploy to test environment
- [ ] Run orchestration acceptance
```

## Example output

```
Creating change proposal: fix-redirect-bug

  ✓ logos/changes/fix-redirect-bug/proposal.md
  ✓ logos/changes/fix-redirect-bug/tasks.md
  ✓ logos/changes/fix-redirect-bug/deltas/
  ✓ logos/.openlogos-guard

Change proposal created. Next steps:
  1. Tell AI: "Help me fill in change proposal fix-redirect-bug"
  2. AI will analyze impact and fill in proposal.md + tasks.md
  3. Then work through tasks.md, putting deltas in deltas/
  4. When done, run `openlogos merge fix-redirect-bug` to generate merge instructions
```

## The Delta workflow

```
openlogos change <slug>
       │
       ▼
  AI fills proposal.md + tasks.md (impact analysis)
       │
       ▼
  AI creates delta files in deltas/ (ADDED/MODIFIED/REMOVED markers)
       │
       ▼
openlogos merge <slug>  →  generates MERGE_PROMPT.md
       │
       ▼
  AI reads MERGE_PROMPT.md and applies changes to main documents
       │
       ▼
openlogos archive <slug>  →  moves to archive/
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Missing change proposal name` | No slug provided | Provide a slug: `openlogos change add-remember-me` |
| `Change proposal 'X' already exists` | A proposal with the same slug is already in `logos/changes/` | Choose a different slug, or archive the existing one first |
| `logos/logos.config.json not found` | Not in project root | `cd` to project root |

## Related commands

- [`merge`](/cli/merge) — Next step: generate merge instructions after delta files are ready
- [`archive`](/cli/archive) — Final step: archive the completed proposal
- [`launch`](/cli/launch) — Activate change management (must be done before `change` is enforced)
