---
name: test-writer
description: "Write unit test and scenario test case documents. Use when API specs exist in logos/resources/api/ but logos/resources/test/ is empty."
---

# Skill: Test Writer

> Based on sequence diagrams, API specifications, and DB constraints, design unit test cases and scenario test cases for each business scenario. Applicable to all project types (API services, CLI tools, frontend applications, libraries, etc.), this is a mandatory prerequisite step before code generation.

## Trigger Conditions

- User requests test case or test plan design
- User mentions "Phase 3 Step 3", "Step 3a", "test-first", "test design"
- Sequence diagrams already exist, and tests need to be designed before writing code
- User specifies a scenario number (e.g., S01) that needs test design

## Prerequisites

- `logos/resources/prd/3-technical-plan/2-scenario-implementation/` contains sequence diagrams (**required**)
- `logos/resources/api/` contains API specifications (read if present, skip if absent — non-API projects may not have these)
- `logos/resources/database/` contains DB DDL (read if present, skip if absent)
- `logos/resources/prd/1-product-requirements/` contains requirements documents (for tracing acceptance criteria)

**Cannot be skipped**: Regardless of project type, Step 3a (this Skill) must be executed.

## Core Capabilities

1. Extract unit test cases from API field constraints (type, format, length, enum)
2. Extract unit test cases from DB constraints (UNIQUE, CHECK, NOT NULL, FK)
3. Extract unit test cases from business rules and single-point error handling in EX exception cases
4. Extract scenario test cases from sequence diagram Step sequences (happy path)
5. Extract scenario test cases from EX exception cases (exception paths)
6. Reverse-validate test coverage completeness against Phase 1/2 acceptance criteria

## Execution Steps

### Step 1: Load Scenario Context

Read the following files to establish complete context:

- Sequence diagrams (`logos/resources/prd/3-technical-plan/2-scenario-implementation/`)
- API YAML (`logos/resources/api/`) — if present
- DB DDL (`logos/resources/database/`) — if present
- Phase 1 requirements documents (acceptance criteria)
- Phase 2 product design documents (interaction-level acceptance criteria)

Confirm the following for the current scenario:
- **Step count**: How many Steps are in the sequence diagram
- **EX count**: How many exception cases exist
- **API endpoints**: Which endpoints are involved and their field constraints
- **DB tables**: Which tables are involved and their constraints

### Step 2: Design Unit Test Cases

Extract unit test cases from three categories of sources:

#### 2a: API Field Constraints

Inspect `requestBody` and `parameters` for each API endpoint:

- `type` → Type error cases (passing incorrect types)
- `format` (email, uuid, date-time) → Format validation cases
- `minLength` / `maxLength` → Boundary value cases (exactly at limit, exceeding by 1)
- `required` → Required field missing cases
- `enum` → Enumeration value cases (valid values + invalid values)
- `minimum` / `maximum` → Numeric range cases

#### 2b: DB Constraints

Inspect constraints for each related table:

- `UNIQUE` → Duplicate insertion cases
- `NOT NULL` → Null value insertion cases
- `CHECK` → Constraint violation cases
- `FOREIGN KEY` → Referencing non-existent record cases
- `DEFAULT` → Default value verification when no value is provided

#### 2c: Business Rules

Extract single-point business logic from sequence diagram Step descriptions and EX exception cases:

- Permission checks (not logged in, insufficient permissions)
- State machine transitions (only specific states allow certain operations)
- Rate limiting / throttling rules
- Data computation logic (amount calculations, discount rules)

**Format for each unit test case**:

| Field | Description |
|-------|-------------|
| ID | `UT-{scenario-number}-{sequence}`, e.g., `UT-S01-01` |
| Description | What behavior is being tested |
| Source | Constraint origin (e.g., `auth.yaml → register → email: format:email`) |
| Preconditions | State required before the test |
| Input | Specific input values |
| Expected Output | Expected return value or error message |

### Step 3: Design Scenario Test Cases

Extract scenario test cases from two categories of sources:

#### 3a: Happy Path (Sequence Diagram Step Sequence)

Treat the complete Step 1 → Step N sequence from the sequence diagram as an end-to-end code call chain:

- Determine the scenario's entry and exit points
- Annotate data passing between each Step (previous step's output as next step's input)
- Verify the final state (database records, return values)

#### 3b: Exception Paths (EX Exception Cases)

Expand each EX exception case into a scenario test case:

- Annotate which Step triggers the exception
- Verify the handling logic after the exception is triggered (error response, compensation/rollback)
- Verify the exception did not compromise the integrity of other data

**Format for each scenario test case**:

| Field | Description |
|-------|-------------|
| ID | `ST-{scenario-number}-{sequence}`, e.g., `ST-S01-01` |
| Description | What scenario flow is being tested |
| Covered Steps | Which sequence diagram Steps are covered (e.g., `Step 1→6`) or which EX (e.g., `EX-2.1`) |
| Preconditions | State and data required before the test |
| Operation Sequence | Ordered list of operations following Step sequence |
| Expected Result | Final state (return value + database state + side effects) |

### Step 4: Coverage Validation

Reverse-validate whether test cases cover all critical constraints:

- [ ] Each normal acceptance criterion from Phase 1 maps to at least 1 ST case
- [ ] Each exception acceptance criterion from Phase 1 maps to at least 1 ST or UT case
- [ ] Each EX exception case maps to at least 1 ST case
- [ ] Each `required` field in the API has at least 1 UT case
- [ ] Each `UNIQUE` / `CHECK` constraint in the DB has at least 1 UT case

If any items are uncovered, add supplementary cases or explain the reason to the user.

### Step 5: Acceptance Criteria Traceability

Extract each GIVEN/WHEN/THEN acceptance criterion from the Phase 1 requirements document, assign a traceability ID to each, and link it to the test case IDs that cover that criterion.

#### Acceptance Criteria ID Rules

- Format: `{scenario-number}-AC-{two-digit-sequence}`, e.g., `S01-AC-01`, `S01-AC-02`
- Numbered in the order they appear in the requirements document; normal and exception criteria use a unified numbering sequence
- AC IDs within the same scenario must be consecutive and unique

#### Traceability Table Rules

1. Read all acceptance criteria (normal + exception) for the current scenario from the requirements document
2. Assign an AC ID to each acceptance criterion
3. Find the test case IDs that cover each criterion (can be UT or ST), and fill in the "Covered By" column
4. Each AC must be linked to at least 1 test case; if it cannot be covered, note the reason in the "Covered By" column

`openlogos verify` parses this traceability table and links AC → test case ID → execution result across three layers to generate a complete acceptance traceability report.

### Step 6: Output Test Case Specification Document

Output the test case specification document in Markdown format, organized by scenario.

### Step 7: Guide Next Steps

Guide the user to the next step based on project type:

- **Involves API** → "Continue to Step 3b to design API orchestration tests?"
- **Does not involve API** → "Test design is complete. Recommend proceeding to code generation: say 'Implement based on the S01 specification for me'"

## Output Specification

- **File format**: Markdown
- **Location**: `logos/resources/test/`
- **Naming convention**: `{scenario-number}-test-cases.md` (e.g., `S01-test-cases.md`)
- Each file contains: Unit test cases (grouped by source) + Scenario test cases (happy path + exception paths)
- Case IDs are globally unique: `UT-{scenario-number}-{sequence}` / `ST-{scenario-number}-{sequence}`

### Document Structure Template

```markdown
# {scenario-number}: {scenario-name} — Test Cases

## 1. Unit Test Cases

### 1.1 {group-name} (Source: {constraint-origin})

| ID | Description | Source | Preconditions | Input | Expected Output |
|----|-------------|--------|---------------|-------|-----------------|
| UT-S01-01 | ... | ... | ... | ... | ... |

## 2. Scenario Test Cases

### 2.1 Happy Path: {scenario-name}

| ID | Description | Covered Steps | Preconditions | Operation Sequence | Expected Result |
|----|-------------|---------------|---------------|--------------------|-----------------|
| ST-S01-01 | ... | Step 1→6 | ... | ... | ... |

### 2.2 Exception Paths

| ID | Description | Covered EX | Preconditions | Trigger Condition | Expected Result |
|----|-------------|------------|---------------|-------------------|-----------------|
| ST-S01-02 | ... | EX-2.1 | ... | ... | ... |

## 3. Coverage Validation

- [x] Phase 1 normal acceptance criteria: fully covered
- [x] Phase 1 exception acceptance criteria: fully covered
- [x] EX exception cases: fully covered
- [x] API required fields: fully covered
- [x] DB UNIQUE/CHECK constraints: fully covered

## 4. Acceptance Criteria Traceability

| AC ID | Acceptance Criterion | Covered By |
|-------|----------------------|------------|
| S01-AC-01 | Normal: Fresh project initialization — create complete directory structure | ST-S01-01 |
| S01-AC-02 | Normal: Confirm when explicit project name differs from config file | ST-S01-02 |
| S01-AC-03 | Exception: Project already initialized — display error message | ST-S01-03, UT-S01-05 |
```

## Test Case ID Contract

Test case IDs (`UT-S01-01`, `ST-S01-01`) serve as a **binding contract** between design documents and runtime:

- IDs defined in test-cases.md must be used as-is in the generated test code
- The test code reporter writes each case's ID and execution result to a JSONL file
- `openlogos verify` maps execution results back to test case specifications via IDs, automatically determining acceptance
- When modifying case IDs, the corresponding IDs in the test code must be updated simultaneously

See `logos/spec/test-results.md` for the detailed JSONL format definition and reporter code templates for each language.

## Best Practices

- **Test cases are design documents, not code**: This Skill produces test case specifications in Markdown format; the actual test code is implemented by AI during Step 4 code generation based on these specifications
- **Unit first, then scenario**: Unit test cases cover the correctness of individual functions; scenario tests cover cross-module integration — first ensure the building blocks are correct, then verify they fit together
- **Don't overlook DB constraints**: Many bugs originate from database-level constraint violations; DB constraints are an important source of unit test cases
- **Scenario tests focus on data passing**: Data passing between Steps (previous step's output → next step's input) is where errors most commonly occur
- **EX exception cases must have corresponding scenario tests**: Every EX annotated in the sequence diagram should be reflected in scenario tests
- **Boundary values first**: Unit test cases should prioritize boundary values (just valid, just invalid) over random values
- **Complementary with test-orchestrator**: This Skill designs code-level tests (function call level); test-orchestrator designs API-level tests (HTTP request level). Together they cover different layers of the "testing pyramid"
- **Case IDs are cross-phase contracts**: IDs span test-cases.md → test code → test-results.jsonl → acceptance-report.md; any inconsistency will cause `openlogos verify` to report incomplete results

## Recommended Prompts

The following prompts can be copied directly for AI use:

- `Design test cases for me`
- `Design unit tests and scenario tests for S01`
- `Design test cases for all P0 scenarios`
- `Check the test coverage for S01`
