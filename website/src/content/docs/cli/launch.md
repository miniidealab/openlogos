---
title: "openlogos launch"
description: Activate change management after the first development cycle is complete.
---

Transition the project from `initial` lifecycle to `active` lifecycle. Once activated, all modifications to existing documents must go through a structured change proposal.

## Synopsis

```bash
openlogos launch [module-id]
```

Must be run from the project root. If the project has exactly one module, the module id can be omitted.

## What it does

1. Reads `logos/logos-project.yaml` and marks the selected module as `launched`
2. Syncs `logos-project.yaml` project name
3. Regenerates `AGENTS.md` and `CLAUDE.md` with change management rules
4. Re-deploys Skills with launched lifecycle context
5. Re-deploys configured tool plugin assets for Claude Code, OpenCode, and Codex

`launch` uses the same multi-tool expansion as `sync`: if `aiTool` is an array or `all`, all configured Skills and plugin targets are refreshed, not just the first tool.

## Example output

```
✓ Module "core" launched! Change management is now active.
  From now on, modifications to existing documents require a change proposal.
  Run `openlogos change <slug>` to start a new change proposal.
  ✓ AI rules updated in logos/skills/
```

## Before vs. after

| Aspect | `initial` | `launched` |
|--------|-----------|----------|
| Phase progression | Free — AI follows phases | Free — AI follows phases |
| Modifying existing documents | Allowed directly | Requires a change proposal |
| `AGENTS.md` content | "No change proposals needed" | "MUST create proposal before modifying" |
| AI behavior | Writes code directly | Stops and asks for proposal first |
| `openlogos change` | Works (but not enforced) | Enforced by AI instructions |

## When to use

Run `launch` after completing your first development cycle (all phases done, `openlogos verify` passed). The `status` command suggests this automatically when all phases are complete.

Typical timing:

```
openlogos init → Phase 1 → 2 → 3 → openlogos verify
                                          │
                                    openlogos launch   ← here
                                          │
                              openlogos change <slug>  (iterations)
```

## Idempotency

Running `launch` when the selected module is already launched is a no-op:

```
Module "core" is already launched. No action needed.
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `logos/logos.config.json not found` | Not in project root | `cd` to project root, or run `openlogos init` first |

## Related commands

- [`change`](/cli/change) — Create a change proposal (available after launch)
- [`status`](/cli/status) — Shows the lifecycle state and suggests `launch` when ready
- [`sync`](/cli/sync) — Regenerate files (launch also regenerates internally)
