# Skill: Test Orchestrator

> Design **API orchestration test** cases based on business scenarios and sequence diagrams (Phase 3 Step 3b), covering normal/exception/boundary scenarios. Automatically identify external dependencies and apply test strategies as end-to-end API acceptance criteria. **Only applicable to projects involving APIs.**

## Relationship with test-writer

This Skill is responsible for the **top layer** of the test pyramid — API orchestration tests (HTTP request level), executed in Phase 3 Step 3b.

The lower-level unit tests and scenario tests (function call level) are completed by the `test-writer` Skill in Step 3a. Step 3a is a mandatory step for all projects; Step 3b (this Skill) is only executed when the project involves APIs.

## Trigger Conditions

- User requests API orchestration test design
- User mentions "Phase 3 Step 3b", "API orchestration", or "orchestration tests"
- After Step 3a (test-writer) is complete, AI guides the user to proceed to Step 3b
- User needs to validate deployed API code

## Prerequisites

- `logos/resources/test/` contains test case specification documents (Step 3a completed)
- `logos/resources/prd/3-technical-plan/2-scenario-implementation/` contains scenario sequence diagrams
- `logos/resources/api/` contains API specifications (OpenAPI YAML)
- `logos-project.yaml` contains `external_dependencies` (if applicable)

If the project does not involve APIs (pure CLI tools, pure frontend, etc.), skip this Skill.

## Core Capabilities

1. Design normal flow orchestration from sequence diagrams and API YAML
2. Design exception flow orchestration based on exception cases (EX-N.M)
3. Design boundary cases (valid but non-happy-path variations)
4. Define variable extraction and passing mechanisms
5. **Identify external dependencies and apply test strategies**: Read `external_dependencies` from `logos-project.yaml` and automatically insert `mock` fields in steps involving external services
6. Execute orchestration and verify results

## Execution Steps

### Step 1: Read Scenario Context

Read the following files to establish complete context:

- Scenario sequence diagrams (`logos/resources/prd/3-technical-plan/2-scenario-implementation/`)
- API YAML (`logos/resources/api/`)
- `logos-project.yaml` — focus on reading the `external_dependencies` field

### Step 2: Identify External Dependencies

Match `used_in` from `external_dependencies` with the current scenario number. If the current scenario involves external dependencies:

- Record the dependency's `test_strategy` and `test_config`
- If a dependency declares `used_in` but is missing `test_strategy`, **proactively ask the user** for the test strategy

If there is no `external_dependencies` field in `logos-project.yaml`, but the sequence diagrams contain calls to external services (e.g., sending emails, payment requests, etc.), proactively remind the user to add them.

### Step 3: Design Normal Flow Orchestration

Design the API call chain step by step following the sequence diagram's Step numbers:

- Each step includes method, url, headers, body, expected_status
- For steps involving external dependencies, insert the `mock` field (see Output Specification)
- For variables that need to be passed from the previous step's response, use `extract` to define extraction rules

### Step 4: Design Exception Flow Orchestration

Design independent orchestrations for each EX exception case, ensuring:

- Exception scenarios also cover external dependency failure cases
- Use the `mock` field to simulate external service failures (e.g., timeouts, error responses, etc.)

### Step 5: Design Boundary Case Orchestration

Identify valid but non-happy-path variations (e.g., password length exactly at the boundary value, empty fields, etc.) and add supplementary orchestrations.

### Step 6: Output Orchestration JSON

Output executable orchestration JSON files per scenario.

## Output Specification

- File format: JSON
- Storage location: `logos/resources/scenario/`
- Separate files per scenario: `user-auth.json`, `payment-flow.json`
- Each step in the orchestration corresponds to a Step number in the sequence diagram

### mock Field Structure

When a step involves an external dependency, add a `mock` field to that step:

```json
{
  "step": "Step 2: Get email verification code",
  "mock": {
    "dependency": "Email Service",
    "strategy": "test-api",
    "config": "GET /api/test/latest-email?to={email}",
    "extract": { "code": "response.body.code" }
  },
  "method": "GET",
  "url": "/api/test/latest-email?to={{email}}",
  "expected_status": 200,
  "extract": {
    "verification_code": "body.code"
  }
}
```

`mock` field description:

| Field | Type | Description |
|------|------|------|
| `dependency` | string | Corresponds to `name` in `external_dependencies` |
| `strategy` | string | Test strategy (`test-api` / `fixed-value` / `env-disable` / `mock-callback` / `mock-service`) |
| `config` | string | Specific configuration for the test strategy, from `test_config` |
| `extract` | object | Extract variables from mock response (optional) |

Orchestration behavior for different strategies:

- **`test-api`**: The step's url is replaced with the backdoor API address
- **`fixed-value`**: The step does not make an actual request; fixed values are injected directly via `extract`
- **`env-disable`**: The step is marked as skipped, with a comment explaining the precondition
- **`mock-callback`**: An additional mock callback request is inserted after the previous step completes
- **`mock-service`**: The step's url is replaced with the local mock service address

## Best Practices

- **Normal orchestration is the skeleton**: Complete the normal flow orchestration first to ensure the happy path works end-to-end
- **Exception orchestration is the safety net**: At least 1 exception orchestration per external call
- **Variable passing**: Extract variables from the previous step's response (e.g., token, user_id) and pass them to subsequent steps
- **Test data**: Prepare test data before orchestration begins and clean up afterwards to ensure idempotency
- **Concurrency testing**: Key scenarios should account for concurrent situations (e.g., two users registering with the same email simultaneously)
- **Check the external dependency list first**: Before starting orchestration design, read `external_dependencies` from `logos-project.yaml`; proactively remind the user to add any undeclared external calls
- **Do not decide mock strategies on your own**: Test strategies are determined during S12 technical architecture design (Phase 3 Step 0, architecture-designer); the orchestration test phase only consumes them — do not modify them unilaterally
- **Relationship with `openlogos verify`**: API orchestration tests can also produce JSONL results in the same format as `spec/test-results.md`. After orchestration tests run, results are also written to `logos/resources/verify/test-results.jsonl`, and `openlogos verify` reads them uniformly to determine acceptance

## Recommended Prompts

The following prompts can be copied directly for AI use:

- `Help me design orchestration tests`
- `Generate orchestration tests for S01 based on the API spec`
- `Help me orchestrate all normal paths for every scenario`
- `Help me add exception path orchestration tests for S02`
