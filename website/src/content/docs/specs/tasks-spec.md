---
title: "tasks.md Format"
description: Structured format specification for change proposal task files — section markers, status detection, and phase-based organization.
---

This specification defines the structured format for `tasks.md` in OpenLogos change proposals. The CLI depends on this format to accurately determine task status at each proposal stage.

## Format Overview

`tasks.md` uses marked sections to organize tasks, where each section corresponds to a stage in the proposal workflow:

```markdown
# 实现任务

## [delta] 规格变更
- [ ] Produce delta file to deltas/prd/1-product-requirements/ — update requirements
- [ ] Produce delta file to deltas/api/ — update API YAML

## [code] 代码实现
- [ ] Implement business logic in src/xxx
- [ ] Write corresponding tests

## [deploy] 部署执行
- [ ] Deploy to staging environment
- [ ] Verify deployment health
```

## Section Markers

| Marker | Stage | Purpose |
|--------|-------|---------|
| `[delta]` | Spec changes | Delta file production tasks |
| `[code]` | Code implementation | Business code + test code tasks |
| `[deploy]` | Deployment | Deployment execution tasks (optional) |

Sections without markers are treated as general tasks and don't affect proposal step detection.

### `[code]` is filled after merge, not during `write-tasks`

Under the redesigned launched flow (see [Change Management](/specs/change-management) and [Slice Planner](/specs/slice-planner)), `[code]` slices are **no longer written during the plan stage**. `write-tasks` (change-writer) produces **only `[delta]` and `[deploy]`**; its completion predicate is `tasks_delta_filled`. The `[code]` slices are cut later by the `slice-planner` in a dedicated `slice` subflow that runs **after merge**, against the merged spec and real test IDs — its completion predicate is `tasks_code_filled` (slices written, all unchecked).

- A pure-code proposal (no `[delta]`) must still **keep an empty `## [code]` heading**. This keeps `parseTaskSections` non-null and `code_required` true, but it is not permission to slice immediately: the proposal must first run no-delta `openlogos merge <slug>` and receive a `SPEC_MERGED` marker.
- Once `SPEC_MERGED` exists, the proposal may enter `plan-slices` only when real `UT-*` / `ST-*` / `SMOKE-*` IDs can be parsed from `proposal.md`, `tasks.md`, or merged test deltas. Missing IDs produce `test-id-required`, not a placeholder slice.
- If `[code]` is filled early (during `write-tasks`, before the slice stage legitimately enters), `openlogos merge` auto-resets it to an empty heading before spec-complete (backing the old text up to `CODE_AUTORESET`), so `slice-planner` remains the single source of truth for slices.

### How `[code]` slices are written: `openlogos slice plan`

Slices are not typed into `tasks.md` by hand. `slice-planner` produces a structured `slices.json` — one entry per slice with `slice_id`, `task_text`, `owned_test_ids`, `runner_selectors` and `spec_targets` — and hands it to the CLI:

```bash
openlogos slice plan --file slices.json [--slug <slug>] [--format json]
```

In one call the command validates the input, replaces the body of `## [code]` with one checkbox per slice, writes `logos/changes/<slug>/TEST_SLICE_MANIFEST.json`, and computes the manifest's `task_fingerprint` from the `tasks.md` it just wrote. Both files are staged and validated before either is replaced, so a rejected input leaves both untouched. `[delta]` / `[deploy]` sections and their checkboxes are preserved byte for byte, and re-running with the same input is idempotent (existing check states are kept).

- `TEST_SLICE_MANIFEST.json` records which test IDs each slice **owns**. `openlogos verify` reads ownership only from this manifest — never from the prose in `[code]` — to run slice checkpoints and the final full verify.
- After slicing, the `slice-exit` gate approves the plan (`SLICES_APPROVED`); only then does the proposal move to `coding`.
- If the merged spec changes later (for example after an incremental `openlogos merge` amendment), rerun `openlogos slice plan` with the same or updated `slices.json` to rebuild the manifest.

See [`openlogos slice`](/cli/slice) and [Slice Planner](/specs/slice-planner).

## Task Format

Each task is a Markdown checkbox:

```markdown
- [ ] Uncompleted task description
- [x] Completed task description
```

## How CLI Uses This Format

### Proposal Step Detection

`openlogos status` reads `tasks.md` to determine the current proposal step:

| Condition | Proposal Step |
|-----------|---------------|
| `[delta]` section has unchecked items | `delta-writing` |
| All `[delta]` items checked | `ready-to-merge` |
| No `[delta]` + code required + no `SPEC_MERGED`/`MERGED` | `spec-complete-required` |
| `SPEC_MERGED` exists + code required + no real test IDs | `test-id-required` |
| `SPEC_MERGED` exists + `[code]` not yet planned | `ready-to-implement` / `plan-slices` |
| `SPEC_MERGED` exists + `[code]` planned + `SLICES_APPROVED` exists | `coding` |
| All `[code]` items checked (or no `[code]` section) | `ready-to-verify` |
| `VERIFY_PASS` exists + `[deploy]` has unchecked items | `ready-to-deploy` |
| All `[deploy]` items checked | `deploy-done` / `ready-to-smoke` |

### Deployment Decision

The presence of a `[deploy]` section signals that the proposal requires deployment:

- **Has `[deploy]` section** → `deployment_required: true` (from tasks perspective)
- **No `[deploy]` section** → falls back to `proposal.md` deployment impact declaration

If `proposal.md` says "no deployment needed" but `tasks.md` has a `[deploy]` section, `openlogos status --format json` reports a `deployment_decision_conflict`.

## Writing Guidelines

1. Each task should be a single, actionable item
2. Tasks should be specific enough to verify completion
3. Delta tasks should reference the target directory
4. Code tasks should reference the source file or module
5. Deploy tasks should reference the target environment

## Example: Full Lifecycle

```markdown
# 实现任务

## [delta] 规格变更
- [x] Produce delta to deltas/prd/1-product-requirements/ — add S05 acceptance criteria
- [x] Produce delta to deltas/api/ — add GET /suggestions endpoint
- [x] Produce delta to deltas/test/ — add S05 test cases

## [code] 代码实现
- [x] Implement suggestion engine in src/lib/suggestions.ts
- [x] Add GET /suggestions route handler
- [x] Write UT-S05-01 through UT-S05-06 test code
- [x] Write ST-S05-01 through ST-S05-03 scenario tests
- [x] Add OpenLogos reporter to test runner

## [deploy] 部署执行
- [ ] Deploy to staging
- [ ] Verify /suggestions endpoint responds
```

## Related

- [Change Management](/specs/change-management) — Full proposal lifecycle
- [`openlogos status`](/cli/status) — Reads tasks.md for proposal step detection
- [`openlogos change`](/cli/change) — Creates the initial tasks.md template
- [`openlogos slice plan`](/cli/slice) — Writes the `[code]` slices and `TEST_SLICE_MANIFEST.json`
