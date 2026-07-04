---
title: "openlogos next"
description: Show the single most actionable next step for the current OpenLogos project.
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
| `--auto` | Full-auto / unattended mode: standing run-scoped authorization for the whole proposal chain. See below. |
| `--format json` | Output structured JSON for tools such as RunLogos. |

## What it does

- Suggests the next phase prompt for initial modules
- Suggests `openlogos change <slug>` for launched modules without an active proposal
- Tracks active proposal steps: fill proposal, write deltas, merge, code, verify, archive
- Reports blocked modules when another module has the active guard

## Full-auto mode (--auto)

`openlogos next --auto` is **full-auto / unattended mode**. Passing `--auto` grants a **standing, run-scoped authorization** for the entire proposal chain — one authorization lets the proposal run to completion without step-by-step human confirmation. Without `--auto` (semi-auto / manual), every human confirmation point behaves exactly as before.

In `--auto` mode, `next`:

- **Auto-passes skippable human gates.** When the flow reaches a gate boundary whose gate is `skippable: true`, it is treated as passed. A gate with `skippable: false` still blocks.
- **Auto-executes CLI stamp/release steps once the code is green.** As a standing authorization it runs the four "after code is green" red-line steps — `verify`, `smoke`, `archive` and `git push` — directly, with no human confirmation (`auto_execute: true` in the JSON output). `git push` needs no marker or guard change: the PreToolUse guard safelist already allows it.
- **Writes an append-only `GATE_AUTO_PASSED` audit.** Every auto-pass appends one line (gate id + timestamp) to `logos/changes/<slug>/GATE_AUTO_PASSED`. It is an audit trail, not a state source.
- **Respects the R2 safety latch.** If the flow is still stuck on an unfinished node (including an overlay-added `active`/`failed` node), no gate is auto-passed.

### Hard red line — loop-exhausted

The one exit gate that **any mode (including `--auto`) never auto-passes** is loop-exhausted: code that hit the iteration ceiling (`max_iters`) without passing tests (`gate:<subflow>:loop-exhausted`, default `skippable: false`). It stays blocked so that full-auto only ever ships verified work. Full-auto **never releases code that did not pass tests.** The only opt-in is an explicit overlay `set-loop` with `set.exhausted_gate.skippable: true` (high-risk, off by default).

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
- [`verify`](/cli/verify) — Run Gate 3.5 acceptance
