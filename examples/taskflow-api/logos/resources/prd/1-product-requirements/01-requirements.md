# TaskFlow — Product requirements (v0.1)

> Last updated: 2026-04-05

## 1. Product intent

TaskFlow is a **minimal task API** used to demonstrate the full OpenLogos pipeline: requirements → design → scenarios → OpenAPI → DDL → tests → implementation → `openlogos verify`.

**Primary outcomes**

- Provide a **small but realistic** HTTP API that a visitor can run and test **locally** without paid or third-party runtime dependencies (beyond what the sample stack already needs, e.g. a local DB).
- Provide **traceable artifacts** (PRD, design, scenarios, OpenAPI, schema, tests, code) so a learner can see **how methodology maps to files and behavior**.

**Non-goals (v0.1)**

- Multi-tenancy (organizations, teams, billing).
- OAuth / social login or multiple identity providers.
- Real-time sync (WebSockets, SSE, collaborative editing).
- File attachments, comments, labels, or rich task metadata beyond what v0.1 explicitly specifies.

## 2. Personas

| Persona | Who they are | What they need |
|--------|----------------|----------------|
| **Demo visitor** | Someone skimming the repo or a workshop | Run the API and tests locally with minimal setup; see believable API and DB shapes. |
| **Learner** | Someone studying OpenLogos | Follow the chain from requirements to code; reproduce or extend the sample safely. |

## 3. Goals and success measures

- **G1 — Runnable demo:** From a clean clone, documented steps install dependencies, apply schema/migrations as documented, start the API, and execute the project’s automated tests successfully on a developer machine.
- **G2 — Pipeline completeness:** The repository contains the methodology outputs in expected locations (e.g. PRD, product design, scenario specs, OpenAPI, DDL, test cases, implementation) and `openlogos verify` (when used as documented) reflects that consistency.
- **G3 — Clarity over features:** Scope stays small; any ambiguity is resolved in favor of **teachability** and **deterministic tests**, not product breadth.

## 4. User pain analysis

### P01 — “I can’t see the whole methodology without a real example”

Because end-to-end methodology docs are abstract → teams struggle to see how phases connect → they skip steps or misplace artifacts.  
**TaskFlow** addresses this by being the **reference slice** with concrete files and behavior.

### P02 — “I don’t know which file or test corresponds to which step”

Because samples are often toy scripts or incomplete → learners cannot map **scenario → API → DB → tests → code**.  
**TaskFlow** addresses this by keeping **stable scenario IDs** and **named artifacts** aligned across phases.

## 5. Scenario overview

| ID | Scenario name | Trigger | Pain | Priority |
|----|----------------|---------|------|----------|
| S01 | Identity: register, log in, and call an authenticated endpoint | User onboards and uses the API with a token | P01, P02 | P0 |
| S02 | Task lifecycle: create, list, read, update, delete own tasks | User manages personal tasks via the API | P01, P02 | P0 |

## 6. Core scenarios (acceptance)

### S01: Identity — register, log in, authenticated access

- **Trigger:** A client needs to act as a single user and access protected task endpoints.
- **User value:** Establishes a minimal, self-contained auth model for the demo (no external IdP).
- **Priority:** P0
- **Main path:** Register with email + password → receive success → log in → receive a bearer token → call a protected endpoint with `Authorization: Bearer <token>` and succeed.

#### Acceptance criteria

##### Happy path: register then login

- **GIVEN** the API is running and the email is not yet registered  
- **WHEN** the client registers with a valid email and an acceptable password policy  
- **THEN** the user record exists and the client can log in and obtain a token  

##### Happy path: authenticated request

- **GIVEN** a valid access token for a user  
- **WHEN** the client calls a protected endpoint with that token  
- **THEN** the API responds with `2xx` (for allowed operations) and does not treat the caller as anonymous  

##### Error: duplicate registration

- **GIVEN** an email is already registered  
- **WHEN** the client attempts to register again with the same email  
- **THEN** the API rejects the request with a clear error and does not create a duplicate user  

##### Error: invalid credentials

- **GIVEN** a registered user  
- **WHEN** the client attempts to log in with a wrong password  
- **THEN** the API rejects login with a clear error and does not issue a valid token  

##### Error: missing or invalid token

- **GIVEN** a protected endpoint  
- **WHEN** the client calls it without a token or with an invalid/expired token  
- **THEN** the API responds with `401` (or documented equivalent) and performs no mutation  

---

### S02: Task lifecycle — CRUD for the authenticated user’s tasks

- **Trigger:** A logged-in user wants to manage tasks through the API.
- **User value:** Demonstrates resource modeling, ownership, persistence, and orchestrated tests.
- **Priority:** P0
- **Main path:** Create a task → list tasks (sees it) → get by id → update fields → delete → confirm gone.

#### Acceptance criteria

##### Happy path: create and list

- **GIVEN** an authenticated user with no tasks (or a known empty filter)  
- **WHEN** the client creates a task with required fields  
- **THEN** the task is persisted, has a stable identifier, and appears in that user’s list  

##### Happy path: read and update

- **GIVEN** a task owned by the user  
- **WHEN** the client updates allowed fields (as specified in v0.1 design)  
- **THEN** subsequent reads reflect the update  

##### Happy path: delete

- **GIVEN** a task owned by the user  
- **WHEN** the client deletes the task  
- **THEN** subsequent get/list no longer returns it (with documented semantics for `404` vs empty list)  

##### Error: access another user’s task

- **GIVEN** user A and user B each have tasks  
- **WHEN** user A attempts to read/update/delete user B’s task by id  
- **THEN** the API denies access with `404` or `403` per documented security UX (must be consistent in OpenAPI + tests)  

##### Error: validation

- **GIVEN** create/update endpoints  
- **WHEN** the client sends payloads missing required fields or violating documented constraints  
- **THEN** the API responds with `4xx` and does not persist invalid data  

## 7. Functional requirements (v0.1 summary)

- **FR1:** Users can **register** and **log in** with email + password; passwords are handled securely (hashed at rest); sessions/tokens are sufficient for demo use and documented.
- **FR2:** Authenticated users can **create, list, read, update, and delete** tasks that **belong to them**.
- **FR3:** All public HTTP behavior is described in **OpenAPI** and covered by **automated tests** aligned with scenario orchestration (S01/S02).
- **FR4:** Persistence is defined by **DDL/schema** in-repo; local run instructions are sufficient for Demo visitor and Learner personas.

## 8. Non-functional requirements

- **NFR1 — Local-first:** No mandatory dependency on external SaaS for core flows in v0.1.
- **NFR2 — Determinism:** Tests are repeatable; time-sensitive behavior (e.g. token expiry) is documented and test-controlled where applicable.
- **NFR3 — Teachability:** Prefer explicit errors, small surfaces, and consistent naming over feature richness.

## 9. Constraints and boundaries

- **Methodology constraint:** Implementation and tests should remain traceable to **S01** and **S02** and to upstream design artifacts.
- **Scope constraint:** Anything listed under **Non-goals (v0.1)** is out of scope unless promoted via a formal change (OpenLogos delta / change proposal), not ad hoc.

## 10. Open questions (optional follow-up)

- Exact **password policy** (length, complexity) and **token lifetime** — to be fixed in product/technical design if not already decided.
- Minimal **task model** fields (e.g. title, status, due date) — finalize in Phase 2 feature specs to avoid churn in OpenAPI/DDL.
