# core-01-feature-specs

## 一、核心能力列表
1. 初始化 OpenLogos 项目（全新项目）。
2. 已有项目接入 OpenLogos（`adopt`，执行完整基础设施初始化，只跳过 Initial 文档门禁）。
3. 同步 AI 工具资产与资源索引。
4. 查看阶段进度与下一步建议。
5. 创建、合并、归档变更提案。
6. 执行 verify 与 smoke。
7. 切换 launched 生命周期。
8. 管理模块注册表。
9. 解析 SQL 注释与输出 JSON。
10. 预执行 verify 的回归与增量测试，并输出机器可读预跑状态。
11. 标准化 verify / smoke 沙箱执行策略，降低测试命令误写工作区风险。

## 二、规格边界
### 2.1 CLI 交互
- 所有命令必须支持明确的成功与失败输出。
- `--format json` 结果必须稳定可解析。

### 2.2 AI 资产
- `AGENTS.md`、`CLAUDE.md`、Skills 和插件模板必须由 `sync`/`init`/`launch` 维护。

### 2.3 变更管理
- 活跃 guard 存在时，新变更必须被阻止。
- merge 前必须先有 proposal 和 tasks。

### 2.4 资源索引
- 新文档与关键文档必须通过 `resource_index` 可发现。

### 2.5 提案级部署决策
- `proposal.md` 的 `## 部署影响` 是每个提案的部署决策入口，必须明确是否需要部署、是否需要 smoke、部署原因、影响环境、数据迁移与回滚要求。
- `tasks.md` 的 `[deploy]` section 是部署执行任务入口，只能在提案声明需要部署时存在。
- `openlogos status`、`openlogos next` 和 RunLogos 面板必须优先使用提案级部署决策；模块级 `deployment_required` / `smoke_required` 只作为缺少提案级决策时的兼容默认值。
- `openlogos status --format json` 必须额外输出 `deployment_progress` 与 `deployment_document`，其中 `deployment_progress` 仅统计当前提案 `tasks.md` 的 `[deploy]` section，`deployment_document` 必须指向当前提案 `tasks.md`。
- `deployment_progress` 建议结构为 `{ checked, total, percent, status, label }`，其中 `status` 取值为 `pending` / `done` / `empty` / `unavailable`。
- `deployment_document` 建议结构为 `{ path, name, exists }`，并保留 `path` 便于降级诊断。
- 文档-only、规格-only、索引修正类提案若声明无需部署，verify PASS 后必须直接建议 archive，不展示部署执行按钮或 smoke 按钮。
- 代码运行时、打包产物、发布脚本、插件模板或官网构建受影响的提案若声明需要部署，verify PASS 后必须进入部署授权流程。
- 当 `proposal.md` 与 `tasks.md` 冲突时，CLI 必须在 status / next 中给出警告，并阻止“无需人工确认的自动部署”。
- 冲突状态必须通过 `deployment_decision_conflict=true` 显式暴露，作为 CLI 和 RunLogos 的阻断信号；冲突未修正前不得展示 deploy、smoke 或 archive 作为主动作。

### 2.6 bootstrap: adopted 行为约束

- `adopt` 命令生成的 `logos-project.yaml` 中，模块 `bootstrap` 字段值为 `adopted`，`lifecycle` 直接为 `launched`。
- `bootstrap: adopted` 表示模块通过存量项目接入进入 OpenLogos；它不是“首轮方法论闭环已完成”，而是“完整 OpenLogos 基础设施已初始化，Initial 文档基线被接入流程豁免，后续应通过补文档提案补齐”。
- `bootstrap: adopted` 模块不要求 Phase 1、Phase 2 和 Phase 3-0 文档存在；`status` 将其显示为「文档基线已跳过（存量项目接入）」，而非未完成。
- `next` 在 `bootstrap: adopted` 且无活跃提案时，固定输出补文档引导，建议执行 `openlogos change add-baseline-docs`，不建议直接开始业务迭代。
- `launch` 对 `bootstrap: adopted` 且 `lifecycle: launched` 的模块豁免 Initial 文档门禁检查。
- CLI 必须继续兼容历史 `bootstrap: skipped`，读取时按 adopted 接入模式处理；但 `adopt` 新写入的项目必须使用 `bootstrap: adopted`。
- 补文档提案（如 `add-baseline-docs`）归档后，`next` 恢复正常阶段建议逻辑。若后续需要表示基线已补齐，可由专门变更引入 `baseline_status`，本次不新增第三个状态维度。

### 2.7 verify 预执行模型
- `openlogos verify` 必须在读取 JSONL 前处理 verify 预执行配置。
- 旧字段 `verify.pre_run_command` 保持兼容：配置后按单阶段全量测试执行。
- 新字段 `verify.regression_command` 与 `verify.incremental_command` 用于两阶段模型：回归测试先执行，增量测试后执行。
- 两阶段结果必须可合并，最终验收仍只读取一个逻辑结果集合；重复用例 ID 以最后一次结果生效。
- `verify.result_path` 表示最终合并结果路径；`verify.regression_result_path` 和 `verify.incremental_result_path` 可用于阶段化结果文件，避免第二阶段 reporter 清空第一阶段结果。
- 若配置 `verify.sandbox_mode` 且存在预跑命令，预跑命令必须通过统一沙箱执行器运行。
- 未配置任何预跑命令时，verify 仍保持兼容可执行，但覆盖不足时必须输出清晰诊断和修复建议。

### 2.8 init / sync / adopt 预跑配置补齐
- `openlogos init` 与 `openlogos adopt` 应识别常见测试栈并写入合理的 verify 预跑配置。
- Node 项目优先读取 `package.json` 的 `test` 脚本；若检测到 Vitest/Jest，可建议或写入 `npm test` / `npx vitest run` / `npx jest`。
- Python 项目优先识别 pytest，Go 项目使用 `go test ./...`，Rust 项目使用 `cargo test`。
- `openlogos sync` 应对旧项目补齐缺失的 verify 预跑配置；无法推断时输出 TODO，不应静默跳过。
- 自动补齐不得覆盖用户已有的 `pre_run_command`、`regression_command` 或 `incremental_command`。
- `init` / `adopt` / `sync` 可补齐推荐的 `verify.sandbox_mode=auto`、`verify.sandbox_root` 与 `verify.sandbox_deny_workspace_write=true`，但不得覆盖用户已有沙箱配置。

### 2.9 verify / smoke 沙箱执行策略
- `openlogos verify` 与 `openlogos smoke` 必须支持沙箱执行策略，配置入口位于 `logos.config.json` 的 `verify` 与 `smoke` 节点。
- 新增配置字段：
  - `sandbox_mode`: `"off"` / `"auto"` / `"always"`
  - `sandbox_root`: 沙箱工作根目录，默认建议 `/private/tmp`
  - `sandbox_deny_workspace_write`: 是否禁止命令写入仓库工作区，默认建议 `true`
- 未配置 `sandbox_mode` 的历史项目按 `"off"` 处理，保持兼容。
- `auto` 模式优先启用沙箱；若环境不支持隔离，可降级执行，但必须在文本和 JSON 输出中告警。
- `always` 模式必须强制隔离；无法创建沙箱、无法回收结果文件或检测到非白名单工作区写入时，命令必须失败。
- 沙箱执行结束后，CLI 只允许回收配置声明的结果文件：
  - verify: `result_path`、`regression_result_path`、`incremental_result_path`
  - smoke: `result_path`
- 沙箱诊断必须进入 JSON 输出，供 RunLogos / CI 判断是否展示降级告警或失败原因。

## 三、功能验收摘要
### S01
初始化后必须生成完整目录、配置和 AI 指令文件。

### S05
next 必须输出最可执行建议，而不是多条并列建议；存在活跃提案时，next 必须优先读取提案级部署决策。无需部署的提案在 verify PASS 后建议 archive；需要部署的提案在 verify PASS 后建议由用户明确授权部署；部署决策冲突时建议修正 proposal / tasks，不建议部署、smoke 或归档。

### S08
sync 必须同时处理 AI 资产和资源索引。

### S09
change/merge/archive 必须构成闭环；提案填写阶段必须同步形成部署影响判断。`proposal.md` 声明无需部署时，`tasks.md` 不得出现 `[deploy]` section；声明需要部署时，必须有 `[deploy]` section，并在 delta 阶段补齐部署方案与 smoke 影响。AI 生成 proposal/tasks 后必须先做一致性自检，自检失败不得进入 delta-writing。

### S11
status 必须显示阶段进度、活跃变更、提案级部署决策、部署进度摘要和下一步建议。JSON 输出必须暴露部署决策字段、部署进度摘要和任务文档入口，供 RunLogos 面板判断是否展示部署按钮、smoke 按钮和归档按钮。`deployment_decision_conflict=true` 时必须展示为阻塞态。

### S13
verify 必须关联测试用例与运行结果，并负责在读取结果前触发配置的测试预跑命令。若配置了 `regression_command` 与 `incremental_command`，verify 必须按顺序执行并合并结果；若配置了 `verify.sandbox_mode`，预跑命令必须通过沙箱执行器运行，并在 JSON 输出中暴露 `sandbox` 诊断；若覆盖不足且无预跑配置，必须诊断可能只运行了局部测试，并给出配置建议。

### S14
launch 必须检查验收、部署和 smoke 门禁。

### S15
SQL 注释解析必须保留表与字段元数据。

### S16
JSON 输出必须与文本输出共享同一事实源。`openlogos verify --format json` 必须暴露预跑命令执行状态、阶段结果路径、合并策略、沙箱执行状态、覆盖不足诊断与修复建议，供 RunLogos 展示，不要求客户端复刻测试编排逻辑。`openlogos smoke --format json` 必须暴露 smoke 门禁指标与沙箱执行状态。

### S17
模块增删改必须同步 YAML 与引用。

### S18
resource_index 必须能反向索引当前真相源。

### S19
smoke 必须验证部署后环境的最小可用链路，但只在提案级 `smoke_required: true` 且部署完成后进入。部署进度摘要仅能来自 `tasks.md` 的 `[deploy]` section，不能把 `[code]` section 误当作部署进度。若配置了 `smoke.sandbox_mode` 且存在 `smoke.command`，CLI 必须通过沙箱执行器运行 smoke 命令，并在文本与 JSON 输出中暴露沙箱诊断。

### S20
adopt 后必须生成完整 `logos/` 目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md`、`CLAUDE.md`、`logos/spec/` 和所选 AI tools 的 Skills / 插件 / 命令资产；生成的模块标记为 `bootstrap: adopted` 与 `lifecycle: launched`；同时应为可识别测试栈写入 verify 预跑配置与推荐沙箱配置，无法推断时输出 TODO。`status` 必须将 Initial 文档基线显示为「已跳过（存量项目接入）」；`next` 必须输出补文档引导；`launch` 必须豁免 Initial 文档门禁。目录已存在 `logos/logos.config.json` 时必须拒绝重复执行并报错。历史 `bootstrap: skipped` 项目必须保持兼容。
