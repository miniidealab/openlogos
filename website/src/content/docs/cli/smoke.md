---
title: "openlogos smoke"
description: Run post-deployment smoke verification against smoke test case specs (Gate 3.8).
---

Validate deployment health by reading smoke test results from a JSONL file, comparing against defined smoke case IDs in `logos/resources/test/smoke/`, and generating a smoke report. This is the **Gate 3.8** quality check — run after deployment execution (Phase 3-7).

## Synopsis

```bash
openlogos smoke [--format json] [--environment <name>]
```

Must be run from the project root.

## Options

| Option | Description |
|--------|-------------|
| `--format json` | Output machine-readable JSON envelope (includes `sandbox` diagnostics). |
| `--environment <name>` | Tag the smoke report with an environment label (e.g., `staging`, `production`). |

## What it does

1. Reads `logos.config.json` for smoke configuration (`smoke.command`, `smoke.result_path`, `smoke.report_path`)
2. If `smoke.command` is configured, executes it (optionally sandboxed)
3. Reads smoke results from `logos/resources/verify/smoke-results.jsonl` (or custom path)
4. Scans `logos/resources/test/smoke/*.md` for defined smoke case IDs (pattern: `SMOKE-<name>-<number>`)
5. Compares results against defined cases — calculates coverage, pass rate
6. Generates `logos/resources/verify/smoke-report.md`
7. Writes proposal markers (`SMOKE_PASS` / `SMOKE_FAIL`) if an active change proposal exists

## Smoke configuration

Configure in `logos/logos.config.json`:

```json
{
  "smoke": {
    "command": "cd website && npm run build && node scripts/smoke-releases.mjs",
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
| `command` | *(none)* | Shell command to run smoke tests (writes results to `result_path`) |
| `result_path` | `logos/resources/verify/smoke-results.jsonl` | Path to smoke results JSONL |
| `report_path` | `logos/resources/verify/smoke-report.md` | Path to generated report |
| `sandbox_mode` | `auto` | Sandbox isolation mode (`off` / `auto` / `always`) |

## Gate 3.8 pass criteria

Both conditions must be met:

| Condition | Description |
|-----------|-------------|
| Zero failed cases | No smoke result has `status: "fail"` |
| 100% coverage | Every ID defined in smoke specs has a corresponding result |

If either condition fails, the command exits with code `1`.

## Smoke case ID format

The command scans `logos/resources/test/smoke/*.md` for IDs matching:

```
SMOKE-releases-01    (Smoke test, releases domain, case 01)
SMOKE-cli-install-02 (Smoke test, cli-install domain, case 02)
```

The regex: `/\bSMOKE-[A-Za-z0-9-]+-\d{2,3}\b/`

## Smoke results format (JSONL)

Each line in `smoke-results.jsonl` is a JSON object:

```json
{"id":"SMOKE-releases-01","status":"pass","duration_ms":1200,"timestamp":"2026-05-28T10:00:00Z"}
{"id":"SMOKE-releases-02","status":"fail","error":"Expected 200, got 404","duration_ms":500}
```

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| `id` | Yes | `SMOKE-*-XX` | Smoke case ID matching the spec |
| `status` | Yes | `pass`, `fail`, `skip` | Test result |
| `duration_ms` | No | number | Execution time |
| `timestamp` | No | ISO 8601 | When the test ran |
| `error` | No | string | Error message (for failed cases) |

## Proposal lifecycle integration

When an active change proposal exists (`.openlogos-guard`), `openlogos smoke` writes markers:

| Gate result | Marker written |
|-------------|---------------|
| PASS | `logos/changes/<slug>/SMOKE_PASS` |
| FAIL | `logos/changes/<slug>/SMOKE_FAIL` |

These markers advance the proposal step:
- `SMOKE_PASS` → proposal is ready to archive
- `SMOKE_FAIL` → fix deployment issues and re-run smoke

## Example output (PASS)

```
🔎 OpenLogos Smoke Verification

  Environment: staging
  Defined:  5
  Executed: 5
  Passed:   5
  Failed:   0
  Skipped:  0
  Coverage: 100%
  Pass rate: 100%

✅ Gate 3.8: PASS

📄 Report: logos/resources/verify/smoke-report.md
```

## Example output (FAIL)

```
🔎 OpenLogos Smoke Verification

  Defined:  5
  Executed: 4
  Passed:   3
  Failed:   1
  Skipped:  0
  Coverage: 80%
  Pass rate: 75%

Failed smoke cases:
  SMOKE-releases-03  Expected 200, got 404

Uncovered smoke cases:
  SMOKE-cli-install-02

❌ Gate 3.8: FAIL

📄 Report: logos/resources/verify/smoke-report.md
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `logos/logos.config.json not found` | Not in project root | `cd` to project root |
| `No smoke results found at ...` | JSONL file doesn't exist | Run smoke tests first (or configure `smoke.command`) |
| `No smoke case specs found` | `logos/resources/test/smoke/` is empty | Write smoke test case specs first (deployment-designer Skill) |

## Related commands

- [`verify`](/cli/verify) — Test acceptance verification (Gate 3.5, run before deployment)
- [`status`](/cli/status) — Shows smoke gate status in proposal lifecycle
- [`archive`](/cli/archive) — Archive proposal after smoke passes
