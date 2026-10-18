---
title: Specifications Overview
description: Reference for OpenLogos specification documents that define the methodology's core rules, file formats, and project structure.
---

OpenLogos specifications are the authoritative rules that all Skills, CLI commands, and AI instruction files follow. They define the development workflow, project structure, file formats, and platform integration mechanisms.

Specifications are grouped into three categories:

## Methodology

Core rules that govern how OpenLogos projects progress:

| Specification | Description |
|---------------|-------------|
| [Workflow](/specs/workflow) | Three-layer progression model (WHY → WHAT → HOW), scenario threading, phase detection, quality gates |
| [Change Management](/specs/change-management) | Delta change proposals, impact analysis, merge workflow, and archival |
| [Flow Specification](/specs/flow-spec) | Orchestratable development-flow data model: subflows, nodes, gates, loops, overlays |
| [Slice Planner](/specs/slice-planner) | How `[code]` slices are planned after merge |
| [PreToolUse Guard](/specs/pretooluse-guard) | Write guard: what is protected (version-controlled content), pre-checks, post-execution checks, and protection-scope commands |

## File Formats & Structure

Conventions for project layout, configuration files, and data formats:

| Specification | Description |
|---------------|-------------|
| [Project Structure](/specs/project-structure) | Standard directory layout, file naming conventions, `logos.config.json` schema |
| [Directory Convention](/specs/directory-convention) | Detailed directory structure and file organization rules |
| [Module Naming Convention](/specs/module-naming-convention) | Module prefix naming rules for multi-module projects |
| [logos-project.yaml](/specs/logos-project) | AI collaboration index file — schema, field definitions, and examples |
| [AGENTS.md](/specs/agents-md) | AI instruction file — content structure, generation rules, multi-platform adaptation |
| [Test Results Format](/specs/test-results) | JSONL format for cross-framework test result reporting, reporter code templates |
| [tasks.md Format](/specs/tasks-spec) | Structured format for change proposal task files — section markers and status detection |
| [TEST_SLICE_MANIFEST](/specs/test-slice-manifest) | Machine-readable `[code]` slice manifest written by `openlogos slice plan` and read by verify |
| [SQL Comment Convention](/specs/sql-comment-convention) | Structured comment format for SQLite DDL metadata annotations |
| [Environment Registry](/specs/environments) | `logos/environments.yaml` fields, `DEPLOY_DONE` format, the local deployment ledger, smoke environment evidence, deployment execution, promotion and approval gates |
| [CLI JSON Output](/specs/cli-json-output) | Structured JSON output specification for CLI commands (status, verify, smoke, detect, env, deploy, approve) |

## Platform Integration

Integration specifications for specific AI coding tools:

| Specification | Description |
|---------------|-------------|
| [OpenCode Plugin](/specs/opencode-plugin) | Native plugin for OpenCode — command bridging, hook injection, dual-mode architecture |
| [Codex Plugin](/specs/codex-plugin) | Native plugin for Codex CLI — SessionStart hook, phase context injection, dual-mode architecture |
| [Cursor Plugin](/specs/cursor-plugin) | Cursor integration: native Skills in `.cursor/skills/`, managed `.cursor/hooks.json` entries, partial-strength guard with `afterShellExecution` post-check |
| [ZCode Plugin](/specs/zcode-plugin) | Native ZCode plugin in `.zcode/plugins/openlogos/`: Skills, commands, agents, SessionStart and PreToolUse hooks |
| [Qoder Plugin](/specs/qoder-plugin) | Native Qoder CLI plugin in `.qoder/plugins/openlogos/`: Skills, commands, agents, SessionStart and PreToolUse hooks |
| [WorkBuddy Plugin](/specs/workbuddy-plugin) | Native WorkBuddy plugin in `.workbuddy/plugins/openlogos/`: Skills, commands, agents, SessionStart and PreToolUse hooks; native memory left untouched |
