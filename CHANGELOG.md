# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-04-05

### Changed

- CLI 以 **`@miniidealab/openlogos`** 在 npm 公开发布，包作用域与 GitHub 组织 [miniidealab](https://github.com/miniidealab/openlogos) 一致；`package.json` 增加 `publishConfig.access: public`，便于作用域包默认公开安装。

## [0.1.0] - 2026-04-04

### Added

**CLI Tool (`@miniidealab/openlogos`)**
- `openlogos init [name]` — Initialize project structure with directory scaffolding, `logos.config.json`, `logos-project.yaml`, and AI instruction files (`AGENTS.md` / `CLAUDE.md`)
- `openlogos sync` — Regenerate AI instruction files from current config
- `openlogos status` — Display project phase progress and suggest next steps
- `openlogos verify` — Read JSONL test results, match against test case specs, generate acceptance report with three-layer traceability (Layer 1: design-time coverage, Layer 2: runtime coverage, Layer 3: acceptance criteria)
- `openlogos change <slug>` — Create a change proposal with proposal.md, tasks.md, and delta directories
- `openlogos merge <slug>` — Generate MERGE_PROMPT.md for AI-assisted delta merging
- `openlogos archive <slug>` — Archive completed change proposals
- Bilingual support (English / 中文) with interactive language selection

**Methodology Specs (`spec/`)**
- `workflow.md` — Three-layer progression model (WHY → WHAT → HOW)
- `directory-convention.md` — Standard project directory structure
- `logos-project.md` — AI collaboration index (logos-project.yaml) specification
- `logos.config.schema.json` — Project configuration JSON Schema
- `agents-md.md` — AI instruction file generation specification
- `change-management.md` — Delta change management specification
- `test-results.md` — JSONL test result format for cross-language test reporting

**AI Skills (`skills/`)**
- `project-init` — Project initialization guidance
- `prd-writer` — Phase 1: Requirements document writing
- `product-designer` — Phase 2: Product design (feature specs, interaction design)
- `architecture-designer` — Phase 3-0: Technical architecture design
- `scenario-architect` — Phase 3-1: Scenario modeling with sequence diagrams
- `api-designer` — Phase 3-2: OpenAPI specification design
- `db-designer` — Phase 3-2: Database schema design
- `test-writer` — Phase 3-3a: Unit and scenario test case design
- `test-orchestrator` — Phase 3-3b: API orchestration test design
- `code-reviewer` — Code review assistance
- `change-writer` — Change proposal authoring
- `merge-executor` — Delta merge execution

**Website (`website/`)**
- Static landing page built with Astro (English + 中文)

**Testing**
- 76 test cases (46 UT + 30 ST) covering all CLI commands
- Custom vitest reporter outputting OpenLogos JSONL format
- `openlogos verify` self-validation: Gate 3.5 PASS with 100% coverage, 25/25 design-time assertions, 21/21 acceptance criteria

[0.2.0]: https://github.com/miniidealab/openlogos/releases/tag/v0.2.0
[0.1.0]: https://github.com/miniidealab/openlogos/releases/tag/v0.1.0
