---
title: "openlogos flow show"
description: Show the dev-flow orchestration (built-in template or overlay-resolved).
---

Display the dev-flow orchestration as a read-only tree of subflows, nodes, gates and loops. By default it prints the built-in flow template; with `--resolved` it applies the project's `logos/flow` overlay and shows the effective flow that `status`, `next` and `watch` actually derive from.

## Synopsis

```bash
openlogos flow show [--resolved] [--lifecycle <initial|launched>] [--format json]
```

Must be run from the project root.

## Options

| Option | Description |
|--------|-------------|
| `--resolved` | Apply the project overlay on top of the built-in flow and show the merged, effective orchestration. Without it, the raw built-in flow is shown. |
| `--lifecycle <initial\|launched>` | Choose which flow to show. Defaults to the flow inferred from the project state. |
| `--format json` | Output a structured JSON envelope for tools such as RunLogos. |

## What it does

- Prints each subflow with its gate (`human` / `cmd` / none), marking `entry` position and `skippable`
- Lists every node with its `skill`, `for_each` and `when` attributes
- In `--resolved` mode, annotates overlay operations (`[add]` / `[modify]` / `[skip]` / `[reorder]`) and marks skipped nodes
- Surfaces flow warnings (for example, an overlay `@vN` that does not match the current `builtin_version`)
- The JSON envelope carries `lifecycle`, `resolved`, `overlay_applied`, `builtin_version`, `warnings` and the full `flow` tree

This command is purely observational: it never executes `cmd:` nodes, writes markers, or advances state.

## Example

```bash
openlogos flow show --resolved
```

```
Flow: launched（overlay applied）

▸ implement    gate: human (skippable)
    · code                 code     skill: code-implementor
    · verify               verify   when: code_present
```

## Related commands

- [`watch`](/cli/watch) — Stream the live derived dev-flow state
- [`next`](/cli/next) — Show the single most actionable next step
- [`status`](/cli/status) — Full dashboard view
