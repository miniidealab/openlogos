---
title: "openlogos module"
description: Manage project modules — list, add, rename, or remove modules in logos-project.yaml.
---

Manage the module registry in `logos-project.yaml`. Modules are used to organize multi-module projects and track per-module lifecycle state.

## Synopsis

```bash
openlogos module list [--format json]
openlogos module add <name>
openlogos module rename <old> <new>
openlogos module remove <name>
```

## Subcommands

### `module list`

List all registered modules and their lifecycle state.

```bash
openlogos module list
openlogos module list --format json
```

Output example:
```
🧩 Registered Modules

  🔄  core  核心功能  [initial]
  ✅  payment  支付模块  [launched]
```

### `module add <name>`

Add a new module to `logos-project.yaml`. The module is created with `lifecycle: initial`.

```bash
openlogos module add payment
```

- `name` must match `^[a-z][a-z0-9-]*$` (lowercase letters, digits, hyphens)
- Can be run at any time — no active change proposal required
- Does not affect existing files

### `module rename <old> <new>`

Rename a module: updates the id in `logos-project.yaml`, renames all matching files in `logos/resources/` (files prefixed with `<old>-`), and updates cross-references in `logos/` and `spec/` text files.

```bash
openlogos module rename core foundation
```

- If an active change proposal exists, a warning is printed but the operation continues
- Review `logos/changes/<slug>/tasks.md` after renaming if a proposal is active

### `module remove <name>`

Remove a module from `logos-project.yaml`. Lists affected files but does **not** delete them automatically.

```bash
openlogos module remove payment
```

- The `core` module is protected and cannot be removed
- Prompts for confirmation before removing
- If an active change proposal exists, a warning is printed but the operation continues

## Notes

- Module names are used as file prefixes throughout the project (e.g., `core-S01-cli-init.md`)
- Scenario numbers are globally unique across all modules — see `logos-project.yaml` → `scenario_counter.next_id`
- `module add` and `module rename/remove` are project-structure operations and are not gated by change proposals
