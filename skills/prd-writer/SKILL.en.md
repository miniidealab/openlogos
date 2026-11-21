# Skill: PRD Writer

> Assist in writing scenario-driven requirements documents — starting from user pain points, identifying core business scenarios, and defining GIVEN/WHEN/THEN acceptance criteria for each scenario. Scenario numbers will carry through all subsequent phases.

## Trigger Conditions

- User requests writing a requirements document, product requirements, or PRD
- User discusses product positioning, target users, or feature requirements
- User mentions "Phase 1", "requirements layer", or "WHY"
- The project is currently in the requirements analysis phase

## Core Capabilities

1. Guide users through product positioning and target user profiling
2. Extract user pain points and establish causal chains
3. Identify and define business scenarios from pain points (assigning `S01`, `S02`... numbers)
4. Write GIVEN/WHEN/THEN acceptance criteria for each scenario
5. Prioritize scenarios
6. Identify constraints and the "won't-do" list
7. Generate scenario-driven requirements documents conforming to the OpenLogos specification

## Execution Steps

### Step 1: Understand Product Positioning

Confirm the following key questions with the user (proactively ask if information is insufficient):

- **One-line positioning**: What is this product? For whom? What problem does it solve?
- **Target user persona**: Specific enough to describe a real person
- **Core objectives**: What should the product achieve, and what metrics define success

### Step 2: Extract User Pain Points

Guide the user to identify pain points from the following dimensions:

- How does the user currently do it? (Current state)
- What difficulties are encountered in the process? (Pain points)
- What consequences do the difficulties cause? (Impact)
- How does the user expect it to be resolved? (Expectation)

**Every pain point must have a causal chain**: Because [reason] → leads to [pain point] → results in [consequence]

Assign a number to each pain point (`P01`, `P02`...) for scenario traceability.

### Step 3: Identify and Define Scenarios

**Scenarios are the anchor throughout the entire development lifecycle.** This step is critical.

Extract business scenarios from pain points and requirements. Each scenario is a **complete user action path**:

- **Who** triggers it under **what circumstances**
- Through **what steps** (must involve multiple interactions, not a single API call)
- To achieve **what business outcome** (a value the user can perceive)

Assign a globally unique number to each scenario (`S01`, `S02`...). This number will carry through to Phase 2 and Phase 3.

Output a scenario list table:

```markdown
| ID   | Scenario Name      | Trigger Condition          | Related Pain Point | Priority |
|------|--------------------|----------------------------|--------------------|----------|
| S01  | Email Registration  | New user's first visit     | P01                | P0       |
| S02  | Password Login      | Registered user returns    | P01                | P0       |
| S03  | Forgot Password     | User cannot log in         | P02                | P1       |
```

#### Scenario Granularity Self-Check (MUST Pass)

After generating the scenario list, run these 4 tests. **If any test fails, re-organize the scenarios before proceeding.**

1. **Single-API Test**: If a scenario can be completed with just 1 API call, it is NOT a scenario — it is an operation. Merge it into a larger scenario.
2. **CRUD Test**: If the scenario list contains "Create X", "Read X", "Update X", "Delete X" as 4 separate scenarios, the granularity is too fine. Re-organize by user goals (e.g., "Manager plans weekly tasks" instead of "Create task" + "Assign task" + "Update task" + "Delete task").
3. **Business Value Test**: Describe in one sentence the value the user gains after completing the scenario. If the answer is merely "data was written/read/deleted", there is no real business goal — merge the scenario into a goal-driven one.
4. **Step Count Test**: A scenario's main path must contain at least 3 user-perceivable steps. Fewer than 3 means the granularity is too fine.

#### ❌ Anti-Pattern: One API = One Scenario

```markdown
| S01 | Create Task    | User clicks "New"       |
| S02 | Get Task List  | User opens the page      |
| S03 | Update Task    | User edits a task        |
| S04 | Delete Task    | User deletes a task      |
→ This is an API inventory, NOT a scenario list!
```

#### ✅ Correct: Organize by Business Goals

```markdown
| S01 | Team Lead Plans Weekly Tasks   | Lead logs in → creates tasks → sets priority & deadline → assigns to members → members receive notifications |
| S02 | Developer Completes & Delivers | Dev views to-do → updates progress → marks complete → lead is notified and reviews |
| S03 | Lead Reviews Project Progress  | Lead opens dashboard → filters by status/member → exports weekly report |
```

### Step 4: Write Scenario Acceptance Criteria

Write acceptance criteria for every P0 and P1 scenario:

```markdown
### S01: Email Registration

- **Trigger Condition**: New user's first visit, clicks "Sign Up"
- **User Value**: Quickly create an account and start using the product (← P01)
- **Priority**: P0
- **Main Path**: User fills in email and password, submits the form, receives a verification email, clicks the link to complete registration

#### Acceptance Criteria

##### Normal: Complete registration flow
- **GIVEN** the user has not registered before and is on the registration page
- **WHEN** the user fills in a valid email and password (≥8 characters) and clicks "Sign Up"
- **THEN** the system creates an account, sends a verification email, and the page displays "Please check your email for verification"

##### Exception: Email already registered
- **GIVEN** the email test@example.com is already registered
- **WHEN** the user attempts to register using test@example.com
- **THEN** the page displays "This email is already registered, please log in directly" and no email is sent

##### Exception: Password does not meet requirements
- **GIVEN** the user is on the registration page
- **WHEN** the user fills in a valid email but a password with fewer than 8 characters and clicks "Sign Up"
- **THEN** the page displays "Password must be at least 8 characters" and the request is not submitted
```

**Principles for writing acceptance criteria**:

- Each scenario must have at least 1 normal + 1 exception acceptance criterion
- GIVEN describes the initial state — specific enough to be reproducible
- WHEN describes the user action — precise down to the button level
- THEN describes the expected behavior — specific enough to be verifiable
- Avoid vague wording: "fast", "friendly", "reasonable" → quantify with concrete metrics

### Step 5: Identify Constraints and Boundaries

- **Technical constraints**: Technology stack limitations, third-party service limitations
- **Resource constraints**: Team size, time window
- **"Won't-do" list**: Explicitly list features and scenarios that are out of scope for this phase to prevent scope creep

### Step 6: Assemble the Requirements Document

Output the complete document in the standard structure:

```markdown
# [Product Name] Requirements Document

> Last updated: [date]

## I. Product Background and Goals
### 1.1 Product Positioning
### 1.2 Core Objectives
### 1.3 Target User Persona

## II. User Pain Point Analysis
### P01: [Pain Point Name]
Because [reason] → leads to [pain point] → results in [consequence]
### P02: ...

## III. Scenario Overview
[Scenario list table: ID / Name / Trigger Condition / Related Pain Point / Priority]

## IV. Core Scenario Details
### S01: [Scenario Name]
[Trigger Condition + User Value + Priority + Main Path + Acceptance Criteria]
### S02: ...

## V. Constraints and Boundaries
### 5.1 Technical Constraints
### 5.2 Resource and Time Constraints
### 5.3 "Won't-Do" List
```

## Output Specification

- File format: Markdown
- Storage location: `logos/resources/prd/1-product-requirements/`
- File naming: `<module>-{sequence}-{english-name}.md`, e.g., `core-01-requirements.md` (read current module from `modules[]` in `logos-project.yaml`, default is `core`)
- Every scenario must be traceable to at least one user pain point
- P0/P1 scenarios must have GIVEN/WHEN/THEN (≥1 normal + ≥1 exception)
- Scenario numbers are globally unique and will carry through Phase 2 and Phase 3

## Best Practices

- **Cast a wide net first, then narrow down**: In the first pass, identify as many scenarios as possible, then cut non-core ones during prioritization
- **Scenarios ≠ Features, Scenarios ≠ APIs**: A scenario is a "complete path from the user's perspective to achieve a business goal". A single feature (e.g., "user authentication") may contain multiple scenarios (registration, login, password recovery); a single scenario (e.g., "first purchase") may span multiple features (browsing, adding to cart, payment). **Never define a single CRUD operation as a standalone scenario.**
- **Scenario granularity**: Keep granularity moderate in Phase 1. Too fine-grained ("user creates a record") is just an API call; too coarse ("user uses the product") is unverifiable. Good granularity: the main path of a scenario can be walked through in 1–2 minutes and involves at least 3 distinct steps
- **Acceptance criteria are the precise expression of requirements**: If you cannot write GIVEN/WHEN/THEN, the scenario is not yet well thought out
- **Exception scenarios are equally important**: Users don't always follow the happy path — exception handling often defines the product experience
- **The "won't-do" list is the hardest to write**: Restraint is the most important skill of a product manager
- **Once a scenario number is assigned, it is never reused**: Even if a scenario is deprecated, its number is not recycled, to avoid confusion
- **Requirements documents are living documents**: They are continuously updated as the product evolves, with every change tracked through Delta change management

## Recommended Prompts

The following prompts can be copied directly for use with an AI:

- `Help me write a requirements document`
- `I want to build a xxx product, help me sort out the requirements`
- `Help me organize these ideas into a structured requirements document`
- `Help me add exception scenario acceptance criteria to an existing requirements document`

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

- **When**: before writing acceptance criteria. If the user hands over enterprise material while describing requirements, have it captured as knowledge entries first through the intake entry point above — by default directly via `openlogos knowledge apply` (candidate directory outside the project root, no proposal), and through change-writer planning a knowledge delta only when the knowledge revision must land together with a scenario change — then continue.
- **Output**: when an acceptance criterion involves an enterprise rule, note its basis after the criterion (e.g. "per K03-R1").
