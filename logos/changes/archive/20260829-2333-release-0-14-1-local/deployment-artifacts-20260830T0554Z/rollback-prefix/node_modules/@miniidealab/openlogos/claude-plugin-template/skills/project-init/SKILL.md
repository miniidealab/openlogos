---
name: project-init
description: "Initialize OpenLogos project structure and directory layout. Use when the user wants to set up a new project with openlogos init or needs help with project initialization."
---

# Skill: Project Init

> Initialize a project structure following the OpenLogos methodology, generating configuration files, AI instruction files, and standard directories.

## Trigger Conditions

- User requests creating a new project or initializing a project structure
- User mentions "openlogos init" or "initialize project"
- No `logos/logos.config.json` exists in the current directory

## Core Capabilities

1. Create the `logos/` directory and its standard substructure
2. Generate the `logos/logos.config.json` configuration file
3. Generate the `logos/logos-project.yaml` AI collaboration index
4. Generate `AGENTS.md` / `CLAUDE.md` AI instruction files (in the root directory)
5. Create the `logos/changes/` change management directory

## Execution Steps

### Step 1: Gather Project Information

Confirm the following information with the user:

- **Project name**: Used for the `name` field in `logos/logos.config.json`
- **Project description**: A one-sentence description
- **Tech stack**: Main framework, language, database, deployment platform
- **Document modules**: Whether additional modules are needed beyond the default prd/api/scenario/database

If the user does not provide these, use reasonable defaults.

### Step 2: Create Directory Structure

```
project-root/
└── logos/
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

### Step 3: Generate logos/logos.config.json

```json
{
  "name": "{project name}",
  "description": "{project description}",
  "documents": {
    "prd": {
      "label": { "en": "Product Docs", "zh": "产品文档" },
      "path": "./resources/prd",
      "pattern": "**/*.{md,html,htm,pdf}"
    },
    "api": {
      "label": { "en": "API Docs", "zh": "API 文档" },
      "path": "./resources/api",
      "pattern": "**/*.{yaml,yml,json}"
    },
    "scenario": {
      "label": { "en": "Scenarios", "zh": "业务场景" },
      "path": "./resources/scenario",
      "pattern": "**/*.json"
    },
    "database": {
      "label": { "en": "Database", "zh": "数据库" },
      "path": "./resources/database",
      "pattern": "**/*.sql"
    }
  }
}
```

> The `path` field is relative to the directory where `logos.config.json` itself resides (i.e., `logos/`), so `./resources/prd` points to `logos/resources/prd`.

### Step 4: Generate logos/logos-project.yaml

```yaml
project:
  name: "{project name}"
  description: "{project description}"
  methodology: "OpenLogos"

tech_stack:
  framework: "{framework provided by user}"
  language: "{language provided by user}"
  # ... populate based on user-provided information

resource_index: []
  # Initially empty; entries are added incrementally as documents are produced

conventions:
  - "Follow the OpenLogos three-layer progression model (Why → What → How)"
  - "Every change must first create a change proposal in logos/changes/"
```

### Step 5: Generate AGENTS.md (Root Directory)

Generate AGENTS.md based on the content from Step 3 and Step 4, placed in the **project root directory**:

```markdown
# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`
- Tech Stack: {extracted from logos-project.yaml}

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see logos/changes/ directory)

## Conventions
{extracted from conventions in logos-project.yaml}
```

Also generate `CLAUDE.md` with identical content to AGENTS.md.

### Step 6: Output Initialization Report

Report to the user which files and directories were created, and provide next-step suggestions:

1. Edit `logos/logos.config.json` to refine the project configuration
2. Start with Phase 1: Write the requirements document
3. Use the `prd-writer` Skill to assist with writing

## Output Specification

- `logos/logos.config.json`: Valid JSON, conforming to `logos/spec/logos.config.schema.json`
- `logos/logos-project.yaml`: Valid YAML
- `AGENTS.md` / `CLAUDE.md`: Markdown format, located in the project root directory
- All directories under `logos/` are created; empty directories contain `.gitkeep`

## Best Practices

- **Don't over-configure**: Keep configuration minimal during initialization; let users refine it gradually during use
- **resource_index starts empty**: Add entries as documents are produced, avoiding meaningless placeholder content
- **Keep AGENTS.md concise**: Only include project-specific information; use fixed templates for universal methodology rules
- **Prioritize creating the directory structure**: The `logos/` directory structure is the first step in adopting the methodology — more important than any document
- **Low intrusiveness**: All methodology assets are contained within `logos/`, keeping the project's own structure clean

## Recommended Prompts

The following prompts can be copied directly for use with AI:

- `Help me initialize an OpenLogos project`
- `Initialize this project with OpenLogos, the project name is xxx`
- `Help me integrate OpenLogos into an existing project`
