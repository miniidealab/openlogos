# TaskFlow API — Product Requirements

> Phase 1 · WHY — Reference demo for OpenLogos

## 1. Product intent

TaskFlow is a **minimal task API** used to demonstrate the full OpenLogos pipeline: requirements → design → scenarios → OpenAPI → DDL → tests → implementation → `openlogos verify`.

**Non-goals (v0.1):** multi-tenancy, OAuth providers, real-time sync, file attachments.

## 2. Personas

- **Demo visitor:** Wants to see realistic artifacts and run tests locally without external services.
- **Learner:** Clones the repo to study how methodology maps to files and code.

## 3. Scenarios

### S01 — User authentication

Users register with email + password and receive a JWT for subsequent API calls.

#### Acceptance criteria

| ID | GIVEN | WHEN | THEN |
|----|-------|------|------|
| S01-AC-01 | No existing account for `email` | Client `POST /auth/register` with valid email and password (≥8 chars) | `201` and body contains `user.id`, `user.email`, `token` |
| S01-AC-02 | Account already exists for `email` | Client registers again with same email | `409` and error message indicates conflict |
| S01-AC-03 | Account exists and password correct | Client `POST /auth/login` | `200` and same shape as register response |
| S01-AC-04 | Account exists but password wrong | Client `POST /auth/login` | `401` and generic invalid-credentials message |

### S02 — Task CRUD (per user)

Authenticated users manage tasks scoped to their user id (`title`, `status`: `pending` | `done`).

#### Acceptance criteria

| ID | GIVEN | WHEN | THEN |
|----|-------|------|------|
| S02-AC-01 | Valid JWT, body `{ "title": "…" }` | `POST /tasks` | `201` and task has `pending` status |
| S02-AC-02 | Valid JWT, user has no tasks | `GET /tasks` | `200` and `tasks` is an empty array |
| S02-AC-03 | Valid JWT, task belongs to user | `GET /tasks/{id}` | `200` and task JSON |
| S02-AC-04 | Valid JWT, task belongs to user | `PATCH /tasks/{id}` with allowed fields | `200` and updated task |
| S02-AC-05 | Valid JWT, task belongs to user | `DELETE /tasks/{id}` | `204` |
| S02-AC-06 | Valid JWT, task id belongs to another user or missing | `GET/PATCH/DELETE /tasks/{id}` | `404` |

## 4. Constraints

- Passwords stored as salted hash (bcrypt); never return password or hash in API responses.
- JWT signed with HS256; secret configurable via `TASKFLOW_JWT_SECRET`.
- SQLite file under `./data/taskflow.db` for local dev (gitignored); tests use in-memory DB.
