# TaskFlow — API surface (Phase 2 · WHAT)

> API-first product design for a backend-only demo.

## Resources

| Resource | Description |
|----------|-------------|
| User | `id`, `email` (exposed); `password_hash` internal only |
| Task | `id`, `userId`, `title`, `status`, `createdAt` |

## Endpoints (summary)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/register` | No | Create user, return JWT |
| POST | `/auth/login` | No | Verify credentials, return JWT |
| POST | `/tasks` | Bearer JWT | Create task |
| GET | `/tasks` | Bearer JWT | List current user’s tasks |
| GET | `/tasks/:id` | Bearer JWT | Get one task |
| PATCH | `/tasks/:id` | Bearer JWT | Update `title` and/or `status` |
| DELETE | `/tasks/:id` | Bearer JWT | Remove task |

## Errors

- `400` — malformed JSON or validation (e.g. short password, empty title).
- `401` — missing/invalid JWT on task routes; bad credentials on login.
- `404` — task not found or not owned by user.
- `409` — duplicate email on register.

Canonical contract: [`openapi.yaml`](../../../api/openapi.yaml).
