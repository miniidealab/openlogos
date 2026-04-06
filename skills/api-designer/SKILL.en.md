# Skill: API Designer

> Design OpenAPI 3.0+ YAML specifications based on sequence diagrams, letting APIs emerge naturally from scenarios rather than being defined in isolation. Every endpoint is traceable to a Step number in the sequence diagrams, ensuring "no scenario, no API design."

## Trigger Conditions

- User requests API design or API documentation
- User mentions "Phase 3 Step 2" or "API design"
- Scenario sequence diagrams already exist and API specifications need to be refined
- User provides a specific API endpoint that needs detailed design

## Prerequisites

- `logos/resources/prd/3-technical-plan/2-scenario-implementation/` contains scenario sequence diagrams
- `logos/resources/prd/3-technical-plan/1-architecture/` contains the architecture overview (confirming frontend-backend separation approach, authentication scheme, etc.)
- `tech_stack` in `logos-project.yaml` is filled in

If the sequence diagram directory is empty, prompt the user to complete Phase 3 Step 1 (scenario-architect) first.

## Core Capabilities

1. Extract all cross-system-boundary API calls from sequence diagrams
2. Deduplicate, merge, and group by domain to form an endpoint inventory
3. Design OpenAPI 3.0+ YAML specifications (paths, parameters, request bodies, response structures)
4. Define a unified error response format and error code system
5. Design authentication schemes (Bearer Token / API Key / Cookie)
6. Design standardized parameters for pagination, sorting, and filtering

## Execution Steps

### Step 1: Read Scenario Context

Read the following files to establish complete context:

- **Scenario sequence diagrams** (`logos/resources/prd/3-technical-plan/2-scenario-implementation/`): Extract all cross-system-boundary arrows
- **Architecture overview** (`logos/resources/prd/3-technical-plan/1-architecture/`): Confirm authentication scheme, frontend-backend separation approach, API gateway, etc.
- **`logos-project.yaml`**: Read `tech_stack` to confirm backend framework and deployment approach

### Step 2: Extract Endpoint Inventory

Traverse all scenario sequence diagrams and collect every cross-system-boundary call arrow:

1. Identify "cross-system-boundary" arrows — client to server, server to external service, inter-service calls
2. For each arrow, extract: HTTP method, path, source scenario number, and Step number
3. Deduplicate and merge — the same endpoint may appear in multiple scenarios (e.g., `POST /api/auth/login` may appear in both S02 and S03)
4. Output an endpoint inventory summary for user confirmation:

```markdown
Identified N API endpoints from sequence diagrams:

| # | Method | Path | Source Scenario | Domain |
|---|--------|------|-----------------|--------|
| 1 | POST | /api/auth/register | S01 Step 2 | auth |
| 2 | POST | /api/auth/login | S02 Step 1 | auth |
| 3 | GET  | /api/projects | S04 Step 1 | projects |
```

### Step 3: Group by Domain

Group endpoints by business domain, with each group corresponding to a YAML file:

- `auth.yaml` — Authentication-related (registration, login, logout, password reset)
- `projects.yaml` — CRUD for core business entities
- `billing.yaml` — Payment and subscriptions

Grouping principles:
- Operations on the same data entity go together
- Authentication/authorization is a separate group
- Third-party service callbacks (e.g., payment callbacks) go under the corresponding business domain

### Step 4: Design Unified Conventions

Before generating specific endpoints, establish global conventions:

**Authentication scheme** (read from architecture overview):

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

**Unified error response**:

```yaml
components:
  schemas:
    ErrorResponse:
      type: object
      required: [code, message]
      properties:
        code:
          type: string
          description: Machine-readable error code (e.g., EMAIL_EXISTS)
        message:
          type: string
          description: Human-readable error description
        details:
          type: object
          description: Additional error information (e.g., field-level validation errors)
```

**Pagination parameters** (applicable to list endpoints):

```yaml
parameters:
  - name: page
    in: query
    schema: { type: integer, minimum: 1, default: 1 }
  - name: per_page
    in: query
    schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
```

### Step 5: Design Detailed Specification per Endpoint

Design a complete OpenAPI specification for each endpoint, **output by domain**, pausing after each domain for user review:

Each endpoint must include:
- `operationId`: Unique identifier for code generation
- `summary`: One-sentence description
- `description`: Annotate the source sequence diagram step (e.g., `Source: S01 Step 2 → Step 3`)
- `requestBody`: Schema including all fields (with required, types, validation rules such as minLength/format)
- `responses`: Cover the normal response + all known exceptions (extracted from EX use cases in sequence diagrams)

**Example**:

```yaml
paths:
  /api/auth/register:
    post:
      operationId: register
      summary: User registration
      description: "Source: S01 Step 2 → Step 3"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email: { type: string, format: email }
                password: { type: string, minLength: 8 }
      responses:
        '201':
          description: Registration successful, verification email sent
          content:
            application/json:
              schema:
                type: object
                properties:
                  userId: { type: string, format: uuid }
                  message: { type: string }
        '409':
          description: "Email already registered (EX-2.1)"
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '422':
          description: Request parameter validation failed
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
```

### Step 6: Verify Traceability Completeness

After output is complete, perform a traceability check:

1. **Forward check**: Every cross-system arrow in the sequence diagrams has a corresponding API endpoint
2. **Reverse check**: Every API endpoint's `description` annotates the source Step
3. **Exception coverage**: Every EX use case in the sequence diagrams has a corresponding HTTP error response

If gaps are found, supplement them before outputting the final version.

## Output Specification

- File format: OpenAPI 3.1 YAML
- Storage location: `logos/resources/api/`
- Split by domain: `auth.yaml`, `projects.yaml`, `billing.yaml`
- Each file contains complete `openapi`, `info`, `paths`, and `components` sections
- Error responses uniformly reference `$ref: '#/components/schemas/ErrorResponse'`
- Every endpoint's `description` must annotate the source sequence diagram step

## Best Practices

- **APIs emerge from sequence diagrams**: If an API cannot be traced back to a sequence diagram, it most likely should not exist. Design sequence diagrams first, then APIs — not the other way around
- **Path naming**: RESTful style, use plural nouns, `/api/{resource}`
- **Version prefix**: Do not add a version prefix initially (`/api/auth/register`); add `/api/v2/` when versioning becomes necessary
- **Status code semantics**: Strictly follow HTTP status code semantics — 200 success, 201 created, 400 bad request, 401 unauthorized, 403 forbidden, 404 not found, 409 conflict, 422 validation failed, 500 server error
- **Idempotent design**: PUT/DELETE operations must be idempotent
- **Sensitive data**: Do not include plaintext sensitive information such as passwords or tokens in responses
- **Output by domain**: Do not output all endpoints at once — output in batches by domain, letting the user review each batch before continuing
- **Consistent field naming**: Field names in the API should be consistent with column names in the subsequent DB design (or have explicit mapping rules) to avoid unnecessary field transformations in the code layer

## Recommended Prompts

The following prompts can be copied directly for use with the AI:

- `Help me design APIs`
- `Generate OpenAPI YAML based on the sequence diagrams`
- `Help me design the API specifications related to S01`
- `Help me extract all cross-system calls from the sequence diagrams into APIs`
