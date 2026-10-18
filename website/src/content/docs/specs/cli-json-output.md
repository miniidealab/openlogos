---
title: CLI JSON Output
description: Structured JSON output specification for OpenLogos CLI commands (status, next, verify, smoke, merge, slice plan, detect, module list), including the contract version handshake.
---

OpenLogos CLI supports `--format json` on its machine-facing commands — including `status`, `next`, `watch`, `verify`, `smoke`, `deploy-done`, `deploy`, `approve`, `env list` / `env show` / `env check`, `merge`, `slice plan`, `detect`, `flow show`, `change-lint` and `module list` — producing structured JSON for programmatic consumption by external tools like RunLogos.

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

`command` is the command name, for example `"status"`, `"next"`, `"verify"`, `"smoke"`, `"merge"`, `"slice plan"`, `"detect"` or `"module list"`. The top-level `version` is the **CLI version**. It is not the contract version (see below).

## Contract version (`data.contract.version`)

`status`, `next` and `verify` include a machine contract version in `data`:

```json
{ "command": "verify", "version": "0.16.0", "timestamp": "…", "data": { "contract": { "version": "1.1.0" }, … } }
```

- `data.contract.version` follows SemVer independently of the CLI version. A **major** bump means a required field was removed or changed meaning, or a closed enum lost a value. A **minor** bump adds optional fields or enum values. A **patch** clarifies without changing shape.
- Values currently emitted: `status` / `next` emit `1.0.0`, `1.1.0` (feature groups or slice-verification fields present) or `1.3.0` (plan-package fields present). `verify` emits `1.0.0`, or `1.1.0` when slice-aware fields are present.
- The npm package ships JSON Schemas for these contracts under `spec/schema/`: `status.schema.json`, `next.schema.json` and `verify.schema.json`. Each schema embeds its version (`x-contract-version`) and validates `envelope.data`. The schemas are backward-compatible supersets, so older responses still validate.
- **Consumers**: validate `data` against the bundled schema. If `contract` is missing or its major version is unknown, fall back to a conservative mode (follow `next` only, and treat heuristics as observations). Treat any unknown enum value conservatively. Ignore unknown fields.

### Projections removed in 0.15.0

The 0.15.0 flow reduction removed several projections. Tools that read `--format json` should no longer expect them:

| Command | Removed | Notes |
|---------|---------|-------|
| `verify` | `checklist`, `ac_trace` | The verify gate now has only three criteria: consistent result ledger, zero failed, zero uncovered. `gate.reason` no longer produces `checklist_incomplete` or `ac_trace_incomplete`. If an old response contains them, read it as FAIL. |
| `status` / `next` | `plan_state.clarification` | Decision clarification is no longer a hard gate. Contract `1.2.0` is no longer emitted. |
| `status` / `next` | Merge-transaction and slice-transaction projections | Merging is a single `openlogos merge <slug>` call, and slices are written by `openlogos slice plan`. Contract `1.4.0` is no longer emitted. |

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
| `environments`, `environment_ledger` | Only when `logos/environments.yaml` exists: one EnvView per environment (see [env](#env-list--env-show--env-check)) and `{path, corrupt_lines}` of the deployment ledger. An invalid registry yields `environments: []` plus `environment_registry_error: {code, message}` |

### Proposal steps

The `proposal_step` field tracks change proposal lifecycle:

| Step | Meaning |
|------|---------|
| `writing` | Proposal/tasks still has template placeholders |
| `ready-to-delta` | Proposal + tasks filled, no delta yet, `PLAN_APPROVED` absent — the `plan-exit` "approve plan" gate |
| `delta-writing` | Proposal filled; delta tasks not all checked |
| `ready-to-merge` | All delta tasks checked (the `spec-exit` gate) |
| `merge-generated` | Legacy value from the pre-0.15 two-step merge. The single-call `openlogos merge` goes straight to the spec-complete steps. |
| `spec-complete-required` | Code proposal has no spec-complete marker; run no-delta `openlogos merge <slug>` or finish merge before planning slices |
| `test-id-required` | Spec-complete is done, but no real `UT-*` / `ST-*` / `SMOKE-*` IDs are available for slice planning |
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

`spec-complete-required` and `test-id-required` are blocking diagnostics for code proposals before `plan-slices`. They are not human gates and `--auto` must not skip them. In both states, `next_node.id` must not be `plan-slices`; the JSON includes `reason` (`no_delta_spec_marker_missing` or `code_change_requires_real_test_ids`) so drivers can route the work to merge/spec-complete or test-ID authoring instead of dispatching `slice-planner`.

### code_required

`modules[].active_change.code_required` (boolean) is the **single source of truth** for whether a proposal needs code implementation. It equals the internal predicate `isCodeRequiredForProposal` — `true` when the proposal carries a `## [code]` requirement (a `[code]` section, `[delta]`-added `UT-*`/`ST-*`/`SMOKE-*`, or a proposal-level code declaration), `false` for pure-doc / pure-spec proposals. Consumers should read this field directly instead of re-guessing with keyword regexes.

- Appears **only when `active_change` is non-null**; with no active proposal the whole object (and this field) is absent, so projects without an active proposal see no new fields (golden zero-drift).
- Consistency: `code_required==false` ⟹ `next_node.id` is never `code`/`plan-slices` and the `slice` subflow (`when: code_required`) is skipped entirely. `code_required==true` with `[code]` still on template ⟹ `proposal_step=="ready-to-implement"`, `next_node.id=="plan-slices"`.
- For no-delta code proposals, `code_required==true` still requires `SPEC_MERGED`/`MERGED` first. Missing spec-complete marker yields `spec-complete-required`; missing real test IDs after spec-complete yields `test-id-required`.

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

Returns the Gate 3.6 result. The gate has three criteria: consistent result ledger, zero failed cases, zero uncovered cases. A failing pre-run command also fails the gate.

| Key field | Description |
|-----------|-------------|
| `contract.version` | `1.0.0`, or `1.1.0` when slice-aware fields are present |
| `summary` | Defined / manual / executed / passed / failed / skipped / uncovered counts, coverage and pass rate |
| `gate` | `result` (`"PASS"` / `"FAIL"`) and `reason` |
| `failed_cases[]`, `uncovered_cases[]`, `skipped_cases[]` | Case lists |
| `consistency` | `ok`, `reasons`, `unknown_result_ids`, `manual_result_ids`, `outside_eligible_result_ids`, `invalid_results`, `count_mismatches`, `count_mismatch_details` |
| `pre_run` | Mode, per-stage `status` / `exit_code` / `duration_ms`, result paths, diagnostics and suggestions |
| `sandbox` | Sandbox mode, isolation, status, diagnostics, optional `infos` |
| `smoke_precheck` | Smoke coverage precheck for the active proposal's changed `SMOKE-*` cases |
| `report_path` | Acceptance report path |
| `verify_mode`, `attempted_slice_id`, `eligible_test_ids`, `pending_test_ids`, `manifest`, `checkpoint`, `test_change_set` | Only in slice-aware runs (`verify_mode`: `slice-checkpoint` or `final`) |

### Pre-run modes

| Mode | Description |
|------|-------------|
| `none` | No pre-run command configured |
| `pre_run_command` | Single `verify.pre_run_command` executed |
| `two_phase` | `regression_command` + `incremental_command` with last-write-wins merge |

Each executed `pre_run.commands[]` entry carries `stdout_tail` and `stderr_tail`: the last 80 lines and at most 8 KiB of the command's output, cut at a UTF-8 character boundary, with ANSI control codes removed. These fields exist only in JSON output. They are not written to `acceptance-report.md` and the full output is never saved to disk. Skipped entries have no tails.

### Gate failure reasons

| Reason | Description |
|--------|-------------|
| `pre_run_failed` | A pre-run stage (`pre_run`, `regression` or `incremental`) exited non-zero and the ledger has no failed cases. The stale results file is not used to pass the gate. |
| `result_ledger_inconsistent` | The result ledger is inconsistent (see `consistency`) |
| `failed_cases` | One or more test cases failed |
| `incomplete_coverage` | Some defined cases have no result |
| `smoke_runner_missing` / `smoke_reporter_missing` | The smoke coverage precheck blocked: the proposal changed `SMOKE-*` cases but no runner or reporter is wired up |

Priority: if a pre-run stage failed, the reason is `failed_cases` when there are failed cases, otherwise `pre_run_failed`. If all pre-run stages passed or none is configured, the order is `result_ledger_inconsistent` → `failed_cases` → `incomplete_coverage`.

### Slice manifest pause

In a multi-slice launched change, if `TEST_SLICE_MANIFEST.json` is missing, invalid or stale, verify does not run any tests. It prints an envelope whose `data` has `reason` (for example `test-slice-manifest-missing`) and `slice_verification_state`, and exits with `2`. For `test-slice-manifest-unsupported` and `test-slice-assignment-ambiguous` it exits with `1`. The recovery is to re-run `openlogos slice plan --file <slices.json>`. See [Test Slice Manifest](/specs/test-slice-manifest).

`status` and `next` expose the same `slice_verification_state` (`manifest_status`, `verify_mode`, `attempted_slice_id`, `confirmed_slice_ids`, `eligible_test_ids`, `pending_test_ids`). When recovery is possible, `next` returns `next_node.id: "plan-slices"` with `skill: "slice-planner"` and `dispatch.idempotent: true`.

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
| `changed_cases`, `diagnostics`, `runners` | The active proposal's changed `SMOKE-*` IDs, precheck diagnostics, and the runners that were found |
| `required_skipped_cases` | Only when non-empty. `[{id, detail}]` for skips of the proposal's changed cases, which block the gate (`required_cases_skipped`). |
| `platform_skipped_cases` | Only when non-empty. `[{id, detail}]` for skips accepted because the result carries `reason_code: "platform-unavailable"` and a non-empty `detail`. |
| `sandbox` | Sandbox execution status |
| `report_path` | Generated smoke report path |
| `result_path` | Smoke results JSONL path |
| `environment_evidence` | Only with a registry: `target`, `deploy_id`, `ref`, `deploy_env_confirmed`, `env_evidence` (`declared` / `missing` / `mismatch`), `mismatched_case_ids`, `missing_case_ids`, `fresh_results`, `verified`, `ledger_written` |

`gate.reason` priority: `failed_cases` → precheck diagnostic code (`smoke_runner_missing` / `smoke_reporter_missing` / `smoke_cases_uncovered`) → `required_cases_skipped` → `incomplete_coverage`. With a registry, a result row whose `target_environment` differs from the environment fails the gate with `SMOKE_ENV_EVIDENCE_MISMATCH`.

## deploy-done

```bash
openlogos deploy-done --env <id|alias> [--ref <git revision>] --format json
```

With a registry, `data.environment` is the resolved id and `data.deployment` carries `deploy_id`, `environment`, `ref` (40-character commit or `null`), `ref_source` (`explicit` / `unknown`), `observed_head` and `ledger_written`. A gated environment is refused with `DEPLOY_DONE_GATED_ENV`; registry problems use `ENV_REGISTRY_INVALID`, `ENV_REQUIRED`, `ENV_UNKNOWN`, `ENV_REF_UNRESOLVED`. See [`openlogos deploy-done`](/cli/deploy-done).

## env list / env show / env check

```bash
openlogos env list --format json
openlogos env show <id|alias> --format json
openlogos env check [<id|alias>] [--probe] --format json
```

All three are read-only and need no active proposal.

- **`env list`** — `registry_path`, `registry_present` (`false` and `environments: []` without a registry), `proposal_default_env` (only when configured), `environments[]`, `ledger` (`{path, corrupt_lines}`) and `warnings[]` (e.g. `ENV_UNKNOWN_FIELD`).
- **EnvView** (each `environments[]` item, also used by `status`) — `id`, `name`, `tier`, `aliases`, `current_ref`, `last_deploy`, `last_smoke` (with `env_evidence`, `fresh_results`, `deploy_env_confirmed`, `verified`). Once deployment execution is enabled: `previous_ref`, `deploy_mode`, `deploy_in_progress`, and `last_deploy.result` / `channel` / `mode` / `ref_requested` / `failure_reason`. For environments with `promote_from` or `require_approval`: `promote_from`, `require_approval`, `open_approvals[]` and `promotion` (`{from, candidate_ref}`).
- **`env show`** — `environment` (the registry entry; `secrets` lists variable names only, and `deploy` appears when configured — script, workflow or plan section references, never commands or secret values), the EnvView fields, `history[]` (up to 20 records, newest first, `kind` = `deploy` / `smoke` / `approval`), `ledger` and `warnings`.
- **`env check`** — `scope`, `ok` (exit code 1 when `false`), `errors[]` (`ENV_FIELD_INVALID`, `ENV_DUPLICATE_ID_OR_ALIAS`, `ENV_GATE_REFERENCE_UNKNOWN`, `ENV_SECRET_MISSING`, `ENV_PROBE_FAILED`), `warnings[]`, `secrets[]` (`{environment, name, present}`, never values) and `probes[]` (empty unless `--probe`).

See [`openlogos env`](/cli/env) and [Environment Registry](/specs/environments).

## deploy

```bash
openlogos deploy --env <id|alias> [--ref <revision>] [--rollback] [--channel proposal|version] [--dry-run] --format json
openlogos deploy --env <id|alias> --complete <deploy_id> --result done|failed --format json
openlogos deploy --env <id|alias> --abandon <deploy_id> --format json
openlogos deploy --env <id|alias> --reconcile --format json
```

On success `data` contains `status` (`done` / `dry-run` / `awaiting-agent` / `reconciled` / `still-running` / `abandoned`), `environment`, `deploy_id`, `channel`, `mode`, `ref_input`, `ref_requested`, `ref` (confirmed deployed version, or `null`), `ref_source` (`explicit` / `ci-reported` / `unknown`), `rollback`, `rollback_from`, `duration_ms`, `ci`, `log_path`, `output_tail` (secrets masked), `ledger_written`, `proposal` (proposal channel), `plan` (dry-run / agent) and `warnings` (e.g. `DEPLOY_REF_UNCONFIRMED`). For gated environments it adds `approval_id`, `promoted_from` and `promotion_override_reason`; a dry-run `plan` adds the approval and promotion basis it would use.

Failures go to stderr. `DEPLOY_FAILED`, `DEPLOY_RESULT_UNKNOWN` and `DEPLOY_RECORD_FAILED` carry `error.details` with the deployment (`deploy_id`, `exit_code`, `failure_reason`, `log_path`, `output_tail`, `deployed`, …). `DEPLOY_PROMOTION_UNVERIFIED` details give `promote_from`, `requested`, `upstream_current_ref`, `upstream_candidate_ref`; `DEPLOY_APPROVAL_REQUIRED` details give `requested` and a ready-to-run `approve_command`. All other refusals happen before anything runs. See [`openlogos deploy`](/cli/deploy).

## approve

```bash
openlogos approve --env <id|alias> --ref <revision> [--note <text>] --format json
```

On success `data` contains `environment`, `approval_id`, `created` (`false` when an unused approval for the same environment and commit already existed — nothing new was written), `ref`, `ref_input`, `approver` (display only), `note` and `recorded_at`. Errors: `ENV_REGISTRY_NOT_FOUND`, `ENV_REGISTRY_INVALID`, `ENV_REQUIRED`, `ENV_UNKNOWN`, `APPROVAL_NOT_REQUIRED`, `APPROVAL_REF_REQUIRED`, `ENV_REF_UNRESOLVED`, `APPROVAL_WRITE_FAILED`. When an AI host blocks the command (it is human-only), there is no output at all. See [`openlogos approve`](/cli/approve).

## merge

```bash
openlogos merge <slug> --format json
```

`openlogos merge` applies all deltas in a single call. The write is atomic: either everything lands or nothing does. On success, `data` contains:

| Field | Description |
|-------|-------------|
| `slug` | Proposal slug |
| `result` | `"merged"` (first merge, including no-delta spec-complete), `"already-merged"` (nothing changed since the recorded merge), or `"amended"` (an already-merged proposal's deltas changed and were re-applied incrementally from the recorded merge baseline) |
| `delta_digest` | Digest of the deltas that were applied |
| `target_count`, `targets` | Spec files written |
| `spec_merged_path` | Path of `SPEC_MERGED` |
| `test_change_set` | Test IDs added/modified/removed by the proposal |
| `invalidated_markers` | For `amended`: the acceptance markers cleared because the spec changed (`VERIFY_PASS`, `VERIFY_FAIL`, `DEPLOY_DONE`, `SMOKE_PASS`, `SMOKE_FAIL`, whichever were present) |
| `amend` | `null`, or for `amended`: `{targets_recomposed, targets_added, targets_restored}` |

`status` projects pending amendments at `modules[].active_change.spec_amend`: `merged_delta_digest`, `current_delta_digest`, `pending` (`null` when there is no baseline, which means it cannot be determined), `blocked_reason` (`baseline-missing`, `baseline-unreadable`, `drift`, `create-withdraw` or `prototype-changed`) and `amend_count`. If a merge target was edited by hand after the merge (`drift`), `merge` refuses to amend (`MERGE_AMEND_DRIFT`) and explains what to check. Errors use the error envelope below.

## slice plan

```bash
openlogos slice plan --file <slices.json> --format json
```

On success, `command` is `"slice plan"` and `data` contains `slug`, `slice_count`, `slice_ids`, `task_fingerprint`, `spec_fingerprint` and `manifest_path`. On failure, the error envelope goes to stderr with `error.code` (`SLICE_PLAN_*`). When the validator rejected the input, a top-level `violations` array lists each item with `code`, `path`, `message` and `fix_hint`. See [`openlogos slice`](/cli/slice).

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
