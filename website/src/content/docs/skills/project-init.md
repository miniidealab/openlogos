---
title: project-init
description: Initialize a project structure following the OpenLogos methodology.
---

Initialize a project structure following the OpenLogos methodology, generating configuration files, AI instruction files, and standard directories.

## Phase & Trigger

- **Phase**: Phase 1 — WHY (Requirements)
- **Trigger conditions**:
  - User requests creating or initializing a project
  - User mentions `openlogos init`
  - No `logos/logos.config.json` exists in the current directory

## What It Does

1. Gather project information (name, description, tech stack, document modules)
2. Create the `logos/` directory with its standard substructure
3. Generate `logos/logos.config.json` configuration
4. Generate `logos/logos-project.yaml` AI collaboration index
5. Generate `AGENTS.md` / `CLAUDE.md` AI instruction files in the project root
6. Create the `logos/changes/` change management directory
7. Output an initialization report with next-step guidance

## Directory Structure Created

```
project-root/
├── AGENTS.md
├── CLAUDE.md
└── logos/
    ├── logos.config.json
    ├── logos-project.yaml
    ├── resources/
    │   ├── prd/
    │   │   ├── 1-product-requirements/
    │   │   ├── 2-product-design/
    │   │   │   ├── 1-feature-specs/
    │   │   │   └── 2-page-design/
    │   │   └── 3-technical-plan/
    │   │       ├── 1-architecture/
    │   │       └── 2-scenario-implementation/
    │   ├── api/
    │   ├── database/
    │   └── scenario/
    └── changes/
```

## Key Configuration Files

### logos.config.json

Defines project metadata and document module paths. The `path` field is relative to the `logos/` directory:

```json
{
  "name": "{project name}",
  "description": "{project description}",
  "documents": {
    "prd": { "path": "./resources/prd", "pattern": "**/*.{md,html,htm,pdf}" },
    "api": { "path": "./resources/api", "pattern": "**/*.{yaml,yml,json}" },
    "scenario": { "path": "./resources/scenario", "pattern": "**/*.json" },
    "database": { "path": "./resources/database", "pattern": "**/*.sql" }
  }
}
```

### logos-project.yaml

AI collaboration index with tech stack and project conventions. The `resource_index` starts empty and is populated incrementally as documents are produced.

### AGENTS.md / CLAUDE.md

Root-level AI instruction files containing methodology rules, project context, and phase detection logic. Both files have identical content.

## Best Practices

- **Keep configuration minimal** during initialization; refine it gradually during use
- **`resource_index` starts empty** — add entries as documents are produced
- **Low intrusiveness** — all methodology assets are contained within `logos/`, keeping the project's own structure clean
- Empty directories contain `.gitkeep` for version control

## Outputs

| File | Location |
|------|----------|
| `logos.config.json` | `logos/logos.config.json` |
| `logos-project.yaml` | `logos/logos-project.yaml` |
| `AGENTS.md` | Project root |
| `CLAUDE.md` | Project root |
| Directory structure | `logos/resources/`, `logos/changes/` |

## Related Skills

- Next: [`prd-writer`](/skills/prd-writer) — write the requirements document
