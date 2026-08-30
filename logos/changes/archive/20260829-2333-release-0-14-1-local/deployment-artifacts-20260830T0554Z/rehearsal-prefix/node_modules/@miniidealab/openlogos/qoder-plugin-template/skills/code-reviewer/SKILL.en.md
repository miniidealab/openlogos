# Skill: Code Reviewer

> Review AI-generated code by performing systematic validation against the full OpenLogos specification chain (API YAML, sequence diagram EX cases, DB DDL), ensuring code is fully consistent with design documents, covers all exception paths, and meets security requirements.

## Trigger Conditions

- User requests a code review or Code Review
- User mentions "Phase 3 Step 4", "code audit", "code review"
- AI has just generated code that needs quality verification
- Final check before deployment
- Need to locate code issues after orchestration test failures

## Prerequisites

- `logos/resources/api/` contains API YAML specifications
- `logos/resources/prd/3-technical-plan/2-scenario-implementation/` contains scenario sequence diagrams (with EX cases)
- `logos/resources/database/` contains DB DDL
- The code to be reviewed is accessible

For projects without APIs (pure CLI / libraries), API consistency checks can be skipped; focus on sequence diagram coverage and exception handling instead.

## Core Capabilities

1. Validate code implementation consistency with API YAML specifications
2. Check whether exception handling covers all EX cases
3. Check whether DB operations conform to DDL design
4. Check security policies (authentication, RLS, input validation)
5. Check code style and best practices
6. Output a structured review report

## Execution Steps

### Step 1: Load Specification Context

**Pre-check — YAML Validity (before anything else):**

Before loading API specs, validate that all `logos/resources/api/*.yaml` files are syntactically valid YAML and conform to the OpenAPI 3.x schema. If any file fails parsing (e.g., unquoted special characters in `description` fields), report it as a **Critical** blocker immediately — do not proceed with the rest of the review until YAML errors are fixed.

**Then** read the following files to establish a "reference baseline" for the code review:

- **API YAML** (`logos/resources/api/*.yaml`): Extract endpoint inventory, record each endpoint's path, method, request body schema, response schema, and status codes
- **Scenario Sequence Diagrams** (`logos/resources/prd/3-technical-plan/2-scenario-implementation/`): Extract all EX exception case IDs and expected behaviors
- **DB DDL** (`logos/resources/database/`): Extract table structures, column types, constraints, and indexes
- **`logos-project.yaml`**: Read `tech_stack` to confirm the technology stack, `external_dependencies` to confirm external dependencies

Summarize into a review checklist:

```markdown
Review scope: S01-related code
- API endpoints: 4 (auth.yaml)
- EX exception cases: 7 (EX-2.1 ~ EX-5.2)
- DB tables: 2 (users, profiles)
- Security policies: 2 RLS rules
```

### Step 2: API Consistency Review

Compare code implementation against API YAML specification endpoint by endpoint:

**Checklist**:

| Check Item | Description | Severity |
|------------|-------------|----------|
| Path Match | Whether route paths in code exactly match `paths` in YAML | Critical |
| HTTP Method | Whether GET/POST/PUT/DELETE matches | Critical |
| Request Body Fields | Whether code reads all required fields defined in YAML `requestBody.schema` | Critical |
| Request Body Validation | Whether field type, format (email/uuid), minLength and other constraints are validated in code | Warning |
| Response Fields | Whether JSON field names and types returned by code match YAML `responses.schema` | Critical |
| Status Codes | Whether HTTP status codes returned in normal and error cases match YAML definitions | Critical |
| Error Response Format | Whether error responses follow the unified `{ code, message, details? }` format | Warning |
| YAML Validity | All `logos/resources/api/*.yaml` files parse as valid YAML and valid OpenAPI 3.x — unquoted special characters (`:`, `→`, `#`) in `description`/`summary` values are a common failure mode | Critical |

**Output format**:

```markdown
### API Consistency

| Endpoint | Check Item | Status | Notes |
|----------|------------|--------|-------|
| POST /api/auth/register | Request body fields | ✅ | email, password both read |
| POST /api/auth/register | Response status code | ❌ Critical | Registration success returns 200, YAML defines 201 |
| POST /api/auth/register | Error code | ❌ Warning | Duplicate email returns generic 400, YAML defines 409 |
```

### Step 3: Exception Handling Coverage Review

Map all EX exception cases from sequence diagrams to error handling in code one by one:

1. List all EX case IDs and their expected behaviors for the scenario
2. Search for corresponding try/catch, if/else, error handlers in code
3. Flag uncovered EX cases

**Key checks**:

- Whether each EX case has a corresponding code branch
- Whether the correct HTTP status code and error code are returned in exception scenarios
- Whether there are "silently swallowed exceptions" (empty catch blocks or catch blocks that only log without returning errors)
- Whether external service calls (DB, third-party APIs) all have timeout and error handling
- Whether there are exception handlers in code that don't exist in sequence diagrams (which may indicate sequence diagram omissions)

**Output format**:

```markdown
### Exception Handling Coverage

| EX ID | Exception Description | Code Coverage | Notes |
|-------|----------------------|---------------|-------|
| EX-2.1 | Email already registered | ✅ | Returns 409, format correct |
| EX-2.2 | Auth service unavailable | ❌ Critical | No try/catch wrapping the supabase.auth.signUp call |
| EX-4.1 | profiles write failure | ❌ Critical | auth.users record not rolled back after INSERT failure |
```

### Step 4: DB Operations Review

Check whether database operations in code conform to DDL design:

**Checklist**:

- **Table and column names**: Whether table/column names referenced in code match DDL (no typos, case differences)
- **Field types**: Whether value types passed in code match DDL definitions (e.g., for an `INTEGER` amount field in DDL, whether code passes cents instead of dollars)
- **Constraint compliance**: Whether NOT NULL fields always have values, whether UNIQUE fields have conflict handling, whether CHECK constraint enum values have corresponding constants in code
- **Transaction usage**: Whether multi-table write operations are wrapped in transactions
- **Migration consistency**: Whether the latest fields in DDL are used in code (avoid DDL being updated but code not following up)

### Step 5: Security Review

Check the security implementation of the code:

| Check Item | Description | Severity |
|------------|-------------|----------|
| Authentication Check | Whether endpoints requiring authentication verify token/session before processing logic | Critical |
| Authorization Check | Whether users can only access their own data (owner check) | Critical |
| Input Validation | Whether user input has type validation and length limits (prevent injection, prevent XSS) | Critical |
| Sensitive Data | Whether responses leak password hashes, internal IDs, or stack traces | Critical |
| RLS Dependency | If relying on PostgreSQL RLS, whether code correctly sets the `auth.uid()` context | Warning |
| SQL Injection | Whether parameterized queries are used (string-concatenated SQL is prohibited) | Critical |
| Rate Limiting | Whether critical endpoints (login, registration) have rate limiting against brute force | Warning |

### Step 6: Output Review Report

Summarize all findings by severity and generate a structured report:

```markdown
# Code Review Report: S01 User Registration

## Review Scope
- Scenario: S01
- Endpoints: 4
- EX cases: 7
- Code files: src/api/auth/register.ts, src/api/auth/login.ts

## Review Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 2 |
| 🟡 Warning | 3 |
| 🔵 Info | 1 |

## Critical Findings

### [C1] POST /api/auth/register status code mismatch
- **Spec source**: auth.yaml → register → responses.201
- **Issue**: Code returns 200, spec defines 201
- **Fix suggestion**: Change `res.status(200)` to `res.status(201)`

### [C2] EX-2.2 unhandled: Auth service unavailable
- **Spec source**: S01 sequence diagram → EX-2.2
- **Issue**: `supabase.auth.signUp()` call is not wrapped in try/catch
- **Fix suggestion**: Add try/catch, return 503 on timeout or 5xx

## Warning Findings
...

## Info Findings
...
```

**Report principles**:
- Critical issues must be fixed before proceeding to orchestration acceptance
- Warning issues are recommended to fix but do not block delivery
- Info items are improvement suggestions that can be addressed later
- Every finding must reference a spec source (API YAML, EX ID, DDL)

## Output Specification

- Review report is output directly in the conversation (not written to a file)
- Categorized by severity: Critical / Warning / Info
- Each finding format: ID + spec source + issue description + fix suggestion
- End with a summary and next-step recommendation (e.g., "Fix 2 Critical issues, then run orchestration acceptance")

## Best Practices

- **Consistency first**: Code must be fully consistent with API YAML — field names, types, and status codes must not deviate. Most production bugs come from subtle inconsistencies between code and specs
- **Exception handling is the focus**: Most bugs occur in exception paths; carefully check that every EX case has a corresponding catch/error handler
- **No shortcuts on security**: Authentication checks, RLS policies, input validation — any missing item is a Critical issue
- **Don't over-review**: Code style issues should be marked as Info and not block delivery. The core goal of the review is "code matches specs", not "code is perfect"
- **Run tests before reviewing**: If the code can run, execute orchestration tests first and use failing cases to pinpoint issues — this is more efficient than reading code line by line
- **Watch for compensation logic**: If multi-step writes (e.g., first creating an auth user then writing a profile) fail midway, check whether there is a rollback or compensation mechanism — this is the most commonly missed Critical issue

## Recommended Prompts

The following prompts can be copied directly for use with AI:

- `Help me do a code review`
- `Help me check if this code conforms to the API YAML spec`
- `Review the code implementation related to S01`
- `Help me check if exception handling is complete`
- `Help me check if security policies are in place`
