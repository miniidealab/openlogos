---
title: "openlogos archive"
description: Move a completed change proposal to the archive directory.
---

Move a finished change proposal from `logos/changes/<slug>/` to `logos/changes/archive/<slug>/`, and clean up the guard file if it matches.

## Synopsis

```bash
openlogos archive <slug>
```

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `slug` | **Yes** | The change proposal slug to archive |

## What it does

1. Moves `logos/changes/<slug>/` → `logos/changes/archive/<slug>/`
2. If `logos/.openlogos-guard` exists and its `activeChange` matches the slug, deletes the guard file
3. The archived proposal retains all files (proposal.md, tasks.md, deltas/, MERGE_PROMPT.md)

## Example output

```
  ✓ logos/.openlogos-guard removed

✓ Change proposal 'fix-redirect-bug' archived.
  logos/changes/fix-redirect-bug/ → logos/changes/archive/fix-redirect-bug/
```

## Archive structure

After archiving, the full proposal history is preserved:

```
logos/changes/archive/
└── fix-redirect-bug/
    ├── proposal.md
    ├── tasks.md
    ├── MERGE_PROMPT.md
    └── deltas/
        ├── prd/
        ├── api/
        ├── database/
        └── scenario/
```

This provides a complete audit trail of all changes made to the project.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Missing change proposal name` | No slug provided | Provide a slug: `openlogos archive fix-redirect-bug` |
| `Change proposal 'X' not found` | No directory at `logos/changes/<slug>/` | Check spelling — maybe already archived? |
| `Archive 'X' already exists` | The slug already exists in `logos/changes/archive/` | The proposal was already archived |
| `logos/logos.config.json not found` | Not in project root | `cd` to project root |

## Related commands

- [`change`](/cli/change) — Create a new change proposal
- [`merge`](/cli/merge) — Previous step: generate merge instructions before archiving
