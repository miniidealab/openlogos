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

`openlogos change <slug>` has already written a complete `logos/changes/<slug>/proposal.md` scaffold to disk.
**Fill it in place, section by section. Never rewrite the file as a whole.**

Why: the scaffold carries sections that **no lint enforces** (currently "Minimal Implementation Rationale").
A whole-file rewrite overwrites them along with everything else, and nothing will report an error — a silent
loss.

Do not read "the canonical sections survived every time" as evidence that rewriting is safe: that is **L0**
blocking and forcing you to put them back. And the backstop is thinner than you think — **L7's "UI/UX
declaration section missing" is now a warning** (it lands in `warnings`, counts toward neither violations
nor the exit code, and does not block merge; see feature spec §2.83.1). Only a section that is *present but
malformed* (missing / corrupt / non-object fenced YAML, or a non-boolean `ui_impact`) still fails closed.
It did hard-block an unattended run once, on 20260914 — that incident is exactly why it was downgraded.

So the only sections a gate still holds today are **L0's six canonical ones**. Every other section — the UI
declaration that once hard-blocked, and "Minimal Implementation Rationale" which was never gated at all —
rests entirely on the rule not to rewrite the file as a whole.

For the filling rules see **§Preserve the CLI scaffold** in this Skill (read the scaffold first, replace
placeholder prose only, delete nothing). They are not restated here, and you must **not** write an equivalent
set of instructions of your own — that is how the next drifting source gets created.

**The single authority for canonical required sections is `PLAN_SECTION_REGISTRY`
(`cli/src/lib/plan-package-contract.ts`) plus change-lint (L0 / L7).**
This Skill does not carry its own list of required sections: a list written into prose drifts against both
the scaffold and the criteria, and whether a section is required was never a documentation decision.
To learn what is required right now, run `openlogos change-lint` — do not consult prose.

**Section-by-section pointers** (the scaffold already supplies the section names and placeholder hints;
this only states what each section must answer and what counts as done):

- **Reason for Change** — why now? Which requirement / feedback / bug? State the defect precisely enough
  to be reproducible; "it isn't good enough" is not a reason.
- **Minimal Implementation Rationale** — answer all three: which existing mechanisms you searched (and why
  each is insufficient, or how you reuse it), why it cannot be smaller, and what you deliberately cut.
  **Nothing checks this section — it rests entirely on self-discipline.** It acts *before* the design happens
  and is the only ex-ante step among the anti-overdesign measures. If you cannot name what you cut, you
  usually have not settled the boundary yet.
- **Change Type** — exactly one of Requirement / Design / Interface / Code level, with the deciding evidence
  in parentheses.
- **Scope** — list affected documents / scenarios / APIs / DB tables / tests / code by filename and section;
  write "none" for unaffected categories rather than dropping the line. Scope must reconcile with the
  `[delta]` targets in `tasks.md` (see Step 5).
- **Deployment Impact** — give an explicit value for every field; it is the human review basis and the
  decision source for the `[deploy]` section.
- **UI/UX Change Declaration** — GUI modules must keep this section present and declare `ui_impact`
  truthfully (decision rules in the Step 6 addendum of the Chinese source).
- **Decision Clarification** — status + reason for each of the five impact categories; every decision needs
  a choice and a reason. `status: ready` asserts that nothing is left to clarify.
- **Summary** — 1-3 paragraphs on what concretely changes, enough for a reviewer to judge the approach
  without reading the deltas.

That is the full extent of the pointers — **this step does not provide, and must not provide, any
copy-pasteable proposal template.** There is exactly one source for the document's shape: the scaffold
`openlogos change` wrote to disk.

### Step 5: Generate tasks.md

Automatically break down the task checklist using structured section format based on the change type and impact scope. See `spec/tasks-spec.md` for the full format specification.

**Format rules**:
- `## [delta] <description>` section: only list delta document output tasks, each item corresponds to one delta file
- `## [code] <description>` section: only list code implementation tasks that directly modify source files — no delta output
- Both sections are optional: code-only proposals have only `[code]`, spec-only proposals have only `[delta]`
- **Never mix**: delta tasks must not appear in `[code]` section; code tasks must not appear in `[delta]` section

**Requirement-level / Design-level change template** (delta + code):

```markdown
# Implementation Tasks

## [delta] Spec Changes
- [ ] Output delta file to `deltas/prd/1-product-requirements/` — Update acceptance criteria for S0x
- [ ] Output delta file to `deltas/prd/1-product-requirements/` — Add/modify scenario in overview table
- [ ] Output delta file to `deltas/prd/2-product-design/1-feature-specs/` — Update interaction design for S0x
- [ ] Output delta file to `deltas/prd/2-product-design/2-page-design/` — Update prototypes
- [ ] Output delta file to `deltas/prd/3-technical-plan/1-architecture/` — Update technical architecture
- [ ] Output delta file to `deltas/prd/3-technical-plan/2-scenario-implementation/` — Update sequence diagram for S0x
- [ ] Output delta file to `deltas/api/` — Update API YAML
- [ ] **Validate API YAML** — all files in `logos/resources/api/` must be valid YAML and valid OpenAPI 3.x (all `description`/`summary` values containing `:` or special chars must be double-quoted)
- [ ] Output delta file to `deltas/database/` — Update DB DDL
- [ ] Output delta file to `deltas/scenario/` — Update orchestration test cases

## [code] Code Implementation
- [ ] Implement business logic in src/xxx
- [ ] Write corresponding tests
```

**Code-only fix template** (no delta):

```markdown
# Implementation Tasks

## [code] Code Implementation
- [ ] Fix the issue in src/xxx
- [ ] Update corresponding tests
```

### Step 6: Output Delta Files

**When to trigger**: After tasks.md is filled in and the user has confirmed the proposal, produce delta files item by item per the `[delta]` section task checklist.

**Important**: Only execute tasks in the `[delta]` section. Tasks in the `[code]` section are executed after spec merge (SPEC_MERGED).

When producing delta files, write them under `logos/changes/<slug>/deltas/` with paths that mirror `logos/resources/`:

| Target main document directory | Delta subdirectory |
|---|---|
| `logos/resources/prd/` | `deltas/prd/` |
| `logos/resources/api/` | `deltas/api/` |
| `logos/resources/database/` | `deltas/database/` |
| `logos/resources/scenario/` | `deltas/scenario/` |
| `logos/resources/test/` | `deltas/test/` |

Preserve nested directories. Example: `logos/resources/prd/1-product-requirements/core-01-requirements.md` maps to `deltas/prd/1-product-requirements/core-01-requirements.md`; `logos/resources/test/core-S01-test-cases.md` maps to `deltas/test/core-S01-test-cases.md`.

Provide a ready-to-use prompt that allows the user to kick off chain execution of all tasks with a single command:

- **Requirement-level / Design-level changes** (multiple tasks): Suggest the user say "Follow tasks.md and help me progressively update all affected documents for S0x"
- **Code-level fixes** (fewer tasks): Suggest the user say "Help me fix the [issue description] for S0x and re-verify"

Chain execution behavior rules:
1. AI reads `tasks.md` and executes items sequentially
2. After completing each task, report a summary of changes and automatically prompt "Continue to the next item?"
3. After the user says "Continue" or provides adjustments, proceed to the next item
4. After all tasks are completed, remind the user to explicitly authorize running `openlogos merge <slug>`

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

> This section supersedes earlier examples that populate `[code]` during plan authoring. It shares the same machine contract as the Chinese source.

### Preserve the CLI scaffold

Read the CLI-created `proposal.md` and `tasks.md` before editing.

**For `proposal.md`**: preserve **every** section of the scaffold — canonical headings, section order,
machine-readable blocks, and equally the **non-canonical sections that no lint enforces** (such as
"Minimal Implementation Rationale"), which must not be dropped, omitted, or reduced to an empty shell.
Replace placeholder prose only. Extra design sections are allowed, but they never replace or remove any
existing section. **Never rewrite `proposal.md` as a whole**: a rewrite inevitably loses the ungated
sections, and no check will tell you.

**For `tasks.md`**: this rule does **not** constrain adding or removing sections. `tasks.md` gains and loses
`[delta]` / `[code]` / `[deploy]` according to the actual scope of the change, governed by
`spec/tasks-spec.md` — a spec-only change deletes `[code]`, a code-only change keeps an empty `[code]` and
goes through no-delta spec-complete. Applying "no section may be removed" to `tasks.md` would forbid those
legitimate deletions and misroute the flow.

### Keep `[code]` empty during plan

For a code-required change, retain an empty `## [code] Code Implementation` heading and write no checkbox below it. Real code slices are produced only after spec-complete by slice-planner using merged specifications and real test IDs. Remove the exact legacy template line `- [ ] Implement code changes` if present.

### Read back and verify twice

After writing, read the actual files from disk and run from the project root:

```bash
openlogos change-lint --slug <slug> --format json
openlogos next --format json
```

Report “ready for approval” only when lint exits 0 with `data.pass=true`, and next reports `plan_state.plan_ready=true` plus `proposal_step=ready-to-delta`. Consume every structured issue and repair the pointed artifact in the same producer run. Never infer completion from prose or checkbox counts.

### Delta and authorization boundary

After explicit plan approval, execute only `[delta]` tasks. Read every written Delta back, check off the matching task, and rerun change-lint to exit 0. Do not run merge without separate explicit authorization.

### Managed asset versioning

If the project sync stamp has an older Plan contract or managed-asset hash than the CLI package, require `openlogos sync` and a new Agent session. Never treat different Skill bytes under the same semver as equivalent, and never overwrite project-owned Skills.

## authority_impact 提案生产合同（规范引用）


先读取 `spec/authority-closure.md`。本 Skill 只生产当前 change 的 impact 计划，不重建项目 Authority Registry 或复制根规范。

影响分析时先判断触发：共享业务事实/完成谓词、projection、owner/writer/mutation/recovery/cutover、消费者本地重算风险。每个新或仍 writing 的提案必须有唯一 `openlogos/authority-impact@1`。required 分支引用 Registry 或当前 CREATE authority target，列出 projections、retired shadow sources、forbidden fallbacks、cutover 和真实 UT/ST/SMOKE IDs；not_applicable 分支只含非空可核验证据。

任何 unresolved、未知 fact 引用、空 cutover、测试 ID 不真实或影子来源未退休都不得报告 plan 完成。Delta 仍遵守 P=T=D、一目标一文件、写后读回和逐文件勾选；`[code]` 在 merge 前保持空白。全部 Delta 完成后运行 change-lint，等待独立 merge 授权。
