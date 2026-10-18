---
title: change-writer
description: Write change proposals with impact analysis and decision clarification, plan [delta] / [deploy] tasks, write deltas, and pass the change-lint delivery gate.
---

Assist in writing change proposals — analyze the scope of change impact, fill the structured `proposal.md` and the phase-based `tasks.md`, write the delta files, and make sure everything passes `openlogos change-lint` before reporting completion.

## Phase & Trigger

- **Phase**: Cross-phase (Delta workflow — `write-proposal`, `write-tasks`, `write-delta` nodes)
- **Trigger conditions**:
  - User has run `openlogos change <slug>` and wants help filling in the proposal
  - User describes a need to modify, add, or remove a scenario/feature
  - User mentions "change proposal", "iteration", "requirement change"

## Prerequisites

1. Project is initialized (`logos/logos.config.json` exists)
2. Change proposal directory exists (`logos/changes/<slug>/`) and the guard points to it
3. Main documents in `logos/resources/` are readable

If prerequisites are not met, the user must first run `openlogos change <slug>`.

## What It Does

1. Understand the intended change (what, why, which scenarios)
2. Look up facts first — project index, specs, code, configuration — and only ask the user what the repository cannot answer
3. Scan `logos/resources/` to identify the full affected scope and determine the change type
4. Fill `proposal.md` in place on the CLI template, including deployment impact and decision clarification
5. Plan `tasks.md`: `[delta]` and `[deploy]` only; `[code]` stays an empty heading
6. For GUI projects whose change touches the UI, produce UI prototypes during planning
7. After plan approval, write the deltas
8. Run `openlogos change-lint` at each hand-over and report completion only on exit 0

## Change Types and Propagation

| Change Type | Minimum Updates Required |
|-------------|------------------------|
| Requirement-level | Full chain: Requirements → Design → Architecture → API/DB → Tests → Code |
| Design-level | Prototypes + Scenarios + API/DB + Tests + Code |
| Interface-level | API/DB + Tests + Code |
| Code-level fix | Code + Re-verification |

## Impact Analysis Scope

1. **Requirement documents** (`prd/1-product-requirements/`) — scenario definitions
2. **Product design** (`prd/2-product-design/`) — feature specs and prototypes
3. **Technical plans** (`prd/3-technical-plan/`) — architecture, sequence diagrams, deployment plan
4. **API documents** (`api/`) — affected endpoints
5. **DB documents** (`database/`) — affected table structures
6. **Test cases** (`test/`) — affected test cases
7. **Orchestration tests** (`scenario/`) — affected orchestration files

## proposal.md

`openlogos change` writes the full template. Fill it **section by section in place** — rewriting it wholesale silently drops sections. The required sections (checked by change-lint L0) are Reason, Change Type, Scope, Deployment Impact, Summary and Decision Clarification; the template also carries an optional Minimal Implementation Rationale and the UI/UX Change Declaration block.

### Decision clarification (`clarification@1`)

The Decision Clarification section records the choices only a human can make. Fill its `openlogos/clarification@1` block with the five impacts — `data`, `compatibility`, `security_privacy`, `public_release`, `external_commitment` — each with `status: none | required` and a non-empty `reason` grounded in facts or policy.

- Ask only what the repository cannot answer, one decision at a time, and record the user's answer in `decisions`.
- **Deployment and public release are separate decisions.** Deployment follows from the Deployment Impact section (target environment, method, rollback, smoke evidence). Approving a deployment does not approve an npm publish, tag, release or `git push`, and vice versa.
- The block is a written record for reviewers. It is not a hard gate and does not replace plan approval at `plan-exit`.

### Deployment impact

"No deployment" means no `[deploy]` section and no deployment tasks anywhere. "Deployment required" means a `[deploy]` section plus a deployment-plan update in `[delta]` — or a citation of an already-merged deployment plan section. change-lint L5 checks the two agree.

### Default deployment environment (`proposal_default_env`)

When the project's [environment registry](/specs/environments) `logos/environments.yaml` has a top-level `proposal_default_env`, that is a deployment-target decision you made in advance. For a proposal that needs deployment, the Skill:

1. **Still decides whether to deploy from the change itself** — the default never turns a docs-only or spec-only change into a deployment.
2. **Reads structured facts only**: `openlogos env list --format json` for `proposal_default_env`, then `openlogos env show <id> --format json` for the environment's `deploy` configuration, `current_ref`, `promote_from` and `require_approval`. It does not parse the registry file.
3. **Picks the target environment**: your explicit words in this request win (`source: user`, including "don't deploy this time"); otherwise it takes `proposal_default_env` (`source: policy`) and **does not ask again**; with no default, no registry or an invalid registry, it asks as before. "Affected environments" in the proposal names the environment id.
4. **Checks method, rollback and smoke evidence item by item** against merged specs and the registry configuration (e.g. the `deploy` script or workflow, a rollback via `openlogos deploy --rollback` when `current_ref` exists, a configured smoke command). A deployment plan the proposal itself is writing does not count. Anything still missing is asked in one combined question — when all four are covered, the deployment decision needs no questions at all.
5. **Notes the gates**: if the environment has `require_approval: true` the proposal says the deployment will wait for approval; with `promote_from` it says the same commit must pass smoke upstream first. It never picks another environment to avoid a gate.

The default is not authorization: it decides *where* to deploy, not *whether* the deployment may run, and it never authorizes a public release. change-writer never writes, changes or removes `proposal_default_env`; to change it, edit the registry yourself (no proposal needed).

## tasks.md

```markdown
# Implementation Tasks

## [delta] Spec Changes
- [ ] Output delta file to deltas/prd/1-product-requirements/ — Update acceptance criteria for S0x
- [ ] Output delta file to deltas/prd/3-technical-plan/2-scenario-implementation/ — Update sequence diagram for S0x
- [ ] Output delta file to deltas/api/ — Update API YAML
- [ ] Output delta file to deltas/test/ — Add test cases for S0x

## [code] Code Implementation

## [deploy] Deployment
- [ ] Deploy to staging per the deployment plan
```

- `## [delta]` — one task per delta file. All checked → `ready-to-merge`
- `## [code]` — **only an empty heading during planning.** Do not write any `- [ ]` slice lines. After merge, [`slice-planner`](/skills/slice-planner) writes the slices through `openlogos slice plan --file <slices.json>`. Slices filled in early are reset by `openlogos merge` and backed up to `CODE_AUTORESET`.
- Code-only fixes keep the empty `## [code]` heading and have no `[delta]`. They still run a no-delta `openlogos merge <slug>` (writes `SPEC_MERGED` with `type:"no_delta_spec_complete"`) before slicing.
- If the code change needs new or reused tests, name real `UT-*` / `ST-*` / `SMOKE-*` IDs — through a test delta, or a `## 复用测试 ID` list of IDs that exist in merged specs. Placeholders such as `UT-Sxx-xx` are rejected; without real IDs `next` / `status` stop at `test-id-required`.
- Keep delta tasks and code tasks strictly separated.

## GUI projects: UI prototypes at proposal time

For a launched GUI product (web, desktop, mobile) whose change touches the interface, the skill sets `ui_impact: true` in the UI/UX Change Declaration and produces the prototypes **before** `plan-exit` — so the user approves the plan with the UI in view, instead of discovering a wrong screen after implementation.

- Prototypes are plain HTML written as page-design deltas: `deltas/prd/2-product-design/2-page-design/<module>-NN-<slug>.html`, one per page declared in `pages`.
- With `design_system_mode: generated`, the [`ui-ux-pro-max`](/skills/ui-ux-pro-max) design tokens are kept in `design-system.json` in the proposal directory; `fallback` (e.g. Python 3 unavailable) needs a `design_system_fallback_reason` and no token file.
- The internal checker `openlogos check-ui-prototype` reconciles the declaration with the produced files (declared pages == produced files, each non-empty).
- Do not delete the UI/UX declaration section, even in a non-GUI project; keep it with `ui_impact: false`. Non-GUI projects skip this whole step.

## Delivery gate: `openlogos change-lint`

At each hand-over — after `proposal.md` + `tasks.md`, and after all deltas — run from the project root:

```bash
openlogos change-lint
```

- **exit 0** — the only state in which the skill may report "done" and hand control back
- **exit 2** — fix each violation as its "what's missing / where / what it should look like" lines say, then rerun until exit 0
- **exit 1** — an operational error (no active proposal, invalid slug); fix the environment and rerun

change-lint is read-only and needs no authorization. Passing it does **not** authorize the merge — after the deltas are done, the skill reports readiness and waits for the user to authorize `openlogos merge`. See [`openlogos change-lint`](/cli/change-lint).

## Writing deltas

- Each `.md` delta uses `ADDED` / `MODIFIED` / `REMOVED` markers; no template placeholder may remain.
- A `MODIFIED` block replaces its section up to the next heading of the same or higher level — rewriting several sibling sections needs one block per section.
- Carry unchanged structured IDs inside `MODIFIED`; remove items explicitly with `REMOVED-ITEMS`.
- Use heading-path anchors (`Parent > Child`) or ordinal anchors (`Title [2]`) when headings repeat.
- After writing, read each file back from disk and check off its `[delta]` task.

## Outputs

| File | Location |
|------|----------|
| `proposal.md` | `logos/changes/<slug>/proposal.md` |
| `tasks.md` | `logos/changes/<slug>/tasks.md` |
| Delta files | `logos/changes/<slug>/deltas/**` |
| UI prototypes (GUI only) | `logos/changes/<slug>/deltas/prd/2-product-design/2-page-design/*.html` |

## Best Practices

- **Overestimate the impact scope** — missing one link is more dangerous than double-checking
- **Facts before questions** — never ask the user what the repository already answers
- **Follow the process even for small changes** — "just one API line" may affect tests and code
- **Never merge on your own** — the skill stops at "ready to merge"

## Related Skills

- After the deltas: [`merge-executor`](/skills/merge-executor) — review, run and follow up `openlogos merge`
- After merge: [`slice-planner`](/skills/slice-planner) — plan `[code]` slices
