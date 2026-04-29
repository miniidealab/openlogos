---
name: change-writer
description: "Write change proposals with impact analysis following OpenLogos delta workflow. Use when the project lifecycle is active and source code or methodology documents need modification."
---

# Skill: Change Writer

> Assist in writing change proposals — analyze the scope of change impact, generate a structured proposal.md and a phase-based tasks.md, ensuring changes are traceable and impact is controllable.

## Trigger Conditions

- User has just run `openlogos change <slug>` and wants AI help filling in the proposal
- User describes a need to modify, add, or remove a scenario/feature
- User mentions "change proposal", "iteration", "requirement change"

## Prerequisites

1. Project is initialized (`logos/logos.config.json` exists)
2. Change proposal directory has been created by CLI (`logos/changes/<slug>/` exists)
3. Main documents are readable (effective documents exist in `logos/resources/`)

If prerequisites are not met, prompt the user to run `openlogos change <slug>` to create the proposal directory first.

## Core Capabilities

1. Understand the user's intended change
2. Scan existing documents in `logos/resources/` to identify the affected scope
3. Determine the change type based on change propagation rules (Requirement-level / Design-level / Interface-level / Code-level)
4. Generate a compliant proposal.md
5. Automatically break down tasks.md by change type

## Execution Steps

### Step 1: Understand the Change Intent

Confirm the following information with the user (ask follow-up questions if insufficient, up to 2 rounds):

- **What is the change**: What needs to be added, modified, or removed?
- **Reason for the change**: Why is this change needed? Is it from requirement feedback, a bug, or an optimization?
- **Related scenarios**: Which existing scenario IDs are involved (S01, S02...)?

### Step 2: Analyze the Impact Scope

Scan documents in `logos/resources/` to determine the impact scope:

1. Read requirement documents (`prd/1-product-requirements/`) to check related scenario definitions
2. Read product design (`prd/2-product-design/`) to check related functional specs and prototypes
3. Read technical plans (`prd/3-technical-plan/`) to check related sequence diagrams
4. Read API documents (`api/`) to check related endpoints
5. Read DB documents (`database/`) to check related table structures
6. Read orchestration tests (`scenario/`) to check related test cases

### Step 3: Determine the Change Type

Refer to change propagation rules to determine the change type and minimum update scope:

| Change Type | Minimum Updates Required |
|-------------|------------------------|
| Requirement-level change | Full chain (Requirements → Design → Architecture → API/DB → Orchestration → Code) |
| Design-level change | Prototypes + Scenarios + API/DB + Orchestration + Code |
| Interface-level change | API/DB + Orchestration + Code |
| Code-level fix | Code + Re-verification |

### Step 4: Generate proposal.md

Generate using the following template and write to `logos/changes/<slug>/proposal.md`:

```markdown
# Change Proposal: [Change Name]

## Reason for Change
[Why is this change needed? What requirement/feedback/bug does it originate from?]

## Change Type
[Requirement-level / Design-level / Interface-level / Code-level]

## Change Scope
- Affected requirement documents: [List, down to filename and section]
- Affected functional specs: [List]
- Affected business scenarios: [Scenario ID list]
- Affected APIs: [Endpoint list]
- Affected DB tables: [Table name list]
- Affected orchestration tests: [List]

## Change Summary
[Describe in 1-3 paragraphs what specifically will change]
```

### Step 5: Generate tasks.md

Automatically break down the task checklist based on the change type and impact scope. Only list the phases that need updating:

```markdown
# Implementation Tasks

## Phase 1: Document Changes
- [ ] Update acceptance criteria for S0x in requirement documents
- [ ] Add/modify scenario in the scenario overview table

## Phase 2: Design Changes
- [ ] Update interaction design for S0x in functional specs
- [ ] Update prototypes

## Phase 3: Technical Changes
- [ ] Update sequence diagram for S0x
- [ ] Update API YAML
- [ ] **Validate API YAML** — all files in `logos/resources/api/` must be valid YAML and valid OpenAPI 3.x (all `description`/`summary` values containing `:` or special chars must be double-quoted)
- [ ] Update DB DDL
- [ ] Update orchestration test cases
- [ ] Implement code changes
```

### Step 6: Guide Follow-up Actions (Chain-driven)

Provide a ready-to-use prompt that allows the user to kick off chain execution of all tasks with a single command:

- **Requirement-level / Design-level changes** (multiple tasks): Suggest the user say "Follow tasks.md and help me progressively update all affected documents for S0x"
- **Code-level fixes** (fewer tasks): Suggest the user say "Help me fix the [issue description] for S0x and re-verify"

Chain execution behavior rules:
1. AI reads `tasks.md` and executes items sequentially
2. **After completing each task, immediately update that item in `tasks.md` from `[ ]` to `[x]`** (AI does this proactively — no user reminder needed)
3. After completing each task, report a summary of changes and automatically prompt "Continue to the next item?"
4. After the user says "Continue" or provides adjustments, proceed to the next item
5. After all tasks are completed, remind the user to explicitly authorize running `openlogos merge <slug>`

**Key principle**: Do not make the user manually track the task checklist — AI should proactively drive the process.

**`openlogos merge` and `openlogos archive` are human confirmation points**:
- AI must not execute these commands without explicit user authorization
- When the user explicitly requests execution (including via `/openlogos:merge` or `/openlogos:archive` slash commands), AI may execute them
- Must not be triggered implicitly in scenarios like "continue", "finish up", or "follow the process"

AI is only responsible for driving content modifications and must not advance proposal state without explicit authorization.

## Output Specification

- File format: Markdown
- Storage location: `logos/changes/<slug>/`
- Filenames: `proposal.md` and `tasks.md` (overwrite the CLI-generated templates)

## Best Practices

- **Overestimate the impact scope**: Missing an update in one link is more dangerous than double-checking
- **Change type determines workload**: Help users understand before they start that changing one requirement may require a full-chain update
- **tasks.md is the execution checklist**: Check off each item with `[x]` upon completion for easy progress tracking
- **Follow the process even for small changes**: A change that appears to be "just one API line" may affect orchestration tests and code

## Recommended Prompts

The following prompts can be copied directly for use with AI:

**Fill in proposal**:
- `Help me fill in the change proposal <slug>`
- `I want to add a "remember password" feature to the S02 login scenario, help me analyze the impact scope`
- `This bug fix only involves the code layer, help me quickly write a proposal`

**Execute tasks (after proposal is completed)**:
- `Follow tasks.md and help me progressively update all affected documents for S02`
- `Help me fix the 500 error on the S02 login endpoint and re-verify`
