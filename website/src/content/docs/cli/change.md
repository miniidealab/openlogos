---
title: "openlogos change"
description: Create a structured change proposal for iterative updates to an existing project, and set the active-change guard.
---

Scaffold a new change proposal directory with `proposal.md`, `tasks.md`, and `deltas/` subdirectories, and record it as the active change in `logos/.openlogos-guard`. This is the entry point for the Delta workflow of a `launched` project.

## Synopsis

```bash
openlogos change <slug> [--module <id>]
```

Must be run from the project root.

## Arguments & options

| Argument / option | Required | Description |
|-------------------|----------|-------------|
| `slug` | **Yes** | A kebab-case identifier for the change (e.g., `fix-redirect-bug`, `add-remember-me`) |
| `--module <id>` | No | Assign the proposal to a module. With one module it is auto-assigned; with several it defaults to `core`; a multi-module project without `core` requires `--module` and prints one retry command per module. |

## What it creates

```
logos/changes/<slug>/
├── proposal.md          # Change proposal template
├── tasks.md             # Task checklist ([delta] / [code] / [deploy])
└── deltas/
    ├── prd/             # Delta files for requirements / design / technical plan docs
    ├── api/             # Delta files for API specs
    ├── database/        # Delta files for DB schema
    └── scenario/        # Delta files for orchestration tests
```

It also writes `logos/.openlogos-guard`, which records the active change:

```json
{
  "activeChange": "fix-redirect-bug",
  "module": "core",
  "createdAt": "2026-10-12T08:00:00.000Z"
}
```

While the guard exists, the AI may change code and specs only within this proposal's scope. Without it, a launched project's version-controlled code and specs are protected (see [PreToolUse guard](/specs/pretooluse-guard)).

### Only one active proposal at a time

If the guard already points to a proposal that is still in `logos/changes/` and not archived, `change` refuses to create a new one:

```
Error: Active change proposal 'add-remember-me' is still in progress.
Finish it and explicitly request `openlogos archive add-remember-me` before creating a new proposal.
```

A malformed guard file is also rejected; fix or remove it first. A slug that already exists in `logos/changes/` is rejected too.

## Generated templates

### proposal.md

The template contains these sections (English headings for `locale: en`, Chinese for `zh`):

| Section | Purpose |
|---------|---------|
| `Reason` | Why the change is needed |
| `Minimal Implementation Rationale` | Optional self-check: what existing mechanisms were checked, why it can't be smaller, what was cut |
| `Change Type` | Requirements / Design / Interface / Code |
| `Scope` | Affected requirements, feature specs, scenarios, APIs, DB tables, orchestration tests |
| `Deployment Impact` | Whether deployment is needed and why, environments, data migration, rollback plan, smoke |
| `UI/UX Change Declaration` | YAML block (`ui_impact`, `design_system_mode`, `pages`); meaningful for GUI projects |
| `Decision Clarification` | `openlogos/clarification@1` YAML block (see below) |
| `Summary` | What will change, in 1–3 paragraphs |

### Decision clarification (`clarification@1`)

The `Decision Clarification` section records the choices that only a human can make — anything the repository, configuration or specs cannot answer. Its YAML block lists five kinds of impact, each with a `status` and a non-empty `reason`:

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: pending
impacts:
  data:                {status: none, reason: "..."}
  compatibility:       {status: none, reason: "..."}
  security_privacy:    {status: none, reason: "..."}
  public_release:      {status: none, reason: "..."}
  external_commitment: {status: none, reason: "..."}
decisions: []
unresolved: []
defaults: []
```

- `none` means no user choice is needed (no impact, or facts / policy already decide it); `required` means a high-impact choice must be made by the user and recorded in `decisions`.
- **Deployment and public release are decided separately.** Deployment comes from the `Deployment Impact` section; `public_release` covers npm publish, tags, releases or opening a website. Approving a local or production deployment does not approve a public release, and vice versa.
- The section is required (change-lint L0 checks that it exists and is filled), but its content is a written record for people — it is not a hard gate and does not replace plan approval.

### tasks.md

For a launched module the template is:

```markdown
# Implementation Tasks

## [delta] Spec Changes
- [ ] Update requirements scenarios and acceptance criteria
- [ ] Update product design feature specs

## [code] Code Implementation
```

The `[code]` heading stays **empty** during planning — real `[code]` slices are written after merge by [`slice-planner`](/skills/slice-planner) through [`openlogos slice plan`](/cli/slice). A `[deploy]` section is added when the proposal needs deployment. See [tasks.md Format](/specs/tasks-spec).

## Delivery gate: change-lint

After filling `proposal.md` + `tasks.md`, and again after writing all deltas, run:

```bash
openlogos change-lint
```

Only exit 0 means the proposal artifacts are ready to hand over. `openlogos merge` uses the same verdict as its admission check, so fix violations here rather than at merge time. See [`openlogos change-lint`](/cli/change-lint).

## Example output

```
Creating change proposal: fix-redirect-bug
Module: core (auto-detected, only one module registered)

  ✓ logos/changes/fix-redirect-bug/proposal.md
  ✓ logos/changes/fix-redirect-bug/tasks.md
  ✓ logos/changes/fix-redirect-bug/deltas/
  ✓ logos/.openlogos-guard

Change proposal created. Next steps:
  1. Tell AI: "Help me fill in change proposal fix-redirect-bug"
  2. AI will analyze impact and fill in proposal.md + tasks.md
  3. Then work through tasks.md, putting deltas in deltas/
  4. When done, explicitly request `openlogos merge fix-redirect-bug` …
```

## The Delta workflow

```
openlogos change <slug>
       │
       ▼
  AI fills proposal.md + tasks.md        →  openlogos change-lint (exit 0)
       │                                     plan-exit: approve the plan
       ▼
  AI writes deltas in deltas/            →  openlogos change-lint (exit 0)
       │                                     spec-exit: review deltas, authorize merge
       ▼
openlogos merge <slug>                   →  one call, atomic; writes SPEC_MERGED
       │
       ▼
  slice-planner → openlogos slice plan   →  slice-exit: approve slices
       │
       ▼
  implement code + tests → openlogos verify  (→ deploy → openlogos smoke)
       │
       ▼
openlogos archive <slug>                 →  moves to archive/, removes the guard
```

`merge`, `verify`, deployment, `smoke`, `archive` and `git push` are human confirmation points unless you run `openlogos next --auto`.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Missing change proposal name` | No slug provided | `openlogos change add-remember-me` |
| `Change proposal 'X' already exists` | Same slug already in `logos/changes/` | Choose another slug |
| `Active change proposal 'X' is still in progress` | Another unarchived proposal holds the guard | Finish it and archive it first |
| `logos/.openlogos-guard is invalid` | Guard file is not valid JSON | Fix or remove the guard file |
| `Module 'X' not found in logos-project.yaml` | `--module` value is not registered | `openlogos module list` |
| `logos/logos.config.json not found` | Not in project root | `cd` to project root |

## Related commands

- [`change-lint`](/cli/change-lint) — Delivery gate for proposal and deltas
- [`merge`](/cli/merge) — Merge deltas once authorized
- [`slice`](/cli/slice) — Plan `[code]` slices after merge
- [`archive`](/cli/archive) — Archive the completed proposal
- [`launch`](/cli/launch) — Activate change management for a module
