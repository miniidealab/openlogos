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
12. 初始化 / 接入时生成 Reference 默认分类目录。
13. 标记部署完成（`deploy-done`，受控写入 `DEPLOY_DONE` marker）。
14. 查看与解析 flow 编排（`flow show`，加载内置模板、解析项目 overlay、查看 raw / resolved flow，支持 `--format json`）。
15. 实时观测派生研发状态（`watch`，轮询 `collectStatusData` 派生数据、初始快照 + 仅变化时流式输出，只读）。
16. next 自动跳过可跳人类确认点（`next --auto`，skip-gate，最小 A 方案 + `GATE_AUTO_PASSED` 审计留痕）。

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

### 2.10 Reference 默认分类目录
- `openlogos init` 与 `openlogos adopt` 创建标准目录结构时，必须保证 `logos/resources/reference/` 下存在以下子目录：`requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/`。
- 每个 Reference 子目录必须写入 `.gitkeep`，保证空目录可以被版本控制保留。
- `init` 与 `adopt` 应复用同一套标准目录定义，避免新项目初始化与已有项目接入产生目录差异。
- `sync` 不负责回填 Reference 子目录；本能力限定在首次初始化或首次接入时生效。

### 2.11 deploy-done 受控落标命令
- `openlogos deploy-done` 是部署完成状态的唯一推荐落标入口，用于替代 AI 直接手写 `logos/changes/<slug>/DEPLOY_DONE`。
- 命令只标记“部署已完成”，不得执行实际部署动作；build、push、ssh、npm publish、Cloudflare deploy 等仍属于部署方案和人类确认点。
- 命令必须支持：
  - `openlogos deploy-done`
  - `openlogos deploy-done --env staging`
  - `openlogos deploy-done --format json`
- 命令成功前必须校验：
  - 当前目录存在 `logos/logos.config.json`
  - `logos/.openlogos-guard` 指向有效活跃提案
  - 活跃提案存在 `VERIFY_PASS` 且不存在 `VERIFY_FAIL`
  - 提案部署决策无冲突，且 `deployment_required=true`
  - `tasks.md` 存在 `[deploy]` section 且至少有一个部署任务
  - `logos/resources/verify/deployment-report.md` 已存在
- 命令成功后必须：
  - 将当前提案 `tasks.md` 的 `[deploy]` section 任务勾选为 `[x]`
  - 写入 `logos/changes/<slug>/DEPLOY_DONE`
  - 清理同一提案中旧的 `SMOKE_PASS` 和 `SMOKE_FAIL`
  - 根据 `smoke_required` 输出下一步：需要 smoke 时提示 `openlogos smoke --env <env>`，无需 smoke 时提示 `openlogos archive <slug>`
- 命令失败时不得产生部分状态更新；特别是不得只写 marker 而未勾选 `[deploy]` 任务。

### 2.12 flow show 查看与解析 flow 编排
- `openlogos flow show` 是 flow 编排的只读查看入口；它**只读取与解析**，不写文件、不改派生状态，本切片也不接入 `status` / `next` 的派生（零行为变更）。
- **加载内置模板**：CLI 从**包内** `spec/flow/<lifecycle>.yaml` 读取内置 flow 模板。该路径复用 `cli/package.json` prepack 已打包的根 `spec/`，不新增打包资产，避免出现"内置模板双源头漂移"。加载器需兼容 dev / test / prepack 三种运行路径的解析。
- **解析 overlay**：若项目存在 `logos/flow/<lifecycle>.yaml`，按 `extends: builtin:<X>@vN` 引用基线，并以 `skip` / `add` / `modify` / `reorder` 四种操作做按 node id 的 strategic-merge：
  - `skip`：按 `target` node id 跳过节点。
  - `add`：在 `after` / `before` 指定 node id 处插入新节点。
  - `modify`：对 `target` node id 深合并 `set` 中给出的字段。
  - `reorder`：把 `target` node id 移动到 `after` / `before` 指定位置。
- **版本校验**：`extends` 的 `@vN` 表示内置模板内容版本。当 `@vN` 与内置模板不一致时，必须在 `warnings[]` 输出 `FLOW_VERSION_MISMATCH` 告警，提示 overlay 可能引用了已变更或删除的 node id；告警不阻断解析。
- **schema 校验**：加载与解析时执行基础 schema 校验（顶层结构、node 必填字段、overlay 操作合法性、target node id 存在性）。校验失败时输出 `FLOW_SCHEMA_INVALID` 并退出，不输出半成品 flow。
- **查看模式**：
  - 默认（无 `--resolved`）：展示内置 raw flow，不应用任何项目 overlay。
  - `--resolved`：展示基线 + overlay 合并后的生效流程。
  - `--lifecycle <initial|launched>`：指定查看的 flow；缺省时按当前项目状态推断。
- `--format json`：以通用 JSON envelope 输出机器可读结构，`command` 为 `"flow show"`；data schema 与错误 envelope 详见 `spec/cli-json-output.md`。
- 错误边界：内置模板或指定 lifecycle 缺失输出 `FLOW_NOT_FOUND`；项目未初始化输出 `PROJECT_NOT_INITIALIZED`。

### 2.13 watch 实时观测派生状态
- `openlogos watch` 是 `status` 的实时版：轮询 `collectStatusData`（与 `status` 同一派生数据源），把一次性快照变成实时流。它是**只读命令**，不写任何文件、不推进状态、不接入 `status` / `next` 的写副作用。
- **机器契约（须锁定）**：
  - **启动先输出一次初始快照**；之后**仅在派生状态变化时**输出。
  - **变化判定** = 相邻两次 `collectStatusData` 的 `data` 深比较（深相等则不输出）。
  - 每条输出携带递增**事件序号 `seq`** 与 `timestamp`；`data` 与 `openlogos status` 的 `data` 同构。
- **`--interval`**：轮询间隔，默认 2 秒（2000ms）。
- **`--module` 继承**：watch 继承 `--module` 过滤，派生与变化判定仅针对该模块，与 `openlogos status --module <id>` 的派生数据一致。
- **`--format`**：`--format json` 输出每条一行的 JSON 流（详见 `spec/cli-json-output.md` 的 watch 流契约）；文本模式按"初始快照 → 变化时重渲染"展示。
- **退出**：Ctrl-C / SIGINT 优雅退出，整个运行期间无任何写副作用。
- **错误边界**：项目未初始化输出 `PROJECT_NOT_INITIALIZED` 并以非零退出码退出，不进入轮询循环。

### 2.14 next --auto 自动跳过可跳人类确认点（skip-gate）
- `openlogos next --auto` 在 `next` 的派生基础上引入 **auto 模式**（skip-human-gate），走**最小 A 方案**：仅作用于 `next` 现有人类停顿点对应的 launched flow gate，引擎仍只派生"此 gate 可跳 + 当前 auto → 视为通过"，是否进入 auto 由宿主决定（A 架构）。
- **gate 范围（精确锁定，对照 `spec/flow/launched.yaml`）**：
  - **propose 出口 gate（`human`, `skippable:true`）→ 对应 `ready-to-merge`**：auto 下放行。
  - **deliver 入口 gate（`human`, `position:entry`, `skippable:false`）→ 对应 `ready-to-deploy`**：auto 下**仍卡住**，守住生产部署。
  - **`smoke` 节点无对应 gate**，`ready-to-smoke` 不在 `--auto` 范围（仅"运行 smoke"，非人类 gate）。
  - **initial 的 WHY/WHAT gate 是方法论建议门**，`next` 的默认 1:1 派生中并不在此强制停顿，故本轮**不接入** `--auto`（仅 schema 预留）。
- **`GATE_AUTO_PASSED` 审计语义（须锁定）**：
  - 文件 = 活跃提案目录下的 **JSONL 审计日志**（`logos/changes/<slug>/GATE_AUTO_PASSED`）。
  - 每次 auto 放行**总是追加一行** `{gate_id, proposal_step, timestamp}`（**不去重、不覆盖**，保留完整审计轨迹）。
  - **纯审计、不改变派生**：默认 `next`（无 `--auto`）与 `status` **忽略**该文件、输出 1:1 不变——绝不因 `GATE_AUTO_PASSED` 存在而让默认 `next` 自动越过 gate。
  - **幂等语义**：仅指 `--auto` 对默认 `next`/`status` 的**派生结论无影响、可安全重跑**，**并非**指审计日志去重（重复放行追加多行）。
- **默认 `next`（无 `--auto`）严格 1:1 不变**；`--auto` 是纯 opt-in 新能力。
- **不做（M2）**：overlay 驱动派生、loop 真迭代、`cmd:` 谓词。本切片不接入这些。

### 2.15 overlay 驱动 status/next/watch 派生

**目标**：派生引擎从「只读内置 flow」升级为「读 resolved flow（内置 + 项目 overlay 合并）」，
让 overlay 真正驱动 `status`/`next`/`watch`，而非仅 `flow show --resolved` 可见。

**边界（按 lifecycle）**：
- **initial**：overlay `skip`/`add`/`modify`/`reorder` 四操作**全部生效**（initial 派生由 flow 顺序构建 phase plan）。
- **launched**：仅 `add` / `modify` 生效；**builtin `skip` / `reorder` 不生效**——launched 派生由 marker/section 判定、
  **非 order 驱动**，本切片不重写状态机；派生入口检测到即报 `FLOW_SCHEMA_INVALID`（**fail loud，不静默**）。
  `modify` 对**经 flow 读取的 marker 名**生效；`section_complete:*` 的 tag 由代码侧固定读取，**本切片不承诺经 modify 覆盖**。

**overlay-added 节点的呈现**：`op:add` 节点无 phase key / proposal_step，经 node 级视图
（`modules[].overlay_nodes` / `modules[].current_node`）承载；参与 current 选取与 next 建议。
launched current 落 overlay-added 节点时 `proposal_step` = 前序最近 builtin step（无前序则 `writing`）。

**校验**：
- overlay-add 节点须带可求值的 `done_when`/`produces` 组合（谓词上下文见 flow-spec §9/§10；`marker:`/`section_complete:*` 仅 launched）；不满足 → `FLOW_SCHEMA_INVALID`。
- `op:modify` 禁止覆盖 `id`（结构性错误）。

**不变量**：**无 overlay 文件时 resolved==builtin，派生与机器输出逐字节不变**（golden 零漂移）；
node 级新字段仅在存在 overlay-added 节点 / 当前节点为 overlay-added 时输出。

**不在本规格**：`cmd:` 谓词、loop 真迭代、测试绿收敛（属后续切片）。

## 三、功能验收摘要
### S01
初始化后必须生成完整目录、配置和 AI 指令文件；其中 `logos/resources/reference/` 必须默认包含 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录。

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
adopt 后必须生成完整 `logos/` 目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md`、`CLAUDE.md`、`logos/spec/` 和所选 AI tools 的 Skills / 插件 / 命令资产；生成的模块标记为 `bootstrap: adopted` 与 `lifecycle: launched`；`logos/resources/reference/` 必须默认包含 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录；同时应为可识别测试栈写入 verify 预跑配置与推荐沙箱配置，无法推断时输出 TODO。`status` 必须将 Initial 文档基线显示为「已跳过（存量项目接入）」；`next` 必须输出补文档引导；`launch` 必须豁免 Initial 文档门禁。目录已存在 `logos/logos.config.json` 时必须拒绝重复执行并报错。历史 `bootstrap: skipped` 项目必须保持兼容。

### S21
`deploy-done` 必须让 `VERIFY_PASS → ready-to-deploy → ready-to-smoke/deploy-done` 的状态流转由 CLI 统一管理。`DEPLOY_DONE` 与 `[deploy]` 任务勾选必须保持同步；重新部署后必须清理旧 smoke 结论。

### S22
`flow show` 必须能从包内内置模板加载 raw flow，并在 `--resolved` 时正确应用项目 overlay 的 `skip` / `add` / `modify` / `reorder` 四种操作（按 node id strategic-merge）。`@vN` 版本不匹配必须告警而非静默；overlay schema 非法必须报错而非输出半成品。`--format json` 必须暴露 `lifecycle`、`resolved`、`flow`、`overlay_applied`、`builtin_version`、`warnings[]`。本能力**不得改变** `status` / `next` 既有行为。

### S23
`watch` 必须以 `status` 同一派生数据源（`collectStatusData`）实时输出：**启动先输出一次初始快照**，之后**仅在 `data` 深比较发生变化时**输出，每条携带 `seq` / `timestamp`；必须继承 `--module`；`--interval` 默认 2s；`--format json` 输出 JSON 流，文本模式变化时重渲染；Ctrl-C 优雅退出；全程只读无副作用；项目未初始化报 `PROJECT_NOT_INITIALIZED`。

### S24
`next --auto` 必须只对 launched 现有人类停顿点对应 gate 生效：`ready-to-merge`（`skippable:true`）放行并向 `GATE_AUTO_PASSED` JSONL 追加 `{gate_id, proposal_step, timestamp}`；`ready-to-deploy`（`skippable:false`）保持人类停顿；`ready-to-smoke` 不涉及。重复 `--auto` 必须追加多行（不去重）。**默认 `next`（无 `--auto`）与 `status` 必须忽略 `GATE_AUTO_PASSED`、输出严格 1:1 不变**，由 golden 锁定零漂移。

### S25
overlay 必须真正驱动派生：**initial** 四操作经 `status`/`next` 生效；**launched** 仅 `add`/`modify` 生效，builtin `skip`/`reorder` 派生入口 fail loud（`FLOW_SCHEMA_INVALID`）。overlay-added 节点经 `overlay_nodes`/`current_node` 承载；**无 overlay 时新字段省略、默认派生 golden 零漂移**。
