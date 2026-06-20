# OpenLogos 需求文档

> 最后更新：2026-06-20

## 一、产品背景与目标
### 1.1 产品定位
OpenLogos 是一套面向 AI 协作的软件研发方法论、CLI 工具和规范资产集合，用于把 AI 的参与过程约束到 WHY → WHAT → HOW 的标准研发链路中。

### 1.2 核心目标
1. 让用户能够用统一的阶段与场景语言组织需求、设计、实现与验收。
2. 让 AI 工具在不同宿主环境中遵循同一套方法论与产物格式。
3. 让 OpenLogos 自身也能被 OpenLogos 管理，形成可追溯、可验收、可迭代的标准基线。

### 1.3 目标用户画像
- 维护 OpenLogos CLI 的开发者。
- 使用 Codex、Claude Code、OpenCode、Cursor 的方法论实践者。
- 需要在 AI 时代建立标准研发流程的个人或小团队。

## 二、用户痛点分析
### P01：AI 直接生成代码，缺少结构化研发过程
因为用户先问”怎么实现”，导致需求、设计、测试与发布顺序被打乱 → 导致 AI 输出不可追溯、难验证 → 造成后续返工和流程失控。

### P02：不同 AI 工具的接入方式不一致
因为不同宿主工具有不同的指令文件、插件和工作区约定 → 导致同一个项目在不同工具下行为不一致 → 造成上下文丢失和维护成本上升。

### P03：已有实现缺少统一的文档真相源
因为仓库早期产物分散在代码、规范、示例和测试中 → 导致 AI 无法快速判断”什么已经完成、下一步该做什么” → 造成阶段判断和交付判断不稳定。

### P04：已有项目无法低摩擦接入 OpenLogos
因为 `openlogos init` 入场路径假设从第零天开始，要求走完 Phase 1→3 全部文档才能进入变更管理模式 → 导致已有代码的用户不知道从哪里开始 → 造成方法论无法落地到存量项目。

### P05：部署完成状态依赖 AI 手写 marker
因为 `openlogos verify` 和 `openlogos smoke` 都由 CLI 自动写入对应 PASS/FAIL marker，而部署完成后的 `DEPLOY_DONE` 只能依赖 AI 在 skill 步骤中手写 → 导致部署实际成功后仍可能因为 marker 遗漏而卡在 `ready-to-deploy` → 造成后续 smoke、archive 和状态面板无法继续推进。

## 三、场景总览
| 编号 | 场景名称 | 触发条件 | 关联痛点 | 优先级 |
|------|---------|---------|---------|--------|
| S01 | 初始化 OpenLogos 项目 | 首次在空目录接入 | P01/P02/P03 | P0 |
| S05 | 查看下一步建议 | 需要快速知道当前该做什么 | P01/P03 | P0 |
| S08 | 同步 AI 工具资产与资源索引 | 配置变更后需要刷新 AI 资产 | P02/P03 | P0 |
| S09 | 创建、合并、归档变更提案 | 开始一次受控迭代时 | P01/P03 | P0 |
| S11 | 查看阶段进度与活跃变更 | 需要确认当前状态 | P03 | P0 |
| S13 | 运行测试验收并生成报告 | 代码实现完成后 | P01/P03 | P0 |
| S14 | 切换到 launched 生命周期 | 首轮交付完成并进入活跃迭代 | P01/P03 | P0 |
| S15 | 处理 SQL 注释规范 | 需要从 SQL 文件中提取元数据时 | P03 | P1 |
| S16 | 输出机器可读 JSON | 需要被脚本或工具消费时 | P03 | P1 |
| S17 | 管理模块注册表 | 项目分模块演进时 | P03 | P1 |
| S18 | 同步 resource_index | 文档新增或更新后 | P03 | P0 |
| S19 | 执行部署后 smoke 门禁 | 已部署到目标环境后 | P01/P03 | P0 |
| S20 | 已有项目接入 OpenLogos | 在已有代码库上首次接入 | P04/P02/P03 | P0 |
| S21 | 标记部署完成 | 外部部署已成功，需要推进提案状态 | P01/P03/P05 | P0 |
| S22 | 查看与解析 flow 编排 | 需要查看内置研发流程或经 overlay 解析后的生效流程时 | P03 | P1 |
| S23 | 实时观测派生研发状态（watch） | 需要持续盯住派生状态、被外部面板/CI 消费时 | P03 | P1 |
| S24 | next --auto 自动跳过可跳人类确认点（skip-gate） | 需要在受控自动化下越过可跳确认点时 | P01/P03 | P1 |
| S25 | overlay 驱动 status/next/watch 派生 | 用 overlay 增删改研发流程节点并希望据此推进（而非仅 flow show 可见）时 | P03 | P1 |

## 四、核心场景详述
### S01: 初始化 OpenLogos 项目
- **触发条件**：用户在空目录中准备创建新项目，或需要把现有目录接入 OpenLogos。
- **用户价值**：一次性生成标准目录、配置、AI 指令文件、基础索引、可执行的 verify 预跑配置，以及可直接归档参考资料的分类目录。
- **优先级**：P0
- **主路径**：CLI 检查初始化状态，生成目录结构与基础配置，尽可能补齐 verify 预跑配置，部署 AI 指令文件，并提示后续从需求文档开始。

#### 验收条件
##### 正常：全新项目初始化
- **GIVEN** 当前目录没有 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos init my-project`
- **THEN** 生成 `logos/` 标准目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md` 和 `CLAUDE.md`；若可识别测试栈，还应写入可执行的 `verify.pre_run_command`；`logos/resources/reference/` 下默认生成 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录

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

##### 正常：需要部署提案验收通过
- **GIVEN** 活跃提案 `proposal.md` 声明需要部署，且 `tasks.md` 存在 `[deploy]` section
- **WHEN** `VERIFY_PASS` 已存在且用户执行 `openlogos next`
- **THEN** 输出部署需要人类明确授权，并提示按部署方案执行部署任务

### S08: 同步 AI 工具资产与资源索引
- **触发条件**：项目配置、AI 工具目标或文档内容变化后需要刷新。
- **用户价值**：让 AI 工具指令、插件、资源索引和 verify 预跑配置保持同步。
- **优先级**：P0
- **主路径**：CLI 同步 `AGENTS.md`、`CLAUDE.md`、插件模板、Skills 与 `resource_index`，并对缺失的 verify 预跑配置进行补齐或诊断。

#### 验收条件
##### 正常：配置更新后同步
- **GIVEN** `logos.config.json` 或 `logos-project.yaml` 已更新
- **WHEN** 用户执行 `openlogos sync`
- **THEN** 相关 AI 资产与 `resource_index` 被重新生成或补录

##### 正常：旧项目缺失 verify 预跑配置时补齐或提示
- **GIVEN** 已初始化项目缺少 `verify.pre_run_command`、`verify.regression_command` 和 `verify.incremental_command`
- **WHEN** 用户执行 `openlogos sync`
- **THEN** CLI 对可识别测试栈写入默认预跑命令；无法推断时输出明确 TODO，不静默跳过

### S09: 创建、合并、归档变更提案
- **触发条件**：用户需要对已发布项目做受控迭代。
- **用户价值**：把每次变更限定在 proposal/delta/merge/archive 流程中，并在提案级明确是否需要部署。
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
- **用户价值**：把流程从首次开发切换到受控变更。
- **优先级**：P0
- **主路径**：验证验收与部署门禁后，把模块生命周期标记为 launched。

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
- **用户价值**：用户不需要把存量代码当作全新项目从零推进，但仍能一次性获得完整 OpenLogos 基础设施、AI 工具资产、语言策略、verify 预跑配置、推荐沙箱策略、Reference 分类目录和变更管理入口。
- **优先级**：P0
- **主路径**：CLI 检测已有项目信息，交互确认项目名、文档语言与 AI 工具，按 `init` 等价能力生成完整基础设施与 Reference 分类目录；推断并写入 verify 预跑配置或输出 TODO；默认写入兼容的沙箱配置建议；模块写入 `bootstrap: adopted` 与 `lifecycle: launched`，输出接入报告并建议创建补文档提案。

#### 验收条件
##### 正常：已有项目完整接入
- **GIVEN** 当前目录存在 `package.json`（或其他项目清单文件），且没有 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** CLI 生成与 `init` 同级别的基础设施：`logos/` 标准目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md`、`CLAUDE.md`、`logos/spec/` 和所选 AI tools 的 Skills / 插件 / 命令资产；`logos/resources/reference/` 下默认生成 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录；`logos-project.yaml` 中模块包含 `bootstrap: adopted` 与 `lifecycle: launched`；`logos.config.json` 包含 `verify.result_path`，并在可推断时包含 verify 预跑配置与推荐沙箱配置；输出接入报告并建议执行 `openlogos change add-baseline-docs`

##### 正常：语言和 AI 工具选择
- **GIVEN** 用户在无 `logos/` 的存量项目目录中执行 `openlogos adopt`
- **WHEN** 命令进入检测与确认阶段
- **THEN** 用户可以通过交互或 `--locale <en|zh>` 选择文档语言，并通过交互或 `--ai-tool <claude-code|opencode|codex|cursor|other|all>` 选择 AI 工具；生成的 `logos.config.json`、根目录指令文件和 AI 资产必须与选择一致

##### 正常：可识别测试栈时补齐 verify 预跑配置
- **GIVEN** 已有项目包含可识别测试脚本或测试框架配置
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** 生成的 `logos.config.json` 包含可执行的 verify 全量预跑命令，RunLogos 仍只需调用 `openlogos verify --format json`

##### 正常：无法推断测试命令时输出 TODO
- **GIVEN** 已有项目无法推断测试命令
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** CLI 在接入报告中输出明确 TODO，提示用户补充 `verify.pre_run_command` 或 `verify.regression_command`，并说明 sandbox 配置仍可按默认推荐值写入

##### 正常：接入后 next 引导补文档
- **GIVEN** 项目已通过 `adopt` 接入（`bootstrap: adopted`），且无活跃变更提案
- **WHEN** 用户执行 `openlogos next`
- **THEN** 输出补文档引导，建议先执行 `openlogos change add-baseline-docs`，不建议直接开始业务迭代

##### 正常：status 不将 Initial 文档缺失显示为错误
- **GIVEN** 项目已通过 `adopt` 接入（`bootstrap: adopted`）
- **WHEN** 用户执行 `openlogos status`
- **THEN** Phase 1、Phase 2 和 Phase 3-0 显示为「文档基线已跳过（存量项目接入）」，不显示为未完成或错误

##### 正常：launch 对存量项目接入模块豁免 Initial 文档门禁
- **GIVEN** 项目模块 `bootstrap: adopted` 且 `lifecycle: launched`
- **WHEN** 用户执行 `openlogos launch`
- **THEN** 不检查 Phase 1、Phase 2 和 Phase 3-0 文档是否存在，直接放行

##### 正常：历史 skipped 项目兼容
- **GIVEN** 历史项目的 `logos-project.yaml` 中存在 `bootstrap: skipped`
- **WHEN** 用户执行 `openlogos status`、`openlogos next`、`openlogos launch` 或 `openlogos detect --format json`
- **THEN** CLI 将其按存量项目接入模式处理，不破坏补文档引导、状态展示、launch 豁免和生命周期派生；新写入的项目必须使用 `bootstrap: adopted`

##### 异常：目录已存在 logos/ 时拒绝重复接入
- **GIVEN** 当前目录已存在 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** 输出错误并退出，不覆盖已有文件；提示用户该项目已初始化

### S21: 标记部署完成
- **触发条件**：活跃提案已通过 `openlogos verify`，提案声明需要部署，`tasks.md` 存在 `[deploy]` section，且部署动作已由人类明确授权并实际完成。
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
- **触发条件**：在受控自动化（无人值守 / yolo）场景下，用户希望 `openlogos next` 自动越过被声明为可跳的人类确认点，同时仍守住高危确认点（如生产部署）。
- **用户价值**：让流程在自动化模式下持续推进，而不在每个可跳确认点停顿；同时通过审计留痕保证可追溯，并严格守住 `skippable:false` 的高危 gate。
- **优先级**：P1
- **主路径**：用户执行 `openlogos next --auto`；CLI 取当前停顿步对应的 launched flow gate——若其 `skippable:true`（对应 `ready-to-merge` 的 propose 出口 gate）则视为已通过、放行并输出下一动作建议，同时向活跃提案目录下的 `GATE_AUTO_PASSED` JSONL **追加一行** `{gate_id, proposal_step, timestamp}`（不去重、不覆盖）；若其 `skippable:false`（对应 `ready-to-deploy` 的 deliver 入口 gate）则保持人类停顿。**默认 `next`（无 `--auto`）严格 1:1 不变，且忽略 `GATE_AUTO_PASSED`，绝不因其存在而自动越过 gate。**

> **范围边界（最小 A 方案）**：本场景仅作用于 launched 的两个 gate（propose 出口 `ready-to-merge` 可跳、deliver 入口 `ready-to-deploy` 不可跳）。`smoke` 节点无对应 gate，`ready-to-smoke` 不在 `--auto` 范围（它只是"运行 smoke"，非人类确认 gate）。initial 的 WHY/WHAT 建议门本轮不接入 `--auto`（仅 schema 预留）。

#### 验收条件
##### 正常：可跳 gate 在 auto 下放行并留痕
- **GIVEN** 活跃提案处于 `ready-to-merge`（propose 出口 gate，`skippable:true`）
- **WHEN** 用户执行 `openlogos next --auto`
- **THEN** CLI 视该 gate 为已通过、输出合并后的下一动作建议，并向活跃提案目录下 `GATE_AUTO_PASSED` JSONL 追加一行 `{gate_id, proposal_step, timestamp}`

##### 正常：不可跳 gate 在 auto 下仍保持停顿
- **GIVEN** 活跃提案处于 `ready-to-deploy`（deliver 入口 gate，`skippable:false`）
- **WHEN** 用户执行 `openlogos next --auto`
- **THEN** CLI 仍输出"需人类明确授权部署"，不放行、不写 `GATE_AUTO_PASSED`

##### 正常：重复 --auto 总是追加审计行
- **GIVEN** 同一可跳 gate 已被 `--auto` 放行并写过一行审计
- **WHEN** 用户再次对同一停顿点执行 `openlogos next --auto`
- **THEN** `GATE_AUTO_PASSED` JSONL **再追加一行**（不去重、不覆盖）；派生结论不受影响、可安全重跑

##### 正常：默认 next 忽略 GATE_AUTO_PASSED
- **GIVEN** 活跃提案目录已存在 `GATE_AUTO_PASSED` 审计文件，且提案仍处于某个可跳 gate
- **WHEN** 用户执行 `openlogos next`（无 `--auto`）
- **THEN** 输出与未引入 `--auto` 时严格一致（1:1），绝不因 `GATE_AUTO_PASSED` 存在而自动越过 gate

##### 正常：smoke 不在 --auto 范围
- **GIVEN** 活跃提案处于 `ready-to-smoke`
- **WHEN** 用户执行 `openlogos next --auto`
- **THEN** 输出与默认 `next` 一致（提示明确授权运行 `openlogos smoke`），不写 `GATE_AUTO_PASSED`

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
