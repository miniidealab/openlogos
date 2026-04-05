---
title: Test Results Format
description: The JSONL format specification for cross-framework test result reporting.
---

OpenLogos defines a standard JSONL (JSON Lines) format for test results that works across any programming language and test framework.

## Format

Each line is a JSON object with the following fields:

```json
{"id": "UT-S01-001", "status": "pass", "duration_ms": 12, "timestamp": "2026-04-01T00:00:00Z"}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Test case ID matching pattern `(UT|ST)-S\d{2}-\d{2,3}` |
| `status` | string | Yes | `pass`, `fail`, or `skip` |
| `duration_ms` | number | No | Execution time in milliseconds |
| `timestamp` | string | No | ISO 8601 timestamp |
| `error` | string | No | Error message (for `fail` status) |

*Detailed content coming in Batch 2.*
