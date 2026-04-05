---
title: "openlogos verify"
description: Verify test results against acceptance criteria.
---

Read test results (JSONL format), compare against defined test cases, and generate an acceptance report.

## Usage

```bash
openlogos verify
```

## What it checks

- **Test pass rate**: All tests must pass (100%)
- **Design-time coverage**: All checklist items in test-cases.md must be checked
- **Acceptance criteria traceability**: All AC entries must map to passing tests

## Output

Generates `logos/resources/verify/acceptance-report.md` with detailed results.

*Detailed content coming in Batch 2.*
