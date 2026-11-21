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

- **Fact scan**: include the effective knowledge view in Step 1 "check facts first". When a requirement conflicts with an `active` rule, add a `category: product` unresolved item to the proposal's `clarification@1` (the question names the rule ID and the conflict; options are the real ones among "comply", "exception for this change", "rule needs updating") and ask one at a time.
- **When the user provides new material**:
  1. **Material only — do not open a proposal**: when the user only hands over material with no requirement change, capture it directly through steps 2–5 of the intake entry point above with `openlogos knowledge apply`, and do not run `openlogos change`; if the user asks for a proposal just to capture material, explain that none is needed and capture directly.
  2. **Material that leads to a requirement change**: when the new knowledge may take effect before the requirement, capture it directly first, then open the proposal and cite the IDs already in effect; only when a knowledge revision must land together with a scenario change (for example retiring an old rule while rewriting the scenarios that cite it) plan one `deltas/knowledge/<module>-KXX-<slug>.md` task per entry in the `[delta]` section of `tasks.md` and **reserve the KXX**: the highest KXX in `openlogos knowledge list` (including `deprecated` entries) + 1, or K01 when the view is empty (first capture in the project), incrementing for multiple new entries. Scenario design cites the reserved IDs.
  3. In both channels the original goes to `logos/resources/reference/knowledge/` (for direct capture via the candidate `sources/`, copied by apply; in the proposal channel written directly while `reference/` is still exempt, otherwise through `openlogos knowledge apply` with a candidate directory containing only `sources/` — see step 7 of the intake entry point above), and tell the user: "the original will spread with the repository on push; confirm what may be published before pushing".
  4. When writing knowledge deltas: a new entry uses `## ADDED — logos/resources/knowledge/<module>-KXX-<slug>.md（新文件，整文件）`; revising an existing entry uses `MODIFIED` carrying the full section; a new rule takes that entry's highest Rn (including `deprecated`) + 1. `deltas/knowledge/` holds entry files only; `TAGS.md` / `INDEX.md` never go through a delta — add the tags an entry needs to `TAGS.md` through apply first. After the merge, run `openlogos knowledge index` to refresh the index.
- **Impact**: before retiring or revising a rule, run `openlogos knowledge refs <KXX|KXX-Rn>` and record the scenarios that cite it in the proposal's scope of impact.
- **Retire, never delete**: never write `REMOVED` / `REMOVED-ITEMS` against merged entries or rules, and never change the KXX in a merged entry's file name (`knowledge_removal_forbidden`); retiring only sets the status to `deprecated`. Retired content must not return to `active` or have its text rewritten (`knowledge_retired_id_mutated`). An `active` rule may be revised with `MODIFIED` (e.g. a threshold change); if its meaning becomes a different rule, open a new ID and retire the old one.
- **Fixing duplicates**: when change-lint or apply reports `knowledge_id_duplicate`, renumber the entry added by this proposal (or in this candidate batch) to the current highest KXX + 1, rewrite every reference within this proposal, and rerun.
