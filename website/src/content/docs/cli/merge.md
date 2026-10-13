---
title: "openlogos merge"
description: Merge a change proposal's spec deltas into the main documents in a single call — atomic, all-or-nothing — and amend an already-merged proposal incrementally.
---

Merge every spec delta of a change proposal into `logos/resources/` (and, for OpenLogos itself, root `spec/` / `skills/`) in a **single call**. Since 0.15.0 the command does the whole job itself: it parses the deltas, composes the final bytes of every target by section anchor, writes them all atomically, and finally writes the `SPEC_MERGED` marker. Either every target is updated or none is.

`openlogos merge` is a **human confirmation point**: in semi-auto mode the AI runs it only after you explicitly authorize it (see [Two-tier authorization](/cli/next)).

## Synopsis

```bash
openlogos merge <slug> [--format json]
```

Must be run from the project root.

## Arguments & options

| Argument / option | Required | Description |
|-------------------|----------|-------------|
| `slug` | **Yes** | The change proposal slug (a directory under `logos/changes/`). Must match the `activeChange` in `logos/.openlogos-guard` when a guard exists. |
| `--format json` | No | Print a JSON envelope on stdout (progress lines go to stderr). On failure the last stderr line is an error envelope with a stable error code. |

## What it does

One invocation runs these steps in order:

1. **Recovery** — if a previous run was interrupted, leftover recovery material is first converged to a consistent state (all old or all new).
2. **`[code]` auto-reset** — `[code]` slices filled in too early (before spec-complete) are reset to an empty heading and backed up to `CODE_AUTORESET`. Slices are planned after merge by [`slice-planner`](/skills/slice-planner).
3. **Admission** — the full [`openlogos change-lint`](/cli/change-lint) verdict is re-run. Any violation rejects the merge before anything is written; each violation is printed with its code, path and fix hint.
4. **Parse deltas** — the target set is derived from `deltas/`: every mergeable delta maps to exactly one canonical target. A target that exists is modified; a missing target is created.
5. **Compose by section anchor** — each `ADDED` / `MODIFIED` / `REMOVED` (and `REMOVED-ITEMS`) block is applied to the section its heading anchors. An anchor that resolves to zero or several sections fails closed; use a heading path (`Parent > Child`) or an ordinal suffix (`Title [2]`) to disambiguate.
6. **Atomic write** — all composed targets are written in one batch (temp file + fsync + rename).
7. **`SPEC_MERGED` last** — the marker is written as the final step and records a structured `test_change_set` (changed / removed test IDs, derived from the semantic diff of the test specs) and the merge baseline used for later amendments.

### Delta-to-target mapping

| Delta category | Target directory |
|---------------|-----------------|
| `deltas/prd/` | `logos/resources/prd/` |
| `deltas/api/` | `logos/resources/api/` |
| `deltas/database/` | `logos/resources/database/` |
| `deltas/scenario/` | `logos/resources/scenario/` |
| `deltas/test/` | `logos/resources/test/` |

Nested paths are preserved: `deltas/prd/3-technical-plan/1-architecture/core-01-architecture.md` → `logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture.md`.

### Delta file format

```markdown
## ADDED — New Section Title
[Complete new content]

## MODIFIED — Existing Section Title
[Complete replacement content for the whole section]

## REMOVED — Obsolete Section Title
[Reason for removal]
```

A `MODIFIED` block replaces the anchored section up to the next heading of the same or a higher level — not the whole document. Rewriting several sibling sections needs one `MODIFIED` block per section. Unchanged structured IDs (test IDs, scenario IDs, numbered sections) inside a `MODIFIED` section must be carried over; dropping only some items is written as `MODIFIED` (remaining content) plus `REMOVED-ITEMS` naming the removed IDs.

### No-delta proposals

A code-only proposal with no delta files still runs `openlogos merge <slug>`: the command writes `SPEC_MERGED` with `type:"no_delta_spec_complete"`. This is the spec-complete step; until it exists, `status` / `next` report `spec-complete-required`.

## Example output

```
📋 Merge Summary:
  - Change proposal: add-remember-me
  - Delta files: 3
    → logos/resources/prd/1-product-requirements/core-01-requirements.md
    → logos/resources/api/core-auth.yaml
    → logos/resources/test/core-S02-test-cases.md

  ✓ logos/changes/add-remember-me/SPEC_MERGED (3 canonical targets written atomically in one batch)
  test_change_set: C=4 R=0
```

With `--format json`, `data.result` is `"merged"` and the envelope carries `target_count`, `targets`, `spec_merged_path`, `test_change_set` and `delta_digest`.

After a successful merge the AI commits the spec changes and the next step is slice planning: `slice-planner` produces `slices.json` and runs [`openlogos slice plan --file <slices.json>`](/cli/slice).

## Amending an already-merged proposal

If you edit the deltas of a proposal that is already merged and run `openlogos merge <slug>` again, the command performs an **incremental amendment** against the recorded merge baseline instead of failing:

| Situation | Result |
|-----------|--------|
| Deltas unchanged since the last merge | Idempotent no-op, `result:"already-merged"`, exit 0 |
| Deltas changed | Re-compose all targets from the merge baseline, recompute `test_change_set`, write atomically, rewrite `SPEC_MERGED` — `result:"amended"` |

An amendment reports how many targets were re-composed, added, or restored (`amend.targets_recomposed` / `targets_added` / `targets_restored` in JSON). It leaves `[code]`, `SLICES_APPROVED` and the slice manifest untouched, but **clears acceptance and delivery markers** (`VERIFY_PASS`, `VERIFY_FAIL`, `DEPLOY_DONE`, `SMOKE_PASS`, `SMOKE_FAIL`) listed in `invalidated_markers` — the amended spec must be verified again (and redeployed / smoke-tested if the proposal requires deployment).

`openlogos status --format json` exposes the read-only projection `modules[].active_change.spec_amend` (`pending`, `blocked_reason`, `amend_count`, delta digests), so tools can tell whether an amendment is pending without comparing bytes themselves.

An amendment is **refused** (nothing is written) when:

| Error code | Cause | What to do |
|------------|-------|------------|
| `MERGE_AMEND_DRIFT` | A merged target was edited by hand after the last merge | Review the named files with `git diff`, decide which edits to keep, and carry the correction in a new proposal. Do not overwrite uncommitted edits with checkout-style commands. |
| `MERGE_AMEND_BASELINE_MISSING` / `MERGE_AMEND_BASELINE_UNREADABLE` | `SPEC_MERGED` has no usable merge baseline (e.g. merged by an older version) | Leave the proposal as is and open a new proposal for the correction. |
| `MERGE_AMEND_CREATE_WITHDRAW` | The deltas no longer cover a file that the first merge created | Restore that delta, or remove the file in a new proposal. |
| `MERGE_AMEND_PROTOTYPE_UNSUPPORTED` | GUI prototype assets changed since the merge | Prototype changes go through a new proposal. |

## When a merge fails

Every failure prints a stable error code, a state statement, and a next action, then exits non-zero. The state statement is one of three tiers — read it before doing anything else:

| Tier | Statement | What it means | What to do |
|------|-----------|---------------|------------|
| **Not written** | Nothing was written | Rejected before the write phase (admission, invalid delta, anchor not found, guard mismatch) | Fix the delta as the diagnostic says and rerun `openlogos merge <slug>` |
| **Rolled back** | Write failed mid-way, whole batch rolled back | `logos/resources/` is back to its pre-merge bytes and `SPEC_MERGED` was not written (for an amendment: the previous merge state is kept) | Fix the cause (I/O, permissions, delta) and rerun |
| **Possibly committed** | State cannot be confirmed | Targets may already hold the new bytes and `SPEC_MERGED` may exist | First inspect `git status`, `git diff logos/resources/` and whether `SPEC_MERGED` is present. Do not rerun blindly. |

Never hand-edit main documents, markers, counters or the resource index to "finish" a failed merge — fixing the delta and rerunning the command is the only supported path.

| Error code | Cause |
|------------|-------|
| `MERGE_ADMISSION_REJECTED` | `change-lint` reported violations; run `openlogos change-lint --slug <slug>` to see them |
| `MERGE_DELTA_INVALID` | Missing section markers, template placeholders, or an anchor resolving to 0 or several sections |
| `MERGE_TARGET_MISMATCH` | Planned targets in `tasks.md` and the actual `deltas/` do not match |
| `MERGE_APPLY_FAILED` | The atomic write failed (rolled back) |
| `MERGE_NO_ACTIVE_CHANGE` | Proposal directory missing |

Other errors: `Missing change proposal name` (no slug), `Change proposal 'X' not found`, an active guard pointing at a different proposal, and `logos/logos.config.json not found` (not in the project root).

## Migrating from earlier versions

Removed in 0.15.0 — old path → new path:

- **`MERGE_PROMPT.md` is no longer generated.** Old: `openlogos merge` wrote `MERGE_PROMPT.md` and the AI applied the deltas by hand, then touched `SPEC_MERGED`. New: `openlogos merge <slug>` applies everything itself and writes `SPEC_MERGED`. A leftover `MERGE_PROMPT.md` in a proposal directory is a historical artifact — do not merge from it; just run `openlogos merge <slug>`.
- **`openlogos merge-apply` is removed.** Old: a separate apply step. New: part of the single `openlogos merge` call.
- **`openlogos merge transaction *` is removed** (`status` / `submit-content` / `seal` / `apply` / `recover` / `abort` / `reopen`). New: no transaction phases; a failed merge reports its state tier and you rerun the same command.
- **Re-merging after editing deltas.** Old: roll back the main documents by hand and remove the marker. New: rerun `openlogos merge <slug>`; it amends incrementally (`result:"amended"`).

## Related commands

- [`change`](/cli/change) — Create the proposal and delta structure
- [`change-lint`](/cli/change-lint) — Same admission verdict as merge; run it before asking for a merge
- [`slice`](/cli/slice) — Next step: plan `[code]` slices against the merged spec
- [`status`](/cli/status) — Shows `proposal_step` and the `spec_amend` projection
- [`archive`](/cli/archive) — Final step after verify (and deploy / smoke)
