---
title: "openlogos next"
description: Show the single most actionable next step for the current OpenLogos project, in semi-auto (default) or full-auto (--auto) mode.
---

Return the next action a developer or AI assistant should take. It uses the same phase and proposal-state detection as `status`, but compresses the result into one actionable instruction.

## Synopsis

```bash
openlogos next [--module <id>] [--auto] [--format json]
```

Must be run from the project root.

## Options

| Option | Description |
|--------|-------------|
| `--module <id>` | Focus the recommendation on one module. |
| `--auto` | Full-auto / unattended mode: a standing, run-scoped authorization for the whole proposal chain. See below. |
| `--format json` | Output structured JSON for tools such as RunLogos. |

## What it does

- Suggests the next phase prompt for `initial` modules
- Suggests `openlogos change <slug>` for `launched` modules without an active proposal
- Tracks active proposal steps: fill the proposal → approve the plan → write deltas → merge → plan `[code]` slices → implement → verify → deploy / smoke → archive
- Reports blocked modules when another module holds the active guard
- In multi-module projects, lists one suggestion per module (in-progress first); with no in-progress module it suggests `openlogos module add`

## Two authorization tiers

### Semi-auto (default, no `--auto`)

`openlogos merge`, `openlogos verify`, deployment, `openlogos smoke`, `openlogos archive` and `git push` are **human confirmation points**. The AI must not run them on its own; it runs them only when you explicitly ask (including through the matching slash command). Implicit phrases such as "just finish the flow" do not count as authorization. Every human gate behaves exactly as declared in the flow.

### Full-auto (`--auto`)

`openlogos next --auto` is **full-auto / unattended mode**. Choosing `--auto` grants a **standing, run-scoped authorization** for the whole proposal chain — one authorization lets the proposal run to completion without step-by-step confirmation. In this mode `next`:

- **Auto-passes skippable flow gates** — `plan-exit`, `spec-exit`, `slice-exit` and `deliver-entry` are `skippable: true`, so the driver may continue past them (including into merge and deployment). A gate with `skippable: false` still blocks.
- **Auto-executes the CLI steps that come after code is green** — when the proposal is `ready-to-verify`, `ready-to-smoke`, or verified/deployed/smoke-passed, `next` returns the command (`openlogos verify`, `openlogos smoke`, `openlogos archive <slug>`) with `auto_execute: true`. `git push` is covered by the same standing authorization and needs no marker.
- **Writes an append-only `GATE_AUTO_PASSED` audit** — every auto-pass appends one line (gate id + timestamp) to `logos/changes/<slug>/GATE_AUTO_PASSED`. It is an audit trail, not a state source.
- **Respects the safety latch** — if the flow is still stuck on an unfinished node (including an overlay-added `active` / `failed` node), a blocking loop, or a slice-manifest problem, nothing is auto-passed or auto-executed.

The standing authorization does **not** cover changing the guard's protection scope (`openlogos ignore|exempt add|remove`); those always need approval in the host's own permission prompt.

### Hard red line — loop-exhausted

Among flow gates, the one exit gate that **no mode, including `--auto`, ever auto-passes** is `gate:implement:loop-exhausted`: code that hit the iteration ceiling (`max_iters`) without passing tests. It stays blocked so that full-auto only ever ships verified work — **code that did not pass tests is never released**. The only opt-in is an explicit overlay `set-loop` with `set.exhausted_gate.skippable: true` (high-risk, off by default).

### Hard red line — deployment approval and promotion

The second stop that no mode, including `--auto`, passes on its own comes from the [environment registry](/specs/environments): the target environment requires approval and this commit has not been approved (`DEPLOY_APPROVAL_REQUIRED`), or its promotion check has not been met (`DEPLOY_PROMOTION_UNVERIFIED`). The deployment stops at "waiting for approval" or "promotion not met" with nothing executed. A person approves the commit with [`openlogos approve`](/cli/approve) (or first passes a verified smoke upstream), and the driver is simply run again.

To get past it, the AI must not approve on its own, add `--force-promote`, switch to another environment or version, deploy by hand or record the deployment with `deploy-done`, or edit a gated `logos/environments.yaml` to switch the gate off. The standing `--auto` authorization covers none of these.

## JSON fields

With `--format json`, the envelope carries `action`, `command`, `detail`, `active_change` and `proposal_step`. With `--auto` it adds `auto: true`, `gate_id`, `skippable` and `gate_auto_passed`, and `auto_execute: true` when a post-green command should be run directly. `gate_auto_passed` (a flow gate) and `auto_execute` (a command step) are never both true in the same response.

## Example

```bash
openlogos next
```

```
Next Step
  Action: Run verification
  Detail: Explicitly request `openlogos verify` to run acceptance tests.
```

## Related commands

- [`status`](/cli/status) — Full dashboard view
- [`change`](/cli/change) — Create a change proposal
- [`verify`](/cli/verify) — Run Gate 3.6 acceptance
- [Orchestratable flow](/concepts/orchestratable-flow) — Gates, loops and the two authorization tiers
