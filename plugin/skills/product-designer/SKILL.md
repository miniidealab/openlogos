---
name: product-designer
description: "Create product design specifications including feature specs and page designs. Use when requirements exist in logos/resources/prd/1-product-requirements/ but logos/resources/prd/2-product-design/ is empty."
---

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

### Step 3: Refine Interaction Specifications Per Scenario

Define complete interaction details for each scenario (see format examples below). Different product types emphasize different interaction dimensions.

### Step 4: Supplement Interaction-Level Acceptance Criteria

Building on the Phase 1 GIVEN/WHEN/THEN, refine down to the interaction element level.

### Step 5: Generate Prototypes

Generate prototypes in the format corresponding to the product type (see examples).

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
- Design documents and prototypes appear in pairs: `{number}-{name}-design.md` + `{number}-{name}-prototype.{ext}`
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
