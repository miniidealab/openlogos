---
title: Change Management
description: The Delta change management mechanism — change proposals, impact analysis, the delivery gate, one-call atomic merge, incremental amendment, slicing, and archival.
---

The Delta change management specification defines how OpenLogos projects handle feature iterations and bug fixes after the initial development cycle. Every change starts as a proposal, gets reviewed, then merges back into the main documents — ensuring traceability, auditability, and rollback capability.

## Core Principles

1. **Never modify main documents directly** — every change starts as a proposal in `logos/changes/`
2. **Impact analysis first** — `proposal.md` must clearly scope the change and its deployment impact
3. **Propagate on demand** — not every change requires a full-chain update; only affected layers are updated
4. **Traceable deployment** — a proposal that needs deployment carries a deployment task and smoke plan
5. **Archive for history** — completed changes are archived, preserving a full audit trail
6. **One active proposal at a time** — while an unarchived proposal holds the guard, `openlogos change` refuses to create another

## Lifecycle States

Change management is activated when a module transitions from `initial` to `launched` (via `openlogos launch`). During the initial development cycle, changes flow through the phase progression without proposals.

| Lifecycle | Behavior |
|-----------|----------|
| `initial` | Follow Phase 1 → 2 → 3 progression freely, no proposals needed |
| `launched` | Changes to version-controlled code and specs require a proposal via `openlogos change <slug>` |

## Directory Structure

```
logos/
├── resources/                    # Main documents (current "source of truth")
│
└── changes/                      # Change proposal workspace
    ├── add-remember-me/          # An active change proposal
    │   ├── proposal.md           # Change description + impact analysis
    │   ├── tasks.md              # Task checklist ([delta] / [code] / [deploy])
    │   ├── deltas/               # Delta files (incremental modifications)
    │   │   ├── prd/
    │   │   ├── api/
    │   │   ├── database/
    │   │   └── scenario/
    │   ├── SPEC_MERGED           # Written by openlogos merge (last step)
    │   └── TEST_SLICE_MANIFEST.json  # Written by openlogos slice plan
    │
    └── archive/                  # Completed change history (audit only)
        └── 20261012-1430-add-remember-me/
```

## Guard Mechanism

`openlogos change` writes `logos/.openlogos-guard`, which names the active proposal; `openlogos archive` removes it.

- **Guard exists** → the AI may modify code and specs, but only within the proposal's scope
- **No guard** → in a launched project, writing protected content is refused; run `openlogos change <slug>` first

### What the guard protects

Since 0.16.0 the guard protects **content that goes into version control**, not a list of command words. In a launched git project with no active proposal:

- **Protected**: tracked files, new files that are not git-ignored, and everything under `logos/resources/` (even if ignored). Ignore-rule sources (every `.gitignore`, `.git/info/exclude`), `logos/logos.config.json`, git metadata and the guard's own state can never be exempted.
- **Not protected**: untracked files that git ignores — dependencies, build output, logs and caches — and paths listed in `guard.exempt`. Writing them needs no proposal.
- **Edit / Write tools** are judged before they run. **Bash / PowerShell** get a light pre-check (blocked only when the write target is known and protected) and an **after-execution content comparison**: if protected content changed without a proposal, the guard reports the changed files and a restore command.
- Standalone `git` and `openlogos` invocations are not reported.

The full contract, including host-specific behavior, is in [PreToolUse Guard](/specs/pretooluse-guard).

### Changing the protection scope

Use the scope commands instead of editing `.gitignore` or `logos/logos.config.json` by hand:

```bash
openlogos ignore add|remove|list <pattern>   # managed block in .gitignore
openlogos exempt add|remove|list <path>      # guard.exempt: committed paths that need no proposal
```

`add` / `remove` change what the guard protects, so they **must be approved by the user in the host's native permission prompt** (`list` is unrestricted). A verbal "yes" in the conversation is not approval. If the current permission mode cannot show a prompt, run the command yourself in the terminal (`! <command>` in Claude Code) or switch to the default permission mode. The standing authorization of `--auto` does not cover these commands. See [`openlogos ignore` / `openlogos exempt`](/cli/ignore-exempt).

## Two-tier Authorization

- **Semi-auto (default)** — `openlogos merge`, `openlogos verify`, deployment, `openlogos smoke`, `openlogos archive` and `git push` are human confirmation points. The AI runs them only when the user explicitly asks; "finish the flow" style phrasing is not authorization.
- **Full-auto (`openlogos next --auto`)** — choosing `--auto` is a standing authorization for the whole proposal: skippable flow gates are auto-passed and verify, deployment, smoke, archive and `git push` run without step-by-step confirmation. Every auto-pass is appended to `GATE_AUTO_PASSED`.
- **Hard red line (every mode)** — `gate:implement:loop-exhausted`: code that hit the iteration limit without passing tests is never released, even under `--auto`.

The AI commits automatically (and tells the user) after merge, after code, and after archive. See [`openlogos next`](/cli/next).

## File Specifications

### proposal.md

`openlogos change` writes the full template; fill it in place, section by section, rather than rewriting it. The required sections are checked by `openlogos change-lint` (L0): Reason, Change Type, Scope, Deployment Impact, Summary and Decision Clarification. The template also has an optional Minimal Implementation Rationale and a UI/UX Change Declaration block (checked by L7 in GUI projects).

- **Deployment Impact** is the proposal-level deployment decision. "No deployment" means no `[deploy]` section; "deployment required" means a `[deploy]` section and a deployment-plan update (or a citation of a merged plan).
- **Decision Clarification** holds an `openlogos/clarification@1` block covering five impacts — `data`, `compatibility`, `security_privacy`, `public_release`, `external_commitment` — and the decisions the user made. Deployment and public release are decided separately. The block is a record for people, not a hard gate. See [`openlogos change`](/cli/change#decision-clarification-clarification1).

### tasks.md

```markdown
# Implementation Tasks

## [delta] Spec Changes
- [ ] Output delta file to deltas/prd/1-product-requirements/ — Update requirements
- [ ] Output delta file to deltas/api/ — Update API YAML

## [code] Code Implementation

## [deploy] Deployment
- [ ] Deploy to staging
```

- `## [delta]` — one task per delta file. All checked → `ready-to-merge`
- `## [code]` — **left empty during planning**. After merge, `slice-planner` writes the slices through `openlogos slice plan --file <slices.json>`, together with `TEST_SLICE_MANIFEST.json`
- `## [deploy]` — only when the proposal requires deployment
- A code-only proposal has no `[delta]` but keeps the empty `## [code]` heading, and still runs a no-delta `openlogos merge`
- Do not add verify/acceptance tasks — `openlogos verify` is a separate CLI step

See [tasks.md Format](/specs/tasks-spec).

### deltas/ Directory

Delta files use tagged sections:

```markdown
## ADDED — [New Content Title]
[Complete new content]

## MODIFIED — [Existing Section Title]
[Complete content of the whole section]

## REMOVED — [Removed Section Title]
[Reason for removal]
```

- The heading is the **section anchor** and must match exactly one section in the target; use `Parent > Child` or `Title [2]` when a heading repeats.
- `MODIFIED` replaces the section up to the next heading of the same or higher level — write one block per section when rewriting several.
- Unchanged structured IDs in a `MODIFIED` section must be carried over; partial removal is `MODIFIED` (remaining content) + `REMOVED-ITEMS` (naming removed IDs).

The delta tree mirrors the main documents and nested paths are preserved:

| Delta path | Corresponds to |
|-----------|----------------|
| `deltas/prd/` | `logos/resources/prd/` |
| `deltas/api/` | `logos/resources/api/` |
| `deltas/database/` | `logos/resources/database/` |
| `deltas/scenario/` | `logos/resources/scenario/` |
| `deltas/test/` | `logos/resources/test/` |

## Change Workflow

```
1. Create the proposal (CLI)
   └── openlogos change <slug>  → proposal.md + tasks.md + deltas/, writes the guard

2. Write the plan (change-writer)
   └── Fill proposal.md (incl. decision clarification) and tasks.md ([delta] / [deploy], empty [code])
   └── GUI projects: produce UI prototypes now, so the plan is approved with the UI in view
   └── openlogos change-lint → must exit 0
   └── plan-exit gate: the user approves the plan

3. Write deltas (change-writer)
   └── One delta per [delta] task, check each off → ready-to-merge
   └── openlogos change-lint → must exit 0
   └── spec-exit gate: review deltas, authorize the merge

4. Merge (CLI, human confirmation point)
   └── openlogos merge <slug>
   └── One call: admission (= change-lint) → compose by section anchor → atomic write
       → SPEC_MERGED (with test_change_set) written last. All or nothing.
   └── AI commits the spec changes

5. Plan slices (slice-planner)
   └── slices.json → openlogos slice plan --file slices.json
   └── Writes [code] + TEST_SLICE_MANIFEST.json
   └── slice-exit gate: the user approves the slicing

6. Implement (code-implementor)
   └── Slice by slice: business code + tests + OpenLogos reporter; AI commits code

7. Verify (CLI, human confirmation point) — Gate 3.6
   └── openlogos verify → VERIFY_PASS / VERIFY_FAIL

8. Deliver (only when the proposal requires deployment)
   └── Deploy per the deployment plan (human confirmation point)
   └── openlogos deploy-done (Gate 3.7) → openlogos smoke (Gate 3.8)

9. Archive (CLI, human confirmation point)
   └── openlogos archive <slug> → moves to archive/, removes the guard; AI commits
   └── git push (human confirmation point)
```

### Amending a merged proposal

If the deltas need to change after step 4, edit them and run `openlogos merge <slug>` again. The command amends incrementally from the recorded merge baseline (`result:"amended"`), clears `VERIFY_*` / `DEPLOY_DONE` / `SMOKE_*` so the amended spec is verified again, and leaves `[code]` and the slice approval alone. `openlogos status --format json` shows the pending state as `spec_amend`. If a merged target was edited by hand, the amendment is refused with review instructions — carry such corrections in a new proposal. See [`openlogos merge`](/cli/merge).

## The Launched Flow

Under the launched flow (see the [Flow Specification](/specs/flow-spec)), the lifecycle is a seven-subflow pipeline:

```
plan → spec → merge → slice → implement → deliver → close
```

| Subflow | Nodes | Exit gate | Notes |
|---------|-------|-----------|-------|
| **plan** | `write-proposal`, `write-tasks` | `plan-exit` (human, skippable) | `write-tasks` produces `[delta]` / `[deploy]` only — **no `[code]`** |
| **spec** | `write-delta` | `spec-exit` (human, skippable) | `when: delta_required`; review deltas + authorize merge |
| **merge** | `generate-merge-prompt`, `apply-merge` | — | One `openlogos merge` call completes the subflow by writing `SPEC_MERGED` (the first node id is historical). Pure-code proposals run a no-delta merge |
| **slice** | `plan-slices` (slice-planner) | `slice-exit` (human, skippable) | `when: code_required`; slices against the **merged** spec + real test IDs |
| **implement** | `code`, `verify` | — | Slice loop active by default (`until: code_slices_green`, `max_iters: 30`) |
| **deliver** | `deploy`, `smoke` | `deliver-entry` (human, skippable) | Deployment decided at the **proposal level** |
| **close** | `archive` | — | — |

- **`[code]` slicing happens after merge.** It is cut against real merged specs and fixed test IDs, not guessed against a draft. Slices filled in early are reset by `openlogos merge` (backed up to `CODE_AUTORESET`).
- **No-delta still has spec-complete.** A pure-code proposal runs `openlogos merge <slug>`, which writes `SPEC_MERGED` with `type:"no_delta_spec_complete"`. Until then `next` / `status` report `spec-complete-required`; afterwards, missing real test IDs report `test-id-required`.
- **Deployment is a proposal-level decision.** `deployment_required` / `smoke_required` come from the proposal's Deployment Impact plus the `[deploy]` section, never from module defaults.

The residency states `ready-to-delta` (at `plan-exit`), `ready-to-merge` (at `spec-exit`) and `ready-to-implement` (at `slice-exit`) express where the flow waits; see [`openlogos status`](/cli/status#proposal-steps).

## Change Propagation Rules

| Change Type | Minimum Update Scope | Description |
|------------|---------------------|-------------|
| Requirements-level | Full chain | Requirements changed — all downstream may be affected |
| Design-level | Prototypes + scenarios + API/DB + orchestration + code | Requirements unchanged, implementation approach adjusted |
| Interface-level | API/DB + orchestration + code | Design unchanged, interface details adjusted |
| Code-level fix | Code + re-verification | Bug fix, no design changes involved |

## Git Integration

- Each change proposal maps to a Git branch: `change/{change-name}`
- Spec commits after merge, code commits after implementation, and the archive commit are made by the AI automatically; `git push` is a human confirmation point
- `logos/changes/archive/` provides the change history; it is audit-only and never used to reconstruct main documents
- CI can recognise archive-only commits as lifecycle bookkeeping with [`openlogos impact`](/cli/impact)

## CLI Commands

```bash
openlogos change add-remember-me            # Create change proposal + guard
openlogos change-lint                       # Delivery check (exit 0 required)
openlogos merge add-remember-me             # One-call atomic merge / incremental amendment
openlogos slice plan --file slices.json     # Write [code] slices + TEST_SLICE_MANIFEST.json
openlogos verify                            # Gate 3.6
openlogos archive add-remember-me           # Archive completed change
```

## Related Skills

| Skill | Role |
|-------|------|
| [`change-writer`](/skills/change-writer) | Fills `proposal.md` and `tasks.md`, writes deltas, and must pass `openlogos change-lint` before reporting completion |
| [`merge-executor`](/skills/merge-executor) | Read-only review before the merge is authorized, failure diagnosis and delta repair, post-merge ID count and commit handoff |
| [`slice-planner`](/skills/slice-planner) | Plans `[code]` slices after merge and writes them via `openlogos slice plan` |
| [`code-implementor`](/skills/code-implementor) | Implements the approved slices with tests and the OpenLogos reporter |
