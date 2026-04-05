# TaskFlow API — OpenLogos reference demo

Minimal REST API (**Hono + SQLite + JWT**) that demonstrates a full OpenLogos paper trail under `logos/resources/` plus runnable code and tests.

## What’s inside

- **Phase 1–2:** PRD and API surface in `logos/resources/prd/`
- **Phase 3:** Scenarios (`S01` auth, `S02` tasks), OpenAPI, DDL, test-case specs, orchestration JSON
- **Implementation:** `src/` — `createApp(db)` for production or tests
- **Tests:** Vitest + OpenLogos JSONL reporter → `logos/resources/verify/test-results.jsonl`

## Prerequisites

- Node.js **≥ 18**
- OpenLogos CLI built from this monorepo (for `verify`):

```bash
cd ../../cli && npm install && npm run build
```

## Setup

```bash
cd examples/taskflow-api
npm install
```

## Run API locally

```bash
mkdir -p data
npm run dev
```

Server defaults to `http://localhost:3000`. SQLite file: `data/taskflow.db` (gitignored).

Environment:

- `PORT` — default `3000`
- `TASKFLOW_JWT_SECRET` — set in any non-local deployment
- `TASKFLOW_DB_PATH` — optional override for SQLite path (tests use `:memory:` internally)

## Test + verify

```bash
npm test
npm run verify
```

`npm test` clears `logos/resources/verify/test-results.jsonl`, runs all cases, and appends one JSON line per `UT-*` / `ST-*` ID. `npm run verify` reads those results and writes `logos/resources/verify/acceptance-report.md`.

## Project layout

```
logos/
  logos.config.json
  logos-project.yaml
  resources/
    prd/ …
    api/openapi.yaml
    database/schema.sql
    test/*-test-cases.md
    scenario/*.json
    verify/   (generated: test-results.jsonl, acceptance-report.md)
src/
  app.ts
  index.ts
  db/
  lib/
test/
  integration.test.ts
  global-setup.ts
  report.ts
```

## Learn more

- Methodology scenario spec: [`../../logos/resources/prd/3-technical-plan/2-scenario-implementation/S18-tour.md`](../../logos/resources/prd/3-technical-plan/2-scenario-implementation/S18-tour.md) (website Tour module)
- Test result format: [`../../spec/test-results.md`](../../spec/test-results.md)
