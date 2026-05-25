# 变更提案：内置 ui-ux-pro-max Skill

> module: core | created: 2026-05-24

## 变更原因

OpenLogos 在 Phase 2（产品设计）阶段对**含图形界面（GUI）的产品**——包括 Web 应用、移动应用、桌面应用——的视觉/交互细化能力不足。现有 `product-designer` Skill 在产品类型表中虽已区分 Web/CLI/AI Skills/Library，但对 GUI 类产品的产出仅停留在「HTML 可交互页面」层面——风格选择、配色、字体、组件库选型、可访问性等专业 UX 维度完全未覆盖。

> 触发反馈的真实场景：runlogos 本身就是 Electron 桌面应用，做产品设计时同样需要风格/配色/字体/组件库推荐——「Web 才需要 UX」是个伪边界，所有有图形界面的产品都需要。

上游开源 Skill [`ui-ux-pro-max`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT）正好填补这个缺口：数据驱动的 UI/UX 设计智能，含 161 种产品类型风格规则、96 种调色板、57 种字体配对、99 条 UX 准则、25 种图表类型，覆盖 13 个主流前端/移动技术栈（其中 Electron/Tauri 类桌面壳直接复用其 web 栈数据，SwiftUI / Jetpack Compose 已直接命中）。体积仅 668 KB。

**完整背景与可行性调研** 见 `logos/resources/reference/builtin-ui-ux-pro-max-skill-guide.md`（含上游基本信息、四种集成方案对比、Python 依赖现状、风险与对策）。

本次变更将其完整 vendor 进 OpenLogos，让 `product-designer` 在 **GUI 类产品（Web / Mobile / Desktop）** 设计时自动调用，形成职责互补：

| Skill | 职责 |
|------|------|
| `product-designer` | 决定「哪些页面、什么交互流程、什么验收条件」（场景骨架） |
| `ui-ux-pro-max` | 决定「长什么样、什么风格、什么配色、用什么组件库」（视觉与体验） |

## 变更类型

代码级（新增 Skill 资产 + 修改既有 Skill 触发链 + 修改 CLI init 流程）

> 说明：OpenLogos 仓库本体是 CLI 工具与方法论 Skill 集合，不存在业务 PRD/API/DB 规格。本次所有改动都集中在 `skills/`、`plugin/skills/`、`cli/src/`、根 `CLAUDE.md` / `AGENTS.md` 这类源码资产上，因此判定为代码级，无需走 delta 流程。

## 变更范围

- 影响的需求文档：无（OpenLogos 仓库本身无业务 PRD）
- 影响的功能规格：无
- 影响的业务场景：无
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无
- **影响的源码资产**：
  - 【新增】`skills/ui-ux-pro-max/`（vendor 自上游，含 SKILL.md / data/ / scripts/ / LICENSE / UPSTREAM.md，约 668 KB）
  - 【新增】`plugin/skills/ui-ux-pro-max/`（与上同步）
  - 【修改】`skills/product-designer/SKILL.md`：
    - 产品类型表（第 25-32 行）新增「桌面应用」整行
    - Step 2「设计信息架构」补充桌面应用维度（窗口 / 菜单 / IPC / 文件系统）
    - 在 Step 5 前插入 Step 5a：**GUI 类产品（Web / Mobile / Desktop）** 时主动调用 ui-ux-pro-max（含无 Python 降级提示）
  - 【修改】`skills/product-designer/SKILL.en.md`（同步上述三项：Desktop 行、Step 2 Desktop 维度、Step 5a）
  - 【修改】`plugin/skills/product-designer/SKILL.md`（同步）
  - 【修改】`cli/src/commands/init.ts`：
    - `generateActiveSkillsSection` 的 Skill 列表中追加 `ui-ux-pro-max` 条目（中英双语，描述需体现「Web/Mobile/Desktop 通用」）
    - 项目初始化结束阶段加入非阻塞的 `python3` 检测与友好提示
  - 【修改】`CLAUDE.md` / `AGENTS.md`（项目根的 dogfood 副本，按 [feedback_logos_vs_source.md] 提示，源头是 `cli/src/commands/init.ts` 的生成器，不直接编辑根文件）
  - 【可能修改】`cli/test/s01-init.test.ts`（如新加的 Python 检测影响 init 输出快照）
  - 【修改】`CHANGELOG.md`（记录本次 vendor 引入）

## 部署影响

- 是否需要部署：否
- 部署原因：OpenLogos 是本地 CLI 工具，分发渠道为 npm。本次改动的发布走常规 CLI 版本升级（独立流程，不属于 proposal 的 `[deploy]` section）。
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## 变更概述

1. **Vendor 上游 skill**：用 `npx uipro-cli init --ai claude` 在临时目录生成产物，拷贝到 `skills/ui-ux-pro-max/`，附 `LICENSE`（上游 MIT）与 `UPSTREAM.md`（记录基线 commit、同步方法、本地化改动清单）。
2. **路径本地化**：vendor 后全文替换 SKILL.md 中 `skills/ui-ux-pro-max/scripts/...` 为 `logos/skills/ui-ux-pro-max/scripts/...`，并在文件顶部加 OpenLogos vendor 标注。
3. **多平台同步**：将 `skills/ui-ux-pro-max/` 同步一份到 `plugin/skills/`，保持与现有 13 个 plugin skill 的目录结构一致；后续由 `openlogos sync` 分发到用户项目的 `.claude/skills/`、`.codex/skills/`、`.opencode/skills/`、`.cursor/skills/` 等。
4. **触发链改造**：在 `skills/product-designer/SKILL.md`（及 `.en.md`）做两层改造，保证「产品类型识别」与「设计系统调用」对桌面应用全程贯通：
   - **第一层（识别）**：产品类型表中新增「桌面应用」行；Step 2「设计信息架构」补充桌面应用的窗口/菜单/IPC/文件系统维度
   - **第二层（调用）**：在 Step 5 前插入 Step 5a，**凡产品交付物中包含图形用户界面（GUI）的产品类型** 在生成原型前先调用 `python3 logos/skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system -p "<项目名>"` 拿到风格/配色/字体/组件库推荐，再交回 product-designer 生成原型。

   **触发判定（按是否含 GUI，而非按具体产品类型枚举）**：
   - ✅ 触发：Web 应用 / 移动应用（iOS / Android / RN / Flutter）/ 桌面应用（Electron / Tauri / SwiftUI / Jetpack Compose / Qt / WPF / GTK 等）/ 混合型中含 GUI 交付物的部分
   - ❌ 不触发：纯 CLI 工具 / Library / AI Skills / 纯 API 服务 等无 GUI 交付物的产品类型

5. **降级与提示**：`product-designer` 在调用前感知 Python 3 可用性，缺失时不阻塞流程并给用户安装提示；`openlogos init` 末尾追加同样的非阻塞 Python 3 检测与友好提示。
6. **模板更新**：`cli/src/commands/init.ts` 的 `generateActiveSkillsSection` 列表中追加 `ui-ux-pro-max` 条目，描述明确「Web/Mobile/Desktop 等 GUI 产品通用」；同步刷新 `CLAUDE.md` / `AGENTS.md`（通过修改生成器 + 重跑生成，不直接改根文件）。
7. **CHANGELOG 记录**：在 `CHANGELOG.md` 注明本次 vendor 引入与 product-designer 触发链改动。

### 已确定的关键决策（对应需求文档 §7 的开放问题）

1. **是否需要 change proposal**：是。OpenLogos 自身已 `lifecycle: launched`，且当前无 guard 文件，直接改码会破坏可追溯性。本提案即为该流程的合规起点。
2. **触发策略**：默认对**所有 GUI 类产品（Web / Mobile / Desktop）** 自动触发，不引入 `logos.config.json` 开关。
   - **桌面端可行性确认**：Electron / Tauri 等基于 web 栈的桌面壳直接复用 ui-ux-pro-max 的 react / vue / svelte / shadcn / html-tailwind 数据；SwiftUI / Jetpack Compose / Flutter 已在上游 13 个 stacks 中直接命中；纯 native 桌面（Qt / WPF / GTK）虽无对应 stack 数据，但风格 / 配色 / 字体 / UX 准则 / 图表数据均是栈无关的，仍能给出有价值的推荐。
   - **不加配置开关的理由**：用户已通过 product-designer 表明产品类型，再加开关只会增加心智负担；缺 Python 时已有降级路径，足以兜底。
3. **多语言 SKILL.md**：本期不维护中文版上游 SKILL.md。理由：上游 SKILL.md 是给 AI 读的「检索指南 + 数据描述」，AI 可在调用时自动以 zh locale 输出推荐结果；翻译副本会显著增加同步成本（参见需求文档 §4.4 UPSTREAM.md 中的 OpenLogos-Side Modifications 风险）。仅在文件顶部加一行中文 vendor 标注。
4. **plugin/skills/ 同步**：本次新增 ui-ux-pro-max 必须同时落到 `skills/` 和 `plugin/skills/`。两个目录现有的数量差（15 vs 13）超出本次变更范围，不在本提案处理。
5. **examples/money-log/.opencode/skills/ui-ux-pro-max/**：保留现状，不在本提案中清理或对齐。理由：那是用户样例项目内部的 sync 产物，本次提案聚焦上游分发源；examples 的同步可在后续单独提案中处理。

## 验收要点

- [ ] `skills/ui-ux-pro-max/` 与 `plugin/skills/ui-ux-pro-max/` 目录就位，含 SKILL.md / data/ / scripts/ / LICENSE / UPSTREAM.md
- [ ] SKILL.md 顶部含 OpenLogos vendor 标注，且全文路径已替换为 `logos/skills/ui-ux-pro-max/...`
- [ ] `python3 logos/skills/ui-ux-pro-max/scripts/search.py "saas" --domain product -n 3` 在用户项目侧能正常输出
- [ ] `--design-system` 模式输出完整设计系统建议
- [ ] product-designer 产品类型表已新增「桌面应用」行（中英文版一致）；Step 2 信息架构已补充桌面应用维度
- [ ] product-designer Step 5a 在 **GUI 类产品（Web / Mobile / Desktop，含 Electron / Tauri / SwiftUI / Jetpack Compose / Qt / WPF 等）** 时被触发
- [ ] product-designer Step 5a 在 **CLI 工具 / Library / AI Skills / 纯 API 服务** 等无 GUI 产品类型时**不触发**
- [ ] 桌面端样例（如 Electron）能从上游 react / shadcn / html-tailwind 数据拿到组件库推荐；native 桌面（如 Qt）能拿到风格 / 配色 / 字体推荐（即使无 stack 命中）
- [ ] 缺 Python 3 时降级提示生效，不阻塞 product-designer 后续步骤
- [ ] `openlogos init` 末尾的 Python 检测在干净环境（含/不含 Python）下都不阻塞
- [ ] `openlogos sync` 能把 ui-ux-pro-max 分发到 `.claude/skills/`、`.codex/skills/`、`.opencode/skills/`、`.cursor/skills/`
- [ ] `CLAUDE.md` / `AGENTS.md` 的 Active Skills 列表含 ui-ux-pro-max 条目，且描述体现「GUI 产品通用」
- [ ] `CHANGELOG.md` 已记录本次变更
- [ ] CLI 测试套件 `cd cli && npm test` 通过
