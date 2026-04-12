---
title: Test Results Format
description: The JSONL format specification for cross-framework test result reporting used by openlogos verify.
---

OpenLogos defines a standard JSONL (JSON Lines) format for test results that works across any programming language and test framework. AI embeds a small reporter in generated test code; `openlogos verify` reads the output to perform automated acceptance.

## Design Rationale

OpenLogos does not bind to any test framework. Instead, **AI embeds a lightweight reporter (~20 lines) into generated test code** that writes each case result to a unified format file. `openlogos verify` only needs to parse this one format.

Key advantages:

| Property | Benefit |
|----------|---------|
| Zero framework dependency | vitest, jest, pytest, go test, cargo test all produce the same format |
| Zero adaptation cost | `openlogos verify` parses exactly one format |
| AI-native | Reporter code is under 20 lines — AI writes it alongside test code |
| Native case IDs | No regex extraction from test names — ID is a first-class data field |

## File Path

Default path:

```
logos/resources/verify/test-results.jsonl
```

Customizable via `logos.config.json` → `verify.result_path`.

## Format: JSONL

The file uses **JSONL** (JSON Lines) — one independent JSON object per line, separated by newlines.

Why JSONL over a JSON array:

| Property | JSONL | JSON Array |
|----------|-------|------------|
| Append writes | Direct append one line | Must maintain closing bracket |
| Streaming reads | Parse line by line | Must read entire file |
| Partial corruption | One broken line doesn't affect others | Mismatched brackets break the whole file |
| Cross-language writes | `JSON.stringify(obj) + "\n"` | Must manually manage commas and brackets |

## Field Definitions

Each line is a JSON object with the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Case ID, exactly matching `UT-xx` / `ST-xx` from `test-cases.md` |
| `status` | `"pass"` \| `"fail"` \| `"skip"` | Yes | Execution result |
| `duration_ms` | number | No | Execution time in milliseconds |
| `timestamp` | string (ISO 8601) | No | Execution time, e.g., `2026-04-03T15:30:01Z` |
| `error` | string | Required when `status=fail` | Failure reason (assertion error message) |
| `scenario` | string | No | Scenario ID (e.g., `S01`), for ID prefix consistency validation |

### Example

```jsonl
{"id":"UT-S01-01","status":"pass","duration_ms":12,"timestamp":"2026-04-03T15:30:01Z"}
{"id":"UT-S01-02","status":"fail","duration_ms":45,"timestamp":"2026-04-03T15:30:01Z","error":"Expected exit code 0, got 1"}
{"id":"UT-S01-03","status":"skip","timestamp":"2026-04-03T15:30:01Z"}
{"id":"ST-S01-01","status":"pass","duration_ms":230,"timestamp":"2026-04-03T15:30:02Z","scenario":"S01"}
```

### Field Constraints

- `id` must match regex `^(UT|ST)-S\d{2}-\d{2,3}$`
- `status` allows only three values: `pass`, `fail`, `skip`
- `error` is required when `status=fail`, optional otherwise
- If the same `id` appears multiple times (e.g., retries), `openlogos verify` uses the **last occurrence**

## Runtime Conventions

### Truncation Strategy

Before each full test run, the reporter should **truncate** the results file to ensure it only contains the latest run's results. Recommended approaches:

- Truncate in the test suite's `globalSetup` or equivalent hook
- Or truncate during the reporter's initialization phase

### Directory Creation

The reporter must ensure `logos/resources/verify/` exists before writing (`mkdir -p` equivalent).

### Batch Execution Convention (Large Tasks)

When Phase 3 Step 4 uses "batch generation", the reporter still outputs results on a per-run basis, following these constraints:

1. **Case ID alignment** — Before each batch, declare the `UT-xx` / `ST-xx` IDs covered; IDs written in test code must exactly match `logos/resources/test/*.md`
2. **Consistent truncation** — Whether batched or not, truncate the results file before running the batch's full test suite to avoid stale data
3. **Duplicate ID handling** — If the same `id` appears multiple times in one run (retries), `openlogos verify` uses the last record
4. **Per-batch verification** — Run tests and validate JSONL after each batch to catch "business code only, no tests" or ID mismatches early

## Reporter Code Templates

The following are reference implementations for each language. AI selects the appropriate template based on the project's `tech_stack` during Phase 3 Step 4 ([`code-implementor`](/skills/code-implementor) Skill) and embeds it into test code.

### TypeScript (vitest / jest)

````typescript
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const RESULT_PATH = 'logos/resources/verify/test-results.jsonl';
let initialized = false;

function reportResult(
  id: string,
  status: 'pass' | 'fail' | 'skip',
  error?: string,
  durationMs?: number,
) {
  if (!initialized) {
    mkdirSync(dirname(RESULT_PATH), { recursive: true });
    writeFileSync(RESULT_PATH, '');
    initialized = true;
  }
  const record: Record<string, unknown> = {
    id,
    status,
    timestamp: new Date().toISOString(),
  };
  if (durationMs !== undefined) record.duration_ms = durationMs;
  if (error) record.error = error;
  appendFileSync(RESULT_PATH, JSON.stringify(record) + '\n');
}
````

Usage in test cases:

````typescript
import { describe, it, expect } from 'vitest';

describe('S01: CLI Init', () => {
  it('UT-S01-01: should detect project name from package.json', () => {
    const start = Date.now();
    try {
      const result = detectProjectName('/path/to/project');
      expect(result.name).toBe('my-project');
      reportResult('UT-S01-01', 'pass', undefined, Date.now() - start);
    } catch (e) {
      reportResult('UT-S01-01', 'fail', String(e), Date.now() - start);
      throw e;
    }
  });
});
````

### Python (pytest)

````python
# conftest.py
import json
import os
import time
import re
import pytest

RESULT_PATH = "logos/resources/verify/test-results.jsonl"
_initialized = False


def _ensure_file():
    global _initialized
    if not _initialized:
        os.makedirs(os.path.dirname(RESULT_PATH), exist_ok=True)
        open(RESULT_PATH, "w").close()
        _initialized = True


def _extract_test_id(nodeid: str) -> str | None:
    """Extract UT-S01-01 or ST-S01-01 from test function name."""
    match = re.search(r"(UT|ST)_S\d{2}_\d{2,3}", nodeid)
    if match:
        return match.group().replace("_", "-")
    return None


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when == "call":
        _ensure_file()
        test_id = _extract_test_id(item.nodeid)
        if not test_id:
            return
        record = {
            "id": test_id,
            "status": "pass" if report.passed else "fail",
            "duration_ms": round(report.duration * 1000),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        if report.failed:
            record["error"] = str(report.longrepr)[:500]
        with open(RESULT_PATH, "a") as f:
            f.write(json.dumps(record) + "\n")
````

Python test function naming convention — use underscores instead of hyphens:

````python
def test_UT_S01_01_detect_project_name():
    result = detect_project_name("/path/to/project")
    assert result["name"] == "my-project"
````

### Go

````go
package testutil

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const ResultPath = "logos/resources/verify/test-results.jsonl"

var (
	once sync.Once
	mu   sync.Mutex
)

type TestResult struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	DurationMs int64  `json:"duration_ms,omitempty"`
	Timestamp  string `json:"timestamp"`
	Error      string `json:"error,omitempty"`
}

func ReportResult(id, status string, durationMs int64, err string) {
	once.Do(func() {
		os.MkdirAll(filepath.Dir(ResultPath), 0o755)
		os.WriteFile(ResultPath, nil, 0o644)
	})
	r := TestResult{
		ID:         id,
		Status:     status,
		DurationMs: durationMs,
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		Error:      err,
	}
	b, _ := json.Marshal(r)
	mu.Lock()
	defer mu.Unlock()
	f, _ := os.OpenFile(ResultPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o644)
	defer f.Close()
	fmt.Fprintf(f, "%s\n", b)
}
````

## Related Specifications

| Specification | Relationship |
|---------------|-------------|
| [`test-writer`](/skills/test-writer) Skill | Defines case IDs (`UT-xx` / `ST-xx`) — the source for the `id` field in JSONL |
| [`code-implementor`](/skills/code-implementor) Skill | Drives reporter embedding during Step 4 code generation |
| [`test-orchestrator`](/skills/test-orchestrator) Skill | API orchestration tests can also produce JSONL in this format |
| [Project Structure](/specs/project-structure) | Defines the `logos/resources/verify/` directory location |
| `logos.config.json` | `verify.result_path` can override the default path |
| [`openlogos verify`](/cli/verify) | Reads this format and generates the acceptance report |
