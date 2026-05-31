---
title: Skills Overview
description: Reference documentation for all 16 built-in OpenLogos AI Skills.
---

OpenLogos ships with **16 AI Skills** — structured Markdown instruction files (`SKILL.md`) that guide AI coding tools through each phase of the development lifecycle. Skills are deployed automatically during `openlogos init` and synchronized via `openlogos sync`.

## How Skills Work

Each Skill is a self-contained instruction set stored in `skills/<skill-name>/SKILL.md`. When an AI coding tool encounters a task matching a Skill's trigger conditions, it reads and follows the instructions to produce consistent, high-quality outputs.

Skills are organized to follow the OpenLogos **three-layer progression model** (WHY → WHAT → HOW):

## Phase 1 — WHY (Requirements)

| Skill | Purpose | Trigger |
|-------|---------|---------|
| [`project-init`](/skills/project-init) | Initialize project structure and configuration | New project setup or `openlogos init` |
| [`prd-writer`](/skills/prd-writer) | Write scenario-driven requirements with GIVEN/WHEN/THEN criteria | Requirements analysis phase |

## Phase 2 — WHAT (Product Design)

| Skill | Purpose | Trigger |
|-------|---------|---------|
| [`product-designer`](/skills/product-designer) | Create interaction specs and prototypes adapted to product type | Requirements exist, design needed |

## Phase 3 — HOW (Technical Implementation)

| Skill | Purpose | Trigger |
|-------|---------|---------|
| [`architecture-designer`](/skills/architecture-designer) | Design system architecture and select technology stack | Product design complete, Step 0 |
| [`scenario-architect`](/skills/scenario-architect) | Expand scenarios into technical sequence diagrams | Architecture complete, Step 1 |
| [`api-designer`](/skills/api-designer) | Design OpenAPI specs derived from sequence diagrams | Sequence diagrams complete, Step 2 |
| [`db-designer`](/skills/db-designer) | Derive database DDL from API specifications | API specs complete, Step 2 |
| [`test-writer`](/skills/test-writer) | Design unit test and scenario test cases | Specs complete, Step 4a (all projects) |
| [`test-orchestrator`](/skills/test-orchestrator) | Design API orchestration test scenarios | Test cases complete, Step 4b (API projects only) |
| [`code-implementor`](/skills/code-implementor) | Generate business code and test code with spec fidelity | Test design complete, Step 5 |
| [`code-reviewer`](/skills/code-reviewer) | Review code against the full specification chain | After code generation, Step 5+ |

## Deployment & Verification

| Skill | Purpose | Trigger |
|-------|---------|---------|
| [`deployment-designer`](/skills/deployment-designer) | Design deployment topology, release commands, rollback strategy, and smoke scope | API/DB complete, Step 3 |
| [`deployment-executor`](/skills/deployment-executor) | Execute deployment with human authorization after verify passes | After Gate 3.6 PASS, Step 7 |

## Cross-Phase (Delta Workflow)

| Skill | Purpose | Trigger |
|-------|---------|---------|
| [`change-writer`](/skills/change-writer) | Write change proposals with impact analysis | Any iteration during launched lifecycle |
| [`merge-executor`](/skills/merge-executor) | Merge delta files into main documents | After `openlogos merge <slug>` |

## Design Intelligence

| Skill | Purpose | Trigger |
|-------|---------|---------|
| [`ui-ux-pro-max`](/skills/ui-ux-pro-max) | Comprehensive UI/UX design guide (67 styles, 96 palettes, 57 font pairings, 25 chart types) | GUI product design in Phase 2, invoked by product-designer |

## Skill File Locations

After `openlogos init`, Skills are deployed to platform-specific locations:

| AI Tool | Skill Location |
|---------|---------------|
| Claude Code | `logos/skills/` (native plugin) |
| OpenCode | `logos/skills/` (hooks integration) |
| Codex | `.agents/skills/` (native Codex Skills) |
| Cursor | `.cursor/rules/` (rule files) |

Run `openlogos sync` to re-deploy Skills after updates.
