---
title: AGENTS.md Specification
description: Content structure, generation rules, and multi-platform adaptation for the AI instruction file.
---

`AGENTS.md` is the AI instruction file placed at the project root. When an AI coding tool (Cursor, Claude Code, OpenCode, etc.) opens a project, it reads this file to understand the project's methodology, rules, and workflow.

## Content Structure

The generated `AGENTS.md` follows this standard template:

```markdown
# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`
- Tech Stack: [read from logos-project.yaml]

## Methodology Rules
[6 fixed rules — see below]

## Interaction Guidelines
[Phase detection logic + Step 4 batch execution rules]

## Document Edit Verification
[Fixed locale-specific paragraph: after each Markdown/text spec write, re-read from disk and show actual excerpts; no prose-only delivery; typo exception]

## Active Skills
[Dynamically generated based on aiTool setting]

## Change Management
[Varies by lifecycle: initial vs active]

## Conventions
[Read from logos-project.yaml conventions field]
```

## Fixed Methodology Rules

These rules are consistent across all OpenLogos projects and cannot be customized:

1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations
6. All generated test code must include an OpenLogos reporter (see [Test Results Format](/specs/test-results))
7. After editing Markdown or text specifications, re-read from disk and show verifiable excerpts to the user (generated **Document Edit Verification** section)

## Phase Detection Logic

The Interaction Guidelines section includes phase detection logic that helps AI determine the current project phase and suggest next steps:

| Condition | Suggested Phase | Skill |
|-----------|----------------|-------|
| `prd/1-product-requirements/` empty | Phase 1 | prd-writer |
| Requirements exist, `2-product-design/` empty | Phase 2 | product-designer |
| Design exists, `3-technical-plan/1-architecture/` empty | Phase 3 Step 0 | architecture-designer |
| Architecture exists, `2-scenario-implementation/` empty | Phase 3 Step 1 | scenario-architect |
| Scenarios exist, `api/` empty | Phase 3 Step 2 | api-designer + db-designer |
| API exists, `test/` empty | Phase 3 Step 3a | test-writer |
| Test cases exist, `scenario/` empty | Phase 3 Step 3b | test-orchestrator |
| All above complete | Phase 3 Step 4 | code-implementor |
| Code exists, `verify/` empty | Phase 3 Step 5 | Run tests → `openlogos verify` |

## Active Skills Section

The Active Skills section is dynamically generated based on the `aiTool` field in `logos.config.json`:

| aiTool value | Skills listed from | Path format |
|-------------|-------------------|-------------|
| `cursor` | `.cursor/rules/*.mdc` | `skills/{name}/` → `.cursor/rules/{name}.mdc` |
| `claude-code` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |
| `opencode` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |
| `other` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |

All 13 built-in Skills are listed with descriptions.

For tools that support Skill binding (Claude Code, Cursor), the Phase detection section includes direct file paths so the AI can read and execute the Skill file immediately.

## Data Sources

| Section | Source |
|---------|--------|
| Tech Stack | `logos-project.yaml` → `tech_stack` |
| Active Skills | `logos.config.json` → `aiTool` + deployed Skills scan |
| Conventions | `logos-project.yaml` → `conventions` |
| Methodology Rules | Fixed content (non-customizable) |

## Generation Timing

| Event | Trigger |
|-------|---------|
| `openlogos init` | First generation during project initialization |
| `openlogos sync` | Manual re-generation when project config changes |
| `project-init` Skill | AI-initiated project initialization |

## Multi-Platform Adaptation

Different AI tools use different instruction file names, but the content is consistent:

| Tool | Instruction File | Skills Location | Deployment |
|------|-----------------|----------------|------------|
| **Cursor** | `AGENTS.md` (native support) | `.cursor/rules/*.mdc` | Auto-deployed by `init` / `sync` |
| **Claude Code** | `CLAUDE.md` | `logos/skills/*/SKILL.md` | Auto-deployed by `init` / `sync` |
| **OpenCode (compat)** | `AGENTS.md` | `logos/skills/*/SKILL.md` | Auto-deployed by `init` / `sync` |
| **OpenCode (plugin)** | `opencode.json` + `.opencode/plugins/` | Plugin-loaded | Plugin handles command bridging, `AGENTS.md` as fallback |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Planned | Future release |

`openlogos sync` generates all needed instruction files simultaneously, ensuring consistent instructions across AI tools.

## Relationship with logos-project.yaml

| File | Format | Audience | Content |
|------|--------|----------|---------|
| `logos-project.yaml` | Structured YAML | AI + tools | Resource index, tech stack, conventions |
| `AGENTS.md` | Natural language Markdown | AI assistants | Behavioral instructions, rules, Skill list |

The two are complementary: `AGENTS.md` directs AI to read `logos-project.yaml`; `logos-project.yaml` provides structured data for the AI to consume.
