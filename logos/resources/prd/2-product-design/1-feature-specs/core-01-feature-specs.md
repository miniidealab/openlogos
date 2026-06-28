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
17. 收尾 M2 三个轻量预留项（`flow` 编排）：loop 退出 gate 的 `skippable` 可经 overlay 覆盖（高危 opt-in、auto 放行非收敛代码）、fan-out 聚合阈值 `coverage_threshold`、loop 内 fan-out 收敛语义定死为「整组收敛」。
18. 把 `cmd:` 谓词放开到 launched 的 `verify` / `deploy` / `smoke` 三个 gate（`flow` 编排）：overlay `modify` 可把这三个门禁节点的 `done_when`（verify/smoke 另含 `fail_when`）改为 `cmd:<command>`，接外部命令 / CI（如 `gh pr checks`、自定义部署校验脚本）；per-field 独立求值、cmd 字段 live 重评瞬态不写 marker，`status`/`watch` 停门前、`next` budget=1 求值续推；其它 builtin 节点改 cmd: 仍 fail loud。

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
- `openlogos next --auto` 在 `next` 的派生基础上引入 **auto 模式**（skip-human-gate）：仅作用于 `next` 现有人类停顿点对应的 launched flow gate，引擎仍只派生"此 gate 可跳 + 当前 auto → 视为通过"，是否进入 auto 由宿主决定（A 架构）。
- **gate 范围（对照 change-flow-redesign 后的 `spec/flow/launched.yaml`）**：
  - **plan 出口 gate（`human`, `skippable:true`）→ 对应 `ready-to-delta`（gate_id `plan-exit`）**：auto 下放行（仅审计、不推进状态）。
  - **spec 出口 gate（`human`, `skippable:true`）→ 对应 `ready-to-merge`（gate_id `spec-exit`，由原 propose 出口改）**：auto 下放行。
  - **deliver 入口 gate（`human`, `position:entry`, `skippable:true`）→ 对应 `ready-to-deploy`（gate_id `deliver-entry`）**：auto 下**放行**（部署目标可能是测试环境而非生产；放行依据 = 本次响应 `gate_auto_passed=true`，历史审计行不构成授权）。
  - **`gate:implement:loop-exhausted`（默认 `skippable:false`）**：达上限退出门，auto 下**仍卡住**（守住未收敛大功能；除非 overlay 覆盖 `exhausted_gate.skippable`）。
  - **`smoke` 节点无对应 gate**，`ready-to-smoke` 不在 `--auto` 范围。
- **`GATE_AUTO_PASSED` 审计语义**：
  - 文件 = 活跃提案目录下的 **JSONL 审计日志**（`logos/changes/<slug>/GATE_AUTO_PASSED`）。
  - 每次 auto 放行**总是追加一行** `{gate_id, proposal_step, timestamp}`（不去重、不覆盖）。
  - **纯审计、不改变派生**：默认 `next`（无 `--auto`）与 `status` **忽略**该文件；**历史审计行不构成对部署等动作的授权**，放行依据是本次 `--auto` 响应的 `gate_auto_passed=true`。
- **默认 `next`（无 `--auto`）不因 `--auto`/`GATE_AUTO_PASSED` 改变 gate 行为**；`--auto` 是纯 opt-in 能力。

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

### 2.16 cmd: 谓词（命令退出码作完成信号）

**目标**：点亮 flow `done_when`/`fail_when` 的 `cmd:<command>` 谓词，让 overlay-add 节点的完成判定由命令退出码决定（如 `npm test`、`gh pr checks`）。

**边界（决策 A/B）**：
- **仅 overlay-ADDED 节点**可用；`op:modify` 把 builtin 节点 done_when 改成 `cmd:` → `FLOW_SCHEMA_INVALID`（modify-cmd-on-builtin 留后续）。
- **禁止同节点 `done_when` 与 `fail_when` 均为 `cmd:`** → `FLOW_SCHEMA_INVALID`。

**执行**：
- **仅 `next` 执行命令**（shell 执行、cwd=项目根、两级可配超时 ≥1s、exit 0=done、非 0/超时=未 done、捕获 stdout/stderr 不外泄且容量受限、信任委托宿主）。
- `status` / `watch` **不执行**，cmd 节点态 = **`pending`**。
- **瞬态不持久化**：exit 0 仅本次 next 续推，不写 marker，下次 next 重新求值；**每次 next 至多执行 1 个 cmd（budget=1）**。
- **求值顺序**：先 `fail_when:cmd`（exit 0 → failed）再 `done_when:cmd`。

**错误分界**：命令不存在（shell exit 127/9009）= 非 0 → success envelope；shell 起不来 = `FLOW_CMD_SPAWN_FAILED` error envelope。

**不变量**：内置零 `cmd:`、无 cmd 项目派生逐字节不变（golden 零漂移）。**不在本规格**：loop 真迭代、测试绿收敛、modify-cmd-on-builtin。

### 2.17 implement loop 真迭代派生（A 被动派生）

**目标**：把 implement（code/verify）子流程的 `loop { until: tests_green, max_iters }` 从退化环（仅解析、不驱动）点亮为**真迭代派生**——OpenLogos 只派生「第几轮 / 是否收敛 / 是否升级 gate」，不自驱动跑测试（**A 被动派生**）。

**激活边界（仅 overlay）**：
- builtin `initial.yaml` / `launched.yaml` 的 implement subflow 保持 `loop: { until: tests_green, max_iters: 1 }`（**golden 零漂移**）。
- 仅当项目 overlay 通过 op `set-loop`（`subflow: implement` + `set: { max_iters: >1 }`）把 resolved loop 的 `max_iters` 改为大于 1 时，才进入真迭代派生；`set` 字段仅允许 `max_iters` / `until`（`until` 缺省沿用 `tests_green`）。
- **initial 多模块**为本切片已知不支持项：即便 overlay 写了 `max_iters>1` 也**不激活**（不写账本、不输出 `loop_state`、派生退化为旧行为）——verify 是项目级单次测试运行，无法把一次 run 归属到某模块的 loop。
- initial（单模块）与 launched 两条 implement 走**同一套** loop 派生引擎，仅在激活处生效。

**派生语义（读账本，A 被动）**：
- 迭代计数来源 = `openlogos verify` 在 loop 激活时追加的 `LOOP_ITERS` 账本（append-only JSONL，与 `GATE_AUTO_PASSED` 同理念）；未激活时 verify **不写账本**（零副作用）。
- `iteration` = `LOOP_ITERS`（按当前 module 过滤后）的行数（已完成的 verify 轮次）。
- `converged` = 最后一行 `result == "pass"`（tests_green）。
- `escalated` = `iteration >= max_iters && !converged`。
- status / watch / next 只**读账本展示或派生措辞**，**绝不执行测试**。

**implement 出环以 `converged` 为准（覆盖内节点 done_when）**：
- loop 激活时，implement subflow 的出环（done）以 `loop_state.converged` 为准，**覆盖其内节点（含 verify）各自的 `done_when`**。
- 尤其 initial 的 verify 节点 `done_when: file:logos/resources/verify/acceptance-report.md`，而 `openlogos verify` 无论 PASS / FAIL 都会写该报告——必须被 `converged` 覆盖，否则首次 FAIL 也会被误判为 done。
- **未收敛（`!converged`）时，status / watch / next 一律不得把当前推进到后续 subflow（deliver / deploy / launch / archive）**——当前节点钉在 implement 内的 verify。
- launched 的 verify `done_when: marker:VERIFY_PASS` 本就 FAIL-safe（仅 PASS 时点亮），与本规则一致。

**next 派生措辞（消费 `loop_state`）**：
- 未收敛 & `iteration < max_iters` → 「继续迭代（第 `iteration`/`max_iters` 轮未绿 → 让 working_agent 修复后重跑 `openlogos verify`）」。
- 未收敛 & `escalated`（达上限）→ 升级人类确认点：「已达迭代上限 `max_iters` 仍未绿 → 继续迭代 / 调整方案 / 放弃」。
- 收敛 → 出环，续推到下一节点（deliver / archive）。

**达上限升级 = loop 退出 human gate（本切片不可 overlay 覆盖）**：
- `escalated` 时派生为 implement subflow 的**退出 gate（human）**，`skippable` 本切片**固定 `false`**（`exhausted_gate.skippable` 的 overlay 覆盖留独立切片）。
- gate_id（确定性）= `gate:<subflow_id>:loop-exhausted`（如 `gate:implement:loop-exhausted`）。
- **next `--auto` 行为**：escalated 时输出 `gate_id` + `skippable: false`，**照常阻塞、不 auto-pass、不写 `GATE_AUTO_PASSED`**（与现有 deploy gate `skippable:false` 在 auto 下行为一致）。
- 「继续迭代」= 人类把 `max_iters` 调大（overlay `set-loop`）→ `iteration >= max_iters` 不再成立 → `escalated` 自动解除；或直接修到测试绿（`converged`）出环。**gate 本身不重置计数**。

**与既有能力正交**：
- 与 `cmd:` 谓词（S26）正交：loop 真迭代押**测试绿**（verify 的 PASS/FAIL），不依赖 `cmd:` 退出码。
- 与 `next --auto`（S24）正交：auto 仅对可跳 gate 放行，escalated 的 `skippable:false` gate 在 auto 下仍卡。
- 「是否达上限」**只由 `loop_state.escalated` + `next --auto` 的 `gate_id`/`skippable` 表达**，**不新增 `proposal_step` 枚举值**（launched loop 未收敛时仍为 `ready-to-verify` / `verify-failed` 等既有值），保持 JSON 兼容。

**`loop_state` 挂载（仅激活时输出，否则省略 → golden 零漂移）**：
- 有 `modules[]` 的项目挂 `modules[].loop_state`（按模块）；legacy 无 `modules[]` 才回退顶层 `loop_state`。
- `next` 同步挂 `next.modules[].loop_state`、顶层仅 legacy fallback；`watch.data`（与 status 同构）继承同样挂载规则。
- `loop_state` 字段：`subflow_id` / `until` / `max_iters` / `iteration` / `converged` / `escalated`。

**不变量**：无激活项目（含**所有** golden fixture）→ `status` / `next` / `watch` 输出**逐字节不变**。**不在本规格**：`exhausted_gate.skippable` 的 overlay 覆盖、auto 放行非收敛代码进入交付（语义危险，留独立切片）。

### 2.18 next 暴露 next_node 编排提示（A 被动派生）

**目标**：让 `openlogos next` 输出**最终建议处理的真实 flow 节点**的**编排提示对象 `next_node`**——把 `CLAUDE.md` 散文里的「该用哪个 skill / 哪个 agent / 要不要跑脚本」变成**机器可读的声明**，宿主据此真正照「乐谱」编排。仍是 **A 被动派生**：OpenLogos 只声明、不解释、不校验、不驱动；执行与授权由宿主权限模式决定。

**范围边界（仅 next）**：本能力**只在 `openlogos next` 暴露 `next_node`**；`status` / `watch` 本切片不动（守其 golden 零漂移，是否镜像留后续切片）。

**总定义（最终建议处理节点）**：`next_node` = 取自 **resolved flow（含 overlay）** 的「本次 `next` 响应**最终建议处理的真实 flow 节点**」的 hints。**默认 = 当前前沿节点**；R3（cmd 续推）/ R4（auto 放行）/ R5（命令级建议）/ R7（loop 阻塞）是对这个默认的**例外**（见下各条）。

**字段（全套编排提示）**：

```jsonc
"next_node": {
  "id": "code",
  "name": "代码实现",
  "subflow_id": "implement",
  "skill": "code-implementor",
  "working_agent": null,
  "review_agent": null,
  "pre_script": null,
  "post_script": null
}
```

- `id` / `name` / `subflow_id` 为 `string`；`skill` / `working_agent` / `review_agent` / `pre_script` / `post_script` 为 **`string | null`**——这 5 个字段**固定存在**、用 `null` 表示无绑定（如 verify / deploy / smoke 由 CLI 驱动、`skill` 为 `null`）。消费方**不得**把 `skill` 当作必有 `string`。
- 5 个 hint 字段均为**不透明标签**：OpenLogos 不解释、不校验、不驱动；如何映射到真实 agent、是否执行 script 由宿主权限模式决定（A 架构，与既有信任边界一致）。
- builtin 模板里 `working_agent` / `review_agent` / `pre_script` / `post_script` 多为 `null`（留用户 overlay 填），`skill` 多已填（prd→prd-writer、code→code-implementor…）。

**默认前沿节点解析（无 R3/R4/R5/R7 例外时，A 被动派生，复用既有映射）**：
1. **overlay-added 当前节点**（`current_node` 存在）→ 直接取该节点；
2. **launched builtin** → `STEP_TO_CURRENT_BUILTIN[proposal_step]` → builtin 节点 id；
3. **initial builtin** → `current_phase` → builtin 节点 id（用显式新增的 `PHASE_KEY_TO_NODE_ID` 映射，**不得**拿正向表 `NODE_TO_PHASE_KEY` 反查）；

再从 **resolved flow** 按 id 取该节点的完整 hints。故 overlay `modify code set:{review_agent: my-reviewer}` 会**如实反映**为 `next_node.review_agent = "my-reviewer"`（overlay 重绑 agent 是关键价值）。

**挂载位置（与 `current_node` / `loop_state` 同构）**：有 `modules[]` → `modules[].next_node`；legacy 无 modules → 顶层 `next_node`。

**【R3】与 cmd 瞬态求值的关系（指向本次响应「最终建议处理」的节点）**：`next` 会先执行当前 pending cmd 再续推，故 `next_node` **指向本次响应最终建议处理的节点**，**不是**刚被求值且已 done 的 cmd 节点：
- **cmd done（exit 0）→ 续推**：`next_node` = 续推后落到的节点（已 done 的 cmd 节点**不**作为 next_node）。
- **cmd 失败 / 超时**：节点仍未完成，`next_node` = 该 cmd 节点（指向需重跑的节点）。
- **budget=1 遇第二个 cmd**：`next_node` = 第二个 pending cmd 节点。

**【R4】与 `--auto` auto-pass 的关系**：为避免「机器字段 next_node 仍指放行前节点、action 却已 proceed」的不一致：
- **`gate_auto_passed === true`（gate 已自动放行）→ 省略 `next_node`**——放行后宿主应走 gate 的 command，下一个待处理节点要等放行落地后重新 `next` 派生。
- 非放行的 `--auto`（gate 不可跳、仍阻塞）与无 `--auto` 时，`next_node` 按当前前沿节点正常输出。

**【R7】与 loop 阻塞态的关系**：loop 未收敛时前沿钉在 verify，但 next 的 action 实际是「让 working_agent 修复后重跑 verify」（修代码，不是跑 verify）。为避免 action 与 next_node 不一致：
- **loop 阻塞、未达上限（继续迭代）**：`next_node` = **loop 工作节点**（含 overlay 重绑的 `skill` / `working_agent`）；`verify` 是 CLI 驱动的度量节点（`skill` 为 null），不作 next_node。工作节点取法：① 若当前有 overlay-added `current_node` 仍优先（按总定义解析）；② 否则取 resolved flow 中 **`id == "code"` 且未 `skipped`** 的节点（不依赖「第一个」，兼容 overlay `reorder`）；③ 若 `code` 缺失 / 被 overlay `skip` → **省略 `next_node`**（loop 仍有效，宿主读 `loop_state`）。该省略分支仅适用于合法 resolved flow（如 initial）；launched 对 builtin `code` 的 `skip` / `reorder` 在 S25 派生入口已 `FLOW_SCHEMA_INVALID`，根本走不到此处。
- **loop 达上限（`escalated` → `gate:implement:loop-exhausted` human gate）**：**省略 `next_node`**（同 R4，人类确认点、无可派发节点；宿主读 `loop_state.escalated`）。
- 非阻塞（`iteration=0` / 已收敛 / 无 loop）：`next_node` 按当前前沿节点正常输出（如 `verify`）。
- 与 `loop_state` 字段并存、互补：`loop_state` 给环状态，`next_node` 给「这一轮该派发哪个节点的 skill/agent」。

**【R5】缺省规则（仅指向真实 flow node，命令级建议一律省略）**：`next_node` **仅当当前建议指向一个真实 flow 节点时输出**；以下「命令级建议」（非某 flow node）一律**省略 `next_node`**：
- `all_done`（流程走完）；
- launched **无 active proposal** → 建议 `openlogos change <slug>`；
- adopted **补 baseline 文档** → 建议 `openlogos change add-baseline-docs`；
- `openlogos launch` 等其它命令级提示；
- `--auto` gate 已放行（见 R4）。

**与既有能力正交**：`next_node` 与 cmd（S26）/ loop（S27）/ `--auto`（S24）的现有字段**正交、互不覆盖机器字段**——cmd/loop/auto 各自的字段照常输出，`next_node` 只额外声明「该派发哪个节点的编排提示」。

**golden（有意打破零漂移、须复核 diff）**：本切片是 feature、为 next 新增输出字段，对有当前节点的项目（builtin 节点恒有 skill 等）新增 `next_node` → `next --json` 快照随之更新。必须在**干净基线**上重新 baseline `golden-baseline.test.ts` 并**逐项复核 snapshot diff**，确认**唯一变化是新增 `next_node`**，无其它字段漂移（`status` / `watch` / `flow show` 快照必须不变）。

**不变量**：无当前节点（命令级建议 / R4 放行 / R7 省略分支）时 `next_node` 省略。`status` / `watch` 输出**逐字节不变**（本切片不动它们）。

### 2.19 M2 预留收尾：loop 退出 gate 可跳 + fan-out 阈值 + loop 内整组收敛（A 被动派生）

**目标**：一次性收掉 `spec/flow-spec.md §13` 边界表 M2 列里三个轻量预留项——A·loop 达上限退出 gate 的 `skippable` 可经 overlay 覆盖、B·fan-out 聚合阈值、C·loop 内 fan-out 收敛语义定死。三项全部 **overlay / 字段 opt-in**，builtin 模板零变更，仍是 **A 被动派生**：OpenLogos 只声明、不解释、不自驱动；执行与授权由宿主权限模式决定。契约细节见 `spec/flow-spec.md`（§6/§7/§10.4/§12.2/§13）与 `spec/cli-json-output.md`（§3.9/§11.1/§9）。

#### 2.19.A loop 退出 gate 的 `skippable` 可 overlay 覆盖（高危 opt-in）

**边界**：S27 把 loop 达上限的退出 human gate（`gate:<subflow>:loop-exhausted`，如 `gate:implement:loop-exhausted`）的 `skippable` 固定为 `false`；本能力让它可经 overlay 覆盖。
- **overlay 入口**：`set-loop` 的 `set` 白名单由 `max_iters` / `until` 扩为 `max_iters` / `until` / `exhausted_gate`；`exhausted_gate` 子结构**仅允许 `{ skippable: boolean }`**。
- **派生语义（被动）**：`loop_state` **仅当 overlay 显式写了 `exhausted_gate` 时**才输出机器字段 **`exhausted_skippable`**（= resolved loop 的 `exhausted_gate.skippable`）；**未写则省略该字段、消费方按 `false` 处理**（既有 S27 激活-loop 的 `loop_state` JSON 不新增字段 → 真零漂移）；未激活 loop 时整个 `loop_state` 省略。
- **`next --auto` 行为**：
  - **`exhausted_skippable !== true`（默认）**：`escalated` 时输出 `gate_id` + `skippable:false`，`--auto` **照常阻塞、不 auto-pass、不写 `GATE_AUTO_PASSED`**（与 deliver 入口 gate `skippable:false` 在 auto 下一致，S27 不变）。
  - **`exhausted_skippable === true`（高危 opt-in）**：`escalated` 时 `--auto` **自动放行**该退出 gate——输出 `gate_id = gate:<subflow>:loop-exhausted`、`skippable:true`、`gate_auto_passed:true`，向活跃提案的 `GATE_AUTO_PASSED` JSONL **追加审计行**，action 转 proceed（**放行未收敛代码进入后续 subflow、无人值守**）。这是用户在 overlay 显式声明的「达上限即放行」语义，OpenLogos 据 overlay 被动派生、不自行决策授权。
- **安全红线**：`skippable:true` 是高危能力（自动放行未通过测试的代码）；默认 `false`，须用户显式在 overlay 写 `exhausted_gate.skippable: true` 才生效。OpenLogos 只声明「此 gate 可跳 + 当前 auto → 视为通过」，是否真正进入 auto、放行落地由宿主权限模式决定。
- **错误处理**：`set` 出现非白名单 key、或 `exhausted_gate` 内含 `skippable` 以外的 key、或 `skippable` 非布尔 → `FLOW_SCHEMA_INVALID`（fail loud，不静默保留、不出现在 resolved flow）。
- **不变量**：未写 `exhausted_gate`（含 builtin）→ `loop_state` 省略 `exhausted_skippable` 键、auto 下行为同 S27 → golden 零漂移（无论 loop 是否激活，输出逐字节不变）；`proposal_step` 枚举不新增（达上限仍只由 `loop_state.escalated` / `exhausted_skippable` + `--auto` 的 `gate_id`/`skippable`/`gate_auto_passed` 表达）。

#### 2.19.B fan-out 聚合阈值 `coverage_threshold`

**边界**：fan-out 节点新增可选字段 **`coverage_threshold`**（float，`0 < x <= 1`），**仅对 `done_when: all_present` 的 fan-out 节点合法**；**设在非 `all_present` 或无 `for_each`（非 fan-out）的节点 → `FLOW_SCHEMA_INVALID`（fail loud）**。
- **派生语义**：done 判定由「全部就绪」放宽为 `covered / total >= coverage_threshold` 即判该 fan-out 节点 **done**。
- **缺省等价 `all_present`**：不写 `coverage_threshold` = 阈值 `1.0`（要求 100% 覆盖），行为与现状 1:1。
- **`total == 0` 维持现状**：仍按 `all_present` 现状处理（视为未 done），阈值不改变此边界。
- **覆盖度对象不变**：`{ total, covered, missing }` 结构不变；机器输出仅在**显式设置 `coverage_threshold` 时**于 `flow show` 节点带该字段——**未设置则整键省略、绝不输出 `null`**（写 `null` 亦 normalize 为 absent），以保 `flow show` 零漂移；`status` / `watch` / `next` **不新增字段**，其 `scenario_coverage` 结构不变、`done` 在设置阈值时按阈值判定。
- **错误处理（fail loud）**：`coverage_threshold` 越界（≤0 或 >1）/ 非数 → `FLOW_SCHEMA_INVALID`；**设在非 `done_when: all_present` 或非 fan-out（无 `for_each`）节点 → 同样 `FLOW_SCHEMA_INVALID`**（不静默忽略、不告警）。
- **不变量**：builtin 模板不写 `coverage_threshold` → 行为与 `all_present` 1:1 → golden 零漂移。

#### 2.19.C loop 内 fan-out 收敛语义定死 = 整组收敛

**边界（决策定死）**：loop（implement 子流程）内若含 fan-out 节点，**采用「整组收敛」**——
- loop 的收敛裁判仍是**测试绿**（S27 `until: tests_green`）；fan-out 节点按各自 `all_present` / `coverage_threshold`（见 2.19.B）独立完成。
- **不引入 per-instance 迭代**：不为单实例各自计 `iteration`、不新增字段、不留悬空 schema。
- builtin loop 仅 `implement`（code/verify，无 fan-out）；fan-out-in-loop 只可能由用户 overlay 把 fan-out 节点加进 implement——此时同样整组收敛。
- **不变量**：无新增字段、无 builtin 变更 → golden 零漂移。该项关闭 §13「每实例迭代 vs 整组收敛」预留。

### 2.20 cmd: 放开到 verify/deploy/smoke gate（modify-cmd-on-builtin，A 被动派生）

**目标**：收掉 `spec/flow-spec.md §13` 边界表 M2 列**最后一项** `modify-cmd-on-builtin`——把 S26 仅限 overlay-add 节点的 `cmd:` 谓词放开到 **launched 的 `verify` / `deploy` / `smoke` 三个 gate 节点**，使这些门禁可接外部命令 / CI。语义采用 **per-field 独立求值**（cmd 字段 live 重评瞬态、非 cmd 字段照常，`fail_when` 优先于 `done_when` 不变）+ **不写 marker**，仍是 **A 被动派生**：OpenLogos 只声明门禁形态、不自驱动跑命令、不写状态，执行与授权由宿主权限模式决定。cmd 执行语义整体复用 S26（`spawn(shell)`、两级超时、64KiB drain、`exit 0`=谓词命中【按字段：`done_when` 命中为 done、`fail_when` 命中为 failed】、命令输出不进契约、信任边界委托宿主）。契约细节见 `spec/flow-spec.md`（§9.2 放开范围 / §10.3 modify 边界 + per-field 求值 / §12 launched 检测 cmd-aware + loop 正交 / §13 关闭最后一项）与 `spec/cli-json-output.md`（§3.8 cmd_gate / (g)(h) 求值结果 / next_node R3）。

#### 2.20.A 范围：仅 verify / deploy / smoke 三个 launched gate（精确白名单，决策 B）

**边界**：overlay `modify` 可把 **`verify`** / **`deploy`** / **`smoke`** 节点的 `done_when`（`verify` / `smoke` 另含 `fail_when`）改为 `cmd:<command>`；其它 builtin 节点经 modify 改 `done_when` / `fail_when` 到 `cmd:` → **`FLOW_SCHEMA_INVALID`（fail loud）**。
- **白名单为精确 `(节点, 字段)`**：
  - `verify.done_when` ✅ / `verify.fail_when` ✅
  - `smoke.done_when` ✅ / `smoke.fail_when` ✅
  - `deploy.done_when` ✅ / **`deploy.fail_when` ❌ → `FLOW_SCHEMA_INVALID`**（deploy builtin **无 `fail_when`**，本切片不为 deploy 引入 `fail_when:cmd`）。
  - 其它任意 `(节点, 字段)` 改 cmd: → `FLOW_SCHEMA_INVALID`。
- **其它 builtin 节点**（initial 全部；launched 的 `write-proposal` / `write-delta` / `generate-merge-prompt` / `apply-merge` / `code` / `archive`）改 cmd: 仍 fail loud——它们承载 OpenLogos 内部状态（proposal_package / section / marker），cmd: 无意义。
- **沿用 S26 决策 B**：同节点 `done_when` 与 `fail_when` **不得均为 cmd:** → `FLOW_SCHEMA_INVALID`（仅 verify / smoke 适用）；混合（一 cmd 一 marker）按字段独立求值（见 2.20.B）。
- **空命令非法**：`cmd:`（命令为空或纯空白）→ `FLOW_SCHEMA_INVALID`（沿用 S26 cmd 谓词校验）。

#### 2.20.B per-field 独立求值 + frontier 观察语义（live 重评、不写 marker）

**核心规则 = 「逐字段按谓词类型独立判定 + 非 cmd 字段先解析、cmd 字段只在前沿节点求值」**，`fail_when` 优先于 `done_when` 不变：
- **cmd: 字段（live 重评、瞬态、不持久化）**：`status` / `watch` **不执行 cmd**，该 cmd 字段视为 **unknown**；`next` 求值该字段 cmd（**budget=1，与 S26 overlay-add cmd 共享预算**，按 flow 顺序先到先求值），exit 0 命中、非 0 / 超时未命中（不崩溃）。
- **非 cmd: 字段（marker: 等，行为不变）**：仍按原谓词求值，`status` / `watch` / `next` 一致，与今天逐字节相同。
- **`next` 对 cmd 字段求值不写 marker**：cmd 字段每次 `next` 重评，`next` 不写 `VERIFY_PASS` / `DEPLOY_DONE` / `SMOKE_PASS` / `*_FAIL`（A 被动派生：`next` 不改项目状态）。现有 `openlogos verify` / `deploy-done` / `smoke` 命令的 marker 写入行为**完全不变**（照常可跑、照常写各自 marker，不禁止 / 不告警）；这些 marker 只在仍为 marker: 谓词的字段上参与判定。

**status / watch 节点态（不执行 cmd，按序短路）**：
1. 非 cmd `fail_when` 命中（如 `marker:VERIFY_FAIL` 存在）→ **failed**；
2. 否则 非 cmd `done_when` 命中（如 `marker:VERIFY_PASS` 存在）→ **done**；
3. 否则 该节点尚有**未求值的 cmd 字段** → **pending**（cmd 字段视为 unknown，**不**因此把已被非 cmd 字段解析的节点也判 pending）；
4. 否则 → active。

**next（执行 cmd，budget=1）= 仅对前沿（pending）节点求值其 cmd 字段**：上面第 1/2 步已解析为 done / failed 的节点**非前沿**，next **不**为其跑命令；前沿节点按 fail > done：`fail_when:cmd` 先（exit 0 → failed），未命中再 `done_when`（cmd exit 0 → done；marker → 按存在性）。

| 节点字段组合 | marker 状态 | status/watch | next 行为 |
|---|---|---|---|
| `done_when:cmd` + `fail_when:marker:VERIFY_FAIL` | VERIFY_FAIL 存在 | failed | —（已 failed，不跑 cmd）|
| 同上 | VERIFY_FAIL 不存在 | pending | 求值 `done_when:cmd` → exit 0 推进、非 0 / 超时停门前 |
| `done_when:marker:VERIFY_PASS` + `fail_when:cmd` | VERIFY_PASS 存在 | done | —（已 done、非前沿，**不**跑 `fail_when:cmd`）|
| 同上 | VERIFY_PASS 不存在 | pending | 求值 `fail_when:cmd` → exit 0 failed；未命中仍停门前（done_when marker 缺失）|
| `done_when:cmd`（deploy）| — | pending | 求值 `done_when:cmd` → exit 0 推进、非 0 / 超时停门前 |

> 含义：`done_when:marker + fail_when:cmd` 的 cmd 失败检查是「等待门禁期间的 fail-fast」（marker 未到时生效），marker 一到即 done、不再被 cmd 推翻——这是 frontier 模型的明确取舍。

**proposal_step「停门前」与「推进过门」**（live 重评的派生结果）：
- **cmd 未命中**（status/watch 恒未求值；next `done_when:cmd` 非 0 / 超时）→ proposal_step 停在该 gate **门前**：`verify` → `ready-to-verify`；`deploy` → `ready-to-deploy`；`smoke` → `ready-to-smoke`。
- **`next` 中 `done_when:cmd` exit 0** → 该 gate 本次 done → proposal_step **推进过门**（**仅本次 envelope 的瞬态合成态**，不写 marker，下一次 `status` 回到门前态——有意的 next/status 不一致）。
- **`next` 中 `fail_when:cmd` exit 0** → 该 gate 本次 failed → proposal_step = `verify-failed` / `smoke-failed`（瞬态失败态、非推进；deploy 无 `fail_when:cmd`）。

#### 2.20.C 检测 cmd-aware + 机器契约（cmd_gate）

**检测层改造（cmd-aware）**：
- `extractLaunchedMarkers`（`flow-derive.ts`）：`verify` / `deploy` / `smoke` 的 `done_when` / `fail_when` 若为 `cmd:` → **不抽 marker 名**，改标记为「cmd gate」（对 cmd: 不再抛错，返回 cmd 描述符）；marker: 字段路径**完全不变**。
- `detectProposalStepViaFlow`：新增**可选 cmd-eval 入参**（来自 `next` 对 builtin gate 的 cmd 求值结果）。无入参（`status` / `watch`）→ 对未被非 cmd 字段解析的前沿 cmd gate 视为 unknown（→ pending / 停门前），**非 cmd 字段已把节点解析为 done / failed 的照常输出、不停门前、不输出 pending**（见 2.20.B frontier）；有入参（`next`）→ 仅对前沿节点按 exit code 判 done / failed / 未过。
- **marker: 路径不变 → golden 零漂移**：无 overlay 项目 detection / status / next / watch 逐字节不变。

**机器契约**（详见 `spec/cli-json-output.md`）：
- **新增 JSON 字段 `cmd_gate`**（承载 builtin gate，与 `loop_state` 同构挂载）：当当前前沿是 verify / deploy / smoke 且其 cmd 字段仍 pending（status/watch 恒未求值；next 中 cmd 非 0/超时/未命中，**或因 budget=1 被前序 cmd 耗尽而未求值**）时，输出 `cmd_gate = { node_id, field, command, timeout_seconds }`。
  - **挂载位置**：有 `modules[]` → **`modules[].cmd_gate`**（与 `active_change` 平级、不挂其下，因 `next` 的 module item 里 `active_change` 是字符串而非对象）；legacy 无 `modules[]` → 回退顶层 `cmd_gate`；`next` 的 base data 同步挂 `next.modules[].cmd_gate`。消费方先读 `modules[].*`、缺则读顶层（与 `loop_state` / `current_node` 一致）。
  - `current_node` **维持只给 overlay-add**（§3.6 约束不变）；builtin cmd gate 由 **`cmd_gate` + `proposal_step`（停门前）** 共同表达。
  - **仅有 cmd gate（overlay modify）时出现、否则整字段省略 → golden 零漂移**。
- **next 的 cmd 执行结果复用 §3.8(c)**：`cmd_node_id` / `cmd_predicate_field` / `cmd_exit_code` / `cmd_timed_out` / `cmd_satisfied`——这些字段已按"被求值的 cmd 节点 id"定义、天然支持 builtin 节点 id（如 `cmd_node_id:"verify"`），无需新增；内部 `pending_cmd` 载荷扩展为可指向 builtin gate（供 next 执行器取命令，**仅内部、不在 JSON 契约**）。
- **next 的 `proposal_step` 是瞬态合成态（落契约）**：`next` 中 `done_when:cmd` exit 0 → 本次 envelope 的 `proposal_step` 显示推进过门，但不写 marker → 下一次 `status` 回到门前态；须在 `spec/cli-json-output.md` 明确「`next` envelope 门后态据 cmd 求值合成、`status` / `watch` 反映持久化前沿」。
- **`next_node` R3 扩展到 builtin cmd gate**：builtin cmd 命中续推 → `next_node` 指向续推后节点；cmd 失败 / 超时 → 指向该 builtin gate 节点。明确 `cmd_gate.node_id` / `cmd_satisfied` / `next_node` / `proposal_step` 的瞬态关系。

#### 2.20.D 与 loop（S27/S29）正交 + 其它 builtin fail loud

- **禁止「激活 loop（implement 的 `set-loop max_iters>1`）+ `verify` 的 `done_when` 或 `fail_when` 任一为 cmd:」并存** → **`FLOW_SCHEMA_INVALID`**（resolved 校验时即报，两者同 overlay 可静态检测）。**严格版**：不区分 done / fail 字段，verify 任一字段带 cmd 即与激活 loop 互斥（最安全、零边角）。原因：loop 出环只看 `LOOP_ITERS` 末轮 pass（账本由 `openlogos verify` 写），而 cmd gate 的 `next` 不写账本 / marker，激活 loop 时 cmd exit 0 也无法出环 → fail-loud 隔离。
- `deploy` / `smoke` 在 `deliver` 子流程、无 loop → 无此冲突；S30 不触碰 loop 收敛逻辑。
- **不变量**：builtin 三模板的 verify / deploy / smoke 仍是 marker: → 无 overlay 项目 detection / status / next / watch / flow show 逐字节零漂移；cmd-gate 仅经 overlay `modify` opt-in 激活。

#### 2.21 根目录 AI 指令文件合并策略

`AGENTS.md` 与 `CLAUDE.md` 是用户可自主维护的项目级 AI 指令文件。`init` / `init --ai-tool` / `adopt` / `sync` / `launch` 负责维护 OpenLogos 指令，但只能维护 OpenLogos 托管片段，不得整文件覆盖用户配置。

规则：
- OpenLogos 生成内容必须包裹在 `<!-- OPENLOGOS:BEGIN -->` 与 `<!-- OPENLOGOS:END -->` 之间。
- 已有完整 marker 时，仅替换 marker 内内容；marker 外内容原样保留。
- 无 marker 且文件为旧版纯 OpenLogos 模板时，可迁移为带 marker 的托管内容。
- 无 marker 且文件包含用户自定义内容时，保留原文并追加 OpenLogos 托管片段。
- marker 不完整时必须 fail loud，不得猜测边界覆盖。
- 写入前必须识别 `AGENTS.md` / `CLAUDE.md` 的大小写变体（如 `agents.md`、`claude.md`），复用既有真实路径合并，避免大小写不敏感文件系统上的误覆盖。
- 所有入口必须复用同一套 helper，保证 `init`、`adopt`、`sync`、`launch` 行为一致。

### 2.22 implement loop 默认激活切片循环（change-flow-redesign）

本节在 2.17（implement loop 真迭代派生）基础上扩展：**内置 launched `implement` 子流程默认激活切片循环**（`loop.until: code_slices_green`、`max_iters: 30`），不再依赖 overlay；2.17 中"builtin 保持 `max_iters:1`、`loop_state` 仅激活时输出、golden 零漂移"对 launched implement 的约束据此修订——launched 下 `loop_state` / `slice_state` 常驻输出，golden 基线主动重拍。其它 builtin（`initial.yaml` implement）仍 `max_iters:1`、initial 多模块不激活（沿用 2.17）。

- **切片清单**：`tasks.md` `[code]` section 每个未勾行 = 一个切片（零新文件）。
- **收敛**：`code_slices_green` = `section_complete:code ∧ tests_green`——`[code]` 全勾 且 末轮全量 verify 绿才出环（重新主张被 loop 覆盖的 `code` 节点 `done_when`）；**空 `[code]` 退化为 `tests_green`**。FAIL-safe 落每个判定入口。
- **派生**：`next` 选第一个未勾切片，`next_node` 钉 `code` 并带 `slice` 子提示（"建哪片"，非"修哪片"）；机器字段 `slice_state {total, done, current, remaining}`；`LOOP_ITERS` 可带 `slice` 维度。
- **无人值守**：`next --auto` 逐片推进；达 `max_iters` 未达成 → `gate:implement:loop-exhausted`（`skippable:false`），默认不自动放行未完成大功能。verify 始终跑全量回归，从模型层杜绝局部绿全局红。

### 2.23 AI 宿主 SessionStart guard 范围注入（Codex / openlogos-phase）

OpenLogos 在 AI 宿主的 SessionStart / phase context 注入中，必须把“active change proposal 的范围”解释为当前提案工作流阶段允许修改的文件集合，而不是 `proposal.md` 单个文件。

**事实源**：
- SessionStart 入口必须优先执行 `openlogos status --format json` 并读取结构化状态。
- 顶层 `data.active_change` 与 `data.proposal_step` 可直接使用；多模块场景下如顶层缺失或需要模块归属，必须读取 `data.modules[].active_change.slug` / `data.modules[].active_change.proposal_step`。
- 只有在 `status --format json` 不可用或缺少结构化字段时，才回退读取 `logos/.openlogos-guard` 中的 `activeChange`；回退文案不得收窄到 `proposal.md`，必须提示以 `openlogos status` / `openlogos next` 为准。

**阶段化允许范围**：
- `writing`：允许填写 `logos/changes/<slug>/proposal.md` 与 `logos/changes/<slug>/tasks.md`。
- `ready-to-delta`：提示方案待批准；在用户批准或 `next --auto` 消费 plan gate 后，进入 delta 产出。
- `delta-writing`：允许写入 `logos/changes/<slug>/deltas/**`，并同步更新 `logos/changes/<slug>/tasks.md` 的 `[delta]` 勾选状态；不得直接修改 `logos/resources/**` 或源码。
- `ready-to-merge`：不得继续改主规格或源码；提示用户明确授权 `openlogos merge <slug>`。
- `merge-generated`：允许按 `logos/changes/<slug>/MERGE_PROMPT.md` 合并主规格，并在完成后写入 `SPEC_MERGED`。
- `coding` / `ready-to-verify` / `verify-failed`：允许按 `[code]` section 修改源码、测试、OpenLogos reporter 与必要快照，并同步更新 `tasks.md`；`openlogos verify` 仍是人类确认点。
- `verify-passed` / `deploy-done` / `smoke-passed`：提示归档确认点，不自动执行 `openlogos archive <slug>`。
- `ready-to-deploy` / `ready-to-smoke`：提示部署或 smoke 的人类确认点，不自动执行部署、`openlogos smoke` 或归档。

**文案约束**：
- 禁止输出 `Only modify files within the scope of logos/changes/<slug>/proposal.md` 这类会把提案范围误读成单文件路径的句子。
- active guard 存在时，文案应使用“current active change proposal and current proposal step”描述边界，并列出当前阶段的具体允许路径。
- 无 guard 时仍保持强约束：launched 项目在修改源码前必须先运行 `openlogos change <slug>` 创建提案。

**兼容性**：
- `guard-check` 继续作为粗粒度安全门：launched 且无 guard 时阻断源码写入，有 guard 时放行，由 SessionStart 上下文和 OpenLogos 流程约束进一步限定阶段范围。
- 不改变 `openlogos status` / `openlogos next` 的既有 JSON 契约，只消费现有字段。

### 2.24 smoke runner 覆盖强制规则

#### 2.24.1 目标
当提案新增或修改 `logos/resources/test/smoke/*.md` 时，OpenLogos 必须把 smoke 用例从规格层推进到可执行验收层。新增 `SMOKE-*` ID 不能只存在于 Markdown 表格中；code 阶段必须同步交付 smoke runner、reporter 和 `smoke.command` / dispatcher 接入，确保部署后 `openlogos smoke` 不因 runner 缺失产生 uncovered。

#### 2.24.2 code 阶段规则
- change-writer 生成 `[code]` 切片时，若本提案新增或修改 smoke 用例，切片描述必须显式包含 smoke runner/reporter/dispatcher 交付物。
- test-writer 生成 smoke 用例时，必须同步在后续 code 任务中加入以下要求：
  - 实现或更新 smoke runner，例如 `scripts/smoke-<change>.sh`、`scripts/smoke-<change>.mjs` 或项目等效入口。
  - smoke runner 必须写入 `logos/resources/verify/smoke-results.jsonl`，每行一个 `{ id, status, ... }` JSONL 结果。
  - 每个新增 `SMOKE-*` 用例 ID 至少有一条真实执行结果；禁止伪造未执行的 PASS。
  - 若项目使用 `logos.config.json.smoke.command`，必须确保该 command 能执行新增 runner，或由统一 dispatcher 自动发现并执行。
- code-implementor 执行 `[code]` 切片前必须列出本片覆盖的 UT/ST/SMOKE 用例 ID；若存在新增 `SMOKE-*`，本片交付物必须包含 smoke runner/reporter。
- `[code]` 切片只有在业务代码、UT/ST、OpenLogos verify reporter、smoke runner/reporter/dispatcher 接入均完成后才能勾选。

#### 2.24.3 CLI 覆盖预检
CLI 应提供 smoke 覆盖预检能力，供 `openlogos verify`、code completion gate 或 RunLogos driver 在 code 阶段结束前调用：

1. 读取活跃提案的 delta 或已合并规格，找出本提案新增或修改的 `logos/resources/test/smoke/*.md`。
2. 提取新增或受影响的 `SMOKE-*` 用例 ID。
3. 读取 `logos/resources/verify/smoke-results.jsonl` 或 `logos.config.json.smoke.result_path` 指向的结果文件。
4. 检查 `logos.config.json.smoke.command` 是否存在，且能运行统一 dispatcher 或包含本提案 smoke runner。
5. 对新增 smoke 用例计算 defined/executed 覆盖关系；若存在未覆盖 ID，不允许 code 阶段被标记为完成。

#### 2.24.4 诊断码
smoke 覆盖预检和 `openlogos smoke --format json` 应为 RunLogos 暴露可机器识别诊断：

| 诊断码 | 触发条件 | 建议 |
|---|---|---|
| `smoke_runner_missing` | 新增 `SMOKE-*` 用例，但未发现对应 `scripts/smoke-*`、统一 dispatcher 注册或等效 runner | 在 `[code]` 切片中实现 runner 并接入 dispatcher |
| `smoke_reporter_missing` | runner 存在，但未写入 `smoke-results.jsonl` 或写入路径与 `smoke.result_path` 不一致 | 使用 OpenLogos smoke reporter 写入配置声明的 result path |
| `smoke_cases_uncovered` | `smoke-results.jsonl` 中缺少新增 `SMOKE-*` ID 的执行结果 | 运行或修复 smoke runner，直到所有新增 ID 有真实结果 |

#### 2.24.5 统一 smoke dispatcher
推荐为项目配置统一 smoke dispatcher，例如：

```json
{
  "smoke": {
    "command": "node scripts/run-smoke.js",
    "result_path": "logos/resources/verify/smoke-results.jsonl"
  }
}
```

dispatcher 至少应支持：
- 自动发现 `scripts/smoke-*.sh`、`scripts/smoke-*.mjs` 或项目声明的等效 runner。
- 在每次执行前按项目策略清空或隔离 `smoke-results.jsonl`，避免旧结果伪装覆盖。
- 将 runner exit code、失败用例和未覆盖用例传递给 `openlogos smoke` 的 JSON 输出。
- 可按活跃提案只运行相关 runner；若无法归属，则运行全部 canonical smoke runner。

## 三、功能验收摘要

### S01
初始化后必须生成完整目录、配置和 AI 指令文件；其中 `logos/resources/reference/` 必须默认包含 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录。若根目录已存在 `AGENTS.md` / `CLAUDE.md` 或大小写变体，OpenLogos 必须按 managed block 合并策略写入自身托管片段，保留用户自定义配置。

### S05
next 必须输出最可执行建议，而不是多条并列建议；存在活跃提案时，next 必须优先读取提案级部署决策。无需部署的提案在 verify PASS 后建议 archive；需要部署的提案在 verify PASS 后建议由用户明确授权部署；部署决策冲突时建议修正 proposal / tasks，不建议部署、smoke 或归档。


### S08
sync 必须同时处理 AI 资产和资源索引。刷新 `AGENTS.md` / `CLAUDE.md` 时只能替换 OpenLogos 托管片段，不得覆盖托管片段外用户内容。

### S09
change/merge/archive 必须构成闭环；提案填写阶段必须同步形成部署影响判断。`proposal.md` 声明无需部署时，`tasks.md` 不得出现 `[deploy]` section；声明需要部署时，必须有 `[deploy]` section，并在 delta 阶段补齐部署方案与 smoke 影响。AI 生成 proposal/tasks 后必须先做一致性自检，自检失败不得进入 delta-writing。

### S11
status 必须显示阶段进度、活跃变更、提案级部署决策、部署进度摘要和下一步建议。JSON 输出必须暴露部署决策字段、部署进度摘要和任务文档入口，供 RunLogos 面板判断是否展示部署按钮、smoke 按钮和归档按钮。`deployment_decision_conflict=true` 时必须展示为阻塞态。

### S13
verify 必须关联测试用例与运行结果，并负责在读取结果前触发配置的测试预跑命令。若配置了 `regression_command` 与 `incremental_command`，verify 必须按顺序执行并合并结果；若配置了 `verify.sandbox_mode`，预跑命令必须通过沙箱执行器运行，并在 JSON 输出中暴露 `sandbox` 诊断；若覆盖不足且无预跑配置，必须诊断可能只运行了局部测试，并给出配置建议。若活跃提案新增或修改 smoke 用例，verify 或 code completion gate 还必须执行 smoke 覆盖预检，提前发现 smoke runner/reporter 缺失，避免问题延迟到部署后暴露。


### S14
launch 必须检查验收、部署和 smoke 门禁。切换 launched 后重新生成 AI 指令与策略时，只能更新 OpenLogos 托管片段，必须保留用户已有根指令配置。

### S15
SQL 注释解析必须保留表与字段元数据。

### S16
JSON 输出必须与文本输出共享同一事实源。`openlogos verify --format json` 必须暴露预跑命令执行状态、阶段结果路径、合并策略、沙箱执行状态、覆盖不足诊断与修复建议，供 RunLogos 展示，不要求客户端复刻测试编排逻辑。`openlogos smoke --format json` 必须暴露 smoke 门禁指标与沙箱执行状态。

### S17
模块增删改必须同步 YAML 与引用。

### S18
resource_index 必须能反向索引当前真相源。

### S19
smoke 必须验证部署后环境的最小可用链路，但只在提案级 `smoke_required: true` 且部署完成后进入。部署进度摘要仅能来自 `tasks.md` 的 `[deploy]` section，不能把 `[code]` section 误当作部署进度。若配置了 `smoke.sandbox_mode` 且存在 `smoke.command`，CLI 必须通过沙箱执行器运行 smoke 命令，并在文本与 JSON 输出中暴露沙箱诊断。若 smoke 用例来自当前提案新增或修改，`openlogos smoke` 必须能区分 runner 缺失、reporter 缺失与用例 uncovered，并在 JSON 中暴露诊断码。


### S20
adopt 后必须生成完整 `logos/` 目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md`、`CLAUDE.md`、`logos/spec/` 和所选 AI tools 的 Skills / 插件 / 命令资产；生成的模块标记为 `bootstrap: adopted` 与 `lifecycle: launched`；`logos/resources/reference/` 必须默认包含 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录；同时应为可识别测试栈写入 verify 预跑配置与推荐沙箱配置，无法推断时输出 TODO。若存量项目已有 `AGENTS.md` / `CLAUDE.md` 或大小写变体，adopt 必须合并写入 OpenLogos 托管片段并保留用户自定义配置。`status` 必须将 Initial 文档基线显示为「已跳过（存量项目接入）」；`next` 必须输出补文档引导；`launch` 必须豁免 Initial 文档门禁。目录已存在 `logos/logos.config.json` 时必须拒绝重复执行并报错。历史 `bootstrap: skipped` 项目必须保持兼容。

### S21
`deploy-done` 必须让 `VERIFY_PASS → ready-to-deploy → ready-to-smoke/deploy-done` 的状态流转由 CLI 统一管理。`DEPLOY_DONE` 与 `[deploy]` 任务勾选必须保持同步；重新部署后必须清理旧 smoke 结论。

### S22
`flow show` 必须能从包内内置模板加载 raw flow，并在 `--resolved` 时正确应用项目 overlay 的 `skip` / `add` / `modify` / `reorder` 四种操作（按 node id strategic-merge）。`@vN` 版本不匹配必须告警而非静默；overlay schema 非法必须报错而非输出半成品。`--format json` 必须暴露 `lifecycle`、`resolved`、`flow`、`overlay_applied`、`builtin_version`、`warnings[]`。本能力**不得改变** `status` / `next` 既有行为。

### S23
`watch` 必须以 `status` 同一派生数据源（`collectStatusData`）实时输出：**启动先输出一次初始快照**，之后**仅在 `data` 深比较发生变化时**输出，每条携带 `seq` / `timestamp`；必须继承 `--module`；`--interval` 默认 2s；`--format json` 输出 JSON 流，文本模式变化时重渲染；Ctrl-C 优雅退出；全程只读无副作用；项目未初始化报 `PROJECT_NOT_INITIALIZED`。

### S24
`next --auto` 必须只对 launched 现有人类停顿点对应 gate 生效：可跳门 `ready-to-delta`（`plan-exit`）/ `ready-to-merge`（`spec-exit`）/ `ready-to-deploy`（`deliver-entry`）均 `skippable:true`、auto 下放行并向 `GATE_AUTO_PASSED` JSONL 追加 `{gate_id, proposal_step, timestamp}`；`gate:implement:loop-exhausted`（默认 `skippable:false`）保持人类停顿；`ready-to-smoke` 不涉及。plan 门放行仅审计、不推进状态。部署放行依据为本次响应 `gate_auto_passed=true`，历史审计行不构成授权。重复 `--auto` 必须追加多行（不去重）。**默认 `next`（无 `--auto`）与 `status` 必须忽略 `GATE_AUTO_PASSED`、绝不因其越过 gate**，由 golden 锁定 auto/gate 字段。

### S25
overlay 必须真正驱动派生：**initial** 四操作经 `status`/`next` 生效；**launched** 仅 `add`/`modify` 生效，builtin `skip`/`reorder` 派生入口 fail loud（`FLOW_SCHEMA_INVALID`）。overlay-added 节点经 `overlay_nodes`/`current_node` 承载；**无 overlay 时新字段省略、默认派生 golden 零漂移**。

### S26
`cmd:` 谓词必须仅作用于 overlay-add 节点（builtin modify-cmd → `FLOW_SCHEMA_INVALID`），禁同节点双 cmd；**仅 `next` 执行**（exit 0→done 瞬态续推、非 0/超时→active+结果字段、budget=1），`status`/`watch` 显示 `pending` 不执行；命令不存在=非 0、shell 起不来=`FLOW_CMD_SPAWN_FAILED`；无 cmd 项目 golden 零漂移。

### S27
implement loop 真迭代在 overlay `set-loop`（`max_iters>1`）**或 builtin launched 默认激活**（`implement` 默认 `max_iters:30` + `until:code_slices_green`，见 2.22）时生效；`initial.yaml` implement 仍 `max_iters:1`、initial 多模块不激活。激活时 `openlogos verify` 追加 `LOOP_ITERS` 账本，派生 `loop_state`（`iteration`/`converged`/`escalated`）；`iteration` 按当前 module 过滤计数、`converged` 按 `until` 判定（`tests_green` = 末轮 pass；`code_slices_green` = `section_complete:code ∧ tests_green`）、`escalated`=`iteration>=max_iters && !converged`。loop 激活时 implement 出环以 `converged` 为准、覆盖内节点 `done_when`；未收敛时 `status`/`next`/`watch` 一律不得推进到 deliver/deploy/launch/archive。next 在未收敛&未达上限时提示继续迭代，达上限 escalated 时升级 human gate（`gate_id=gate:implement:loop-exhausted`、`skippable` 默认 `false` 可 overlay 覆盖、不新增 `proposal_step`），收敛后出环续推。status / watch 只读展示 `loop_state`、不执行测试。

### S28
`openlogos next` 必须新增 `next_node` 编排提示对象，取自 **resolved flow（含 overlay）** 的「本次 next 响应**最终建议处理的真实 flow 节点**」的 hints（`id`/`name`/`subflow_id` + `skill`/`working_agent`/`review_agent`/`pre_script`/`post_script`，后 5 个固定存在、`string|null`、不透明标签、A 被动不执行）。默认 = 当前前沿节点（三路解析：overlay `current_node` / launched `STEP_TO_CURRENT_BUILTIN[step]` / initial `current_phase`→`PHASE_KEY_TO_NODE_ID`，禁用正向表反查）；overlay `modify` 重绑 agent 必须如实反映。挂载与 `current_node`/`loop_state` 同构（`modules[].next_node` / legacy 顶层）。例外：**R3** cmd done 续推→指向续推后节点（非已 done cmd）、cmd 失败/超时→指向 cmd 节点、budget=1→第二个 pending cmd；**R4** `gate_auto_passed===true`（--auto 放行）→省略；**R7** loop 阻塞未达上限→指向工作节点（overlay current_node 优先；否则 `id=code` 未 skipped，非 verify；`code` 缺失/被 skip→省略，仅合法 resolved flow；launched builtin skip 在 S25 已 FLOW_SCHEMA_INVALID）/ escalated 达上限→省略；**R5** 命令级建议（all_done / 无 active proposal→`change <slug>` / 补 baseline / launch）→省略。与 cmd（S26）/ loop（S27）/ `--auto`（S24）正交、互不覆盖机器字段。**仅 next 暴露，`status`/`watch` 不动**；本切片有意为 next 新增字段并重新 baseline `golden-baseline.test.ts`，复核 diff 仅 `next_node`。

### S29
M2 预留收尾必须一次性收掉 3 个轻量项，全部 overlay/字段 opt-in、builtin 模板零变更、golden 零漂移、A 被动派生不变：
- **A·loop 退出 gate 可跳**：`set-loop` 的 `set` 白名单必须扩为 `max_iters`/`until`/`exhausted_gate`，`exhausted_gate` 仅允许 `{skippable:boolean}`；派生 `loop_state.exhausted_skippable`（= resolved loop 的 `exhausted_gate.skippable`；**仅当 overlay 写了 `exhausted_gate` 时输出，否则省略、按 `false` 处理**）。`next --auto` 在 `escalated` 且 `exhausted_skippable===true` 时必须自动放行退出 gate（`gate_id=gate:<subflow>:loop-exhausted`、`skippable:true`、`gate_auto_passed:true`、追加 `GATE_AUTO_PASSED` 审计行、action 转 proceed，放行未收敛代码无人值守）；默认 `false` 时必须固定阻塞、不 auto-pass、不写审计（S27 不变）。高危 opt-in，须用户显式声明；OpenLogos 只声明，执行/授权由宿主权限模式决定。`set` 非白名单 key / `exhausted_gate` 非法 key / `skippable` 非布尔 → `FLOW_SCHEMA_INVALID`。`proposal_step` 枚举不新增。
- **B·fan-out 聚合阈值**：fan-out 节点必须支持可选字段 `coverage_threshold`（float `0<x<=1`，仅 `done_when: all_present` 节点有效，非法/越界/非数 → `FLOW_SCHEMA_INVALID`）；`covered/total >= coverage_threshold` 即判该 fan-out 节点 done；缺省（不写）等价 `all_present`（阈值 1.0、100% 覆盖）；`total==0` 维持现状（未 done）。覆盖度对象 `{total,covered,missing}` 不变；机器输出仅在显式设置时带该字段。
- **C·loop 内 fan-out 收敛语义定死 = 整组收敛**：loop（implement）内含 fan-out 时必须整组收敛——收敛裁判仍是测试绿（`until: tests_green`），fan-out 节点按各自 `all_present`/`coverage_threshold` 独立完成；不引入 per-instance 迭代、不新增字段、不留悬空 schema。关闭 §13「每实例迭代 vs 整组收敛」预留。
- 三项与 loop 真迭代（S27）、`next --auto`（S24）、fan-out 覆盖派生（S22/S25）正交、互不覆盖既有机器字段；builtin 不写任何新字段/overlay → `status`/`next`/`watch`/`flow show` golden 逐字节零漂移。

### S30
`cmd:` 谓词必须放开到 launched 的 `verify` / `deploy` / `smoke` 三个 gate，且仅这三个、按精确 `(节点, 字段)` 白名单：`verify.done_when` / `verify.fail_when` / `smoke.done_when` / `smoke.fail_when` / `deploy.done_when` 经 overlay `modify` 改 cmd: 合法；`deploy.fail_when`（deploy builtin 无 fail_when）及其它任意 builtin 节点 / 字段改 cmd: → `FLOW_SCHEMA_INVALID`；同节点双 cmd（沿用 S26 决策 B）、空命令均 `FLOW_SCHEMA_INVALID`。求值必须 **per-field 独立**（cmd 字段 live 重评、瞬态、不写 marker，非 cmd 字段照常，`fail_when` 优先 `done_when` 不变）+ **frontier**：`status` / `watch` 不执行 cmd，节点态按序短路（非 cmd `fail_when` 命中 → failed；否则非 cmd `done_when` 命中 → done；否则尚有未求值 cmd 字段 → pending；否则 active），cmd 未命中时 proposal_step 停门前（`ready-to-verify` / `ready-to-deploy` / `ready-to-smoke`）；`next` 仅对前沿节点求值 cmd（budget=1、与 S26 共享、`fail_when:cmd` 先于 `done_when:cmd`），`done_when:cmd` exit 0 → 本次推进过门（瞬态合成态、不写 marker、下次 status 回门前——有意的 next/status 不一致）、`fail_when:cmd` exit 0 → 瞬态 `verify-failed` / `smoke-failed`、非 0 / 超时 → 停门前。机器契约必须新增 `cmd_gate`（`{node_id, field, command, timeout_seconds}`，挂 `modules[].cmd_gate` 与 active_change 平级、legacy 回退顶层、仅 cmd gate 时出现）承载 builtin gate；next 的 cmd 求值结果复用 §3.8(c)（`cmd_node_id` 支持 builtin id）；`next_node` R3 扩到 builtin cmd gate（命中续推→续推后节点、失败/超时→该 gate 节点）。检测层 `extractLaunchedMarkers` / `detectProposalStepViaFlow` 必须 cmd-aware（cmd: 不抽 marker 名、next 可传 cmd-eval 入参），marker: 路径完全不变。必须与 loop 正交：激活 loop（`set-loop max_iters>1`）+ verify 任一字段为 cmd: 并存 → `FLOW_SCHEMA_INVALID`（fail loud）。cmd 执行语义整体复用 S26。builtin 三模板仍 marker: → 无 overlay 项目 detection / status / next / watch / flow show golden 逐字节零漂移。收掉 §13 M2 最后一项 modify-cmd-on-builtin。

### S31
launched `implement` 默认以切片循环推进：切片来自 `tasks.md` `[code]`，收敛 = 全部切片勾选 ∧ 末轮测试绿（`code_slices_green`），空 `[code]` 退化 `tests_green`。`next` 透出当前切片（`next_node.slice` + `slice_state`）；`verify` 全量回归并追加可带 `slice` 的 `LOOP_ITERS`；达 `max_iters:30` 未达成升级 `gate:implement:loop-exhausted`（`skippable:false`）。切片提示语义为"下一个未建切片"，回归修复目标由全量 verify 输出决定、归宿主判。initial 多模块不支持。若切片对应的规格变更新增或修改 smoke 用例，该切片必须同步完成 smoke runner/reporter/dispatcher 接入后才能勾选。
