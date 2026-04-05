# S02 — Task CRUD test case IDs

Reference list for `openlogos verify` (IDs must appear in `test-results.jsonl`).

| ID | Intent |
|----|--------|
| UT-S02-01 | POST /tasks creates task with pending status |
| UT-S02-02 | GET /tasks returns empty list for new user |
| UT-S02-03 | GET /tasks/:id returns task |
| UT-S02-04 | PATCH /tasks/:id updates fields |
| UT-S02-05 | DELETE /tasks/:id returns 204 |
| ST-S02-01 | Full CRUD flow with JWT |
