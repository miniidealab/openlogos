# Skill: Product Designer

> Based on scenarios from the Phase 1 requirements document, refine interaction flows and feature specifications, and generate product prototypes. The prototype format automatically adapts to the product type (Web/CLI/Library, etc.). Scenario numbering stays consistent with Phase 1.

## Trigger Conditions

- User requests a product design document or feature specification
- User requests prototypes or interaction design
- User mentions "Phase 2", "product design layer", or "WHAT"
- Requirements document exists (with scenario definitions) and solution design needs to begin

## Core Capabilities

1. **Identify the product type** and determine the corresponding prototype format (see Product Types and Prototype Strategy below)
2. Design information architecture (page structure / command structure / API structure)
3. Use Phase 1 scenarios as the backbone to refine interaction flows and feature specifications
4. Supplement each scenario with interaction-level GIVEN/WHEN/THEN acceptance criteria
5. Generate prototypes appropriate for the product type
6. When a scenario is too coarse-grained, split it into sub-scenarios (`S01.1`, `S01.2`)

## Product Types and Prototype Strategy

Before executing this Skill, first determine the product type (inferred from the requirements document's constraints and boundaries, and the `tech_stack` in `logos-project.yaml`), then select the corresponding prototype format:

| Product Type | Typical Features | Prototype Format | Interaction Spec Focus |
|---------|---------|---------|-------------|
| **Web Application** | Has UI pages, user login | Interactive HTML pages | Page navigation, form validation, state changes |
| **CLI Tool** | Terminal commands, no GUI | Terminal interaction examples (command + output simulation) | Command format, parameter design, output format, error messages |
| **AI Skills / Conversational Product** | User interacts with AI via natural language | Dialogue flowchart + sample dialogue scripts | Dialogue steps, AI questioning strategy, deliverable format |
| **Library / SDK** | Called by other programs | API usage examples (code snippets) | Public interfaces, parameter design, return values, error codes |
| **Mobile Application** | Mobile UI | HTML pages (mobile viewport) | Gesture interaction, navigation patterns, offline state |
| **Desktop Application** | Locally installed, has GUI, standalone window (Electron / Tauri / SwiftUI / Jetpack Compose / Qt / WPF / GTK, etc.) | HTML simulating desktop layout (with menu bar / toolbar / status bar) or stack-specific style guide | Window management, menu bar / context menu, keyboard shortcuts, system tray, multi-window coordination, file system interaction |
| **Hybrid** | Combination of multiple deliverables | Select the corresponding format for each deliverable | Interaction handoffs between deliverables |

## Execution Steps

### Step 1: Read the Requirements Document and Identify the Product Type

Read the Phase 1 requirements document and extract:
- Scenario list (`S01`, `S02`...) and priorities
- Constraints and boundaries → determine product type
- `tech_stack` in `logos-project.yaml` → confirm technical form

**Scenario Granularity Check**: While reading the scenario list, watch for signs that scenarios are actually single CRUD operations (e.g., "Create Task", "Get Task List", "Update Task", "Delete Task" as 4 separate scenarios). If detected, recommend returning to Phase 1 to re-organize scenarios by business goals before proceeding with product design. Designing interactions for CRUD-level "scenarios" will produce shallow specs that don't reflect real user workflows.

Output the product type determination and rationale for the prototype strategy selection.

### Step 2: Design Information Architecture

Design architecture at different levels based on the product type:

- **Web Application**: Page structure, navigation hierarchy, route design
- **CLI Tool**: Command tree structure, subcommand hierarchy, global options
- **AI Skills**: Skill trigger relationships, dialogue step orchestration, deliverable dependency chain
- **Library / SDK**: Module structure, public API grouping
- **Desktop Application**: Window structure, menu / shortcut system, IPC design (main↔renderer process / native layers), local storage and file system

### Step 3: Refine Interaction Specifications Per Scenario

Define complete interaction details for each scenario (see format examples below). Different product types emphasize different interaction dimensions.

### Step 4: Supplement Interaction-Level Acceptance Criteria

Building on the Phase 1 GIVEN/WHEN/THEN, refine down to the interaction element level.

### Step 5: Generate Prototypes

#### Step 5a (GUI Products Only): Invoke ui-ux-pro-max to Get the Design System

**When to apply**: Any product type whose deliverables include a graphical user interface (GUI)—
- ✅ Trigger: Web Application / Mobile Application / Desktop Application (Electron / Tauri / SwiftUI / Jetpack Compose / Qt / WPF / GTK, etc.) / Hybrid products with GUI deliverables
- ❌ Skip: Pure CLI Tool / Library / AI Skills / pure API service or any product type without GUI deliverables

**Steps**:

1. Extract keywords from the Phase 1 requirements document: product type (SaaS / e-commerce / dashboard / portfolio, etc.) + industry + style preferences
2. Invoke `ui-ux-pro-max`:
   ```bash
   python3 logos/skills/ui-ux-pro-max/scripts/search.py "<product_type> <industry> <style_keywords>" --design-system -p "<project_name>"
   ```
3. Consume the output: style + color palette + font pairing + landing page patterns + anti-patterns as the visual foundation for Step 5 prototype generation
   - Web Application: implement the style guide in HTML
   - Desktop / Mobile Application: produce a style guide per the corresponding tech stack (Electron / Tauri reuse react / shadcn / html-tailwind data; SwiftUI / Jetpack Compose / Flutter map directly to their stack data; other native stacks use stack-agnostic style/color/font recommendations)

**Fallback**:

If `python3` is unavailable, skip this step and inform the user: "Python 3 (required by ui-ux-pro-max) is not detected. The prototype will be generated using a generic style. Install Python 3 and retry to get professional design system recommendations." Continue with Step 5 using a generic style; do not block.

#### Step 5b: Generate Prototypes per Product Type

Generate prototypes in the format corresponding to the product type (see examples). For GUI products, build on the design system obtained in Step 5a; for non-GUI products, pick the prototype format directly by product type.

### Step 6: Output the Product Design Document

Organize by scenario, with each scenario containing interaction specifications + corresponding prototype.

## Scenario Elaboration Examples

### Web Application Example

```markdown
### S01: Email Registration — Interaction Specification

**Pages Involved**: Registration page, email verification waiting page, verification success page

**Interaction Flow**:
1. User clicks "Sign Up" on the homepage → redirected to the registration page
2. Registration page contains: email input, password input, confirm password input, sign up button
3. Real-time validation: email format, password length ≥ 8, both passwords match
4. Successful submission → redirected to email verification waiting page

#### Acceptance Criteria (Interaction Level)

##### Normal: Successful Registration
- **GIVEN** User is on the registration page, all fields are empty
- **WHEN** User enters test@example.com, password "Pass1234", confirm password "Pass1234", clicks "Sign Up" button
- **THEN** "Sign Up" button enters loading state, redirects to email verification waiting page after 1-3 seconds
```

**Prototype**: `01-register-prototype.html` (interactive HTML page)

### CLI Tool Example

````markdown
### S01: CLI Project Initialization — Interaction Specification

**Command Format**: `openlogos init [name]`

**Parameter Design**:
| Parameter | Type | Required | Default | Description |
|------|------|------|--------|------|
| name | string | No | Current directory name | Project name |

**Interaction Flow**:
1. User runs `openlogos init my-project` in the terminal
2. CLI checks if `logos/logos.config.json` already exists
3. Does not exist → creates directory structure, outputs created file list line by line
4. Exists → outputs error message and exits

**Terminal Output Simulation**:

Normal path:
```
$ openlogos init my-project

Creating OpenLogos project structure...

  ✓ logos/resources/prd/1-product-requirements/
  ✓ logos/resources/prd/2-product-design/
  ✓ logos/resources/prd/3-technical-plan/1-architecture/
  ✓ logos/resources/prd/3-technical-plan/2-scenario-implementation/
  ✓ logos/resources/api/
  ✓ logos/resources/database/
  ✓ logos/resources/scenario/
  ✓ logos/changes/
  ✓ logos/logos.config.json
  ✓ logos/logos-project.yaml
  ✓ AGENTS.md
  ✓ CLAUDE.md

Project initialized. Next steps:
  1. Edit logos/logos.config.json to configure your project
  2. Start with Phase 1: tell AI "Help me write requirements"
  3. Run `openlogos status` to check progress at any time
```

Error path:
```
$ openlogos init
Error: logos/logos.config.json already exists in current directory.
This directory has already been initialized as an OpenLogos project.
```

#### Acceptance Criteria (Interaction Level)

##### Normal: Brand New Project
- **GIVEN** Current directory has no `logos/logos.config.json`
- **WHEN** User runs `openlogos init my-project`
- **THEN** Terminal outputs the 12 created files/directories line by line, ends with "Next steps" guidance, exit code is 0

##### Error: Already Initialized
- **GIVEN** Current directory already contains `logos/logos.config.json`
- **WHEN** User runs `openlogos init`
- **THEN** Terminal outputs a red error message, no files are created, exit code is 1
````

**Prototype**: `01-init-terminal.md` (terminal interaction simulation document)

### AI Skills / Conversational Product Example

```markdown
### S02: AI-Assisted Requirements Writing — Interaction Specification

**Trigger Method**: User enters natural language in an AI coding tool

**Dialogue Flow**:
1. User says "Help me write requirements"
2. AI reads the prd-writer Skill
3. AI follows up: "Please first tell me your product positioning — what problem does this product solve, and for whom?"
4. User describes the product idea
5. AI follows up: "Who is the core user? Can you describe a specific person?"
6. User describes the user persona
7. AI consolidates the information and begins outputting a structured requirements document
8. After output, AI asks: "The requirements draft has been generated. Please review it and let me know what needs to be changed."

**AI Behavioral Guidelines**:
- No more than 3 rounds of follow-up questions, each round focusing on 1 key piece of information
- If the user provides sufficient information in the first message, skip follow-up questions and output directly
- Output document format strictly follows the prd-writer specification

#### Acceptance Criteria (Interaction Level)

##### Normal: Sufficient Information
- **GIVEN** User describes product positioning, target users, and core pain points in the first message
- **WHEN** AI begins executing the prd-writer Skill
- **THEN** AI directly outputs a structured requirements document without follow-up questions

##### Normal: Insufficient Information
- **GIVEN** User only says "Help me write requirements"
- **WHEN** AI begins executing the prd-writer Skill
- **THEN** AI asks about product positioning (round 1) → user responds → AI asks about target users (round 2) → user responds → AI outputs requirements document
```

**Prototype**: `02-prd-writer-dialogue.md` (dialogue flow script)

## Output Specification

- Feature specs: `logos/resources/prd/2-product-design/1-feature-specs/`
- Prototypes: `logos/resources/prd/2-product-design/2-page-design/`
- Design documents and prototypes appear in pairs: `<module>-{number}-{name}-design.md` + `<module>-{number}-{name}-prototype.{ext}` (read current module from `modules[]` in `logos-project.yaml`, default is `core`)
  - Web Application: `.html`
  - CLI Tool: `-terminal.md` (terminal interaction simulation)
  - AI Skills: `-dialogue.md` (dialogue flow script)
  - Library / SDK: `-api-examples.md` (usage examples)
- **Scenario numbering must be consistent with Phase 1**; use sub-numbers when splitting (`S01.1`)

## Best Practices

- **Scenarios are the backbone**: Don't organize documents by "pages" or "commands" — organize by "scenarios"
- **Phase 1 acceptance criteria are the input**: Phase 2 does not rewrite acceptance criteria; it refines Phase 1 criteria down to the interaction element level
- **Sub-scenario splits need justification**: Only split when a Phase 1 scenario truly contains two independent interaction paths
- **CLI "prototypes" are terminal output simulations**: No HTML needed — use code blocks to simulate terminal input/output
- **AI Skills "prototypes" are dialogue scripts**: Simulate multi-turn conversations between the user and AI, specifying AI behavior at each node
- **Hybrid products are organized by scenario**: Within the same product, CLI scenarios use terminal simulations while Web scenarios use HTML — no need for a uniform format
- **Nested Markdown code blocks**: When the document content itself contains ` ``` ` code fences (e.g., AI outputting code snippets in dialogue scripts, or nested command output in terminal simulations), **the outer fence must use 4 backticks** (` ```` `), keeping the inner fence at 3. This is standard Markdown syntax to prevent the parser from misjudging nesting levels and causing formatting issues. The CLI Tool example above demonstrates this rule.

## Recommended Prompts

The following prompts can be copied directly for use with AI:

- `Create product design based on the requirements document`
- `Help me design the interaction flow and prototype for S01`
- `Help me create the product design for all scenarios`
- `Help me design the CLI command interaction flow`
- `Help me design the AI Skill dialogue flow`

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

- **When**: before writing feature specs and interaction design.
- **Output**: cite the basis wherever interaction flows, field constraints or copy are governed by enterprise rules; when an interaction conflicts with a rule, stop and ask as described above, never change or bypass the rule on your own.
