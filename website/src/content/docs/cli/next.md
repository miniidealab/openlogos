---
title: "openlogos next"
description: Show the single most actionable next step for the current OpenLogos project.
---

Return the next action a developer or AI assistant should take. It uses the same phase and proposal-state detection as `status`, but compresses the result into one actionable instruction.

## Synopsis

```bash
openlogos next [--module <id>] [--format json]
```

Must be run from the project root.

## Options

| Option | Description |
|--------|-------------|
| `--module <id>` | Focus the recommendation on one module. |
| `--format json` | Output structured JSON for tools such as RunLogos. |

## What it does

- Suggests the next phase prompt for initial modules
- Suggests `openlogos change <slug>` for launched modules without an active proposal
- Tracks active proposal steps: fill proposal, write deltas, merge, code, verify, archive
- Reports blocked modules when another module has the active guard

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
