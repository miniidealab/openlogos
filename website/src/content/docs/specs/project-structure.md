---
title: Project Structure
description: Standard directory layout, file naming conventions, and configuration file formats for OpenLogos projects.
---

Every OpenLogos project follows a standard directory structure under the `logos/` directory. This convention enables AI tools and team members to quickly locate resources.

## Standard Directory Layout

```
project-root/
├── AGENTS.md                   # AI assistant instructions (auto-generated, root)
├── CLAUDE.md                   # Claude Code instructions (auto-generated, root)
│
├── logos/                      # OpenLogos methodology assets (isolated namespace)
│   ├── logos.config.json       # Project configuration
│   ├── logos-project.yaml      # AI collaboration index
│   │
│   ├── resources/              # Development resource documents (current "source of truth")
│   │   ├── prd/                # Product documents
│   │   │   ├── 1-product-requirements/    # Phase 1: Requirements
│   │   │   ├── 2-product-design/
│   │   │   │   ├── 1-feature-specs/       # Phase 2: Feature specs
│   │   │   │   └── 2-page-design/         # Phase 2: Page designs + HTML prototypes
│   │   │   └── 3-technical-plan/
│   │   │       ├── 1-architecture/        # Phase 3: Architecture & tech stack
│   │   │       ├── 2-scenario-implementation/  # Phase 3: Scenario docs (sequence diagrams)
│   │   │       └── 3-deployment/          # Phase 3: Deployment plan + smoke strategy
│   │   ├── api/                           # Phase 3: OpenAPI YAML
│   │   ├── database/                      # Phase 3: SQL DDL
│   │   ├── test/                          # Phase 3: Test case specs (Markdown)
│   │   │   └── smoke/                     # Smoke test cases (post-deployment)
│   │   ├── scenario/                      # Phase 3: API orchestration tests (JSON)
│   │   ├── implementation/                # Phase 3: Implementation manifest
│   │   ├── verify/                        # Phase 3: Test results + reports (JSONL + Markdown)
│   │   └── reference/                     # Reference materials (images, context)
│   │
│   ├── skills/                 # AI Skills (SKILL.md per skill, 16 built-in)
│   │   ├── prd-writer/
│   │   ├── product-designer/
│   │   ├── code-implementor/
│   │   └── ...
│   │
│   ├── spec/                   # Methodology specifications
│   │
│   └── changes/                # Change proposal workspace
│       ├── {change-name}/      # Active change proposal
│       │   ├── proposal.md
│       │   ├── tasks.md
│       │   └── deltas/
│       └── archive/            # Completed change history
│
└── src/                        # Source code (structure determined by tech stack)
```

All OpenLogos methodology assets live under `logos/`, completely separated from the project's own code and configuration. `AGENTS.md` and `CLAUDE.md` remain at the project root because AI tools require instruction files there.

## Directory Responsibilities

### logos/

The unified entry point for all OpenLogos methodology assets. Contains configuration files, development resource documents, and change management.

### logos/resources/

Stores all development resource documents — the project's current "source of truth". Organized by the OpenLogos three-layer progression model:

| Subdirectory | Phase | Content |
|-------------|-------|---------|
| `prd/1-product-requirements/` | Phase 1: WHY | Requirements docs, user stories, competitive analysis |
| `prd/2-product-design/1-feature-specs/` | Phase 2: WHAT | Feature specs, information architecture, design standards |
| `prd/2-product-design/2-page-design/` | Phase 2: WHAT | Page design docs + HTML prototypes |
| `prd/3-technical-plan/1-architecture/` | Phase 3: HOW | Architecture overview, tech stack decisions |
| `prd/3-technical-plan/2-scenario-implementation/` | Phase 3: HOW | Scenario docs (sequence diagrams + step descriptions) |
| `prd/3-technical-plan/3-deployment/` | Phase 3: HOW | Deployment plan, environment config, rollback strategy, smoke scope |
| `api/` | Phase 3: HOW | OpenAPI YAML spec files |
| `database/` | Phase 3: HOW | SQL DDL design files |
| `test/` | Phase 3: HOW | Unit + scenario test case specs (Markdown) |
| `test/smoke/` | Phase 3: HOW | Post-deployment smoke test cases (Markdown) |
| `scenario/` | Phase 3: HOW | API orchestration test cases (JSON, API projects only) |
| `implementation/` | Phase 3: HOW | Implementation manifest (code delivery tracking) |
| `verify/` | Phase 3: HOW | Test results (JSONL), acceptance report, smoke report, deployment report |

### logos/changes/

Change proposal workspace. Each feature iteration or bug fix starts with a change proposal here, merged back into main documents after approval. See [Change Management](/specs/change-management) for details.

### logos/skills/

AI Skill files deployed by `openlogos init` or `openlogos sync`. Each skill is a subdirectory containing a `SKILL.md` file. For Cursor projects, skills are deployed to `.cursor/rules/` instead.

### logos/spec/

Methodology specification files deployed by `openlogos init`. These define the rules that Skills and tools follow (workflow, test result format, directory conventions, etc.).

## Configuration Files

### logos.config.json

Project configuration file defining document module paths and matching patterns:

```json
{
  "name": "my-project",
  "locale": "en",
  "aiTool": "claude-code",
  "lifecycle": "initial",
  "description": "",
  "documents": {
    "prd": { "label": { "en": "Product Docs" }, "path": "./resources/prd", "pattern": "**/*.{md,html,htm,pdf}" },
    "api": { "label": { "en": "API Docs" }, "path": "./resources/api", "pattern": "**/*.{yaml,yml,json}" },
    "test": { "label": { "en": "Test Cases" }, "path": "./resources/test", "pattern": "**/*.md" },
    "scenario": { "label": { "en": "Scenarios" }, "path": "./resources/scenario", "pattern": "**/*.json" },
    "database": { "label": { "en": "Database" }, "path": "./resources/database", "pattern": "**/*.sql" },
    "verify": { "label": { "en": "Verify Reports" }, "path": "./resources/verify", "pattern": "**/*.{jsonl,md}" },
    "changes": { "label": { "en": "Change Proposals" }, "path": "./changes", "pattern": "**/*.{md,json}" }
  },
  "verify": {
    "result_path": "logos/resources/verify/test-results.jsonl"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Project name |
| `locale` | `"en"` \| `"zh"` | Document language |
| `aiTool` | string | Primary AI tool (`claude-code`, `opencode`, `cursor`, `other`) |
| `lifecycle` | `"initial"` \| `"launched"` | Project lifecycle state (deprecated at project level; now per-module in logos-project.yaml) |
| `documents` | object | Document module definitions (path + glob pattern) |
| `verify.result_path` | string | Custom path for test results JSONL |

### logos-project.yaml

AI collaboration index file — see [logos-project.yaml Specification](/specs/logos-project) for full details.

## File Naming Conventions

### Module Prefix Rule

All design documents follow the `<module>-<number-or-name>.<ext>` naming pattern. The module prefix is the namespace that lets multiple modules coexist in the same directory without collision.

- Single-module projects use `core-` as the default prefix (e.g., `core-01-requirements.md`)
- Multi-module projects add new files with the new module's prefix alongside existing ones — no subdirectories needed

`openlogos status` uses the `<moduleId>-` prefix to determine per-module phase completion. A phase is considered done for a module only when at least one file with that module's prefix exists in the phase directory.

### Document Files

- Format: `<module>-{number}-{english-name}.md` — e.g., `core-01-requirements.md`, `admin-01-requirements.md`
- Numbers control display order
- HTML prototypes: `<module>-{number}-{name}-prototype.html`

### Scenario Files

- Scenario implementation: `<module>-SXX-{english-name}.md` — e.g., `core-S01-user-register.md`, `admin-S08-dashboard.md`
- Scenario numbers are **globally unique** across all modules, maintained by `scenario_counter.next_id` in `logos-project.yaml`
- Test case specs: `<module>-SXX-test-cases.md` — e.g., `core-S01-test-cases.md`

### API Files

- Split by domain: `auth.yaml`, `payment.yaml`, `license.yaml`
- OpenAPI 3.0 YAML format
- API files are typically shared across modules (no module prefix required)

### Database Files

- Complete schema: `schema.sql` or split by domain: `auth.sql`, `payment.sql`
- Database files are typically shared across modules (no module prefix required)

### Orchestration Test Files

- Split by scenario: `S01-user-auth.json`, `S02-payment-flow.json`
- JSON format defining API orchestration sequences

### Verification Files

- Test results: `test-results.jsonl` (JSONL format, one case result per line)
- Acceptance report: `acceptance-report.md` (auto-generated by `openlogos verify`)
- See [Test Results Format](/specs/test-results) for the detailed format specification

## Optional Directories

| Directory | Purpose |
|-----------|---------|
| `logos/resources/image/` | Product image assets (screenshots, icons) |
| `logos/resources/context/` | Additional AI context files |
| `docs/` | User-facing documentation (deployment guides, user manuals) |
| `scripts/` | Development scripts |
