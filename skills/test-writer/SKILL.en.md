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
- **Naming convention**: `<module>-{scenario-number}-test-cases.md` (e.g., `core-S01-test-cases.md`; read current module from `modules[]` in `logos-project.yaml`, default is `core`)
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

## Authority Closure 可证伪测试矩阵（规范引用）


测试设计前读取 `spec/authority-closure.md`、Authority Registry 和有效 sequence diagram。按 required `fact_id` 生成矩阵，不另建 owner/writer 清单。

每个 fact 至少覆盖 authority happy path、stale projection、conflicting old copy、legacy/concurrent writer、response lost + new-process restart、projection rebuild、cutover rollback、forbidden reverse inference。确实不可发生的维度必须引用架构不变量给证据，不能静默省略。

断言必须证明最终 decision/恢复来源是 authority identity/action；故意让投影与权威值不同，restart 必须启新进程并保留旧残留。所有自动化 UT/ST/smoke 使用真实 ID 并接入 OpenLogos reporter；漏任一 required 维度时测试规格不完成。

## Load relevant enterprise knowledge (S45)

> Source changes: enterprise-knowledge-base (S45); knowledge-direct-intake (direct intake, tag table, index and lookup). Rule authority: feature spec §2.102 and §2.103; directory convention: `spec/directory-convention.md` "logos/resources/knowledge/". There is only one skip condition: the project has no knowledge entries, the active proposal has no `deltas/knowledge/`, **and the user has not provided enterprise material in this turn** — then skip this section; all other steps are unchanged.

### Intake entry point (runs before loading, not subject to the skip condition)

When the user provides enterprise material to capture in this turn (policy text, interface notes, glossaries, etc.), capture first and load afterwards, even if the project has no `logos/resources/knowledge/`, `logos/resources/reference/knowledge/` or `deltas/knowledge/` yet (for example a project launched before this upgrade, capturing knowledge for the first time):

1. **Choose the channel**: the user only provides material with no requirement change (or the new knowledge may take effect before the requirement) → **capture directly; do not open a proposal** (steps 2–5). A knowledge revision must take effect together with a scenario change (for example retiring an old rule while rewriting the scenarios that cite it) → use the proposal channel (step 7).
2. **Numbering and tags**: run `openlogos knowledge list --format json` to read the entries and `tag_state` of the effective knowledge view. A new entry takes the highest KXX (including `deprecated`) + 1, or K01 when the view is empty; a new rule in an existing entry takes that entry's highest Rn (including `deprecated`) + 1. Prefer tags or aliases already in `logos/resources/knowledge/TAGS.md`.
3. **Prepare a candidate directory** in a one-off directory **outside the project root** (for example the result of `mktemp -d`), containing:
   - complete entry files `<module>-KXX-<slug>.md`: new ones, or whole-file replacements when revising — keep every existing rule row, retire only by changing the status, and leave retired content byte-for-byte unchanged;
   - when new tags are needed, a complete `TAGS.md`: copy every existing row and append, with the header "标签 | 别名 | 说明";
   - originals under `sources/<file name>`; if an original with the same name already exists with different content, use a new file name (e.g. `-v4`). The entry's `source.path` is `logos/resources/reference/knowledge/<file name>`.

   Do not write `logos/resources/knowledge/` with file tools — the directory is guard-protected and the write will be blocked. Because the candidate directory is outside the project root, the project's `guard.exempt` setting does not matter.
4. **Capture**: from the project root, run `openlogos knowledge apply <candidate dir> --format json` **on its own**; do not chain it with other commands via `&&`.
5. **Act on the result**:
   - Exit code 1: the whole batch was rejected and nothing was written to the project. Fix the candidates according to `errors[]` and rerun step 4.
   - Exit code 0: read back the entries listed in `written[]` and tell the user: "the original will spread with the repository on push; confirm what may be published before pushing". Pass any `knowledge_tag_synonym` (suspected synonym tags) in `warnings[]` on to the user; the human owner decides whether to merge them — never merge them yourself.
   - The project's first apply generates `TAGS.md` from the existing entries automatically, so no existing entry becomes invalid.
   - Exit code 2 with `rolled_back=false`, or any command reporting `knowledge_apply_incomplete`: a previous capture was interrupted or its rollback failed. Run `openlogos knowledge apply --recover` first and continue only after it succeeds; if it still fails, hand the output to the user.
   - `knowledge_apply_busy`: another capture is in progress; rerun step 4 later, and never delete the lock or transaction files under `logos/.openlogos-runtime/`.
   - `knowledge_apply_conflict`: a candidate has the same file name or number as an active proposal's knowledge delta; pick another number or make the change inside the proposal.
6. **Entries must be structurally valid**: the H1 starts with the KXX; the "元数据" YAML has valid `type`, `scope`, `status` (plus `module` when `scope: module`), a non-empty `tags` list, and a non-empty `source` list whose items each give the repository-relative `path` of the original (a file that exists in `logos/resources/reference/knowledge/` or in this batch's `sources/`; a repository file outside that directory, such as `README.md`, is invalid) and a non-empty `version`; `type: rule` entries have a "规则" table in which every row's first column is this entry's `KXX-Rn` and whose "状态" is `active` or `deprecated`; once the tag table is enabled, every tag must be a tag or alias in `TAGS.md` (or be added by the `TAGS.md` in the same batch). Otherwise apply rejects the whole batch with `knowledge_entry_invalid` / `knowledge_tag_unknown`, and change-lint rejects the same in the proposal channel.
7. **Proposal channel**: change-writer plans `deltas/knowledge/<module>-KXX-<slug>.md` in the `[delta]` section of `tasks.md` and reserves the KXX (numbered as in step 2), then writes the knowledge delta, which lands on merge. Originals: if the project's `guard.exempt` still contains `logos/resources/reference/`, write them directly to `reference/knowledge/`; if not (for example an explicit `guard.exempt: []`), create a candidate directory outside the project root that **contains only `sources/`** and run `openlogos knowledge apply <candidate dir>` to write the originals (no entries); the entries still merge with the scenarios through the delta. `deltas/knowledge/` holds entry files only; add any new tags to `TAGS.md` through apply first (steps 3–5). Initial projects also default to direct capture.
8. After intake, load from the effective knowledge view as below; entries just captured, or added in the same proposal, can be cited immediately.

### Effective knowledge view

Load from the **effective knowledge view**: the candidate after-state of knowledge entries from the active proposal's point of view. Before the proposal is merged, it is the on-disk `logos/resources/knowledge/` entries with this proposal's `deltas/knowledge/` applied; once merged with no pending amendment, read the on-disk entries directly (the deltas are already applied and are not replayed); with a pending amendment, apply the amended deltas to the merge baseline. Without an active proposal it is simply the on-disk entries. Only the current proposal counts; never other proposals or the archive. `openlogos knowledge list` outputs this view's metadata.

Tag table state (`tag_state` from `knowledge list`):

- `never`: the tag table has never been enabled; entry validity follows the original criteria;
- `enabled`: every tag of an entry must be in `TAGS.md` (aliases included); entries with tags outside the table cannot serve as a basis or as a citation target;
- `missing`: enabled but `TAGS.md` is gone — stop capturing and citing, and ask the user to restore `TAGS.md` from git or run `openlogos knowledge apply --init-tags` to re-initialise it.

### Loading steps

1. Run `openlogos knowledge list --module <current module> --format json` (add `--tag <tag>` when useful; matching follows the tag table rows, aliases included) to get the effective metadata, including this proposal's knowledge deltas. Do not filter by `INDEX.md` — it only indexes the on-disk entries and lacks this proposal's knowledge deltas.
2. Narrow the result by `scope` (`global` always matches) and `tags` to the entries relevant to the current requirement or scenario. Do not rely on `resource_index` descriptions; no semantic search.
3. For each matching entry run `openlogos knowledge show <KXX> --format json` and read its **composed full text** (`content`) and rules (`rules`) in the same effective knowledge view. Do not read the delta file at the `path` returned by `list` — a delta that only modifies the "元数据" section does not contain the existing rules. For `type: rule` entries, the `active` `KXX-Rn` rows of the rules table are binding; `deprecated` entries or rules are background only and must not justify new design.
4. If one KXX appears in two files, or an Rn repeats within one entry, do not resolve that ID; ask the user to fix the duplicate first (reported as `knowledge_id_duplicate`).
5. Do not rely on entries with `valid=false` (`problems` explains why: structurally invalid, or tags outside the table); ask the user to fix them through the intake entry point first (citing one makes change-lint report `knowledge_reference_unknown`).
6. When you need to know which scenarios use an entry or rule (retiring, revising, assessing impact), run `openlogos knowledge refs <KXX|KXX-Rn>`.

### Cite the basis and handle conflicts

- Wherever output is constrained by enterprise knowledge, cite the `KXX` or `KXX-Rn` it relies on.
- When a requirement or design conflicts with an `active` rule, **do not hard-block and do not silently pick a side**: list the conflict (rule ID, conflicting point, options: comply / exception for this change / rule needs updating), stop and ask the user, one decision at a time. If the user rules "exception for this change", record the reason in the "例外" (exception) column of the scenario's "适用业务约束" (applicable business constraints) section; if "rule needs updating", revise the rule through the intake entry point (capture directly when only knowledge changes; hand it to change-writer to plan a knowledge delta when it must land together with a scenario change).

### When this Skill loads and what it outputs

- **When**: before designing UT / ST cases, read the `KXX-Rn` / `KXX` cited in the scenario's "适用业务约束" section, locate the corresponding entries in the effective knowledge view with `openlogos knowledge list` (this proposal's knowledge deltas included), then read their composed full text with `openlogos knowledge show <KXX>`.
- **Derive cases from `KXX-Rn`**: every cited `active` rule gets at least one positive case (a path satisfying the rule) and one negative case (a path where the rule must constrain, e.g. amounts above 5000 must enter second review); each item in a rule's "例外" column gets its own case. For terms or external-system entries cited as `KXX`, build test data according to their definitions.
- **Mark the knowledge source**: note the basis in the case "描述" (e.g. "per K03-R1"); for rules with a recorded exception in the scenario, design for the post-exception behaviour and say so.
