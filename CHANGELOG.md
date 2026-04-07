# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] - 2026-04-07

### Fixed

- **`openlogos init` non-TTY smart defaults** — When running via Claude Code's Bash tool (non-TTY), `init` now auto-detects locale from `LANG`/`LC_ALL` env var (e.g. `zh_CN` → `zh`) and AI tool from `CLAUDE_PLUGIN_ROOT`/`CLAUDE_CODE` env var. Plugin `/openlogos:init` command hardcodes `--ai-tool claude-code` and asks user only for language preference.

## [0.4.1] - 2026-04-07

### Fixed

- **`openlogos init` non-TTY default issue** — Added `--locale <en|zh>` and `--ai-tool <cursor|claude-code|other>` CLI flags for explicit selection in non-interactive environments.

## [0.4.0] - 2026-04-07

### Added

- **Claude Code Native Plugin** — Full-featured plugin for Claude Code with one-command installation:
  - **12 AI Skills** with auto-discovery: Claude Code automatically activates the right skill based on project phase and task context
  - **9 Slash Commands**: all CLI commands wrapped as plugin commands (`init`, `sync`, `status`, `verify`, `change`, `merge`, `archive`, `launch`) plus `next` for guided workflow
  - **SessionStart Hook**: automatically detects project phase, locale, and lifecycle on every session start
  - **change-reviewer Agent**: read-only subagent that reviews change proposals for completeness and methodology compliance
- **Plugin Marketplace** — `.claude-plugin/marketplace.json` at repo root enables `miniidealab/openlogos` as a Claude Code marketplace
- **Skill Build Script** — `scripts/build-plugin-skills.sh` builds plugin skills from source with proper Claude Code frontmatter

### Changed

- README updated with Claude Code plugin installation instructions

## [0.3.6] - 2026-04-06

### Improved

- **Claude Code Skill Binding** — `CLAUDE.md` now forms a complete "detect → read → execute" loop for Claude Code users:
  - Phase detection logic binds each phase to its corresponding Skill file path (e.g., `→ read logos/skills/prd-writer/SKILL.md and follow its steps`)
  - Active Skills section adds an auto-load instruction telling Claude Code to read Skill files before generating content
  - Applies equally to `other` AI tool selection
- **Language Policy Unified** — `AGENTS.md` / `CLAUDE.md` now use `⚠️ Highest Priority` wording aligned with `openlogos-policy.mdc`, consistent across all AI tools
- Test suite expanded from 118 to 125 cases

## [0.3.5] - 2026-04-06

### Improved

- **Scenario Granularity Guard** — Three-layer defense against AI defining single CRUD operations as standalone scenarios:
  - `prd-writer` Skill: added "Scenario Granularity Self-Check" with 4 mandatory tests (Single-API, CRUD, Business Value, Step Count) and correct vs anti-pattern examples in Step 3
  - `scenario-architect` Skill: added "Scenario Granularity Pre-Check" in Step 1 — refuses to draw sequence diagrams for overly fine-grained scenarios
  - `product-designer` Skill: added granularity check reminder in Step 1 to catch CRUD fragmentation before product design

## [0.3.4] - 2026-04-06

### Improved

- **YAML Validation Guard** — Three-layer defense against AI-generated YAML formatting errors in OpenAPI specs:
  - `api-designer` Skill: added "YAML Formatting Rules (MUST Follow)" section — enforces double-quoting `description`/`summary` values, quoting status code keys, and self-check after generation
  - `code-reviewer` Skill: added pre-review YAML validity check (Critical blocker) and "YAML Validity" checklist item
  - `change-writer` Skill: `tasks.md` Phase 3 template now includes a "Validate API YAML" task whenever API specs are modified

## [0.3.3] - 2026-04-06

### Added

- **Lifecycle-Aware Change Management** — New `lifecycle` field in `logos.config.json` (`"initial"` / `"active"`) controls change management enforcement:
  - **Initial Development** (`lifecycle: "initial"`): change proposals are not required, AI follows Phase progression freely
  - **Active Iteration** (`lifecycle: "active"`): strict change management enforced, AI must create proposals before modifying code
- **`openlogos launch` Command** — Transitions the project from initial development to active iteration; automatically regenerates `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/openlogos-policy.mdc` with enforced change management
- **Launch Hint in Status** — `openlogos status` now suggests `openlogos launch` when all phases are complete and lifecycle is still `"initial"`

### Changed

- `generatePolicyMdc()`, `createAgentsMd()`, `deploySkills()` now accept a `lifecycle` parameter
- Test suite expanded from 105 to 118 cases

## [0.3.2] - 2026-04-06

### Changed

- **Unified Policy Rule** — `change-guard.mdc` upgraded to `openlogos-policy.mdc` (`alwaysApply: true`), combining Language Policy and Change Management in a single always-active rule
- Language Policy now marked as "Highest Priority" with stronger enforcement wording, injected into every Cursor conversation to prevent locale drift

## [0.3.1] - 2026-04-06

### Added

- **English Skill Translations** — All 12 AI Skills now have `SKILL.en.md` English versions; skills deployment follows the `locale` setting in `logos.config.json`
- **Language Policy in AGENTS.md** — Generated AI instruction files now include a `## Language Policy` section that explicitly instructs AI to follow the project's locale setting
- **Change Management Guard** — Cursor projects automatically receive a `change-guard.mdc` rule (`alwaysApply: true`) that reminds AI of the change proposal workflow in every conversation
- **Strengthened Change Management** — `AGENTS.md` / `CLAUDE.md` now include a prominent `## ⚠️ Change Management (Must Follow)` section

### Changed

- `deploySkills()` accepts a `locale` parameter to select language-appropriate skill files
- Test suite expanded from 95 to 105 cases

## [0.3.0] - 2026-04-05

### Added

- **AI Coding Tool Selection** — `openlogos init` now prompts users to choose their AI coding tool (Cursor / Claude Code / Other), stored as `aiTool` in `logos.config.json`
- **Automatic Skills Deployment** — 12 AI Skills are bundled in the npm package and deployed during `init`:
  - **Cursor**: deployed as `.cursor/rules/*.mdc` with frontmatter metadata
  - **Claude Code / Other**: deployed as `logos/skills/*/SKILL.md`
- **Active Skills in AI Instruction Files** — `AGENTS.md` and `CLAUDE.md` now include an `## Active Skills` section listing all deployed skills (visibility follows tool selection rules)
- **Skills Sync** — `openlogos sync` now re-deploys skills and refreshes Active Skills section based on `aiTool` config

### Changed

- `openlogos sync` refactored to reuse `createAgentsMd()` from init module, eliminating duplicated AGENTS.md template
- Test suite expanded from 76 to 95 cases covering AI tool selection, skills deployment, and Active Skills generation

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

[0.4.2]: https://github.com/miniidealab/openlogos/releases/tag/v0.4.2
[0.4.1]: https://github.com/miniidealab/openlogos/releases/tag/v0.4.1
[0.4.0]: https://github.com/miniidealab/openlogos/releases/tag/v0.4.0
[0.3.6]: https://github.com/miniidealab/openlogos/releases/tag/v0.3.6
[0.3.5]: https://github.com/miniidealab/openlogos/releases/tag/v0.3.5
[0.3.4]: https://github.com/miniidealab/openlogos/releases/tag/v0.3.4
[0.3.3]: https://github.com/miniidealab/openlogos/releases/tag/v0.3.3
[0.3.2]: https://github.com/miniidealab/openlogos/releases/tag/v0.3.2
[0.3.1]: https://github.com/miniidealab/openlogos/releases/tag/v0.3.1
[0.3.0]: https://github.com/miniidealab/openlogos/releases/tag/v0.3.0
[0.2.0]: https://github.com/miniidealab/openlogos/releases/tag/v0.2.0
[0.1.0]: https://github.com/miniidealab/openlogos/releases/tag/v0.1.0
