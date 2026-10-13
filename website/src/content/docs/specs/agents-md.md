---
title: AGENTS.md Specification
description: Content structure, generation rules, and multi-platform adaptation for the AI instruction file.
---

`AGENTS.md` is the AI instruction file placed at the project root. When an AI coding tool (Cursor, Claude Code, OpenCode, Codex, ZCode, Qoder, WorkBuddy, etc.) opens a project, it reads this file to understand the project's methodology, rules, and workflow.

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
[Varies by lifecycle: initial vs launched]

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
| `cursor` | `.cursor/skills/*/SKILL.md` | `.cursor/skills/{name}/SKILL.md` |
| `claude-code` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |
| `opencode` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |
| `codex` | `.agents/plugins/openlogos/skills/*/SKILL.md` | `$openlogos:{name}` → `.agents/plugins/openlogos/skills/{name}/SKILL.md` |
| `zcode` | `.zcode/plugins/openlogos/skills/*/SKILL.md` | `.zcode/plugins/openlogos/skills/{name}/SKILL.md` |
| `qoder` | `.qoder/plugins/openlogos/skills/*/SKILL.md` | `.qoder/plugins/openlogos/skills/{name}/SKILL.md` |
| `workbuddy` | `.workbuddy/plugins/openlogos/skills/*/SKILL.md` | `.workbuddy/plugins/openlogos/skills/{name}/SKILL.md` |
| `other` | `logos/skills/*/SKILL.md` | `logos/skills/{name}/SKILL.md` |
| `all` or array | Shared multi-tool list | `logos/skills/{name}/SKILL.md` (an array of only Codex and Cursor uses the Codex format) |

All 17 built-in Skills are listed with descriptions.

For Codex, the Active Skills section is grouped by namespace. OpenLogos methodology skills are listed as `$openlogos:<skill>` and point to `.agents/plugins/openlogos/skills/`. Project-specific Skills stay outside the OpenLogos namespace: project plugin skills use `$<plugin>:<skill>` from `.agents/plugins/<plugin>/skills/`, while legacy or repo-scoped local Skills remain under `.agents/skills/` and are grouped as project-specific.

For Claude Code, OpenLogos methodology Skills remain under `logos/skills/`, while project-owned Skills under `.claude/skills/<skill>/SKILL.md` are kept as a separate project-specific group and are not copied into the OpenLogos plugin.

When the project is configured for a single host, `AGENTS.md` also gets a host section:

- **Cursor**: says where Skills (`.cursor/skills/`, commands as `/openlogos-<command>`) and the change-reviewer subagent live, and carries a fixed guard-strength line. On Cursor, writes are only partially guarded: shell commands get a `beforeShellExecution` pre-check and an `afterShellExecution` post-check, while file edits are reported after the fact by `afterFileEdit`. OpenLogos does not wire Cursor's `preToolUse`, so Cursor is never described as equivalent to Claude Code.
- **ZCode**: read the root `AGENTS.md` and the plugin Skills directly; do not rely on nested AGENTS files, include directives, or `CLAUDE.md`.
- **Qoder**: read the root `AGENTS.md` and the plugin Skills directly; do not rely on `AGENTS.local.md`, `.qoder/rules`, or other user assets for critical workflow rules.
- **WorkBuddy**: use the plugin Skills/commands and SessionStart for methodology context; native memory is not authorization, and write permission comes only from the `PreToolUse` hook re-reading the project on disk.

For tools that support Skill binding (Claude Code, Cursor), the Phase detection section includes direct file paths so the AI can read and execute the Skill file immediately.

## Managed Block

`AGENTS.md` and `CLAUDE.md` are user-editable. OpenLogos only maintains the content between fixed markers:

```markdown
<!-- OPENLOGOS:BEGIN -->
[OpenLogos generated instructions]
<!-- OPENLOGOS:END -->
```

- File missing → created with the managed block only.
- Markers present → only the content between them is replaced; everything outside stays as it was.
- No markers but the file matches an older OpenLogos template → migrated to the managed format.
- No markers and the file has your own content → your content is kept and the managed block is appended at the end.
- Incomplete markers (only begin or only end) → the write fails loudly; fix or back up the file and rerun.
- Case variants such as `agents.md` or `Claude.md` are reused instead of creating a second file.

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
| `openlogos init --ai-tool <tool>` | Refresh after adding a target tool to an initialized project |
| `openlogos adopt` | Generation when onboarding an existing codebase (launched rules) |
| `openlogos sync` | Re-generation after CLI upgrades or config changes |
| `openlogos launch` | Refresh with launched change-management rules |
| `project-init` Skill | AI-initiated project initialization |

Every entry point uses the same managed-block merge, so your content outside the markers is always preserved.

## Multi-Platform Adaptation

Different AI tools use different instruction file names, but the content is consistent:

| Tool | Instruction File | Skills Location | Deployment |
|------|-----------------|----------------|------------|
| **Cursor** | `AGENTS.md` (native support) | `.cursor/skills/<name>/SKILL.md` (native Agent Skills, plus command Skills and the change-reviewer subagent) | `init` / `sync` deploy Skills and merge managed entries into `.cursor/hooks.json`; your own Skills, rules, and hook entries are kept. See [Cursor Plugin](/specs/cursor-plugin) |
| **Claude Code** | `CLAUDE.md` | `logos/skills/*/SKILL.md` | Auto-deployed by `init` / `sync` |
| **OpenCode (compat)** | `AGENTS.md` | `logos/skills/*/SKILL.md` | Auto-deployed by `init` / `sync` |
| **OpenCode (plugin)** | `opencode.json` + `.opencode/plugins/` | Plugin-loaded | Plugin handles command bridging, `AGENTS.md` as fallback |
| **Codex** | `AGENTS.md` + `.codex/config.toml` + `.agents/plugins/marketplace.json` | `.agents/plugins/openlogos/skills/*` for `$openlogos:<skill>`; project plugins or `.agents/skills/*` stay separate | `init` / `sync` refresh only the `openlogos` marketplace entry and preserve project Skills |
| **ZCode** | Root `AGENTS.md` | `.zcode/plugins/openlogos/skills/` | `init` / `adopt` / `sync` / `launch` install the plugin; `.zcode/config.json` is never modified. See [ZCode Plugin](/specs/zcode-plugin) |
| **Qoder** | Root `AGENTS.md` (Qoder CLI static memory) | `.qoder/plugins/openlogos/skills/` | `init` / `adopt` / `sync` / `launch` install the plugin; `AGENTS.local.md`, `.qoder/rules/`, and Qoder settings are never modified. See [Qoder Plugin](/specs/qoder-plugin) |
| **WorkBuddy** | Root `AGENTS.md` | `.workbuddy/plugins/openlogos/skills/` | `init` / `adopt` / `sync` / `launch` install the plugin; WorkBuddy settings are never modified, and native memory is never read or written. See [WorkBuddy Plugin](/specs/workbuddy-plugin) |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Planned | Future release |

`openlogos sync` generates all needed instruction files simultaneously, ensuring consistent instructions across AI tools.

## Relationship with logos-project.yaml

| File | Format | Audience | Content |
|------|--------|----------|---------|
| `logos-project.yaml` | Structured YAML | AI + tools | Resource index, tech stack, conventions |
| `AGENTS.md` | Natural language Markdown | AI assistants | Behavioral instructions, rules, Skill list |

The two are complementary: `AGENTS.md` directs AI to read `logos-project.yaml`; `logos-project.yaml` provides structured data for the AI to consume.
