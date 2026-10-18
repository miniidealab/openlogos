---
title: "openlogos smoke"
description: Run post-deployment smoke verification against the smoke test case specs (Gate 3.8).
---

`openlogos smoke` checks deployment health. It reads smoke results from a JSONL file, compares them with the smoke case IDs defined in `logos/resources/test/smoke/`, and generates a smoke report. This is the **Gate 3.8** quality check. Run it after deployment has been executed and recorded with [`openlogos deploy-done`](/cli/deploy-done) (Gate 3.7).

## Synopsis

```bash
openlogos smoke [--env <name>] [--format json]
```

Run it from the project root.

## Options

| Option | Description |
|--------|-------------|
| `--env <name>` | The environment being verified, such as `staging` or `production`. Without a registry it is a free-form label for the run and the report; when `logos/environments.yaml` exists it must be a registered id or alias and is **required** (see [Environment evidence](#environment-evidence)). |
| `--format json` | Output a machine-readable JSON envelope (includes `sandbox` diagnostics). |

## Preconditions

When there is an active change proposal, smoke first checks the proposal's lifecycle. It stops at the first failed check, **before** it reads the config, runs `smoke.command`, or touches the results file:

| Error code | Meaning | Fix |
|------------|---------|-----|
| `SMOKE_NOT_REQUIRED` | The proposal does not require smoke | Archive after verify passes |
| `SMOKE_DEPLOY_DECISION_CONFLICT` | `proposal.md` and `tasks.md` disagree about deployment | Fix the deployment decision first |
| `SMOKE_DEPLOY_NOT_DONE` | `DEPLOY_DONE` is missing | Finish the deployment, then run `openlogos deploy-done` |
| `SMOKE_DEPLOY_TASKS_INCOMPLETE` | `[deploy]` still has unchecked items | Finish the `[deploy]` tasks, then run `openlogos deploy-done` |
| `SMOKE_DEPLOY_MARKER_INVALID` | `DEPLOY_DONE` is non-empty but not a valid record, or cannot be read (`error.details.problems` names the problem fields) | Re-run `openlogos deploy-done --env <id> [--ref <revision>]` to rewrite it |
| `SMOKE_ENV_MISMATCH` | Registry present and `DEPLOY_DONE` records a different environment than `--env` | Smoke the environment you actually deployed to |
| `SMOKE_DEPLOY_SUPERSEDED` | Registry present and the environment was deployed again after the proposal recorded its deployment (the ledger's latest deploy is not the one in `DEPLOY_DONE`) | Redeploy on the proposal channel, then run smoke |

When a registry exists, `ENV_REGISTRY_INVALID`, `ENV_REQUIRED` and `ENV_UNKNOWN` are also checked first. None of these refusals runs `smoke.command`, writes a smoke marker or touches the ledger.

## What it does

1. Reads the smoke configuration in `logos/logos.config.json` (`smoke.command`, `smoke.result_path`, `smoke.report_path`). If `smoke.command` is not set but `scripts/run-smoke.js` exists, it uses `node scripts/run-smoke.js`.
2. If there is a smoke command, smoke **empties the results file** and then runs the command (optionally sandboxed). Results from an earlier deployment therefore never count as evidence for this run. If the command exits non-zero, smoke warns and evaluates whatever results the command wrote.
3. Reads smoke results from `logos/resources/verify/smoke-results.jsonl` (or the configured path).
4. Scans `logos/resources/test/smoke/*.md` for defined smoke case IDs, taken from the first column of table rows (for example `SMOKE-releases-01`).
5. When the active proposal adds or changes `SMOKE-*` cases, runs the smoke coverage precheck: is a runner reachable (`smoke_runner_missing`), did it write results (`smoke_reporter_missing`), and does every changed ID have a result (`smoke_cases_uncovered`)?
6. Computes Gate 3.8, writes the report, and writes `SMOKE_PASS` / `SMOKE_FAIL` to the active proposal.

## Smoke configuration

```json
{
  "smoke": {
    "command": "node scripts/run-smoke.js",
    "result_path": "logos/resources/verify/smoke-results.jsonl",
    "report_path": "logos/resources/verify/smoke-report.md",
    "sandbox_mode": "auto",
    "sandbox_root": "/private/tmp",
    "sandbox_deny_workspace_write": true
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `command` | `node scripts/run-smoke.js` if that file exists, otherwise none | Shell command that runs the smoke tests and writes results to `result_path` |
| `result_path` | `logos/resources/verify/smoke-results.jsonl` | Smoke results JSONL |
| `report_path` | `logos/resources/verify/smoke-report.md` | Generated report |
| `sandbox_mode` | `auto` | Sandbox isolation mode (`off` / `auto` / `always`) |

The sandbox executor is shared with [`openlogos verify`](/cli/verify). Writes under a path segment exactly equal to `node_modules` are exempt from the write audit; a note goes to `sandbox.infos` and `sandbox.status` does not change. Whitelisted result files are collected even under `node_modules`. Symlink isolation and OS-level runtime write protection apply. When write protection is not available, `always` fails and `auto` warns.

## Gate 3.8 pass criteria

All of the following must hold:

| Criterion | Description |
|-----------|-------------|
| Zero failed cases | No smoke result has `status: "fail"` |
| 100% coverage | Every defined smoke ID has a result |
| Precheck clean | No smoke coverage precheck diagnostic for the proposal's changed cases |
| No required case skipped | None of the proposal's added or changed smoke cases ended as `skip`, except a platform-unavailable skip (below) |

A sandbox failure also turns the result into FAIL. If any criterion fails, the command exits with code `1`.

### Skips of required cases

The smoke cases that the active proposal adds or changes are the evidence for this deployment. A `skip` only says that the evidence was not collected, so such a skip **blocks the gate by default** (`gate.reason: "required_cases_skipped"`). The report lists these cases under "Required Cases Without Evidence".

There is one exception. If a case really cannot run on the current platform, the runner writes the skip with `reason_code: "platform-unavailable"` and a non-empty `detail` that explains why. Such a skip is accepted. It is listed separately in the report ("Platform-Unavailable Skips") and in `platform_skipped_cases` in JSON, so it stays auditable. A skip without a reason code, with any other reason code, or with an empty `detail` still counts as missing evidence.

Skips of smoke cases that the current proposal did not touch are counted as before (executed, not failed or uncovered) and never fail the gate on their own.

## Smoke results format (JSONL)

```json
{"id":"SMOKE-releases-01","status":"pass","duration_ms":1200,"timestamp":"2026-05-28T10:00:00Z"}
{"id":"SMOKE-releases-02","status":"fail","error":"Expected 200, got 404","duration_ms":500}
{"id":"SMOKE-cli-install-03","status":"skip","reason_code":"platform-unavailable","detail":"Windows-only installer check; current runner is Linux"}
```

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| `id` | Yes | `SMOKE-<domain>-<nn>` | Smoke case ID from the spec |
| `status` | Yes | `pass`, `fail`, `skip` | Result |
| `error` | No | string | Error message for failed cases |
| `detail` | For `skip` | string | Why the case was skipped |
| `reason_code` | No | `platform-unavailable` | The only reason code the gate recognizes |
| `duration_ms` | No | number | Execution time |
| `timestamp` | No | ISO 8601 | When the case ran |
| `target_environment` | No | environment id | The environment the runner actually verified (see below). The existing `environment` field stays a free-form label of where the runner executed and is not used for this check |

## Environment evidence

When the project has a `logos/environments.yaml` registry (see [Environment Registry](/specs/environments)) and you pass `--env`:

1. `--env` is resolved to an environment id (ids first, then aliases, case-insensitive).
2. `smoke.command` runs with the environment variable `OPENLOGOS_SMOKE_ENV=<id>` (also inside the sandbox). Runners should read it and write it back as `target_environment` on every result row they produce.
3. Smoke classifies the counted result rows:

   | `env_evidence` | When | Effect |
   |----------------|------|--------|
   | `declared` | Every row has `target_environment` equal to the environment | Can count as verified |
   | `missing` | Some row lacks `target_environment`, or there are no rows | Gate computed as before (old runners keep working), but `verified=false` |
   | `mismatch` | Some row declares a different environment | Gate FAIL with `gate.reason: "SMOKE_ENV_EVIDENCE_MISMATCH"` |

4. A `smoke` record is appended to the deployment ledger `logos/.openlogos-runtime/deployments.jsonl`. It is **verified** only when the gate passed, `env_evidence` is `declared`, the results were produced by this run (`fresh_results`), the deployed environment is confirmed and the deployed version is known. Only verified smoke records count for promotion checks (`promote_from`) and for "last smoke" in [`env`](/cli/env).

The ledger is written before the smoke marker; if either step fails, both are restored and smoke ends with `SMOKE_LEDGER_WRITE_FAILED`.

When deployment execution is enabled (some environment has a `deploy` configuration), smoke also checks the deployment identity: with an active proposal, `DEPLOY_DONE` must be the latest deploy of that environment in the ledger (otherwise `SMOKE_DEPLOY_SUPERSEDED`); without an active proposal, the identity is taken from the ledger and smoke still records its result there.

Without a registry, `--env` stays a plain label and smoke behaves as before.

## Proposal lifecycle integration

When an active change proposal exists, smoke writes markers:

| Gate result | Marker |
|-------------|--------|
| PASS | Writes `logos/changes/<slug>/SMOKE_PASS` and removes `SMOKE_FAIL` |
| FAIL | Writes `logos/changes/<slug>/SMOKE_FAIL` and removes `SMOKE_PASS` |

After `SMOKE_PASS` the proposal is ready to archive. After `SMOKE_FAIL`, fix the deployment and run smoke again.

## Example output (PASS)

```
⚙️  Running smoke.command: node scripts/run-smoke.js

🔎 OpenLogos Smoke Verification

  Environment: staging
  Defined:  5
  Executed: 5
  Passed:   4
  Failed:   0
  Skipped:  1
  Coverage: 100%
  Pass rate: 100%
  smoke sandbox: mode=auto, status=pass, isolated=true, write_denied=true

Platform-unavailable smoke cases (skip accepted):
  SMOKE-cli-install-03: Windows-only installer check; current runner is Linux

✅ Gate 3.8: PASS

📄 Report: logos/resources/verify/smoke-report.md
```

## Example output (FAIL)

```
🔎 OpenLogos Smoke Verification

  Defined:  5
  Executed: 4
  Passed:   2
  Failed:   1
  Skipped:  1
  Coverage: 80%
  Pass rate: 75%

Failed smoke cases:
  SMOKE-releases-03  Expected 200, got 404

Uncovered smoke cases:
  SMOKE-cli-install-02

Required smoke cases without evidence (skip):
  SMOKE-releases-04: staging token not configured

❌ Gate 3.8: FAIL

📄 Report: logos/resources/verify/smoke-report.md
```

## JSON output

With `--format json`, `data` includes `environment`, `summary`, `gate` (`result`, `reason`), `failed_cases`, `uncovered_cases`, `skipped_cases`, `changed_cases`, `diagnostics`, `runners`, `sandbox`, `report_path`, and `result_path`. Two lists appear only when they are non-empty:

- `required_skipped_cases`: `[{id, detail}]` for skips of required cases that block the gate
- `platform_skipped_cases`: `[{id, detail}]` for accepted platform-unavailable skips

`gate.reason` priority: `failed_cases` → precheck diagnostic code → `required_cases_skipped` → `incomplete_coverage`. See [CLI JSON Output](/specs/cli-json-output).

With a registry, `data` also includes `environment_evidence`: `target`, `deploy_id`, `ref`, `deploy_env_confirmed`, `env_evidence`, `mismatched_case_ids`, `missing_case_ids`, `fresh_results`, `verified` and `ledger_written`.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `logos/logos.config.json not found` | Not in the project root | `cd` to the project root |
| `SMOKE_*` precondition codes | See [Preconditions](#preconditions) | Follow the fix in that table |
| `No smoke results found at ...` (`NO_SMOKE_RESULTS`) | The results file does not exist | Configure `smoke.command`, or run the smoke runner first |
| `No smoke case specs found` (`NO_SMOKE_CASES`) | `logos/resources/test/smoke/` has no smoke IDs | Write smoke case specs first (deployment-designer / test-writer) |

## Related

- [`verify`](/cli/verify): test acceptance (Gate 3.6, before deployment)
- [`deploy-done`](/cli/deploy-done): record deployment completion (Gate 3.7)
- [`deploy`](/cli/deploy) / [`env`](/cli/env): run deployments and see each environment's last deploy and smoke
- [`status`](/cli/status): shows the smoke gate state in the proposal lifecycle
- [`archive`](/cli/archive): archive the proposal after smoke passes
