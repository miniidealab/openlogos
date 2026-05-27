# OpenLogos 需求文档

> 最后更新：2026-05-27

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

## 四、核心场景详述
### S01: 初始化 OpenLogos 项目
- **触发条件**：用户在空目录中准备创建新项目，或需要把现有目录接入 OpenLogos。
- **用户价值**：一次性生成标准目录、配置、AI 指令文件、基础索引和可执行的 verify 预跑配置。
- **优先级**：P0
- **主路径**：CLI 检查初始化状态，生成目录结构与基础配置，尽可能补齐 verify 预跑配置，部署 AI 指令文件，并提示后续从需求文档开始。

#### 验收条件
##### 正常：全新项目初始化
- **GIVEN** 当前目录没有 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos init my-project`
- **THEN** 生成 `logos/` 标准目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md` 和 `CLAUDE.md`；若可识别测试栈，还应写入可执行的 `verify.pre_run_command`

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
- **用户价值**：把测试结果与测试用例规格关联，生成可读报告，并避免局部测试 JSONL 导致的覆盖率误失败。
- **优先级**：P0
- **主路径**：按配置执行 verify 预跑命令，支持旧的 `pre_run_command` 与新的回归 + 增量两阶段模型，读取合并后的 JSONL 结果和测试用例，计算覆盖度与通过率，写入验收报告。

#### 验收条件
##### 正常：兼容旧的 pre_run_command
- **GIVEN** `logos.config.json` 配置 `verify.pre_run_command`
- **WHEN** 用户执行 `openlogos verify`
- **THEN** CLI 先执行该命令，再读取 `verify.result_path` 中的测试结果

##### 正常：两阶段预跑并合并结果
- **GIVEN** `logos.config.json` 配置 `verify.regression_command` 与 `verify.incremental_command`
- **WHEN** 用户执行 `openlogos verify`
- **THEN** CLI 先执行回归测试，再执行增量测试，并按“同 ID 最后一次结果生效”合并两阶段 JSONL，最终按合并结果计算覆盖度

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
- **用户价值**：确认最小可用链路和部署环境可用，同时避免无需部署的提案误进入 smoke。
- **优先级**：P0
- **主路径**：读取提案级 smoke 决策、smoke 用例和结果，生成 smoke 报告并判断是否可继续归档。

#### 验收条件
##### 正常：需要 smoke 时进入 smoke 门禁
- **GIVEN** 活跃提案声明需要部署和 smoke，且部署已完成
- **WHEN** 用户执行 `openlogos status` 或 `openlogos next`
- **THEN** 下一步建议为明确授权执行 `openlogos smoke`

##### 正常：无需 smoke 时直接允许归档
- **GIVEN** 活跃提案声明需要部署但不需要 smoke，且部署已完成
- **WHEN** 用户执行 `openlogos status` 或 `openlogos next`
- **THEN** 下一步建议为 `openlogos archive <slug>`

### S20: 已有项目接入 OpenLogos
- **触发条件**：用户在已有代码库（有 `package.json` / `Cargo.toml` / `pyproject.toml` 或其他项目文件）的目录中首次接入 OpenLogos。
- **用户价值**：无需从头补齐全部设计文档，即可立即进入变更管理模式，并让已有项目的 verify 验收从接入开始具备可执行的预跑配置或明确诊断。
- **优先级**：P0
- **主路径**：CLI 检测已有项目信息，交互确认配置，生成 `logos/` 标准目录结构与配置文件，推断并写入 verify 预跑配置或输出 TODO，模块 `bootstrap` 标记为 `skipped`，`lifecycle` 直接设为 `launched`，输出接入报告并建议创建补文档提案。

#### 验收条件
##### 正常：已有项目快速接入
- **GIVEN** 当前目录存在 `package.json`（或其他项目清单文件），且没有 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** 生成 `logos/` 标准目录、`logos.config.json`、`logos-project.yaml`（含 `bootstrap: skipped`、`lifecycle: launched`）、`AGENTS.md` 和 `CLAUDE.md`；输出接入报告并建议执行 `openlogos change add-baseline-docs`

##### 正常：可识别测试栈时补齐 verify 预跑配置
- **GIVEN** 已有项目包含可识别测试脚本或测试框架配置
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** 生成的 `logos.config.json` 包含可执行的 verify 全量预跑命令，RunLogos 仍只需调用 `openlogos verify --format json`

##### 正常：无法推断测试命令时输出 TODO
- **GIVEN** 已有项目无法推断测试命令
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** CLI 在接入报告中输出明确 TODO，提示用户补充 `verify.pre_run_command` 或 `verify.regression_command`

##### 正常：接入后 next 引导补文档
- **GIVEN** 项目已通过 `adopt` 接入（`bootstrap: skipped`），且无活跃变更提案
- **WHEN** 用户执行 `openlogos next`
- **THEN** 输出补文档引导，建议先执行 `openlogos change add-baseline-docs`，不建议直接开始业务迭代

##### 正常：status 不将 Phase 1~3 缺失显示为错误
- **GIVEN** 项目已通过 `adopt` 接入（`bootstrap: skipped`）
- **WHEN** 用户执行 `openlogos status`
- **THEN** Phase 1~3 显示为「文档基线已跳过（快速接入）」，不显示为未完成或错误

##### 正常：launch 对快速接入模块豁免 Phase 1~3 门禁
- **GIVEN** 项目模块 `bootstrap: skipped` 且 `lifecycle: launched`
- **WHEN** 用户执行 `openlogos launch`
- **THEN** 不检查 Phase 1~3 文档是否存在，直接放行

##### 异常：目录已存在 logos/ 时拒绝重复接入
- **GIVEN** 当前目录已存在 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** 输出错误并退出，不覆盖已有文件；提示用户该项目已初始化

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
