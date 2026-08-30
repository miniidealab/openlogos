---
description: Run test verification and generate acceptance report with three-layer traceability
---

Verify test results against test case specs and generate an acceptance report.

1. Run `openlogos verify` in the project root directory.
2. If the `openlogos` CLI is not found, tell the user to install it:
   ```
   npm install -g @miniidealab/openlogos
   ```
3. The verify command reads `logos/resources/verify/test-results.jsonl` and matches results against test case specs in `logos/resources/test/`.
4. It generates a three-layer acceptance report:
   - Layer 1: Design-time coverage (are all test cases defined?)
   - Layer 2: Runtime coverage (did all tests run?)
   - Layer 3: Acceptance criteria (did all tests pass?)
5. Display the report output to the user.
