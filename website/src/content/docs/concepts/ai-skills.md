---
title: AI Skills
description: "Platform-agnostic Markdown files that turn AI coding tools from guessing machines into precision instruments."
---

AI Skills are the mechanism that makes OpenLogos **executable** — not just a set of principles you have to remember, but operational instructions that AI agents read and follow automatically.

## What is a Skill?

A Skill is a Markdown file (`SKILL.md`) stored in the project's `skills/` directory. Each Skill corresponds to a specific phase or task in the OpenLogos workflow. When a developer asks an AI tool to perform a task, the tool reads the relevant Skill and follows its structured instructions.

Key properties:

- **Platform-agnostic**: Works with Claude Code, OpenCode, Codex, Cursor, ZCode, Qoder, WorkBuddy, or any tool that reads project files
- **Phase-aware**: Each Skill knows which phase it belongs to and what inputs it expects
- **Guardrailed**: Skills enforce methodology rules (e.g., "do not generate code without test cases")
- **Self-contained**: Each Skill includes its own instructions, output templates, and quality checks

## Built-in Skills

OpenLogos includes 18 Skills covering the entire lifecycle. The main ones by phase are listed below; see the [Skills reference](/skills) for the full list.

### Phase 1 — WHY

| Skill | Purpose |
|-------|---------|
| [`project-init`](/skills/project-init) | Initialize project structure and configuration |
| [`prd-writer`](/skills/prd-writer) | Write product requirements with scenario-driven acceptance criteria |

### Phase 2 — WHAT

| Skill | Purpose |
|-------|---------|
| [`product-designer`](/skills/product-designer) | Create feature specs, interaction flows, and HTML prototypes |

### Phase 3 — HOW

| Skill | Purpose |
|-------|---------|
| [`architecture-designer`](/skills/architecture-designer) | Design technical architecture and select tech stack |
| [`scenario-architect`](/skills/scenario-architect) | Model scenarios as sequence diagrams with API calls |
| [`api-designer`](/skills/api-designer) | Design OpenAPI specifications derived from sequence diagrams |
| [`db-designer`](/skills/db-designer) | Design database schema from API and scenario requirements |
| [`test-writer`](/skills/test-writer) | Write unit + scenario test case documents (before code) |
| [`test-orchestrator`](/skills/test-orchestrator) | Design API orchestration tests (API projects only) |
| [`code-implementor`](/skills/code-implementor) | Generate business code and test code with spec fidelity |
| [`code-reviewer`](/skills/code-reviewer) | Review code against the full specification chain |

### Cross-phase

| Skill | Purpose |
|-------|---------|
| [`change-writer`](/skills/change-writer) | Write change proposals with impact analysis |
| [`slice-planner`](/skills/slice-planner) | Plan post-spec-complete `[code]` slices from merged specs and real test IDs |
| [`merge-executor`](/skills/merge-executor) | Merge delta files into main documents |

### Existing projects

| Skill | Purpose |
|-------|---------|
| [`brownfield-adopter`](/skills/brownfield-adopter) | Optional: reverse-engineer a verifiable baseline seed from an existing codebase, only when you explicitly ask for it |

## How Skills are loaded

1. Developer asks AI to perform a task (e.g., "write the requirements")
2. AI reads `AGENTS.md` → detects current phase → identifies relevant Skill
3. AI reads the `SKILL.md` file for operational instructions
4. AI follows the Skill's step-by-step process, using the Skill's output templates and quality checks

The loading mechanism varies by platform:

| Platform | Mechanism |
|----------|-----------|
| Claude Code | Native `.claude/` plugin system; Skills in `logos/skills/` |
| OpenCode | `.opencode/plugins/` plugin and command integration |
| Codex | Repo marketplace plugin `.agents/plugins/openlogos/` with `$openlogos:<skill>` Skills and a SessionStart hook |
| Cursor | Native Agent Skills in `.cursor/skills/<name>/SKILL.md`, plus managed `.cursor/hooks.json` entries |
| ZCode | Native plugin in `.zcode/plugins/openlogos/` (Skills, commands, agents, hooks) |
| Qoder | Native plugin in `.qoder/plugins/openlogos/` (Skills, commands, agents, hooks) |
| WorkBuddy | Native plugin in `.workbuddy/plugins/openlogos/` (Skills, commands, agents, hooks) |
| Other tools | `AGENTS.md` as the universal entry point; Skills in `logos/skills/` |

## Skill anatomy

A typical `SKILL.md` contains:

```markdown
# Skill Name

## Trigger
When to activate this Skill.

## Inputs
What documents/artifacts this Skill reads.

## Process
Step-by-step instructions the AI follows.

## Output Template
The expected format of the output document.

## Quality Checks
Self-verification before marking the task complete.
```

## Custom Skills

You can create project-specific Skills by adding `SKILL.md` files to the `skills/` directory and referencing them in `logos-project.yaml`. Custom Skills follow the same format as built-in ones.

---

*See also: [Full Skills Reference](/skills) for detailed documentation of each Skill →*
