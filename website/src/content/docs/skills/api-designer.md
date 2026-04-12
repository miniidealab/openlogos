---
title: api-designer
description: Design OpenAPI specifications derived from sequence diagram cross-boundary calls.
---

Design OpenAPI 3.0+ YAML specifications based on sequence diagrams, letting APIs emerge naturally from scenarios rather than being defined in isolation. Every endpoint is traceable to a Step number in the sequence diagrams, ensuring "no scenario, no API design."

## Phase & Trigger

- **Phase**: Phase 3 — HOW (Implementation), Step 2
- **Trigger conditions**:
  - User requests API design or API documentation
  - User mentions "Phase 3 Step 2" or "API design"
  - Scenario sequence diagrams exist

## Prerequisites

- Sequence diagrams in `logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- Architecture overview in `logos/resources/prd/3-technical-plan/1-architecture/`
- `tech_stack` filled in `logos-project.yaml`

## What It Does

1. Extract all cross-system-boundary API calls from sequence diagrams
2. Deduplicate, merge, and group by domain into an endpoint inventory
3. Design OpenAPI 3.0+ YAML specifications (paths, parameters, request bodies, responses)
4. Define unified error response format and error code system
5. Design authentication schemes (Bearer Token / API Key / Cookie)
6. Design pagination, sorting, and filtering conventions

## Execution Steps

### Step 1: Read Scenario Context

Read sequence diagrams, architecture overview, and `logos-project.yaml` to establish context.

### Step 2: Extract Endpoint Inventory

Traverse all sequence diagrams, collect cross-boundary arrows, deduplicate, and output a summary table:

```markdown
| # | Method | Path | Source Scenario | Domain |
|---|--------|------|-----------------|--------|
| 1 | POST | /api/auth/register | S01 Step 2 | auth |
| 2 | POST | /api/auth/login | S02 Step 1 | auth |
```

### Step 3: Group by Domain

Group endpoints by business domain, each group becoming a YAML file (`auth.yaml`, `projects.yaml`, `billing.yaml`).

### Step 4: Design Unified Conventions

Establish global conventions before individual endpoints: security schemes, unified error response (`{ code, message, details? }`), and pagination parameters.

### Step 5: Design Endpoint Specifications

Each endpoint includes: `operationId`, `summary`, `description` (annotating source sequence diagram step), `requestBody`, and `responses` covering normal + all known exceptions from EX cases.

### Step 6: Verify Traceability

- **Forward**: Every cross-system arrow has a corresponding API endpoint
- **Reverse**: Every endpoint's `description` annotates its source Step
- **Exception**: Every EX case has a corresponding HTTP error response

## YAML Formatting Rules

1. **Always double-quote `description` and `summary`** — any string containing `:`, `→`, `#`, or other special chars must be in `"..."`
2. **Quote response status code keys** — use `'201'` not `201`
3. **Self-check after generation** — verify no unquoted special characters
4. **When in doubt, quote it** — quoting a safe string is harmless

## Outputs

| File | Location |
|------|----------|
| API YAML files | `logos/resources/api/` |
| Split by domain | `auth.yaml`, `projects.yaml`, etc. |
| Format | OpenAPI 3.1 YAML |

## Best Practices

- **APIs emerge from sequence diagrams** — design diagrams first, then APIs
- **RESTful path naming** — use plural nouns, `/api/{resource}`
- **No version prefix initially** — add `/api/v2/` when versioning becomes necessary
- **Strict HTTP status code semantics** — 201 created, 409 conflict, 422 validation failed
- **Output by domain** — let the user review each batch before continuing
- **Field names aligned with DB** — reduces unnecessary transformations in code

## Related Skills

- Previous: [`scenario-architect`](/skills/scenario-architect) — create sequence diagrams
- Parallel: [`db-designer`](/skills/db-designer) — design database schema
- Next: [`test-writer`](/skills/test-writer) — design test cases
