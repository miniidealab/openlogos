---
title: "openlogos verify"
description: Verify test results against the merged test case specs and generate an acceptance report (Gate 3.6).
---

`openlogos verify` reads the test results ledger (JSONL), compares it with the test case IDs defined in `logos/resources/test/`, and generates an acceptance report. This is the **Gate 3.6** quality check.

The gate has exactly three criteria: the result ledger is consistent, there are zero failed cases, and there are zero uncovered cases. If a pre-run command is configured and exits non-zero, the gate fails as well.

## Synopsis

```bash
openlogos verify
openlogos verify --format json
```

Run it from the project root.

## Options

| Option | Description |
|--------|-------------|
| `--format json` | Output a machine-readable JSON envelope. See [JSON output](#json-output) below. |

## Gate 3.6 pass criteria

| Criterion | What it means |
|-----------|---------------|
| Result ledger consistent | Every line in the results file is valid; every result ID is defined in the merged test specs; no `[manual]` case has a result; the counters agree with each other (`passed + failed + skipped = executed`, and so on). |
| Zero failed cases | No effective result has `status: "fail"`. |
| Zero uncovered cases | Every automated UT/ST ID defined in the test specs has a result. |

In addition, when `verify.pre_run_command` (or a two-phase `regression_command` / `incremental_command`) is configured, **every stage must exit with code 0**. A non-zero exit fails the gate with `pre_run_failed`, even if the results file looks complete and green. The results file might be an old ledger restored by the runner, so verify does not reuse old results to decide the gate.

If the gate fails, the command exits with code `1`.

Design-time checklists and acceptance-criteria tables in `*-test-cases.md` are still useful writing practice (see [test-writer](/skills/test-writer)), but verify does not parse them and they do not affect the gate, the report, or the JSON output.

### FAIL reasons

`gate.reason` (in JSON output) takes the first matching value:

| Situation | Reason priority |
|-----------|-----------------|
| A pre-run stage exited non-zero | `failed_cases` if there are failed cases, otherwise `pre_run_failed` |
| All pre-run stages passed, or none is configured | `result_ledger_inconsistent` → `failed_cases` → `incomplete_coverage` |

A sandbox failure, or a smoke-coverage precheck that blocks (see below), can also turn the result into FAIL.

## Pre-run commands and sandbox

Configure verify in `logos/logos.config.json`:

```json
{
  "verify": {
    "result_path": "logos/resources/verify/test-results.jsonl",
    "pre_run_command": "npm test",
    "sandbox_mode": "auto",
    "sandbox_root": "/private/tmp",
    "sandbox_deny_workspace_write": true
  }
}
```

- **Single stage**: `pre_run_command` runs once. Verify empties the results file before it runs, so stale results cannot leak into this run.
- **Two phase**: `regression_command` + `incremental_command` run in order and their results are merged into `result_path` (last write wins). If two-phase is configured, `pre_run_command` is kept for compatibility but is not executed.
- **None**: verify reads whatever is already in `result_path`. If coverage is incomplete, verify suggests configuring a pre-run command, because a partial local test run is the usual cause.

Sandbox modes:

- `sandbox_mode: "off"`: no isolation (historical behavior).
- `sandbox_mode: "auto"`: isolate when possible. If isolation is not available, verify falls back with a warning.
- `sandbox_mode: "always"`: isolation is mandatory. Verify fails if setup fails, if the sandbox copy contains symlinks that escape it, if runtime write protection is not available, or if writes outside the whitelist are detected.

In a sandbox, the pre-run commands may only write back the result files (`verify.result_path`, plus `regression_result_path` / `incremental_result_path` when set) and the report. Whitelisted result files are collected even when they live under `node_modules`.

Paths that have a full path segment exactly equal to `node_modules` (including nested forms like `packages/a/node_modules/**`) count as one-off dependency directories inside the sandbox copy. They are skipped by the write audit and never copied back. Near-miss names such as `node_modules-cache` are not exempt. When this exemption applies, an informational note goes to `sandbox.infos` (shown once with `ℹ️` in text output) and `sandbox.status` does not change.

Symlink targets are copied as-is and checked for links that escape the sandbox. While commands run, OS-level write protection (macOS `sandbox-exec`, Linux bubblewrap) blocks writes to the original workspace before they happen. If no protection mechanism is available, `always` fails with the reason and `auto` continues with a warning about the remaining risk.

## Slice checkpoints and final acceptance

In a launched change whose `[code]` section has two or more slices planned by [`openlogos slice plan`](/cli/slice), each slice line tagged with real test IDs, verify runs **slice-aware**, using `TEST_SLICE_MANIFEST.json` (see [Test Slice Manifest](/specs/test-slice-manifest)):

- **Slice checkpoint** (`verify_mode: "slice-checkpoint"`): while some slice has no confirmed checkpoint yet, verify checks the baseline regression tests, plus the tests owned by the slices that already passed, plus the tests owned by the current slice. Tests owned by later slices are **pending**: they are excluded from the gate and do not count as uncovered. If the runner reports a pending ID, the ledger is marked inconsistent (`result_outside_eligible_scope`).
  - PASS appends a line to `SLICE_CHECKPOINTS.jsonl`. It does **not** write `VERIFY_PASS`.
  - FAIL writes `VERIFY_FAIL` and counts against the implement loop budget.
- **Final** (`verify_mode: "final"`): after every slice is checked off and confirmed, verify runs full acceptance against all defined tests. Only a final PASS writes `VERIFY_PASS`.

Single-slice proposals, docs-only proposals, and older proposals without a manifest use the normal full verify.

If the manifest is missing, invalid or stale, verify stops **before** it runs any test command. It prints `verify 暂停：<reason>` with each violation. In JSON mode it outputs `data.reason` and `data.slice_verification_state`. It exits with `2`, or with `1` for `test-slice-manifest-unsupported` / `test-slice-assignment-ambiguous`. In this case verify writes no marker and no loop record. To recover, re-run `openlogos slice plan --file <slices.json>` with the same input (see [`slice`](/cli/slice)).

## Proposal lifecycle integration

When there is an active change proposal (`logos/.openlogos-guard`), verify writes markers to the proposal directory once the gate result is known:

| Result | Marker |
|--------|--------|
| PASS (full or final) | Writes `VERIFY_PASS` and removes `VERIFY_FAIL` |
| PASS (slice checkpoint) | Appends a checkpoint line and removes `VERIFY_FAIL`. Does not write `VERIFY_PASS`. |
| FAIL | Writes `VERIFY_FAIL` and removes `VERIFY_PASS`, `DEPLOY_DONE`, `SMOKE_PASS`, `SMOKE_FAIL` |

`openlogos status` / `openlogos next` read these markers to show the next action. After a PASS, if the proposal has `[deploy]` tasks, verify lists them and reminds you that deployment is a human confirmation point.

### Smoke coverage precheck

If the active proposal adds or changes `SMOKE-*` cases, verify also checks that a smoke runner and reporter are wired up (`smoke_runner_missing`, `smoke_reporter_missing`). A missing runner fails verify early, so the problem shows up before deployment instead of at `openlogos smoke`. During a slice checkpoint, smoke cases that belong to later slices do not block the check.

## Test results format (JSONL)

Each line in the results file is one JSON object:

```json
{"id":"UT-S01-01","status":"pass","duration_ms":12,"timestamp":"2026-04-10T10:00:00Z"}
{"id":"UT-S01-02","status":"fail","duration_ms":5,"error":"Expected 201, got 400"}
{"id":"ST-S02-01","status":"skip","scenario":"S02"}
```

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| `id` | Yes | A UT/ST ID such as `UT-S01-01` | Must match an ID defined in the test specs |
| `status` | Yes | `pass`, `fail`, `skip` | Any other value makes the ledger inconsistent |
| `error` | When `fail` | string | A `fail` record without a non-empty `error` is invalid |
| `duration_ms` | No | number | Execution time |
| `timestamp` | No | ISO 8601 | When the test ran |
| `scenario` | No | string | Scenario identifier |

When the same `id` appears more than once and every record for it has a valid timestamp, the record with the latest time wins. If any timestamp is missing or invalid, the last line in the file wins. Lines that are not valid JSON, or that lack `id` / `status`, are reported as invalid and make the ledger inconsistent. They are never silently skipped.

## Test case ID detection

Verify scans every `*-test-cases.md` under `logos/resources/test/` and takes the **first column of Markdown table rows** whose cell is a UT/ST ID:

```
| UT-S01-01 | ... |        → automated case
| ST-S02-03 | ... |        → automated case
| ST-S02-04 [manual] | ... | → manual case (excluded from verify)
```

IDs that are only mentioned in prose, in other columns, or in code fences do not count. `SMOKE-*` IDs are counted by [`smoke`](/cli/smoke) (Gate 3.8), not by verify.

## Example output (PASS)

```
⚙️  Running verify.pre_run_command: npm test
...

🔍 OpenLogos Test Verification

Reading test results: logos/resources/verify/test-results.jsonl
Reading test cases: logos/resources/test/

──────────────────────────────────────────────────
📊 Results Summary
──────────────────────────────────────────────────
  Total defined:  111 cases (79 UT + 32 ST)
  Total executed: 111 cases
  ✅ Passed:      86
  ❌ Failed:       0
  ⏭️  Skipped:     25
──────────────────────────────────────────────────
  Coverage:  100%  (111/111)
  Pass rate: 100%  (111/111)
──────────────────────────────────────────────────

✅ Gate 3.6: PASS

📄 Report: logos/resources/verify/acceptance-report.md

⚙️  verify pre-run mode: single-stage
  [pass] pre_run: npm test (exit=0, duration=8123ms)

🧪 verify sandbox
  verify sandbox: mode=auto, status=pass, isolated=true, write_denied=true
```

The pass rate counts skipped cases as passed: `(passed + skipped) / executed`.

## Example output (FAIL)

```
🔍 OpenLogos Test Verification

Reading test results: logos/resources/verify/test-results.jsonl
Reading test cases: logos/resources/test/

──────────────────────────────────────────────────
📊 Results Summary
──────────────────────────────────────────────────
  Total defined:  111 cases (79 UT + 32 ST)
  Total executed: 109 cases
  ✅ Passed:      84
  ❌ Failed:       2
  ⏭️  Skipped:     23
──────────────────────────────────────────────────
  Coverage:  98%  (109/111)
  Pass rate: 98%  (107/109)
──────────────────────────────────────────────────

❌ Failed cases:
  UT-S02-04  Expected HTTP 302, got 301
  UT-S04-12  Token verification returned false for valid token

⚠️  Uncovered cases (2):
  ST-S03-05
  ST-S03-06

❌ Gate 3.6: FAIL

📄 Report: logos/resources/verify/acceptance-report.md
```

When the ledger is inconsistent, verify prints `verify result ledger is inconsistent`, the reasons (for example `unknown_test_result_id`, `invalid_test_result_json`, `result_count_mismatch`), the offending IDs or line numbers, and, for count mismatches, the two counters that disagree.

## Acceptance report

Verify writes `logos/resources/verify/acceptance-report.md`. It contains:

- **Summary**: defined, manual (excluded), executed, passed, failed, skipped, uncovered, coverage, pass rate, and the gate result
- **Pre-run command failures**: the failing stage and exit code only. Command output is never written to the report, because the report is committed.
- **Slice verification** (slice-aware runs only): mode, attempted slice, confirmed slices, eligible and pending test counts
- **Failed cases**, **Uncovered cases**, and **Skipped cases**

## JSON output

With `--format json`, the envelope's `data` includes:

| Field | Description |
|-------|-------------|
| `contract.version` | Machine contract version (`1.0.0`, or `1.1.0` when slice-aware fields are present) |
| `summary` | Defined / manual / executed / passed / failed / skipped / uncovered counts, coverage and pass rate |
| `gate` | `result` (`PASS` / `FAIL`) and `reason` |
| `failed_cases`, `uncovered_cases`, `skipped_cases` | Case lists |
| `consistency` | Ledger consistency: `ok`, `reasons`, unknown / manual / out-of-scope IDs, invalid lines, count mismatches with details |
| `pre_run` | Mode (`none` / `pre_run_command` / `two_phase`), each stage's `status` and `exit_code`, result paths, diagnostics and suggestions. Each executed stage also carries `stdout_tail` / `stderr_tail`: the last 80 lines, at most 8 KiB, with ANSI codes removed. These tails appear only in JSON and are never saved to disk. |
| `sandbox` | Sandbox mode, isolation, write policy, `status` (`pass` / `warn` / `fail` / `skipped`), diagnostics, suggestions, optional `infos` |
| `smoke_precheck` | Smoke coverage precheck result |
| `verify_mode`, `attempted_slice_id`, `eligible_test_ids`, `pending_test_ids`, `manifest`, `checkpoint`, `test_change_set` | Slice-aware runs only |
| `report_path` | Path of the acceptance report |

See [CLI JSON Output](/specs/cli-json-output) for the contract.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `No test results found at ...` (`NO_TEST_RESULTS`) | The results file does not exist and no pre-run produced it | Run your tests (with the OpenLogos reporter), or configure `verify.pre_run_command` |
| `No test case specs found` (`NO_TEST_CASES`) | No UT/ST IDs are defined in `logos/resources/test/` | Design test cases first (test-writer) |
| `logos/logos.config.json not found` (`PROJECT_NOT_INITIALIZED`) | Not in the project root | `cd` to the project root |
| `verify 暂停：test-slice-manifest-*` | The slice manifest is missing, invalid or stale | Re-run `openlogos slice plan --file <slices.json>` |
| Exit code `1` | Gate 3.6 FAIL | Fix the failing tests, add the missing results, fix the ledger, or make the pre-run command succeed, then re-run verify |

## Related

- [`slice`](/cli/slice): plan `[code]` slices and write `TEST_SLICE_MANIFEST.json`
- [`deploy-done`](/cli/deploy-done): record deployment after verify passes (Gate 3.7)
- [`smoke`](/cli/smoke): post-deployment smoke verification (Gate 3.8)
- [`status`](/cli/status): shows where the proposal stands
- [`launch`](/cli/launch): usually run after the first verify passes, to activate change management
