---
title: "openlogos merge"
description: Generate a MERGE_PROMPT.md file that instructs AI to apply delta changes to main documents.
---

Scan delta files in a change proposal, map them to their target resource directories, and generate a `MERGE_PROMPT.md` that AI can read and execute.

## Synopsis

```bash
openlogos merge <slug>
```

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `slug` | **Yes** | The change proposal slug (must exist in `logos/changes/`) |

## What it does

1. Recursively scans `logos/changes/<slug>/deltas/` for files organized by category
2. Maps each category to a target resource directory (preserving nested subdirectory paths):

| Delta category | Target directory |
|---------------|-----------------|
| `deltas/prd/` | `logos/resources/prd/` |
| `deltas/api/` | `logos/resources/api/` |
| `deltas/database/` | `logos/resources/database/` |
| `deltas/scenario/` | `logos/resources/scenario/` |
| `deltas/test/` | `logos/resources/test/` |

Nested paths are preserved. For example, `deltas/prd/3-technical-plan/1-architecture/core-arch.md` maps to `logos/resources/prd/3-technical-plan/1-architecture/core-arch.md`.

3. Reads `proposal.md` content for context
4. Generates `logos/changes/<slug>/MERGE_PROMPT.md` with structured merge instructions
5. Writes a `MERGE_PROMPT_GENERATED` marker file to advance the proposal step to `merge-generated`

## Example output

```
📋 Merge Summary:
  - Change proposal: fix-redirect-bug
  - Delta files: 3
    deltas/prd/01-requirements-delta.md → logos/resources/prd/
    deltas/api/openapi-delta.yaml → logos/resources/api/
    deltas/scenario/S02-redirect-delta.json → logos/resources/scenario/

  ✓ logos/changes/fix-redirect-bug/MERGE_PROMPT.md

💡 Tell AI: "Read logos/changes/fix-redirect-bug/MERGE_PROMPT.md and execute merge"

After merge, run `openlogos archive fix-redirect-bug` to archive the proposal.
```

## The generated MERGE_PROMPT.md

The prompt contains:

1. **Proposal context** — the full content of `proposal.md`
2. **Delta file list** — each delta with its source path, target directory, and action
3. **Execution requirements** for the AI:
   - Process each delta file one by one
   - Handle `ADDED` / `MODIFIED` / `REMOVED` markers
   - Preserve original formatting and style
   - Update timestamps
   - Report a summary after each file
   - Remind the user to run `openlogos archive`

## Delta file format

Delta files use markers to indicate what should change in the target document:

```markdown
## ADDED: Section Name
[New content to insert]

## MODIFIED: Section Name
[Replacement content for an existing section]

## REMOVED: Section Name
[This section should be deleted from the main document]
```

## Empty delta behavior

If `deltas/` is empty or contains no recognized files, the command writes a `SPEC_MERGED` marker file and exits cleanly:

```
✓ No delta files in logos/changes/<slug>/deltas/ — nothing to merge.
```

This is not an error. Code-only changes (refactors, bug fixes that don't touch specs) are valid proposals that skip the merge step. The `SPEC_MERGED` marker advances the proposal step to `coding` so the workflow can continue.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Missing change proposal name` | No slug provided | Provide a slug: `openlogos merge fix-redirect-bug` |
| `Change proposal 'X' not found` | No directory at `logos/changes/<slug>/` | Check spelling, or create with `openlogos change` first |
| `logos/logos.config.json not found` | Not in project root | `cd` to project root |

## Related commands

- [`change`](/cli/change) — Previous step: create the proposal and delta structure
- [`archive`](/cli/archive) — Next step: archive the proposal after AI executes the merge
