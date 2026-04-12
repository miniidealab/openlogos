---
title: "openlogos verify"
description: Verify test results against test case specs and generate an acceptance report (Gate 3.5).
---

Read test results from a JSONL file, compare against defined test case IDs in `logos/resources/test/`, validate three layers of coverage, and generate an acceptance report. This is the **Gate 3.5** quality check.

## Synopsis

```bash
openlogos verify
```

No arguments or options. Must be run from the project root.

## What it checks

The verification runs three layers of validation:

### Layer 1: Runtime test results

Reads `logos/resources/verify/test-results.jsonl` (or a custom path from `logos.config.json`) and counts pass/fail/skip/uncovered.

### Layer 2: Design-time coverage checklist

Parses the "覆盖度校验" (Coverage Validation) checklist from `*-test-cases.md` files. These are assertions made by AI at test-design time — e.g., "All S02 exception cases are covered."

### Layer 3: Acceptance criteria traceability

Parses the "验收条件追溯" (Acceptance Criteria Traceability) table from test case files. Each acceptance criterion (e.g., `S01-AC-01`) is linked to specific test case IDs, and the runtime results are checked to confirm they pass.

## Gate 3.5 pass criteria

All four conditions must be met:

| Condition | Description |
|-----------|-------------|
| Zero failed tests | No test result has `status: "fail"` |
| 100% coverage | Every ID defined in test specs has a corresponding result |
| Checklist complete | All `- [x]` items in the design-time checklist are checked |
| AC traceability | All acceptance criteria have linked test cases that pass |

If any condition fails, the command exits with code `1`.

## Test results format (JSONL)

Each line in `test-results.jsonl` is a JSON object:

```json
{"id":"UT-S01-01","status":"pass","duration_ms":12,"timestamp":"2026-04-10T10:00:00Z"}
{"id":"UT-S01-02","status":"fail","duration_ms":5,"error":"Expected 201, got 400"}
{"id":"ST-S02-01","status":"skip","scenario":"S02"}
```

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| `id` | Yes | `UT-SXX-XX` or `ST-SXX-XX` | Test case ID matching the test spec |
| `status` | Yes | `pass`, `fail`, `skip` | Test result |
| `duration_ms` | No | number | Execution time |
| `timestamp` | No | ISO 8601 | When the test ran |
| `error` | No | string | Error message (for failed tests) |
| `scenario` | No | string | Scenario identifier |

If the same `id` appears multiple times (e.g., from re-runs), the **last occurrence** wins.

## Test case ID detection

The command scans all `*-test-cases.md` files in `logos/resources/test/` for IDs matching the pattern:

```
UT-S01-01    (Unit Test, Scenario 01, Case 01)
ST-S02-03    (Scenario Test, Scenario 02, Case 03)
```

The regex: `/\b(UT|ST)-S\d{2}-\d{2,3}\b/`

## Example output (PASS)

```
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
  Pass rate: 77%  (86/111)
──────────────────────────────────────────────────

📋 Design-time Coverage (Layer 1)
  Checklist: 8/8 assertions confirmed

🔗 Acceptance Criteria Traceability (Layer 3)
  AC traceability: 16/16 criteria passed

✅ Gate 3.5: PASS

📄 Report: logos/resources/verify/acceptance-report.md
```

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
  Pass rate: 77%  (84/109)
──────────────────────────────────────────────────

❌ Failed cases:
  UT-S02-04  Expected HTTP 302, got 301
  UT-S04-12  Token verification returned false for valid token

⚠️  Uncovered cases (2):
  ST-S03-05
  ST-S03-06

❌ Gate 3.5: FAIL

📄 Report: logos/resources/verify/acceptance-report.md
```

## Acceptance report

The command generates `logos/resources/verify/acceptance-report.md` containing:

- **Summary table** — defined/executed/passed/failed/skipped/uncovered/coverage/pass-rate/gate result
- **Failed cases** — ID and error message for each
- **Uncovered cases** — IDs not found in test results
- **Skipped cases** — IDs with `status: "skip"`
- **Design-time coverage** — checklist assertion table with ✅/❌
- **AC traceability** — acceptance criteria → linked test cases → runtime status

## Custom result path

Override the default JSONL path in `logos.config.json`:

```json
{
  "verify": {
    "result_path": "test-output/results.jsonl"
  }
}
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `No test results found at ...` | JSONL file doesn't exist | Run your tests first (they should output to `test-results.jsonl`) |
| `No test case specs found` | `logos/resources/test/` is empty | Run test design (Phase 3-3a) first |
| `logos/logos.config.json not found` | Not in project root | `cd` to project root |
| Exit code `1` | Gate 3.5 FAIL | Fix failing tests, add missing coverage, or complete the checklist |

## Related commands

- [`status`](/cli/status) — Check if Phase 3-5 (verification) is complete
- [`launch`](/cli/launch) — Typically run after `verify` passes, to activate change management
