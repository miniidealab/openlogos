---
title: product-designer
description: Create interaction specs and prototypes adapted to product type.
---

Based on scenarios from the Phase 1 requirements document, refine interaction flows and feature specifications, and generate prototypes. The prototype format automatically adapts to the product type (Web/CLI/Library/AI Skills, etc.).

## Phase & Trigger

- **Phase**: Phase 2 — WHAT (Product Design)
- **Trigger conditions**:
  - User requests product design, feature specifications, or prototypes
  - User mentions "Phase 2", "product design layer", or "WHAT"
  - Requirements document exists with scenario definitions

## What It Does

1. Identify the product type and determine the corresponding prototype format
2. Design information architecture (page structure / command tree / API grouping)
3. Refine interaction flows per scenario from Phase 1
4. Supplement interaction-level GIVEN/WHEN/THEN acceptance criteria
5. Generate prototypes appropriate for the product type
6. Split coarse scenarios into sub-scenarios when needed (`S01.1`, `S01.2`)

## Product Type Adaptation

| Product Type | Prototype Format | Interaction Focus |
|-------------|-----------------|-------------------|
| Web Application | Interactive HTML pages | Page navigation, form validation, state changes |
| CLI Tool | Terminal interaction examples | Command format, parameter design, output format |
| AI Skills / Conversational | Dialogue flowcharts + sample scripts | Dialogue steps, AI questioning strategy |
| Library / SDK | API usage examples (code snippets) | Public interfaces, parameter design, return values |
| Mobile Application | HTML pages (mobile viewport) | Gesture interaction, navigation patterns |
| Hybrid | Mix formats per deliverable | Interaction handoffs between deliverables |

## Execution Steps

### Step 1: Read Requirements and Identify Product Type

Extract the scenario list, constraints, and `tech_stack` from `logos-project.yaml`. Run a scenario granularity check — if scenarios are actually single CRUD operations, recommend returning to Phase 1 to re-organize.

### Step 2: Design Information Architecture

Design architecture by product type: page structure (Web), command tree (CLI), skill trigger relationships (AI Skills), or module structure (Library).

### Step 3: Refine Interaction Specs Per Scenario

For each scenario, define complete interaction details. Web scenarios specify pages, form fields, and navigation. CLI scenarios specify commands, parameters, and terminal output simulations. AI scenarios specify dialogue flows and AI behavioral guidelines.

### Step 4: Supplement Interaction-Level Acceptance Criteria

Refine Phase 1 GIVEN/WHEN/THEN down to the interaction element level (specific buttons, fields, loading states).

### Step 5: Generate Prototypes

Produce prototypes in the format matching the product type.

### Step 6: Output the Design Document

Organized by scenario, with each scenario containing its interaction spec + corresponding prototype.

## Outputs

| File | Location |
|------|----------|
| Feature specs | `logos/resources/prd/2-product-design/1-feature-specs/` |
| Prototypes | `logos/resources/prd/2-product-design/2-page-design/` |
| Naming | `{number}-{name}-design.md` + `{number}-{name}-prototype.{ext}` |

Prototype file extensions vary by type: `.html` (Web), `-terminal.md` (CLI), `-dialogue.md` (AI Skills), `-api-examples.md` (Library).

## Best Practices

- **Organize by scenarios, not pages** — scenarios are the backbone
- **Phase 1 acceptance criteria are the input** — Phase 2 refines them, not rewrites them
- **CLI "prototypes" are terminal output simulations** — use code blocks, no HTML needed
- **AI Skills "prototypes" are dialogue scripts** — simulate multi-turn conversations
- **Nested Markdown code blocks** — when content contains ` ``` `, use 4 backticks for the outer fence

## Related Skills

- Previous: [`prd-writer`](/skills/prd-writer) — write requirements
- Next: [`architecture-designer`](/skills/architecture-designer) — design technical architecture
