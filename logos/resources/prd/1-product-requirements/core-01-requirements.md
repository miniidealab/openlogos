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

`openlogos adopt` 虽可用 `bootstrap: adopted` 跳过 Initial 文档门禁，但历史默认路径仍把一次全项目逆向 seed 当成首次 change 的前置动作。全库 seed 成本随存量规模增长，而且代码事实快照不能还原产品 Why，也不能保证未来真正触达的场景已经拥有完整需求、时序、API/DB 与测试链。若没有 seed 就拒绝 delta，会把用户重新推回独立建基线；若先写“基线 delta”再写“增量 delta”，同一目标又没有合法的双 delta 顺序语义。

因此低摩擦接入的权威路径是：adopt 完成后直接创建首个 change；change-writer 在规划 tasks 时按本次触达的 feature/scenario 建立规格闭包。目标已存在则在唯一 delta 中修改，目标缺失则在唯一 delta 中创建同时包含可证实存量事实与本次增量意图的完整最终态文档。未触达区域不补。全库 baseline-seed 保留为用户显式选择的扫描加速器，不构成 change 前置，也不恢复逐区域 JIT 人工确认。安全 open run/未提交 staging 可排除后继续；但未终结 seed commit journal 必须在 S05 next、S11 status 与 S39 闭包读取任何 resources/index/coverage 前完成恢复，无法恢复硬报 `baseline_commit_in_progress`，不得读取半新集合。

### P05：部署完成状态依赖 AI 手写 marker
因为 `openlogos verify` 和 `openlogos smoke` 都由 CLI 自动写入对应 PASS/FAIL marker，而部署完成后的 `DEPLOY_DONE` 只能依赖 AI 在 skill 步骤中手写 → 导致部署实际成功后仍可能因为 marker 遗漏而卡在 `ready-to-deploy` → 造成后续 smoke、archive 和状态面板无法继续推进。

### P06：无人值守研发被逐门人工确认阻断
因为受控研发链路把 merge / verify / 部署执行 / smoke / archive 都设成人类确认点 → 导致希望无人值守跑完整链路的用户必须逐门等待人工点击、长流程无法一口气自动跑完 → 造成自动化收益打折；而若简单去掉所有门，又会放行未通过测试的代码，突破安全底线。真正的诉求是"可跳的确认点在受控授权下自动放行，但代码未绿这条红线永不跨越"。

### P07：研发流程不可编排、不可观测、无法接外部门禁
因为内置研发流程的节点固定、完成判定内建、派生状态不外露 → 导致用户无法用 overlay 增删改流程节点、无法把门禁交给外部命令（如 `gh pr checks` / 自定义部署校验脚本）的退出码判定、无法实时观测派生状态供面板 / CI 消费，宿主也拿不到"下一步该用哪个 skill / agent / 脚本"的机器字段 → 造成 OpenLogos 难以嵌入既有 CI 与编排宿主，自动化止步于人工读文本、无法被真正编排。

### P08：大功能一次性实现易失败且难自愈
因为大功能若不拆分、一把梭实现 → 导致切错边界、超预算或测试不绿时缺少逐片收敛路径 → 造成实现频繁返工、无人值守下无法自动修复到"全部切片完成且测试绿"。真正的诉求是"先把已合并规格切成良构切片，再逐片实现并迭代到绿，失败可自愈而非整体推倒"。

## 三、场景总览

32 个场景（编号跳号、最高至 S39，`scenario_counter.next_id=40`）按**能力域**分组如下。各域一行点题，说明它主要回应哪些痛点。

### ① 初始化与存量接入
把空目录或存量代码库低摩擦纳入 OpenLogos 治理（回应 P01/P02/P03/P04）。

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S01 | 初始化 OpenLogos 项目 | 首次在空目录接入 | P01/P02/P03 | P0 |
| S20 | 已有项目接入 OpenLogos | 在已有代码库上首次接入；完成后可直接发起首个 change | P04/P02/P03 | P0 |
| S33 | 存量项目逆向建种子基线 | 用户显式选择 eager seed，或宿主把它作为可选扫描加速器时 | P04 | P1 |
| S17 | 管理模块注册表 | 项目分模块演进时 | P03 | P1 |
| S34 | 管理 feature 分组 | 场景增多需按功能域组织、或存量项目需回填 feature | P01/P03 | P1 |

### ② 变更管理生命周期与状态引导
以受控 Delta 流程组织每一次迭代，并随时回答“现在到哪了、下一步做什么”（回应 P01/P03/P04）。

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S09 | 创建、合并、归档变更提案 | 开始一次受控迭代时 | P01/P03 | P0 |
| S14 | 切换到 launched 生命周期 | 首轮交付完成并进入活跃迭代 | P01/P03 | P0 |
| S05 | 查看下一步建议 | 需要快速知道当前该做什么 | P01/P03 | P0 |
| S11 | 查看阶段进度与活跃变更 | 需要确认当前状态 | P03 | P0 |
| S35 | 提案计划产物左移硬检查（change-lint） | 提案产物（proposal/tasks/deltas）产出后交付前 | P01/P06/P07 | P1 |
| S36 | 生命周期变更影响分类（impact） | 下游 CI 需判定一次 push 区间是否仅含生命周期文件变更时 | P07/P03 | P1 |
| S37 | delta 条目守恒门（条目级隐式删除拦截） | 提案 delta 触及带稳定 ID 条目的规格时（lint 产出点 / merge 消费点） | P01/P06/P07 | P1 |
| S38 | 决策记录沉淀能力（决策理由入 resources） | 提案含「已确定的设计决策」章节、需把拍板理由沉淀为可检索活文档时 | P01/P03/P07 | P1 |
| S39 | 提案规划时按触达目标形成规格闭包 | launched change 触达某个功能/场景、需规划 delta 目标时 | P04/P01/P03 | P0 |

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
把状态与“下一节点该用什么”暴露成稳定机器字段，供脚本与编排宿主直接消费（回应 P07/P03）。

| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S16 | 输出机器可读 JSON | 需要被脚本或工具消费时 | P07/P03 | P1 |
| S28 | next 暴露 next_node 编排提示 | 宿主需把“下一节点用哪个 skill/agent、要不要跑脚本”当机器字段读取并编排时 | P07 | P1 |

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

##### 正常：Windows 外部归档无活跃监听时走快路径
- **GIVEN** Windows 平台，用户从外部终端执行 `openlogos archive <slug>`，且 `logos/.runtime/archive-watch/v1/` 不存在或实例租约快照无「未过期且 projectId 匹配」的活跃 RunLogos 实例（未装/未运行/未监听本项目）
- **WHEN** CLI 执行归档
- **THEN** 直接走现有 rename 快路径，不写协议请求、不引入等待；runtime 目录缺失视为正常路径、不作为错误；行为与未引入本协议时一致

##### 正常：与活跃 RunLogos 实例完成握手后归档
- **GIVEN** Windows 平台，快照存在「未过期、projectId 匹配、capabilities 含 prepare」的活跃实例
- **WHEN** 执行 `openlogos archive <slug>`
- **THEN** CLI 先过既有资格/授权校验，再原子写 prepare 并轮询 ACK；仅当全部实例 ACK 为 released 后才 rename；随后尽力写 result；归档命名、guard 删除时机、授权语义不变

##### 异常：握手超时或实例失败
- **GIVEN** Windows 平台，已写 prepare，但 deadline 前未收齐 released 或任一实例 ACK 为 failed
- **WHEN** CLI 等待 ACK
- **THEN** fail-closed：不 rename、不删 guard、不改状态；返回稳定错误码 `ARCHIVE_WATCH_ACK_TIMEOUT`/`ARCHIVE_WATCH_INSTANCE_FAILED` 与脱敏诊断；尽力写 not-archived/cancelled result

##### 异常：遇不可协调的监听者
- **GIVEN** Windows 平台，(a) 旧版 RunLogos 持句柄但不写租约，CLI 走快路径时 rename 抛 EPERM/EACCES/EBUSY；或 (b) 租约可见但 capabilities 不含 prepare、或协议主版本高于本 CLI 认知
- **WHEN** CLI 尝试归档
- **THEN** 均 fail-closed（不 rename、不动 guard、不自动重试）：(a) 提示「可能有旧版 RunLogos 或其他程序正在监听，请升级或关闭后重试」；(b) 提示「检测到能力不足或更高版本的 RunLogos，请升级 openlogos CLI 或关闭该实例」

##### 正常：宿主已协调时跳过外部握手
- **GIVEN** Windows 平台，RunLogos spawn CLI 时注入仅对子进程可见的一次性 `OPENLOGOS_ARCHIVE_WATCH_PREPARED=<token>`
- **WHEN** CLI 执行归档
- **THEN** 仅当 token 结构有效、cwd/projectId 与绑定项目一致、slug 一致、未过期时跳过握手直接 rename；任一不满足则不跳过；无 `--no-watch-handshake` 全局开关

##### 正常：非 Windows 平台不启用握手协议
- **GIVEN** 平台为 macOS 或 Linux
- **WHEN** 执行 `openlogos archive <slug>`
- **THEN** 不创建/读取/监听任何协议文件、不校验 token、不增加等待，沿用原 archive 路径；无论 CLI/RunLogos 版本新旧

##### 正常：openlogos change 模块归属解析（显式 / 单模块 / 多模块含 core）
- **GIVEN** 项目已 launched，用户执行 `openlogos change <slug>`
- **WHEN** 命令需要确定本次提案的归属模块
- **THEN** 按以下确定性规则解析（fail-closed，issue #17）：
  1. **显式 `--module <id>`**：校验该 id 存在于 `logos-project.yaml` 的 `modules[]`——存在则归属该模块，不存在则非零退出并提示合法 module 清单；
  2. **单模块项目**（`modules` 恰 1 个）：自动归属该模块，输出「自动挂靠，当前只有一个模块」；
  3. **多模块且存在 `id: core`**：默认归属 `core`，输出的提示文案必须与实际选中模块（`core`）一致。
- **AND** 归属结果一致写入 `.openlogos-guard` 的 `module` 字段与 `proposal.md` 头 `> module:`，作为 `change-lint` / `status` / `next` / 模块级门禁的持久事实源。

##### 异常：多模块无 core 未传 --module（fail-closed）
- **GIVEN** 项目为**多模块**且 `modules[]` 中**不存在 `id: core`**
- **WHEN** 用户执行 `openlogos change <slug>` 且**未传** `--module`
- **THEN** 命令 **fail-closed**：以**非零退出码**报错，错误信息说明「多模块且未配置 core，无法推断变更归属」，并为**每个合法 module id 各给出一条完整可执行的重试命令**——以**实际 slug** + 该 id 组成 `openlogos change <实际slug> --module <该id>`，按 `modules[]` 声明顺序列出，**输出不含字面 `<id>` 占位符**（占位符非合法 id、不可直接运行）；
- **AND** **绝不静默选择 `modules[0]`**（YAML 数组顺序不承载归属语义）；
- **AND** 失败必须**原子**：不创建 `logos/changes/<slug>/` 目录、不写 `proposal.md` / `tasks.md` / `deltas/`、不写 `.openlogos-guard`——不残留任何半成品；
- **AND** 提示文案不得再出现「实际选中 `modules[0]`、却声称默认挂靠 core」的不一致（修正原 `change.moduleDefault` 文案）。

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
- **WHEN** 当前环境无法创建沙箱、无法启用运行期写保护、沙箱副本存在解析目标逃逸沙箱的 symlink，或预跑命令尝试写入仓库非白名单路径（沙箱内一次性依赖目录豁免：规范化后存在完整路径段严格等于 `node_modules` 的写入不参与非白名单判定，见功能规格 §2.9）
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
- **WHEN** 当前环境无法创建沙箱、无法启用运行期写保护、沙箱副本存在解析目标逃逸沙箱的 symlink，或 `smoke.command` 尝试写入仓库非白名单路径（沙箱内一次性依赖目录豁免：规范化后存在完整路径段严格等于 `node_modules` 的写入不参与非白名单判定，见功能规格 §2.9）
- **THEN** `openlogos smoke` 失败，输出失败原因、沙箱路径和修复建议，不得写入通过标记


### S20: 已有项目接入 OpenLogos

- **触发条件**：用户在已有代码库（有 `package.json` / `Cargo.toml` / `pyproject.toml` 或其他项目文件）的目录中首次接入 OpenLogos，且当前目录没有 `logos/logos.config.json`。
- **用户价值**：用户不需要把存量代码当作全新项目从零推进，但仍能一次性获得完整 OpenLogos 基础设施、AI 工具资产、语言策略、verify 预跑配置、推荐沙箱策略、Reference 分类目录和变更管理入口；已有项目的根目录 AI 指令文件配置必须被保留。接入完成后可直接描述第一个 change，由 S39 只为本次触达场景补齐规格闭包；无需先执行独立全库基线工作。
- **优先级**：P0
- **主路径**：CLI 检测已有项目信息，交互确认项目名、文档语言与 AI 工具，按 `init` 等价能力生成完整基础设施与 Reference 分类目录；推断并写入 verify 预跑配置或输出 TODO；默认写入兼容的沙箱配置建议；模块写入 `bootstrap: adopted` 与 `lifecycle: launched`，并可继续写入兼容枚举 `baseline_seed_state: required`。该枚举只描述显式可选 eager seed 尚未完成，不是 change gate。CLI 通过 managed block 合并写入 AI 指令文件，输出接入报告并把主动作指向创建 `openlogos change <slug>`；用户显式要求预扫全库时才进入 S33。

#### 验收条件
##### 正常：已有项目完整接入
- **GIVEN** 当前目录存在 `package.json`（或其他项目清单文件），且没有 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** CLI 生成与 `init` 同级别的基础设施：`logos/` 标准目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md`、`CLAUDE.md`、`logos/spec/` 和所选 AI tools 的 Skills / 插件 / 命令资产；`logos/resources/reference/` 下默认生成 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录；`logos-project.yaml` 中模块包含 `bootstrap: adopted` 与 `lifecycle: launched`；`logos.config.json` 包含 `verify.result_path`，并在可推断时包含 verify 预跑配置与推荐沙箱配置；输出接入报告，主动作是创建首个 change

##### 正常：adopt 后直接进入首个 change，S33 为显式可选
- **GIVEN** 当前目录无 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** adopt 在确定性初始化完成时可继续写入 `baseline_seed_state: required` 以兼容既有消费者，但接入报告说明「现在可以直接描述第一个变更，由提案按触达场景补齐规格」；adopt 本身不启动 AI、不声称基线已建立，也不要求 driver 因 `required`/`partial` 自动派发 `brownfield-adopter`。只有用户显式执行 `openlogos baseline-seed` 或宿主显式选择 eager seed 优化时才进入 S33；能力缺失不影响创建 change

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
  - **【R5】缺省规则**：`next_node` 仅当当前建议指向一个真实 flow 节点时输出；命令级建议一律省略——`all_done`、launched 或 adopted 无 active proposal（journal 恢复门通过后的 `required`、安全 `partial`、`seeded` 均建议 `openlogos change <slug>`）、`openlogos launch` 等命令级提示、`--auto` gate 已放行；三态共用 direct-change 分支，不存在 `add-baseline-docs` fixture。
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

### S33: 存量项目逆向建种子基线

- **触发条件**：用户显式要求预扫全库/建立现状 seed，或宿主明确选择 eager seed 作为后续证据定位加速器；`baseline_seed_state: required|partial` 本身不得自动触发派发。
- **用户价值**：需要全局扫描加速时，用户可获得一份**种子基线**（现状快照，只含可从代码忠实验证的事实：模块图、入口、依赖、**场景候选清单**），带 provenance 标记且明确 `verified: false`；完全跳过本场景也能由 S39 在每次 change 中按触达范围形成正式规格闭包。
- **优先级**：P1
- **主路径**：用户或宿主显式选择 eager seed → AI 会话/driver 派发 `brownfield-adopter` skill 扫描代码库 → 逐产物写入含具名章节 `## 逆向基线来源` 与 `candidates[]`（`verified: false`、provenance 派生 `reverse-engineered`）的种子基线 → 经 `openlogos baseline-seed`（`begin` → 写 run staging → `commit`）由 CLI 原子提交并计算 `baseline_seed_state`。完成后产物仅作为 S39 的可选证据索引，不能替代需求、时序、API/DB 或测试规格，也不能改变默认 next 的 change 主动作。

#### 验收条件
##### 正常：显式选择后逆向产出种子基线（producer=AI driver，非 CLI）
- **GIVEN** 模块 `bootstrap: adopted`，且用户/宿主明确选择 eager seed
- **WHEN** AI 会话/driver 派发 `brownfield-adopter`
- **THEN** 在 run 私有 staging 中产出只含可验证事实的种子基线（system-map + 场景候选清单）；每份产物含具名章节 `## 逆向基线来源` 与 `candidates[]`（每候选 `verified: false`、provenance 派生 `reverse-engineered`）；**不写 PRD**；产物经 `openlogos baseline-seed commit` 原子提交，由 CLI 依 manifest 计算 `baseline_seed_state`
- **且** `openlogos adopt`（CLI 本身）绝不启动 AI、不产出逆向内容、不声称基线已建立，driver 也不得只因状态为 `required|partial` 自动派发

##### 正常：能力缺失时不伪造且不阻断 change
- **GIVEN** CLI-only / `--ai-tool other` / 非交互 CI / AI 能力缺失
- **WHEN** adopt 完成，或用户尝试显式 seed 但无法派发逆向扫描
- **THEN** 不创建任何伪造 seed；兼容状态可保持 `required`/`partial`，同时明确仍可直接执行 `openlogos change <slug>`。不得把 seed 能力缺失转化为 change、plan、delta 或 merge 前置失败

##### 正常：覆盖率 tombstone 分母不虚增
- **GIVEN** 一组 `verified: false` 的逆向候选（种子基线现状）
- **WHEN** 重扫删除/合并候选或读取覆盖率
- **THEN** 覆盖率**只读已合并主文档**；覆盖率分母采 tombstone 法（存活候选 ∪ 未经确认的 tombstone），删除/合并候选转 tombstone 仍留分母，百分比不因删除上升

##### 异常：存量 provenance 保守迁移不伪造/不降级
- **GIVEN** 老 adopted 项目已有文档但缺 `## 逆向基线来源` 章节
- **WHEN** 迁移回填 provenance 元数据
- **THEN** 该文档标 `unknown`/`legacy-unclassified`，**不自动推断为 `reverse-engineered` 或 `human-verified`**；无产物时不创建任何 provenance；迁移幂等、写前备份、旧版 CLI 忽略未知字段

#### S33 补充：provenance 扫描侧只采信可重算规范键（provenance-scan-canonical-recompute）

修复 issue「provenance 扫描器把指南文档里的示例章节当真实候选」——扫描侧采信强度低于写侧，导致文档示例毒化基线。以下为 S33 逆向建基线能力的补充验收（能力扩展，不新增场景）：

##### 正常：扫描侧只采信可重算规范键，文档示例不毒化基线
- **GIVEN** 一个从未跑过 baseline-seed 的项目（真·非存量，`logos-project.yaml` 无 `scenarios[]/features[]/baseline_index`），其 `logos/resources/`（如 `reference/` 子目录）存有含 `## 逆向基线来源` 示例章节的文档（官方指南/培训材料/bug report 等），示例候选 `key` 格式合法但与 `anchor` 的规范重算值不一致（教学编造 key）
- **WHEN** 运行 `openlogos feature-backfill`（或任何读覆盖率的命令）
- **THEN** 扫描器**不采信**该编造候选（判据 = `key === candidateKey(module, anchor)` 或 `key === candidateKey(module, alias∈aliases)`，与写侧 `baseline-seed` 同强度）；`feature-backfill` 按“真·非存量”成功、`baseline_candidates_total=0`、**不报** `BASELINE_PROVENANCE_INVALID`；覆盖率分母不含该幽灵候选、新鲜度不因该文档改动打成 `stale`

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
  2. AI 按 prompt 对已有场景 + 逆向候选一并聚类；对逆向候选，回写时**登记进 `scenarios[]`（导航注册表）并分配 `feature`**——**不改动其 provenance `verified` 状态**（`verified` 本变更后冻结、无升级路径，导航 ≠ 可信度）。
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

## S36: 生命周期变更影响分类（impact）

**动因**：来自社区 RFC（issue #9）。下游项目在 launched 生命周期下，CI 依据 Git changed paths 判断一次 push 是否影响可部署制品。一次纯 `openlogos archive` 提交（删除 `logos/.openlogos-guard` + 把 `logos/changes/<slug>/**` 移入带时间戳的 `logos/changes/archive/**`）被 fail-closed 的路径分类器误判为制品变更，重复触发约 482 秒的构建 / migration / rollout / smoke。且生命周期 marker（`MERGE_PROMPT_GENERATED` / `VERIFY_PASS` / `SMOKE_PASS` / `DEPLOY_DONE`）均为空文件，Git exact-content rename 检测会把空 blob 任意配对（如 `VERIFY_PASS -> SMOKE_PASS`），下游无法靠 marker 文件名对应关系识别归档。OpenLogos 此前无任何机器可读的生命周期影响契约，每个项目各自逆向工程 guard / marker / 归档目录结构，易漂移。

**场景**：CI（或宿主脚本）在收到 push 后运行 `openlogos impact --base <rev> --head <rev> [--format json]` 由 CLI 内部安全解析修订并执行 `git diff --no-relative --name-status -z` 取得变更集；或在 CI 平台已有 changed paths 字节流时以管道喂给 `openlogos impact --stdin [--prefix <dir/>]`（完全不依赖 git）。命令按 OpenLogos 官方路径语义契约判定该区间变更是否 lifecycle-only，CI 依 `lifecycle_only` 唯一决策字段决定是否跳过制品构建 / 部署。

**验收条件**：
1. OpenLogos 正式声明**版本化路径语义契约 v1**：lifecycle-only 路径集合 = `logos/.openlogos-guard`、`logos/changes/**`（含 `archive/**`）、`logos/resources/verify/**`、`logos/.runtime/**`；`logos/**` 下其余一切（含 `resources/database/**`、`logos.config.json`）归类 `project`（项目自决，可能进入制品或影响 verify/smoke，OpenLogos 不越界背书）；`logos/` 之外归类 `external`。契约以版本化常量内置于代码，权威文字声明落根 `spec/change-impact.md`（随本提案 delta 产出）与功能规格，同源维护、代码与规范一致。
2. **双输入模式**：`--base <rev> --head <rev>` 模式由 CLI 内部取得 diff 字节流（要求 git 仓库环境）；`--stdin` 模式直接消费管道输入的同格式字节流、完全不依赖 git。两模式对同一（字节流, 前缀）输入必须给出逐字段一致结论。
3. **修订参数安全（防 Git 选项注入）**：`--base`/`--head` 值以 `-` 开头（option-like）或为空一律 `IMPACT_INPUT_INVALID`、不传给任何 git 进程；合法值先经 `git rev-parse --verify --end-of-options <rev>^{commit}` 解析为完整 commit OID，`git diff --no-relative --name-status -z` 位置参数只接收规范化 OID——只读红线覆盖项目内与项目外，命令不得因参数值产生任何文件系统写入。
4. **路径坐标对齐（monorepo 兼容）**：分类按 **OpenLogos 项目根相对路径**判定——`--base/--head` 模式经 `git rev-parse --show-prefix` 自动取得并按段边界剥除项目前缀，`--stdin` 模式由 `--prefix <dir/>` 显式提供（缺省 = 输入已是项目根相对）；项目前缀外路径不静默丢弃、直接归 `external`；输出保留原始输入路径。git 取流**必须显式 `--no-relative`** 中和仓库/用户 `diff.relative=true` 配置（该配置会把路径裁剪为当前目录相对并静默过滤目录外变更，破坏 top-level 坐标与「前缀外不丢弃」不变量），并以对抗配置测试锚定。
5. **判定全部 fail-closed**：只按路径前缀分类，完全不依赖 rename 配对结果、时间戳目录名与 marker 文件名——空 marker 被 Git 乱配对不影响结论；R/C（rename/copy）必须新旧路径双侧均为 lifecycle 才算 lifecycle；覆盖 A/M/D/R/C 五种状态；未知状态字母（T/U/X 等）、解析失败、空 diff、空输入一律 `lifecycle_only: false` 并给出原因。
6. `lifecycle_only` 是**唯一决策字段**；`operations`（如推断出 archive）、`changes`（slug 列表）、`reasons` 为辅助展示信息，文档明确 CI 不得据其做部署决策，也不得以退出码替代 `lifecycle_only` 做决策。
7. **输出契约版本化、只增不改、snake_case**：`--format json` 走通用信封，data 含 `schema_version: "openlogos-change-impact.v1"`、`lifecycle_only`、`files[]`（`status`/`path`/`old_path`/`class`）、`non_lifecycle_paths` 等全 snake_case 字段（遵守 `spec/cli-json-output.md` §1.1）；schema 字段只增不改，破坏性变更须升 v2 并保留 v1 过渡期；data 契约与稳定错误码（`IMPACT_GIT_DIFF_FAILED`、`IMPACT_INPUT_INVALID`）随本提案 delta 登记进根 `spec/cli-json-output.md`（§3.16 与 §6.1 错误码表）。
8. **零行为侵入**：不改变 archive / merge / verify 任何现有行为与输出；不给 archive 新增 stdout JSON envelope；不修改任何 marker 的内容与「逐字节等价」既有契约；命令全程只读、不写任何项目文件。文档同时建议 CI 侧 pin 住 CLI 版本，避免隐式升级引入判定行为变化。


## S37: delta 条目守恒门（条目级隐式删除拦截）

**动因**：来自社区 RFC（issue #12）。一个 launched 项目（133 个已归档提案）实测发现 resources 中的 smoke 规格只剩 12 个用例，而历史编号发到 1–169 号段——一百多个历史用例只存在于 `archive/*/deltas/`。根因是 delta 语义的隐式删除旁路：`MODIFIED = 整章节替换`，AI 产出 MODIFIED 块时若未携带该章节其余未变更条目，merge 忠实替换后旧条目静默消失，全程无任何机器校验兜底（change-lint L1–L7 不查内容守恒）。同时 spec 从未定义 archive 的事实源地位——resources 内容消失后，archive 被动升格为「唯一事实源」，用户无法安全清理归档。设计意图本是「删除必须显式（REMOVED + 说明原因）」，MODIFIED 旁路使之落空。

**场景**：change-writer 产出 delta 后运行 `openlogos change-lint`（产出点，L8），或用户/driver 运行 `openlogos merge <slug>`（消费点）。CLI 对每个目标为带稳定 ID 条目规格的 `.md` delta **逐触及章节、按结构化归属**做守恒对账：锚定章节的既有结构化 ID，凡未在同锚新内容的结构位置保留、未被同锚 `REMOVED-ITEMS` 点名、也未随整节 `REMOVED` 删除者，判为「隐式删除」违规——lint 报红（exit 2）、merge 拒绝生成 MERGE_PROMPT。merge-executor 合并落盘后再做事后点数自检，双保险确保条目只能显式退出 resources。

**验收条件**：
1. **delta 语义收紧（spec 契约，REMOVED 基本语义零改动）**：`MODIFIED` 块不得隐式删除既有条目。显式删除两种形态：删整节走既有 `REMOVED — <唯一章节锚>`（该节 ID 随节显式删除）；删部分条目走 `MODIFIED — <章节锚>`（携带剩余全量）**成对搭配**新增的**纯声明性标记** `REMOVED-ITEMS — <同一章节锚>`（逐行点名 `- <ID> — <删除原因>`；merge 不据其执行编辑，物质变更由 MODIFIED 整节替换完成）。写入 `spec/change-management.md`（随本提案 delta 产出）。
2. **ID 模式注册表（单点维护，结构化归属）**：守恒覆盖的 ID 类别经统一注册表定义，每类含 token 文法 + **结构化抽取位置**双要素——测试 ID（`UT-*` / `ST-*` / `SMOKE-*`，测试表 ID 首列，token 判形复用 `parseTestCaseIds`）、场景 ID（`SXX`，章节标题与场景表行首列）、节号（多级数字 + 可选直接字母后缀或**末级点分字母**的**完整 token**，仅标题行，`2.29.1` ≠ `2.29.2`、`2.2b` ≠ `2.2c`、`2.19.A` ≠ `2.19.B`）；散文提及、非 ID 列单元格、fence 引用不构成保留或点名；从当前全部受管规格标题生成兼容语料做 corpus 回归；严禁在注册表外散落第二份 ID 正则。
3. **章节锚唯一定位（fail-closed）**：段标记章节锚支持单段与标题路径（`父级 > 目标`）两种形态；解析到 0 或 ≥2 个章节一律报 `delta_section_anchor_unresolvable`（诊断区分 not-found / ambiguous 并列候选），禁止取第一个命中、合并同名章节或按内容反猜。
4. **事前点数（主门，确定性 CLI）+ merge 消费点同判据拒绝**：`openlogos change-lint` 新增 L8 守恒检查（逐章节对账报 `delta_implicit_id_removal` / `delta_removed_unknown_id` / `delta_section_anchor_unresolvable`，exit 2；目标主文档不存在时跳过；L4 承认 `REMOVED-ITEMS` 合法标记）；`openlogos merge` 打包调用与 L8 同一判据函数（严禁第二份判据），任一违规即拒绝生成 MERGE_PROMPT（与模板骨架拒绝同级、非零退出）。端到端验收含「部分删除实际应用合并后仅点名条目消失、其余条目逐字节保留」。
5. **事后点数（AI 自检）**：merge-executor 合并落盘后按结构化口径清点主文档实际 ID 集合 == 合并前 − REMOVED 整节 ID − REMOVED-ITEMS 点名 + 新增；不符即报告并暂停、不写 `SPEC_MERGED`（写入 `skills/merge-executor/SKILL.md`）。
6. **archive 审计定位（audit-only）**：提案一旦归档，其内容仅供审计——archive 不是任何规格内容的事实源；`logos/resources/` 必须自足（当前有效规格必须存在于 resources，任何流程 / Skill / CLI 不得依赖读取 archive 内容）；archive 过期后可整体或部分删除，删除不损失任何当前有效信息（含 `MERGE_PROMPT.md` 等纯派生物）。写入 `spec/change-management.md` 与 `spec/directory-convention.md`。
7. **残差如实标注**：仅「结构化 ID 条目内部的无编号散文」不在机器门内（删散文与改写散文机器不可分，改写是 MODIFIED 正当用途）；散文所在章节的整体消失仍被章节级 ID 守恒抓住。
8. **零回归**：既有 L1–L7 行为、merge 对合法 delta 的消费行为、`ADDED / MODIFIED / REMOVED` 三标记基本语义均不变；守恒门是新增拒绝分支（`REMOVED-ITEMS` 为新增纯声明性标记，不引入新的合并操作语义）。新增 3 个 violation code 扩册进 `ChangeLintViolationCode` 闭合枚举（26 码，`spec/cli-json-output.md` §3.15）。
9. **根标题身份按最终章节结构保留**：当 `MODIFIED` 锚唯一命中以稳定 ID 开头的目标根标题（如 `## S10 ...`、`## D12：...`、`## 2.3 ...`）时，控制锚已经保留该根标题身份；L8 必须按“命中的真实根标题 + MODIFIED 正文”计算 retained，不得要求正文重复根标题，也不得误报根 ID 被删除。该豁免只覆盖命中的根标题自身；章节内嵌标题、测试表、场景表等真正消失的既有 ID 仍须逐结构位置报 `delta_implicit_id_removal`。

## S38: 决策记录沉淀能力（决策理由入 resources）

**动因**：来自社区 RFC（issue #12）的补充观察。一个 launched 项目（133 个已归档提案）实测：133 个 proposal **全部**含「变更原因」章节，但只有 4 个含正式「已确定的设计决策」章节；`logos/resources/` 下无任何 ADR / 决策记录类文档。即**设计决策的理由目前只沉淀在 archive 的 proposal 里**——检索率最低（需先知道 slug 才找得到）、却最需要复盘。S37 确立 archive **audit-only** 定位（归档仅供审计、过期可整体删除、不作为任何事实源）后缺口更显性：决策理由若只活在 proposal 里，归档即失联、archive 删除即彻底消失。resources 的「自足性」目前只覆盖规格结论（是什么），不覆盖决策理由（为什么）。

**场景**：change-writer 在提案阶段判断本次变更是否立下值得长期复盘的**拍板决策**（升格判据见验收条件 3）；若有，在 proposal.md 填「已确定的设计决策」章节，并在 `[delta]` 规划 `deltas/decisions/` 决策记录——`openlogos merge` 校验通过后由 **merge-executor 在 apply 时**落入 `logos/resources/decisions/`。决策记录条目化、带全局唯一 `DXX` 编号，纳入 S37 守恒门保护（删除必须显式 `REMOVED` 点名）；推翻旧决策改状态为 `superseded by DYY`（不删除）。由此「为什么这样设计」成为当前有效规格的一部分、可被 AI 与人直接检索，archive 彻底卸下「决策理由唯一载体」负担。

**两阶段 bootstrap（delta-r1 F1）**：`deltas/decisions/` 是尚未注册的 delta 类别（现行 `delta-classify.ts` 判 `delta_path_invalid`），本案先合并能力规格 + 代码注册该类别；**首条 dogfood 决策记录 `core-D01` 由后续变更**在注册上线后产出。

**验收条件**：
1. **沉淀位置、命名与 DXX 唯一性（delta-r1 F5）**：决策记录存于顶层 `logos/resources/decisions/`（与 `prd`/`api`/`test` 平级——决策跨 Why/What/How 三层通用，单一目录使 AI 只需看一处）；文件命名 `<module>-DXX-<slug>.md`；`DXX` 全局唯一，由 `logos/logos-project.yaml` 新增 `decision_counter.next_id` 维护（对齐 `scenario_counter`/`feature_counter` 的「AI 维护、CLI 不取号、仅读取侧解析」语义）。**取号由 merge-executor 在 apply 时按闭合公式执行（delta-r2 F5：基准只含已落盘、不含本批）**：`base = max(configured_next_id ?? 1, max(【已落盘】DXX，空集=0)+1)`——**基准只从 `resources/decisions/` 已落盘记录取 max，绝不纳入本批待落盘 DXX**（否则首条拟号 D01 会被 `max(1,1+1)` 算成 D02 后因「文件名≠allocated」自拒）。本提案候选按稳定序（文件名 slug）排列，第 `i` 条（0 基）`expected_i = base + i`；校验「文件名==标题==`expected_i`」、与既有资源或本提案内重复即拒绝、全部 apply 成功后持久化 `next_id = base + 候选数`。仅递增 next_id、或把本批候选纳入 max，均不能保证唯一。
2. **决策记录文档结构（标准 ADR 变体）**：每条至少含——状态（proposed / accepted / superseded by DYY）、背景、决策（一句话可引用）、理由（含关键论据与实证）、备选方案（被否选项 + 否掉原因）、影响面（约束哪些规格 / 代码 / 流程）、来源（产生该决策的提案 slug + 相关 issue 链接）。
3. **升格判据（与「变更原因」分工，写入 change-writer 指引）**：「变更原因」是每案必填的叙述性动机，留在 proposal、**不机械复制进 resources**（否则把 archive 检索污染搬进 resources）。决策记录是**少数**值得长期复盘的拍板，满足任一即升格：① 立了未来变更必须遵守的**不变量 / 约束**；② 在**真实备选间**做了取舍且被否项将来可能被重提；③ **跨多个规格 / 组件**。一句话测试：「读合并后的规格本身能否还原这个 why？」能→不升格；规格只说 what、why 与被否方案会丢→才升格。bug 修复 / 机械重构 / 发版 bump / trivial 改动不升格。
4. **change-writer 接入 + 落盘所有权（delta-r1 F2；不强制、零负担）**：proposal 模板新增**可选**「已确定的设计决策」章节；含该章节的提案，`[delta]` 必须规划 `deltas/decisions/` 决策记录 delta；**不含该章节的提案全流程行为与现状完全一致（零回归、零负担）**。决策记录走既有 `deltas/ → merge（只校验+生成 MERGE_PROMPT）→ merge-executor apply（实际落盘+取号+持久化计数器+更新索引+SPEC_MERGED，失败回滚/幂等）` 通道，**不新增 `openlogos decision` CLI 命令**。
5. **change-lint warning（Q3，不阻断门；契约见 cli-json-output §3.15，delta-r1 F4）**：proposal 含「已确定的设计决策」章节但 `[delta]` 无 `deltas/decisions/` 任务时，`openlogos change-lint` 产出 **warning 级**提示（走独立 `warnings[]` 通道，不失败、不改 exit code、不进 `ChangeLintViolationCode` 闭合枚举；`warnings` 仅非空时出现、否则省略以保零回归）。理由：「是否值得记决策」是判断题、非机器可判定事实，硬门会逼写噪音或用主观标准卡门；对比 S37 守恒门可为 violation（「有没有隐式删 ID」机器可判定），本项不同故 warning。
6. **守恒与 superseded 联动（S37）**：`DXX` 纳入 S37 守恒门 ID 模式注册表（`ID_PATTERN_REGISTRY` 单点扩册，判据函数零改动，见 §2.33.3 预留），决策记录条目删除必须显式 `REMOVED` / `REMOVED-ITEMS` 点名；推翻旧决策不删除、改状态为 `superseded by DYY` 并由新记录引用——决策历史留在 resources 活文档内、天然可检索、不依赖 archive。
7. **resource_index 收录（delta-r1 F3，需扩展扫描器）**：现行 `cli/src/lib/sync-resource-index.ts` 的 `scanCandidateFiles()` 白名单不含 `decisions`、`inferResourceDesc()` 无 DXX 规则，故必须**扩展统一扫描器**（`scanCandidateFiles()` 纳入 `decisions/`、`inferResourceDesc()` 增 `<module>-DXX-*.md` 内容化 desc 规则），`openlogos index` / `sync` 才能发现新决策记录、生成内容化描述并进入 `resource_index`——直接解 issue #12「需先知道 slug 才找得到」。**不得**声称既有机制自动收录。端到端验收须从「索引无该项」起跑权威 index/sync、断言路径+desc 补入且幂等（ST-S38-06）。
8. **零回归 + 非目标**：不追溯为存量已归档提案补写决策记录（项目自行按价值挑选沉淀、走正常提案）；不强制所有提案产出决策记录；不实现 archive 保留策略 / `archive --prune`（issue #12 请求 2，团队已暂缓，与本能力正交）；不改 `ADDED / MODIFIED / REMOVED` 语义与既有 merge / archive / change-lint 对无决策章节提案的行为。

## S09 Plan 阶段决策澄清协议第一版

### 背景与用户价值

复杂变更在形成 proposal 时可能同时涉及产品边界、责任归属、数据迁移、兼容策略、安全隐私、部署、公开发布和验收标准。若 Agent 为了尽快填满模板而把推荐答案当成用户决定，后续 Delta、实现和发布都会建立在未经确认的假设上。

OpenLogos 必须在既有 `write-proposal -> write-tasks -> plan-exit` 内提供可恢复、可校验的决策澄清协议。该协议只在存在高影响未决事项时要求人类回答；简单且事实充分的变更保持零额外问答。

### 功能需求

1. Agent 在提问前必须读取仓库、配置、规格、Git/CI 和运行环境中可可靠获得的事实；事实问题不得反问用户。
2. 新 proposal 必须包含 `openlogos/clarification@1` 结构化区块，持久化模式、状态、影响声明、已确认决定、未决队列和低风险默认值。
3. `adaptive` 模式只在存在高影响未决事项时逐问；`deep` 完整扫描高影响决策树；`provided` 校验用户已提供的决定，不跳过一致性检查。
4. 每轮只向用户提出一个当前最上游的决定，并同时说明影响、推荐答案、推荐理由及至多两个真实备选。
5. 高影响决策至少覆盖 `product`、`ownership`、`data`、`compatibility`、`security_privacy`、`deployment`、`release`、`external_commitment`、`acceptance` 九类。
6. `impacts` 固定声明 `data`、`compatibility`、`security_privacy`、`public_release`、`external_commitment` 五类条件性风险；每类为 `none|required` 并提供非空理由。
7. `none` 表示本次无需用户选择：可能没有影响，也可能已有仓库事实或项目政策把方案唯一确定；`required` 表示仍存在必须由用户选择的高影响方案。
8. proposal 声明需要部署时，必须有 `category: deployment`、`source: user` 的决定，覆盖目标环境、部署方式、回滚方案和成功/smoke 证据。
9. 任一 `impacts.*.status=required` 时，必须有匹配 `category`、`source: user` 的决定；`public_release` 对应 `category: release`。推荐答案、Agent 默认值、`--auto` 和已有文档均不能冒充用户确认。
10. 每个尚未满足的条件性必选类别必须恰有一个同类别、内容完整的 `unresolved` 项；缺失或重复时契约非法，不能产生没有问题数据的 pending 死锁。
11. 产品范围、责任归属和验收标准由 Agent 结合语义识别；命中高影响歧义时同样进入未决队列，但不得把所有简单提案变成固定问卷。
12. Agent 必须在持久化前按依赖拓扑、固定类别顺序和 CXX 数字顺序稳定排序；`unresolved[0]` 的全部依赖必须已在 decisions，否则契约非法，CLI 不得跳项或自行重排。
13. 已确认决定和未决队列必须落入 proposal，跨进程和跨会话重读结果一致；RunLogos 等宿主不维护第二份权威状态。
14. `clarification.status=complete` 只表示 `write-proposal` 具备完成条件，不等于方案已批准；最终仍复用 `plan-exit`。
15. `next --auto` 仅提供既有流程执行授权，不能替用户回答未决高影响方案；存在未决事项时必须 fail-closed 并保持在 `write-proposal`。
16. 方案决策与执行授权必须分层：人工模式下 merge、verify、部署执行、smoke、archive、push 继续按各自确认点处理；公开发布不能由本地部署或普通 push 授权自然推导。

### 验收条件

- 简单、事实充分且五类影响均为 `none + reason` 的提案可以直接完成澄清，不增加问答。
- `impacts` 缺字段、状态非法、理由为空、重复 CXX、依赖不存在、循环依赖或完成状态与未决队列冲突时，返回 `clarification-contract-invalid`。
- 数据、兼容、安全隐私、公开发布、外部承诺或部署任一必选类别缺少匹配用户决定时，`proposal_filled=false`，`status/next` 保持 `write-proposal`。
- 上述缺失决定若有同类别完整 unresolved，则为可恢复 pending 并输出完整 `next_decision`；若缺少或重复对应 unresolved，则返回 `clarification-contract-invalid`。
- `status/next --format json` 输出稳定、去重的 `required_categories` 和完整 `next_decision`，宿主无需解析 Markdown 推导完成状态。
- `next --auto` 遇到未决高影响决定时不写 `PLAN_APPROVED` 或 `GATE_AUTO_PASSED`，不进入 `write-tasks`、Delta 或实现。
- 已越过 plan 的历史提案不回退；仍在 writing 且缺少区块的历史提案获得补齐提示；未知 schema 版本保守停止。
- 本能力的 OpenLogos UT/ST 与 reporter 全部通过；真实 Agent 是否先查事实、一次一问和准确记录由 RunLogos 行为评测负责。

## S13/S16/S27/S28/S31/S32 多切片验收边界与自动恢复要求

### 用户价值

多切片提案必须允许每一片在其真实交付范围内独立验收，同时继续保留最终全量回归硬门。未来切片尚未实现不得被伪装成 pass/skip，也不得被计入当前覆盖率分母。自动化宿主在缺少机器清单时应获得可执行恢复动作，而不是把流程停在无法修复的失败态。

### 验收条件

#### 正常：当前切片 checkpoint 只计算 eligible 测试

- **GIVEN** 活跃提案已由 `slice-planner` 生成有效 `TEST_SLICE_MANIFEST.json`，且仍有未完成切片
- **WHEN** 用户执行 `openlogos verify`
- **THEN** 命令以 `slice-checkpoint` 模式运行；覆盖率分母只包含基线回归、已通过 checkpoint 的切片和本轮 attempted slice 所属测试；后续切片测试列入 `pending_test_ids`，不产生 reporter 结果

#### 正常：checkpoint 通过推进但不伪造最终通过

- **GIVEN** 当前 attempted slice 的 eligible 测试全部覆盖且通过
- **WHEN** checkpoint Gate 收敛
- **THEN** CLI 以稳定 `slice_id` 追加 checkpoint 事实，清除该切片的失败态并允许推进下一片；不得写最终 `VERIFY_PASS`

#### 正常：所有切片完成后执行 final

- **GIVEN** manifest 中所有切片均已有通过 checkpoint，且 `[code]` 顶层与子任务全部勾选
- **WHEN** 用户再次执行 `openlogos verify`
- **THEN** 命令切换为 `final`，以全部已定义非 manual 测试为覆盖率分母并维持 100% 覆盖和一致性硬门；只有 final 通过才写 `VERIFY_PASS`

#### 异常：真实 eligible 失败锁定同一切片

- **GIVEN** 当前 attempted slice 的 eligible 测试存在失败、非法结果或覆盖不足
- **WHEN** checkpoint Gate 失败
- **THEN** CLI 写入带稳定 `attempted_slice_id` 的失败事实与 `LOOP_ITERS`，repair 仍指向该切片且只消耗该切片预算；checkbox 是否已前移不得改变归属

#### 恢复：缺少或可恢复失效的 manifest

- **GIVEN** 多切片代码提案已完成 spec-complete，但 `TEST_SLICE_MANIFEST.json` 缺失、schema 非法或 fingerprint 漂移且可由既有规格确定性重建
- **WHEN** 用户或宿主调用 `status`、`next` 或 `verify`
- **THEN** OpenLogos 不写 `VERIFY_FAIL`、不追加代码 repair 迭代，输出稳定原因和 `next_node.id=plan-slices`、`skill=slice-planner`、所需 artifacts；RunLogos 等宿主可据此派发 Agent 重建并自动重试

#### 异常：恢复仍存在真实歧义

- **GIVEN** 测试 ID 无法唯一归属切片，或有未知、重复归属且多次恢复仍非法
- **WHEN** 恢复校验运行
- **THEN** 流程以明确诊断保守阻塞，保留既有 `[code]`、checkbox 与 checkpoint，不得静默猜测归属或退回全量误失败

### 非目标

- 不降低 final verify 的全量覆盖要求。
- 不为未来测试写 pass/skip 结果。
- 不允许宿主解析 `tasks.md` 建立第二套验收算法。
- 不把本机全局安装授权扩展为 npm publish、Git tag、GitHub Release、官网发布或 push。

## 公共 AI Tool Adapter 与 ZCode 完整宿主集成需求

### 用户价值

OpenLogos 使用者应能像选择 Claude Code、OpenCode、Codex 或 Cursor 一样，在 `init`、`adopt`、`sync` 与 `launch` 中选择 ZCode，并获得同等级的 OpenLogos 指令、Skills、Commands、插件 Hook、阶段上下文和写入门禁。新增宿主不得要求用户理解 OpenLogos 内部的条件分支，也不得改变既有宿主的可观察行为。

### 公共能力要求

1. AI 工具标识必须新增规范值 `zcode`；标量、数组和 `all` 三种配置形态均须支持，`all` 必须稳定展开为所有可部署宿主且不包含 `other`。
2. 工具解析、别名归一化、能力声明、资产来源、部署目标、指令生成和生命周期刷新必须由单一 Adapter Registry 驱动；`init`、`adopt`、`sync`、`launch` 不得继续各自维护宿主枚举分支。
3. 每个 Adapter 必须显式声明是否支持 instructions、skills、commands、agents、plugin、SessionStart 与 PreToolUse；调用方只消费能力，不根据宿主名称推断能力。
4. 现有 `claude-code`、`opencode`、`codex`、`cursor`、`other` 以及历史单值配置必须保持兼容；未知工具仍 fail loud，不得静默回退到 Cursor。

### ZCode 资产与协议要求

1. ZCode 插件必须使用 `.zcode-plugin/plugin.json` 作为首选清单，并提供 `skills/<name>/SKILL.md`、`commands/*.md`、必要的 `agents/*.md` 与自动发现的 `hooks/hooks.json`；不得把项目级 `.zcode/config.json` 当作团队 Hook 分发入口。
2. 根 `AGENTS.md` 继续通过 `OPENLOGOS:BEGIN` / `OPENLOGOS:END` 托管片段维护。ZCode 仅保证读取工作区根 `AGENTS.md`，因此所有关键方法论约束必须在该托管片段内自足，不依赖子目录 AGENTS、`@include` 或 `CLAUDE.md`。
3. SessionStart 与 PreToolUse 必须由插件 Hook 调用宿主无关 Node.js runtime。输入同时接受 ZCode camelCase 与 Claude Code snake_case 别名；输出使用 ZCode `hookSpecificOutput` 协议。
4. PreToolUse 拒绝必须同时返回 `permissionDecision: "deny"` 与非空原因，并以退出码 2 形成阻断捷径；输入非法、项目状态不可判定或 guard 求值异常时必须 fail closed，不能以 Hook 可恢复失败绕过写入门禁。
5. 插件安装目录与用户配置、项目自有 Skills/Commands/Agents 必须分属不同所有权边界；同步只能更新 OpenLogos 托管资产，不得删除、覆盖或吸收用户资产。

### 场景验收条件

#### S01 初始化

- `--ai-tool zcode` 能生成 `logos.config.json`、根 `AGENTS.md` 托管片段、ZCode 插件清单、Skills、Commands、Agents 与 Hooks；输出逐项报告目标路径。
- `--ai-tool all` 包含 ZCode 且重复执行幂等；既有四个宿主的路径、文案和资产字节语义保持兼容。
- 任一托管 marker 不完整或 ZCode 目标路径与用户资产冲突时，初始化在覆盖前失败，并列出冲突路径。

#### S08 同步

- `sync` 依据 Adapter Registry 刷新 ZCode OpenLogos 资产与 launched/initial 指令变体，保留插件目录内非 OpenLogos 文件及根 `AGENTS.md` 托管片段外内容。
- 同步成功后才刷新 `.openlogos-sync.json`；ZCode 资产复制、Hook 配置或原子替换任一步失败时，版本戳保持原值。

#### S09 变更生命周期

- 新 ZCode session 的 SessionStart 能注入当前 module、active change、proposal step 和该阶段可写范围；已有会话不要求热刷新，资产更新后以新 session 验证。
- PreToolUse 对 Write/Edit/Bash 等写入工具执行与现有 guard 相同的 proposal-step allowlist；无 guard、越界目标、路径解析失败和状态解析失败均不得放行。

#### S14 launched 刷新

- `launch` 通过注册表选择 ZCode Adapter，刷新 launched 指令、Skills、Commands、Agents 和插件 Hook；normal/adopted 既有门禁语义不变。
- 已 launched 的 adopted 模块重复执行时幂等收敛，不复制 Hook、不重复注册插件、不改变用户资产。

#### S20 存量接入

- `adopt --ai-tool zcode` 在保留既有根 `AGENTS.md`、`.zcode` 配置与用户插件资产的前提下部署 OpenLogos ZCode 插件，并继续直接引导首个 change。
- 大小写变体、残缺托管 marker、同名非 OpenLogos 插件和不可写目标必须在写入前诊断；失败不得留下半部署插件或伪造接入完成信息。

### 部署与非目标

- 本能力必须经 staging 真实 npm tarball 安装和真实 ZCode 客户端新 session 验证；smoke 覆盖插件发现、Skills/Commands、SessionStart、PreToolUse deny、幂等同步和既有宿主回归。
- 不涉及数据库迁移，不新增 HTTP/RPC/消息 API。
- 本提案不实现 Qoder、TraeCode CLI 或 WorkBuddy，也不授权 npm publish、Git tag、GitHub Release、官网发布或 git push。

## Qoder 完整宿主集成需求

### 用户价值

OpenLogos 使用者应能在 `init`、`adopt`、`sync` 与 `launch` 中选择 Qoder，并获得与现有宿主同等级的根指令、Skills、Commands、Agents、SessionStart 阶段上下文和 PreToolUse 写入硬门禁。接入 Qoder 不得要求用户理解宿主分支，也不得改变未选择 Qoder 的历史配置与既有宿主行为。

### P02 公共宿主能力要求

1. AI 工具规范值新增 `qoder`；标量、数组和 `all` 均须支持，`all` 以 Registry 稳定顺序包含 Qoder 且排除 `other`。
2. Qoder capability 必须显式声明 instructions、skills、commands、agents、plugin、sessionStart、preToolUse；生命周期命令只能按能力消费，不得按宿主名推断。
3. Qoder 模板必须随真实 npm tarball 分发；源码树存在但 tarball 缺失任一声明资产时，构建或部署预检失败。
4. 既有 Claude Code、OpenCode、Codex、Cursor、ZCode 的规范值、目标路径、配置合并与输出契约保持兼容；未知值继续 fail loud。

### Qoder 资产与 Hook 协议要求

1. 插件使用 `.qoder-plugin/plugin.json`，并提供 `skills/<name>/SKILL.md`、`commands/**/*.md`、必要 `agents/*.md`、`hooks/hooks.json` 与共享 Node.js runtime；manifest 与约定目录不得造成同一组件重复加载。
2. Hook 命令通过 `QODER_PLUGIN_ROOT` 定位 runtime。OpenLogos 不覆盖 Qoder 用户 settings、不同 identity 插件、未知文件或根 `AGENTS.md` 托管片段外内容。
3. `SessionStart` 输出合法 `hookSpecificOutput`，其中 `hookEventName` 为 `SessionStart`、`additionalContext` 非空并与当前磁盘状态一致。
4. `PreToolUse` 接收 Qoder 官方 `session_id`、`cwd`、`tool_name`、`tool_input` 等字段；allow 输出 `permissionDecision: "allow"`，deny 输出 `permissionDecision: "deny"`、非空 `permissionDecisionReason` 并以 exit 2 阻断。
5. 非法 JSON、缺失必需字段、未知潜在写工具、路径穿越/symlink 逃逸、状态矛盾或决策异常必须 fail-closed；其它非零退出不得被计为安全阻断成功。

### 场景验收条件

#### S01 初始化

- `--ai-tool qoder` 生成配置、根 AGENTS 托管片段和完整 Qoder 插件资产；`--ai-tool all` 包含 Qoder，重复规划幂等。
- 任一模板缺失、manifest 非法、owner 冲突或 marker 残缺时，在覆盖用户资产前失败并报告精确路径。

#### S08 同步

- `sync` 经 Registry 只刷新 OpenLogos 托管的 Qoder 资产，保留 Qoder settings、用户插件和未知文件。
- 只有全部 Adapter 成功后才刷新 `.openlogos-sync.json`；Qoder 暂存、替换或读回失败时回滚且版本戳不变。

#### S09 变更生命周期

- 新 Qoder CLI session 的 SessionStart 注入 module、active change、`proposal_step`、精确可写范围和下一确认点。
- 每次 PreToolUse 重新读取磁盘事实；delta-writing 只允许当前提案 delta/tasks，ready-to-merge 立即收紧，源码、提案外路径和解析异常均 deny。

#### S14 launched 刷新

- `launch` 经 Registry 刷新 Qoder launched 指令、Skills、Commands、Agents 与 Hooks，全部 Adapter 成功后才提交 lifecycle。
- adopted + launched 重复执行幂等；用户 settings、插件和 AGENTS marker 外内容字节不变。

#### S20 存量接入

- `adopt --ai-tool qoder` 在保留既有 AGENTS、Qoder settings 与非 OpenLogos 插件的前提下部署完整资产，并继续直接引导首个 change。
- 冲突或中途失败不得留下半套 logos、插件、配置或伪造接入完成信息。

### 部署与非目标

- 必须由本提案真实 tarball 与真实 Qoder CLI 新 session 在隔离 staging 验证插件发现、Skills/Commands/Agents、SessionStart、PreToolUse allow/deny、sync/launch 幂等和既有宿主回归。
- 不新增 HTTP/RPC/消息 API，不涉及数据库迁移。
- 不实现 TRAE/TraeCode、WorkBuddy 或其它新宿主；不授权 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。

## WorkBuddy 完整宿主集成需求

### 用户价值

OpenLogos 使用者应能在 `init`、`adopt`、`sync` 与 `launch` 中选择 WorkBuddy，并获得与既有宿主同等级的指令、Skills、Commands、Agents、SessionStart 上下文和 PreToolUse 写入硬门禁。接入不得要求 OpenLogos 读取或改写 WorkBuddy 原生记忆，也不得改变未选择 WorkBuddy 的历史配置和既有宿主行为。

### P02 公共宿主能力要求

1. AI 工具规范值新增 `workbuddy`；标量、数组和 `all` 均须支持，`all` 按 Registry 稳定顺序包含 WorkBuddy 并排除 `other`。
2. WorkBuddy capability 必须显式声明 instructions、skills、commands、agents、plugin、sessionStart、preToolUse；生命周期入口只消费能力，不得按宿主名推断。
3. WorkBuddy 插件模板及 runtime 必须进入 `0.13.28` 真实 npm tarball；源码存在但制品缺少任何声明资产时，构建或部署预检失败。
4. Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder 的规范值、目标路径、配置合并和输出契约保持兼容；未知工具继续 fail loud。

### WorkBuddy 资产、记忆与 Hook 要求

1. 原生插件使用 `.workbuddy-plugin/plugin.json`，并提供 `skills/`、`commands/`、必要的 `agents/`、`hooks/hooks.json` 与共享 Node.js runtime；Hook 不写入技能 frontmatter。
2. Hook 命令以 `${CODEBUDDY_PLUGIN_ROOT}` 定位 runtime，不虚构 WorkBuddy 专属环境变量，不硬编码用户安装目录。
3. WorkBuddy 原生记忆属于宿主和用户。OpenLogos 不读取、写入、清空、迁移或把它当作授权状态；同步、接入和回滚前后原生记忆必须保持不变。
4. `SessionStart` 只从项目磁盘事实生成 module、active change、`proposal_step`、可写范围和下一确认点，不读取个性化记忆，输出不构成授权。
5. `PreToolUse` 每次调用重新读取 guard 与提案状态。allow 返回 `permissionDecision: "allow"`；deny 返回 `permissionDecision: "deny"`、非空原因并以退出码 2 阻断。
6. OpenLogos 只拥有自身插件 identity 和托管片段；WorkBuddy settings、其它插件、项目自有资产和原生记忆均须保留。

### 场景验收条件

#### S01 初始化

- `--ai-tool workbuddy` 生成配置、托管指令和完整原生插件资产；`--ai-tool all` 包含 WorkBuddy，重复规划幂等。
- 模板缺失、manifest/Hook 非法、owner 冲突或 marker 残缺时，在覆盖用户资产前失败并报告精确路径。

#### S08 同步

- `sync` 只刷新 OpenLogos 托管的 WorkBuddy 资产，保留 settings、其它插件、未知文件和原生记忆。
- 只有全部 Adapter 成功后才刷新 `.openlogos-sync.json`；WorkBuddy 暂存、替换或读回失败时回滚且版本戳不变。

#### S09 变更生命周期

- 新 WorkBuddy session 的 SessionStart 注入当前磁盘状态；已有会话不承诺热刷新。
- PreToolUse 覆盖 CLI 与桌面端潜在写工具别名；无 guard、越界路径、未知潜在写工具、解析失败和决策异常均 fail-closed。

#### S14 launched 刷新

- `launch` 经 Registry 刷新 WorkBuddy launched 指令、Skills、Commands、Agents 与 Hooks；全部 Adapter 成功后才提交 lifecycle。
- adopted + launched 重复执行幂等，用户 settings、插件、项目资产和原生记忆保持不变。

#### S20 存量接入

- `adopt --ai-tool workbuddy` 在保留既有项目指令、settings、用户插件和原生记忆的前提下部署 OpenLogos 插件，并继续引导首个 change。
- 冲突或中途失败不得留下半套配置、插件或伪造接入完成信息。

### 部署与非目标

- 必须使用本提案构建的 `0.13.28` 真实 npm tarball，在隔离 staging 的 WorkBuddy 5.3.5+ 新会话验证插件发现、组件、SessionStart、PreToolUse allow/deny、记忆零写入、幂等与回滚。
- 不新增 HTTP/RPC/消息 API，不涉及数据库迁移，不实现公开发布。
- 本提案不授权 npm publish、Git tag、GitHub Release、官网部署或 `git push`。

## TRAE 国际版/CN non-deployable 需求

### 用户价值与安全底线

OpenLogos 必须如实区分“宿主存在上下文扩展能力”和“宿主可部署 fail-closed hard guard”。在 TRAE 国际版与 CN 未共同证明内置写工具能被项目资产于执行前可靠阻断时，用户不得看到 TRAE 已受支持、可部署或已被 `all` 覆盖的声明，避免软提示被误认为安全边界。

### P02 宿主选择要求

1. `AiToolAdapterRegistry` 不得包含规范 id `trae` 或相关别名；`all` 继续稳定展开现有七个可部署宿主并排除 `other`。
2. CLI 帮助、交互选择、结构化支持列表和未知值错误不得展示 TRAE 为支持项；显式输入 `trae` 必须按未知或不支持宿主 fail loud，且不得写出任何 TRAE 托管资产。
3. 不得创建空 capability、non-deployable 占位 Adapter 或按宿主名写入特殊分支。
4. 既有 Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy 的规范值、稳定顺序、配置兼容和资产行为保持不变。

### 能力与所有权要求

1. TRAE Rules、Skills、自定义 Agent 与 MCP 只视为上下文或扩展能力；不能证明内置 `Write`、编辑或命令工具在执行前受 OpenLogos hard guard 控制。
2. TRAE 原生记忆、settings、账号、用户 Rules/Skills/Agents/MCP、Commands 和未知文件归宿主或用户所有。OpenLogos 不读取正文、不写入、不迁移、不清理，也不将其用作授权状态。
3. 不建立 TRAE `PreToolUse` normalizer、wrapper、模板或共享 `GuardDecisionService` 映射；项目 Hook 文件存在、用户人工确认或 MCP 拒绝均不能替代 hard enforcement。

### 真实客户端门禁与重新开启条件

- TRAE 国际版 `3.5.91` 与 CN `3.3.93` 的真实内置写入均在项目 `PreToolUse` 未执行时改变目标字节，当前能力状态为 **BLOCKED**。
- 未来新提案必须让两个受支持客户端在隔离工作区共同通过完整 fail-closed 矩阵，包括 allow、deny、越界、路径穿越、symlink、未知潜在写工具、损坏输入、runtime 缺失、状态矛盾和超时。
- 每个 deny 均须证明：工具没有执行、非空理由可见、目标 SHA-256 不变；项目级 guard 还须在不静默修改用户信任状态的条件下可部署并可靠启用。

### 版本、部署与非目标

- 目标 OpenLogos 版本为 `0.13.29`；本需求只记录不支持结论，不产生 TRAE 代码或制品。
- 因能力门 BLOCKED，不构建或安装用于 TRAE 的 `0.13.29` staging tarball，不触发 `0.13.28` 回滚，不执行 smoke 或公开发布。
- 不新增 HTTP/RPC/消息 API，不涉及数据库或数据迁移。

## TRAE 本地负向部署与 Smoke 需求

### 用户价值与范围

OpenLogos 必须用真实安装制品证明 TRAE non-deployable 合同没有只停留在源码测试。部署对象是 OpenLogos CLI `0.13.29` 候选 npm tarball，而不是 TRAE Adapter；验证环境只能是一次性 `local-isolated`，不得触达真实用户 HOME、全局 npm、真实项目或 TRAE 客户端状态。

### S01 候选安装态初始化要求

1. runner 必须从 `OPENLOGOS_TRAE_LOCAL_TARBALL` 安装版本精确为 `0.13.29` 的真实 tarball，记录包名、版本、清单、大小、SHA-256 和实际 `openlogos` 入口；入口必须解析到一次性 npm prefix。
2. 安装态执行显式 `init --ai-tool trae` 时，必须在配置、logos 目录或任何资产首次写入前以未知/不支持宿主失败；错误支持列表只含既有七宿主。
3. 安装态执行 `init --ai-tool all` 时，只初始化 Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy，顺序稳定且不创建 TRAE Adapter、Rules、Skills、Agent、Hook、MCP、记忆或其它 `.trae/**` 资产。
4. 每条负向路径须保存退出码、脱敏 stderr、写入计划摘要和 fixture 前后文件清单/SHA-256；失败不得被 `skip` 或“客户端已安装”替代。

### S08 候选安装态同步要求

1. `sync` 的 `all` 展开、资产计划和结果必须继续只含既有七宿主；不得因发现 TRAE 国际版/CN、登录状态或工作区已有 `.trae/**` 而改变 Registry。
2. 手工配置含 `trae` 时，必须在总事务及版本戳写入前 fail loud，不提交其它宿主的部分同步。
3. 预置的 `.trae/**`、settings、账号占位、`enabled_folders`、Rules、Skills、Agents、Hooks、MCP、原生记忆和未知文件不得进入扫描、计划、暂存、备份、删除或回滚集合；只比较不透明文件清单与 SHA-256，不读取记忆正文。
4. `init` 与 `sync` 的严格配置失败、七宿主成功和用户边界证据须来自 tarball 内 CLI，禁止 workspace link 或源码入口。

### S19 本地部署后负向 Smoke 要求

1. `openlogos smoke --env local-isolated` 只能在该提案 `[deploy]` 全部完成并存在同环境 `DEPLOY_DONE` 后执行；缺失、环境不一致或部署决策冲突均不得产生 `SMOKE_PASS`。
2. dispatcher 必须发现并实际执行 SMOKE-core-124～SMOKE-core-129；每个结果写入合法 JSONL，至少包含 `id`、`status`、`timestamp`、`duration_ms`、`environment="local-isolated"`、候选 tarball SHA-256 和脱敏证据路径。
3. 任一用例缺失、skip、fail、reporter 缺失、审计链不完整或用户边界哈希变化，整个 smoke Gate 为 FAIL。
4. runner 不启动 TRAE 内置写/编辑/命令工具，不重新运行失败的 capability 矩阵；wrapper 直调、文件存在、UI 或软控制均不得被标记为 PASS。

### 制品、回滚与公开副作用要求

- `cli/package.json`、`cli/package-lock.json` 与随包插件 manifest 的候选版本必须一致为 `0.13.29`。
- `OPENLOGOS_TRAE_ROLLBACK_TARBALL` 必须是版本精确为 `0.13.28`、可离线安装且 SHA-256 可追溯的真实 tarball。
- 同一隔离 prefix 必须实际完成 `0.13.29 → 0.13.28 → 0.13.29`；每一步核对版本与入口，最终重新执行最小 TRAE 排除检查。
- 任一 build/test/pack、安装、版本、隔离、回滚或恢复步骤失败，部署失败且不得写 `DEPLOY_DONE`。
- 全流程不得执行 npm publish/dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。

### 验收追溯

- S01：UT-S01-128、ST-S01-26、SMOKE-core-124～SMOKE-core-126。
- S08：UT-S08-37、ST-S08-27、SMOKE-core-127～SMOKE-core-128。
- S19：UT-S19-10～UT-S19-11、ST-S19-09、SMOKE-core-124～SMOKE-core-129。

## S32/S39 测试变更 ID 语义差异与持久化要求

### 用户价值

多切片提案的代码切片必须只拥有本次真实新增或修改的测试，不能因为 `MODIFIED` Delta 完整携带历史表格行，就把未变化的基线测试错误提升为本次交付范围。规格合并完成后，即使没有 Git 历史或进程已经重启，OpenLogos 仍应从自身持久化事实得到相同的测试变更集合。

### 集合与所有权要求

设 `D` 为合并后正式测试规格中全部真实 UT/ST/SMOKE ID，`C` 为本次新增或语义修改的 ID，`R` 为本次删除的 ID，`B = D - C` 为未修改基线，`O` 为全部切片 `owned_test_ids` 的并集：

```text
O = C
C ∩ R = ∅
∀i≠j: owned(slice_i) ∩ owned(slice_j) = ∅
```

- 同 ID 前后规范化测试定义相同，必须留在 `B`，不得进入 `C/O`。
- 同 ID 前后定义不同，必须进入 `C`，即使它不是新 ID。
- 后态新增 ID 必须进入 `C`。
- 前态存在而后态不存在的 ID 只进入 `R`；删除项不要求在后态定义，也不得塞入 `O`。
- ID 在正式测试 target 之间迁移视为修改。

### 正常：merge 时固化语义差异

- **GIVEN** `merge-apply` 已校验正式测试 target 的 before 字节与 prepared final 字节
- **WHEN** apply 在任何正式写入前解析并比较两侧结构化测试定义
- **THEN** 生成版本化、稳定排序、带 target identity 与完整性哈希的 `openlogos/test-change-set@1`，并随 `SPEC_MERGED` 在同一事务原子落盘

### 正常：所有消费者同源

- **GIVEN** `SPEC_MERGED.test_change_set` 有效
- **WHEN** `status`、`next`、`change-lint`、测试切片 validator 或 `verify` 计算切片状态
- **THEN** 它们必须从同一 canonical reader 取得 C/R，禁止重新扫描 Delta 出现集合或依赖 Git `HEAD^`

### 事故回归：完整 MODIFIED 不扩大 C

- **GIVEN** 测试 Delta 原样携带 `UT-S10-121`～`UT-S10-128`、`ST-S10-36`～`ST-S10-39`，修改 `UT-S10-129`，并新增 `UT-S10-137`～`UT-S10-140`、`ST-S10-44`
- **WHEN** OpenLogos 计算语义 change set
- **THEN** `C` 必须精确为 `UT-S10-129`、`UT-S10-137`～`UT-S10-140`、`ST-S10-44`；12 个原样历史 ID 均留在 baseline

### 异常：change set 自身不可信

- **GIVEN** change set 缺失、schema 不支持、payload hash 失配或 target after identity 漂移
- **WHEN** 任一切片状态消费者运行
- **THEN** 保守阻塞并输出精确 `test-slice-change-set-*` violation；不得把该状态误派给只能重建 `TEST_SLICE_MANIFEST.json` 的 slice-planner，不得启动 runner、写 Gate/loop/checkpoint 或消耗 repair budget

### 恢复边界

- change set 有效、slice manifest 缺失/非法/漂移时，继续进入既有 `plan-slices` recovery。
- legacy marker 已有合法 final `VERIFY_PASS` 时不因升级回退。
- `type=no_delta_spec_complete` 且磁盘确无 mergeable delta 时，可可信派生 `C=[]、R=[]`。
- 旧活跃 marker 无可信 before snapshot 时不得伪造 change set；迁移需另行明确流程。

### 版本与部署验收

- CLI、lockfile、随包插件 manifest 与真实 tarball 版本统一为 `0.13.30`。
- verify 通过并获得部署授权后，只安装到本机 npm 全局环境；以固定、可校验的 `0.13.29` tarball 回滚并恢复 `0.13.30`。
- 安装态 smoke 必须覆盖事故六 ID、O=C 反例、removed 独立语义、无 Git 重启、篡改拒绝和实际回滚。
- 禁止 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署与 `git push`。

### 非目标

- 不修改 RunLogos 对 invalid/missing/stale manifest 的消费与 recovery 派发。
- 不降低唯一归属、selector、spec target、fingerprint、checkpoint 或 final verify 硬门。
- 不把 Delta 中“出现过”的 ID 当作语义修改证明。

### 用户问题与价值

当 Agent 已写完 proposal/tasks，但模板、Skill、lint 与状态派生使用不同完成判据时，用户会同时看到“检查通过”和“仍在 writing”的矛盾结论。OpenLogos 必须提供一个可由 CLI 独立证明、可精确修复、可供宿主消费的 Plan Package 完成合同，避免用户承担内部收敛成本。

### 需求范围

- **S09** 创建 launched change 时，中文和英文 proposal/tasks scaffold 必须与完成判据同源；需要代码的 plan 只保留空 `[code]` 标题，不生成代码 checkbox。
- **S35** `change-lint` 必须把 Plan Package 完整性作为 L0 硬门，并输出结构化问题。
- **S11** `status` 必须显示与 L0 同源的 ready、tasks 三态与问题列表。
- **S05** `next` 必须只在同一 evaluator 判定 ready 时进入 `ready-to-delta`，并自描述宿主完成检查。
- **S08** `sync` 必须让项目托管 Skill、模板和插件资产携带可核验的合同版本与内容 hash。

### 正常：合法 plan 四方一致

- **GIVEN** 活跃 launched change 尚无 Delta、无 `PLAN_APPROVED`，proposal canonical 章节唯一且非空，tasks 的 `[delta]/[deploy]` 已规划且 `[code]` 为空锚点
- **WHEN** 分别运行 `change-lint --format json`、`status --format json`、`next --format json` 与 flow derive
- **THEN** `change-lint.data.pass=true`、`plan_package.ready=true`、`status.plan_state.plan_ready=true`、`next.proposal_step=ready-to-delta`，且四方完成问题均为空

### 异常：proposal 必需章节非法

- **GIVEN** proposal 缺少、重复、改名、留空或仍含占位的 canonical 章节
- **WHEN** 任一完成消费者求值
- **THEN** plan 不得 ready；问题必须指出 `code/path/section_id/message/fix_hint`，能定位时还应包含 `line/actual/expected`

### 异常：tasks 阶段语义非法

- **GIVEN** plan 阶段仍有模板 checkbox、提前写入 `[code]` 切片，或代码必需提案缺少 `[code]` 标题
- **WHEN** L0 求值
- **THEN** 返回稳定、可操作的问题；不得把空 `[code]` 误判为无需代码，也不得把 plan-ready 与 merge 后 slices-ready 混为一谈

### 正常：宿主可独立验证完成

- **GIVEN** `next_node.dispatch` 指向 proposal/tasks producer
- **WHEN** `next --format json` 输出 dispatch
- **THEN** dispatch 携带 completion command、JSON Pointer 期望和目标 `proposal_step`；宿主无需解析 Markdown 或相信 Agent 自然语言

### 正常：托管资产可核验

- **GIVEN** npm 包、插件、Codex cache 或项目 sync 资产包含 change-writer 与 proposal/tasks 模板
- **WHEN** 构建、安装或 sync 完成
- **THEN** 可通过 package version、plan contract version 与 SHA-256 manifest 证明资产一致；同一 semver 不允许静默对应不同内容

### 兼容与只读要求

- 已存在 `PLAN_APPROVED`、`SPEC_MERGED`、`MERGED` 或 `VERIFY_PASS` 的历史提案不得因新模板规则回退。
- 仍处于 writing 的旧提案按新合同诊断，但 change-lint/status/next 不自动改写内容、写 marker 或代替审批。
- 中英文项目共享语义 section ID 与 issue code，只由 locale 决定 canonical 标题。
- 旧宿主或旧 CLI 无法证明完成时必须保守提示升级/sync，不得自行维护影子 parser。

### 正常：历史重复测试 ID 可在原子合并中收敛

- **GIVEN** 某个被触及测试规格的合并前基线误含同一测试 ID 的多条结构化定义
- **AND** prepared 最终态已把这些定义收敛为全局唯一 ID，且保留定义可与任一历史候选逐字段匹配
- **WHEN** merge-apply 构造语义 before/after test change set
- **THEN** before 重复不得先于 after 校验形成不可修复死锁；匹配保留项视为未变，重编号项按新增 ID 进入 changed 集合
- **AND** before 中无法可靠归一化的历史歧义行不得阻断收敛，但不参与候选匹配，使 after 对应定义保守进入 changed
- **AND** prepared after 仍含重复、歧义表格或非法 UTF-8 时继续 fail-closed，整批零正式写入

### 非目标

- 不在 OpenLogos 实现 RunLogos WorkUnit 自动重试、UI 状态或自然语言裁决。
- 不新增 HTTP API、数据库、第三套宿主 Markdown parser 或隐式审批。
- 本需求不授权部署、smoke、公开发布或 git push。

## S05/S09/S11/S16/S19/S39 消费者合同完成要求


### 用户问题与目标

RunLogos 不能依赖 OpenLogos 内部磁盘结构，也不能自行发明 staging、动作或 Git 提交规则。OpenLogos 必须让公共 0.14.0 CLI 合同足以独立完成内容生产、取消、合并、恢复和精确提交。

### 范围

- S05：next 只给出真实可执行的事务动作。
- S09：Agent 只写 OpenLogos 签发的 staging path；CLI 独占正式写入与提交闭包。
- S11：status 只读公开完整 slot descriptor、终态和 receipt。
- S16：schema/hash/golden JSON 冻结全部消费者字段。
- S19：修正 candidate 必须真实 pack/install/self-check/回滚。
- S39：payload、receipt、marker 与 commit 白名单形成无环闭包。

### 验收条件

1. 每个必需 Agent slot 公开稳定 `slot_id`、opaque `target_ref`、项目根相对 `staging_path`、`content_encoding=utf8-raw`、`max_bytes` 与 `write_protocol=atomic-rename`。
2. `submit-content --slot --file` 仅接受该 slot 的声明 staging path；逃逸、symlink、额外路径、空文件、超限、非法 UTF-8 与 hash 漂移在正式写入前拒绝。
3. completed receipt 公开 change/module/plan/transaction identity、changed/created paths、逐 payload final hash、metadata/test-change-set/SPEC_MERGED 摘要和精确 `commit_paths`。
4. completed projection 的 `artifact_hashes` 覆盖 receipt/marker；它与 receipt 内 `final_hashes` 互斥且并集精确覆盖 `commit_paths`。
5. `abort` 命令与 action 枚举一一对应；成功后 `phase=failed`、`classification=aborted`、动作清空、receipt=null，重复 abort 返回同一 `aborted_at`。
6. 普通 fatal failed 不暴露 abort；仅 recovery_required 可暴露 recover；未知 action/schema/hash 一律 fail closed。
7. 修正后 candidate 保持未公开的 0.14.0 identity，但旧 tarball/schema/contract hash 失效并重新冻结。
8. RunLogos 只凭公共 envelope 完成真实 E2E，不读取内部 receipt/journal，不手工写 target/marker，不预造 completed transaction。

### 非目标

不新增 HTTP API、数据库、页面，不授权 npm publish、tag、GitHub Release、官网发布或 git push。

## S19 0.14.1 本地全局 patch 候选验收要求

### 背景与用户价值

当前仓库已包含 0.14.0 之后完成的 merge transaction 消费者合同修正，但本机全局入口与随包版本身份仍为 0.14.0。用户需要把当前仓库的完整代码和受管资产冻结为真实 `@miniidealab/openlogos@0.14.1` npm tarball，并用该 tarball 替换本机全局安装，以便后续命令实际消费当前实现，而不是继续运行旧候选或仓库源码入口。

本次交付只产生本地 patch candidate，不构成公开发布。成功状态必须由真实 tarball、全局命令解析、版本/资产一致性与可恢复回滚共同证明，不能用改写文件名、`npm link`、`node cli/dist/index.js` 或历史 smoke 结果替代。

### 验收条件

| AC ID | GIVEN | WHEN | THEN |
|---|---|---|---|
| S19-AC-01 | 当前全局 `openlogos` 精确为 0.14.0，仓库 candidate 已完成 0.14.1 版本同步并通过测试与构建 | 从 `cli/` 执行真实 `npm pack` | tarball 的包名、版本、入口、文件清单、SHA-256、五类插件 manifest 与 `asset-manifest.json` 均可追溯到同一 0.14.1 candidate |
| S19-AC-02 | 0.14.1 tarball 身份已经冻结，且部署前 0.14.0 的命令路径、package root、安装来源与可复制回滚制品已经记录 | 从固定 tarball 安装到本机 npm 全局 prefix，并在新 shell 中重新解析命令 | `command -v openlogos` 与 realpath 指向目标全局安装，`openlogos --version`、package/plugin/asset manifest 和 candidate 证据均精确为 0.14.1，不允许 workspace link、源码入口或旧 shell cache |
| S19-AC-03 | 0.14.1 已从真实 tarball 安装到全局环境 | 运行安装态最小 smoke | 版本与制品身份、merge transaction 公共消费者合同和 reporter 结果全部通过；任一 ID 缺失、skip、fail、证据漂移或结果归属错误时不得产生 `SMOKE_PASS` |
| S19-AC-04 | 已保留固定的 0.14.0 回滚来源与 0.14.1 candidate tarball | 安装、自检、smoke 或回滚演练任一步失败，或执行 `0.14.1 → 0.14.0 → 0.14.1` 恢复演练 | 全局入口最终回到明确版本且路径/版本/制品 SHA 一致；失败时停在可诊断状态，不留下混合资产，不执行 npm publish、dist-tag、Git tag、GitHub Release、官网部署或 git push |

### 范围与非目标

- patch candidate 只更新当前 package identity、候选证据与安装态覆盖，不改变 `openlogos/merge-transaction@1`、status/next contract 或用户项目文件格式。
- 0.14.0 中描述 breaking cutover 的历史语义、兼容 fixture 和归档证据保持原样；只有代表“当前 candidate”的版本常量、断言和 runner 更新为 0.14.1。
- 本次不访问 npm registry 进行发布，不创建或推送 tag，不创建 GitHub Release，不部署官网，也不推送 Git 远端。

### 追溯

- 场景：S19 0.14.1 本地全局 patch 候选分支。
- 单元/场景测试：UT-S19-22、UT-S19-23、ST-S19-15。
- 部署后 smoke：SMOKE-core-157、SMOKE-core-158、SMOKE-core-159。

## S08/S09/S11 项目 YAML 结构化写入与降级可见性要求

### 用户问题与价值

`openlogos init` 产出的 `logos-project.yaml` 模板把资源索引写成空 flow sequence（`resource_index: []`），而 `openlogos sync` 的补录步骤按正则在 `conventions:` 前拼接 block sequence 条目。两者相遇即产出无法被任何符合规范的解析器读取的 YAML——包括 CLI 自身捆绑的解析器。这条路径在「init 建项目 → 放入任意可识别文档 → sync」三步内必然触发。

损坏之后 CLI 不报错：解析失败走恢复分支，恢复器只抢救 `modules` / `scenarios` / `deployment_gates`，`resource_index` 整块被丢弃；而降级诊断在人类可读通道几乎无出口，`status` / `next` 的输出与健康项目无法区分。CLI 生成的 `AGENTS.md` / `CLAUDE.md` 明确指示 AI 先读该文件理解资源索引，于是 AI 在索引为空的情况下继续工作，人与 CLI 都收不到任何信号。

同一根因还有第二个投影：GUI 项目的 flow overlay 由 CLI 写入时硬编码内置模板内容版本字面量，与 loader 维护的版本映射失同步，导致 CLI 刚生成的文件立刻被 CLI 自己告警，真告警被稀释到不可用。

用户需要的是：程序化写入项目正式 YAML 后文件必须仍可解析；一旦降级，必须在人看得见的通道说出来；CLI 自己生成的文件不得一出生就触发自己的告警。

### 核心需求

1. 任何程序化写入 `logos-project.yaml` 的路径，写回后的文件必须能被 CLI 捆绑的 YAML 解析器无异常解析；写入端不得按正则猜测目标键的当前 YAML 形态。
2. 资源索引补录必须同时正确处理三种既有形态：空 flow sequence（`resource_index: []`）、空 block（`resource_index:`）与键缺失；三者补录后均须可解析，且既有条目、其它顶层键与注释守恒。
3. 补录保持幂等：已收录路径不重复追加，重复执行不产生键序或注释漂移。
4. `logos-project.yaml` 解析降级（`recovered` 或 `error`）时，`status` 与 `next` 的人类可读输出必须打印可见告警，并点名未被恢复的字段（至少含 `resource_index`）。机器通道既有的诊断字段语义不变。
5. CLI 不得自动改写用户已损坏的 `logos-project.yaml`。降级的处置权归人，CLI 只负责让降级可见并指向重建入口。
6. CLI 写入 flow overlay 时，`extends` 的内容版本必须取自 loader 维护的内置版本映射，不得出现任何字面量版本号；方法论规格文档与测试断言同样不得复制该枚举。
7. 存量 overlay 的内容版本落后时，同步命令在该 overlay 引用的全部 node id 于新版本内置模板中仍可解析的前提下自动提升并提示；任一引用失效则保持原值并保留版本不匹配告警，使该告警重新只指向真正需要人工复核的对象。
8. 修复以新的本地 patch candidate `0.14.5` 交付，当前本机全局 `0.14.4` 是冻结回滚基线；禁止用相同 `0.14.4` 版本号承载不同字节。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-YAMLW-01 | 在真实 `openlogos init` 模板上放入任意可识别文档并执行 `openlogos sync` 后，`logos-project.yaml` 仍可被 CLI 捆绑解析器解析，且新条目以合法 block sequence 形态出现在 `resource_index` 下 |
| AC-YAMLW-02 | 空 flow sequence、空 block 与键缺失三种形态补录后均可解析；既有条目、其它顶层键与注释逐项守恒 |
| AC-YAMLW-03 | 重复执行同步不重复追加已收录路径，且不产生键序或注释漂移 |
| AC-YAMLW-04 | 在解析降级的 `logos-project.yaml` 上执行 `status` 与 `next`，人类可读输出均出现可见告警并点名未恢复字段；健康项目的输出逐字节不变 |
| AC-YAMLW-05 | 在降级项目上执行任何只读命令后 `logos-project.yaml` 字节不变，CLI 不代为改写 |
| AC-YAMLW-06 | CLI 新写出的 flow overlay 经 overlay 解析后不产生版本不匹配告警；产物中不存在字面量内置版本号 |
| AC-YAMLW-07 | 存量落后 overlay 在全部引用可解析时被自动提升且用户自定义 overlay 操作保留；存在失效 node id 时保持原值并继续告警 |
| AC-YAMLW-08 | 固定 `0.14.5` tarball 完成隔离安装与本机全局安装态 smoke，`0.14.4→0.14.5→0.14.4` 往返后各 identity 与 tarball SHA-256 一致 |

### 授权与非目标

- 本节只定义交付合同，不授权 `openlogos merge`、verify、本机全局部署、smoke、archive、公开发布或 git push；每个动作继续使用独立人类确认点。
- 不新增或修改命令、phase、classification 与公共 JSON envelope 的字段结构。
- 不引入自动重建用户资源索引、无条件迁移存量 overlay、或放宽版本不匹配判定来消音告警的做法。

### 追溯

- 场景：S08 同步 AI 工具资产与资源索引、S09 变更生命周期（GUI overlay 注入）、S11 查看阶段进度与活跃变更。
- 测试：UT-S08-43～UT-S08-46、ST-S08-30～ST-S08-31、UT-S09-275～UT-S09-278、ST-S09-108、UT-S11-75～UT-S11-77、ST-S11-44。
- 部署后 smoke：SMOKE-core-169。

## S09/S19 归档事务只读寻址与 smoke 不适用显式声明要求

### 用户问题与价值

`openlogos archive` 把提案目录从 `logos/changes/<slug>` 移动到 `logos/changes/archive/<时间戳>-<slug>`，而 merge transaction 的身份解析只查前者。于是一个已 completed、receipt 齐备、审计价值最高的事务，在归档那一刻起就无法再经公共命令读取：不带 `--slug` 会解析到当前活跃提案的**另一个**事务，带 `--slug` 则直接报「提案不存在」。跨仓对账、事后复核与任何以「终态可重放」为判据的用例都在此断裂。

第一个撞上这堵墙的是 `SMOKE-core-168`。它是常驻 smoke 套件成员，判据钉死在一个具体事务 ID 上；该事务被 apply 并随提案归档后，用例永久失败，且失败原因与其被测能力毫无关系。这与「把易变的外部状态复制进本该稳定的判据」是同一类错误——只不过复制的不是版本号，而是一个会被消费掉的事务 ID。

与此同时，依赖第三方宿主或历史制品的 smoke runner 在环境不具备时**静默退出且不写任何记录**，使「环境不具备所以没跑」与「本该跑却没跑」在账本上完全同形，都表现为 uncovered。已合并的 S19 口径本已规定 runner 要为每个用例写 `pass|fail|skip`、且 skip 表示环境缺少外部依赖——**规格是对的，是实现没有遵守**。

三者叠加，smoke 门禁从「发布前的真实防线」退化为恒红噪声：`SMOKE-core-168` 恒失败、uncovered 恒不为零，Gate 3.8 结构上不可能 PASS。用户需要的是：已终结的变更仍然可被读取与复核，而门禁的红与绿重新反映真实防线状态。

### 核心需求

1. 事务身份的可寻址性不随提案生命周期消失：提案归档后，仍可通过其 slug 只读定位到该提案的事务与 receipt。
2. 归档提案只放行只读动作；`submit-content` / `seal` / `apply` / `recover` / `abort` 等写动作一律 fail-closed 并给出稳定 classification。归档意味着该变更已终结，恢复可读性不得让它重新变成可改写状态。
3. 提案目录的查找逻辑单点收口，消费方（runner、跨仓工具）不得自建第二套查找规则；也不得为读取归档事务而把 guard 指回已归档提案。
4. 一次性迁移 / 恢复类 smoke 用例的判据必须是**可重放的终态断言**，不得要求被测对象处于某个会被消费掉的中间相位。
5. smoke runner 在环境不具备（缺第三方宿主、缺历史制品、缺必需 env）时，必须为其全部 owned 用例写显式 `skip` 记录并携带不适用原因，禁止静默零记录退出，也禁止以伪造 `pass` 填补覆盖。
6. 门禁判据不得为容忍环境缺口而放宽：仍是「存在 fail 即 FAIL、存在 uncovered 即 FAIL」；出路是让不适用变成可审计的 skip，而不是让 uncovered 被接受。
7. 修复以新的本地 patch candidate `0.14.6` 交付，当前本机全局 `0.14.5` 是冻结回滚基线。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-TXADDR-01 | 提案归档后，以其原 slug 只读查询事务，返回的 `transaction_id` 与 `receipt_sha256` 与归档前一致 |
| AC-TXADDR-02 | 未归档提案的解析行为逐字节不变（活跃 guard 与显式 slug 两条既有路径零回归） |
| AC-TXADDR-03 | 对归档提案发起任何写动作均被拒绝，给出稳定 classification，且事务文件与 receipt 字节不变 |
| AC-TXADDR-04 | 提案目录查找逻辑在实现中单点存在；runner 与跨仓消费方不含第二套查找规则 |
| AC-SMOKE-NA-01 | 环境不具备时，runner 为其全部 owned 用例写 `skip` 记录并携带可读的不适用原因；不存在静默零记录退出 |
| AC-SMOKE-NA-02 | 该批用例不再计入 uncovered，且在 JSON 与 `smoke-report.md` 的 `skipped_cases` 中可审计 |
| AC-SMOKE-NA-03 | 真实失败仍判 fail，不得被降级为 skip；伪造 pass 填补覆盖被拒绝 |
| AC-SMOKE-NA-04 | 修复后 `SMOKE-core-168` 由永久失败恢复为可重放通过，Gate 3.8 的结果重新反映真实防线 |
| AC-TXADDR-05 | 固定 `0.14.6` tarball 完成隔离安装与本机全局安装态验证，`0.14.5→0.14.6→0.14.5` 往返后各 identity 与 tarball SHA-256 一致 |

### 授权与非目标

- 本节只定义交付合同，不授权 `openlogos merge`、verify、本机全局部署、smoke、archive、公开发布或 git push；每个动作继续使用独立人类确认点。
- 不新增命令，不改动公共 JSON envelope 的字段结构（`--slug` 与 `skip` 记录均为既有契约要素）。
- 不引入放宽 `isPass`、伪造记录、把 guard 指回已归档提案，或对归档提案开放写动作的做法。

### 追溯

- 场景：S09 变更提案与合并事务生命周期、S19 部署后 smoke 门禁。
- 测试：UT-S09-279～UT-S09-282、ST-S09-109、UT-S19-29～UT-S19-32、ST-S19-18。
- 部署后 smoke：SMOKE-core-170（并复核 SMOKE-core-168）。

## S08 资源索引候选范围与描述推断锚定要求

### 用户问题与价值

`openlogos sync` 重建 `resource_index` 时存在三个互相叠加的缺陷，净效果是：**棕地项目里，CLI 自己要求产出的权威场景文档永远进不了资源索引；而同一份文档在 baseline-seed 事务工作区下的陈旧快照却进了索引，并被描述得与权威文档逐字相同。**

由于 CLI 生成的 `CLAUDE.md` / `AGENTS.md` 明确要求 AI「先读 `logos/logos-project.yaml` 理解资源索引」，这会把 AI 直接导向过期内容，且 AI 从索引上**无法分辨哪个条目是权威**。

三条缺陷各自的性质不同：

1. **候选范围过宽**：`logos/resources/verify/` 被整棵递归，`baseline-seed-runs/<run>/{staging,resolved,backup}/` 这类事务内部工作区连同其中的主文档完整副本一并进入候选集合。这与已合并的 `logos/spec/baseline-closure.md` 冲突——该规范已明文禁止 baseline-seed staging 进入 effective view，而 `resource_index` 正是喂给 AI 的资源视图。
2. **路径判据未锚定**：描述推断规则只有结尾锚、没有起始锚，于是嵌套快照路径中内嵌的那段权威路径会整体命中权威规则，快照因此被贴上与权威文档逐字相同的描述。
3. **权威 kind 无规则**：baseline-seed 把 `scenario-candidates` 定为必需 kind，而场景实现目录的描述规则要求文件名必含 `SXX-`；`scenario-candidates` 按方法论定义就是「尚未分配 SXX 的候选清单」，于是它推断不出描述、永远被跳过。该目录下任何非 `SXX-` 文档同样如此。

用户需要的是：索引里只有权威规格文档，每条描述如实反映其语义，且 CLI 自己定义的产出物一定能被自己的索引识别。

### 核心需求

1. 资源索引的候选集合只包含权威规格文档；事务内部工作区、运行产物与证据包一律不得进入。`logos/resources/verify/` 只收顶层报告文档，其子目录全部排除。
2. 描述推断的路径判据必须从项目根锚定，禁止子串命中。任何嵌套路径（事务工作区、归档、备份、临时拷贝）都不得冒充权威文档的描述。
3. baseline-seed 的每个 kind，其规范产出路径都必须能被描述推断识别；`KIND_ENUM` 与描述规则之间须有测试锚定，防止两者再次漂移。
4. 场景实现目录下的非 `SXX-` 文档必须有兜底描述规则，覆盖该目录的全部合法 kind，而非只为单个文件名开洞。
5. CLI 不得自动删除 `resource_index` 中的既有条目。修复候选范围后污染不再新增；存量条目的处置权归人。
6. 修复以新的本地 patch candidate `0.14.7` 交付，当前本机全局 `0.14.6` 是冻结回滚基线。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-RIDX-01 | `logos/resources/verify/` 的子目录（事务工作区、证据包、部署制品）下的任何文件都不进入候选集合；顶层报告文档仍正常收录 |
| AC-RIDX-02 | 四步复现路径（init → 放两份权威文档 → 放同名 seed 快照 → sync）产出的索引恰含 2 条权威条目、0 条快照条目 |
| AC-RIDX-03 | 每条描述推断规则对权威路径命中、对同名嵌套路径不命中；嵌套路径一律推断为无描述 |
| AC-RIDX-04 | `2-scenario-implementation/` 下的非 `SXX-` 文档（含 `scenario-candidates`）能推断出场景语义的描述，且不被误判为验收报告 |
| AC-RIDX-05 | baseline-seed `KIND_ENUM` 中每个 kind 的规范产出路径均能推断出非空描述；该对齐由测试锚定 |
| AC-RIDX-06 | 既有 `resource_index` 条目在 sync 前后逐字不变，CLI 不代用户删除任何条目 |
| AC-RIDX-07 | 固定 `0.14.7` tarball 完成隔离安装与本机全局安装态验证，`0.14.6→0.14.7→0.14.6` 往返后各 identity 与 tarball SHA-256 一致 |

### 授权与非目标

- 本节只定义交付合同，不授权 `openlogos merge`、verify、本机全局部署、smoke、archive、公开发布或 git push；每个动作继续使用独立人类确认点。
- 不新增命令，不改动公共 JSON envelope 的字段结构。
- 不清理任何项目中既有的过期索引条目，不引入自动剔除机制。
- 不改变资源索引的写入方式（结构化 AST 写入已在前次变更定案），本次只改候选范围与描述推断。

### 追溯

- 场景：S08 同步 AI 工具资产与资源索引。
- 测试：UT-S08-47～UT-S08-50、ST-S08-32～ST-S08-33。
- 部署后 smoke：SMOKE-core-171。

## S05/S35 门禁前置可满足性与规范补救手段可用性要求

### 用户问题与价值

门禁存在一种结构性缺陷：**门禁的前置条件，依赖了该门之后才被允许产出的产物**。当一道门所处状态的定义是「尚未产出任何 delta」，而它的通过条件却要求 delta 已存在时，两个条件不可能同时成立，用户被迫手工伪造 marker 绕过——代价是绕过正常的 gate 派生、丢失审计行，并让下游消费者的输入为空。

2026-09 的 authority closure plan 门死锁即该形态的一个实例（该门已随 L10 一并删除）。缺陷的形状与具体是哪道门无关，因此本节把「门在其所处阶段必须可满足」升格为对**全部门禁**的通用要求，并要求它有可执行的失败信号，而不是靠人逐个复核。

第二个相关问题：规范中列明的补救手段必须在对应校验器里真实可用。规范告诉用户「可以用某小节补救」，而该小节从未接入判定——用户照规范填写也不会被采信，这类文档与实现的背离同样要有回归锁。

### 核心需求

1. **门禁前置条件必须在该门所处状态下可满足**。任何门的通过条件，不得依赖只有通过该门之后才被允许产出的产物。该性质必须由一条遍历门禁全集的断言锁定：为每个阶段构造该阶段的合法最小产物，逐门求判定，任一门在其阶段不可满足即失败并点名是哪道门、哪个阶段。
2. **同类判据只有一个实现**：「是否已完成规格阶段」「合法 marker 名集合」「`proposal_step` 取值集合」各只有一处权威定义，消费方一律调用它，不得内联重写或各列一份。
3. **诊断必须可归因**：每条门禁诊断中须出现导致失败的实体本身（测试 ID / 文件路径 / 字段名 / 章节锚），不得只给「为空、非法或不在」这类无法定位的措辞。
4. 规范中列明的每个补救手段，必须在对应校验器中真实可用。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-PLANGATE-09 | 「该提案是否已完成规格阶段」只有一个判定实现；全部消费方（含 change-lint）对同一提案得到同一结论，legacy `MERGED` 的读法一致 |
| AC-PLANGATE-10 | 每一份对外发布的 schema 中的 `proposal_step` 枚举都由测试锚到唯一注册表；仅靠 sha256 冻结不算锚 |
| AC-PLANGATE-11 | 提案生命周期 marker 的名称只有一处定义；`HISTORICAL_MARKERS` 不得在多处各列一份 |
| AC-MERGEGATE-04 | 门禁全集在其各自阶段均可满足，且该性质由遍历式断言锁定，新增不可满足的门时立刻变红 |

### 授权与非目标

- 本节只定义交付合同，不授权 `openlogos merge`、verify、本机全局部署、smoke、archive、公开发布或 git push；每个动作继续使用独立人类确认点。
- 不新增命令，不改动公共 JSON envelope 的字段结构。
- **不修改** `guard-check` 的 plan 阶段 delta 白名单，**不修改** `flow-spec` §12.4 对 plan 门状态的定义。
- 不引入以手工 marker 绕过 plan-exit 派生的做法。

### 追溯

- 场景：S05 查看下一步建议（`proposal_step` 派生）、S35 提案计划产物左移硬检查（change-lint）。
- 测试：UT-S35-125、UT-S35-126、UT-S35-129、ST-S35-23。

## merge 合规判定单点化与门禁可满足性保障要求

### 用户问题与价值

三处「同一判据存在多份实现」的残余在同一批文件上叠加，共同后果是**判定结果取决于问的是谁**：

1. `merge` 没有复用 `change-lint` 的完整结论，而是抄了一份缩水判据——先用 `closureActive` 决定要不要预检，再用一份 9 个码的白名单过滤违规。于是 `change-lint` 判 FAIL 并点名具体测试 ID 的提案，`merge` 照常放行并写入 `SPEC_MERGED`。同一仓库里另一条 apply 路径（`merge-apply.ts`）的写法是「任一违规即拒绝」——两条准入路径对「这个提案能不能进主规格」给出不同答案。
2. `authority-closure` 是唯一不走 fence-aware 掩码的 YAML 围栏提取器。文档里出现嵌套围栏（如在 markdown 示例块中示意一段 yaml）时，它比其余三处多命中一个围栏，把示意当成重复声明；更严重的是多命中时**静默返回空集**，plan 阶段的 `authority_ref` 容错随之失效，用户只看到一条无法归因的诊断。
3. 测试 ID 语法有四份定义、三种不等价读法。已合并测试规格中 11 个表格首列 ID 不被严格读法接纳——对这些用例的改动**绕过切片归属**，也不进入 verify 的可选集计算。

**收紧准入必然带来新的风险**：让 merge 拒绝更多提案，就可能出现「提案本身没问题却过不了」。这类误伤只有两个来源——门在其所处阶段不可满足，或门依赖提案作者控制不了的外部状态。前者正是本项目已修复过的 plan 门死锁，其能长期潜伏是因为**没有任何自动手段能发现一道门在它自己的阶段不可能过**。因此收紧与防误伤必须同批交付，缺一不可。

### 核心需求

1. **准入判定只有一个实现**：`merge` 对提案合规性的判定必须等于 `change-lint` 的完整结论——无条件运行、不按码过滤、任一违规即拒绝，与 `merge-apply` 路径逐字同源。
2. **阻断必须可归因**：拒绝时逐条输出违规码、文件路径、具体字段与修复指引；禁止只给聚合结论。
3. **诊断必须点名具体对象**：不得输出「为空、非法或不在某集合中」这类无法定位的措辞。
4. **门禁可满足性必须由可执行断言保障**：对每一道门构造「该门所处阶段的合法最小提案」，断言其通过。该保障不得只写在架构文字里。
5. **围栏提取只有一个判据**：全部 YAML 围栏提取器共用同一 fence-aware 掩码；多命中时必须产出可归因诊断，禁止静默降级。
6. **测试 ID 语法只有一个权威**：语法与其具名读法（结构化判定 / 表格首列 / 正文扫描）从单一模块派生；权威语法必须接纳已合并规格中每一个表格首列 ID。
7. **候选 runner 留痕是普遍要求**：全部依赖历史制品的安装态 runner 在环境不具备时必须写显式 skip，并由元测试防止新增 runner 遗漏。
8. 修复以新的本地 patch candidate `0.14.9` 交付，当前本机全局 `0.14.8` 是冻结回滚基线。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-MERGEGATE-01 | `merge` 的准入判定与 `change-lint` 逐字同源：无条件运行、不过滤违规码、任一违规即拒绝；无 `baseline_closure` 信号的提案同样经过预检 |
| AC-MERGEGATE-02 | `merge` 拒绝时逐条输出 `code`、路径、具体字段与 `fix_hint`，不得只给聚合结论 |
| AC-MERGEGATE-03 | 全部门禁诊断点名具体对象（fact_id、测试 ID、文件路径等），不得使用无法定位的笼统措辞 |
| AC-MERGEGATE-04 | 存在可执行的门禁阶段可满足性断言：对每一道门构造该阶段的合法最小提案，断言全部通过；新增在其阶段不可满足的门即失败 |
| AC-MERGEGATE-05 | `merge` 结果可由 `change-lint` 完全预知——同一提案目录下二者结论一致，不存在「lint 红而 merge 绿」或反向情形 |
| AC-MERGEGATE-06 | `authority-closure` 的 YAML 围栏提取改走 fence-aware 掩码，与 `baseline-closure` / `clarification` / `ui-first` 对同一文档得到同一组围栏 |
| AC-MERGEGATE-07 | 围栏或闭包计划多命中时产出可归因诊断，禁止静默返回空集而使 plan 阶段容错失效 |
| AC-MERGEGATE-08 | 测试 ID 语法恰有一处定义，三种读法由其具名派生；已合并规格中每一个表格首列 ID 都被权威语法接纳 |
| AC-MERGEGATE-09 | 此前不可见的 JSON 系 ID 进入 `test-change-set` 捕获集、切片归属与 verify 的 defined 集合，覆盖度判据不放宽 |
| AC-MERGEGATE-10 | 全部安装态候选 runner 在缺制品时写显式 skip；元测试断言每个已注册 runner 都实现该契约 |
| AC-MERGEGATE-11 | 固定 `0.14.9` tarball 完成隔离安装与本机全局安装态验证，`0.14.8→0.14.9→0.14.8` 往返后各 identity 与 tarball SHA-256 一致 |

### 授权与非目标

- 本节只定义交付合同，不授权 `openlogos merge`、verify、本机全局部署、smoke、archive、公开发布或 git push；每个动作继续使用独立人类确认点。
- 不新增命令，不改动公共 JSON envelope 的字段结构。
- **不改名**已合并规格中的 JSON 系测试 ID——删除已合并 ID 正是条目守恒要拦的形态；本次只放宽权威语法以接纳它们。
- 不引入「先告警后阻断」的灰度过渡——那会制造同一判据的两种强度，正是本次要消除的形态。

### 追溯

- 场景：S05 查看下一步建议、S09 变更生命周期（merge 准入）、S13 验收结果、S19 部署后冒烟门、S32 切片规划、S35 提案计划产物左移硬检查。
- 测试：UT-S05-51、ST-S05-23、UT-S09-283～286、ST-S09-110、UT-S13-65～66、ST-S13-18、UT-S19-33、ST-S19-19、UT-S32-50～51、ST-S32-17、UT-S35-127～131、ST-S35-24。
- 部署后 smoke：SMOKE-core-173。

## SQL delta 分层校验与能力缺失降级要求

### 用户问题与价值

`tech_stack.database` 为 `postgresql` 或 `mysql` 的项目，**任何 `.sql` delta 都交付不了**。校验器在五项结构检查全部通过之后，对非 SQLite 方言无条件返回错误：

```
sqlite       ✗ SQLite schema 预检后没有用户表      ← 走到了真执行预检
postgresql   ✗ postgresql SQL parser/隔离执行适配器不可用；拒绝用 SQLite 冒充该方言
mysql        ✗ mysql SQL parser/隔离执行适配器不可用；拒绝用 SQLite 冒充该方言
```

那五项结构检查（`CREATE TABLE` / 主键 / 约束 / 索引 / 迁移回滚语义）与方言无关——报错逐级前进正说明它们已全过，只卡在方言闸门。

**「拒绝用 SQLite 冒充该方言」这个判断本身是对的**：用 SQLite 解析 PostgreSQL DDL 会漏掉方言特性、给出虚假通过。缺陷在于拒绝之后没有留下任何可用路径——既无适配器查找，也无配置或环境逃生通道。

同类缺陷不止一处：**SQLite 项目在缺 `sqlite3` 二进制时同样被判失败**。一处是适配器未实现，一处是适配器未安装，本质相同——**环境能力的缺失变成了交付阻断**。

后果不只是不能交付，还会**诱导污染规格真实性**：`spec/baseline-closure.md` 要求 database 维度必须有 disposition、不能默认 SKIP，于是唯一「能过」的做法是把方言谎报为 `sqlite` 或把维度谎报为 SKIP——正是闭包机制想防止的事。

### 核心需求

1. **结构检查与方言无关且始终执行**。五项最低完整度检查不因方言或适配器可用性而跳过。
2. **能力缺失一律降级，不得阻断**。适配器未实现或未安装时，执行/语法预检降级为跳过，交付照常推进。
3. **降级必须留痕**。留痕含降级原因、缺失项与实际执行到的层级；不得静默通过。
4. **层级必须如实自述**。不得以「层级不足」冒充「已通过该层级」——只做了结构检查就不能表述为已通过语法或执行预检。
5. **绝不用一种方言的校验器冒充另一种**。这是原实现的正确意图，本次必须保住。
6. PostgreSQL 接入权威语法解析器（libpg_query 的 WASM 编译产物），做到零误拦合法 SQL。
7. MySQL 暂不接解析器，走结构检查 + 留痕；直到出现不会误拦合法 SQL 的权威解析器。
8. 修复以新的本地 patch candidate `0.14.10` 交付，当前本机全局 `0.14.9` 是冻结回滚基线。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-SQLGATE-01 | 五项结构检查在全部方言下一致生效，且不因适配器可用性而跳过 |
| AC-SQLGATE-02 | `postgresql` 方言下结构完整的 `.sql` delta 通过校验，不再返回「适配器不可用」 |
| AC-SQLGATE-03 | `mysql` 方言下结构完整的 `.sql` delta 通过校验，并留痕说明未执行语法/执行预检 |
| AC-SQLGATE-04 | `sqlite3` 二进制缺失时，SQLite 项目同样降级为结构检查并留痕，而非判失败 |
| AC-SQLGATE-05 | PostgreSQL payload 经权威解析器校验：合法 PG 特性（生成列、分区表、partial 索引、表达式索引、`COMMENT ON`、`ALTER`）全部通过，语法错误被拒 |
| AC-SQLGATE-06 | 任何方言的 payload 都不会被送入其它方言的校验器——PG/MySQL payload 绝不进入 sqlite 执行路径 |
| AC-SQLGATE-07 | 校验结果如实自述实际执行到的层级；层级不足时不得表述为已通过该层级 |
| AC-SQLGATE-08 | 降级留痕经 `change-lint` 的 `warnings` 通道可见，不计入 violations、不影响 L9 通过与否；`warnings` 为空时字段整体省略 |
| AC-SQLGATE-09 | 固定 `0.14.10` tarball 随包分发解析器且可加载、无 postinstall 脚本；`0.14.9→0.14.10→0.14.9` 往返后各 identity 与 tarball SHA-256 一致 |

### 授权与非目标

- 本节只定义交付合同，不授权 `openlogos merge`、verify、本机全局部署、smoke、archive、公开发布或 git push；每个动作继续使用独立人类确认点。
- 不新增命令，不改动公共 JSON envelope 的字段结构。
- **不接入 MySQL 解析器**：现有唯一候选实测会误拦合法 MySQL 分区表，等于把「完全阻断」换成「随机阻断」。
- **不引入隔离执行预检**（psql 或容器运行时）——那会把环境能力变成交付前提，正是本次要消除的形态。
- 不修改 `spec/baseline-closure.md` 对 database 维度 disposition 的要求。

### 追溯

- 场景：S39 on-touch 基线闭包（non-Markdown delta 校验）、S35 提案计划产物左移硬检查（降级留痕输出）。
- 测试：UT-S39-59～UT-S39-64、ST-S39-28、UT-S35-132～UT-S35-133、ST-S35-25。
- 部署后 smoke：SMOKE-core-174。

## 并发只读命令可用性与读锁 reader 竞争假阳性修复

来源：RunLogos 现场 bug report（runlogos 仓 `logos/resources/reference/runlogos-cli-panel-transient-status-error-wipes-active-change-bug-report.md` 附录 A，2026-09-03，P1）。0.14.12 及之前版本中，`withBaselineReadLock` / `withRecoveredReadLocks` / `readGate` 三个**读路径**入口取的是模块级排他锁（`<module>.commit.lock`），且锁获取对「活进程持锁」立即失败、零等待零重试。两个纯只读命令互相触发 `baseline_commit_in_progress` 假阳性：现场 8 个并发 `openlogos status --format json`（无任何 writer、无未终结 journal）7 个非零退出；本仓 2026-09-03 在 0.14.12 上原样复现（8 并发 7 失败）。`status` 单次执行含多个读锁区间，碰撞窗口成倍放大；一个基线字段派生失败即导致整条 status 不可读。

### 核心需求

1. **并发只读互不致错**：无 writer 在飞行、无未终结 seed commit journal 时，任意并发度的机器读取命令（`status` / `next` 等所有经读取门的入口）必须全部成功，且各自输出与串行执行时一致。
2. **读路径锁获取有界重试**：三个读路径入口——`withBaselineReadLock`、`withRecoveredReadLocks`、`readGate`——的锁获取由「一次尝试立即失败」改为「有界指数退避重试」；默认总预算 2000ms，退避序列 25/50/100/200/400ms 起步、单次封顶 400ms；预算与时钟可注入供测试。
3. **错误码语义收窄而非改写**：`baseline_commit_in_progress` 收窄为「写事务确实在飞行（预算内等不到锁）或 journal 不可恢复」；错误码名称、JSON error envelope 合同、非零退出行为均不变，下游无需适配。
4. **写路径一字不动**：`begin` / `commit` 的锁获取保持 fail-fast（`run_locked` / `baseline_commit_in_progress` 立即返回）；linkSync O_EXCL 仲裁与死锁回收协议逐字保留。
5. **恢复门语义零回退**：预算内取到锁 → 走既有恢复门四步逻辑不变；不可恢复 journal 的硬门（不读半新集合、不派生正常投影）不变。
6. 修复以新的本地 patch candidate `0.14.13` 交付，当前本机全局 `0.14.12` 是冻结回滚基线。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-READLOCK-01 | 无 writer、无未终结 journal 时，8 路并发 `openlogos status --format json` 全部零退出，各输出的 modules/phase/active_change 投影一致；不出现任何 `baseline_commit_in_progress` |
| AC-READLOCK-02 | `withBaselineReadLock` / `withRecoveredReadLocks` / `readGate` 的锁获取具备有界指数退避重试：默认总预算 2000ms、25ms 起步、单次封顶 400ms；预算与时钟可注入 |
| AC-READLOCK-03 | 锁被他者短暂持有、预算内释放时，读者取到锁并走既有恢复门逻辑，输出与无竞争时逐字段一致 |
| AC-READLOCK-04 | writer 真持锁（seed commit 在飞行）且超预算时，读者仍如实返回 `baseline_commit_in_progress`，error envelope 字段与既有合同逐字一致 |
| AC-READLOCK-05 | 写路径 `begin` / `commit` 的锁获取保持 fail-fast，无重试、无等待；死锁回收协议行为不变 |
| AC-READLOCK-06 | 不可恢复 journal 场景下（前滚与回滚均失败），读者即使经重试取到锁仍硬报 `baseline_commit_in_progress`，标准资源读取哨兵为 0（硬门零回退） |
| AC-READLOCK-07 | 版本身份提升为 `0.14.13`，`0.14.12` 冻结为回滚基线；隔离矩阵与本机全局部署完成后各 identity 一致 |
| AC-READLOCK-08 | 安装态并发 smoke（SMOKE-core-177）在 `0.14.13` 全过；同一断言打到固定 `0.14.12` 上必须复现并发假阳性（零回归对照，防断言空转） |

## 勘误提案的 deployment/smoke 散文订正通道

来源：`errata-single-slice-recovery-semantics`（2026-09-04 归档）范围裁剪说明记录的方法论缺口——on-touch 闭包把 deployment/smoke 维度的 delta 权限硬绑 `deployment_required=true`（`spec/baseline-closure.md` §7），docs-only 勘误提案天然无部署，却因此无法订正该两维度规格中与既有权威语义相矛盾的**散文**，已知错误文本只能滞留等待下一个真实部署提案搭车（实证：SMOKE-core-178 步骤⑤与 0.14.14 部署矩阵「终态不堵恢复」行自 0.14.14 实现阶段发现起滞留两个提案周期）。

### 核心需求

1. **受控 errata 例外**：proposal 明确无需部署时，deployment/smoke 维度 target 仍可为 `MODIFY`，当且仅当其 delta 为**纯散文订正**形态——仅含 `MODIFIED` 块（无 `ADDED` / `REMOVED` / `REMOVED-ITEMS` 块），且 S37 结构化 ID 点数合并前后**完全相等**（SMOKE ID 等稳定 ID 零增删）。
2. **fail-closed 边界**：判据任一不满足（`CREATE` 模式、含 `ADDED`/`REMOVED`/`REMOVED-ITEMS` 块、ID 集合变化）即按既有 fail-closed 语义拒绝，violation 可归因（`code`/`path`/`message`/`fix_hint` 齐备），不得静默放行或降级为 warning。
3. **`[deploy]` 一致性不变**：无需部署的提案仍禁止 `[deploy]` section——散文订正不产生任何部署执行任务；部署决策一致性检查（proposal「部署影响」与 tasks 对账）逐字保留。
4. **既有路径零回归**：`deployment_required=true` 提案的 deployment/smoke 维度行为逐项不变；其余维度（requirement/feature/scenario/UT-ST 强制，architecture/API/DB/orchestration 条件）的适用与 SKIP 判定零变化。
5. **判据单点**：例外判定实现于既有闭包 evaluator 单点（change-lint L9 与 merge 准入同源消费），不新建第二套 ID 语法或第二处判定；ID 点数复用 S37 守恒门口径。
6. 修复以新的本地 patch candidate `0.14.16` 交付，当前本机全局 `0.14.15` 是冻结回滚基线。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-ERRATA-01 | docs-only 勘误提案（`deployment_required=false`）携带 deployment/smoke 散文订正 `MODIFY` delta（仅 MODIFIED 块、ID 零增删）时，`change-lint` L9 与 `openlogos merge` 准入均放行 |
| AC-ERRATA-02 | 判据任一不满足（CREATE / 含 ADDED、REMOVED、REMOVED-ITEMS 块 / ID 增删）时 fail-closed 拒绝，violation 含 `code`/`path`/`message`/`fix_hint`；无需部署提案携带 `[deploy]` section 仍按既有一致性检查拒绝 |
| AC-ERRATA-03 | `deployment_required=true` 路径与全部既有维度适用/SKIP 判定零回归 |
| AC-ERRATA-04 | SMOKE-core-178 步骤⑤与 0.14.14 部署矩阵「终态不堵恢复」行订正后与 §2.55.3/根规范 §2.2.1 权威语义一致；两目标文件 SMOKE ID 与部署断言结构化 ID 零增删（S37 守恒） |
| AC-ERRATA-05 | 版本身份提升为 `0.14.16`，`0.14.15` 冻结为回滚基线；全量 `openlogos verify` PASS，安装态 SMOKE-core-180 通过且既有矩阵（SMOKE-core-176/178/179）零回归 |

## Cursor 完整宿主集成（三件套补齐）需求

### 用户价值

OpenLogos 使用者应能在 `init`、`adopt`、`sync` 与 `launch` 中选择 Cursor，并获得与既有三件套宿主同等级的 OpenLogos 指令、原生 Agent Skills、显式命令、change-reviewer subagent、SessionStart 阶段上下文和写入门禁。Cursor CLI（cursor-agent）的 hook 事件为子集，写入门禁的实际强度必须如实声明与呈现，不得为对齐其他宿主而虚标能力。补齐不得改变未选择 Cursor 的历史配置和其他宿主的可观察行为。

### P02 公共宿主能力要求（Cursor 增补）

1. Registry 中 `cursor` 的 capability 由 `assets: ['agents']` 扩为 `assets: ['agents', 'plugin', 'hooks']`，并显式声明 instructions、skills、commands、agents、sessionStart 为 true、`preToolUse: false`（capability honesty：声明必须与宿主实测能力一致）。
2. 生命周期入口只消费能力声明，不得按宿主名推断；`all` 展开继续按 Registry 稳定顺序包含 `cursor` 并排除 `other`。
3. Cursor 插件资产模板必须进入本提案构建的真实 npm tarball；源码存在但制品缺少任何声明资产时，构建或部署预检失败。
4. Claude Code、OpenCode、Codex、ZCode、Qoder、WorkBuddy 的规范值、目标路径、配置合并和输出契约保持兼容；未知工具继续 fail loud。

### Cursor 资产、迁移与 Hook 要求

1. Skills 以 Cursor 原生 Agent Skills 布局部署：`.cursor/skills/<name>/SKILL.md`（frontmatter `name` 与目录名一致），取代历史 `.cursor/rules/*.mdc` 转换产物。
2. OpenLogos commands 以 `disable-model-invocation: true` 的 Skills 形式部署，用户可用 `/<name>` 显式触发；change-reviewer 以 Cursor subagent 形式部署。
3. `sync` / `launch` 幂等清理 OpenLogos 托管的历史 `.cursor/rules/*.mdc`（含 `openlogos-policy.mdc`）；用户自有 rules、skills、hooks 与其它文件必须原样保留。
4. Hook 接线写入 `.cursor/hooks.json`（`version: 1`），采用合并写入：只增改 OpenLogos 托管条目，保留用户既有 hooks；卸载或回滚只移除托管条目。
5. `sessionStart` hook 只从项目磁盘事实生成 module、active change、`proposal_step`、可写范围和下一确认点，输出不构成授权。
6. 写入门禁为部分强度组合：`beforeShellExecution` 每次调用重读 guard 与提案状态，deny 时以非空原因阻断 shell 写入；`afterFileEdit` 对越界编辑产出事后检测报告（不能预先阻断宿主原生编辑）。IDE 侧共享同一 `hooks.json` 时按宿主能力自然获得 `preToolUse` 完整硬拦，OpenLogos 不为此维护第二份配置。
7. 面向用户的输出（init/sync/launch 反馈、根规范、AGENTS.md 托管段）必须如实呈现 CLI 侧 guard 为部分强度，不得声称与 claude-code 等价。

### 场景验收条件

#### S01 初始化

- `--ai-tool cursor` 生成配置、托管指令、`.cursor/skills/` 完整 Skills（含 commands 形式）、change-reviewer subagent 与 `.cursor/hooks.json` 托管条目；`--ai-tool all` 包含 Cursor，重复规划幂等。
- 模板缺失、SKILL.md frontmatter 非法、hooks.json 不可解析或用户条目将被覆盖时，在覆盖用户资产前失败并报告精确路径。

#### S08 同步

- `sync` 只刷新 OpenLogos 托管的 Cursor 资产：Skills、subagent、hooks 托管条目，并清理托管 `.mdc`；用户自有 rules/skills/hooks、未知文件保持不变。
- 只有全部 Adapter 成功后才刷新 `.openlogos-sync.json`；Cursor 资产暂存、替换或读回失败时回滚且版本戳不变。

#### S09 变更生命周期

- 新 Cursor session 的 sessionStart 注入当前磁盘状态；已有会话不承诺热刷新。
- `beforeShellExecution` 对越界 shell 写入 deny 并给出非空原因；`afterFileEdit` 对越界编辑产出检测报告；无 guard、越界路径、解析失败和决策异常均 fail-closed（shell 路径拒绝、编辑路径必报告）。

#### S14 launched 刷新

- `launch` 经 Registry 刷新 Cursor launched 指令、Skills、subagent 与 hooks 托管条目；全部 Adapter 成功后才提交 lifecycle。
- adopted + launched 重复执行幂等，用户 rules/skills/hooks、项目资产保持不变。

#### S20 存量接入

- `adopt --ai-tool cursor` 在保留既有项目指令、用户 rules/skills/hooks 的前提下部署三件套资产并完成托管 `.mdc` 迁移，继续引导首个 change。
- 冲突或中途失败不得留下半套资产（如 Skills 已部署但托管 `.mdc` 未清理、hooks 条目残缺），也不得伪造接入完成信息。

### 部署与非目标

- 必须使用本提案构建的真实 npm tarball，在隔离 staging 以真实 cursor-agent CLI 新会话验证 Skills 发现、显式命令触达、sessionStart 注入、`beforeShellExecution` allow/deny、`afterFileEdit` 检测报告、托管 `.mdc` 迁移、幂等与回滚，并实测记录 CLI hook 事件覆盖面（消解 2026-04 论坛口径时效风险）。
- 不新增 HTTP/RPC/消息 API，不涉及数据库迁移，不实现公开发布。
- 本提案不授权 npm publish、Git tag、GitHub Release、官网部署或 `git push`。

## Claude guard hook 项目根定位与 sync 补齐需求

### 用户价值

`openlogos init` 为 Claude Code 部署的 PreToolUse guard hook（launched 无活跃提案时硬拦 Edit/Write/Bash）必须在**任意会话 cwd** 下可靠生效：用户从项目子目录开会话不应导致 hook 报 `No such file or directory` 刷屏，更不应让 guard 静默失效或静默放行；guard 功能上线之前 init 的存量项目升级 CLI 后运行 `openlogos sync` 必须补齐硬闸——变更纪律不能只剩 SessionStart 提示文本 + AI 自律（来源：`openlogos-claude-guard-hook-project-dir-and-sync-deploy-gap-bug-report.md`，0.14.20 复核三项全部成立）。

### hook 注册形态要求（缺陷①）

1. `init`/`adopt` 写入 `.claude/settings.json` 的 PreToolUse hook command 必须为 `"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check`（Claude Code 官方项目根环境变量）；SessionStart hook 同函数族同步为 `$CLAUDE_PROJECT_DIR` 形态。
2. 幂等去重必须同时识别新旧两种 command 写法：重复执行零重复条目；检测到旧相对路径条目时升级迁移为新形态，新旧不并存。

### guard-check 工作目录收敛要求（缺陷②）

1. `guard-check` 脚本必须在判定前把工作目录收敛到 `$CLAUDE_PROJECT_DIR`；收敛后既有判定逻辑（lifecycle、`logos/.openlogos-guard`、白名单、绝对路径 realpath 归一化）语义逐项不变。
2. `CLAUDE_PROJECT_DIR` 缺失时的兼容回退：cwd 恰为项目根（存在 `logos/logos.config.json`）可按 cwd 判定；否则 **fail-closed**——exit 2 并输出可读诊断，**禁止**静默 `exit 0` 放行。
3. 非项目根 cwd 的会话在正确注册（含 `$CLAUDE_PROJECT_DIR`）下：无提案改码被阻断（exit 2 + reason），有提案在范围内放行——与项目根 cwd 行为逐项一致。

### sync 资产面要求（缺陷③）

1. guard 资产（`guard-check` bin 文件 + PreToolUse hook 注册）纳入 `openlogos sync` 的托管资产面：asset-manifest 登记版本化哈希，与 skills/AGENTS.md 同一机制；升级 CLI 后 sync 即补齐/更新。
2. 存量项目（无 guard-check、无 PreToolUse 段）sync 后：bin 落盘、hook 注册齐备；幂等重跑零重复；旧相对路径条目被迁移。
3. 该要求兑现 `spec/directory-convention.md` 既有「由 init / sync 自动部署」承诺（修复规格-实现背离）。

### 场景验收条件

#### S01 初始化

- init 新项目后 `settings.json` 的 PreToolUse 与 SessionStart command 均含 `$CLAUDE_PROJECT_DIR`；重复 init 零重复条目。

#### S08 同步 AI 工具资产

- 存量项目 sync 后 guard-check 落盘、hook 注册齐备、旧条目迁移、幂等重跑零重复。

#### S09 变更生命周期

- guard-check 在 `CLAUDE_PROJECT_DIR` 缺失且 cwd 非项目根时 fail-closed（exit 2 + 诊断）；子目录 cwd + 变量在场时判定与项目根 cwd 逐项一致。

### 非目标

- 不改变 guard 判定语义（lifecycle/guard 文件/白名单/exit 2 阻断合同不动）；不部署（用户决策 C01，随下一部署窗口发布）；不触及其它宿主（codex/zcode/qoder/workbuddy/cursor）的 hook 机制。

## OpenLogos 0.14.21 guard 修复候选发布需求

### 用户价值

已入仓的 Claude guard hook 三项修复（`$CLAUDE_PROJECT_DIR` 注册形态、guard-check 工作目录收敛 fail-closed、sync 托管 guard 资产）必须发布到本机全局才能生效：非根 cwd 静默 fail-open 与存量项目（含 runlogos）硬闸缺失存在于**已安装的 0.14.20 CLI**，发布 0.14.21 后存量项目一次 `openlogos sync` 即补齐硬闸。

### 候选发布要求（S19）

1. **候选身份链同步**：CLI package/lockfile、全部随包 plugin/资产模板 manifest、package asset manifest、`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.21`、`LOCAL_RELEASE_ROLLBACK_VERSION=0.14.20` 与发布身份 tripwire/golden 全链一致；真实 `npm pack` 冻结唯一 tarball SHA-256。
2. **隔离矩阵（部署前强制）**：一次性 npm prefix 安装固定 tarball，从绝对入口验收——candidate identity 无 workspace link；**guard 全链**（init 新项目 hook 为 `$CLAUDE_PROJECT_DIR` 形态；子目录 cwd 无提案改码被拦 exit 2 + reason、有提案放行；变量缺失且 cwd 非根 fail-closed）；**存量项目 sync 补齐实测**（无 guard-check/仅旧 SessionStart 的项目 sync 后硬闸齐备、旧条目迁移、重复 sync 幂等）；`0.14.20→0.14.21` roundtrip 无混装。
3. **零回归对照（强制）**：同一子目录 cwd 无提案改码场景在固定 `0.14.20` 上必须复现静默放行（fail-open 缺陷本身）；旧版也拦截则矩阵空转，必须重写矩阵而非放行部署。
4. **全局覆盖与 smoke**：矩阵与回滚演练 PASS 且用户授权后覆盖本机全局；新 shell 复核 identity 全同源 `0.14.21`；`openlogos smoke`（SMOKE-core-192）独立授权执行。
5. 回滚制品固定 0.14.20 tarball（SHA-256 `b252cec4465806a4555fa2cc2018fb908fc09f71ba9a198bbd9dd28fec01fcbf`）；回滚自检失败不得覆盖全局。

### 场景验收条件

#### S19 候选发布与 smoke 门禁

- 0.14.21 候选身份全源一致（UT-S19-38 tripwire）；SMOKE-core-192 全链 PASS 且 0.14.20 对照有效；部署与 smoke 各为独立人类确认点。

### 非目标

- 零新增语义（guard 行为合同已由 fix-claude-guard-hook-project-dir-and-sync-deploy 定稿）；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。

## Claude guard hook 管辖边界与阻断可见性需求

### 用户价值

PreToolUse guard hook 的硬闸必须**只管辖本项目源码**且**拦截时给出可操作原因**：AI 宿主写项目根之外的文件（用户级 `~/.claude/projects/**/memory/*.md` 记忆文件、其他仓库、系统临时目录）不应被本项目的变更纪律误拦——那些路径的权限归宿主自身权限系统；而项目内被拦截时，用户与 AI 必须能看到「请先运行 `openlogos change <slug>`」的指引，而不是 "No stderr output"（来源：runlogos 仓库实际使用发现并本地热修验证，2026-09-06 于 0.14.21 安装版复核两项全部成立）。

### 管辖边界要求（缺陷①）

1. `is_whitelisted_path` 在白名单前缀匹配**之前**先判管辖：目标路径归一化后位于项目根之外（relpath 为 `..` 或以 `../` 开头；bash 兜底分支下绝对路径不在 `$(pwd)/` 之下）→ **放行**，不进入白名单匹配与阻断分支。
2. guard 的保护目标是**本项目源码的变更可追溯性**；项目根之外的写入一律交由宿主权限系统判定，guard 不拦截、不告警。
3. 项目根之内的判定语义逐项不变：lifecycle、`logos/.openlogos-guard` 存在性、白名单前缀表、Bash 安全/写入模式、exit 2 阻断合同均保持。

### 阻断可见性要求（缺陷②）

1. `block()` 阻断时必须**双通道输出**：stdout 保留 `{"reason":"..."}` JSON（旧协议向后兼容），同时把 reason 以可读文本写入 **stderr**（Claude Code 对 PreToolUse hook exit 2 实际读取的通道）。
2. Step 0 两处 fail-closed（`CLAUDE_PROJECT_DIR` 不可进入 / 变量缺失且 cwd 非项目根）同样双通道输出诊断。
3. 任何阻断路径不得出现「exit 2 但 stderr 为空”的形态。

### 场景验收条件

#### S09 变更生命周期

- launched 无提案时：Edit/Write 项目根之外目标（含 `~/.claude` 用户级路径与其他仓库绝对路径）→ exit 0 放行；Edit/Write 项目内源码 → exit 2 且 **stderr 含变更管理指引**、stdout JSON 结构不变。

### 非目标

- 不改变项目根之内的任何判定语义；不触及其它宿主（codex/zcode/qoder/workbuddy/cursor）适配层的输出协议（各自合同独立成文）。

## OpenLogos 0.14.22 guard 修复候选发布需求

### 用户价值

两处 guard-check 修复（管辖边界、阻断 stderr 可见性）必须发布到本机全局才能生效：项目外误拦截与 "No stderr output" 存在于**已安装的 0.14.21 CLI**；发布 0.14.22 后存量项目一次 `openlogos sync` 即刷新 guard-check 字节，runlogos 本地热修同步转正（用户决策 C01：「请帮我本机全局部署，升级到 0.14.22」）。

### 候选发布要求（S19）

1. **候选身份链同步**：CLI package/lockfile、全部随包 plugin/资产模板 manifest、package asset manifest、`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.22`、`LOCAL_RELEASE_ROLLBACK_VERSION=0.14.21` 与发布身份 tripwire/golden 全链一致；真实 `npm pack` 冻结唯一 tarball SHA-256。
2. **隔离矩阵（部署前强制）**：一次性 npm prefix 安装固定 tarball，从绝对入口验收——candidate identity 无 workspace link；**guard 两处修复全链**（launched 无提案写项目外路径放行 exit 0；写项目内源码拦截 exit 2 且 stderr 含指引、stdout JSON 结构不变；Step 0 fail-closed stderr 可见）；`0.14.21→0.14.22` roundtrip 无混装。
3. **零回归对照（强制）**：同一项目外写入场景与项目内拦截场景在固定 `0.14.21` 上必须复现**误拦截**与**stderr 为空**（缺陷本身）；旧版也放行/也有 stderr 则矩阵空转，必须重写矩阵而非放行部署。
4. **全局覆盖与 smoke**：矩阵与回滚演练 PASS 且用户授权后覆盖本机全局；新 shell 复核 identity 全同源 `0.14.22`；`openlogos smoke`（SMOKE-core-193）独立授权执行。
5. 回滚制品固定 0.14.21 tarball（SHA-256 `ac173f5fddff6717bfaf15787ee7ebf9c5029837277e71c20c77370abf5c285f`）；回滚自检失败不得覆盖全局。

### 场景验收条件

#### S19 候选发布与 smoke 门禁

- 0.14.22 候选身份全源一致（UT-S19-39 tripwire）；SMOKE-core-193 全链 PASS 且 0.14.21 对照有效；部署与 smoke 各为独立人类确认点。

### 非目标

- 除两处修复外零新增语义；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。

## next 对 initial-plan 切片事务的问即建需求

### 用户价值

全自动 driver（如 runlogos）在派发 slice-planner **之前**，写域必须由 `openlogos next` 输出携带的 `slice_transaction` canonical 投影派生（双方已立之约 adopt-openlogos-test-slice-transaction-authority，投影缺失即 fail-closed）；而 0.14.22 的 initial-plan 事务为懒创建——仅在首次 `submit-content` 时「用即建」，`next` 在正常 ready-to-implement 路径既不创建也不输出投影。两条各自成立的契约拼在一起构成鸡生蛋死锁：投影只有 slice-planner 提交内容后才存在，driver 没投影又拒绝派发 slice-planner——任何新提案在全自动流程中**首达 plan-slices 节点必然 blocked**（runlogos 连续 4 个提案实证，每次靠人工代跑 slice-planner 绕过）。事务的「发证时机」必须与消费方的「投影前置」对齐：恢复路径已有正确先例（`next` 的 manifest-recovery 分支 ensure 并输出投影），initial-plan 正常路径需要同构语义。

### 问即建要求（S28 / S32）

1. **触发条件**：模块 `proposal_step == ready-to-implement` 且需要代码（`[code]` 标题在场、切片未填）且提案未归档——即建议节点为 `plan-slices` 的时刻，`next` 必须 ensure initial-plan 切片事务。
2. **无事务** → `createTestSliceTransaction(origin: initial-plan)` 创建后输出 canonical 投影；**已有事务（任意 phase，含 completed / failed）** → 只读投影输出，不重建、不归档、不推进 phase。
3. **投影输出**：`next` 输出在该场景携带 `slice_transaction` 字段，schema 沿用 manifest-recovery 分支既有 `openlogos/test-slice-transaction@1` 投影（仅扩大出现场景，不新增第二事实源）。
4. **失败如实**：事务创建失败时如实反映为「无投影」并携带错误信息，不降级为仅建议节点（避免消费方误以为可自行恢复）。
5. **幂等**：同一状态下重复执行 `next` 不重复创建、投影 `transaction_id` 稳定不变。
6. **用即建降为幂等兜底**：`submit-content` 的按需创建保留（手动流程零回归）——`next` 已建则直接续用同一事务，无事务时仍可用即建；**不新增** `slice transaction open` 子命令。

### 场景验收条件

#### S28 next 建议节点派生

- ready-to-implement 且切片未填时：`next --format json` 的模块项建议节点为 `plan-slices` **且携带 `slice_transaction` canonical 投影**（首达时创建，`origin=initial-plan`、`content_slots.required=2`）；重复执行幂等（`transaction_id` 不变）；事务创建失败时无投影并携错误信息；非 plan-slices 节点（如 delta-writing、coding）不创建事务。

#### S32 切片规划

- initial-plan 事务创建时机前移为 `next` 问即建；`next` 已建后 slice-planner 的 `submit-content` 幂等续用同一事务（不重建、不冲突）；无 `next` 前置的手动 `submit-content` 懒创建路径零回归。

### 非目标

- 不改变事务 schema、slot 契约、seal/apply 判定与 manifest 语义；不改变 manifest-recovery 分支既有行为；消费方（runlogos）契约零改动。

## OpenLogos 0.14.23 候选发布需求

### 用户价值

问即建修复必须发布到本机全局才能生效：已安装的 0.14.22 全局 CLI 的 `next` 仍不输出 initial-plan 投影，runlogos 每个新提案首达 plan-slices 仍死锁需人工绕过；发布 0.14.23 后全自动链路经全局 CLI 刷新即痊愈（用户决策 C01：捆绑发布 0.14.23 + 全局部署 + smoke）。

### 候选发布要求（S19）

1. **候选身份链同步**：CLI package/lockfile、全部随包 plugin/资产模板 manifest、package asset manifest、`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.23`、`LOCAL_RELEASE_ROLLBACK_VERSION=0.14.22` 与发布身份 tripwire/golden 全链一致；真实 `npm pack` 冻结唯一 tarball SHA-256。
2. **隔离矩阵（部署前强制）**：一次性 npm prefix 安装固定 tarball，从绝对入口验收——candidate identity 无 workspace link；**next ensure 全链**（安装态构造 ready-to-implement 提案 → `next --format json` 携 `slice_transaction` 投影且事务文件落盘 → 重跑幂等 → `submit-content` 续用同一事务）；`0.14.22→0.14.23` roundtrip 无混装。
3. **零回归对照（强制）**：同一 ready-to-implement 场景在固定 `0.14.22` 上必须复现**无投影**（`next` 输出不含 `slice_transaction` 且事务文件不落盘——缺陷本身）；旧版也有投影则矩阵空转，必须重写矩阵而非放行部署。
4. **全局覆盖与 smoke**：矩阵与回滚演练 PASS 且用户授权后覆盖本机全局；新 shell 复核 identity 全同源 `0.14.23`；`openlogos smoke`（SMOKE-core-194）独立授权执行。
5. 回滚制品固定 0.14.22 tarball（SHA-256 `0bdcefb37a0743575d44c7645169c0c668bbcaaa22e206e7e209325f8a283ac1`）；回滚自检失败不得覆盖全局。

### 场景验收条件

#### S19 候选发布与 smoke 门禁

- 0.14.23 候选身份全源一致（UT-S19-40 tripwire）；SMOKE-core-194 全链 PASS 且 0.14.22 对照有效；部署与 smoke 各为独立人类确认点。

### 非目标

- 除问即建修复外零新增语义；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。

## guard-check Bash 写命令路径级管辖判定需求

### 用户价值

0.14.22 立下的管辖边界合同——「guard 只管本项目源码的变更可追溯性，项目根之外的写入交宿主权限系统」——必须对 **Bash 写命令同样成立**。现状是该合同在 `plugin/bin/guard-check` 的 Bash 分支对 `rm`/`cp`/`mv`/`mkdir`/`touch`/`chmod`/`chown` 类命令**结构性不可达**：命令命中 `BASH_WRITE_PATTERNS` 即预备拦截，但 `WRITE_TARGET` 只在 `>`/`>>` 重定向形态下提取，上述命令从不提取路径实参，`WRITE_TARGET` 为空即跳过 `is_whitelisted_path`（含 0.14.22 已修好的管辖边界判定）而**无条件拦截**。生产实证（2026-09-06，runlogos 仓 launched 无提案）：`rm -rf <session scratchpad 路径>`、`cp <项目外→项目外>` 均被误拦——目标全在项目根之外，按合同应放行；日常 AI 会话在无提案期写 scratchpad / 用户级文件被持续误拦，与 0.14.22 合同自相矛盾（来源：runlogos 仓 `logos/resources/reference/openlogos-guard-check-bash-branch-external-path-still-blocked-bug-report.md`）。

### Bash 写命令路径级管辖判定要求

1. **路径提取**：命中 `BASH_WRITE_PATTERNS` 的 `rm`/`cp`/`mv`/`mkdir`/`touch`/`chmod`/`chown` 类命令，跳过以 `-` 开头的选项 flag 后提取**全部路径实参**（`rm`/`mkdir`/`touch`/`chmod`/`chown` 全量实参；`cp`/`mv` 全量实参含源与目标）；既有 `>`/`>>` 重定向目标提取保持不变。
2. **逐路径管辖判定**：每个提取出的路径逐一走既有 `is_whitelisted_path`（含 0.14.22 管辖边界与白名单前缀判定）——**全部路径均在项目根之外或白名单内 → 放行**；**任一路径在项目根之内且非白名单 → 维持拦截**（携既有 stderr 双通道指引）。
3. **解析不出 fail-closed**：含变量展开、命令替换、管道/复合形态等解析不出路径实参的命令，**维持现行无条件拦截**，fail-closed 不放宽；`BASH_SAFE_PATTERNS`（含 `^git push`）优先级不变。
4. **三运行时一致**：python3 归一化、node 归一化与 bash 兜底三条判定路径对同一命令**同判**。
5. **安全面零放宽**：项目根之内的拦截/放行判定逐项不变——白名单前缀表、拦截文案、stderr 双通道、plan 阶段原型 allowlist、exit 2 阻断合同均保持；硬闸保护面（本项目源码）零收窄。

### 场景验收条件

#### S09 变更生命周期

- launched 无提案时：Bash `rm`/`cp`/`mv`/`mkdir`/`touch`/`chmod`/`chown` 命令的**全部路径实参在项目根之外**（含 session scratchpad、用户级 `~/.claude` 形态路径、项目外→项目外的 `cp`）→ exit 0 放行；**任一路径实参在项目根之内且非白名单** → exit 2 拦截且 stderr 含变更管理指引；**解析不出**（变量展开/命令替换/管道复合）→ exit 2 维持现行拦截（fail-closed）。

### 非目标

- 不改变 Edit/Write 分支判定；不改变 `BASH_SAFE_PATTERNS`/`BASH_WRITE_PATTERNS` 模式表本身；不实现完整 shell 解析器（解析不出即保守拦截）；不触及其它宿主（zcode/qoder/workbuddy/cursor）适配层合同。

## OpenLogos 0.14.24 候选发布需求

### 用户价值

Bash 写命令路径级管辖判定修复必须发布到本机全局才能生效：误拦存在于**已安装的 0.14.23 CLI** 随 `openlogos sync` 分发到各项目的 guard-check 托管资产；不发布不部署则存量项目（含 runlogos）继续误拦项目外写入。发布 0.14.24 后存量项目一次 `openlogos sync` 即刷新 guard-check 字节（用户决策 C01：「捆绑 0.14.24 + 全局部署 + smoke」）。

### 候选发布要求（S19）

1. **候选身份链同步**：CLI package/lockfile、全部随包 plugin/资产模板 manifest、package asset manifest、`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.24`、`LOCAL_RELEASE_ROLLBACK_VERSION=0.14.23` 与发布身份 tripwire/golden 全链一致；真实 `npm pack` 冻结唯一 tarball SHA-256。
2. **隔离矩阵（部署前强制）**：一次性 npm prefix 安装固定 tarball，从绝对入口验收——candidate identity 无 workspace link；**Bash 写命令管辖判定全链**（launched 无提案：全外路径 `rm`/`cp` 放行 exit 0；任一项目内非白名单路径拦截 exit 2 且 stderr 含指引；解析不出维持拦截）；`0.14.23→0.14.24` roundtrip 无混装。
3. **零回归对照（强制）**：同一全外路径 `rm`/`cp` 场景在固定 `0.14.23` 上必须复现**误拦截 exit 2**（缺陷本身）；旧版也放行则矩阵空转，必须重写矩阵而非放行部署。
4. **全局覆盖与 smoke**：矩阵与回滚演练 PASS 且用户授权后覆盖本机全局；新 shell 复核 identity 全同源 `0.14.24`；`openlogos smoke`（SMOKE-core-195）独立授权执行。
5. 回滚制品固定 0.14.23 tarball（SHA-256 `de042d28db4e143a0da0e1e4dc63a9169557ac9cc4dde4ead8e8164ccf507a5b`）；回滚自检失败不得覆盖全局。

### 场景验收条件

#### S19 候选发布与 smoke 门禁

- 0.14.24 候选身份全源一致（UT-S19-41 tripwire）；SMOKE-core-195 全链 PASS 且 0.14.23 误拦对照有效；部署与 smoke 各为独立人类确认点。

### 非目标

- 除 Bash 写命令路径级管辖判定修复外零新增语义；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。

## 生命周期命令 fail-closed 与状态对账需求

### 用户价值

20260907 真实事故（runlogos 面板僵死复盘）暴露：`fix-guard-check-bash-write-target-jurisdiction` 提案在部署与 smoke 全部实际完成后，因执行 Agent 漏跑 `openlogos deploy-done`，`DEPLOY_DONE` 缺失，随后三处防线全部失效——

1. `openlogos smoke` 在 deploy 门未过的状态下照常执行并写入 `SMOKE_PASS`。而 S19「smoke 前置依赖 deploy-done」章节**早已强制要求**「提案声明需 smoke、部署决策无冲突、`DEPLOY_DONE` 存在、`[deploy]` 全勾」为 smoke 前置校验，并要求缺标时提示先执行 `openlogos deploy-done`；实现（`cli/src/commands/smoke.ts`）完全没有该校验，属**规格已定、实现缺失**的缺陷。
2. `openlogos archive` 同样没有链条校验（`cli/src/commands/archive.ts` 不检查 `VERIFY_PASS` / `DEPLOY_DONE` / `SMOKE_PASS`），带着缺口的提案被成功归档，缺陷被永久固化进归档记录。
3. `status` / `next` 的 step 派生在 `DEPLOY_DONE` 缺失时永远停在 `ready-to-deploy`，`SMOKE_PASS` 等下游强证据永远不被评估——矛盾状态（smoke 已过、deploy 未落标）**沉默停滞**，宿主面板长期显示「请执行部署任务」的僵死提示，无任何对账建议，人也看不出到底缺什么。

用户价值是让漏标**造不出来**（fail-closed 收口）、即使因历史或旁路已存在也**藏不住**（对账投影）：单点遗漏不再放大为长期僵死状态，且任何缺口在下一次 `status` / `next` 调用时即被点名并给出一条命令的补救路径。

### smoke fail-closed 前置校验要求（S19）

1. `openlogos smoke` 在执行 `smoke.command` **之前**必须完成前置校验，任一不满足即 fail-closed 拒绝执行：提案声明需要 smoke（`smoke_required=true`）、提案部署决策无冲突、`DEPLOY_DONE` 存在、`tasks.md` 的 `[deploy]` section 已全部勾选。
2. fail-closed 拒绝时**绝不执行 smoke.command、绝不写 `SMOKE_PASS` / `SMOKE_FAIL`、绝不生成 smoke 报告**；以稳定错误码信封写 stderr 并非零退出，`--format json` 下走通用错误 envelope。
3. 错误信息必须给出**一条可直接执行的补救命令**：缺 `DEPLOY_DONE` 提示先完成部署并执行 `openlogos deploy-done`；`[deploy]` 未全勾提示补齐部署任务后执行 `openlogos deploy-done`。
4. **禁止 auto-heal**：`openlogos smoke` 不得在检测到缺标时自动补写 `DEPLOY_DONE`——那会绕过半自动模式下 `deploy-done` 的人类确认点语义并掩盖遗漏事实。
5. 前置全部满足时行为**零回归**：既有 sandbox、runner / reporter 覆盖判定、gate 判定、skip 统计口径与 `--auto` 自动执行信号逐项不变。

### archive 链条校验要求（S09）

1. `openlogos archive <slug>` 在移动提案目录**之前**必须校验完成链条：`VERIFY_PASS` 存在且 `VERIFY_FAIL` 不存在为必备；提案声明需要部署时还须 `DEPLOY_DONE` 存在；提案同时声明需要 smoke 时还须 `SMOKE_PASS` 存在且 `SMOKE_FAIL` 不存在。
2. 任一不满足即 fail-closed 拒绝：**不移动目录、不删除 guard、不产生任何部分状态更新**，以稳定错误码文本写 stderr 并非零退出（archive 保持纯文本命令，不新增 stdout JSON envelope），并给出对应的补救命令。
3. 无需部署的提案链条只到 `VERIFY_PASS`，行为零回归；`deployment_decision_conflict=true` 时 archive 本就不得作为主动作，语义不变。

### 状态对账投影要求（S05 / S11）

1. `status` / `next` 在活跃提案派生停在 `ready-to-deploy`、但发现**矛盾的下游证据**（`SMOKE_PASS` 或 `SMOKE_FAIL` 在场，或 `[deploy]` 已全勾）而 `DEPLOY_DONE` 缺失时，必须在 `active_change` 上输出只读投影 `state_inconsistency`，含矛盾类型（kind）、具体证据清单（evidence）与补救命令（remediation）。
2. `next` 的人类可读引导必须同步显式给出补救建议（`openlogos deploy-done`），不得继续沉默重复「请执行部署任务」。
3. 该投影为**每次调用的即时只读派生**：不落盘、不缓存、不改 `proposal_step` 派生本身、不写任何 marker；一致状态下字段不出现，零漂移。
4. 投影只描述事实矛盾并给建议，**不自动修复**——落标仍只能由 `openlogos deploy-done` 这一唯一 writer 完成。

### S21 场景文档化要求

场景总览已登记 S21（标记部署完成）并链接 `core-S21-deploy-done-marker.md`，但该文件缺失——S21 的时序、异常与追溯从未文档化，是本次事故所涉闭环唯一缺文档的场景。必须补齐完整场景文档：`deploy-done` 受控落标的目标、参与者、前后置条件、Mermaid 时序（verify 校验 → `[deploy]` 勾选同步 → 旧 smoke 标记清理 → 写标）、异常与边界、追溯，并覆盖消费侧（smoke / archive / status / next 如何消费 `DEPLOY_DONE`）。

### 场景验收条件

#### S19 smoke 门禁

- 活跃提案缺 `DEPLOY_DONE` 时 `openlogos smoke` fail-closed 拒绝：非零退出、错误码稳定、提示含 `openlogos deploy-done`，且 `SMOKE_PASS` / `SMOKE_FAIL` 与 smoke 报告均未产生。
- `[deploy]` 未全勾时同样 fail-closed 拒绝并给出补救命令。
- 四项前置全部满足时放行，既有 gate / 覆盖 / sandbox 判定逐项零回归。

#### S09 变更生命周期

- 缺 `VERIFY_PASS` → archive 拒绝；需部署提案缺 `DEPLOY_DONE` → 拒绝；需 smoke 提案缺 `SMOKE_PASS`（或存在 `SMOKE_FAIL`）→ 拒绝；三者均不移动目录、不删 guard。
- 无需部署的提案在 `VERIFY_PASS` 后照常归档（零回归）。

#### S05 下一步建议

- 构造「`SMOKE_PASS` 在场而 `DEPLOY_DONE` 缺失」的孤儿状态：`next` 输出 `state_inconsistency` 投影且人读引导含 `openlogos deploy-done` 补救建议。
- 一致状态下 `next` 输出不含该字段，既有引导逐字不变。

#### S11 状态进度

- 同一孤儿状态下 `status --format json` 的 `modules[].active_change.state_inconsistency` 在场且 `kind` / `evidence` / `remediation` 三字段齐备。
- 一致状态下该字段不出现；`proposal_step` 派生结果在两种状态下均与修复前一致（投影不改派生）。

#### S21 deploy-done 受控落标

- `core-S21-deploy-done-marker.md` 存在且含目标、参与者、前后置条件、Mermaid 时序、步骤说明、异常与边界、追溯；场景总览链接可达。
- `deploy-done` 命令行为零变化（既有校验、`[deploy]` 勾选同步、旧 smoke 标记清理逐项保持）。

### 非目标

- 不改 `openlogos deploy-done` 的命令行为、校验集合与唯一 writer 地位。
- 不实现 auto-heal（smoke 自动补写 `DEPLOY_DONE`）。
- 不改 `proposal_step` 派生本身与 flow 节点定义；不新增 marker、gate、cache 或落盘状态。
- 不给 `openlogos archive` 新增 stdout JSON envelope。

## OpenLogos 0.14.25 候选发布需求

### 用户价值

三处修复均落在 `openlogos smoke` / `openlogos archive` / `status` / `next` 的 CLI 行为上：不发布不部署，本机全局运行的 0.14.25 之前版本将继续带着漏标缺口运行——smoke 仍可在 deploy 门未过时写 `SMOKE_PASS`、archive 仍可归档缺口提案、面板仍会僵死。用户决策 C01：发 0.14.25 并本机全局部署，早上线早止损。

### 候选发布要求（S19）

1. **候选身份链同步**：CLI package/lockfile、全部随包 plugin/资产模板 manifest、package asset manifest、`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.25`、`LOCAL_RELEASE_ROLLBACK_VERSION=0.14.24` 与发布身份 tripwire/golden 全链一致；真实 `npm pack` 冻结唯一 tarball SHA-256。
2. **隔离矩阵（部署前强制）**：一次性 npm prefix 安装固定 tarball，从绝对入口验收——candidate identity 无 workspace link；**fail-closed 拒绝矩阵**（缺 `DEPLOY_DONE` 的 smoke 拒绝、`[deploy]` 未全勾的 smoke 拒绝、缺 `VERIFY_PASS` / 缺 `DEPLOY_DONE` / 缺 `SMOKE_PASS` 的 archive 拒绝）；**对账投影**（孤儿 `SMOKE_PASS` 状态下 `status` / `next` 输出 `state_inconsistency`）；**补标后全链放行**（执行 `openlogos deploy-done` 后 smoke 与 archive 恢复放行）；`0.14.24→0.14.25` roundtrip 无混装。
3. **零回归对照（强制）**：同一缺标场景在固定 `0.14.24` 上必须复现**缺陷本身**——smoke 照常执行并写 `SMOKE_PASS`、archive 照常成功、`status` / `next` 无 `state_inconsistency` 字段；旧版也拒绝则矩阵空转，必须重写矩阵而非放行部署。
4. **全局覆盖与 smoke**：矩阵与回滚演练 PASS 且用户授权后覆盖本机全局；新 shell 复核 identity 全同源 `0.14.25`；`openlogos smoke`（SMOKE-core-196）独立授权执行。
5. 回滚制品固定 0.14.24 tarball 并留痕 SHA-256；回滚自检失败不得覆盖全局。

### 场景验收条件

#### S19 候选发布与 smoke 门禁

- 0.14.25 候选身份全源一致（UT-S19-45 tripwire）；SMOKE-core-196 全链 PASS 且 0.14.24 缺陷对照有效；部署与 smoke 各为独立人类确认点。

### 非目标

- 除生命周期 fail-closed 与状态对账修复外零新增语义；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。

## 切片规划单条受控写入口要求

### 用户价值

切片事务把「写一次切片规划」拆成 `submit-content`（×2 slot）→ `seal` → `apply` 共 6 次 CLI 往返，每次都是失败机会；实测某提案 apply 曾因 `task_text` 与 `[code]` 条目非逐字一致而拒绝，该拒绝不保护任何用户可感知价值——实际写入方只有一个顺序执行的 AI，且 `tasks.md` 与 manifest 均受 git 跟踪。同时，**切片规划的结构化产物不得改由 AI 自行写入**：流程判断必须使用结构化数据，若把 `owned_test_ids` 改从 `tasks.md` 散文解析，实测会把正文中「被提及」而非「被拥有」的测试 ID 一并算入，使验收 eligible 集合多算并以缺结果误红。

### 验收条件

#### S32 切片规划

- **GIVEN** 活跃提案处于 ready-to-implement 且 `[code]` 未填
- **WHEN** 执行 `openlogos slice plan --file <slices.json>`（`slices.json` 含 `slice_id` / `owned_test_ids` / `runner_selectors` / `spec_targets`）
- **THEN** 命令一次性完成：校验结构化输入 → 写 `tasks.md` 的 `[code]` 段 → 写 `TEST_SLICE_MANIFEST.json` → 依**刚写出的** `tasks.md` 自算 `task_fingerprint`；全过程一次 CLI 往返，无 slot、无 staging、无 seal、无 receipt
- **AND** 结构化产物的生成权在 CLI，不由 AI 直接写入 manifest
- **AND** 重复执行幂等：同一 `slices.json` 重跑得到同一 `[code]` 与同一 manifest

#### S32 校验失败零副作用

- **GIVEN** `slices.json` 结构非法（缺字段、`slice_id` 重复、`owned_test_ids` 含未定义 ID）
- **WHEN** 执行 `openlogos slice plan`
- **THEN** 非零退出并报稳定错误码，`tasks.md` 与 `TEST_SLICE_MANIFEST.json` 均不被修改

### 保留不变（零回归边界）

- `verify` 的 `slice-checkpoint` 增量验收（收窄验收分母与实际执行）逐项不变——「每个切片实现后能单独通过验收」是产品能力，不随事务删除。
- `TEST_SLICE_MANIFEST.json`、`SLICE_CHECKPOINTS.jsonl` 作为结构化事实源保留。
- `slice_state` / `code_slices_green` / `slice-exit` 切片循环能力保留。
- `task_fingerprint` / `spec_fingerprint` 保留，其 stale 判定由阻塞降级为警告。

### 非目标

- 不触及合并事务（`merge transaction` 命令族）与 `openlogos merge`——归后续提案。

## merge 直接合并与规格结构检查要求

### 用户价值

合并事务把「把 N 个 delta 合进主文档」拆成 N×3 + 3 次 CLI 往返（11 目标的提案即 36 次），每次都是失败机会；其保护的「多方并发写同一批文件的原子性」在实际场景中不存在——写入方只有一个顺序执行的 AI，且 `logos/resources/` 受 git 跟踪。2026-09-07 的三向死锁（reopen 拒 / abort 拒 / merge 认为已完成）正是该外壳的产物。

同时，seal preflight 承担的**规格结构检查**（重复 ID、表格列数）是真实价值——它曾发现同一测试 ID 被两个用例共用、验收结果被静默覆盖。删除事务不得连带丢失该能力，故同批提供独立命令替代。

### 验收条件

#### S09 merge 直接合并

- **GIVEN** 活跃提案的 `[delta]` 已全部产出且 change-lint 通过
- **WHEN** 执行 `openlogos merge <slug>`
- **THEN** 命令**一次调用**完成：读 `deltas/` → 逐目标合成最终字节（含物质结果复验）→ 原子落盘全部目标 → 写含 `test_change_set` 的 `SPEC_MERGED`
- **AND** 无 content slot、无 staging、无 seal、无 receipt、无相位机
- **AND** 合并中途任一目标失败即整批回滚，主文档保持合并前字节，并提示 `git checkout logos/resources/` 作为回滚点

#### S09 SPEC_MERGED 结构化字段零回归

- **GIVEN** merge 成功
- **THEN** `SPEC_MERGED` 含 `test_change_set` 结构化字段，其 schema 与内容口径与事务时代逐字段一致；verify / change-lint / test-slice-manifest 三处消费方读取行为零改动

#### S09 规格结构检查独立可用

- **GIVEN** 测试规格中存在重复 ID 或表格列数异常
- **WHEN** 执行 `openlogos lint-specs`
- **THEN** 命令报出重复 ID 与结构问题并非零退出
- **AND** 该命令**不参与任何门**——merge / verify / archive 均不因其结论而阻断；它是用户主动运行的诊断工具

### 非目标

- 不触及 change-lint 的 L8 / L9 / L10（归后续提案）。
- 不触及 1a 已确立的 `slice plan` 与 slice-checkpoint 增量验收。

## merge 目标集由 delta 文件派生要求

### 用户问题与价值

合并需要知道「把哪些 delta 合进哪些主文档」。此前这个集合来自作者在 `proposal.md` 中手工枚举的闭包计划，与磁盘事实是两份数据，因此需要 P==T==D 三方对账来发现它们不一致——而不一致本身正是手工枚举带来的。

真正可靠的事实源是 `deltas/` 目录本身：作者产出了哪些 delta，就要合并哪些目标。这个集合不需要声明，只需要枚举。

### 核心需求

1. **目标集是 `deltas/` 的无逻辑投影**：每个可 merge 的 delta 文件经唯一的路径映射判据得到唯一 canonical target；merge 不读 `proposal.md` 的任何 YAML 声明。
2. **模式按磁盘事实即时判定**：目标文件存在即 MODIFY、缺失即 CREATE，在 merge 执行时判定。计划与事实分离所导致的「模式漂移」在结构上不再可能发生。
3. **路径非法即 fail-closed**：无法映射为 canonical target 的 delta（越界、`..`、未知类别目录）必须在写入任何文件前整体失败并点名该文件。
4. **存量兼容**：历史提案中已写的 `baseline_closure` 块被忽略而非报错，不做迁移。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-DERIVE-01 | merge 目标集等于 `deltas/` 下可 merge delta 的路径映射结果，逐个一一对应；merge 全程不读取 proposal 的 YAML 声明 |
| AC-DERIVE-02 | 目标存在判 MODIFY、缺失判 CREATE，且在 merge 执行时按磁盘事实判定 |
| AC-DERIVE-03 | 路径不可映射的 delta 在写入前整体失败并点名文件，`logos/resources/` 零改动 |
| AC-DERIVE-04 | 存量 `baseline_closure` 块不产生任何 violation 或 warning |

### 追溯

- 场景：S39 delta→canonical target 派生。
- 测试：UT-S39-68、UT-S39-69、ST-S39-30。

## verify 判定层收敛与 0.15.0 发布要求

### 用户问题与价值

`openlogos verify` 此前让三层同时参与放行：作者在设计期勾选的覆盖度清单、机器观察到的测试执行结果、人工维护的 AC 追溯矩阵。第一层与第三层是「人声称覆盖了」，第二层与 ID 覆盖检查是「机器看到确实跑了」。让声明参与放行，等于让声明覆盖事实。

同时，真正不可替代的那条判据必须留下：**规格声明了哪些用例，就必须都真的跑过**。否则「规格声明 10 个、只实现 3 个、那 3 个绿了」也会判通过，规格驱动的核心价值就没了。

### 核心需求

1. **Gate 判据收敛为三项**：结果账本自洽、零失败、零未覆盖。设计时覆盖度清单与 AC 追溯矩阵不再参与判定，其报告段与 JSON 字段一并移除。
2. **ID 覆盖检查完整保留**：规格声明的 ID 集合必须是测试结果中出现的 ID 集合的子集；未覆盖时判 FAIL 并逐个点名。
3. **文档保留**：测试规格中的「三、覆盖度校验」小节与 AC 追溯行作为文档保留，供人阅读，不被解析。
4. **0.15.0 为破坏性版本**，不做兼容层；以真实 tarball 在一次性隔离 npm prefix 中证明安装态身份与行为。
5. **不做本机全局安装**：全局保持 0.14.25 直到 runlogos 侧改造完成（减法方案 §13 保险条款）。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-VERIFY-LAYER-01 | Gate 判据恰为三项；设计时清单未勾选或 AC 追溯缺链均**不影响** Gate 结论 |
| AC-VERIFY-LAYER-02 | 规格声明 ID 未全部出现在结果中时判 FAIL 并逐个点名；该判据强度与收敛前逐字相同 |
| AC-VERIFY-LAYER-03 | 报告与 JSON envelope 不再含 `checklist` / `ac_trace` 字段与其失败原因码 |
| AC-RELEASE-0150-01 | 隔离 prefix 内 candidate identity 全部来自固定 tarball，无 workspace link |
| AC-RELEASE-0150-02 | 已删除的命令面（`merge transaction *`、`merge-apply`、切片事务）一律非零退出；`merge <slug>` 一次调用完成多目标合并 |
| AC-RELEASE-0150-03 | `change-lint` 为 9 项；`slice plan` 与 `lint-specs` 可用 |
| AC-RELEASE-0150-04 | **本机全局仍为 0.14.25**——部署全程未触碰全局 prefix |

### 追溯

- 场景：S13 消费 verify 结果、S19 发布与安装态 smoke。
- 测试：UT-S13-67～68、ST-S13-19、UT-S19-46、ST-S19-22。
- 部署后 smoke：SMOKE-core-197～199。
