# OpenLogos 需求文档

> 最后更新：2026-07-21

## 一、产品背景与目标
### 1.1 产品定位
OpenLogos 是一套面向 AI 协作的软件研发方法论、CLI 工具和规范资产集合，用于把 AI 的参与过程约束到 WHY → WHAT → HOW 的标准研发链路中。它既是给人和 AI 共用的研发方法论，也是一个把研发流程本身变成**可编排、可观测、可无人值守推进**的事实源——供 RunLogos、CI 与各类 AI driver 直接消费。

### 1.2 核心目标
1. 让用户能够用统一的阶段与场景语言组织需求、设计、实现与验收。
2. 让 AI 工具在不同宿主环境中遵循同一套方法论与产物格式。
3. 让 OpenLogos 自身也能被 OpenLogos 管理，形成可追溯、可验收、可迭代的标准基线。
4. 让研发流程本身**可编排、可观测、可无人值守自动推进**：用户可用 overlay 增删改流程节点、把门禁接到外部命令（如 CI）、实时观测派生状态，并在 `--auto` 下让 driver 自动跑完全链路——同时以**硬红线守住"未通过测试的代码绝不放行"**（`gate:implement:loop-exhausted` 任何模式都不自动放行）。

### 1.3 目标用户画像
- 维护 OpenLogos CLI 的开发者。
- 使用 Codex、Claude Code、OpenCode、Cursor 的方法论实践者。
- 需要在 AI 时代建立标准研发流程的个人或小团队。
- 用 RunLogos 等编排宿主做**无人值守 / 半自动研发**的团队与 CI 流水线：把 OpenLogos 的 `next` / `status` / `watch` 机器输出当作流程事实源来编排 skill / agent / 脚本。

## 二、用户痛点分析
### P01：AI 直接生成代码，缺少结构化研发过程
因为用户先问”怎么实现”，导致需求、设计、测试与发布顺序被打乱 → 导致 AI 输出不可追溯、难验证 → 造成后续返工和流程失控。

### P02：不同 AI 工具的接入方式不一致
因为不同宿主工具有不同的指令文件、插件、工作区约定和 Skill 命名空间规则 → 导致同一个项目在不同工具下行为不一致 → 造成上下文丢失、维护成本上升，以及 OpenLogos 方法论技能与项目 / 产品 / 仓库专属技能边界混淆。

OpenLogos 必须让 AI 能稳定区分两类能力：
1. **OpenLogos 方法论技能**：由 OpenLogos 官方资产生成和维护，只表达 WHY → WHAT → HOW、Delta、verify、deploy、smoke 等方法论规则。
2. **项目专属技能**：由用户仓库或产品团队维护，只表达当前项目的发布守卫、客户环境操作、业务治理、仓库工程约定等规则，不得被误暴露为 OpenLogos 官方方法论能力。

### P03：已有实现缺少统一的文档真相源
因为仓库早期产物分散在代码、规范、示例和测试中 → 导致 AI 无法快速判断”什么已经完成、下一步该做什么” → 造成阶段判断和交付判断不稳定。

### P04：已有项目无法低摩擦接入 OpenLogos
因为 `openlogos init` 入场路径假设从第零天开始，要求走完 Phase 1→3 全部文档才能进入变更管理模式 → 导致已有代码的用户不知道从哪里开始 → 造成方法论无法落地到存量项目。

进一步地，即使 `openlogos adopt` 用 `bootstrap: adopted` 跳过 Initial 文档门禁，接入**只「跳过」不「填充」**：接入后 `logos/resources/` 仍为空，没有任何 spec 基线。用户想做任何迭代都被推进 change/提案流程，而提案是「在已有基线上打 delta」的机制，此刻**无基线可 diff** → 导致 `merge` 无 spec 目标可打补丁、change-writer（写前向意图）无法承担「从代码逆向出现状」的认知任务、整套系统塞进一个提案粒度爆炸、逆向推断出的现状被误当权威意图基线 → 造成存量项目接入后掉进「空提案」死角。

### P05：部署完成状态依赖 AI 手写 marker
因为 `openlogos verify` 和 `openlogos smoke` 都由 CLI 自动写入对应 PASS/FAIL marker，而部署完成后的 `DEPLOY_DONE` 只能依赖 AI 在 skill 步骤中手写 → 导致部署实际成功后仍可能因为 marker 遗漏而卡在 `ready-to-deploy` → 造成后续 smoke、archive 和状态面板无法继续推进。

### P06：无人值守研发被逐门人工确认阻断
因为受控研发链路把 merge / verify / 部署执行 / smoke / archive 都设成人类确认点 → 导致希望无人值守跑完整链路的用户必须逐门等待人工点击、长流程无法一口气自动跑完 → 造成自动化收益打折；而若简单去掉所有门，又会放行未通过测试的代码，突破安全底线。真正的诉求是"可跳的确认点在受控授权下自动放行，但代码未绿这条红线永不跨越"。

### P07：研发流程不可编排、不可观测、无法接外部门禁
因为内置研发流程的节点固定、完成判定内建、派生状态不外露 → 导致用户无法用 overlay 增删改流程节点、无法把门禁交给外部命令（如 `gh pr checks` / 自定义部署校验脚本）的退出码判定、无法实时观测派生状态供面板 / CI 消费，宿主也拿不到"下一步该用哪个 skill / agent / 脚本"的机器字段 → 造成 OpenLogos 难以嵌入既有 CI 与编排宿主，自动化止步于人工读文本、无法被真正编排。

### P08：大功能一次性实现易失败且难自愈
因为大功能若不拆分、一把梭实现 → 导致切错边界、超预算或测试不绿时缺少逐片收敛路径 → 造成实现频繁返工、无人值守下无法自动修复到"全部切片完成且测试绿"。真正的诉求是"先把已合并规格切成良构切片，再逐片实现并迭代到绿，失败可自愈而非整体推倒"。

## 三、场景总览

28 个场景（编号跳号、最高至 S35，`scenario_counter.next_id=36`）按**能力域**分组如下。各域一行点题，说明它主要回应哪些痛点。

### ① 初始化与存量接入
把空目录或存量代码库低摩擦纳入 OpenLogos 治理（回应 P01/P02/P03/P04）。

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S01 | 初始化 OpenLogos 项目 | 首次在空目录接入 | P01/P02/P03 | P0 |
| S20 | 已有项目接入 OpenLogos | 在已有代码库上首次接入 | P04/P02/P03 | P0 |
| S33 | 存量项目逆向建基线与按需深化 | adopt 接入后自动扫码建种子基线、迭代触碰时按需深化 | P04 | P0 |
| S17 | 管理模块注册表 | 项目分模块演进时 | P03 | P1 |
| S34 | 管理 feature 分组 | 场景增多需按功能域组织、或存量项目需回填 feature | P01/P03 | P1 |

### ② 变更管理生命周期与状态引导
以受控 Delta 流程组织每一次迭代，并随时回答"现在到哪了、下一步做什么"（回应 P01/P03）。

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S09 | 创建、合并、归档变更提案 | 开始一次受控迭代时 | P01/P03 | P0 |
| S14 | 切换到 launched 生命周期 | 首轮交付完成并进入活跃迭代 | P01/P03 | P0 |
| S05 | 查看下一步建议 | 需要快速知道当前该做什么 | P01/P03 | P0 |
| S11 | 查看阶段进度与活跃变更 | 需要确认当前状态 | P03 | P0 |
| S35 | 提案计划产物左移硬检查（change-lint） | 提案产物（proposal/tasks/deltas）产出后交付前 | P01/P06/P07 | P1 |

### ③ 验收与部署门禁
用可追溯的验收报告与部署 / smoke 门禁守住交付质量（回应 P01/P03/P05）。

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S13 | 运行测试验收并生成报告 | 代码实现完成后 | P01/P03 | P0 |
| S19 | 执行部署后 smoke 门禁 | 已部署到目标环境后 | P01/P03 | P0 |
| S21 | 标记部署完成 | 外部部署已成功，需要推进提案状态 | P03/P05 | P0 |

### ④ AI 资产、资源索引与元数据
维护跨工具一致的 AI 指令资产、可发现的资源索引与结构化元数据（回应 P02/P03）。

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S08 | 同步 AI 工具资产与资源索引 | 配置变更后需要刷新 AI 资产 | P02/P03 | P0 |
| S18 | 同步 resource_index | 文档新增或更新后 | P03 | P0 |
| S15 | 处理 SQL 注释规范 | 需要从 SQL 文件中提取元数据时 | P03 | P1 |

### ⑤ flow 编排引擎（自定义 · 观测 · 接外部门禁）
让内置研发流程可被 overlay 改写、可实时观测、可把门禁接到外部命令退出码（回应 P07）。

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S22 | 查看与解析 flow 编排 | 需要查看内置流程或 overlay 解析后的生效流程时 | P07/P03 | P1 |
| S23 | 实时观测派生研发状态（watch） | 需持续盯派生状态、被外部面板/CI 消费时 | P07/P03 | P1 |
| S25 | overlay 驱动 status/next/watch 派生 | 用 overlay 增删改流程节点并据此推进时 | P07 | P1 |
| S26 | cmd: 谓词在 next 求值 | 想让节点完成判定由命令退出码决定时 | P07 | P1 |
| S30 | cmd: 放开到 verify/deploy/smoke gate | 想让 launched 门禁由外部命令 / CI 退出码判定时 | P07 | P1 |

### ⑥ 无人值守自动化（skip-gate · loop · 切片自愈）
在受控授权下让 driver 自动跳过可跳确认点、迭代到测试绿、逐片实现大功能，且绝不放行未绿代码（回应 P06/P08）。

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S24 | next --auto 自动跳过可跳人类确认点 | 需在受控自动化下越过可跳确认点时 | P06 | P1 |
| S27 | flow loop 真迭代（code-verify 迭代到绿） | 把 implement 子流程改为多轮迭代到测试绿时 | P06/P08 | P1 |
| S29 | M2 预留收尾（loop 退出 gate 可覆盖 / fan-out 阈值 / 整组收敛） | 需放行策略、覆盖率判 done 或明确 loop 内收敛语义时 | P06/P08 | P1 |
| S31 | 代码切片循环（逐片实现到全部完成且绿） | 大功能需逐片实现、无人值守自愈到全绿时 | P08/P06 | P1 |
| S32 | 切片规划环节（merge 后划分 [code] 切片） | merge 完成、需把已合并规格拆成良构切片再实现时 | P08 | P1 |

### ⑦ 机器可读契约（JSON 输出 · 宿主编排）
把状态与"下一节点该用什么"暴露成稳定机器字段，供脚本与编排宿主直接消费（回应 P07/P03）。

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S16 | 输出机器可读 JSON | 需要被脚本或工具消费时 | P07/P03 | P1 |
| S28 | next 暴露 next_node 编排提示 | 宿主需把"下一节点用哪个 skill/agent、要不要跑脚本"当机器字段读取并编排时 | P07 | P1 |

## 四、核心场景详述

### S01: 初始化 OpenLogos 项目
- **触发条件**：用户在空目录中准备创建新项目，或需要把现有目录接入 OpenLogos。
- **用户价值**：一次性生成标准目录、配置、AI 指令文件、基础索引、可执行的 verify 预跑配置，以及可直接归档参考资料的分类目录；同时保护用户在根目录 AI 指令文件中的自主配置不被初始化流程覆盖。
- **优先级**：P0
- **主路径**：CLI 检查初始化状态，生成目录结构与基础配置，尽可能补齐 verify 预跑配置，通过 managed block 合并写入 AI 指令文件，并提示后续从需求文档开始。

#### 验收条件
##### 正常：全新项目初始化
- **GIVEN** 当前目录没有 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos init my-project`
- **THEN** 生成 `logos/` 标准目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md` 和 `CLAUDE.md`；若可识别测试栈，还应写入可执行的 `verify.pre_run_command`；`logos/resources/reference/` 下默认生成 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录；根目录 AI 指令文件中的 OpenLogos 内容必须位于 `OPENLOGOS:BEGIN` / `OPENLOGOS:END` 托管片段内；当目标包含 Codex 原生插件时，OpenLogos 方法论技能必须落在 `openlogos` 插件命名空间，项目专属技能不得被初始化流程吸收到 `openlogos` 命名空间；当目标包含 Claude Code 时，OpenLogos 官方插件和 `.claude/skills/` 项目技能边界必须在生成指令中明确。

##### 正常：Codex 初始化生成 OpenLogos repo marketplace 命名空间边界
- **GIVEN** 当前目录没有 `logos/logos.config.json`，且用户选择 `--ai-tool codex` 或 `--ai-tool all`
- **WHEN** 用户执行 `openlogos init`
- **THEN** CLI 生成或维护 Codex repo marketplace 结构，使 OpenLogos 方法论插件使用 `openlogos` 命名空间；若项目已存在 `.agents/skills/<name>/SKILL.md` 之类仓库专属技能，初始化流程不得把这些技能复制进 OpenLogos 插件，也不得使其在 Codex 中显示为 `openlogos:<name>`；生成的指令必须提示项目专属技能应使用项目自己的插件命名空间或明确的 repo-scoped local skill 路径。

##### 正常：Claude Code 初始化不把项目专属 Skill 放入 OpenLogos 插件
- **GIVEN** 当前目录存在项目自定义 `.claude/skills/release-guard/SKILL.md`，且用户选择 `--ai-tool claude-code` 或 `--ai-tool all`
- **WHEN** 用户执行 `openlogos init`
- **THEN** OpenLogos 官方 Claude 插件只包含 OpenLogos 方法论技能；项目自定义技能保留在 `.claude/skills/` 或项目独立 Claude 插件中；生成的 `CLAUDE.md` 不得把项目技能描述为 `/openlogos:*` 能力。

##### 正常：已有用户根指令文件时保留自定义配置
- **GIVEN** 当前目录没有 `logos/logos.config.json`，但已存在 `AGENTS.md` / `CLAUDE.md` 或大小写变体（如 `agents.md` / `claude.md`），且文件包含用户自定义规则
- **WHEN** 用户执行 `openlogos init`
- **THEN** CLI 保留用户原有内容，并追加或刷新 OpenLogos 托管片段；不得整文件覆盖用户内容；不得在大小写敏感文件系统上额外创建重复大小写入口

##### 正常：可识别测试栈时补齐 verify 预跑配置
- **GIVEN** 当前目录存在可识别测试配置或脚本（如 Node/Vitest/Jest、pytest、Go、Cargo）
- **WHEN** 用户执行 `openlogos init`
- **THEN** `logos.config.json` 的 `verify` 配置包含可执行的全量测试预跑命令，确保后续 `openlogos verify` 可先生成完整 `test-results.jsonl`

##### 异常：项目已初始化
- **GIVEN** 当前目录已存在 `logos/logos.config.json`
- **WHEN** 用户再次执行 `openlogos init`
- **THEN** 输出错误并退出，不覆盖已有文件

### S05: 查看下一步建议
- **触发条件**：用户想知道当前阶段最该做什么。
- **用户价值**：减少在阶段之间来回查找的成本，并避免把无需部署的提案误引导到部署流程。
- **优先级**：P0
- **主路径**：CLI 根据资源目录、活动提案、阶段状态和提案级部署决策，输出单一最优建议。

#### 验收条件
##### 正常：未进入变更阶段
- **GIVEN** 项目已初始化但没有活动提案
- **WHEN** 用户执行 `openlogos next`
- **THEN** 输出当前阶段最可执行的下一步建议

##### 正常：已存在活跃变更
- **GIVEN** `logos/.openlogos-guard` 指向一个未归档提案
- **WHEN** 用户执行 `openlogos next`
- **THEN** 输出提案当前步骤与后续动作提示

##### 正常：无需部署提案验收通过
- **GIVEN** 活跃提案 `proposal.md` 声明无需部署，且 `tasks.md` 不存在 `[deploy]` section
- **WHEN** `VERIFY_PASS` 已存在且用户执行 `openlogos next`
- **THEN** 输出下一步为 `openlogos archive <slug>`，不展示部署或 smoke 作为下一步

##### 正常：需要部署提案验收通过（默认/手动）
- **GIVEN** 活跃提案 `proposal.md` 声明需要部署，且 `tasks.md` 存在 `[deploy]` section
- **WHEN** `VERIFY_PASS` 已存在且用户执行 `openlogos next`（无 `--auto`）
- **THEN** 输出部署需要人类明确授权，并提示按部署方案执行部署任务

##### 正常：无人值守 --auto 下部署门自动放行
- **GIVEN** 活跃提案处于 `ready-to-deploy`（deliver 入口门，`skippable:true`）
- **WHEN** 用户执行 `openlogos next --auto`
- **THEN** CLI 视该门为已通过、输出可执行的部署下一步，并向 `GATE_AUTO_PASSED` 追加 `{gate_id:"deliver-entry", proposal_step:"ready-to-deploy", timestamp}`；放行依据为本次响应 `gate_auto_passed=true`，历史审计行不构成后续授权


### S08: 同步 AI 工具资产与资源索引
- **触发条件**：项目配置、AI 工具目标或文档内容变化后需要刷新。
- **用户价值**：让 AI 工具指令、插件、资源索引和 verify 预跑配置保持同步，同时确保用户在根目录 AI 指令文件中的自主配置不会被同步过程覆盖。
- **优先级**：P0
- **主路径**：CLI 同步 `AGENTS.md`、`CLAUDE.md`、插件模板、Skills 与 `resource_index`，并对缺失的 verify 预跑配置进行补齐或诊断；其中根目录 AI 指令文件只能刷新 OpenLogos 托管片段。

#### 验收条件
##### 正常：配置更新后同步
- **GIVEN** `logos.config.json` 或 `logos-project.yaml` 已更新
- **WHEN** 用户执行 `openlogos sync`
- **THEN** 相关 AI 资产与 `resource_index` 被重新生成或补录；`AGENTS.md` / `CLAUDE.md` 仅替换 OpenLogos 托管片段，托管片段外用户内容原样保留；Codex 同步必须保留 OpenLogos 方法论技能与项目专属技能的命名空间边界；Claude Code 同步必须保留 `.claude/skills/` 项目技能和 OpenLogos 官方插件技能的边界。

##### 正常：同步不会把项目专属 Skill 吸入 OpenLogos 命名空间
- **GIVEN** 已初始化项目包含 OpenLogos 官方技能，同时包含用户维护的项目专属 skill
- **WHEN** 用户执行 `openlogos sync`
- **THEN** OpenLogos 只刷新自己托管的插件、hook、指令片段和方法论技能；项目专属 skill 不得被复制到 `plugins/openlogos/`、`.codex-plugin/`、OpenLogos Claude 插件包或任何会形成 `openlogos:<skill>` / `/openlogos:*` 调用语义的位置；若需要分发项目专属 skill，CLI 应保留或提示使用项目自己的插件命名空间。

##### 正常：无 marker 旧文件合并
- **GIVEN** 已初始化项目的 `AGENTS.md` / `CLAUDE.md` 缺少 OpenLogos marker，且包含用户自定义内容
- **WHEN** 用户执行 `openlogos sync`
- **THEN** CLI 不覆盖原文，在文件末尾追加 OpenLogos 托管片段，并输出同步成功结果

##### 正常：旧项目缺失 verify 预跑配置时补齐或提示
- **GIVEN** 已初始化项目缺少 `verify.pre_run_command`、`verify.regression_command` 和 `verify.incremental_command`
- **WHEN** 用户执行 `openlogos sync`
- **THEN** CLI 对可识别测试栈写入默认预跑命令；无法推断时输出明确 TODO，不静默跳过

### S09: 创建、合并、归档变更提案
- **触发条件**：用户需要对已发布项目做受控迭代。
- **用户价值**：把每次变更限定在 proposal/delta/merge/archive 流程中，并在提案级明确是否需要部署；同时让 AI 宿主在已创建 guard 后获得与当前提案阶段一致的写入范围，避免把“提案范围”误解为只能修改 `proposal.md` 单个文件。
- **优先级**：P0
- **主路径**：创建提案、记录部署影响、产出 delta、生成合并指令、合并主规格、按 verify 与部署门禁结果归档提案。

#### 验收条件
##### 正常：创建变更提案
- **GIVEN** 当前没有活动 guard
- **WHEN** 用户执行 `openlogos change baseline-openlogos-docs`
- **THEN** 生成 `proposal.md`、`tasks.md`、`deltas/` 和 guard 文件

##### 正常：提案记录部署决策
- **GIVEN** 用户开始填写变更提案
- **WHEN** AI 或用户完成 `proposal.md` 与 `tasks.md`
- **THEN** `proposal.md` 的 `## 部署影响` 必须记录是否需要部署、是否需要 smoke、部署原因、影响环境和回滚要求

##### 正常：提案资料填写时先完成一致性自检
- **GIVEN** 用户或 AI 正在填写 `proposal.md` 和 `tasks.md`
- **WHEN** `proposal.md` 的 `## 部署影响` 已写入且 `tasks.md` 准备生成
- **THEN** 必须先执行 proposal/tasks 一致性自检；未通过时不得进入 delta-writing，也不得进入下一步建议

##### 正常：部署决策与任务结构一致
- **GIVEN** `proposal.md` 声明无需部署
- **WHEN** 用户查看或推进提案
- **THEN** `tasks.md` 不得包含 `[deploy]` section

##### 正常：AI 宿主 guard 范围随 proposal_step 收敛
- **GIVEN** 项目处于 launched 生命周期且存在 `logos/.openlogos-guard`
- **WHEN** Codex / Claude 等 AI 宿主通过 SessionStart 或等价入口注入 OpenLogos 运行时上下文
- **THEN** 注入文案不得把允许范围固定表述为 `logos/changes/<slug>/proposal.md`；必须按当前 `proposal_step` 表达允许写入范围：`writing` 允许 `proposal.md` 与 `tasks.md`，`ready-to-delta` / `delta-writing` 允许 `deltas/**` 与 `tasks.md`，`ready-to-merge` 只提示明确授权 `openlogos merge <slug>`，`merge-generated` 提示按 `MERGE_PROMPT.md` 合并规格，`coding` 允许按 `[code]` 任务修改代码和测试。

##### 正常：ready-to-delta 不得展示为任务规划失败
- **GIVEN** 活跃提案的 `proposal.md` 与 `tasks.md` 已脱模板，`tasks.md` 含有效 `[delta]` 或 `[deploy]` section，且当前派生 `proposal_step=ready-to-delta`
- **WHEN** 用户、AI driver 或 RunLogos 面板读取 `openlogos status` / `openlogos next` 的文本或 JSON 输出
- **THEN** 必须把该状态展示为“任务规划完成，等待 plan gate 批准或 auto 消费”，不得展示为“任务规划失败”“tasks 未规划完成”或等价失败态
- **AND** `tasks.md` 中 `[delta]` / `[deploy]` checkbox 的 `0/N`、`M/N` 只表示后续 delta/deploy 执行进度，不得作为 proposal/tasks 是否已脱模板或任务规划是否成功的判据
- **AND** `next --auto` 在该状态下若成功消费 `plan-exit`，必须输出可继续派发 `write-delta` 的机器前沿，避免无人值守 driver 停在已经可跳过的 plan gate

##### 异常：部署声明与任务结构冲突
- **GIVEN** `proposal.md` 声明无需部署但 `tasks.md` 存在 `[deploy]` section，或声明需要部署但缺少 `[deploy]` section
- **WHEN** 用户执行 `openlogos status` 或 `openlogos next`
- **THEN** CLI 输出明确警告，并仍以保守策略阻止自动部署

### S11: 查看阶段进度与活跃变更
- **触发条件**：用户需要确认当前完成到哪一步。
- **用户价值**：快速判断文档、测试、提案和部署状态，并让 RunLogos 面板获得一致的按钮门禁依据。
- **优先级**：P0
- **主路径**：CLI 汇总阶段进度、活跃提案、提案级部署决策、部署进度摘要与下一步建议。

#### 验收条件
##### 正常：显示活跃提案部署决策
- **GIVEN** 存在活跃提案
- **WHEN** 用户执行 `openlogos status`
- **THEN** 状态面板基于提案级 `deployment_required` / `smoke_required` 判断下一步，而不是仅基于模块级部署门禁

##### 正常：JSON 输出暴露部署决策
- **GIVEN** 存在活跃提案
- **WHEN** 用户执行 `openlogos status --format json`
- **THEN** `active_change` 中包含 `deployment_required`、`smoke_required`、`deployment_reason`、`deployment_decision_source`、`deployment_progress` 和 `deployment_document`

##### 正常：部署进度摘要只统计 `[deploy]`
- **GIVEN** 活跃提案的 `tasks.md` 同时包含 `[code]` 与 `[deploy]` section
- **WHEN** 用户执行 `openlogos status --format json`
- **THEN** `deployment_progress` 只统计 `[deploy]` section 的勾选项，且 `deployment_document` 指向当前提案的 `tasks.md`

##### 异常：部署决策冲突阻断流程
- **GIVEN** 活跃提案的 `proposal.md` 与 `tasks.md` 部署结论不一致
- **WHEN** 用户执行 `openlogos status`
- **THEN** 状态面板显示冲突警告，`active_change` 包含 `deployment_decision_conflict=true`，并且不把 deploy / smoke 作为主动作

### S13: 运行测试验收并生成报告
- **触发条件**：实现和测试代码完成后需要验收。
- **用户价值**：把测试结果与测试用例规格关联，生成可读报告，并避免局部测试 JSONL 导致的覆盖率误失败；当执行测试命令时，通过沙箱策略降低误写仓库工作区的风险。
- **优先级**：P0
- **主路径**：按配置执行 verify 预跑命令，支持旧的 `pre_run_command` 与新的回归 + 增量两阶段模型；当配置 `verify.sandbox_mode` 时，预跑命令通过沙箱执行器运行，仅回收声明的结果文件；读取合并后的 JSONL 结果和测试用例，计算覆盖度与通过率，写入验收报告。

#### 验收条件
##### 正常：兼容旧的 pre_run_command
- **GIVEN** `logos.config.json` 配置 `verify.pre_run_command`
- **WHEN** 用户执行 `openlogos verify`
- **THEN** CLI 先执行该命令，再读取 `verify.result_path` 中的测试结果

##### 正常：两阶段预跑并合并结果
- **GIVEN** `logos.config.json` 配置 `verify.regression_command` 与 `verify.incremental_command`
- **WHEN** 用户执行 `openlogos verify`
- **THEN** CLI 先执行回归测试，再执行增量测试，并按“同 ID 最后一次结果生效”合并两阶段 JSONL，最终按合并结果计算覆盖度

##### 正常：verify 预跑命令在沙箱中执行
- **GIVEN** `logos.config.json` 配置 `verify.sandbox_mode=auto` 或 `verify.sandbox_mode=always`
- **WHEN** 用户执行 `openlogos verify`
- **THEN** CLI 通过沙箱执行器运行 `pre_run_command` / `regression_command` / `incremental_command`，并在文本与 JSON 输出中展示沙箱模式、根目录、隔离结果和诊断信息

##### 异常：sandbox always 无法隔离
- **GIVEN** `logos.config.json` 配置 `verify.sandbox_mode=always`
- **WHEN** 当前环境无法创建沙箱，或预跑命令尝试写入仓库非白名单路径
- **THEN** `openlogos verify` 失败，输出失败原因、沙箱路径和修复建议，不得伪装为普通测试失败

##### 异常：缺少预跑命令且覆盖不足
- **GIVEN** 项目未配置任何 verify 预跑命令，且 `test-results.jsonl` 覆盖不足
- **WHEN** 用户执行 `openlogos verify`
- **THEN** CLI 输出覆盖不足失败，同时诊断可能只运行了局部测试，并建议配置 `verify.pre_run_command` 或 `verify.regression_command`


### S14: 切换到 launched 生命周期
- **触发条件**：首轮开发完成，项目进入活跃迭代。
- **用户价值**：把流程从首次开发切换到受控变更，并刷新 OpenLogos 变更管理指令，同时保留用户在根目录 AI 指令文件中的自主配置。
- **优先级**：P0
- **主路径**：验证验收与部署门禁后，把模块生命周期标记为 launched，并通过 managed block 合并策略刷新 AI 指令与策略。

#### 验收条件
##### 正常：launch 后保留用户根指令配置
- **GIVEN** 项目满足 launch 门禁，且 `AGENTS.md` / `CLAUDE.md` 已包含用户自定义内容
- **WHEN** 用户执行 `openlogos launch`
- **THEN** 模块生命周期更新为 launched；OpenLogos 托管片段更新为 launched 规则；托管片段外用户内容原样保留

### S15: 处理 SQL 注释规范
- **触发条件**：需要从 SQL 文件提取表和字段注释。
- **用户价值**：让数据库设计能带着注释被工具消费。
- **优先级**：P1
- **主路径**：解析 SQL 文件中的注释标记，输出表和字段元数据。

### S16: 输出机器可读 JSON
- **触发条件**：CI、脚本或其他工具需要消费 CLI 结果。
- **用户价值**：让 `status`、`verify`、`detect` 等命令能被机器稳定解析，并让客户端理解 verify 预跑状态与覆盖不足诊断。
- **优先级**：P1
- **主路径**：CLI 在文本和 JSON 输出之间切换，保持统一 envelope；`verify --format json` 额外输出预跑阶段、命令执行结果、合并策略、诊断和修复建议。

### S17: 管理模块注册表
- **触发条件**：项目需要新增、重命名或移除模块。
- **用户价值**：让多模块项目共享统一索引和阶段判断。
- **优先级**：P1
- **主路径**：修改 `logos-project.yaml` 中的模块注册表并同步跨文件引用。

### S18: 同步 resource_index
- **触发条件**：新增文档或改了文档内容，需要让 AI 再次感知。
- **用户价值**：让资源索引持续反映当前真相源。
- **优先级**：P0
- **主路径**：扫描文档并生成更新建议，补录到 `logos-project.yaml`。

### S19: 执行部署后 smoke 门禁
- **触发条件**：活跃提案已完成部署，且提案级部署决策声明需要 smoke。
- **用户价值**：确认最小可用链路和部署环境可用，同时避免无需部署的提案误进入 smoke；当执行 `smoke.command` 时，通过沙箱策略降低误写仓库工作区的风险。
- **优先级**：P0
- **主路径**：读取提案级 smoke 决策、smoke 用例和结果；当配置 `smoke.sandbox_mode` 且存在 `smoke.command` 时，通过沙箱执行器运行命令，仅回收声明的 smoke 结果文件；生成 smoke 报告并判断是否可继续归档。

#### 验收条件
##### 正常：需要 smoke 时进入 smoke 门禁
- **GIVEN** 活跃提案声明需要部署和 smoke，且部署已完成
- **WHEN** 用户执行 `openlogos status` 或 `openlogos next`
- **THEN** 下一步建议为明确授权执行 `openlogos smoke`

##### 正常：无需 smoke 时直接允许归档
- **GIVEN** 活跃提案声明需要部署但不需要 smoke，且部署已完成
- **WHEN** 用户执行 `openlogos status` 或 `openlogos next`
- **THEN** 下一步建议为 `openlogos archive <slug>`

##### 正常：smoke.command 在沙箱中执行
- **GIVEN** `logos.config.json` 配置 `smoke.command` 与 `smoke.sandbox_mode=auto` 或 `smoke.sandbox_mode=always`
- **WHEN** 用户执行 `openlogos smoke`
- **THEN** CLI 通过沙箱执行器运行 `smoke.command`，并在文本与 JSON 输出中展示沙箱模式、根目录、隔离结果和诊断信息

##### 异常：sandbox always 无法隔离
- **GIVEN** `logos.config.json` 配置 `smoke.sandbox_mode=always`
- **WHEN** 当前环境无法创建沙箱，或 `smoke.command` 尝试写入仓库非白名单路径
- **THEN** `openlogos smoke` 失败，输出失败原因、沙箱路径和修复建议，不得写入通过标记


### S20: 已有项目接入 OpenLogos
- **触发条件**：用户在已有代码库（有 `package.json` / `Cargo.toml` / `pyproject.toml` 或其他项目文件）的目录中首次接入 OpenLogos，且当前目录没有 `logos/logos.config.json`。
- **用户价值**：用户不需要把存量代码当作全新项目从零推进，但仍能一次性获得完整 OpenLogos 基础设施、AI 工具资产、语言策略、verify 预跑配置、推荐沙箱策略、Reference 分类目录和变更管理入口；已有项目的根目录 AI 指令文件配置必须被保留。接入完成后不再掉进「空提案」死角——adopt 确定性初始化时写入模块级枚举 `baseline_seed_state: required`，把后续逆向建种子基线自动衔接到 S33。
- **优先级**：P0
- **主路径**：CLI 检测已有项目信息，交互确认项目名、文档语言与 AI 工具，按 `init` 等价能力生成完整基础设施与 Reference 分类目录；推断并写入 verify 预跑配置或输出 TODO；默认写入兼容的沙箱配置建议；模块写入 `bootstrap: adopted` 与 `lifecycle: launched`，并**写入模块级枚举 `baseline_seed_state: required`**（衔接 S33 逆向建基线）；通过 managed block 合并写入 AI 指令文件，输出接入报告并建议按 S33 建立现状基线。

#### 验收条件
##### 正常：已有项目完整接入
- **GIVEN** 当前目录存在 `package.json`（或其他项目清单文件），且没有 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** CLI 生成与 `init` 同级别的基础设施：`logos/` 标准目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md`、`CLAUDE.md`、`logos/spec/` 和所选 AI tools 的 Skills / 插件 / 命令资产；`logos/resources/reference/` 下默认生成 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录；`logos-project.yaml` 中模块包含 `bootstrap: adopted` 与 `lifecycle: launched`；`logos.config.json` 包含 `verify.result_path`，并在可推断时包含 verify 预跑配置与推荐沙箱配置；输出接入报告

##### 正常：adopt 自动衔接逆向建基线（S33 前置）
- **GIVEN** 当前目录无 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** adopt 在确定性初始化完成时写入 `baseline_seed_state: required`；接入报告说明「下一步将逆向扫描代码库建立现状基线（种子基线，非权威意图）」；adopt 本身**不启动 AI、不声称基线已建立**——逆向扫描由 AI 会话/driver 检测该状态后派发 `brownfield-adopter` 完成（见 S33）；能力缺失时 adopt 输出可复制的后续命令/提示并保持 `baseline_seed_state: required`

##### 正常：接入时保留既有 AI 指令文件
- **GIVEN** 存量项目已有 `AGENTS.md` / `CLAUDE.md` 或大小写变体，且包含用户自定义配置
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** CLI 保留用户自定义配置，并追加或刷新 OpenLogos 托管片段；不得整文件覆盖；不得生成重复大小写入口

##### 正常：语言和 AI 工具选择
- **GIVEN** 用户在无 `logos/` 的存量项目目录中执行 `openlogos adopt`
- **WHEN** 命令进入检测与确认阶段
- **THEN** 用户可以通过交互或 `--locale <en|zh>` 选择文档语言，并通过交互或 `--ai-tool <claude-code|opencode|codex|cursor|other|all>` 选择 AI 工具；生成的 `logos.config.json`、根目录指令文件和 AI 资产必须与选择一致

### S21: 标记部署完成
- **触发条件**：活跃提案已通过 `openlogos verify`，提案声明需要部署，`tasks.md` 存在 `[deploy]` section，且部署动作已由人类明确授权（或无人值守 `--auto` 下经 deliver 门自动放行）并实际完成。
- **用户价值**：把部署完成 marker 从 AI 手写步骤收回到 CLI 受控命令中，避免提案永久停留在 `ready-to-deploy`。
- **优先级**：P0
- **主路径**：用户或 deployment-executor 在部署成功并写入部署报告后执行 `openlogos deploy-done --env <name>`；CLI 校验 guard、`VERIFY_PASS`、部署决策、`[deploy]` section 和部署报告，成功后勾选 `[deploy]` 任务、写入 `DEPLOY_DONE`、清理过期 `SMOKE_PASS/SMOKE_FAIL`，并提示下一步 smoke 或 archive。

#### 验收条件
##### 正常：部署完成后写入受控 marker
- **GIVEN** 活跃提案已存在 `VERIFY_PASS`，`proposal.md` 声明需要部署，`tasks.md` 存在 `[deploy]` section，部署报告已写入
- **WHEN** 用户执行 `openlogos deploy-done --env staging`
- **THEN** CLI 勾选 `[deploy]` section 中的部署任务，写入 `logos/changes/<slug>/DEPLOY_DONE`，并输出下一步建议

##### 正常：部署完成后需要 smoke
- **GIVEN** 提案声明 `是否需要 smoke：是`
- **WHEN** `openlogos deploy-done` 成功
- **THEN** `openlogos status` / `openlogos next` 应进入 `ready-to-smoke`，并提示明确授权运行 `openlogos smoke`

##### 正常：部署完成后无需 smoke
- **GIVEN** 提案声明 `是否需要 smoke：否`
- **WHEN** `openlogos deploy-done` 成功
- **THEN** `openlogos status` / `openlogos next` 应进入 `deploy-done`，并提示可明确授权执行 `openlogos archive <slug>`

##### 正常：重新标记部署完成时清理过期 smoke 结论
- **GIVEN** 活跃提案中存在旧的 `SMOKE_PASS` 或 `SMOKE_FAIL`
- **WHEN** 用户再次执行 `openlogos deploy-done`
- **THEN** CLI 必须清理旧的 smoke marker，避免新部署沿用旧环境的冒烟结论

##### 异常：验收未通过时拒绝落标
- **GIVEN** 活跃提案缺少 `VERIFY_PASS`，或存在 `VERIFY_FAIL`
- **WHEN** 用户执行 `openlogos deploy-done`
- **THEN** CLI 必须失败，不得写入 `DEPLOY_DONE`

##### 异常：部署决策冲突时拒绝落标
- **GIVEN** `proposal.md` 与 `tasks.md` 的 `[deploy]` section 不一致
- **WHEN** 用户执行 `openlogos deploy-done`
- **THEN** CLI 输出冲突原因并失败，不得勾选部署任务或写入 `DEPLOY_DONE`

##### 异常：部署报告缺失时拒绝落标
- **GIVEN** 部署报告 `logos/resources/verify/deployment-report.md` 缺失
- **WHEN** 用户执行 `openlogos deploy-done`
- **THEN** CLI 必须提示先生成部署报告，不得写入 `DEPLOY_DONE`

### S22: 查看与解析 flow 编排
- **触发条件**：用户需要查看 OpenLogos 内置的研发流程模板（initial / launched），或查看项目 overlay 合并后的生效流程，以确认编排是否符合预期。
- **用户价值**：把过去散落在 `PHASE_KEYS` / `ProposalStep` 等硬编码里的研发流程，统一为可声明、可查看、可解析的 flow 文件；用户可在不接触代码的前提下看清"内置基线流程"与"自己 overlay 之后的生效流程"差异，为后续派生（status/next）切换打底。
- **优先级**：P1
- **主路径**：CLI 从**包内** `spec/flow/<lifecycle>.yaml` 读取内置 flow 模板；若项目存在 `logos/flow/<lifecycle>.yaml` overlay，则按 `extends: builtin:<X>@vN` + `skip` / `add` / `modify` / `reorder` 四种操作做 node-id strategic-merge，对 `@vN` 版本不匹配告警并做基础 schema 校验，最终输出 resolved flow。`flow show` 默认展示内置 raw flow，`--resolved` 展示 overlay 合并后的生效流程，`--format json` 输出机器可读结构。
- **切片边界**：本场景**零行为变更**——flow 仅被 `flow show` 消费，**不接入** `status` / `next` 的派生逻辑（派生切换属于后续切片）。

#### 验收条件
##### 正常：查看内置 raw flow（initial 阶段项目，默认推断为 initial）
- **GIVEN** 项目处于 **initial 阶段**（所有模块 lifecycle=initial），包内存在 `spec/flow/initial.yaml`
- **WHEN** 用户执行 `openlogos flow show`（缺省 `--lifecycle` 按项目状态推断）
- **THEN** 输出内置 initial flow 的 subflows / nodes / gates 结构，不应用任何项目 overlay

##### 正常：默认 lifecycle 按项目状态推断（launched 项目默认显示 launched）
- **GIVEN** 项目存在 **launched 模块**，包内存在 `spec/flow/launched.yaml`
- **WHEN** 用户执行 `openlogos flow show`（不传 `--lifecycle`）
- **THEN** 默认展示内置 launched flow（而非 initial）；可用 `--lifecycle initial` 显式覆盖查看 initial

##### 正常：查看 overlay 合并后的 resolved flow
- **GIVEN** 项目存在 `logos/flow/initial.yaml`，其中 `extends: builtin:initial@v1` 且包含 `skip` / `add` / `modify` / `reorder` 操作
- **WHEN** 用户执行 `openlogos flow show --resolved`
- **THEN** 输出基线模板与 overlay 合并后的生效 flow，四种操作按 node id 正确生效

##### 正常：输出机器可读 JSON
- **GIVEN** 项目已初始化
- **WHEN** 用户执行 `openlogos flow show --format json`（可叠加 `--resolved`）
- **THEN** 以通用 JSON envelope 输出，`data` 含 `lifecycle`、`resolved`、`flow`（subflows/nodes/gates）、`overlay_applied`、`builtin_version`、`warnings[]`

##### 异常：内置模板或指定 lifecycle 缺失
- **GIVEN** 包内不存在对应 `spec/flow/<lifecycle>.yaml`，或 `--lifecycle` 取值无法解析
- **WHEN** 用户执行 `openlogos flow show`
- **THEN** 输出 `FLOW_NOT_FOUND` 错误并以非零退出码退出，不输出半成品 flow

##### 异常：overlay schema 非法或版本不匹配
- **GIVEN** `logos/flow/<lifecycle>.yaml` 的 overlay 操作不合法（缺字段、未知 op、target node id 不存在），或 `@vN` 与内置模板内容版本不一致
- **WHEN** 用户执行 `openlogos flow show --resolved`
- **THEN** schema 非法时输出 `FLOW_SCHEMA_INVALID` 错误并退出；版本不匹配时在 `warnings[]` 中给出 `FLOW_VERSION_MISMATCH` 告警（不阻断解析，提示用户复核 overlay 是否仍引用有效 node id）

### S23: 实时观测派生研发状态（watch）
- **触发条件**：用户或外部消费者（RunLogos 面板 / CI dashboard）需要持续观察 OpenLogos 派生研发状态，而不必反复手动执行 `openlogos status`。
- **用户价值**：把 `status` 的一次性快照变成实时流——一旦派生状态发生变化即被推送，便于盯进度、驱动外部面板和自动化触发器。
- **优先级**：P1
- **主路径**：CLI 启动 `openlogos watch` 后轮询 `collectStatusData`（`status` 同一派生数据源）；**启动先输出一次初始快照**，之后**仅在派生数据发生变化时**输出；每条输出携带事件序号 `seq` 与 `timestamp`；变化判定为相邻两次派生 `data` 的深比较；继承 `--module` 过滤；`--interval` 默认 2 秒；Ctrl-C / SIGINT 优雅退出。watch **只读**，不写任何文件、不推进任何状态。

#### 验收条件
##### 正常：启动先输出一次初始快照
- **GIVEN** 项目已初始化
- **WHEN** 用户执行 `openlogos watch`
- **THEN** 命令启动后立即输出一次当前派生状态（初始快照），无需等到下一次变化

##### 正常：仅在派生状态变化时输出
- **GIVEN** `openlogos watch` 正在运行且已输出初始快照
- **WHEN** 派生状态在两次轮询之间未发生变化
- **THEN** 不产生新的输出；只有当相邻两次 `collectStatusData` 的 `data` 深比较不相等时才输出新的一条

##### 正常：每条输出携带 seq 与 timestamp
- **GIVEN** `openlogos watch --format json` 正在运行
- **WHEN** 输出初始快照或后续变化事件
- **THEN** 每条 JSON 输出都包含递增的事件序号 `seq` 与 `timestamp`，`data` 与 `openlogos status` 的 `data` 同构

##### 正常：继承 --module 过滤
- **GIVEN** 多模块项目
- **WHEN** 用户执行 `openlogos watch --module core`
- **THEN** 派生与变化判定仅针对该模块，输出与 `openlogos status --module core` 的派生数据一致

##### 正常：Ctrl-C 优雅退出且只读无副作用
- **GIVEN** `openlogos watch` 正在运行
- **WHEN** 用户按 Ctrl-C（SIGINT）
- **THEN** 命令优雅退出、以约定退出码结束；整个运行期间不写入任何文件、不修改任何提案或派生状态

##### 异常：项目未初始化
- **GIVEN** 当前目录没有 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos watch`
- **THEN** 输出 `PROJECT_NOT_INITIALIZED` 错误并以非零退出码退出，不进入轮询循环

### S24: next --auto 自动跳过可跳人类确认点（skip-gate）
- **触发条件**：在受控自动化（无人值守 / yolo）场景下，用户希望 `openlogos next --auto` 把流程一路自动推进——既越过被声明为可跳的人类确认点，也无人值守地完成代码已绿之后的盖章 / 发布动作。
- **用户价值**：让流程在全自动模式下从方案审批一路跑到 `archive` + `git push`，不在每个可跳确认点或每个发布红线停顿；同时通过审计留痕与保留的未收敛硬红线保证可追溯、只发布已验证成果。
- **优先级**：P1
- **半 / 全自动两档定义**：
  - **半自动（无 `--auto`）= 手动 / 默认**：所有人类确认点行为**完全不变**，逐门、逐红线人工确认（与未引入本能力时一字不差）。
  - **全自动（`--auto`）= 无人值守 / standing run-scoped 授权**：用户选择 `--auto` 即**一次性授权该提案的全链路自动跑到底**。这一档同时放行两类停顿：（1）4 道可跳 flow 门——plan 出口（`ready-to-delta`）、spec 出口（`ready-to-merge`）、slice 出口（`ready-to-implement`）、deliver 入口（`ready-to-deploy`），均 `skippable:true`；（2）代码**已绿之后**的 4 样「盖章 / 发布」红线步骤——`verify`、`smoke`、`archive`、`git push`。
- **保留的硬红线（任何模式、含 `--auto` 都不放行）**：`gate:implement:loop-exhausted`（达迭代上限仍未过测试的**未收敛代码**）。`--auto` 照常阻塞，绝不自动放行未通过测试的代码；现有默认 `skippable:false` + overlay 单点 opt-in 逻辑一字不改。这是「全自动发布的是**已验证**成果」这一前提的守门人。
- **主路径**：用户执行 `openlogos next --auto`；CLI 取当前停顿步对应的 launched flow gate——若其 `skippable:true` 则视为已通过、放行并向活跃提案目录的 `GATE_AUTO_PASSED` JSONL **追加一行** `{gate_id, proposal_step, timestamp}`（append-only、非状态源）。`verify` / `smoke` / `archive` 由 AI 宿主在 `--auto` 的 standing 授权下亲自调用；`git push` **无需任何 marker / guard 改动**——`plugin/bin/guard-check` 的安全白名单本就含 `^git push`、PreToolUse guard 从不拦截 `git push`，全自动下它是否执行纯由生成进 AGENTS.md / CLAUDE.md 的指令文本授权；`loop-exhausted` 门 `skippable:false` 时保持人类停顿。R2 安全闸（仍卡在未完成 overlay 节点则不放行）不变。

> **gate 范围（对照 `spec/flow/launched.yaml`）**：
> - **plan 出口 gate（`human`, `skippable:true`）→ 对应 `ready-to-delta`（gate_id `plan-exit`）**：auto 下放行（仅审计、不推进状态）。
> - **spec 出口 gate（`human`, `skippable:true`）→ 对应 `ready-to-merge`（gate_id `spec-exit`，由原 propose 出口改）**：auto 下放行。
> - **slice 出口 gate（`human`, `skippable:true`）→ 对应 `ready-to-implement`（gate_id `slice-exit`，批准 merge 后由 slice-planner 划定的 `[code]` 切片）**：auto 下放行（仅审计、不推进状态——切片划定后仍需宿主逐片实现）。
> - **deliver 入口 gate（`human`, `position:entry`, `skippable:true`）→ 对应 `ready-to-deploy`（gate_id `deliver-entry`）**：auto 下**放行**（部署目标可能是测试环境；放行依据为本次响应 `gate_auto_passed=true`，历史审计行不构成授权）。
> - **`gate:implement:loop-exhausted`（`skippable:false`，默认）**：达上限退出门，auto 下**仍卡住**（守住未收敛大功能；除非 overlay 显式覆盖 `exhausted_gate.skippable`）。这是任何模式都不放行的硬红线。
> - **`verify` / `smoke` / `archive` / `git push`**：均**无对应可跳 flow gate**，不经 skip-gate 机制；它们是代码已绿之后的「盖章 / 发布」红线步骤，由全自动 `--auto` 的 **standing run-scoped 授权**放行（`verify` / `smoke` / `archive` 由宿主自动调用，`git push` 由 guard 安全白名单本就放行、全自动下纯由指令文本授权）。半自动（无 `--auto`）下这 4 样仍逐一人工确认。

#### 验收条件
##### 正常：可跳 gate 在 auto 下放行并留痕
- **GIVEN** 活跃提案处于 `ready-to-delta`（plan 出口门）、`ready-to-merge`（spec 出口门）、`ready-to-implement`（slice 出口门）或 `ready-to-deploy`（deliver 入口门），均 `skippable:true`
- **WHEN** 用户执行 `openlogos next --auto`
- **THEN** CLI 视该 gate 为已通过、输出合并后的下一动作建议，并向 `GATE_AUTO_PASSED` JSONL 追加一行 `{gate_id, proposal_step, timestamp}`

##### 正常：plan 门 auto 放行仅审计不推进状态
- **GIVEN** 活跃提案处于 `ready-to-delta`
- **WHEN** 用户执行 `openlogos next --auto`
- **THEN** 追加 `{gate_id:"plan-exit", proposal_step:"ready-to-delta", timestamp}`；状态不因审计行前移，仅在首个 delta 产出后进入 `delta-writing`

##### 正常：slice 门 auto 放行仅审计不推进状态
- **GIVEN** 活跃提案处于 `ready-to-implement`（slice 出口门，`[code]` 切片已由 slice-planner 划定）
- **WHEN** 用户执行 `openlogos next --auto`
- **THEN** 追加 `{gate_id:"slice-exit", proposal_step:"ready-to-implement", timestamp}`；状态不因审计行前移，仅在首个 `[code]` 切片实现并使 implement code 节点推进后进入 `coding`

##### 正常：全自动 --auto 一路到底自动执行 verify / smoke / archive / git push
- **GIVEN** 活跃提案在 `--auto`（全自动 / 无人值守 = standing run-scoped 授权）下推进，且代码已通过测试（无 `loop-exhausted`）
- **WHEN** 流程依次到达 `verify`、`smoke`、`archive` 与 archive 后的 `git push`
- **THEN** AI 宿主在 standing 授权下自动调用 `openlogos verify` / `openlogos smoke` / `openlogos archive`，无需逐步人类授权；`git push` 由 PreToolUse guard 安全白名单本就放行、全自动下纯由指令文本授权（无需 marker / guard 改动）；每次可跳门放行向 `GATE_AUTO_PASSED` 追加审计行

##### 正常：半自动（无 --auto）维持逐门 / 逐红线人工确认
- **GIVEN** 用户执行不带 `--auto` 的命令链
- **WHEN** 流程到达任一可跳门或 `verify` / `smoke` / `archive` / `git push` 红线步骤
- **THEN** CLI 行为与未引入本能力时**完全一致**：每个人类确认点都要人工授权；`git push` 仍是人类确认点，约束来自指令文本（半自动下生成的指令文本不含 `--auto` 例外，宿主须等人类明确授权），guard 行为不变、不涉及任何 marker

##### 正常：loop-exhausted 不在全自动放行内（硬红线保留）
- **GIVEN** 活跃提案的 implement loop 达 `max_iters` 仍未收敛（`gate:implement:loop-exhausted`，默认 `skippable:false`）
- **WHEN** 用户执行 `openlogos next --auto`
- **THEN** CLI 仍保持停顿、不放行、不写 `GATE_AUTO_PASSED`（除非 overlay 显式 `exhausted_gate.skippable:true`）——绝不自动发布未通过测试的代码

##### 正常：重复 --auto 总是追加审计行
- **GIVEN** 同一可跳 gate 已被 `--auto` 放行并写过一行审计
- **WHEN** 用户再次对同一停顿点执行 `openlogos next --auto`
- **THEN** `GATE_AUTO_PASSED` JSONL **再追加一行**（不去重、不覆盖）；派生结论不受影响、可安全重跑

##### 正常：默认 next 忽略 GATE_AUTO_PASSED
- **GIVEN** 活跃提案目录已存在 `GATE_AUTO_PASSED` 审计文件，且提案仍处于某个可跳 gate
- **WHEN** 用户执行 `openlogos next`（无 `--auto`）
- **THEN** 输出与未引入 `--auto` 时一致，绝不因 `GATE_AUTO_PASSED` 存在而自动越过 gate

##### 正常：smoke 在全自动下自动运行、在半自动下维持人工授权
- **GIVEN** 活跃提案处于 `ready-to-smoke`（`smoke` 节点无对应可跳 flow gate）
- **WHEN** 用户在全自动 `--auto` 下推进 / 或在半自动（无 `--auto`）下推进
- **THEN** 全自动下 AI 宿主在 standing 授权下自动调用 `openlogos smoke`（不经 skip-gate、不写 `gate_id`）；半自动下输出与默认 `next` 一致（提示明确授权运行 `openlogos smoke`），不自动运行

### S25: overlay 驱动 status/next/watch 派生

- **触发条件**：用户在 `logos/flow/<lifecycle>.yaml` 用 overlay（`skip`/`add`/`modify`/`reorder`）裁剪/扩展内置研发流程后，
  希望 `status` / `next` / `watch` **按裁剪后的流程推进**，而不只是在 `flow show --resolved` 看到结果。
- **价值**：把「可编排」从「可查看」兑现到「可驱动」——是 `cmd:` 谓词（S26）及一切 overlay 自定义节点进入派生的前置。
- **范围边界（按 lifecycle）**：
  - **initial**：overlay 四操作（skip/modify/reorder/add）全部驱动 status/next/watch。
  - **launched**：仅 `add` / `modify` 生效；**builtin `skip` / `reorder` 本切片不生效**（launched 派生 marker 驱动、非 order 驱动），
    派生入口 fail loud（`FLOW_SCHEMA_INVALID`）。其中 `modify` 对**经 flow 读取的 marker 名**生效；
    `section_complete:*` 的 tag 仍由代码侧固定读取，本切片不承诺经 modify 覆盖。
  - overlay-added 节点经 node 级视图（`overlay_nodes` / `current_node`）承载；**无 overlay 时派生逐字节不变**（golden 零漂移）。
  - 不含 `cmd:` 谓词、loop 真迭代（属后续切片）。
- **验收要点**：overlay 四操作经 status/next（不止 flow show）按 lifecycle 边界生效；launched builtin skip/reorder 报错；
  无 overlay 项目 status/next/watch 与内置派生等价。

### S26: cmd: 谓词在 next 求值

- **触发条件**：用户给 overlay-add 节点写 `done_when: "cmd:npm test"`（或 `cmd:gh pr checks`），希望节点完成判定由命令退出码决定，把研发流程接到既有 CI/测试。
- **价值**：flow 节点首次具备「以外部命令为完成信号」的能力，为 M2 切片 2（loop→测试绿收敛）与「嵌入 CI/PR」打底。
- **范围边界（决策 A/B）**：`cmd:` **仅 overlay-add 节点**可用（builtin 经 modify 改 cmd: → 报错）；**禁止同节点 done_when 与 fail_when 均为 cmd:**。
- **执行语义**：**仅 `next` 执行命令**（shell 执行、cwd=项目根、两级可配超时 ≥1s、exit 0=done、非 0/超时=未 done、捕获 stdout/stderr 不外泄、信任委托宿主）；
  `status`/`watch` **不执行**、该节点显示 `pending`。求值**瞬态不持久化**（不写 marker，下次 next 重新求值）；**每次 next 至多执行 1 个 cmd**。
- **验收要点**：next 对 cmd 节点 exit 0→done 续推、非 0/超时→保持 active 并带结果字段；命令不存在=非 0（非 spawn 失败）、shell 起不来=`FLOW_CMD_SPAWN_FAILED`；status/watch 显示 pending 不执行；内置零 cmd→golden 零漂移。

### S27: flow loop 真迭代（code-verify 迭代到测试绿）
- **触发条件**：implement（code/verify）子流程以 loop 推进——`next` / `status` / `watch` 把它派生为「真迭代」（按「第 N/M 轮是否达成收敛、是否达上限升级人类确认点」推进），而非 verify 一次失败即停的退化环。
- **价值**：把一次性 gate（verify 失败即停）升级为现代 agentic loop（generate → verify → fix 迭代到收敛，actor-critic 结构）。严格 **A 被动派生**——OpenLogos 只派生「第几轮 / 是否收敛 / 是否升级 gate」并据此给措辞，**不自驱动跑测试**。
- **激活来源（change-flow-redesign 起）**：① overlay `set-loop`（`max_iters>1`）；② **builtin `launched.yaml` 的 `implement` 默认 `max_iters:30` + `until:code_slices_green`，即默认激活切片循环**（详见 S31）。其它 builtin（`initial.yaml` implement）保持 `max_iters:1`。`until` 枚举为 `tests_green | code_slices_green`。
- **迭代计数来源**：loop 激活时，`openlogos verify` 在算出 gate 结果后追加一行 `LOOP_ITERS` 账本（`{iter, node:"verify", result, module, timestamp}`，append-only）；`iteration` = 该账本按当前 module 过滤后的行数，`converged` 按 `until` 判定，`escalated` = `iteration >= max_iters && !converged`。
- **范围边界**：
  - `until: tests_green` → `converged` = 末行 `result == "pass"`；`until: code_slices_green` → `converged` = `section_complete:code ∧ tests_green`（见 S31）。
  - **达上限升级 = loop 退出 human gate**：`escalated` 时派生为 `gate:implement:loop-exhausted`，`skippable` 默认 `false`、可经 overlay `set-loop` 的 `exhausted_gate.skippable` 覆盖（S29）。
  - **达上限不新增 `proposal_step` 枚举**：launched loop 未收敛时 `proposal_step` 仍为既有值；「是否达上限」只由 `loop_state.escalated` + `next --auto` 的 `gate_id`/`skippable` 表达。
  - **initial 多模块** 即便写了 `max_iters > 1` 也**不激活**（verify 项目级单次、无法归属到某模块的 loop）。
- **验收要点**：
  - 未收敛且未达上限：`next` 输出「loop 第 `iteration`/`max_iters` 轮未达成 → 修复后重跑 `openlogos verify`（继续迭代）」，当前钉在 implement 内 verify、不推进。
  - 达上限：`escalated:true`，`next` 升级人类确认点，`next --auto` 默认仍阻塞（除非 overlay 覆盖 `exhausted_gate.skippable`）。
  - 收敛出环：续推到下一节点。
  - **未收敛不得推进**：loop 激活且 `!converged` 时，verify/implement 视为未完成，所有判定入口由 `loop_state.converged` 覆盖。
  - **status / watch 只读展示** `loop_state`，不执行测试、不写账本、不推进。

### S28: next 暴露 next_node 编排提示

- **触发条件**：宿主（RunLogos 面板 / CI / 编排器）希望 `openlogos next` 不仅给出散文动作建议，还能把「本次最终建议处理的那个 flow 节点」的编排提示（用哪个 skill、派哪个 working/review agent、要不要跑 pre/post script）当作**机器可读字段**直接消费，从而真正照「乐谱」编排，而不必回去读 `CLAUDE.md` 的 Phase→skill 散文映射。
- **价值**：把「判定逻辑从 CLAUDE.md 散文搬进声明式模型」与「next 吐出下一节点 + 用哪个 skill」兑现到机器字段——OpenLogos 当「乐谱 + 指挥」，宿主据声明真正派发 skill/agent、决定是否执行 script。严格 **A 被动派生**——OpenLogos 只声明、不解释、不校验、不驱动、不执行；如何映射到真实 agent、是否执行 script 由宿主权限模式决定（与既有信任边界一致）。
- **优先级**：P1
- **范围边界**：
  - **仅 `next` 暴露 `next_node`**；`status` / `watch` 本切片不动（守其 golden，是否镜像留后续切片）。
  - `next_node` = 取自 **resolved flow（含 overlay）** 的「本次 `next` 响应**最终建议处理的真实 flow 节点**」的 hints，**默认 = 当前前沿节点**；R3/R4/R5/R7 是对该默认的例外（见验收要点）。
  - 字段为不透明标签：`id`/`name`/`subflow_id` 为 `string`；`skill`/`working_agent`/`review_agent`/`pre_script`/`post_script` 为 `string | null`（固定存在、用 `null` 表示无绑定，如 verify/deploy/smoke 的 `skill` 为 `null`）。挂载与 `current_node`/`loop_state` 同构（有 `modules[]`→`modules[].next_node`，legacy→顶层）；无当前真实节点时省略 `next_node`。
  - 本切片**有意**为 `next` 新增输出字段并**重新 baseline** golden 快照——强约束唯一漂移就是 `next_node`，无其它字段回归。
- **验收要点**：
  - **builtin 当前节点输出 hints**：next 取最终建议处理节点（initial 经 `current_phase`→node、launched 经 `proposal_step`→node、overlay-add 经 `current_node`），并从 resolved flow 透出 `next_node` 的 `id`/`name`/`subflow_id`/`skill`/`working_agent`/`review_agent`/`pre_script`/`post_script`。
  - **overlay modify 重绑 agent 如实反映**：overlay `modify code set:{review_agent: my-reviewer}` 后，`next_node.review_agent == "my-reviewer"`（overlay 重绑 agent 是关键价值）；overlay-add 节点输出其自身 hints。
  - **【R3】与 cmd 瞬态求值的关系**：`next_node` 指向本次响应最终建议处理的节点——cmd done(exit 0)续推→指向续推后落到的节点（**不**指向已 done 的 cmd 节点）；cmd 失败/超时→指向该 cmd 节点（需重跑）；budget=1 遇第二个 cmd→指向第二个 pending cmd 节点。
  - **【R4】与 `--auto` auto-pass 的关系**：`gate_auto_passed === true`（gate 已自动放行）→**省略 `next_node`**（放行后宿主应走 gate 的 command，待放行落地后重新 next 派生）；非放行的 `--auto` 与无 `--auto` 时按前沿正常输出。
  - **【R7】与 loop 阻塞态的关系**：loop 阻塞、未达上限（继续迭代）→`next_node` = loop 工作节点（对齐 action「修代码」而非「跑 verify」）：overlay-add `current_node` 仍优先；否则取 resolved flow 中 `id == "code"` 且未 `skipped` 的节点（兼容 reorder）；`code` 缺失/被 overlay skip→**省略**（仅 initial 等合法 resolved flow；launched builtin skip 在 S25 派生入口已 `FLOW_SCHEMA_INVALID`，走不到此省略）。loop 达上限（`escalated` → human gate）→**省略**（同 R4，人类确认点无可派发节点）。与 `loop_state` 并存互补。
  - **【R5】缺省规则**：`next_node` 仅当当前建议指向一个真实 flow 节点时输出；命令级建议一律省略——`all_done`、launched 无 active proposal（建议 `openlogos change <slug>`）、adopted 补 baseline 文档（建议 `openlogos change add-baseline-docs`）、`openlogos launch` 等命令级提示、`--auto` gate 已放行。
  - **范围与 golden**：`status` / `watch` 输出不变；`next` 对有当前节点的项目新增 `next_node`，在干净基线上重新 baseline 并逐项复核 diff，确认唯一变化是新增 `next_node`，无其它字段漂移。

### S29: M2 预留收尾（loop 退出 gate 可覆盖 / fan-out 覆盖阈值 / loop 内 fan-out 整组收敛）

- **触发条件**：M2 编排能力已基本成型，用户需要在 overlay 中一次性收掉三个轻量子能力：（A）在受控无人值守下，让 loop 达上限仍未收敛时也能放行；（B）让 fan-out 节点按「覆盖率达阈值」而非「100% 全覆盖」判定 done；（C）当 loop 子流程内含 fan-out 节点时，明确其收敛语义。
- **用户价值**：把 M2 留下的三个语义缺口一次性补齐——loop 退出 gate 的 `skippable` 可被 overlay 覆盖以支持高危无人值守、fan-out 支持覆盖率阈值以适配增量交付、loop 内 fan-out 收敛语义定死为「整组收敛」消除歧义；三项全部 opt-in，对内置模板零侵入。
- **优先级**：P1
- **范围边界**：
  - 三项子能力（A/B/C）全部 **opt-in**：仅当 overlay 显式声明对应字段时生效；builtin `initial.yaml` / `launched.yaml` 模板**零变更** → status/next/watch/flow show 的 golden 快照逐字节不变。
  - **A·loop 退出 gate 的 `skippable` 可 overlay 覆盖**：overlay `set-loop` 的 `set` 白名单在 `max_iters` / `until` 之外新增 `exhausted_gate:{skippable:boolean}`（默认 `false`）；`loop_state` 新增派生字段 `exhausted_skippable`。这是**高危 opt-in**（无人值守放行未通过测试的代码），必须由用户显式声明；OpenLogos **只声明、不执行**——是否真正放行、由谁授权，仍由宿主权限模式决定（严格 A 被动派生，与既有信任边界一致）。
  - **B·fan-out 聚合阈值 `coverage_threshold`**：fan-out 节点新增可选字段 `coverage_threshold`（float，取值 `0 < x <= 1`），**仅对 `done_when: all_present` 的 fan-out 节点有效**；缺省（不写）等价于既有 `all_present` 语义（阈值 1.0，要求 100% 覆盖）。
  - **C·loop 内 fan-out 收敛语义 = 整组收敛**：loop（implement）内含 fan-out 时采用「整组收敛」语义——收敛裁判仍为测试绿（`until: tests_green`），fan-out 节点本身按各自的 `all_present` / `coverage_threshold` 独立完成；**不引入 per-instance（单实例）迭代**、不新增任何字段。
- **主路径**：用户在 `logos/flow/<lifecycle>.yaml` 的 overlay 中按需声明 `exhausted_gate.skippable` 与/或 fan-out 的 `coverage_threshold`；CLI 在解析 overlay 时对新增字段做 schema 校验，并在 `next` / `status` / `watch` 的派生中按上述语义生效（A 影响 `next --auto` 在 escalated 时是否放行、B 影响 fan-out 节点 done 判定、C 固定 loop 内 fan-out 的收敛裁判）。

#### 验收条件
##### 正常：A·overlay 声明 exhausted_gate.skippable 后 next --auto 在 escalated 时放行
- **GIVEN** overlay `set-loop` 写入 `exhausted_gate:{skippable:true}`，loop 已达上限（`escalated`）且仍未收敛
- **WHEN** 用户执行 `openlogos next --auto`
- **THEN** CLI 自动放行未收敛代码：派生 gate `skippable:true`、`gate_auto_passed:true`，向活跃提案目录 `GATE_AUTO_PASSED` 追加一行，并输出 proceed 下一动作建议

##### 正常：A·默认（不写 exhausted_gate）仍固定阻塞
- **GIVEN** overlay 未声明 `exhausted_gate.skippable`（默认 `false`），loop 已达上限（`escalated`）
- **WHEN** 用户执行 `openlogos next --auto`
- **THEN** CLI 照常阻塞、不 auto-pass、不写 `GATE_AUTO_PASSED`（与 S27 行为一致）

##### 异常：A·set 出现非法 key 或 skippable 非布尔
- **GIVEN** overlay `set-loop` 的 `set` 出现非白名单 key，或 `exhausted_gate.skippable` 取值非布尔
- **WHEN** 用户执行 `openlogos flow show --resolved` 或触发派生入口
- **THEN** 输出 `FLOW_SCHEMA_INVALID` 错误并退出，不静默保留、不进 resolved flow

##### 正常：A·未写 exhausted_gate 时 loop_state 省略 exhausted_skippable（保真零漂移）
- **GIVEN** 项目 loop 已激活（`max_iters>1`）但**未经 overlay 声明 `exhausted_gate`**
- **WHEN** 派生 `loop_state`
- **THEN** `loop_state` **不含 `exhausted_skippable` 键**（消费方按 `false` 处理），既有 S27 激活-loop 的 `loop_state` JSON 逐字节不变；builtin/未激活 loop 则整个 `loop_state` 省略

##### 正常：B·coverage_threshold 达阈值即判 fan-out done
- **GIVEN** fan-out 节点（`done_when: all_present`）写入 `coverage_threshold:0.9`，且 `covered/total >= 0.9`
- **WHEN** 用户执行 `openlogos status` / `openlogos next` / `openlogos watch`
- **THEN** 该 fan-out 节点判定为 done；其中 `total == 0` 维持现状（视为未 done）

##### 正常：B·缺省 coverage_threshold 等价 all_present
- **GIVEN** fan-out 节点未写 `coverage_threshold`
- **WHEN** 用户触发派生
- **THEN** 该节点按既有 `all_present`（阈值 1.0，100% 覆盖）语义判定 done，与未引入本字段时一致

##### 异常：B·非法 coverage_threshold（取值非法 或 挂载非法）
- **GIVEN** `coverage_threshold` 取值非 float / 不在 `0 < x <= 1` 区间，**或** 被设在非 `done_when: all_present`、无 `for_each`（非 fan-out）的节点上
- **WHEN** 用户执行 `openlogos flow show --resolved` 或触发派生入口
- **THEN** 输出 `FLOW_SCHEMA_INVALID` 错误并退出（fail loud，不静默忽略、不告警）

##### 正常：C·loop 内 fan-out 按整组收敛
- **GIVEN** loop（implement）子流程内含 fan-out 节点
- **WHEN** 用户触发派生与迭代推进
- **THEN** 收敛裁判为测试绿（`until: tests_green`），fan-out 节点按各自 `all_present` / `coverage_threshold` 独立完成；不做单实例（per-instance）迭代、不新增字段

##### 正常：golden 零漂移
- **GIVEN** A/B/C 三项均为 opt-in 且 builtin 模板未改动（无 overlay 声明对应字段）
- **WHEN** 用户执行 `openlogos status` / `openlogos next` / `openlogos watch` / `openlogos flow show`
- **THEN** 输出逐字节不变，与引入 S29 之前的 golden 快照完全一致

### S30: cmd: 谓词放开到 launched verify/deploy/smoke gate（接外部门禁/CI）

- **触发条件**：项目已 launched，用户希望把 verify / deploy / smoke 三个门禁接到既有 CI / PR 检查或自定义校验脚本上——用 overlay `modify` 把这些 gate 的完成/失败判定从 OpenLogos 内部 marker 改为「外部命令退出码」（`cmd:<command>`），从而把研发流程嵌入既有 CI/PR。
- **用户价值**：把 `cmd:` 谓词从「仅 overlay-add 节点」放开到 launched 的 `verify` / `deploy` / `smoke` 三个真正适合「接外部门禁」的 gate，使门禁可由 `gh pr checks`、部署校验脚本等外部命令的退出码驱动；语义为 live 重评、瞬态不写 marker，状态机不被破坏，且对内置模板零侵入（无 overlay 项目逐字节不变）。
- **优先级**：P1
- **范围边界**：
  - **A·仅放开三个 launched gate（精确 `(节点, 字段)` 白名单）**：overlay `modify` 可把 `verify.done_when` / `verify.fail_when` / `smoke.done_when` / `smoke.fail_when` / `deploy.done_when` 改为 `cmd:<command>`。其它任意 `(节点, 字段)` 改 `cmd:` → `FLOW_SCHEMA_INVALID`。特别地：`deploy.fail_when` 改 `cmd:` → `FLOW_SCHEMA_INVALID`（deploy builtin 无 `fail_when`，本切片不为其引入 `fail_when:cmd`）；initial 全部节点与 launched 的 `write-proposal` / `write-delta` / `generate-merge-prompt` / `apply-merge` / `code` / `archive` 等内部状态节点改 `done_when` / `fail_when` 到 `cmd:` → `FLOW_SCHEMA_INVALID`（它们承载 OpenLogos 内部状态，cmd: 无意义）。
  - **决策 B·禁止同节点双 cmd:**：沿用 S26 决策 B，同一 gate 节点 `done_when` 与 `fail_when` 不得均为 `cmd:` → `FLOW_SCHEMA_INVALID`（仅 verify / smoke 适用）；混合（一 cmd 一 marker）按字段独立求值。空命令（`cmd:` 后无内容）→ `FLOW_SCHEMA_INVALID`。
  - **per-field 独立求值 + frontier（B3）**：一个 gate 节点的 `done_when` / `fail_when` 各自按谓词类型独立判定，`fail_when` 优先于 `done_when` 不变。非 cmd 字段（marker: 等）先解析（`fail` 命中 → failed；否则 `done` 命中 → done），status/watch/next 一致、与今天逐字节相同；仅当节点未被非 cmd 字段解析、且尚有未求值的 cmd 字段时，才在 status/watch 判 `pending`（cmd 字段在 status/watch 视为 unknown、不执行）。`next` 仅对前沿（pending）节点求值其 cmd 字段——已被非 cmd 字段解析为 done/failed 的节点非前沿，next 不为其跑命令。
  - **next 求值（live 重评、不写 marker）**：`next` 求值 cmd 字段（budget=1，与 S26 overlay-add cmd 共享预算，按 flow 顺序先到先求值）——`done_when:cmd` exit 0 → 本次过门推进（瞬态）；`fail_when:cmd` exit 0 → 本次瞬态 failed（非推进，verify→`verify-failed` / smoke→`smoke-failed`）；非 0 / 超时 → 停在门前（不崩溃）。`next` 对 cmd 字段求值不写任何 marker（cmd 字段瞬态、每次重评）；现有 `openlogos verify` / `deploy-done` / `smoke` 命令的 marker 写入行为完全不变（仍照常写各自 marker，只在仍为 marker: 谓词的字段上参与判定）。
  - **F·与 loop 正交**：禁止「激活 loop（implement 的 `set-loop max_iters>1`）+ `verify` 的 `done_when` 或 `fail_when` 任一为 `cmd:`」并存 → `FLOW_SCHEMA_INVALID`（resolved 校验时即报）。`deploy` / `smoke` 在 deliver 子流程、无 loop，无此冲突。
  - cmd 执行语义整体复用 S26（shell 执行、cwd=项目根、两级可配超时、exit 0=命中、命令输出不进契约、信任边界委托宿主）。
- **主路径**：用户在 `logos/flow/<lifecycle>.yaml` 的 overlay 中用 `modify` 把 verify / deploy / smoke 的对应字段改为 `cmd:<command>`；CLI 解析 overlay 时按精确 `(节点, 字段)` 白名单 + 决策 B + loop 正交做 schema 校验（非法即 `FLOW_SCHEMA_INVALID`）；检测层（`extractLaunchedMarkers` / `detectProposalStepViaFlow`）改为 cmd-aware——对 cmd gate 不抽 marker 名而标记为 cmd gate；`status` / `watch` 不执行 cmd、按 frontier 把未解析的 cmd gate 显示为 `pending`（停门前）并输出机器契约 `cmd_gate`；`next` 仅对前沿 cmd gate 求值（budget=1）并据退出码合成本次瞬态门后态，不写 marker。

#### 验收条件
##### 正常：overlay modify 把 launched verify/deploy/smoke 改 cmd: 合法生效
- **GIVEN** 项目已 launched，overlay `modify` 把 `verify.done_when`（或 `verify.fail_when` / `smoke.done_when` / `smoke.fail_when` / `deploy.done_when`）改为 `cmd:<command>`
- **WHEN** 用户执行 `openlogos flow show --resolved`
- **THEN** resolved flow 中该 gate 字段为 cmd gate，不报 `FLOW_SCHEMA_INVALID`；检测层对该字段不抽 marker 名、标记为 cmd gate

##### 异常：非白名单 (节点,字段) 改 cmd: 报错
- **GIVEN** overlay `modify` 把 `deploy.fail_when`、其它 builtin 字段（initial 全部 / launched 的 `write-proposal`/`write-delta`/`generate-merge-prompt`/`apply-merge`/`code`/`archive` 的 `done_when`/`fail_when`）改为 `cmd:`
- **WHEN** 用户执行 `openlogos flow show --resolved` 或触发派生入口
- **THEN** 输出 `FLOW_SCHEMA_INVALID` 错误并退出，不静默保留、不进 resolved flow

##### 异常：同节点双 cmd: 或空命令报错
- **GIVEN** overlay 把同一 gate 节点（verify/smoke）的 `done_when` 与 `fail_when` 均改为 `cmd:`，或某 cmd 字段命令为空（`cmd:` 后无内容）
- **WHEN** 用户执行 `openlogos flow show --resolved` 或触发派生入口
- **THEN** 输出 `FLOW_SCHEMA_INVALID` 错误并退出

##### 异常：激活 loop 与 verify cmd gate 并存报错
- **GIVEN** overlay 同时声明 `implement` 的 `set-loop max_iters>1`（激活 loop）与 `verify` 的 `done_when` 或 `fail_when` 任一为 `cmd:`
- **WHEN** 用户执行 `openlogos flow show --resolved` 或触发派生入口
- **THEN** 输出 `FLOW_SCHEMA_INVALID` 错误并退出（fail loud 隔离，本切片不放开 loop+cmd 并存）

##### 正常：status/watch 不执行 cmd、cmd gate 显示停门前
- **GIVEN** launched 项目某前沿 gate（verify/deploy/smoke）的 cmd 字段未被非 cmd 字段解析
- **WHEN** 用户执行 `openlogos status` 或 `openlogos watch`
- **THEN** CLI 不执行 cmd，该 gate 判为 `pending`、`proposal_step` 停在门前（verify→`ready-to-verify` / deploy→`ready-to-deploy` / smoke→`ready-to-smoke`），并输出 `cmd_gate`（`node_id`/`field`/`command`/`timeout_seconds`）；不写任何 marker

##### 正常：per-field 混合按字段独立求值（fail 优先、非 cmd 字段先解析）
- **GIVEN** 某 gate `done_when: cmd:<检查>` 且 `fail_when: marker:VERIFY_FAIL`（混合）
- **WHEN** `VERIFY_FAIL` 存在时用户触发派生
- **THEN** 节点判为 `verify-failed`（非 cmd 的 `fail_when` 命中、优先于 done）；`VERIFY_FAIL` 不存在时 status `pending`、next 按 `done_when:cmd` 退出码推进

##### 正常：非 cmd 字段已解析的节点 next 不再求值其 cmd 字段（frontier）
- **GIVEN** 某 gate `done_when: marker:VERIFY_PASS` 且 `fail_when: cmd:<检查>`，且 `VERIFY_PASS` 已存在
- **WHEN** 用户执行 `openlogos next`
- **THEN** 该节点已被非 cmd 字段解析为 done、非前沿，next 不求值其 `fail_when:cmd`（不为已 done 节点跑命令）；`VERIFY_PASS` 不存在时该节点为前沿，next 求值 `fail_when:cmd`

##### 正常：next 中 done_when:cmd exit 0 推进过门（瞬态、不写 marker）
- **GIVEN** 某前沿 gate（如 deploy）`done_when: cmd:<命令>`，且该命令退出码为 0
- **WHEN** 用户执行 `openlogos next`
- **THEN** 本次响应该 gate 视为 done、`proposal_step` 推进过门（仅本次 envelope 的瞬态合成态）；不写 marker → 下一次 `openlogos status` 回到门前（如 `ready-to-deploy`），这是有意的 next/status 不一致

##### 正常：next 中 fail_when:cmd exit 0 为瞬态失败（非推进）
- **GIVEN** 某前沿 gate（verify/smoke）`fail_when: cmd:<检查>`，且该命令退出码为 0
- **WHEN** 用户执行 `openlogos next`
- **THEN** 本次响应该 gate 视为 failed、`proposal_step` = `verify-failed` / `smoke-failed`（瞬态失败态、非推进）；不写 marker；deploy 无 `fail_when:cmd`

##### 正常：next 中 cmd 非 0/超时停门前
- **GIVEN** 某前沿 gate 的 `done_when: cmd:<命令>` 退出码非 0 或超时
- **WHEN** 用户执行 `openlogos next`
- **THEN** CLI 不崩溃、该 gate 未命中，`proposal_step` 停在门前；不写 marker，可安全重跑

##### 正常：机器契约 cmd_gate 承载 builtin gate
- **GIVEN** 当前前沿是 verify/deploy/smoke 且其 cmd 字段仍 pending（`status`/`watch` 恒未求值；`next` 中 cmd 非 0/超时/未命中，**或因 budget=1 被前序 cmd 耗尽而未求值**）
- **WHEN** 用户执行 `openlogos status` / `openlogos watch` / `openlogos next --format json`
- **THEN** 输出 `cmd_gate = { node_id, field, command, timeout_seconds }`：有 `modules[]` 时挂 `modules[].cmd_gate`（与 `active_change` 平级、**顶层不输出**）、legacy 无 `modules[]` 才回退顶层 `cmd_gate`；仅存在 cmd gate（overlay modify）时出现，否则整字段省略

##### 正常：golden 零漂移（builtin 仍 marker:，无 overlay 逐字节不变）
- **GIVEN** 三个 launched gate 仍为 builtin 的 `marker:` 谓词（无 overlay modify 到 cmd:）
- **WHEN** 用户执行 `openlogos status` / `openlogos next` / `openlogos watch` / `openlogos flow show`
- **THEN** 输出逐字节不变，与引入 S30 之前的 golden 快照完全一致（不输出 `cmd_gate`、`markerName` / `detectProposalStepViaFlow` 对 marker: 路径行为不变）

### S31: 代码切片循环（implement 默认逐片实现到全部切片完成且测试绿）
- **触发条件**：一个大功能在 implement 阶段无法一次写完，需要逐片实现、无人值守自愈，直到全部 `[code]` 切片完成且测试绿；当单个切片内部需要拆成可验收子项时，允许在父切片下使用缩进 checkbox 表达子任务。
- **用户价值**：一个提案设计一次、切片实现多次；implement loop 逐片闭环 code→verify，靠客观信号（父切片与切片子任务全部勾选 + 测试绿）保质量，靠 `next --auto` 保无人值守。缩进子任务让宿主与 Agent 能在同一个父切片内追踪 bridge、adapter、panel、UT/ST/reporter 等细项，不再被误计为新的顶层切片。
- **优先级**：P1
- **主路径**：内置 launched `implement` 默认激活切片循环（`until: code_slices_green`、`max_iters:30`）。切片清单 = `tasks.md` `[code]` section 的顶层切片 checkbox；缩进 checkbox 是其所属父切片的子任务，只参与该父切片完成判定，不参与 `slice_state.total/done/remaining` 的顶层切片计数。`next` 选第一个未完成切片为当前工作项、`next_node` 钉在 `code` 并带 `slice` 子提示；若当前切片存在缩进子任务 checkbox，同步带 `slice_children` 子提示。`verify` 跑全量回归、追加 `LOOP_ITERS`（可带 `slice`）；全部父切片与所有子任务勾选且末轮测试绿才出环；达 `max_iters` 仍未达成升级 `gate:implement:loop-exhausted`（`skippable:false`）。

#### 验收条件
##### 正常：逐片推进的当前切片提示
- **GIVEN** launched 提案处于 implement，`[code]` 有未完成切片，loop 未收敛、未达上限
- **WHEN** 用户执行 `openlogos next`
- **THEN** `next_node` 指向 `code` 节点并带 `slice` 子提示（第一个未完成顶层 `[code]` 切片标题）；`slice_state` 输出 `{total, done, current, remaining}`。若当前切片下存在缩进子任务 checkbox，`slice_state.current_children` / `slice_state.current_unchecked_children` 与 `next_node.slice_children` 必须包含这些子任务及其勾选状态。

##### 正常：缩进子任务不参与顶层切片计数
- **GIVEN** `[code]` 中存在 2 个顶层切片，每个切片下各有若干缩进 checkbox 子任务
- **WHEN** 用户执行 `openlogos status` 或 `openlogos next --format json`
- **THEN** `slice_state.total == 2`，缩进子任务不得增加顶层切片总数；`remaining` 只按父切片完成状态计算。

##### 正常：全部切片完成且测试绿才出环（FAIL-safe）
- **GIVEN** loop 激活、`until: code_slices_green`
- **WHEN** 派生判定 implement 是否完成
- **THEN** 仅当 `section_complete:code`（所有顶层切片 checkbox 已勾选，且每个父切片下的缩进子任务 checkbox 全部勾选）**且** 末轮测试绿时 `converged=true` 出环；任一不满足则 `converged=false`、不得推进到 deliver/close。

##### 异常：父切片已勾选但子任务未全勾
- **GIVEN** 当前父切片 checkbox 已勾选，但该切片下仍有未勾选缩进子任务 checkbox
- **WHEN** 派生 `slice_state` 或 `code_slices_green`
- **THEN** 该父切片不得计入 `done`，`current` 仍指向该父切片，`current_unchecked_children` 列出未完成子任务，`code_slices_green` 不得收敛。

##### 正常：空 [code] 退化为 tests_green
- **GIVEN** 提案无 `[code]` section 或切片数为 0
- **WHEN** loop 激活（launched 默认）
- **THEN** `code_slices_green` 退化为 `tests_green`（仅末轮绿即收敛），不因无切片把小提案卡死。

##### 正常：达上限升级退出门
- **GIVEN** loop 迭代达 `max_iters` 仍未全部切片绿
- **WHEN** 用户执行 `openlogos next` / `next --auto`
- **THEN** 升级 `gate:implement:loop-exhausted`（`skippable:false`）；`next --auto` 默认仍阻塞、不放行未完成的大功能。

##### 正常：切片提示为"建哪片"非"修哪片"
- **GIVEN** 后做切片打断先做切片、全量 verify 飘红
- **WHEN** 用户执行 `openlogos next`
- **THEN** `slice` 提示仍指向第一个未完成切片（待建或待补子任务）；具体修哪里由全量 verify 失败输出决定、归宿主判（A 被动派生，引擎不代判）。

##### 异常：initial 多模块不支持
- **触发条件**：initial 多模块项目。
- **期望响应**：切片循环不激活（verify 项目级单次、无法归属切片），派生退化为旧行为、不输出 `slice_state`。

### S32: 切片规划环节（merge 后由 slice-planner 划分 [code] 切片）
- **触发条件**：一次含代码产出的变更已 merge（规格 delta 与测试用例已合并、真实 `UT/ST` ID 已定），需要把已合并规格拆成良构 `[code]` 切片，再进入 implement 切片循环。
- **用户价值**：把"切几片、每片做什么"从 plan 段（merge 之前、对未合并草案 + 占位测试 ID 猜切）剥离为 merge 之后的**独立环节**，对**真实规格 + 真实测试 ID**只决定一次；通过六维打分 + 垂直/横向判别器 + 删后续证伪门，杜绝把施工顺序（地基→逻辑→helper→UI）当成切片导致的循环死锁。
- **优先级**：P1
- **主路径**：merge 完成（`SPEC_MERGED` 在场、相关 `logos/resources/prd/` 与 `logos/resources/test/*-test-cases.md` 已合并）后，提案进入 `ready-to-implement` 驻留态；launched flow 的 `slice` 子流程 `plan-slices` 节点由 `slice-planner` 执行——读已合并规格 + 真实 `UT/ST` ID → 六维打分判定是否大任务 → 垂直/横向判别器选切片轴 → 删后续证伪门逐片证伪并写出逐片结论 → 把良构切片写入 `tasks.md` 的 `[code]` section（每条标注真实 `UT-Sxx-..`/`ST-Sxx-..`）→ 停在 `slice-exit` 门（`skippable:true`，`--auto` 可放行）待人类批准；批准后进入 `coding`，由 `code-implementor` 逐片消费、不再重新分批。`slice` 子流程带 `when: code_required`：纯文档提案（无 `[code]` 产出）整段跳过，直接从 merge 续推。

#### 验收条件
##### 正常：merge 后对真实规格与测试 ID 划分良构切片
- **GIVEN** 活跃提案已 merge（`SPEC_MERGED` 在场），规格与测试用例已合并、真实 `UT/ST` ID 已定
- **WHEN** 用户在 `ready-to-implement` 驻留态下按 `slice-planner` 规划切片
- **THEN** `tasks.md` 的 `[code]` section 写入一组垂直、自闭环、无前向依赖的切片，每条标注其覆盖的真实 `UT-Sxx-..`/`ST-Sxx-..`（不再使用占位 ID）

##### 正常：删后续证伪门强制写出逐片结论
- **GIVEN** slice-planner 已拟出 N 片候选
- **WHEN** 逐片自问 (a) 删掉后续片只做该片能否过全量 `openlogos verify`、(b) 该片是否产出一条端到端可观察能力
- **THEN** 任一答"否"的切片向前合并进依赖它的那一片；并把本轮逐片自问的结论（哪几片合并、为何合并）写进 `[code]` section 开头作为决策留痕

##### 正常：横向红旗推倒重切
- **GIVEN** 候选切片命名落在层 / 文件 / 工种（地基 / 读写 / helper / config 接入 / schema / UI 展示单独成片 / 单独写测试 / 单独补 reporter / 单独重拍 golden）
- **WHEN** 垂直/横向判别器命中横向红旗
- **THEN** 该组切片判为横切、推倒重切，改按端到端能力线 / 场景 / 独立子模块完整闭环切分

##### 正常：大任务原子不可拆时走逃生口单片
- **GIVEN** 六维打分 ≥8（大任务）但任何垂直切法都过不了删后续证伪门（能力原子、各部分互相咬死）
- **WHEN** slice-planner 应用逃生口
- **THEN** 保留 1 条切片，并写明"评分达大任务，但 <原因> 不可安全垂直拆分，故单片"，作为合规结果而非偷懒

##### 正常：slice-exit 门待批准与 --auto 放行
- **GIVEN** `[code]` 切片已划定，提案停在 `ready-to-implement`（`slice-exit` 门，`skippable:true`）
- **WHEN** 人类批准（或 `openlogos next --auto` 放行）
- **THEN** 默认/手动模式停下等人确认；`--auto` 视门通过、向 `GATE_AUTO_PASSED` 追加 `{gate_id:"slice-exit", proposal_step:"ready-to-implement", timestamp}`，随后进入 `coding`

##### 正常：纯文档提案跳过 slice 子流程
- **GIVEN** 提案无 `[code]` 产出（纯 docs/delta 提案，`when: code_required` 为假）
- **WHEN** 提案 merge 完成
- **THEN** `slice` 子流程整段跳过，不进入 `ready-to-implement`，直接续推到 implement（切片循环对空 `[code]` 退化为 `tests_green`）

##### 异常：测试 ID 未定时拒绝切片
- **GIVEN** 规格或测试用例尚未合并（真实 `UT/ST` ID 未定）
- **WHEN** 用户尝试在 merge 完成前用占位 ID 划分切片
- **THEN** slice-planner 拒绝切片，提示先完成 merge——切片必须对真实规格 + 真实测试 ID 进行，而非对未合并草案猜切

### S33: 存量项目逆向建基线与按需深化
- **触发条件**：`openlogos adopt` 完成后模块处于 `bootstrap: adopted` 且 `baseline_seed_state: required`；或后续 `openlogos change` 触碰只有未验证逆向 spec 的区域。
- **用户价值**：存量项目接入后立即获得一份**种子基线**（现状快照，只含可从代码忠实验证的事实：模块图、入口、依赖、**场景候选清单**），带 provenance 标记且明确 `verified: false`；随每次 change 触碰逐区域升级为人工确认，可信边界前移，存量代码 grandfather 豁免、不要求回头符合 spec。
- **优先级**：P0
- **主路径**：AI 会话/driver 检测 `baseline_seed_state: required` → 派发 `brownfield-adopter` skill 扫描代码库 → 逐产物写入含具名章节 `## 逆向基线来源` 与 `candidates[]`（`verified: false`、provenance 派生 `reverse-engineered`）的种子基线 → 展示现状基线覆盖率（human-verified 分子 / `active ∪ tombstone` 分母）→ 经 `openlogos baseline-seed`（`begin` → 写 run staging → `commit`）由 CLI 计算 `baseline_seed_state`（未全 `partial`、必需 kind 齐且全部合法 `seeded`，见 S33）。后续 `openlogos change` 触碰未验证逆向区域时，change-writer 给 advisory，建议在**当前 change 内那一份最终态 delta**里一并确认该区域现状（把 `## 逆向基线来源` 的 `verified` 升为 `true` 并记 `confirmed_by`/`evidence`），merge 落主文档后覆盖率前移一格。

#### 验收条件
##### 正常：adopt 后逆向产出种子基线（producer=AI driver，非 CLI）
- **GIVEN** 模块 `bootstrap: adopted` 且 `baseline_seed_state: required`
- **WHEN** AI 会话/driver 检测到该状态并派发 `brownfield-adopter`
- **THEN** 在 `logos/resources/` 下产出只含可验证事实的种子基线（system-map + 场景候选清单）；每份产物含具名章节 `## 逆向基线来源` 与 `candidates[]`（每候选 `verified: false`、provenance 派生 `reverse-engineered`）；**不写 PRD**（意图无法从代码忠实还原）；产物写 run staging 后经 `openlogos baseline-seed commit`，由 CLI 依 manifest 计算 `baseline_seed_state`（未全 `partial`、必需 kind 齐且全部合法 `seeded`）
- **且** `openlogos adopt`（CLI 本身）绝不启动 AI、不产出逆向内容、不声称基线已建立

##### 正常：能力缺失时降级不伪造
- **GIVEN** CLI-only / `--ai-tool other` / 非交互 CI / AI 能力缺失
- **WHEN** adopt 完成但无法派发逆向扫描
- **THEN** 保持 `baseline_seed_state: required`，输出可复制的后续命令/提示；`status`/`next` 明确显示「种子基线待建立」，绝不把未产出的基线显示为已建立

##### 正常：change 触碰未验证逆向区域给 advisory（不设硬门）
- **GIVEN** 活跃 `openlogos change`，其目标区域只有 `verified: false` 的逆向 spec
- **WHEN** change-writer 产出 delta
- **THEN** change-writer 给 advisory，建议在当前 change 的**单份最终态 delta**内一并确认该区域现状（`## 逆向基线来源` 置 `verified: true` + `confirmed_by`/`evidence`），与前向改动合并落盘；这是**不设硬门**的建议，用户可跳过直接写前向 delta

##### 正常：human-verified 仅 merge 后生效、覆盖率不虚增
- **GIVEN** 一份含 `verified: true` 的现状确认 + 前向改动的最终态 delta
- **WHEN** 执行 `openlogos merge`
- **THEN** `human-verified` 仅在该 delta 成功落入主文档后生效；覆盖率**只读已合并主文档**；覆盖率分母采 tombstone 法（存活候选 ∪ 未经人工确认的 tombstone），删除/合并候选转 tombstone 仍留分母，**无新增人工确认时百分比不上升**

##### 异常：verify 对未验证逆向 spec 软告警
- **GIVEN** 主文档区域仍为 `verified: false` 的逆向 spec
- **WHEN** 执行 `openlogos verify`
- **THEN** 仅输出软告警（提示该区域为未确认逆向现状），**不硬失败**；grandfather 豁免存量代码

##### 异常：存量 provenance 保守迁移不伪造/不降级
- **GIVEN** 老 adopted 项目已有文档但缺 `## 逆向基线来源` 章节
- **WHEN** 迁移回填 provenance 元数据
- **THEN** 该文档标 `unknown`/`legacy-unclassified`，**不自动推断为 `reverse-engineered` 或 `human-verified`**；无产物时不创建任何 provenance；迁移幂等、写前备份、旧版 CLI 忽略未知字段

#### S33 补充：provenance 扫描侧只采信可重算规范键（provenance-scan-canonical-recompute）

修复 issue「provenance 扫描器把指南文档里的示例章节当真实候选」——扫描侧采信强度低于写侧，导致文档示例毒化基线。以下为 S33 逆向建基线能力的补充验收（能力扩展，不新增场景）：

##### 正常：扫描侧只采信可重算规范键，文档示例不毒化基线
- **GIVEN** 一个从未跑过 baseline-seed 的项目（真·非存量，`logos-project.yaml` 无 `scenarios[]/features[]/baseline_index`），其 `logos/resources/`（如 `reference/` 子目录）存有含 `## 逆向基线来源` 示例章节的文档（官方指南/培训材料/bug report 等），示例候选 `key` 格式合法但与 `anchor` 的规范重算值不一致（教学编造 key）
- **WHEN** 运行 `openlogos feature-backfill`（或任何读覆盖率的命令）
- **THEN** 扫描器**不采信**该编造候选（判据 = `key === candidateKey(module, anchor)` 或 `key === candidateKey(module, alias∈aliases)`，与写侧 `baseline-seed` 同强度）；`feature-backfill` 按"真·非存量"成功、`baseline_candidates_total=0`、**不报** `BASELINE_PROVENANCE_INVALID`；覆盖率分母不含该幽灵候选、新鲜度不因该文档改动打成 `stale`

##### 正常：改名继承 / tombstone 合法候选仍被采信（alias-aware）
- **GIVEN** 一个真实基线项目，其某候选经锚点重命名（旧 anchor 入 `aliases[]`、`key` 保持稳定）或已 `tombstone`（`superseded_by` 指向新 key）
- **WHEN** 扫描器采信候选
- **THEN** 该候选因 `key === candidateKey(module, 旧anchor∈aliases)` 仍被采信、不被误杀；合法基线项目的覆盖率数值与新鲜度**逐字节不变**

##### 异常：判定为 provenance 失败时报告触发文件与分类
- **GIVEN** 权威/约定目标 `## 逆向基线来源` 坏 fenced YAML，或有迹象但不可定类
- **WHEN** `feature-backfill` 因此失败
- **THEN** 错误 envelope 附**触发文件相对路径清单** `paths[]` 与失败**分类** `reason`（`unparseable` | `unclassifiable-evidence`），可一眼定位问题文件（不再只报模块名）

### S34: 管理 feature 分组
- **触发条件**：项目场景增多、需要在 module 与 scenario 之间按功能域（feature）组织导航；或存量项目需要把既有平铺场景回填到 feature 分组。
- **用户价值**：补上 module（粗，部署/生命周期单元）与 scenario（细，单一时序）之间缺失的**轻量组织层**，让 `status`/`next` 可按 feature 分组导航，并接回已有的 feature-specs 文档；存量项目零改动即可用、可按需回填。
- **优先级**：P1
- **主路径**：
  1. `openlogos feature list [--module <id>]` 只读查看各 module 下的 feature 分组及其场景成员（未归属场景落入"未分组"桶）。
  2. `openlogos feature-backfill [--module <id>]` 为存量项目生成一份 AI 回填 prompt（打包场景清单 + 现有 feature-specs 文档 + 当前 yaml），由 AI 语义聚类成 `features[]`、分配 `scenario.feature`、维护 `feature_counter` 后回写 `logos-project.yaml`（幂等、只补未分组、非强制）。
  3. `status`/`next` 在 module 下按 feature 分组呈现（含"未分组"桶），feature 缺失即省略、行为等同今天。

#### 验收条件
##### 正常：feature 分组按功能域组织导航
- **GIVEN** `logos-project.yaml` 的 `scenarios[]` 部分场景带 `feature` 归属、`features[]` 已登记
- **WHEN** 用户执行 `openlogos status --format json`
- **THEN** 对应 `modules[].features[]` 按 YAML 声明顺序列出各 feature 及其场景成员列表 `scenarios:[{id,name}]`，无归属场景归入 `id:"__ungrouped__"` 伪 feature（恒末位）

##### 正常：纯 pre-feature 项目逐字节完全一致（含 contract.version，回应 delta-F1）
- **GIVEN** `logos-project.yaml` 无 `features[]`、且无任何场景带 `feature` 字段（纯 pre-feature 项目）
- **WHEN** 用户执行 `openlogos status` / `openlogos next`
- **THEN** `modules[].features` 省略，`data.contract.version` **保持 `1.0.0`**，输出与引入 feature 前**逐字节完全一致**（**含版本字段，无任何差异**），不报错
- **注**：范围锚所有者裁定采**条件版本（B）**——`contract.version` 仅在响应含 `features` 时为 `1.1.0`，纯 pre-feature 响应保持 `1.0.0`，真正满足逐字节一致验收（回应 delta-F1）

##### 正常：feature-backfill 打印生成路径
- **GIVEN** 存量项目场景平铺
- **WHEN** 用户执行 `openlogos feature-backfill`（文本）或 `--format json`
- **THEN** 文本模式 stdout 打印 prompt 路径 `logos/feature-backfill-prompt.md`；`--format json` 的 `data.prompt_path` 等于该路径；`logos-project.yaml` 字节不变

##### 正常：存量项目一键回填生成 prompt
- **GIVEN** 存量项目场景平铺、无 feature 归属
- **WHEN** 用户执行 `openlogos feature-backfill`
- **THEN** 在 `logos/feature-backfill-prompt.md` 生成回填 prompt 并打印路径；命令不改动 `logos-project.yaml`（由 AI 按 prompt 回写）；重复执行幂等覆盖同一 prompt

##### 异常：feature 引用降级不阻断（含无注册 feature 场景，回应 delta-F10）
- **GIVEN** 某场景的 `feature` 缺失、指向未知 feature、或指向跨 module 的 feature（**即使该 module 无任何注册 feature**）
- **WHEN** 用户执行 `openlogos status` / `openlogos feature list`
- **THEN** 该场景一律落入所属 module 的"未分组"（`__ungrouped__`）桶，不报错、不阻断；**只要存在显式 `feature` 键，`modules[].features` 就必须输出该降级桶，绝不因"无注册 feature"被省略**

##### 异常：feature list 指定未注册 module
- **GIVEN** 用户传入不存在的 `--module <id>`
- **WHEN** 用户执行 `openlogos feature list --module <id> --format json`
- **THEN** 走通用错误 envelope，错误码为 `MODULE_NOT_FOUND`，非零退出码

#### S33 补充：legacy 缺省语义三入口统一（baseline-seed-legacy-default-unify）

修复 issue「legacy adopted 项目 `baseline_seed_state` 缺省语义三入口分歧」——`next` / `baseline-seed` 状态机推断 `required`，`status` 独家推断「有候选→`seeded`，无候选→`unknown` 且**不输出字段**」，同一项目在不同命令下呈现两种世界观；下游（runlogos 面板等）按 status JSON 契约 fail-closed，基线入口整体消失。且 `openlogos sync` 的元数据迁移只认旧布尔 `baseline_seed_required`，对「两字段皆无」的早期接入项目空转，status 的 legacy 迁移提示成为空头指引。以下为 S33 逆向建基线能力的补充验收（行为统一，不新增场景）：

##### 正常：三入口缺省语义单一事实源，逐字节一致
- **GIVEN** legacy adopted 模块（`bootstrap: adopted`，`logos-project.yaml` 无 `baseline_seed_state` 字段、也无旧布尔 `baseline_seed_required`），分「有逆向候选 / 无逆向候选」两档
- **WHEN** 分别运行 `openlogos next`、`openlogos status --format json`、`openlogos baseline-seed status --module <id>`
- **THEN** 三入口对该模块给出的有效 `baseline_seed_state` **逐字节一致**，且遵循统一派生规则：explicit 显式值优先；缺省时**有候选且同模块存在 open run record → `partial`**（与状态机「扫描中断」语义对齐）、**有候选无 open run → `seeded`**（候选在场 = 基线事实上建立过）、**无候选 → `required`**；**废除 `unknown` 第三态**（任何入口的任何输出不得出现 `unknown` 状态值）
- **且** 派生规则由**唯一共享 helper** 承载，任何入口不得持有第二份私有缺省规则（本地 `?? 'required'` 一类实现全部废除）
- **且** `required` 态仍为 advisory 引导、不设硬门——不阻断用户直接发起 `openlogos change` 正常迭代

##### 正常：sync 迁移把 legacy 缺省派生值落盘为显式枚举
- **GIVEN** legacy adopted 模块（无 `baseline_seed_state` 字段；`bootstrap: adopted`，含历史 `skipped` 兼容读取）
- **WHEN** 运行 `openlogos sync`
- **THEN** 迁移按统一派生规则计算并把**显式枚举**写入 `logos-project.yaml` 的 `baseline_seed_state`；changes 记录写明派生依据（如 `core: baseline_seed_state 缺省 → required（派生：无逆向候选）`）；已有显式值**不被覆盖**；历史布尔 `baseline_seed_required` 的既有迁移行为不回归；迁移幂等
- **且** 迁移后 legacy 缺省态在该项目物理消亡，运行时派生仅作「迁移尚未执行」的过渡兜底；status 的 legacy 迁移提示（指向 sync）自此真实有效

##### 正常：adopted 模块 status JSON 恒输出 baseline_seed_state（契约收紧）
- **GIVEN** 任意 `bootstrap: adopted` 模块（explicit 或 legacy 缺省；含基线提交进行中 `baseline_commit_in_progress` 降级情形）
- **WHEN** 运行 `openlogos status --format json`
- **THEN** `modules[].baseline_seed_state` **无条件输出**，取值为合法枚举 `required｜partial｜seeded`（explicit 或派生值）；「缺省 → 字段缺失」路径废除；非 adopted 模块行为不变
- **且** 下游按「字段必在」消费（fail-closed 判定自然恢复渲染），旧版下游遇新增字段不受影响（纯增量，向后兼容）

### S34 补充：feature-backfill 纳入逆向候选（feature-backfill-brownfield）

- **触发条件**：存量项目经 `openlogos adopt` + 逆向建基线（S33）产出**场景候选**（存于 `## 逆向基线来源` 章节 + `baseline_index`，未进顶层 `scenarios[]`）；用户希望把这些逆向场景也组织成 feature 分组。
- **用户价值**：接回 S33↔S34 的断链——`feature-backfill` 不再只对 `scenarios[]` 有效，也能帮**逆向接入的存量项目**把逆向场景聚成功能域，使其可按 feature 导航。
- **主路径(方案 A)**：
  1. `openlogos feature-backfill` 生成 prompt 时，除 `scenarios[]` 外**再纳入逆向场景候选**（复用 S33 provenance 只读入口），并**明确标注**"逆向候选 · 未进 scenarios[] · provenance verified:false"。
  2. AI 按 prompt 对已有场景 + 逆向候选一并聚类；对逆向候选，回写时**登记进 `scenarios[]`（导航注册表）并分配 `feature`**——**不改动其 provenance `verified` 状态**（仍由 S33 的 JIT 确认流治理）。
  3. CLI 仍**只生成 prompt、不改 `logos-project.yaml`、幂等**；`--format json` 成功响应的 `data` **必含**非负整数统计 `baseline_candidates_total`（键恒在场，见契约 §1.5）。

#### 验收条件
##### 正常：feature-backfill 只纳入"场景候选"并标注（回应 F1）
- **GIVEN** 存量项目同时有 `system-map` 与 `scenario-candidates` 两类逆向产物，`scenarios[]` 不含这些候选
- **WHEN** 用户执行 `openlogos feature-backfill`
- **THEN** 生成的 `logos/feature-backfill-prompt.md` **只含 scenario-candidates**（经已提交 run manifest `kind==scenario-candidates` 筛出）、不含 system-map 候选，且标注"逆向候选 / verified:false / 未进 scenarios[]"；`--format json` 的 `data.baseline_candidates_total` **键恒在场**且等于**最终写入 prompt 的场景候选数**

##### 正常：非存量项目零改动（回应 F4）
- **GIVEN** 项目无逆向场景候选
- **WHEN** 用户执行 `openlogos feature-backfill`
- **THEN** 行为与 S34 引入时完全一致：prompt 不含逆向候选段，`data.baseline_candidates_total == 0`（**键仍在场**，用于区分"零候选"与"旧实现无键"）

##### 异常：提交进行中不写半新集合（回应 F2）
- **GIVEN** 该 module 基线提交进行中（`prepared`/`committing` journal 无法在读锁内恢复）
- **WHEN** 用户执行 `openlogos feature-backfill`
- **THEN** 命令**不写/不覆盖** `feature-backfill-prompt.md`；`--format json` 返回错误码 `BASELINE_COMMIT_IN_PROGRESS`、非零退出（绝不把半新多文档集合当权威）

##### 异常：索引 stale 重算 / 解析失败报错（回应 F6，唯一行为）
- **GIVEN** ①索引 stale 但权威 `## 逆向基线来源` 章节有效；②权威章节坏 fenced YAML
- **WHEN** 用户执行 `openlogos feature-backfill`
- **THEN** ①读锁内从权威文档重算、命令成功照常纳入；②走错误 envelope、错误码 `BASELINE_PROVENANCE_INVALID`、非零退出、**不写/不覆盖 prompt**（**不得**声称 `baseline_candidates_total=0` 冒充非存量零改动）

##### 红线：CLI 不改 yaml、不动 provenance 可信度、S33 覆盖率不变（回应 F7）
- **GIVEN** 存量项目有场景候选（含 active `verified:false` 与 tombstone 共存）
- **WHEN** 用户执行 `openlogos feature-backfill`（含重复执行、含 `--module` 与全项目）
- **THEN** `logos-project.yaml` 字节不变；各 `## 逆向基线来源` 章节候选 `verified` 状态不变（导航 ≠ 可信度）；**经 S33 正式覆盖率读取入口在命令前后计算,`human_verified` / `denominator` / `tombstones` / `coverage` / `freshness` 深相等**（不触发索引重写或覆盖率副作用）；重复执行幂等覆盖同一 prompt

### S13/S19/S31 smoke runner 覆盖闭环验收补充
#### S13: smoke 覆盖预检
- **GIVEN** 活跃提案新增或修改了 `logos/resources/test/smoke/*.md`，并新增一个或多个 `SMOKE-*` 用例 ID
- **WHEN** code 阶段准备完成或 `openlogos verify` 进行实现完成前检查
- **THEN** CLI 必须检查新增 smoke 用例是否已有对应可执行 smoke runner/reporter 计划或执行结果；若新增 smoke 用例没有任何 runner/reporter 覆盖证据，必须输出明确诊断，不得让提案被误判为完整实现。

#### S19: smoke 用例必须可执行
- **GIVEN** smoke 用例规格中存在 `SMOKE-*` ID
- **WHEN** 用户明确授权执行 `openlogos smoke --format json`
- **THEN** 每个已定义 smoke 用例必须由 `smoke.command`、统一 smoke dispatcher 或等效 runner 写入 `logos/resources/verify/smoke-results.jsonl`；未写入执行结果的用例必须进入 `uncovered_cases`，Gate 3.8 必须失败。

#### S31: code 切片包含 smoke runner 交付物
- **GIVEN** `[code]` 切片对应的规格变更新增或修改了 smoke 用例
- **WHEN** change-writer / code-implementor 生成或执行该 `[code]` 切片
- **THEN** 该切片必须同时包含业务代码、UT/ST、OpenLogos verify reporter，以及 smoke runner/reporter/dispatcher 接入；不得把 smoke runner 留到部署后手工补齐。

#### 异常：新增 smoke 用例未覆盖
- **GIVEN** 当前提案新增了 `SMOKE-*` 用例，但 `smoke-results.jsonl` 没有对应结果，且 `smoke.command` 无法发现会执行该用例的 runner
- **WHEN** 执行 smoke 覆盖预检或部署后 smoke
- **THEN** 输出 `smoke_runner_missing`、`smoke_reporter_missing` 或 `smoke_cases_uncovered` 之一，并列出缺失的 `SMOKE-*` ID。

## 五、约束与边界
### 5.1 技术约束
- 本项目以 CLI、规范文档、插件模板和静态站点为主，不以业务 HTTP API 为主体。
- 当前阶段不引入业务数据库 schema。
- 所有文档必须遵循 `logos/` 目录与模块前缀命名规范。

### 5.2 资源与时间约束
- 需要先补齐文档基线，再考虑代码层调整。
- 受限于现有实现，不能把不存在的业务接口或页面写成既成事实。

### 5.3 “不做”清单
- 不把单个 CLI 选项拆成独立场景。
- 不把 OpenLogos 规范文件重写成与实现无关的抽象概念。
- 不把本项目伪装成传统 Web 应用。
- 不直接修改运行代码作为本次变更目标。
- 不把 OpenLogos 做成通用工作流 / BPM 引擎：flow 编排只服务 WHY→WHAT→HOW 研发链路，不追求表达任意业务流程。
- 不替代 CI 系统本身：`cmd:` 谓词只消费外部命令（如 `gh pr checks`）的退出码把门禁接入既有 CI / 校验脚本，不重造 CI / 流水线引擎。
- 无人值守自动化绝不跨越"代码未绿"红线：可跳确认点在 `--auto` 受控授权下自动放行，但 `gate:implement:loop-exhausted`（未通过测试的代码）在任何模式（含 `--auto`）都不自动放行。

## 自动流程可恢复失败韧性要求

### 背景

OpenLogos 作为可被 RunLogos / CI / AI driver 消费的流程事实源，必须在无人值守执行中区分“可恢复失败”和“必须人工介入的硬阻塞”。当 agent 已产生业务代码、测试代码、OpenLogos reporter 记录或其它可验证产物时，系统不得仅因全量回归仍失败或 artifacts 声明不完整，就把该轮完成回报折叠为“虚报完成”。

### 需求

1. 自动流程必须将以下状态分开表达：
   - 当前切片局部完成；
   - artifacts 声明缺失或越界；
   - 本片 focused tests / reporter 缺失；
   - 全量 verify 失败；
   - driver 无法根据当前契约验证产物；
   - 真正无产物、无状态推进或 agent 执行失败。
2. 当局部切片完成但全量 verify 失败时，系统应进入 repair / code 修复路径，并携带失败用例列表；不得反向否定该切片的局部完成事实。
3. `retry-exhausted` / `loop-exhausted` 只应用于无进展、无产物、达到明确硬红线或多轮无法恢复的场景；不得覆盖“有产物但全量回归失败”的可恢复失败。
4. 任何 block / escalated 输出都必须包含可行动诊断，包括失败原因、缺失 artifact、已验证 artifact、失败测试、建议下一节点和是否需要人类介入。
5. 同一 dispatch 的 artifacts 声明应允许短窗口内更正；如果不能更正，系统也必须返回明确的重新派发或修复指引。

### 验收口径

- RunLogos / 外部 driver 不需要猜测 OpenLogos 内部状态机；仅通过 `next` / `status` / `verify` 的机器输出即可判断下一步是 repair、重派当前切片、补 artifacts、重跑测试，还是人工阻塞。
- 可恢复失败在 `--auto` 模式下应优先继续自动修复闭环；只有 `human_action_required=true` 或不可跳硬红线时才停止。

## 机器契约自描述与防误杀（假死）要求

### 背景

OpenLogos 的 `status` / `next` 机器输出是 RunLogos、CI 与各类 AI driver 的流程事实源。上游（CLI 契约 / agent UI / 世界状态）是开放世界：driver 里每一份「本地缓存的世界模型」（本地步骤枚举表、错误串、正则、屏幕启发式、私有 marker 解析、重投安全 allowlist）必然随 CLI 演进过期。当这些弱信号有权直接产生不可逆终态时，健康 run 会被误判为死亡（假死）——真死可以重新点一下；假死会让用户弃用全自动能力。已坐实的活体案例包括：CLI 从 `writing` 起提前挂出 `loop_state` 导致 no-delta 提案全自动第一跳即被假 `blocked`（loop 劫持），以及 driver 用本地 allowlist 猜「哪类派活重投安全」导致非幂等派发被瞬态歧义秒杀。

根治方向是让**契约自描述（消灭猜）**：driver 需要的每一个判定语义，都必须由 CLI 权威输出为结构化字段，而不是让消费方逆向猜测。

### 拍板原则（最高优先）

宁慢勿错杀：多等 5 分钟看门狗远好于误杀健康 run。一切措辞与设计冲突以此裁决。

### 需求

1. **机器契约必须自描述**：`status` / `next` 的机器输出必须携带足以让消费方判断阶段语义与派发安全性的结构化字段——步骤语义元数据 `step_meta`（phase / kind）、CLI 权威计算的确定性事实块 `facts`、派发节点自描述 `next_node.dispatch`。消费方不得被迫维护本地步骤枚举表、私有 marker/文件解析或重投安全 allowlist。
2. **契约版本握手**：status/next 的 `data` 顶层新增 `"contract": {"version": "1.0.0"}`（语义化契约版本，独立于 CLI 版本）。SemVer 规则：**major** = 必填字段删除/改义、闭合枚举语义变化（含移除值）、既有字段挂出判据变更；**minor** = 向后兼容扩展（新增可选字段、闭合枚举新增值）；**patch** = 不改形态与语义的澄清。版本-schema 一一映射：`spec/schema/status.schema.json`、`spec/schema/next.schema.json`（内嵌契约版本号，随 npm prepack 打包）；响应 `contract.version` 与打包 schema 版本一致，CI 校验。
3. **消费方保守模式原则**（规范性引用，验收归 runlogos R5）：未知 major / 缺 `contract` 字段 → 保守模式（仅 next 驱动普通推进 + 看门狗，启发式判定降级为仅观察）；契约内任何枚举遇未知值 → 保守分支。据此，CLI 新增枚举值或可选字段不再构成对旧 driver 的破坏。
4. **防误杀（假死）**：任何触发 driver 分支的字段（如 `loop_state`）只在其语义真正成立时挂出，缺席态语义 = 普通推进；弱信号（本地枚举、错误串、正则、产物提示不达）不得作为判死依据。特别地，`artifacts_hint: []` ＝「产物未知」契约语义：消费方不得据此判死，只能升级观察。
5. **不新增 `proposal_step` 枚举值**：自描述通过 `step_meta` 等元数据表达，不扩张既有闭合枚举；`step_meta` 的 phase/kind 为小闭合枚举，消费方遇未知值必须走保守分支。

### 验收口径

- `openlogos status --format json` / `openlogos next --format json` 的 `data` 顶层携带 `contract.version`；有活跃提案时 `active_change` 携带 `step_meta` 与 `facts`；`next` 输出的每个 `next_node` 恒带完整 `dispatch` 对象。
- 生产者一致性可被 CI 证伪：注册表/step_meta/schema 三方同步；`pre-implement` 步骤不输出 `loop_state`（漂移注入 `x-future-step` 生产者一致性测试的反面锚）；`contract.version` 与打包 schema 版本一一对应。
- **验收边界**：本项目只验**生产者契约**；「未知 major/未知枚举 → 保守模式」「零误杀」「suspect 可逆态」是消费方行为，其验收归 runlogos 仓 R5 提案；双向契约测试是跨仓总方案完成定义，不是本项目单仓的完成判据。

## S13 verify 结果账本一致性验收补充

### 背景

`openlogos verify` 是 OpenLogos 自动化流程、RunLogos driver 和 CI 消费的权威验收门禁。门禁不能只检查“是否没有失败用例”和“是否覆盖全部定义用例”，还必须证明结果账本本身可信。

部分用例在本机、CI 或部署目标缺失时可以由 reporter 明确标记为 `status:"skip"`。这类 skip 是“已处理但因环境限制未执行”的结果，不等同于未覆盖或失败。它必须在报告中可见，但不应阻塞 verify / smoke 流程。

### 需求

1. `openlogos verify` 必须在计算 PASS / FAIL 前校验 `test-results.jsonl` 的 schema 与统计自洽性。
2. 同一个用例 ID 多次出现时继续采用 last-write-wins；但去重后的每条结果都必须满足：
   - `id` 对应一个已定义、非 `[manual]` 的自动化用例；
   - `status` 只能是 `pass`、`fail` 或 `skip`；
   - `status="fail"` 时必须有可诊断的 `error`。
3. `status="skip"` 的合法结果必须计入 `executed_count`、`skipped_count` 和覆盖率分子；通过率按 `(passed_count + skipped_count) / executed_count` 计算。
4. 以下任一情况必须使 verify Gate 非 PASS，并输出明确诊断：
   - 存在非法 JSONL 行、缺失 `id` / `status`，或 `status` 不在允许枚举内；
   - 存在未定义用例 ID；
   - 存在 `[manual]` 用例 ID 写入自动化 JSONL；
   - `status="fail"` 缺少非空 `error`；
   - `passed_count + failed_count + skipped_count != executed_count`；
   - `executed_count > defined_count`；
   - `failed_count == 0 && passed_count + skipped_count != executed_count`；
   - `pass_rate_pct < 100` 且没有失败结果能解释该差异。
5. 合法 skip 不得单独导致 `gate.result="FAIL"`，也不得返回 `gate.reason="skipped_cases"`；若无失败、无未覆盖、账本一致、checklist 完成且 AC 追溯满足，包含 skip 的 verify 仍必须 PASS。
6. `openlogos smoke` 的通过率展示必须采用同样的有效通过口径，但仍保留 `skipped_count` 与 `skipped_cases` 供用户审计。
7. 结果账本不可信时，`openlogos verify --format json` 必须返回非零退出码，`gate.result` 不得为 `PASS`，`gate.reason` 必须非空。
8. 正常全绿且统计自洽的结果必须保持既有 PASS 行为。

### 验收口径

- 构造 `defined_count=2`、`executed_count=2`、`passed_count=1`、`skipped_count=1`、`failed_count=0`、`uncovered_count=0` 的账本时，verify 必须 PASS，`pass_rate_pct` 必须为 100。
- 构造 `defined_count=1`、`executed_count=2`、`passed_count=1`、`failed_count=0`、`skipped_count=0`、`uncovered_count=0` 的账本时，verify 必须 FAIL。
- 构造包含非法 `status` 的账本时，verify 必须 FAIL，并在 JSON 诊断中暴露非法结果原因。
- 构造包含未定义用例 ID 的账本时，verify 必须 FAIL，并列出未定义 ID。
- 全部已定义自动化用例均 `pass` 且无额外 / 非法结果时，verify 仍 PASS。

## 纯代码提案 no-delta spec-complete 需求

### 背景

纯代码级提案没有 PRD / API / DB / 场景 delta，但仍会进入实现与测试闭环。此类提案若直接跳过规格完成信号，会让下游 `slice-planner` 无法判断规格阶段是否已经定稿，也无法确认真实 UT/ST/SMOKE ID 是否稳定。

### 需求

1. OpenLogos 必须为纯代码提案提供可追踪的 spec-complete 状态。
2. 纯代码提案不得进入 `write-delta`，但必须执行 no-delta merge/spec-complete 后才能进入切片规划。
3. no-delta spec-complete 统一复用 `SPEC_MERGED` marker；marker 内容应能区分真实 delta merge 与 no-delta spec-complete。
4. `next/status` 不得在缺少 spec-complete 信号时把代码提案派到 `plan-slices`。
5. `next/status` 不得在缺少真实 UT/ST/SMOKE ID 时把代码提案派到 `plan-slices`。
6. `slice-planner` 必须保持严格前置：只消费已完成 spec-complete 且测试 ID 已稳定的提案，不得使用占位测试 ID。

### 验收条件

- 无 delta 的纯代码提案执行 `openlogos merge <slug>` 后，提案目录出现 `SPEC_MERGED`，内容包含 `type: "no_delta_spec_complete"`、原因与完成时间。
- 无 delta 的纯代码提案在缺少 `SPEC_MERGED` 时，`openlogos next/status` 返回 `proposal_step: "spec-complete-required"` 或等价结构化诊断，且不返回 `next_node.id=="plan-slices"`。
- 代码提案缺少真实测试 ID 时，`openlogos next/status` 返回 `proposal_step: "test-id-required"` 或等价结构化诊断，且不返回 `next_node.id=="plan-slices"`。
- 已完成 no-delta spec-complete 且真实测试 ID 可解析时，`openlogos next/status` 才允许返回 `ready-to-implement` + `next_node.id=="plan-slices"`。
- 纯文档提案不受本规则误伤；无需代码时仍可跳过 `slice` 子流程。

## S09 GUI 项目提案阶段前置 UI/UX 原型确认

### 背景

对已 `launched` 的 **GUI 产品项目**（网站 / 桌面应用 / 移动 App），当前 UI/UX 原型由 product-designer 在 Phase 2 产出——发生在**提案批准之后、driver 自动实现期间**。用户在 S09「批准提案」门只看到纯文字方案，看不到界面长什么样；等自动化把 UI 做出来才发现不对，导致大量返工，且返工发生在全自动链路里、纠偏成本最高。

核心洞察：把 UI/UX 确认**前移到「批准提案」门**——GUI 项目在提案阶段就产出界面原型，使用户能在批准提案时（面板已渲染原型的前提下）连界面一起确认。看界面**不是一道新关卡**，它挂在现有「批准提案」动作上，复用现有 `plan-exit`（批准方案）门，**不新增门态、不新增确认标记**。

非 GUI 项目（纯 CLI / API / 纯后端服务 / Skills）整个特性不启用，S09 流程零改动。

### 适用范围（判断顺序）

本特性仅对 **GUI 产品项目**且**本次变更确实触及界面**时启用，判定按以下顺序进行：

1. **先判 `product_type` 是否属于 GUI**（网站 / 桌面应用 / 移动 App）。若项目 `product_type` 为纯 CLI / API / 纯后端服务（`service`）/ Skills，则本特性整体不启用，S09 生命周期与提案结构**零改动**，后续判断不再进行。
2. **再判本次变更是否动了界面**（`ui_impact`）。该判定在 **plan 阶段由 change-writer 执行**，依据是**提案意图 + 项目 `product_type` + `tasks.md` 已规划的 `[delta]` 目标**，而非扫描尚不存在的 delta 文件内容（在 plan 阶段无 delta 可扫，扫内容会构成「先 delta 还是先原型」的循环依赖）。当 `tasks.md` 的 `[delta]` 目标命中 `2-page-design/` 或含交互变更的 feature-specs 时，强制判为「动了界面」。
3. 仅当两条同时成立（`product_type∈GUI` 且 `ui_impact:true`）时，本次提案在 plan 阶段前置产出 UI/UX 原型；任一不成立则不产出原型、流程照旧。

作为**增益功能**，判定**容错优先流程平滑**：判错代价可控（顶多多画一次或退回重设），不追求绝对严谨。

### 需求

1. GUI 项目 + `ui_impact:true` 的提案，UI/UX 原型在**提案阶段**就产出，并**作为 page-design delta** 写入 `deltas/prd/2-product-design/2-page-design/`（裸 HTML，关键几屏 + 各状态）；`design-system.json` 作为审计令牌留在提案目录。**不新增 `ui/` 目录、复用现有 delta 路径映射**——原型仍走 `deltas/prd/**` → `logos/resources/prd/**` 的现有路径映射落入原型图文件夹，但**落盘由专用事务落盘入口 `commitVerifiedPrototypes()` 完成**（严格模式下先做 hash 校验，再原子提交）；**merge-executor 绝不触碰原型资产**，原型落盘不经由 merge 拷贝步骤。
2. 复用现有 `plan-exit`（批准提案）门作为 UI 确认，**不新增门态、不新增确认标记**：**在面板已实际渲染原型的前提下**，用户批准提案 / 启动全自动 / 让 driver 进下一步即构成 UI 确认。
3. **「批准即确认」的前提**：「批准 == UI 已确认」这一等价**仅当面板实际渲染了原型时成立**；在不渲染的旧面板上，用户点批准只是普通方案批准、**不构成 UI 视觉确认**。缺渲染证据时方法论**不宣称 UI 已确认**、给出 advisory 提示，但**不阻断**。
4. **降级兜底不阻塞**：Python3 缺失时以通用风格兜底并在提案标注「未走设计系统」，**不阻塞、不报错**。

### 验收口径

- **非 GUI 项目不受影响**：`product_type` 为纯 CLI / API / 纯后端服务（`service`）/ Skills 时，`openlogos change` 生成的提案结构、S09 生命周期与 `plan-exit` 行为与本特性引入前**完全一致**，不注入任何 UI/UX 相关内容。
- **GUI + 动界面 → 提案阶段有原型**：GUI 项目且本次 `ui_impact:true` 时，提案在 `plan-exit` 门前，`deltas/prd/2-product-design/2-page-design/` 下存在与「UI/UX 变更声明」段所声明页面对应的原型文件（作为 page-design delta），供批准前查看。
- **GUI + 不动界面 → 流程照旧**：GUI 项目但本次 `ui_impact:false` 时，不产出原型，`plan-exit` 行为与不启用本特性时一致。
- **复用批准门即 UI 确认（有前提）**：面板已渲染原型时，用户在既有 `plan-exit` 门批准提案即构成 UI 确认，**不出现新的门或新的确认标记文件**；面板未渲染原型（旧面板）时，该批准仅为普通方案批准，方法论给出「未构成 UI 视觉确认」的 advisory，且**不阻断**流程。
- **判定依据正确**：`ui_impact` 判定依据为项目 `product_type` 与 `tasks.md` 已规划的 `[delta]` 目标，而非扫描 delta 文件内容；先 GUI 判定、后动界面判定的顺序可被验证。
- **降级不阻塞**：Python3 缺失场景下，提案仍可产出通用风格原型并标注「未走设计系统」，`openlogos change` 与后续推进**不报错、不卡住**。

## S35: 提案计划产物左移硬检查（change-lint）

**动因**：pre-implement 判据（测试 ID 在场、`[code]` 标题、delta 结构、部署声明一致性等）此前只在消费点（merge / flow-derive / verify）惰性触发。缺口在写提案阶段产生，却要到 merge 之后才被发现——agent 上下文已丢失，无人值守流程停机等人（真实事故：`code_change_requires_real_test_ids` 在 merge 后阻断）。

**场景**：产出方（change-writer / slice-planner / 下游 driver 的 producer agent）完成 proposal.md / tasks.md / deltas 后，运行 `openlogos change-lint [--slug <slug>] [--format json]` 主动自检；检查全过（exit 0）才可交付，检查红（exit 2）按 violations 逐条修复后重跑。

**验收条件**：
1. 七项检查 L1–L7 全部**复用共享判据函数**（与 flow-derive / merge 同一批实现），严禁第二份判据；
2. 独立顶层命令 `change-lint`，与 `openlogos change <slug>`（S09 创建提案）**零命名空间交集**——`openlogos change lint` 的既有含义（创建 slug 为 `lint` 的提案）不变；
3. 双 exit code 契约：0 = 全过；2 = 检查完成但有违规；1 = 操作错误；输出形态随 `--format` 分流（默认人读文本，`--format json` 走通用信封）；
4. violation code 为 23 码闭合注册表（见 `spec/cli-json-output.md` §3.15），仅语义真实重合的条目携带可选 `flow_reason` 映射；
5. 阶段感知：「产出多少查多少」——plan 段无 delta 时 L4/L6 空集通过；L1/L2/L3/L5 自 write-tasks 完成起恒生效；测试证据按 plan / spec-complete / slice 三级阶段分类判定，且证据集合**限定到本提案**（不采信项目全局无关 ID）；
6. 只读命令（**项目级**）：不写任何项目文件、marker、guard、`logos-project.yaml`、verify 账本、哈希清单；运行前后**整个项目根**的文件集合与内容哈希不变（不止提案目录）；
7. lint 不新增 step/gate/marker、不接入 flow 派生；消费点判据保留（纵深防御）。
