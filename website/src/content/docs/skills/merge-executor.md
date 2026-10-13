---
title: merge-executor
description: Review a change proposal before the merge is authorized, diagnose and repair failed merges at the delta, and count and commit the result after a successful merge.
---

Since 0.15.0, `openlogos merge <slug>` performs the whole merge itself in a single atomic call. The merge-executor skill therefore **does not apply deltas by hand**. Its job is everything around that command:

1. **Before authorization** — a read-only review of the deltas, so the merge is not refused
2. **On failure** — diagnose the stable error code and repair the **delta**, then rerun the command
3. **After success** — count structured IDs in the merged documents, report, and commit the spec changes

## Phase & Trigger

- **Phase**: Cross-phase (Delta workflow, `merge` subflow)
- **Trigger conditions**:
  - The user explicitly authorizes `openlogos merge <slug>`
  - The user says "execute the merge", "merge the deltas into the main documents"
  - `openlogos merge` exited non-zero and the user asks to investigate and fix it

## Prerequisites

1. The active proposal `logos/changes/<slug>/` exists, every `[delta]` task is checked, and the delta files are on disk
2. `activeChange` in `logos/.openlogos-guard` matches the slug (otherwise the command refuses without writing anything)
3. The user has explicitly authorized `openlogos merge` — it is a human confirmation point (under `openlogos next --auto` the standing authorization covers it)

The merge instructions come from the proposal itself — `proposal.md`, the `[delta]` section of `tasks.md`, and `deltas/**`. The target set is derived from `deltas/`; the skill never writes a separate target list.

## Step 1: Read-only review before the merge

Nothing is written in this step. Check:

1. **Section markers** — every `.md` delta has `ADDED` / `MODIFIED` / `REMOVED` (or `REMOVED-ITEMS`) markers and no leftover template text.
2. **Anchors** — each marker's heading matches exactly one section in the target; repeated headings use `Parent > Child` or an ordinal suffix `Title [n]`. The tool does not guess.
3. **One writer per section** — a target section is modified by only one `MODIFIED` block, across all delta files.
4. **ID conservation** — `MODIFIED` carries the full section with unchanged structured IDs; partial removal is `MODIFIED` + `REMOVED-ITEMS` naming the IDs.
5. **Target set** — the `[delta]` tasks and the actual `deltas/` files correspond one to one.

`openlogos change-lint --slug <slug>` gives the same verdict the merge uses for admission. If anything fails, fix the delta first.

## Step 2: Run the merge and handle failures

```bash
openlogos merge <slug>
```

The command recovers any interrupted run, resets prematurely filled `[code]`, re-runs the full change-lint verdict, composes every target by section anchor, writes them all atomically and finally writes `SPEC_MERGED` with the structured `test_change_set`. See [`openlogos merge`](/cli/merge).

When it fails, **stop**. Read the error code and the state statement:

| State | What to do |
|-------|------------|
| Not written (rejected before writing) | Fix the delta as diagnosed, rerun the command |
| Rolled back (write failed, whole batch rolled back) | Fix the cause, rerun |
| Possibly committed (state cannot be confirmed) | Inspect `git status`, `git diff logos/resources/` and whether `SPEC_MERGED` exists before doing anything else |

Never hand-write main documents, markers, counters or the resource index, never retry individual files outside the command, and never rename or delete OpenLogos-owned files in the proposal directory to make room.

If the proposal was already merged and its deltas changed, the same command performs an **incremental amendment** (`result:"amended"`). If it is refused because a merged target was edited by hand (`MERGE_AMEND_DRIFT`), report the drifted files and the review instructions; the correction belongs in a new proposal.

## Step 3: Post-merge count, report and commit

After a successful merge, before committing, count the structured IDs (test IDs in the first column of test tables, scenario IDs in headings and table rows, numbered section headings) in every touched document:

```
IDs after merge == IDs before − IDs of REMOVED sections − IDs named in REMOVED-ITEMS + IDs added
```

- **Matches** → include the count in the summary, then commit:

  ```bash
  git add -A
  git commit -m "docs(<slug>): merge spec deltas"
  ```

- **Does not match** → report which IDs are extra or missing and stop; do not commit.

`SPEC_MERGED` is written by the command; never touch or overwrite it.

Then hand over: the next step is slice planning — `slice-planner` produces `slices.json`, runs `openlogos slice plan --file <slices.json>`, and the user approves the slicing at `slice-exit`. After that come implementation, `openlogos verify`, optional deployment + `openlogos smoke`, and `openlogos archive` — each a human confirmation point in semi-auto mode. The skill's job ends here; it does not run verify, deployment, smoke or archive on its own.

## Boundaries

- GUI prototype assets (`2-page-design/*.html`) are committed by the merge command's own prototype step; the skill never edits them.
- The archive under `logos/changes/archive/` is audit-only; never read it to reconstruct main documents.
- If a re-merge changes the spec fingerprint, the slice manifest becomes stale; rebuild it by rerunning `openlogos slice plan --file` with the same `slices.json` when `next` asks for it.

## Related Skills

- Previous: [`change-writer`](/skills/change-writer) — writes the proposal and deltas
- Next: [`slice-planner`](/skills/slice-planner) — plans `[code]` slices against the merged spec
