# S01 — Auth test case IDs

Reference list for `openlogos verify` (IDs must appear in `test-results.jsonl`).

| ID | Intent |
|----|--------|
| UT-S01-01 | Register new user returns 201 with token |
| UT-S01-02 | Duplicate email returns 409 |
| UT-S01-03 | Login with correct password returns 200 |
| UT-S01-04 | Login with wrong password returns 401 |
| ST-S01-01 | Register then login end-to-end |
