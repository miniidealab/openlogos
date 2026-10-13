---
title: "openlogos feature"
description: List the feature groups of each module, and generate an AI prompt to backfill feature groups for scenarios that have none.
---

Features group a module's scenarios into user-facing capabilities (`F01`, `F02`, …). They are stored in `logos/logos-project.yaml` — `features[]` entries `{id, name, module, spec?}` plus a `feature` key on each scenario — and maintained by AI; the CLI only reads them.

Two commands work with features:

- `openlogos feature list` — a read-only grouped view
- `openlogos feature-backfill` — writes an AI prompt for grouping scenarios that are not yet in a feature

## Synopsis

```bash
openlogos feature list [--module <id>] [--format json]
openlogos feature-backfill [--module <id>] [--format json]
```

Must be run from the project root.

## Options

| Option | Description |
|--------|-------------|
| `--module <id>` | Limit to one module. An unregistered module fails with `MODULE_NOT_FOUND`. |
| `--format json` | Print a JSON envelope |

## `openlogos feature list`

For each module, lists every registered feature with its scenarios (and its feature-spec document, if linked). Scenarios that belong to no registered feature appear in a final `__ungrouped__` group. A module with neither features nor scenarios shows an empty list.

```bash
openlogos feature list --module core
```

```
🗂  Feature Groups

  core  Core
    F01  Project setup  → core-01  (2)
      - S01  CLI init
      - S02  Status
    __ungrouped__  …  (1)
      - S07  Watch
```

This command never writes anything.

## `openlogos feature-backfill`

Generates `logos/feature-backfill-prompt.md`, an instruction for your AI assistant to cluster ungrouped scenarios — and, in adopted (brownfield) projects, reverse-engineered scenario candidates — into features, allocate IDs, and write the result back to `logos/logos-project.yaml`.

The command itself does **not** modify `logos-project.yaml`. Running it again is safe: already registered scenarios are not offered as new candidates.

```
  ✓ Generated: logos/feature-backfill-prompt.md
    scenarios=12  ungrouped=4  features=3  baseline_candidates=0

Next step:
  Tell your AI assistant: "Read logos/feature-backfill-prompt.md and execute the instructions"
```

JSON output carries `prompt_path`, `scenarios_total`, `ungrouped_total`, `features_existing` and `baseline_candidates_total`.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `PROJECT_NOT_INITIALIZED` / `logos/logos.config.json not found` | Not in a project root | `cd` to the project root |
| `MODULE_NOT_FOUND` | `--module` is not registered | Run `openlogos module list` |
| `BASELINE_COMMIT_IN_PROGRESS` | A baseline seed commit is still running (feature-backfill) | Retry later |
| `BASELINE_PROVENANCE_INVALID` | A reverse-baseline provenance section cannot be parsed (feature-backfill); the error lists the files | Fix the named files, then rerun |

## Related commands

- [`module`](/cli/module) — Manage the modules features belong to
- [`status`](/cli/status) — Its JSON output includes feature groups per module when present
- [`index`](/cli/index-command) — Rebuild the resource index in `logos-project.yaml`
