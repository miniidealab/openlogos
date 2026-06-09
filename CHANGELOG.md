# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.7] - 2026-06-09

### Fixed

- **修复 Codex SessionStart 生命周期注入误判** — Codex hook 现在优先读取 `openlogos status --format json` 的 `data.lifecycle` 和 `data.active_change`，确保 `logos-project.yaml` 中模块已 launched 时注入 `Lifecycle: launched`、`Change Management: ACTIVE` 和 `openlogos change <slug>`，不再因 `logos.config.json.lifecycle` 缺失误导模型跳过变更提案。
- **修复 launched all-done 项目的下一步提示** — `openlogos status/next` 在项目已 launched 且所有阶段完成时，不再输出 `openlogos launch` 初始发布提示，改为引导创建补文档或业务迭代提案。

## [0.10.6] - 2026-06-06

### Fixed

- **修复空提案部署占位符冲突误报** — `openlogos status --format json` 解析 `proposal.md` 的 `## 部署影响` 时，只有字段值精确为 `是` 或 `否` 才视为有效布尔决策；空模板中的 `是 / 否` 不再被误解析为 `true`，新建提案保持 `proposal_step=writing` 且不再输出 `deployment_decision_conflict=true`。

## [0.10.5] - 2026-06-04

### Fixed

- **修复 proposal 模板占位符状态误判** — `openlogos status` 判断 `proposal.md` 是否仍为模板状态时，部署占位符检查限定到 `## 部署影响` section 的结构化字段值；正文其他章节合法引用 ``是 / 否`` 不再导致 `proposal_step` 被误判为 `writing`。新增 S11 回归测试覆盖正文引用和字段值占位符两个方向。

## [0.10.4] - 2026-06-01

### Added

- **PreToolUse guard hook** — 新增 `.claude/openlogos/bin/guard-check` 脚本，在 Claude Code 调用 Edit/Write/Bash 工具前检查 `logos/.openlogos-guard` 是否存在。`launched` 生命周期项目在无活跃变更提案时，工具调用被 exit 2 硬性阻断，将变更管理从"提醒"升级为"强制执行"。支持白名单（`logos/changes/`、`CLAUDE.md`、`AGENTS.md` 等）和 initial lifecycle 豁免。
- **官网文档全面同步** — 补齐 11 个缺失文档页（`adopt`、`smoke` 命令；`deployment-designer`、`deployment-executor`、`ui-ux-pro-max` Skills；`cli-json-output`、`codex-plugin`、`directory-convention`、`module-naming-convention`、`sql-comment-convention`、`tasks-spec` 规格）；修正版本号、命令数（12→14）、Skill 数（13→16）、Phase 体系（11→13 阶段）、lifecycle 术语（`active`→`launched`）；补全侧边栏导航。

## [0.10.3] - 2026-05-28

### Fixed

- **修复 tag 发布链路的网站构建 Node 版本不兼容** — `publish.yml` 在网站构建阶段切换到 Node `22.12.0`，满足 Astro 6 的最低版本要求，避免发布后半段失败。

## [0.10.2] - 2026-05-28

### Fixed

- **修复发布流水线中的沙箱测试跨平台问题** — `ST-JSON-27` 改为显式使用测试工作区内可写 `sandbox_root`，避免在 Linux runner 上因 `/private/tmp` 权限差异误报失败。

## [0.10.1] - 2026-05-28

### Fixed

- **修复 tag 发布 workflow 配置错误** — `publish.yml` 不再在 `if` 条件中直接引用 `secrets`，改为显式凭据检查步骤，避免出现 “workflow file issue / jobs 为空” 导致 npm 发布链路中断。

## [0.10.0] - 2026-05-28

### Added

- **verify / smoke 沙箱执行标准化** — `openlogos verify` 与 `openlogos smoke` 统一支持 `sandbox_mode`、`sandbox_root` 和 `sandbox_deny_workspace_write`，并在 JSON 输出中暴露 `sandbox` 诊断。
- **CLI 沙箱执行器** — 预跑命令与 smoke 命令可按配置进入隔离执行，`auto` 模式可降级，`always` 模式强制隔离。
- **官网沙箱说明同步** — `openlogos.ai` 的 `verify` 文档补充 `--format json` 与沙箱配置说明，便于用户理解门禁输出。

### Fixed

- **防止测试命令误写工作区** — sandbox 执行链路会回收结果文件并限制工作区写入，降低 verify / smoke 误改仓库的风险。

## [0.9.31] - 2026-05-27

### Changed

- **adopt 接入模式语义收敛** — `openlogos adopt` 现在统一写入 `bootstrap: adopted`，并明确接入语义为“完整初始化基础设施，仅跳过 Initial 文档门禁”。
- **bootstrap 历史值兼容归一** — 读取 `logos-project.yaml` 时会将历史 `bootstrap: skipped` 兼容映射为 adopted 接入模式，新写入不再产生 `skipped`。
- **next/status/launch/detect 联动更新** — `next` 补文档建议、`status` 的 Initial 阶段展示、`launch` 门禁豁免与 `detect --format json` 输出均按 adopted 语义生效，并兼容历史 skipped 项目。

### Fixed

- **OpenLogos reporter 覆盖缺口修复** — 补齐 bootstrap 相关测试 ID 映射，`openlogos verify` 覆盖率恢复为 `100% (121/121)`。

## [0.9.30] - 2026-05-27

### Added

- **verify 预执行模型** — `openlogos verify` 现在支持单阶段 `verify.pre_run_command` 兼容路径，以及 `verify.regression_command` + `verify.incremental_command` 两阶段预跑；阶段结果按 `last-write-wins` 合并，避免局部测试 JSONL 覆盖导致验收误判。
- **verify JSON 预跑状态** — `openlogos verify --format json` 新增 `data.pre_run`，输出预跑模式、命令状态、结果路径、诊断和修复建议，方便 RunLogos 等客户端直接展示。
- **init / adopt / sync 自动补齐 verify 预跑配置** — 常见 Node/Vitest、Jest、pytest、Go、Cargo 项目会自动写入全量测试命令；无法推断时输出明确 TODO 诊断。

### Fixed

- **覆盖不足诊断更明确** — 当项目未配置预跑命令且 JSONL 覆盖不完整时，CLI 会提示可能只运行了局部测试，并建议配置 `verify.pre_run_command` 或两阶段命令。

## [0.9.29] - 2026-05-25

### Added

- **内置 `ui-ux-pro-max` Skill（vendor 自上游）** — Phase 2 处理 GUI 类产品（Web / Mobile / Desktop，含 Electron / Tauri / SwiftUI / Jetpack Compose / Qt 等）设计时，`product-designer` 自动调用 `ui-ux-pro-max` 拿到风格 / 配色 / 字体 / 组件库 / 反模式推荐（67 风格 / 96 调色板 / 57 字体配对 / 25 图表 / 13 技术栈）。上游来自 [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT），约 668 KB。
- **`product-designer` 扩展桌面应用支持** — 产品类型表新增「桌面应用」行；Step 2「信息架构」补充窗口/菜单/IPC/文件系统维度；Step 5 拆分为 Step 5a（GUI 类产品调用 ui-ux-pro-max）+ Step 5b（按产品类型生成原型）。
- **`openlogos init` 末尾非阻塞 Python 3 检测** — 若未检测到 `python3`，输出黄色友好提示与多 OS 安装命令；不阻塞主流程。
- **`deploySkills` 支持多文件 skill** — `ui-ux-pro-max` 的 `data/` + `scripts/` 在所有 aiTool（claude-code / codex / cursor / opencode）下都会被完整拷贝到 `logos/skills/ui-ux-pro-max/`，确保 SKILL.md 中写死的 `python3 logos/skills/ui-ux-pro-max/scripts/...` 路径始终可用。

## [0.9.28] - 2026-05-25

### Fixed

- **修复 CLI JSON 在局部损坏 `logos-project.yaml` 时回退 `initial` 的问题** — `detect/status --format json` 现在会从 YAML AST 恢复 `modules[]`，继续输出 launched 生命周期与 `yaml_diagnostics`。

## [0.9.27] - 2026-05-24

### Changed

- **发布版本提升到 0.9.27** — 本次发版包含 `deploy-progress-summary-panel` 的 CLI 适配、部署进度摘要字段和冲突态门禁加固。

## [0.9.26] - 2026-05-24

### Changed

- **发布版本提升到 0.9.26** — 本次发版包含 `proposal-deploy-consistency-hardening` 的 CLI 适配与提案级部署门禁加固。

## [0.9.24] - 2026-05-21

### Added

- **新增部署 Phase 与部署状态流转** — Initial 阶段新增 `Phase 3-3 · 部署方案`，提案流程支持部署影响判断、部署 delta、`[deploy]` 任务、`ready-to-deploy` / `deploy-done` 状态，以及 verify 通过后的部署任务展示。
- **新增 `openlogos smoke` 冒烟测试命令** — 支持部署后运行冒烟测试、生成 smoke 报告，并写入 `SMOKE_PASS` / `SMOKE_FAIL` 标记；`status` / `next` / `launch` 同步感知 `ready-to-smoke`、`smoke-passed` 和 `smoke-failed` 状态。
- **新增部署设计与执行 Skill** — 增加 `deployment-designer` 和 `deployment-executor`，明确部署方案、回滚策略、部署后检查、冒烟测试方案，以及部署必须经过人类确认的执行边界。

### Changed

- **launch 前门禁加强** — `openlogos launch` 在进入迭代前检查 verify / deploy / smoke 状态；不需要部署的模块可通过 `deployment_required: false` 或 `skip_phases: [deployment]` 跳过部署与 smoke 门禁。
- **方法论文档与 Skill 同步更新** — workflow、change-management、tasks、directory、agents、CLI JSON 输出等规范均补充部署 Phase、smoke 流程和人类确认点说明。

## [0.9.21] - 2026-05-16

### Fixed

- **`openlogos sync` 多工具技能同步一致性** — 当 `aiTool` 为数组或 `all` 时，`sync` 与 `launch` 现在会同步部署所有可部署工具的 Skills、插件资产与对应指令文件，`AGENTS.md` / `CLAUDE.md` 也按多工具语义生成，避免文件已部署但指令文件只覆盖单一工具的错配。

### Changed

- **官网与 CLI 文档同步更新** — 修正 `openlogos init` 的 AI 工具选择说明、CLI 命令总数、版本示例，以及 `sync` / `launch` 的多工具行为描述，确保对外文档与当前实现一致。

## [0.9.20] - 2026-05-13

### Changed

- **纯代码提案跳过 merge 阶段** — 新格式 tasks.md（含 `## [tag]` section）中，无 `[delta]` section 的提案不再经过 `ready-to-merge` / `merge-generated`，直接按 `[code]` section 勾选状态进入 `coding` 或 `ready-to-verify`。旧格式向后兼容。

## [0.9.19] - 2026-05-13

### Fixed

- **修复 `openlogos merge` 幂等性问题** — 提案已存在 `SPEC_MERGED` 标记时，重复执行 `openlogos merge` 现在会提示"规格已合并，无需重复操作"并直接退出，不再覆盖 `MERGE_PROMPT.md`。

## [0.9.18] - 2026-05-13

### Changed

- **提案全生命周期精确追踪** — 状态机扩展为完整八段式：`writing` → `delta-writing` → `ready-to-merge` → `merge-generated` → `coding` → `ready-to-verify` → `verify-passed` / `verify-failed`
- **`[code]` section 驱动 coding → ready-to-verify 转换** — `SPEC_MERGED` 存在时，`[code]` section 全部勾选（或无 `[code]` section）→ `ready-to-verify`；否则保持 `coding`
- **verify 写入提案标记文件** — `openlogos verify` 执行后自动读取 `.openlogos-guard`，通过写 `VERIFY_PASS`，失败写 `VERIFY_FAIL`，状态机据此精确感知验收结果
- **新增三个状态的 next 提示** — `ready-to-verify` 提示运行 verify，`verify-passed` 提示归档，`verify-failed` 提示修复后重新 verify

## [0.9.17] - 2026-05-13

### Changed

- **tasks.md 结构化 section 格式** — 引入 `## [delta]` 和 `## [code]` section 标记，将 delta 任务与代码任务严格分离。`detectProposalStep()` 改为按 `[delta]` section 的勾选状态判断是否进入 `ready-to-merge`，不再依赖整个 tasks.md 的全局勾选
- **纯代码提案不再卡住** — 无 `[delta]` section 的提案直接进入 `ready-to-merge`，无需手动运行 `openlogos merge` 跳出
- **向后兼容** — 无 section 标记的旧格式 tasks.md 降级为原有全局勾选判断，已有提案不受影响
- **新增 `spec/tasks-spec.md`** — 完整的 tasks.md 结构化格式规范文档
- **tasks.md 模板更新** — CLI 生成的初始模板改为结构化格式

## [0.9.16] - 2026-05-13

### Changed

- **提案状态机扩展为五段式**：`writing` → `delta-writing` → `ready-to-merge` → `merge-generated` → `coding`，每个阶段语义明确，消除 `implementing`/`in-progress` 的歧义
- **`openlogos merge` 递归扫描 delta**：支持 `deltas/prd/1-product-requirements/`、`deltas/prd/3-technical-plan/` 等嵌套子目录，嵌套路径正确映射到对应主文档目录；新增 `deltas/test/` 映射
- **两段式 merge 标记**：`openlogos merge` 生成 `MERGE_PROMPT.md` 后写入 `MERGE_PROMPT_GENERATED`（表示"指令已生成"）；AI 执行完规格合并后写入 `SPEC_MERGED`（表示"规格已合并，可开始编码"）
- **`next`/`status` 提示文案对齐状态机**：每个 proposal step 的下一步提示唯一且明确，`delta-writing` 阶段提示产出 delta，`merge-generated` 阶段提示执行 MERGE_PROMPT.md
- **`isTasksTemplateFilled` 改为精确行匹配**：避免用户任务描述中包含占位符关键词时误判为未填写

### Fixed

- 有 delta 时 merge 后状态卡在 `ready-to-merge` 的问题（根因：状态机缺少 `merge-generated` 中间态）

## [0.9.15] - 2026-05-13

### Fixed

- **修复有 delta 时 merge 后状态无法推进的问题** — `openlogos merge` 在有 delta 时，生成 `MERGE_PROMPT.md` 后同时写入 `MERGED` 标记文件，使 `detectProposalStep()` 能正确识别已合并状态并返回 `'coding'`，流程不再卡在"合并规格"步骤。

## [0.9.14] - 2026-05-10

### Changed

- **change-writer Skill 补充 prd/ 子目录的 delta 映射说明** — tasks.md 模板中各文档类任务标注精确的 delta 子目录（`deltas/prd/1-product-requirements/`、`deltas/prd/2-product-design/1-feature-specs/`、`deltas/prd/3-technical-plan/1-architecture/` 等）；Step 6 目录映射表新增 prd/ 子目录展开说明，消除 AI 将架构文档等放错目录的歧义。

## [0.9.13] - 2026-05-09

### Fixed

- **修复无 delta 时 merge 后状态无法推进的问题** — `openlogos merge` 在无 delta 时现在会写入 `MERGED` 标记文件；`detectProposalStep()` 检测到该文件后返回新增的 `'coding'` 状态，使流程正确推进到"实现代码"步骤，不再卡在 merge 阶段。

## [0.9.12] - 2026-05-09

### Changed

- **change-writer Skill 新增 Step 6: 产出 Delta 文件** — 明确 delta 文件的目录映射（`deltas/prd/`、`deltas/api/`、`deltas/database/`、`deltas/scenario/`）、文件命名规范（与目标主文档同名）、文件格式（ADDED/MODIFIED/REMOVED 标记）及行为约束（禁止直接修改主文档）。同步更新 tasks.md 模板，文档类任务标注产出 delta 文件的目标子目录。

## [0.9.11] - 2026-05-09

### Changed

- **变更管理规则改为自动判断** — `createAgentsMd` 和 `generatePolicyMdc` 生成的初始开发期文案，从模糊的"按 Phase 推进即可"改为明确的判断依据：检查 `logos-project.yaml` 中是否存在 `lifecycle: launched` 的模块，存在则必须提案，否则不需要。AI 可自主判断，无需依赖人工提示。

## [0.9.10] - 2026-05-09

### Changed

- **`openlogos merge` delta 为空时不再报错** — `deltas/` 目录为空时，命令直接输出 `✓ nothing to merge` 并正常退出（exit 0），不再以错误退出。空 delta 是合法状态，语义等同于 HTTP 204。

## [0.9.9] - 2026-05-09

### Changed

- **`openlogos archive` 归档目录名加时间戳前缀** — 归档后的目录名格式从 `<slug>` 改为 `YYYYMMDD-HHmm-<slug>`（如 `20260509-1430-fix-login-bug`），方便在归档数量多时按时间快速定位历史提案。

## [0.9.8] - 2026-05-08

### Fixed

- **加强 reporter 强制前置约束，防止测试代码遗漏 reporter** — `code-implementor` Skill Step 4 新增"Reporter 嵌入（强制前置）"小节，明确要求在写任何测试用例代码之前先创建共享 reporter 工具文件（`test/helpers/reporter.ts`），所有测试文件统一 import；Step 5 自检拆分为三条独立 reporter 检查项。`spec/test-results.md` 补充"推荐：共享 reporter 文件模式"说明。`CLAUDE.md` Step 4 提示词后新增 ⚠️ 警告块，将 reporter 提升为强制前置交付物。

## [0.9.7] - 2026-05-08

### Fixed

- **多模块项目 phase 状态判断错误** — `openlogos status --module <新模块>` 对刚创建的模块不再错误返回 `current_phase: null, suggestion: "所有阶段已完成"`。
  - 根因 1：非 scenario 类 phase（需求、设计、架构、API、数据库等）的 `done` 判断是"目录里有任何文件就算 done"，没有模块感知——新模块因为目录里存在其他模块的文件而被误判为全部完成。修复：多模块项目中改用 `<moduleId>-` 前缀过滤文件，单模块项目保持原逻辑（向后兼容）。
  - 根因 2：`logos-project.yaml` 的 `scenarios` 列表没有模块归属字段，所有模块共用同一份 scenario 列表。修复：`scenarios` 新增可选 `module` 字段（缺省 `core`），`status` 按模块过滤 scenarios 后再计算 phase 进度。
- **`openlogos sync` 自动补全 `scenarios[].module` 字段** — 对 `logos-project.yaml` 中没有 `module` 字段的 `scenarios` 条目，`sync` 命令根据文件系统中 `<moduleId>-SXX-*.md` 的存在情况自动推断归属模块，无法推断时默认填 `core`。幂等操作，已有 `module` 字段的条目不覆盖。

## [0.9.6] - 2026-05-08

### Added

- **Claude Code 插件自动部署** — `openlogos init` 和 `openlogos sync` 在选择 `claude-code` 或 `all` 时，自动将插件资产部署到用户项目的 `.claude/` 目录：
  - `plugin/commands/*.md` → `.claude/commands/openlogos/`（10 个斜杠命令）
  - `plugin/agents/*.md` → `.claude/agents/`（change-reviewer sub-agent）
  - `plugin/bin/openlogos-phase` → `.claude/openlogos/bin/openlogos-phase`（SessionStart hook 脚本）
  - `.claude/settings.json` 写入 SessionStart hook（幂等，不覆盖已有配置）
  - 幂等保护：`.claude/commands/openlogos/` 已有文件时跳过，不覆盖用户自定义
  - `claude-plugin-template/` 随 npm 包一起发布

### Fixed

- **`module add` 不再要求活跃变更提案** — `openlogos module add` 原本错误地要求 guard 文件存在才能执行，现已移除该限制。模块管理是项目结构层面的操作，维度高于变更提案，可随时自由执行。
- **`module rename/remove` 改为警告而非阻塞** — 有活跃变更提案时，`rename` 和 `remove` 打印警告提示用户注意 delta 文件可能受影响，但不阻止操作继续执行。

## [0.9.5] - 2026-04-30

### Added

- **`[manual]` 测试用例标记机制** — 在 `test-cases.md` 中对无法自动化执行的用例（如需要真实 TTY/PTY 渲染、跨窗口操作、人工视觉验证的 ST 用例）追加 `[manual]` 标记。`openlogos verify` 跳过这类用例，不计入 `defined_count` 和覆盖率分母，不出现在 `uncovered_cases`，单独以 `manual_count` 字段展示。

### Changed

- **AC trace 支持 `MANUAL_PENDING` 状态** — 若某个验收条件（AC）关联的用例全部为 `[manual]`，标记为 `🔵 MANUAL`（人工待验），不触发 Gate 3.5 失败。混合自动化和 `[manual]` 的 AC，Gate 判定仅取决于自动化部分。
- **`verify --format json` 新增 `manual_count` 字段** — `summary` 对象新增 `manual_count`，外部消费 CLI 输出时可感知人工用例数量。
- **`test-writer` Skill 新增 `[manual]` 判断规则** — Step 3 明确列出需要加 `[manual]` 标记的场景类型（TTY/PTY、跨窗口、视觉验证、外部硬件），并在输出模板中补充示例。
- **`tasks.md` 模板移除 verify 类条目**（`i18n.ts` tasksTemplate）— 与 `spec/change-management.md` 和 `skills/change-writer/SKILL.md` 保持一致。

## [0.9.4] - 2026-04-30

### Fixed

- **回滚 `merge.ts` 中错误添加的 `spec/skills` delta 分类** — `DELTA_TO_RESOURCE` 映射表移除了 0.9.3 中错误引入的 `spec → logos/spec` 和 `skills → logos/skills` 映射。`spec/` 和 `skills/` 是 OpenLogos 自身源码，直接修改即可，不应走 delta/merge 流程，该映射在用户项目中无意义。

## [0.9.3] - 2026-04-30

### Fixed

- **`openlogos merge` 支持 `spec/` 和 `skills/` delta 分类** — `DELTA_TO_RESOURCE` 映射表新增 `spec → logos/spec` 和 `skills → logos/skills`，修复 delta 文件放在这两个分类下时 merge 报"没有 delta 文件"的问题。

### Changed

- **`tasks.md` 模板移除 verify 类条目** — `logos/spec/change-management.md` 和 `logos/skills/change-writer/SKILL.md` 的 tasks.md 示例模板删除"部署到测试环境"和"运行编排验收"条目，并明确标注 `openlogos verify` 是独立 CLI 操作节点，不应写入 tasks.md 作为可勾选任务。

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

[Unreleased]: https://github.com/miniidealab/openlogos/compare/v0.10.7...HEAD
[0.10.7]: https://github.com/miniidealab/openlogos/releases/tag/v0.10.7
[0.10.6]: https://github.com/miniidealab/openlogos/releases/tag/v0.10.6
[0.10.5]: https://github.com/miniidealab/openlogos/releases/tag/v0.10.5
[0.10.4]: https://github.com/miniidealab/openlogos/releases/tag/v0.10.4
[0.10.3]: https://github.com/miniidealab/openlogos/releases/tag/v0.10.3
[0.10.2]: https://github.com/miniidealab/openlogos/releases/tag/v0.10.2
[0.10.1]: https://github.com/miniidealab/openlogos/releases/tag/v0.10.1
[0.10.0]: https://github.com/miniidealab/openlogos/releases/tag/v0.10.0
[0.9.31]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.31
[0.9.30]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.30
[0.9.29]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.29
[0.9.28]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.28
[0.9.27]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.27
[0.9.26]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.26
[0.9.5]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.5
[0.9.4]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.4
[0.9.3]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.3
[0.9.2]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.2
[0.9.1]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.1
[0.9.0]: https://github.com/miniidealab/openlogos/releases/tag/v0.9.0
[0.8.2]: https://github.com/miniidealab/openlogos/releases/tag/v0.8.2
[0.8.0]: https://github.com/miniidealab/openlogos/releases/tag/v0.8.0
[0.7.3]: https://github.com/miniidealab/openlogos/releases/tag/v0.7.3
[0.7.2]: https://github.com/miniidealab/openlogos/releases/tag/v0.7.2
[0.7.1]: https://github.com/miniidealab/openlogos/releases/tag/v0.7.1
[0.7.0]: https://github.com/miniidealab/openlogos/releases/tag/v0.7.0
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
