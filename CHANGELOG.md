# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.2] - 2026-04-29

### Added

- **`skip_phases` 模块配置** — `logos-project.yaml` 的 `modules[]` 新增可选字段 `skip_phases`，允许值为 `api`、`database`、`scenario`。由 `architecture-designer` Skill 在技术选型后填写，无需用户手动配置。适用于无 HTTP API 的桌面应用、CLI 工具等项目类型。

### Changed

- **phase 检测逻辑升级** — CLI（`status`、`next`）和 plugin 脚本均支持 `skip_phases`：显式声明的阶段直接跳过，同时保留向后看兜底逻辑（后续阶段已有文件时自动跳过空目录），向后兼容旧项目。
- **多模块隔离** — 全局 phase 跳过采用交集语义：只有所有 initial 模块都声明跳过某阶段，才在全局层面跳过，避免一个模块的 `skip_phases` 影响其他模块。
- **`architecture-designer` Skill 更新** — Step 6 新增填写 `skip_phases` 的判断规则和示例，AI 在技术选型后自动推断并写入。
- **`spec/logos-project.md` 更新** — 补充 `skip_phases` 字段说明、允许值表格和完整示例。

## [0.9.1] - 2026-04-29

### Fixed

- **plugin/bin/openlogos-phase lifecycle 读取错误** — 修复脚本仍从已废弃的 `logos.config.json` 读取 `lifecycle` 字段的问题，改为从 `logos-project.yaml` 的 `modules[].lifecycle` 推导（任意模块标记为 `launched` 则项目为 `launched`），与 CLI 行为保持一致。
- **plugin/bin/openlogos-phase 在 `set -euo pipefail` 下提前退出** — 修复 `check_scenarios_complete` 返回非零退出码时脚本被 `set -e` 终止的问题，所有调用处加 `|| true` 保护。
- **plugin/bin/openlogos-phase change management 文案过时** — guard 检测条件从 `active` 更新为 `launched`，change management 提示语同步为新的 10 步流程（含 verify、git commit/push 节点）。

### Changed

- **AGENTS.md / CLAUDE.md 重新生成** — 通过 `openlogos sync` 重新部署，确保两个文件内容与当前配置一致。

## [0.9.0] - 2026-04-29

### Added

- **变更流程新增 verify 验收节点** — 在 `merge`（规格落地）和 `archive`（归档）之间强制插入 `openlogos verify` 验收步骤，确保代码通过测试后才能归档，形成完整的质量闭环。

- **变更流程新增 git commit/push 节点** — 在三个关键节点（merge 完成、代码实现完成、archive 完成）由 AI 自动提交 commit，`git push` 作为独立人类确认点放在 archive 之后，commit message 规范统一为 `docs/feat/fix/chore({slug}): ...`。

- **确立 merge → 代码实现 → verify → archive 的正确顺序** — 规格先合并进主文档，代码按最新规格实现，verify 验收代码，通过后归档，符合"规格驱动代码"核心理念。

### Changed

- **AI 任务执行规范** — `change-writer` Skill 新增强制要求：每完成 `tasks.md` 中的一项任务后，AI 必须立即将该项从 `[ ]` 更新为 `[x]`，确保任务进度实时可追踪。

- **`merge-executor` Skill 输出更新** — 合并完成后自动执行 `git add -A && git commit`（使用 `-A` 覆盖所有规格文件），并输出包含实现代码、verify、archive 三步的后续指引，替代原来直接提示 archive 的旧文案。

- **全链路文档同步** — `AGENTS.md`、`CLAUDE.md`、`spec/change-management.md`、`spec/workflow.md`、`skills/`、`plugin/commands/`、`plugin-opencode/template/` 及 `cli/src/i18n.ts` 中所有涉及变更流程的描述统一更新为新的 10 步流程，消除旧流程残留。

## [0.8.2] - 2026-04-28

### Fixed

- 修复 `cli/src/commands/status.ts` 中未使用参数导致的发布前 lint 阻塞。

### Changed

- 将 npm 发布版本升级到 `0.8.2`，用于发布当前已通过测试和打包校验的 CLI 版本。

## [0.8.0] - 2026-04-25

### Added

- **Codex 一等集成** — `openlogos init` / `sync` 新增 `codex` 作为一等 AI 工具选项，可自动部署 `.agents/skills/`、`.codex-plugin/` 和 `.codex/config.toml` 所需配置，并在生成的 AGENTS/CLAUDE 指令中输出与 Codex 目录结构一致的 Skill 路径。

- **模块命名规范与模块管理命令** — CLI 与方法论文档全面支持 `<module>-<序号>-<类型>` 命名规则，新增 `openlogos module list/add/rename/remove` 与 `openlogos next`，并为多模块状态展示、场景编号全局唯一、`logos-project.yaml.modules[]` / `scenario_counter.next_id` 等能力提供实现与测试覆盖。

### Changed

- **结构化 JSON 输出升级** — `status --format json` / `next --format json` 补充多模块相关字段与活跃提案推进状态信息，`spec/cli-json-output.md` 同步更新，确保外部消费 CLI 输出时的契约与实现一致。

- **资源与规范命名全面切换到 `core-` 前缀** — `logos/resources/`、Skills、spec 及相关测试夹具统一迁移到模块前缀命名，`sync-resource-index` 也已适配新的场景/测试文件匹配规则。

### Fixed

- **guard 互斥缺失** — `openlogos change` 现在会在已有活动 guard 时拒绝创建新提案，避免覆盖 `logos/.openlogos-guard`。

- **`status` 模块区块标题 i18n 缺失** — 补充 `status.modules` 中英文词条，并增加文本模式回归测试，避免模块标题直接显示未翻译 key。

## [0.7.3] - 2026-04-22

### Fixed

- **`scenario-architect` Skill — mermaid 箭头行单行约束** — 修复 AI 在生成时序图时将较长步骤描述折行写入箭头行（如将 UI 按钮文字另起一行补充），导致 mermaid 引擎解析失败、markdown 渲染出错的问题。在 Skill 规范中新增强制约束：每条 `->>` / `-->>` 箭头的完整内容必须写在同一行；描述过长时应精简措辞而非拆行；补充细节统一放到时序图下方的"步骤说明"列表中。

## [0.7.2] - 2026-04-21

### Added

- **`sync` 命令输出版本号** — `openlogos sync` 执行时在首行显示当前 CLI 版本（如 `Syncing project files... (openlogos v0.7.2)`），方便确认实际运行的版本。

## [0.7.1] - 2026-04-21

### Fixed

- **`--version` 输出硬编码问题** — `VERSION` 常量改为从 `package.json` 动态读取，彻底消除版本号需要手动同步的隐患。

## [0.7.0] - 2026-04-21

### Added

- **`init --ai-tool all`：一次初始化所有 AI 工具** — `openlogos init` 新增第 5 个选项「All（全部工具）」，选择后同时为 `claude-code`、`opencode`、`cursor` 部署 Skills、生成 AGENTS.md + CLAUDE.md（均含 Active Skills 段）并部署 OpenCode 插件。`logos.config.json` 的 `aiTool` 字段写入数组 `["claude-code", "opencode", "cursor"]`。`openlogos sync` 同步兼容数组格式，对每个工具依次执行部署。

- **场景完整性校验（Scenario Completion Guard）** — `openlogos status` 的阶段完成判断全面升级：
  - `logos-project.yaml` 新增 `scenarios` 顶层字段，作为项目场景清单的**单一真相来源**，格式为 `[{ id: "S01", name: "..." }]`。
  - Phase 3-1（场景建模）、Phase 3-2（API 设计）、Phase 3-3a（测试用例）三个阶段，改为基于 `scenarios` 清单的逐场景文件校验（通过 `SXX-` 命名前缀匹配），有场景缺失时显示 `incomplete: missing SXX SXX` 并阻止进入下一阶段。
  - 向后兼容：若 `scenarios` 字段不存在，降级回原有"目录有文件即完成"逻辑。

- **`logos/resources/reference/` 目录** — `openlogos init` 新增创建 `reference` 资源目录，用于存放参考资料。

### Changed

- **`architecture-designer` Skill 收尾步骤强化** — 架构设计完成后，新增强制步骤：梳理核心业务场景列表，引导用户确认后预先写入 `logos-project.yaml` 的 `scenarios` 字段，为后续场景建模阶段提供输入基础。

- **`scenario-architect` Skill 新增 Step 0（强制）** — 建模开始前必须先确认场景清单：若 `logos-project.yaml` 中无 `scenarios` 字段则要求用户补填并写入；若已有则展示清单确认无遗漏。每完成一个场景文件后提示剩余未完成数量。

- **`spec/logos-project.md` 规范更新** — 新增 `scenarios` 字段完整定义，包含字段说明、命名规则约定（各阶段 `SXX-` 前缀规则）和完整示例。

### Plugin (0.3.0)

- `openlogos-phase` 脚本新增 `get_scenario_ids` 和 `check_scenarios_complete` 函数，实现基于 `logos-project.yaml` 的场景级完成校验，替代原有的目录级 `has_files` 判断。

## [0.5.8] - 2026-04-09

### Fixed

- **npm 包展示 README** — `@miniidealab/openlogos` 自 `cli/` 目录发布，此前包根目录缺少 `README.md`，导致 npm 项目页提示 “This package does not have a README”。现已新增 `cli/README.md`（安装说明、常用命令、文档与 CHANGELOG 链接），并列入 `package.json` 的 `files` 字段，确保打入发布 tarball。

### Added

- **示例 money-log（OpenCode 集成演示）** — 在 `examples/money-log/` 纳入轻记账 Electron 小应用，含 `.opencode/plugins/`、`.opencode/commands/` 与完整 `logos/resources/`；与 `examples/flowtask/`（Claude Code 演示）在文档中对位说明，并更新根 `README.md`、`examples/README.md` 与 `docs/opencode.md` 入口。

## [0.5.7] - 2026-04-09

### Added

- **OpenCode Native Plugin MVP (draft)** — Added `plugin-opencode/` as a native OpenCode plugin prototype (single-package strategy):
  - Command bridge for `/openlogos:*` to existing CLI commands (`status`, `change`, `merge`, `archive`, `verify`, etc.)
  - Session lifecycle hook prototype for initial context injection
  - Distributed via `@miniidealab/openlogos` and auto-deployed by `init/sync` (no separate plugin package)
  - Local/npm usage examples (`examples/opencode.json`, `.opencode/plugins/openlogos-local.js`)
  - Unit tests for command parsing and hook dispatch
- **OpenCode plugin spec** — Added `spec/opencode-plugin.md` to document architecture, command contract, hook strategy, error codes, and security boundaries.

### Changed

- **Phase 3 Step 4 交付规则强化（业务与测试闭环）** — `spec/workflow.md` 明确 Step 4 必须同时交付业务代码、UT/ST 测试代码与 OpenLogos reporter；允许大任务分批，但每批必须闭环，且需先声明本批 UT/ST 用例 ID；并新增 Step 5 前置门禁，Step 4 未完成不得进入验收。
- **分批执行 reporter 规范补充** — `spec/test-results.md` 新增“分批闭环执行约定”：强调用例 ID 与 `logos/resources/test/*.md` 对齐、每批完整测试前清空结果文件、重复 ID 以最后一次结果为准。
- **AI 指令模板可复用化** — `spec/agents-md.md`、`cli/src/commands/init.ts`、`AGENTS.md`、`CLAUDE.md` 同步加入 Step 4 分批执行规则与可直接复用提示词，避免 AI 在大任务中只写业务不写测试。
- **测试覆盖补强** — `cli/test/s01-init.test.ts` 增加中英文场景下 Step 4 分批规则生成断言，确保 `createAgentsMd()` 输出包含闭环约束文案。

## [0.5.6] - 2026-04-09

### Fixed

- **OpenCode slash command discovery** — OpenCode 1.x lists `/` commands from `.opencode/commands/*.md`, not from plugin `tui.command.execute`. `init`/`sync` now deploys Markdown command definitions (e.g. `/openlogos-status`, `/openlogos-sync`) that run `openlogos` via OpenCode’s `` !`…` `` shell injection, so the TUI no longer shows "No matching items" for `openlogos`.

## [0.5.4] - 2026-04-08

### Added

- **OpenCode as first-class AI tool** — `openlogos init` now offers OpenCode as a dedicated option (option 3) alongside Cursor and Claude Code, instead of grouping it under "Other". OpenCode deploys Skills to `logos/skills/` and includes Active Skills in `AGENTS.md` (which OpenCode reads on startup).

## [0.5.3] - 2026-04-08

### Added

- **`documents.changes` in logos.config.json** — `openlogos init` now includes a `changes` document module (`./changes`, `**/*.{md,json}`) in the generated config, so RunLogos can discover and display change proposals. `openlogos sync` incrementally backfills this entry for existing projects without overwriting user customizations.

## [0.5.2] - 2026-04-07

### Added

- **Change Guard Mechanism** — New `logos/.openlogos-guard` lock file to enforce change management workflow in `lifecycle: "active"` projects:
  - `openlogos change <slug>` now automatically creates the guard file with `activeChange` and `createdAt`
  - `openlogos archive <slug>` automatically removes the guard file (only if it matches the archived slug)
  - SessionStart Hook (`openlogos-phase`) detects guard state and reports it — shows active change slug or warns that no proposal exists
  - AGENTS.md/CLAUDE.md and Cursor policy `.mdc` upgraded from "Must Follow" to "Enforced" with behavioral constraints: AI must not modify code directly when discovering bugs, must verify guard file before editing, and must wait for user approval

## [0.5.1] - 2026-04-07

### Fixed

- **Deploy spec/ documents to user projects** — `openlogos init` and `sync` now deploy all methodology spec files (7 files including `test-results.md`, `sql-comment-convention.md`, etc.) to `logos/spec/`. Previously, CLAUDE.md and Skills referenced `spec/test-results.md` but the file was never deployed, causing AI to guess incorrect formats (e.g. `"passed"` instead of `"pass"`). All references updated from `spec/` to `logos/spec/`. npm package now includes `spec/` directory.

## [0.5.0] - 2026-04-07

### Added

- **SQLite Structured Comment Convention** — New `-- @comment` / `-- @table-comment` annotation format for SQLite DDL, providing machine-parseable table and column metadata equivalent to PostgreSQL's `COMMENT ON` and MySQL's inline `COMMENT`:
  - `spec/sql-comment-convention.md` — Full specification with parsing algorithm and examples
  - `parseSqlComments()` — New CLI library function (`cli/src/lib/sql-comments.ts`) that extracts `SchemaMetadata` from annotated SQL files
  - `db-designer` Skill updated with SQLite comment rules, dialect quick reference table expanded to 3 columns, and SQLite-specific best practices section
  - 13 new unit tests for the SQL comment parser
- **Test suite expanded** from 125 to 140 cases

## [0.4.3] - 2026-04-07

### Fixed

- **`openlogos init` forced language selection in non-TTY** — In non-interactive mode (e.g. Claude Code), `init` now **exits with an error** if `--locale` is not provided, printing a clear usage hint. This forces the AI to ask the user for language preference before retrying with `--locale <en|zh>`. AI tool is still auto-detected from `CLAUDE_PLUGIN_ROOT`/`CLAUDE_CODE` env vars.

## [0.4.2] - 2026-04-07

### Fixed

- **`openlogos init` non-TTY smart defaults** — Auto-detects locale from `LANG`/`LC_ALL` env var and AI tool from env vars (superseded by 0.4.3 approach).

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

[Unreleased]: https://github.com/miniidealab/openlogos/compare/v0.5.8...HEAD
[0.5.8]: https://github.com/miniidealab/openlogos/releases/tag/v0.5.8
[0.5.7]: https://github.com/miniidealab/openlogos/releases/tag/v0.5.7
[0.5.6]: https://github.com/miniidealab/openlogos/releases/tag/v0.5.6
[0.5.4]: https://github.com/miniidealab/openlogos/releases/tag/v0.5.4
[0.5.3]: https://github.com/miniidealab/openlogos/releases/tag/v0.5.3
[0.5.2]: https://github.com/miniidealab/openlogos/releases/tag/v0.5.2
[0.5.1]: https://github.com/miniidealab/openlogos/releases/tag/v0.5.1
[0.5.0]: https://github.com/miniidealab/openlogos/releases/tag/v0.5.0
[0.4.3]: https://github.com/miniidealab/openlogos/releases/tag/v0.4.3
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
