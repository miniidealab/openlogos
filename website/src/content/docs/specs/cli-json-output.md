---
title: CLI JSON Output
description: Structured JSON output specification for OpenLogos CLI commands (status, next, verify, smoke, detect, module list).
---

OpenLogos CLI supports `--format json` on five command families — `status`, `next`, `verify`, `smoke`, `detect`, and `module list` — producing structured JSON for programmatic consumption by external tools like RunLogos.

## Common Conventions

- **Trigger**: Append `--format json` to any supported command
- **Output target**: JSON goes to **stdout**; errors go to **stderr**
- **Format**: Compact single-line JSON (no indentation), suitable for piping
- **Exit codes**: Same as human-readable mode
- **Encoding**: UTF-8
- **Field naming**: `snake_case`

## Envelope Structure

All commands share a common envelope:

```json
{
  "command": "<command-name>",
  "version": "<cli-version>",
  "timestamp": "<ISO-8601>",
  "data": { ... }
}
```

Where `command` is one of: `"status"`, `"next"`, `"verify"`, `"smoke"`, `"detect"`, `"module list"`.

## detect

```bash
openlogos detect --format json
```

Returns CLI version, Node.js version, and project detection information:

```json
{
  "cli": {
    "version": "0.12.9",
    "node_version": "v22.0.0"
  },
  "project": {
    "name": "my-project",
    "locale": "zh",
    "lifecycle": "launched",
    "modules": [
      { "id": "core", "name": "核心功能", "lifecycle": "launched" }
    ],
    "description": "项目描述",
    "source_roots": { "src": ["src"], "test": ["test"] }
  },
  "yaml_diagnostics": null
}
```

`project` is `null` when run outside an OpenLogos project.

## status

```bash
openlogos status --format json
```

Returns phase progress, module state, active proposals, and suggestions:

| Key field | Description |
|-----------|-------------|
| `phases[]` | All 13 phases with `key`, `label`, `done`, `skipped`, `files` |
| `modules[]` | Per-module lifecycle, current phase, phase progress, active change, suggestion |
| `modules[].active_change` | Proposal step, task progress, deployment decision, conflict detection |
| `modules[].active_change.code_required` | Single source of truth for "does this proposal need code" (see below) |
| `current_phase` | First incomplete phase key (or `null` if all done) |
| `lifecycle` | Project lifecycle derived from module states |
| `yaml_diagnostics` | Parse recovery status if YAML has issues |

### Proposal steps

The `proposal_step` field tracks change proposal lifecycle:

| Step | Meaning |
|------|---------|
| `writing` | Proposal/tasks still has template placeholders |
| `ready-to-delta` | Proposal + tasks filled, no delta yet, `PLAN_APPROVED` absent — the `plan-exit` "approve plan" gate |
| `delta-writing` | Proposal filled; delta tasks not all checked |
| `ready-to-merge` | All delta tasks checked (the `spec-exit` gate) |
| `merge-generated` | `openlogos merge` has run |
| `ready-to-implement` | Specs merged, `code_required`, `[code]` slices not yet written by slice-planner — the `slice-exit` "approve slices" gate |
| `coding` | Slices approved; code tasks not all checked |
| `ready-to-verify` | All code tasks checked |
| `verify-passed` | `openlogos verify` passed |
| `verify-failed` | `openlogos verify` failed |
| `ready-to-deploy` | Verify passed, deployment pending (the `deliver-entry` gate) |
| `deploy-done` | Deployment executed |
| `ready-to-smoke` | Deployment done, smoke pending |
| `smoke-passed` | `openlogos smoke` passed |
| `smoke-failed` | `openlogos smoke` failed |

`ready-to-delta` and `ready-to-implement` were added by the change-flow redesign and the slice-planner split respectively; consumers (including RunLogos) must recognise them. `implementing` / `in-progress` remain legacy-compatible values.

### code_required

`modules[].active_change.code_required` (boolean) is the **single source of truth** for whether a proposal needs code implementation. It equals the internal predicate `isCodeRequiredForProposal` — `true` when the proposal carries a `## [code]` requirement (a `[code]` section, `[delta]`-added `UT-*`/`ST-*`/`SMOKE-*`, or a proposal-level code declaration), `false` for pure-doc / pure-spec proposals. Consumers should read this field directly instead of re-guessing with keyword regexes.

- Appears **only when `active_change` is non-null**; with no active proposal the whole object (and this field) is absent, so projects without an active proposal see no new fields (golden zero-drift).
- Consistency: `code_required==false` ⟹ `next_node.id` is never `code`/`plan-slices` and the `slice` subflow (`when: code_required`) is skipped entirely. `code_required==true` with `[code]` still on template ⟹ `proposal_step=="ready-to-implement"`, `next_node.id=="plan-slices"`.

### Orchestration machine fields

These fields drive external orchestrators. All follow the same **mount + omit** rule: with `modules[]` present they mount at `modules[].*`; legacy projects fall back to the top level; consumers read `modules[].*` first, then the top level. Each is **omitted entirely** when inactive, preserving golden zero-drift.

**`loop_state`** — present only when the implement loop is active (`max_iters > 1`; builtin launched satisfies this by default):

| Field | Type | Description |
|-------|------|-------------|
| `subflow_id` | string | The loop's subflow id (e.g. `implement`) |
| `until` | string | Convergence predicate (`tests_green` \| `code_slices_green`) |
| `max_iters` | number | Resolved iteration ceiling |
| `iteration` | number | Completed verify rounds (`LOOP_ITERS` lines for the current module) |
| `converged` | boolean | Last verify round green |
| `escalated` | boolean | `iteration >= max_iters && !converged` (hit the ceiling unconverged) |
| `exhausted_skippable` | boolean \| omitted | Whether the loop-exhausted gate can be released by `--auto`; emitted only when the overlay `set-loop` wrote `exhausted_gate` |

**`slice_state`** — present only when the slice loop is active (`until == code_slices_green` && `max_iters > 1`; always on under launched):

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Total `[code]` slices |
| `done` | number | Checked slices (`section_complete:code` count) |
| `current` | string \| omitted | First unchecked `[code]` line title; omitted when all done |
| `remaining` | number | `total - done` |

**`plan_state`** — a launched diagnostic object so consumers do not mistake `tasks.md` checkbox progress for a planning failure:

| Field | Type | Description |
|-------|------|-------------|
| `plan_ready` | boolean | proposal/tasks out of template, no plan-layer block |
| `plan_gate_pending` | boolean | Stopped at `plan-exit`: `ready-to-delta` && `PLAN_APPROVED` absent |
| `plan_approved` | boolean | `PLAN_APPROVED` present, or already past `ready-to-delta` |
| `tasks_template_filled` | boolean | `tasks.md` out of template with valid section structure |
| `tasks_execution_done` / `tasks_execution_total` | number | Checkbox progress of the current section — must **not** be used to infer plan readiness |
| `tasks_execution_scope` | string | `delta` \| `deploy` \| `code` \| `none` |
| `diagnostic` | string | Short human/driver note on the waiting or blocking state |

**`next_node`** (on `openlogos next` only) — the orchestration hint for the node to handle this turn, carrying `skill` / `working_agent` / `review_agent` / `pre_script` / `post_script` from the resolved flow. It defaults to the current frontier node, with exceptions:

- In the slice loop (unconverged, below ceiling) it points to the `code` work node and carries `next_node.slice` (= `slice_state.current`, "only do this slice").
- At a slice/plan gate it carries **`next_node.gate_id`** alongside `id` — e.g. `ready-to-implement` with `plan-slices` done emits `id: "plan-slices"` + `gate_id: "slice-exit"`, telling the host **not** to re-dispatch the skill but to treat it as a human gate. Gate-id mappings: `ready-to-delta → plan-exit`, `ready-to-merge → spec-exit`, `ready-to-implement → slice-exit`, `ready-to-deploy → deliver-entry`.
- It is omitted for command-level suggestions (`all_done`, `openlogos change <slug>`, `openlogos launch`) and after a gate is auto-released.

**`GATE_AUTO_PASSED`** — an **append-only audit ledger** (JSONL) in the active proposal directory. Each time `next --auto` auto-releases a `skippable:true` gate it appends `{gate_id, proposal_step, timestamp}`. It is **audit only, not a state source** — historical lines never authorize a later deploy or gate; default `next` (no `--auto`) ignores them. State advances only on the real marker (`PLAN_APPROVED` for plan, `SLICES_APPROVED` for slice) or actual delta/slice output. Deployment release is gated on the **live** `gate_auto_passed === true` in the current `next --auto` response.

## verify

```bash
openlogos verify --format json
```

Returns test verification results with three-layer validation:

| Key field | Description |
|-----------|-------------|
| `summary` | Defined/executed/passed/failed/skipped/uncovered counts and percentages |
| `gate` | `result` ("PASS"/"FAIL") and `reason` |
| `failed_cases[]` | ID and error for each failure |
| `checklist` | Design-time coverage validation status |
| `ac_trace` | Acceptance criteria traceability status |
| `pre_run` | Pre-run execution mode, commands, result paths, diagnostics |
| `sandbox` | Sandbox isolation mode, status, diagnostics |

### Pre-run modes

| Mode | Description |
|------|-------------|
| `none` | No pre-run command configured |
| `pre_run_command` | Single `verify.pre_run_command` executed |
| `two_phase` | `regression_command` + `incremental_command` with last-write-wins merge |

### Gate failure reasons

| Reason | Description |
|--------|-------------|
| `failed_cases` | One or more test cases failed |
| `incomplete_coverage` | Some defined cases have no result |
| `checklist_incomplete` | Design-time coverage checklist not fully checked |
| `ac_trace_incomplete` | Acceptance criteria traceability not fully passed |

## smoke

```bash
openlogos smoke --format json
openlogos smoke --env staging --format json
```

Returns post-deployment smoke verification results:

| Key field | Description |
|-----------|-------------|
| `environment` | Target environment (from `--env` flag, or `null`) |
| `summary` | Same structure as verify summary |
| `gate` | Gate 3.8 result and reason |
| `sandbox` | Sandbox execution status |
| `report_path` | Generated smoke report path |
| `result_path` | Smoke results JSONL path |

## module list

```bash
openlogos module list --format json
```

Returns the module registry:

```json
{
  "modules": [
    { "id": "core", "name": "核心功能", "lifecycle": "launched" },
    { "id": "payment", "name": "支付模块", "lifecycle": "initial" }
  ]
}
```

## Error envelope

When a command fails, JSON mode outputs an error envelope to **stderr**:

```json
{
  "command": "<command-name>",
  "version": "<cli-version>",
  "timestamp": "<ISO-8601>",
  "error": {
    "code": "PROJECT_NOT_INITIALIZED",
    "message": "logos/logos.config.json not found."
  }
}
```

| Error code | Description |
|------------|-------------|
| `PROJECT_NOT_INITIALIZED` | Not in an OpenLogos project |
| `NO_TEST_RESULTS` | Test results JSONL file not found |
| `NO_TEST_CASES` | No test case spec files found |
| `NO_SMOKE_RESULTS` | Smoke results JSONL file not found |
| `NO_SMOKE_CASES` | No smoke case spec files found |

## Usage examples

```bash
# Check gate result in scripts
openlogos verify --format json | jq '.data.gate.result'

# Get current phase
openlogos status --format json | jq '.data.current_phase'

# List module lifecycles
openlogos module list --format json | jq '.data.modules[] | {id, lifecycle}'

# Conditional check
if openlogos verify --format json 2>/dev/null | jq -e '.data.gate.result == "PASS"' > /dev/null; then
  echo "All tests passed!"
fi
```
