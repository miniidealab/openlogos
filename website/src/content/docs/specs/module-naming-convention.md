---
title: Module Naming Convention
description: File naming rules for multi-module OpenLogos projects — module prefix as namespace.
---

This specification defines the file naming convention for multi-module OpenLogos projects. All Skills must follow these rules when generating files.

## Core Principle: Filename as Namespace

All design document filenames follow the format:

```
<module>-<number-or-semantic-name>-<type>.md
```

- **module**: Module identifier — lowercase letters + hyphens (e.g., `core`, `user`, `payment`)
- Initial projects use `core-` as the default module prefix
- New modules create files with their prefix in the same directory — no subdirectories needed

## Naming Rules by File Type

### Requirements Documents

```
<module>-01-requirements.md
```

Example: `core-01-requirements.md`, `admin-01-requirements.md`

### Feature Specs

```
<module>-01-feature-specs.md
<module>-00-information-architecture.md
```

### Architecture Documents

```
<module>-01-architecture-overview.md
<module>-02-skip-phases-and-interfaces.md
```

### Scenario Implementation Documents

```
<module>-SXX-<english-slug>.md
```

Example: `core-S01-cli-init.md`, `admin-S08-dashboard.md`

Scenario numbers are **globally unique** — maintained by `scenario_counter.next_id` in `logos-project.yaml`. Different modules must never restart from S01.

### Test Case Documents

```
<module>-SXX-test-cases.md
```

Example: `core-S01-test-cases.md`, `payment-S12-test-cases.md`

### Deployment Plan

```
<module>-01-deployment-plan.md
```

### Smoke Test Cases

```
<module>-smoke-test-cases.md
```

Stored in `logos/resources/test/smoke/`.

### API Files

Split by domain, typically shared across modules (no module prefix required):

```
auth.yaml
payment.yaml
```

### Database Files

Split by domain, typically shared across modules:

```
schema.sql
auth.sql
```

## How `openlogos status` Uses Prefixes

`openlogos status` uses the `<moduleId>-` prefix to determine per-module phase completion:

- A phase is **done** for a module when at least one file with that module's prefix exists in the phase directory
- Files belonging to other modules are ignored
- Scenario phases (`phase.3-1`, `phase.3-4a`) require per-scenario file coverage, not just any file

## Multi-Module Coexistence

Multiple modules share the same directories without collision:

```
logos/resources/prd/1-product-requirements/
├── core-01-requirements.md      # core module
├── admin-01-requirements.md     # admin module
└── payment-01-requirements.md   # payment module
```

No subdirectories per module — the prefix is the namespace.

## Related

- [Directory Convention](/specs/directory-convention) — Standard directory layout
- [logos-project.yaml](/specs/logos-project) — Module registry and scenario counter
- [`openlogos module`](/cli/module) — CLI command for managing modules
