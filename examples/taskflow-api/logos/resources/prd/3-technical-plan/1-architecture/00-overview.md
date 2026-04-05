# TaskFlow — Architecture overview

> Phase 3 Step 0 · HOW

## Stack

- **Runtime:** Node.js 18+
- **HTTP:** Hono 4 on `@hono/node-server`
- **DB:** SQLite via `better-sqlite3` + Drizzle ORM
- **Auth:** bcrypt password hashing; JWT (HS256) via `jose`
- **Tests:** Vitest; results reported to `logos/resources/verify/test-results.jsonl` per OpenLogos spec

## Layout

```
src/
  index.ts          # HTTP server bootstrap + data dir
  app.ts            # Hono app factory (createApp(db))
  db/
    schema.ts       # Drizzle tables (source of truth for types)
    client.ts       # DB factory + runs logos/resources/database/schema.sql
  lib/
    jwt.ts
    password.ts
```

## Security notes

- Default JWT secret is for **local demo only**; override `TASKFLOW_JWT_SECRET` in any shared environment.
- CORS is enabled for developer convenience; tighten for production deployments.

## Alignment

- REST shapes and status codes match [`openapi.yaml`](../../../api/openapi.yaml).
- DDL in [`schema.sql`](../../../database/schema.sql) matches Drizzle schema.
