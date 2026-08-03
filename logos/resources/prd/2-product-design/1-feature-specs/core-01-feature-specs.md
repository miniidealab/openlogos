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
19. 存量项目逆向建基线（`brownfield-adopter`）：`adopt` 后由 AI 会话/driver 派发逆向扫描，产出带 `## 逆向基线来源` provenance 章节的**种子基线**（现状快照、`verified: false`、不写 PRD）；覆盖率采 tombstone 分母法不虚增；存量文档 provenance 保守逐产物迁移不伪造/不降级。
20. feature 功能分组层（`add-feature-model`）：在 module 与 scenario 之间引入**可选的 feature 分组维度**（归属单一 module、聚合若干 scenario、可选链接 feature-specs 文档）；范式比照 scenario——`feature_counter` / `features[]` / `scenario.feature` 由 AI 维护，CLI 只读消费。CLI 提供 `openlogos feature list`（只读视图）、`openlogos feature-backfill`（复刻 `openlogos index` 范式生成 AI 回填 prompt），并在 `status`/`next` 增加 feature 分组桶（含"未分组"桶）；存量项目 A 惰性可选 + B 一键回填、升级零改动、混合态合法。

## 二、规格边界
### 2.1 CLI 交互
- 所有命令必须支持明确的成功与失败输出。
- `--format json` 结果必须稳定可解析。

### 2.2 AI 资产
- `AGENTS.md`、`CLAUDE.md`、Skills 和插件模板必须由 `sync`/`init`/`launch` 维护。
- OpenLogos 官方方法论技能与项目 / 产品 / 仓库专属技能必须使用可区分的命名空间或目录边界。
- OpenLogos 托管资产只能刷新 OpenLogos 自身拥有的内容；用户在托管范围外维护的项目技能、项目插件、项目指令和自定义 hook 不得被整合进 OpenLogos 官方命名空间。
- 兼容历史 `.codex-plugin` 与 `.agents/skills` 项目时，CLI 可以保留旧资产或迁移 OpenLogos 自有资产，但不得把未知项目技能重命名为 `openlogos:<skill>`。

### 2.2b Skill 命名空间与目录边界

#### Codex
- 推荐结构为 repo marketplace + 多插件目录：`.agents/plugins/marketplace.json` 注册 `openlogos` 插件，OpenLogos 方法论技能位于该插件自己的 `skills/` 内。
- `openlogos` 插件命名空间只承载 OpenLogos 官方方法论技能，例如 `openlogos:prd-writer`、`openlogos:change-writer`、`openlogos:code-implementor`。
- 项目专属技能必须使用项目自己的插件命名空间，例如 `adcn:release-guard`，或作为明确的 repo-scoped local skill 暴露；不得进入 OpenLogos 插件后形成 `openlogos:release-guard`。
- `openlogos init/sync --ai-tool codex` 必须能兼容历史 `.codex-plugin/` 与 `.agents/skills/` 布局：对 OpenLogos 自有技能可迁移或刷新，对未知项目技能只保留和诊断，不吸收、不改名。

#### Claude Code
- OpenLogos 官方 Claude 插件只承载 OpenLogos 方法论技能和 OpenLogos hook / guard。
- 项目专属技能推荐放在 `.claude/skills/<skill>/SKILL.md`，或打包成项目独立 Claude 插件。
- 项目独立 Claude 插件必须使用项目命名空间；不得把项目专属技能放入 OpenLogos 插件的 `plugin/skills` 后使其表现为 `/openlogos:*`。
- `CLAUDE.md` 的 Active Skills / 插件说明必须把 OpenLogos 方法论技能与项目专属技能分组描述，避免 AI 把项目规则误判为 OpenLogos 通用规则。

#### 生成与同步策略
- `init` 首次生成时创建 OpenLogos 官方资产边界，不覆盖已有项目专属技能。
- `sync` 刷新时只替换 OpenLogos managed block 和 OpenLogos 托管插件资产。
- `launch` 更新 launched 规则时不得改变项目专属技能所属命名空间。
- 对无法判断归属的 skill，CLI 必须保守处理为项目专属资产，并输出诊断或保留说明。

### 2.2c 兼容与迁移策略
- 已存在 `.codex-plugin/` 的项目继续可用；新版本同步时应优先生成 repo marketplace 结构，并保留历史入口作为兼容兜底或迁移来源。
- 已存在 `.agents/skills/<name>/SKILL.md` 的项目中，OpenLogos 只能刷新与官方技能名完全匹配且处于 OpenLogos 托管范围内的文件；其它 skill 视为项目资产。
- 生成的 `AGENTS.md` / `CLAUDE.md` 必须包含命名空间边界说明：OpenLogos 技能用于方法论流程，项目技能用于当前仓库规则，两者冲突时按更具体的项目规则处理，但不得改变 OpenLogos 流程门禁。
- 对多 AI 工具项目，Codex、Claude Code、OpenCode、Cursor 看到的 OpenLogos 方法论规则应一致，但各宿主的项目专属技能目录按宿主约定保留。

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

### 2.5a plan gate 待消费态与任务执行进度分层

`ready-to-delta` 是 proposal/tasks 已完成后的 plan 出口等待态，不是任务规划失败态。CLI、AI driver 与 RunLogos 面板必须把以下三类状态分开展示和消费：

1. **计划资料状态**：`proposal.md` 是否脱模板、`tasks.md` 是否脱模板、是否存在结构化 section。该状态决定 plan 是否 ready。
2. **plan gate 状态**：`proposal_step=ready-to-delta` 且 `PLAN_APPROVED` 不存在时，表示 plan gate 待人工批准或由 `next --auto` 消费。
3. **任务执行进度**：`tasks.md` 中 `[delta]` / `[deploy]` checkbox 的完成数，只表示后续执行进度；例如 `0/8` 是“8 个 delta 尚未写”，不是“任务规划 0% 完成”。

展示规则：

- 半自动模式下，`ready-to-delta` 应显示为“方案已完成，等待批准后写 delta”。
- 全自动模式下，driver 看到 `ready-to-delta` 后应调用或消费 `next --auto` 的 `plan-exit` 结果；若同次响应返回 `gate_auto_passed=true` 与 `next_node.id=="write-delta"`，应继续派发 `delta-writing`，不得停在 plan gate。
- 若 `proposal.md` 或 `tasks.md` 仍为模板，才可展示为“任务规划未完成”；该状态必须由模板识别字段或 `proposal_step=writing` 支撑，不得由 checkbox 统计推导。
- `tasks_execution_done < tasks_execution_total` 只影响 delta/deploy 执行清单，不得把 `plan_ready=true` 回退为失败。

### 2.6 bootstrap: adopted 行为约束

- `adopt` 命令生成的 `logos-project.yaml` 中，模块 `bootstrap` 字段值为 `adopted`，`lifecycle` 直接为 `launched`。
- `bootstrap: adopted` 表示模块通过存量项目接入进入 OpenLogos；它不是“首轮方法论闭环已完成”，而是“完整 OpenLogos 基础设施已初始化，Initial 文档基线被接入流程豁免，后续应通过逆向建基线（brownfield-adopter）建立现状基线”。
- `bootstrap: adopted` 模块不要求 Phase 1、Phase 2 和 Phase 3-0 文档存在；`status` 将其显示为「文档基线已跳过（存量项目接入）」，而非未完成。
- **adopt 确定性初始化时写入模块级枚举 `baseline_seed_state: required`**（唯一状态字段，非布尔），衔接逆向建基线（S33）：AI 会话/driver 检测该状态后派发 `brownfield-adopter` 产出种子基线（写 run staging），经 `openlogos baseline-seed commit` 由 CLI 依 manifest 计算 `baseline_seed_state`（未全 `partial` → 必需 kind 齐且全部合法 `seeded`）；CLI 本身不启动 AI、不产逆向内容、不声称基线已建立。
- `next` 在 `bootstrap: adopted` 且无活跃提案时按 `baseline_seed_state` 分档引导：`required` 引导逆向建立现状基线、`partial` 引导恢复/补齐扫描（此两档不建议直接开始逆向未验证区域相关的业务迭代）；**`seeded` 展示现状基线覆盖率（human-verified 分子 / tombstone 分母，分子恒 `0`、shape 不变）并正常引导 `openlogos change` 迭代**。三档均**不生成** JIT advisory / 确认现状 / `verified` 升级提示。
- `launch` 对 `bootstrap: adopted` 且 `lifecycle: launched` 的模块豁免 Initial 文档门禁检查。
- CLI 必须继续兼容历史 `bootstrap: skipped`，读取时按 adopted 接入模式处理；但 `adopt` 新写入的项目必须使用 `bootstrap: adopted`。
- **provenance 语义**：逆向产物的现状可信度由文档内具名章节 `## 逆向基线来源` 承载（`provenance` / `verified` / `confirmed_by` / `evidence` / `confirmed_at`），`logos-project.yaml` 为派生索引；缺该章节的既有文档判 `unknown`/`legacy-unclassified`，不无条件回填。本次以此表达「现状可信边界」，不新增独立的 `baseline_status` 第三状态维度。

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
- **白名单回收采用定点采集，不依赖快照 diff（fix-sandbox-node-modules-write-audit）**：copy-back 对白名单声明的每个路径在沙箱副本内定点检查（存在即拷回原 workspace），不再以「变更检测 diff ∩ 白名单」为回收前提。因此白名单路径即使位于任何审计豁免目录（如 `node_modules/**`）之下也照常回收——**白名单回收优先于豁免**，「豁免路径从不回收」仅指白名单之外的豁免路径；快照跳过与结果回收互不影响，不得出现结果文件静默丢失。
- 沙箱诊断必须进入 JSON 输出，供 RunLogos / CI 判断是否展示降级告警或失败原因。
- **symlink 隔离与运行期写保护不变量（fix-sandbox-node-modules-write-audit，先于依赖目录豁免生效）**：
  - **复制时拓扑（启动前）**：workspace 复制进沙箱时必须保持 symlink 的原始目标字面量（等价 `verbatimSymlinks` 语义），禁止把相对链接改写为指向原 workspace 的绝对路径（Node `cpSync` 默认行为会如此改写，实测穿透写入直接落在原 workspace）。复制完成后必须执行 realpath containment 校验：沙箱 workspace 内可达的每个 symlink，其解析目标必须仍位于沙箱 workspace 内。存在逃逸链接时按「无法隔离」处理：`always` 模式命令失败；`auto` 模式降级为非隔离执行并告警。逃逸链接**不得进入依赖目录豁免**。
  - **运行期不可逃逸（核心不变量）**：沙箱命令执行期间，子进程经沙箱内任何路径——**包括运行期新建或改写（retarget）的 symlink**——都不得写入原 workspace。启动前的一次性静态扫描不满足本不变量（命令可在通过校验后新建逃逸链接再写入，命令后快照又跳过 `node_modules`，事后检查无法挽回已发生的写入），必须由**在写入发生前阻断**的可执行机制保证：沙箱执行器须通过 OS 级文件系统写保护运行子进程——macOS 以 `sandbox-exec` 等机制拒绝对原 workspace 子树的 `file-write*`，Linux 以 mount namespace 将原 workspace 只读绑定（`bwrap` / `unshare` 等价机制），或其他能达成同等「文件系统层无法写入原 workspace」效果的策略。
  - **能力分层（复用「无法启用写入保护」既有语义）**：运行期写保护机制在当前平台/环境不可用时，视为「无法启用写入保护」——`always` 模式命令必须失败并说明原因与修复建议；`auto` 模式可继续沙箱复制执行，但必须输出告警（`sandbox.status=warn`）并披露残留风险（运行期动态 symlink 逃逸不可阻断）。写保护在位时，运行期经任意链接写入原 workspace 的尝试在文件系统层被拒绝，原 workspace 保持字节不变。
- **依赖目录豁免（fix-sandbox-node-modules-write-audit）**：
  - 写入审计的保护目标是原 workspace 的规格与源码资产；沙箱副本内命中依赖目录匹配规则的路径视为沙箱内一次性依赖目录，**不参与**非白名单写入判定。典型来源：pnpm 11 将 `verifyDepsBeforeRun` 默认值改为 `install`，`pnpm <script>` 在沙箱副本内检测到依赖状态不一致后自动 install/repair，重写 `node_modules/.bin/*`。
  - **匹配规则（精确路径段边界）**：对沙箱内相对路径先做规范化并统一分隔符（Windows `\` 归一为 `/`），仅当至少一个**完整路径段严格等于** `node_modules` 时才命中豁免（如 `node_modules/.bin/x`、`packages/a/node_modules/y`）；**禁止**子串、前缀或后缀匹配——`src/node_modules-cache/**`、`vendor/my-node_modules/**`、`node_modules.txt` 等近似名称一律不豁免，仍按非白名单写入判定。
  - 该豁免为沙箱执行器**内置固定规则**，不是项目可配置白名单。语义上区分两个概念：**白名单** = 允许写入并定点回收到 workspace（仍仅含配置声明的结果文件）；**豁免** = 不参与写入审计；白名单优先于豁免（见上「白名单回收定点采集」）。不得开放项目级通用 allow-path 配置。
  - 基线快照与命令后快照的文件遍历**直接跳过**命中豁免规则的目录，豁免由跳过天然达成，同时消除大型 `node_modules` 的两次全量遍历开销；白名单结果文件的回收不受跳过影响（定点采集）。
  - **可观测性（信息级通道）**：JSON 输出的 `sandbox` 对象新增**可选字段 `infos: string[]`**（additive、向后兼容，`diagnostics` 语义保持「问题诊断」不变）。启用隔离且 `sandbox_deny_workspace_write=true` 且沙箱副本内存在命中豁免规则的目录时，向 `sandbox.infos` 追加一条固定信息级说明（依赖目录为沙箱内一次性目录，不参与写入审计，不会回收到工作区）。该说明**不得**写入 `sandbox.diagnostics`，**不得**被 verify 复制进 `pre_run.diagnostics`；文本输出以信息标识（`ℹ️`）渲染且全程只展示一次，不得使用 `⚠️`；`sandbox.status` 不因 infos 置 `warn` / `fail`。`spec/cli-json-output.md` 同步补充 `sandbox.infos` 字段定义。
  - **语义边界不变**：豁免规则之外的非白名单写入判定一字不改——`always` 仍失败、`auto` 仍告警；`sandbox_mode=off` 与未配置项目的历史行为不变。

### 2.7A verify 结果账本一致性硬门

`openlogos verify` 在读取 `verify.result_path` 后，必须先把 JSONL 结果归一化为一个可信的逻辑结果集合，再计算覆盖率、通过率、AC 追溯和 Gate。

规则如下：

1. **解析与去重**
   - JSONL 每行必须是对象；
   - 同一 `id` 多次出现时，最后一条合法记录生效；
   - 非法行不得被静默计入通过或覆盖，必须进入一致性诊断。
2. **schema 校验**
   - `id` 必须存在并可对应到 `logos/resources/test/**/*.md` 中的自动化 `UT-*` / `ST-*` 用例；
   - `[manual]` 用例不接受自动化 JSONL 结果；
   - `status` 只能为 `pass` / `fail` / `skip`；
   - `fail` 结果必须携带 `error`。
3. **skip 语义**
   - `skip` 表示该用例在本轮测试中被显式处理，但因当前环境、外部依赖、部署目标或平台能力限制未实际执行；
   - `skip` 计入 `executed_count`、`skipped_count` 和覆盖率分子；
   - `skip` 不计入 `failed_count`，不得单独触发 Gate FAIL；
   - 报告必须继续展示 `skipped_count` 与 `skipped_cases`，避免环境性跳过被隐藏。
4. **统计不变量**
   - `executed_count` 等于去重后的合法自动化结果数；
   - `passed_count + failed_count + skipped_count == executed_count`；
   - `executed_count <= defined_count`；
   - `pass_rate_pct` 按 `(passed_count + skipped_count) / executed_count` 计算；
   - 若 `failed_count == 0`，则 `passed_count + skipped_count == executed_count` 且 `pass_rate_pct == 100`。
5. **Gate 判据**
   - 只有 schema 合法、统计自洽、无失败、无未覆盖、checklist 完成、AC 追溯完成时才能 PASS；
   - 合法 skip 不阻塞 PASS；
   - 任一一致性错误都必须使 `gate.result="FAIL"`；
   - `gate.reason` 应优先返回 `result_ledger_inconsistent`，并通过结构化字段列出具体原因。

该硬门用于阻断被历史行、未定义 ID、非法 status 或 reporter 污染撑大的结果账本。RunLogos / CI 可继续信任 `openlogos verify` 的 Gate 作为权威结论，不需要复制内部统计逻辑。

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
- **半 / 全自动两档语义**：
  - **半自动（无 `--auto`）= 手动 / 默认**：所有人类确认点（4 道可跳门 + `verify` / `smoke` / `archive` / `git push` 红线步骤）行为**完全不变**，逐一人工确认。
  - **全自动（`--auto`）= 无人值守 = standing run-scoped 授权**：用户选 `--auto` 即**一次性授权该提案全链路自动跑到底**——同时放行（a）4 道可跳 flow 门，与（b）代码**已绿之后**的 4 样「盖章 / 发布」红线步骤 `verify` / `smoke` / `archive` / `git push`。
- **skip-gate（可跳 flow 门）部分**：`openlogos next --auto` 在 `next` 的派生基础上引入 **auto 模式**（skip-human-gate）：仅作用于 `next` 现有人类停顿点对应的 launched flow gate，引擎仍只派生"此 gate 可跳 + 当前 auto → 视为通过"，是否进入 auto 由宿主决定（A 架构）。
- **gate 范围（对照 `spec/flow/launched.yaml`）**：
  - **plan 出口 gate（`human`, `skippable:true`）→ 对应 `ready-to-delta`（gate_id `plan-exit`）**：auto 下放行（仅审计、不推进状态）。
  - **spec 出口 gate（`human`, `skippable:true`）→ 对应 `ready-to-merge`（gate_id `spec-exit`，由原 propose 出口改）**：auto 下放行。
  - **slice 出口 gate（`human`, `skippable:true`）→ 对应 `ready-to-implement`（gate_id `slice-exit`，批准 merge 后由 slice-planner 划定的 `[code]` 切片）**：auto 下放行（仅审计、不推进状态——切片划定后仍需宿主逐片实现）。
  - **deliver 入口 gate（`human`, `position:entry`, `skippable:true`）→ 对应 `ready-to-deploy`（gate_id `deliver-entry`）**：auto 下**放行**（部署目标可能是测试环境而非生产；放行依据 = 本次响应 `gate_auto_passed=true`，历史审计行不构成授权）。
  - **`gate:implement:loop-exhausted`（默认 `skippable:false`）**：达上限退出门，auto 下**仍卡住**（守住未收敛大功能；除非 overlay 覆盖 `exhausted_gate.skippable`）。**这是任何模式（含 `--auto`）都不放行的硬红线**——绝不自动发布未通过测试的代码。
  - **`smoke` 节点无对应 gate**：`ready-to-smoke` 不在 skip-gate 机制内，但在全自动 standing 授权的盖章/发布放行范围内（见下「绿后盖章/发布红线」）。
- **绿后盖章/发布红线（`verify` / `smoke` / `archive` / `git push`）的 `--auto` 自动执行**：这 4 样**均无对应可跳 flow gate**、不经 `gate_id` 走 skip-gate，而是由全自动 `--auto` 的 **standing run-scoped 授权**放行。前提**均为代码已通过 `verify`**（全自动发布的是已验证成果）。
  - `verify` / `smoke` / `archive`：由 AI 宿主在 `--auto` 授权下亲自调用对应 `openlogos` 命令，约束它们的是「生成进 AGENTS.md / CLAUDE.md 的指令文本」——指令文本新增 `--auto` 例外授权后，宿主知道自己处于全自动即自行运行。
  - `git push`：**无需任何 marker / guard 改动**——`plugin/bin/guard-check` 的安全白名单本就含 `^git push`，PreToolUse guard 从不拦截 `git push`。故全自动下 `git push` 是否执行**纯由指令文本承载**：与 `verify` / `smoke` / `archive` 同理，指令文本新增 `--auto` 例外授权后宿主自行执行；半自动下指令文本不含该例外、宿主须等人类明确授权（guard 在两档下行为相同、不参与该约束）。
- **放行边界明确排除 `loop-exhausted`**：全自动放行**只**覆盖代码已绿之后的 `verify` / `smoke` / `archive` / `git push`；**不**覆盖 `gate:implement:loop-exhausted`（未收敛 / 未绿代码）。后者现有默认 `skippable:false` + overlay 单点 opt-in 逻辑**完整保留、一字不改**，是「全自动只发布已验证成果」的前提守门人。
- **`GATE_AUTO_PASSED` 审计语义（护栏）**：
  - 文件 = 活跃提案目录下的 **JSONL 审计日志**（`logos/changes/<slug>/GATE_AUTO_PASSED`）。
  - 每次 auto 放行**总是追加一行** `{gate_id, proposal_step, timestamp}`（不去重、不覆盖）。
  - **纯审计、不改变派生**：默认 `next`（无 `--auto`）与 `status` **忽略**该文件；**历史审计行不构成对部署等动作的授权**，放行依据是本次 `--auto` 响应的 `gate_auto_passed=true`。
- **`git push` 不依赖任何 marker（护栏）**：guard 安全白名单本就放行 `git push`，本能力**不引入** `AUTO_MODE` 之类运行域 marker、不改 guard；`git push` 的两档差异完全由指令文本承载。其它写入操作（`>` / `sed -i` / `mv` / `rm` 等）仍按 PreToolUse guard 原规则与文件路径白名单判定，不受 `--auto` 影响。
- **R2 安全闸不变**：仍卡在未完成 overlay 节点时不放行——本能力不触碰该不变量。
- **默认 `next`（无 `--auto`）不因 `--auto`/`GATE_AUTO_PASSED` 改变任何 gate 或红线行为**；`--auto` 是纯 opt-in 能力。

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
  "post_script": null,
  "dispatch": {
    "idempotent": true,
    "timeout_seconds": 3600,
    "artifacts_hint": ["logos/resources/verify/test-results.jsonl"]
  }
}
```

- `id` / `name` / `subflow_id` 为 `string`；`skill` / `working_agent` / `review_agent` / `pre_script` / `post_script` 为 **`string | null`**——这 5 个字段**固定存在**、用 `null` 表示无绑定（如 verify / deploy / smoke 由 CLI 驱动、`skill` 为 `null`）。消费方**不得**把 `skill` 当作必有 `string`。
- 5 个 hint 字段均为**不透明标签**：OpenLogos 不解释、不校验、不驱动；如何映射到真实 agent、是否执行 script 由宿主权限模式决定（A 架构，与既有信任边界一致）。
- builtin 模板里 `working_agent` / `review_agent` / `pre_script` / `post_script` 多为 `null`（留用户 overlay 填），`skill` 多已填（prd→prd-writer、code→code-implementor…）。
- **派发契约 `dispatch` / `requires_reviewed`（contract-self-description 新增）**：每个 `next_node` **恒带完整** `dispatch: {"idempotent": bool, "timeout_seconds": int, "artifacts_hint": string[]}`；节点可另声明 `requires_reviewed: string[]`（driver 的 priorReviewNode 本地映射表退化为消费该声明）。权威数据源 = flow 节点定义（内置模板逐节点人工声明，**不从 produces/done_when 推导**）；显式声明则以声明为准；resolved flow 派生把节点元数据透传进 `next_node`——`next_node.dispatch` 恒为完整对象，无二义分支。
- **overlay-add 未声明 `dispatch` 时的保守默认**：`{idempotent:false, timeout_seconds: defaults.dispatch.timeout_seconds, artifacts_hint: []}`；`artifacts_hint: []` ＝「产物未知」契约语义：消费方不得据此判死，只能升级观察。flow 文件顶层新增 `defaults: {dispatch: {timeout_seconds: 900}}`（唯一默认值源（fallback）；overlay 可覆盖；resolved 物化进每节点，输出层不再有第二处默认）。flow 文件 schema `version: 1` 保持不变（字段为向后兼容扩展）。
- **内置节点声明基准**：内容产出/评审节点（write-proposal、write-tasks、write-delta、plan-slices、review 类、code）idempotent:true；一次性落盘/执行节点（apply-merge、deploy、archive 类）idempotent:false；verify/smoke 命令节点 idempotent:true。timeout_seconds：默认 900，code/implement 类 3600，deploy 类 1800。artifacts_hint 写该节点的具体产物提示（如 `["proposal.md"]`、`["logos/resources/**","SPEC_MERGED"]`）。apply-merge 声明 `requires_reviewed: ["proposal","delta"]`。

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

**golden（有意打破零漂移、须复核 diff）**：本切片是 feature、为 next 新增输出字段，对有当前节点的项目（builtin 节点恒有 skill 等）新增 `next_node` → `next --json` 快照随之更新。必须在**干净基线**上重新 baseline `golden-baseline.test.ts` 并**逐项复核 snapshot diff**，确认**唯一变化是新增 `next_node`**，无其它字段漂移（`status` / `watch` / `flow show` 快照必须不变）。contract-self-description 在此基础上**主动破例**，golden 复核改按**提案级差异白名单**（不再沿用本切片历史的局部零漂移锚）：全部输出允许 `contract`；活跃提案允许 `active_change.step_meta`/`facts`；launched 活跃提案用例 5/6/8/9 **允许且要求** pre-implement `loop_state` 缺席（C2 收紧的必然差异）；`next_node` 允许新增 `dispatch`/`requires_reviewed`（破 R8 八字段锚，next golden 用例 2/6 重拍）；`flow show` 允许新增顶层 `defaults` 与逐节点 `dispatch`/`requires_reviewed`。白名单之外才要求逐字节不漂移。

**不变量**：无当前节点（命令级建议 / R4 放行 / R7 省略分支）时 `next_node` 省略。`status` / `watch` 输出在**本切片（S28）范围内**不因 `next_node` 新增而变；contract-self-description 起按上方提案级差异白名单复核（`contract`/`step_meta`/`facts`/`loop_state` 缺席属声明内差异，不算漂移）。

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

本节在 2.17（implement loop 真迭代派生）基础上扩展：**内置 launched `implement` 子流程默认激活切片循环**（`loop.until: code_slices_green`、`max_iters: 30`），不再依赖 overlay；2.17 中"builtin 保持 `max_iters:1`、`loop_state` 仅激活时输出、golden 零漂移"对 launched implement 的约束据此修订——launched 下 `slice_state` 常驻输出、golden 基线主动重拍；**`loop_state` 不再常驻输出**，其挂出时机由 contract-self-description 主动破例收紧（见下「`loop_state` 挂出时机」）。其它 builtin（`initial.yaml` implement）仍 `max_iters:1`、initial 多模块不激活（沿用 2.17）。

- **切片清单来源**：`tasks.md` 的 `[code]` section **由 merge 后的 `slice` 子流程（`slice-planner`，见 2.25）写定**，不再由 plan 段 `change-writer` 在 merge 前产出。implement loop 只**消费** `[code]`、不重新分批；循环与收敛逻辑不变。
- **切片清单**：`tasks.md` `[code]` section 的顶层切片 checkbox = 顶层切片。缩进 checkbox = 所属父切片内部子任务；它不是新的顶层切片，不参与 `slice_state.total` 的计数。
- **完成判定**：父切片完成必须同时满足父切片 checkbox 已勾选，且该父切片下所有缩进子任务 checkbox 均已勾选。父切片已勾但子任务未全勾时，该父切片仍视为未完成。
- **收敛**：`code_slices_green` = `section_complete:code ∧ tests_green`——`[code]` 顶层切片与全部缩进子任务 checkbox 全勾 且 末轮全量 verify 绿才出环（重新主张被 loop 覆盖的 `code` 节点 `done_when`）；**空 `[code]` 退化为 `tests_green`**。FAIL-safe 落每个判定入口。
- **派生**：`next` 选第一个未完成切片，`next_node` 钉 `code` 并带 `slice` 子提示（"建哪片"，非"修哪片"）；机器字段 `slice_state {total, done, current, remaining}`。若当前切片存在缩进子任务 checkbox，额外输出 `slice_state.current_children`、`slice_state.current_unchecked_children`，并在 `next_node.slice_children` 中同步暴露，供宿主提示词携带当前切片内部子任务清单。`LOOP_ITERS` 可带 `slice` 维度。
- **兼容性**：无缩进子任务 checkbox 的既有 `[code]` 切片行为不变；缩进普通 bullet 仍只是说明文字，不进入子任务完成判定；initial 多模块仍不输出 `slice_state`。
- **边界**：OpenLogos 只派生状态与机器字段，不自动勾选父切片或子任务 checkbox，不替代宿主/Agent 的代码实现、测试执行和任务勾选动作。
- **无人值守**：`next --auto` 逐片推进；达 `max_iters` 未达成 → `gate:implement:loop-exhausted`（`skippable:false`），默认不自动放行未完成大功能。verify 始终跑全量回归，从模型层杜绝局部绿全局红。
- **`loop_state` 挂出时机（contract-self-description 收紧，主动破例打破「launched 下 `loop_state` 常驻输出」不变量）**：挂出 **iff** `code_required ∧ spec_complete ∧ slices_planned ∧ slices_approved`（与 facts 同一份计算）；否则省略字段。`ready-to-implement`（切片已规划、待 slice-exit 批准）**不挂**；docs-only（code_required=false）**永不挂**。缺席态语义：`loop_state` 缺席 = implement 未进入，消费方走 next 驱动普通推进，不得进入 loop 分支——现役 driver 对缺席态本就走普通推进，只改 CLI 即消灭 loop 劫持整类假死。spec 阶段/切片未规划的 launched 活跃提案 golden 快照（用例 5/6/8/9）随之重拍。
- **`loop_state.activated_at`（审计）**：新增 `activated_at`（ISO 8601），读自结构化 SLICES_APPROVED；旧空 marker → 省略该字段。SLICES_APPROVED marker 由「空文件」升级为结构化内容：消费 slice-exit 时原子写入一次，JSON 单行：`{"schema":"openlogos/slices-approved@1","approved_at":"<ISO 8601>"}`；已存在不重写（重复 `next --auto` 不刷新）；兼容读旧空文件（视为已批准、无时间戳）。同一磁盘状态永远派生同一 JSON，不破坏 A 被动派生确定性。
- **`slice_state` 常驻口径不变**（激活判据与 loop_state 分别写明）：`slice_state` 是切片规划进度的展示面、不触发 driver loop 分支，维持现状不收紧。

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

### 2.25 slice 子流程：merge 后独立切片规划环节（split-slice-planner-stage）

把"划分 `[code]` 切片"从 `change-writer` 的 plan 段（merge 前）剥离为**独立 flow 子流程 `slice` + 独立 skill `slice-planner`**，并挪到 **spec-complete 之后、implement 之前**。`change-writer` 的 plan 段（`write-tasks`）从此只产 `[delta]`/`[deploy]`、不再决定 `[code]` 切片。

- **flow 子流程 `slice`（`when: code_required`）**：置于 `merge` 与 `implement` 之间；节点 `plan-slices`（`skill: slice-planner`，`produces: tasks.md` 的 `[code]`，`done_when: tasks_code_filled`）；出口为人类门 `slice-exit`（`type: human`, `skippable: true`）。纯文档提案（无 `[code]` 产出，`when: code_required` 为假）整段跳过。
- **spec-complete 前置**：所有代码提案进入 `plan-slices` 前都必须完成 spec-complete。含 `[delta]` 提案以真实合并后的 `SPEC_MERGED` / `MERGED` 为信号；无 `[delta]` 的纯代码提案必须通过 no-delta `openlogos merge <slug>` 写入 `SPEC_MERGED`，不得仅凭 `delta_required==false` 直接空过到切片规划。
- **no-delta `SPEC_MERGED` 内容**：无 delta 时写入 JSON 或等价可解析内容，至少包含 `type:"no_delta_spec_complete"`、`reason`、`completed_at`。已有空 marker 仍可兼容读取，但新写入必须带审计内容。
- **驻留态 `spec-complete-required`**：代码提案缺少 spec-complete marker 时，`next/status` 必须停在 `spec-complete-required` 或输出等价诊断 `reason:"no_delta_spec_marker_missing"`，提示执行 no-delta merge，不得返回 `next_node.id=="plan-slices"`。
- **测试 ID 门禁 `test-id-required`**：spec-complete 已完成但无法解析本提案所需真实 `UT-*` / `ST-*` / `SMOKE-*` ID 时，`next/status` 必须停在 `test-id-required` 或输出等价诊断 `reason:"code_change_requires_real_test_ids"`，不得派发 `slice-planner`。
- **驻留态 `ready-to-implement`（label「切片待批准」）**：spec-complete 完成且测试 ID 已稳定后、`[code]` 切片循环开始前，提案停在 `ready-to-implement`，由 `slice-planner` 在 `plan-slices` 节点产出 `[code]`，切片写定后停在 `slice-exit` 门待批准；批准后进入 `coding`。
- **唯一事实源**：切几片、每片做什么，**只在 `slice-planner` 用六维打分 + 删后续证伪门决定一次**；下游 `code-implementor` 只逐片消费、不再重复打分、不再自行分批。
- **输入**：已完成 spec-complete 的 `proposal.md` 变更范围 + 已落入 `logos/resources/prd/` 的架构/场景/功能规格 + 已合并的 `logos/resources/test/*-test-cases.md` 的**真实** `UT-Sxx-..`/`ST-Sxx-..`/`SMOKE-*` ID。**禁止用占位 ID 切片**。

### 切片算法

1. **六维打分（是否大任务）**：按影响范围 / 行为复杂度 / 契约变化 / 测试规模 / 风险等级 / 不确定性六维打分；0-7 分 = 非大任务 → 单切片；≥8 分 = 大任务 → 进入垂直拆分尝试。
2. **垂直/横向判别器（选切片轴）**：给每片起名后看名字落在哪类。片名是层 / 文件 / 工种时必须重切；片名是端到端能力线 / 场景 / 独立子模块闭环时才合格。
3. **删后续证伪门**：拟好 N 片后逐片自问：(a) 删掉后续切片只做当前片，全量 `openlogos verify` 能绿吗？(b) 当前片是否端到端可观察？任一为否即向前合并。逐片结论必须写入 `[code]` 开头。

**唯一交付物**：`tasks.md` 的 `## [code]` section。它包含删后续结论、真实测试 ID 标注、业务代码 + 测试 + reporter + 必要 fixture/golden 的闭环要求。`slice-planner` 不产 `proposal.md`、不产 `[delta]`、不写业务代码。

### 2.26 GUI 项目提案阶段前置 UI/UX 原型确认（proposal-ui-ux-first）

**目标**：对已 `launched` 的 **GUI 产品项目**（网站 / 桌面应用 / 移动 App），把 UI/UX 确认**前移到「批准提案」门**——在提案阶段就产出界面原型，使用户在批准提案时（**面板已渲染原型的前提下**）连界面一起确认，避免「批准后自动实现才发现界面不对」的高成本返工。**复用现有 `plan-exit`（批准方案）门，不新增门态、不新增确认标记、不新增 `ui/` 目录。** 非 GUI 项目（纯 CLI / API / Skills）整个特性不启用、流程零改动。

本节只定义 openlogos 侧的**功能规格边界（契约）**；driver 侧的 producer dispatch / 面板原型渲染 / provenance 写入归 runlogos 关联 change `ui-ux-first-panel`，本节不含其实现。

#### 2.26.1 原型作为 page-design delta 产出（不新增 `ui/` 目录）

- 判定「本次动了界面」后，change-writer 在**提案阶段**用 `ui-ux-pro-max` 设计系统产出界面原型，**原型直接作为 page-design delta** 写入 `logos/changes/<slug>/deltas/prd/2-product-design/2-page-design/core-NN-<slug>.html`。
- 原型为**裸 HTML**（可直接 iframe 渲染），须覆盖本次变更的**关键几屏 + 各交互状态**（如空态 / 加载 / 正常 / 错误 / 边界态）。
- `design-system.json`（ui-ux-pro-max 令牌）作为**审计产物**留在提案目录 `logos/changes/<slug>/`，供追溯「原型出自设计系统」；它不是 page-design delta、不落入 resources。
- **不新增 `ui/` 目录、复用现有 delta 路径映射**：原型走**现有 delta 路径**——面板已用 `readDir(deltas/**/*)` 列出可直接渲染；`deltas/prd/**` → `logos/resources/prd/**` 的现有路径映射仍复用（原型落入原型图文件夹，先例 `core-03-release-page-prototype.html`）。但原型落盘**不经由 merge 拷贝步骤**（不复用 `scanDeltas` 拷贝原型资产），而由**专用事务落盘入口 `commitVerifiedPrototypes()`** 完成：**严格模式下先重算并校验 hash，再原子提交**；**merge-executor 绝不触碰原型资产**。
- `proposal.md` 保持 markdown 结构不变，避免打断 CLI / runlogos 对 proposal 的解析。

#### 2.26.2 UI/UX 变更声明段（proposal.md 内机器可读声明）

- `openlogos change` 为已 `launched` 的 **GUI 项目**生成的 `proposal.md` 模板注入一节「UI/UX 变更声明」，机器可读地声明本次动没动界面 + 原型页清单：
  - `ui_impact`：布尔，声明本次是否触及界面。它是「本次动没动界面」的**权威意图源（单一事实源）**。
  - `design_system_mode`：枚举 `generated | fallback`，机器可读地声明原型出自 ui-ux-pro-max 设计系统（`generated`）还是通用风格降级兜底（`fallback`），见 2.26.10 与 2.26.7 的对账口径。
  - **声明页清单（结构化记录，非「页面名 → 文件」的自由文本）**：一个数组，每一条为一个页面记录，字段：
    - `id`：清单内**唯一**标识（用于稳定引用该页）。
    - `prototype`：预期原型文件的 **basename**，形如 `core-NN-<slug>.html`——**仅允许 basename**（禁止 `..`、禁止任何子目录分隔符）、扩展名**必须为 `.html`**、在全清单内**唯一**。
    - `description`：该页 / 屏幕的用途描述（人读）。
  - **对账按精确 basename 集合比较**：以「声明清单的 `prototype` basename 集合」对比「`2-page-design/` 下实际原型文件的 basename 集合」，**重复、额外、缺失任一情况均判失败**。
  - `PLAN_APPROVED` 的 `pages` 与 `hashes` **复用同一 basename 作为键**（`hashes` 的键即各页 `prototype` basename），三方对账全程以该 basename 键对齐。
- **仅 GUI 项目注入该段**；非 GUI 项目（`product_type` 非 GUI 类）不注入，特性不启用。
- 该声明段是下游 `flow-derive` / guard / 面板 / checker 的**唯一意图事实源**：不引入第二处判定，避免 `ui_impact` 与文件存在性各说各话。

#### 2.26.3 「动没动界面」三层判定（plan 阶段执行、去循环依赖）

- **判定主体与时机**：判定在 **plan 阶段由 change-writer 执行**（非 merge 后、非扫描 delta 内容）。
- **判定依据**：**提案意图 + 项目 `product_type` + `tasks.md` 已规划的 `[delta]` 目标**，**而非扫描尚不存在的 delta 文件内容**（在 plan 阶段无 delta 可扫，「先 delta 还是先原型」构成循环依赖，故废除「扫 delta 内容兜底」表述）。
- **三层落地**：
  1. change-writer 依 `product_type` 与提案意图**声明** `ui_impact`。
  2. **自检**：`tasks.md` 的 `[delta]` 目标是否命中 `2-page-design/`，或命中**含交互变更**的 feature-specs；命中即**强制判为「动了界面」**（`ui_impact:true`）。
  3. **可选多 agent 复核**：默认**关**，可由 driver 派发。
- 据此判定后再产出原型，全链路无循环依赖。
- **判定容错优先流程平滑**：作为增益功能，判错代价可控（顶多多画一次或退回重设），不追求绝对严谨。

#### 2.26.4 复用 `plan-exit` 批准门与「批准即 UI 确认」的前提

- **看界面不是一道新关卡**：它挂在「批准提案」这一现有动作上，**复用现有 `plan-exit`（批准方案）门——不新增门态、不新增确认标记文件**。
- 原型产出是 **plan 节点门前的普通内容生成**，授权状态与「写 `proposal.md` / `tasks.md`」**完全相同**（不新增授权、不新增门）；唯一人类确认点仍是 `plan-exit`。
- **「批准 == UI 已确认」这一等价仅当面板实际渲染了原型时成立**（F4）：
  - **渲染面板**：用户批准提案 / 启动全自动 / 让 driver 进下一步，即构成 **UI 视觉确认**；面板在批准时记录「已展示原型」provenance（`ui_prototype_rendered` + `pages` + `hashes`）。
  - **旧面板（不渲染，仅把 `.html` 按文本列出）**：该批准**只是普通方案批准、不构成 UI 视觉确认**；方法论**不宣称 UI 已确认**，给出 **advisory 提示但不阻断**（延续「不阻断」立场）。这是既有批准事件上的溯源属性，**不是新门 / 新确认标记文件**。
- **过渡期指引**：建议 runlogos 渲染升级**先于** GUI 团队依赖本前移价值发布；未升级前用户可直接打开原型 `.html` 自行确认。

#### 2.26.5 plan 阶段写入 allowlist（仅放行原型路径）

- plan-exit 门**前**，写入范围**显式放行且仅放行** `deltas/prd/2-product-design/2-page-design/*.html` 这一原型路径；其余 `deltas/**` 在 plan 阶段仍**禁止写入**。
- 该 allowlist 与「plan→spec→code 时序」「SessionStart `writing` / `ready-to-delta` 分支的 GUI + `ui_impact` 例外文案」三者**口径一致**：仅 GUI 项目 + 本次触及 UI 时允许在 plan 阶段产出 page-design 原型 delta，其余 delta 仍禁于 plan 阶段。

#### 2.26.6 producer dispatch 契约（契约由 openlogos 定，实现归 runlogos）

- driver 在 plan 节点、当判定「动了界面」（`ui_impact:true`）时，**派发 change-writer 在 plan-exit 前产出逐页原型** 的 dispatch 契约由 **openlogos spec 定义**；**driver 实现归 runlogos 关联 change `ui-ux-first-panel`**（本节不含实现）。
- **producer 责任 = 优先调用 ui-ux-pro-max（`generated`，产逐页原型 + `design-system.json` 令牌）；不可用（如 Python3 缺失）时按 fallback 契约兜底**（`fallback`，产通用风格逐页原型、**不产令牌**、填非空 `design_system_fallback_reason`），见 2.26.7 / 2.26.10。**不得**因渲染 / 令牌能力缺失而无条件卡死或强求令牌。
- 该 change 为**必须交付的关联件（非可选）**：本特性核心视觉确认价值 = openlogos 契约 **且** runlogos 实现，二者缺一即不成立。

#### 2.26.7 收敛判定（done_when：逐页非空 + 令牌 + 三方对账）

- 原型节点收敛条件**按 `design_system_mode` 分档**（fail closed：缺字段 / 非法值一律判 fail）：
  - `generated`：UI/UX 变更声明段**声明的每一个页面**在 `2-page-design/` 下都有**对应的非空原型文件**、声明清单 basename 集合 == 产出文件 basename 集合，**且**提案目录存在**合法非空**的 `design-system.json`（ui-ux-pro-max 令牌）。不是「至少存在一个文件」的弱收敛。
  - `fallback`（降级兜底）：仍要求**逐页非空** + 声明清单 == 产出文件一致；**不要求 `design-system.json`**（降级不产令牌），但**必须**在声明段填写**非空** `design_system_fallback_reason`（如「Python3 缺失」）。满足即收敛通过，**不阻塞**。降级模式下**禁止伪造设计系统令牌**（不得写占位 / 伪造的 `design-system.json`）。
  - **其它取值 / 缺 `design_system_mode` / `generated` 却无合法令牌 → fail closed**（判未收敛，advisory）。
- **完整 ground truth（三方对账）**——权威三元组必须一致：
  1. `proposal.md` 声明段的 `ui_impact` + **声明页清单**；
  2. `2-page-design/` 下实际产出的原型文件；
  3. merge 落盘 / 面板渲染的对象。
  **声明清单 == 产出文件** 为完整性判据；不一致 = 节点未收敛（advisory）。
- **producer 交付责任与残差（如实标注）**：producer = change-writer（driver 派发），**优先调用 ui-ux-pro-max 产出逐页非空原型 + 令牌（`generated`）；不可用（如 Python3 缺失）时按 fallback 契约产通用风格逐页非空原型、不产令牌、填非空降级原因（`fallback`）**；该责任由 change-writer skill + UT/ST + 验收执行与校验。**残差**：`generated` 支下「HTML 是否*真出自* ui-ux-pro-max」除 `design-system.json` 令牌可追溯外**无法纯机器证明**，属既有 acceptance 口径下的**荣誉制 + 令牌追溯**限制（如实记录、非遗漏）；`fallback` 支不产令牌，依 `design_system_mode: fallback` 如实标注为降级产物。

#### 2.26.8 「批准即确认」的 provenance 契约与防漂移（仅 `ui_impact:true` 有意义）

- **载体与向后兼容**：provenance 落在 **`PLAN_APPROVED` marker 的可选 JSON body**。`PLAN_APPROVED` **存在性语义完全不变**——存在即门已过、**空 marker 仍合法**；provenance 是**可选叠加字段**，缺失 / 空 body ⇒ 安全默认「不宣称 UI 已确认」。即 `PLAN_APPROVED` 是「存在性 marker + 可选 provenance body」的**向后兼容超集**，非破坏性重定义。
- **body 结构**：`{ ui_prototype_rendered: true, pages: [...], hashes: { "<file>": "<sha256>" } }`——记录**批准时刻**确认的原型文件清单与逐文件内容 hash。
- **防批准后漂移（阻断，非仅 advisory）**：下游（merge / implement）**重算 hash 比对**；任一不匹配（原型在批准后漂移）⇒ **该 UI 确认作废，且对 `ui_impact:true` 变更阻断其交付前进**。阻断方式**复用现有 `plan-exit` 门的「批准内容变更即批准失效」完整性语义**（原型 hash 变了 → 批准过期 → 必须**重新批准**才能继续），**不新增门**。
- **判定分支**：`ui_prototype_rendered:true` 且 **hash 全匹配** = UI 已确认、放行；**hash 失配** = 确认作废 + 阻断（重批前不前进）；缺失 / false（旧面板 / 未渲染，非漂移）= 不宣称 UI 已确认、记 advisory、不阻断。
- **适用范围**：仅 `ui_impact:true` 提案要求这些字段有意义；`ui_impact:false` 不涉及。

#### 2.26.9 严格性以「持久化批准记录」为键，绝不因会话 capability 缺失降级（F4 R7 红线）

- **模式选择（plan-exit 之前）** 才读会话 capability（runlogos 写的 `logos/.session-capabilities.json`，例 `{"ui_prototype_render": true}`）：就绪 → 渲染确认模式（要求 provenance + hash）；缺失 → 降级模式（不 claim UI 确认、advisory 不阻断）。这是该 capability 文件的**唯一**合法用途。
- **强制语义（plan-exit 之后：merge / 落盘 / 落盘后复核）一律以持久化 `PLAN_APPROVED` provenance 为键，不再读 session capability**：
  - **批准记录含 UI provenance**（`ui_prototype_rendered:true` + `pages` + `hashes`，即曾走渲染确认路径）⇒ **所有 merge / 落盘 / 落盘后复核入口永久 fail closed**：`hashes` 必须存在且完好、逐文件重算匹配；缺失 / 损坏 / 失配一律拒绝（非零退出、不生成 `MERGE_PROMPT`、不写 resources、不写 `SPEC_MERGED`）。**当前会话 capability 文件缺失 / 过期 / 被清理一律不得降级**——「曾渲染确认」的证据已固化在批准记录里，易失会话态无权推翻它。
  - **批准记录明确为 legacy/degraded、或旧空 marker 且无任何「曾渲染确认」证据** ⇒ 才走 F3 向后兼容 advisory 放行（不要求 `hashes`、不阻断）。
  - 判据由 `ui_impact` **与 `PLAN_APPROVED` 内容**共同决定；提示前 / 落盘时 / 落盘后三处**一致按此**，杜绝三处复用同一「capability 缺失即降级」错误分支而一致放行。

#### 2.26.10 Python3 降级（不阻塞）

- ui-ux-pro-max 依赖 Python3；**Python3 缺失时以通用风格兜底并在提案标注「未走设计系统」**，**不阻塞、不报错**。
- **机器可读降级声明**：降级时声明段写 `design_system_mode: fallback` + **非空** `design_system_fallback_reason`（如「Python3 缺失」）。据此，checker **不再对降级产物强制要求 `design-system.json`**——从而消解「降级不产令牌、却强制要 `design-system.json` → 永远卡死」的矛盾。
- 降级产出的原型仍作为 page-design delta 落盘：满足**逐页非空** + **声明清单 basename 集合 == 产出文件 basename 集合**即收敛通过、**不阻塞**；缺 `design-system.json` 令牌追溯属预期（对账时依 `design_system_mode: fallback` 如实标注为降级产物），**不判 fail**。
- **fail closed 边界**：`design_system_mode` 缺失 / 取非法值，或 `generated` 却无合法非空 `design-system.json`，或 `fallback` 却缺 `design_system_fallback_reason` ——一律判 fail（不放行）；**禁止在降级模式伪造设计系统令牌**。

### 2.27 存量项目逆向建种子基线（brownfield-adopter）

#### 2.27.1 目标
存量项目 `adopt` 接入后不再掉进「空提案」死角：接入时建立一份**种子基线**（现状快照，非权威意图）。存量代码 grandfather 豁免，不要求回头符合 spec。

#### 2.27.2 唯一 producer 边界（adopt 只初始化，AI driver 才逆向扫描）
- `openlogos adopt` **只做确定性本地初始化**并写入 `baseline_seed_state: required`；**不启动** Codex/Claude/RunLogos、不选模型、不授代码库读取范围、不产逆向内容。
- 逆向扫描的**唯一 producer 是 AI 会话/driver**：检测 `baseline_seed_state: required` 后派发 `brownfield-adopter` skill 产出种子基线（写 run staging），经 `openlogos baseline-seed commit` 由 CLI 计算并写 `partial`/`seeded`（字段写入 owner 是 CLI，producer 不直接改 YAML、不直接写目标目录）。
- **能力降级**：CLI-only / `--ai-tool other` / 非交互 CI / AI 能力缺失时，adopt 输出可复制的后续命令/提示并保持 `baseline_seed_state: required`，**绝不声称基线已建立**。
- **失败原子性**：adopt 初始化与逆向扫描解耦——初始化为原子确定性操作；扫描失败保持当前 `baseline_seed_state`（`required`/`partial`）、允许重试、不回滚已初始化的 `logos/`，部分产物在重扫时按候选 `key` 覆盖/清理；JSON `status` 的 `baseline_coverage.state` 映射枚举 `required`/`partial`/`seeded`。

#### 2.27.3 种子基线内容（只含可验证事实，不写 PRD）
- 产物 = system-map（模块图 / 入口 / 依赖）+ **场景候选清单**（启发式逆向），只含可从代码忠实验证的事实。
- **不写 PRD / 意图类文档**（意图无法从代码忠实还原）。
- 每份产物含具名章节 `## 逆向基线来源`，内含 `candidates[]` 注册表（一文档可含 N 个候选）：每候选 `key` / `state`（active|tombstone|retired）/ `verified: false` / `aliases[]` / `superseded_by[]` / 审计字段；`provenance` 为**派生值**（由 `verified` + `state` 推出，非独立存储），不构成第二个真相源。

#### 2.27.4 provenance 权威载体 = 文档内具名章节（非 YAML frontmatter）
- 权威载体是文档内**具名章节** `## 逆向基线来源`，因为它是 `MODIFIED` delta 可原子寻址/替换的单位。
- `logos-project.yaml` 为**派生索引**，携 `source_hash` + 生成时间，只读该章节；索引缺失/过期/解析失败时降级输出 `unknown`/`stale`，不输出貌似精确的百分比。

#### 2.27.6 覆盖率：tombstone 分母法（不虚增）
- 规范键 `key = <module>::<sha256(normalize(anchor))[:12]>`（hash 形式，可读 slug 只进 `anchor`/`display`）；候选携 `aliases[]`（重命名/移动不新建）、`superseded_by[]`（合并/拆分旧键留存并 tombstone）、扫描器版本升级经事件日志 migration map 继承旧 key。分母 = `active ∪ tombstone`、`retired` 不计入；零分母报 `n/a`。详见架构 `core-06-provenance-data-model`。
- **分母 = 存活候选 ∪ 未经人工确认的 tombstone**；重扫删除/合并的候选转 tombstone 仍留分母，仅人工确认的废弃/合并事件才移出。**分子 = module 下 `human-verified` 候选数**。`coverage = human_verified / (存活 + 未确认 tombstone)`。⇒ 无人工动作分母不缩小，百分比不因删除上升。
- `status --format json` 另单独输出 `human_verified_delta`，禁止把分母波动解读为新增人工确认。

#### 2.27.7 存量迁移保守
- 存量 provenance 迁移**保守逐产物**：缺 `## 逆向基线来源` 章节的既有文档标 `unknown`/`legacy-unclassified`（不降级人工文档、不虚构逆向基线），无产物不创建 provenance；迁移幂等、写前备份、失败可恢复、旧版 CLI 忽略未知字段。这是持久化元数据迁移。

#### 2.27.8 种子状态提交协议：`openlogos baseline-seed`（CLI 唯一写入入口，两阶段 staging，F7）
`baseline_seed_state` 的**唯一合法写入路径**是新增 CLI 命令 `openlogos baseline-seed`——AI/driver/skill **绝不直接改 YAML、也不直接把产物写入目标 `logos/resources/`**，只经此命令让 CLI 校验后原子写状态与目标文件。采**两阶段 staging** 结构，消除「begin 在产物存在前索要内容 hash」的自相矛盾：

- **`openlogos baseline-seed begin --module <id> --manifest <path> [--format json]`**：扫描开始时 producer 提交**逻辑产物计划**（**不含内容 hash**，因产物字节此刻尚未生成）：`{ module, expected: [ { kind, target_path, candidate_keys:[...] } ] }`。CLI 对计划做 schema 与安全校验后签发 `run_id`、创建 run 私有 staging 目录 `logos/resources/verify/baseline-seed-runs/<run_id>/staging/` 并持久化 run 记录，返回 `run_id`。校验规则（不满足即非零退出、拒绝）：
  - **必需 kind 集合**：`expected` 至少覆盖 `system-map` 与 `scenario-candidates` 两类（防「少报单项 manifest → 误 seeded」）；`kind` 取受控枚举。
  - **路径安全**：`target_path` 必须为**项目根相对路径**且位于允许的逆向基线目录（`logos/resources/` 下约定基线区），**拒绝**绝对路径、`..`、符号链接逃逸、重复路径。
  - **不改写现有状态**：`begin` **不下调** `baseline_seed_state`——`partial` 保留至新 run 首次有效 commit（仅 `adopt` 写初值 `required`、`commit` 写 `partial`/`seeded`）；同模块此前未完成 run 标 `superseded`。
- **`openlogos baseline-seed commit --module <id> --run-id <id> [--format json]`**：Skill 已把产物写入该 run 的 **staging** 后调用。CLI 对 **staged 实际字节**逐项校验：内容 sha256、`## 逆向基线来源`/`candidates[]` schema 合法、**staged `candidates[]` 的 key 集合与 manifest 该项 `candidate_keys` 逐项一致**、路径安全复检。分类 `committed`/`missing`/`invalid`；仅当**必需 kind 齐全且全部 expected 合法**时，才把 staged 文件**原子提交**到 `target_path` 并写 `baseline_seed_state: seeded`；**≥1 合法但未全/必需 kind 不齐 → `partial`（不提交不完整集合为权威）；0 → 保持当前状态**。CLI 是唯一状态写入者。
- **`openlogos baseline-seed status --module <id> [--format json]`**：只读当前 run、staging 进度与状态，供恢复/重试决策。

**完整性权威**：`seeded` 仅在必需 kind 齐全且 manifest 全部 expected 合法时成立——单产物 manifest、少报 manifest、单文件落盘**均不得**被判「全部完成」。**多文件崩溃一致性（commit journal + 恢复门，见架构 §4.4）**：`commit` 跨多个目标文档 + 派生索引 + `baseline_seed_state` YAML，经持久化 journal `prepared→committing→committed`（**状态最后写**、journal 阶段/进度自身原子写）在**模块级事务锁**下提交。`committing` 期间物理目标可能半新，故**不对直接按路径读取的人工/Skill 宣称原子可见**；而以**恢复门**保证机器一致性：`status`/`next`/覆盖率重算/index 扫描/派生器在读目标或算覆盖率前必须取模块锁 + 检测未终结 journal → **先恢复**、否则返回 `baseline_commit_in_progress`（`verify` 删除软告警后已不读基线候选、不参与恢复门） 且不把当前集合当权威（即便 prior 曾 `seeded` 也不复用）。恢复按每目标 on-disk hash 与 journal old/new 重判态：`prepared`→回滚、`committing`+staging 完好→前滚补齐、`committing`+staging 缺失→按 backup 回滚；`seeded` 当且仅当完整新集合 + 索引在盘。**幂等/并发/恢复**：同 `run_id` 重复 commit 依 staging + journal 重算、结果一致、不重复计数；`stale`（被 superseded）/未知 run_id/路径逃逸/`candidate_keys` 不匹配拒绝（非零退出 + `error` 码 `stale_run`/`unknown_run`/`path_escape`/`candidate_key_mismatch`/`missing_required_kind`）；同模块并发 run 由锁互斥；**带未终结 journal 的 run 持恢复优先权，新 `begin` 必须先在锁内跑其恢复再 supersede**。**退出码/JSON envelope**：协议错误非零退出；成功（含 `partial`）退出 0，JSON `{ ok, run_id, module, baseline_seed_state, committed, missing, invalid }`。

#### 2.27.9 `partial` 恢复态契约 + 与活跃提案的优先级（next/status 行为，F8）
`partial` 是**持久化恢复态**（扫描中断后保留、用户可重试），必须有确定且唯一的用户可见行为，不得被实现当作 `required`/`seeded`/`error`：

- **展示**：`status`/`next` 人读明确显示「现状基线部分建立 / 扫描未完成」，JSON `baseline_coverage.state=partial`。
- **与活跃提案的优先级（消除「唯一指向恢复」与「不阻断 change」的冲突）**：
  - **无活跃提案**（无 guard）：partial 把主 `action` / `next_node` 指向 `baseline-seed` 恢复入口（`commit --run-id <id>` 续提交或重新 `begin` 补齐）。
  - **有活跃提案**（guard 存在）：`next` 主 `action` / `next_node` / `proposal_step` **保持该提案真实前沿**（不被恢复建议劫持、不改写 `proposal_step`、不阻断 change）；partial 恢复以**结构化 advisory** 呈现于 `baseline_coverage.recovery`（`{ available:true, entry:"openlogos baseline-seed …", run_id }`），非硬门。
- **`incomplete` 字段 shape（稳定不分叉）**：`baseline_coverage` 出现时 `incomplete` **恒存在为布尔**——`state==partial` 时 `true`，`required`/`seeded` 时 `false`（不省略）；`partial` 下**不得**用已落盘候选当最终分母算精确百分比。
- **重新 begin 不回退 partial**：从 `partial` 重新 `begin` 只创建新 run（旧 run `superseded`），`baseline_seed_state` **保留 `partial`**，直到新 run 首次有效 `commit` 才转 `partial`/`seeded`；不因 `begin` 回退到 `required`。
- **边界**：`partial + 索引 stale`（`freshness=stale` 且 `incomplete=true`）、`partial + 无产物`（引导重跑、保留 run 记录、状态仍 `partial`）、`partial + 活跃提案`（proposal 前沿为主、recovery 为 advisory、change 不阻断）、`重试成功 → seeded`、`重试再失败 → 保持 partial`。`status`/`next` 对同一 `partial` 输出必须一致。

#### 2.27.10 扫描侧候选采信：alias-aware canonical 重算（provenance-scan-canonical-recompute）

修复 issue「provenance 扫描器把指南文档里的示例章节当真实候选」。provenance 读侧（`## 逆向基线来源` 扫描器）此前仅以 `key.startsWith("<module>::")` 前缀采信候选，与写侧 `baseline-seed`（§2.27.8 的 `key === candidateKey(module, anchor)` 重算校验）强度不对齐，导致文档/教学示例里"语法真、语义假"的编造候选被当成真实 provenance 迹象。

- **采信判据收紧为 canonical 重算（与写侧对齐）**：扫描器采信一候选，当且仅当 `key === candidateKey(module, anchor)` **或** `key === candidateKey(module, alias)`（任一 `alias ∈ aliases[]`）。格式合法但 hash 失配的编造/示例 key 不再被采信。
- **必须 alias-aware**：`aliases[]` 语义是旧 anchor、改名后 `key` 保持稳定（见 §2.27 与架构 core-06 §三 身份继承）。故判据取「当前 anchor ∪ aliases 任一可重算命中」，以保留改名继承 / tombstone / superseded 的合法候选；单用当前 anchor 会误杀。
- **读侧全链一致受益**：`feature-backfill` 候选查询、`buildBaselineCoverage` 覆盖率分母/新鲜度均按此不变量过滤——含 `## 逆向基线来源` 示例章节的文档（如存入 `reference/` 的官方指南）不再让 `feature-backfill` 对 `core` 硬报错，也不再让幽灵候选进覆盖率分母或把 freshness 打成 stale。
- **零新约定、不改结构**：不新增 `candidates[]` 字段、不改覆盖率口径、不改 provenance 派生；合法基线项目行为逐字节不变。

#### 2.27.11 legacy 缺省语义三入口统一 + sync 迁移落盘（baseline-seed-legacy-default-unify）

修复「legacy adopted 项目（`bootstrap: adopted` 且 yaml 无 `baseline_seed_state` 字段）三入口缺省语义分歧」：`next` / `baseline-seed` 状态机各自本地 `?? 'required'` 推断，`status` 独家走「有候选→`seeded`，无候选→`unknown` 且不输出字段」，同一项目在不同命令下两种世界观；下游按 status JSON 契约 fail-closed 导致基线入口整体消失。

**统一缺省派生规则（唯一裁决，废除 `unknown` 第三态）**：

```
effectiveBaselineSeedState(root, moduleId, explicit) → { state, legacy }
  explicit 存在            → { state: explicit, legacy: false }
  缺省（legacy）：
    有候选 ∧ 有 open run   → { state: 'partial',  legacy: true }   # 与状态机「扫描中断」对齐
    有候选 ∧ 无 open run   → { state: 'seeded',   legacy: true }   # 候选在场 = 基线事实上建立过
    无候选                → { state: 'required', legacy: true }   # 引导逆向建基线（advisory，不设硬门）
```

- **单一事实源**：该 helper（并入 `cli/src/lib/baseline-jit.ts`）是三入口（`next` / `status` / `baseline-seed` 状态机）唯一的缺省语义权威；任何入口**禁止**持有第二份私有缺省规则（本地 `?? 'required'`、私有 `effectiveAdoptedState` 一类实现全部废除）。`legacy: true` 表示派生值（yaml 未落盘），供 legacy 迁移提示与 sync 迁移使用。
- **候选/open run 判定**：「有候选」= `scanModuleCandidates` 对已合并权威文档扫描的候选数 > 0；「有 open run」= 该模块存在 `status: open` 的 baseline-seed run record。
- **读锁纪律（继承 §2.27.8 F7 恢复门）**：helper 内部派生读权威文档与 run 记录，必须在**模块读锁区间**内执行（helper 自取读锁，支持外层已持锁时复用）——调用方不得在锁外派生，杜绝「门检查后锁外读半提交集合」的 TOCTOU。
- **`unknown` 废除**：`unknown` 是无规格落点的实现层第三态，下游无法消费；本节后任何命令的任何输出（人读/JSON）不得出现 `unknown` 作为 `baseline_seed_state` 取值。
- **不强推 brownfield 的兜底**：`required` 派生态仍为 advisory 引导（§2.27.9 不设硬门），不阻断 `openlogos change` 正常迭代。

**sync 迁移落盘（legacy 缺省态物理消亡）**：`openlogos sync` 的元数据迁移（`migrate-lifecycle`）扩展——对 `bootstrap: adopted`（含历史 `skipped` 兼容读取）且无 `baseline_seed_state` 的模块，调用上述 helper 派生并把**显式枚举写入 `logos-project.yaml`**；changes 记录写明派生依据（如 `core: baseline_seed_state 缺省 → required（派生：无逆向候选）`）。已有显式值**不覆盖**；历史布尔 `baseline_seed_required` 的既有迁移行为不回归；迁移幂等。迁移后运行时派生仅作「迁移尚未执行」的过渡兜底；status 的 legacy 迁移提示文案保留，且自此指向的 sync 真实有效（不再空头）。

**status JSON 契约收紧（adopted 恒输出）**：`status --format json` 对 `bootstrap: adopted` 模块**无条件输出** `modules[].baseline_seed_state`（explicit 或派生值，枚举仅 `required｜partial｜seeded`），废除「缺省 → 字段缺失」路径；**含 `baseline_commit_in_progress` 降级分支**（提交进行中同样恒输出，legacy 缺省时经派生兜底取值）。不新增 `baseline_seed_state_source` 字段（下游 fail-closed 判定 `typeof === 'string'` 在新契约下零改动自然恢复；避免契约面膨胀）。非 adopted 模块行为不变；对旧版下游为纯增量、向后兼容。

### 2.28 status / next 机器契约自描述（contract 版本握手 / step_meta / facts，contract-self-description）

**目标**：让 `status` / `next` 的机器契约**自描述**——driver 需要的阶段语义与确定性事实由 CLI 权威输出为结构化字段，消灭消费方的本地世界模型（本地步骤枚举表、私有 marker/文件解析、重投安全 allowlist）。拍板原则：宁慢勿错杀——多等 5 分钟看门狗远好于误杀健康 run，一切措辞与设计冲突以此裁决。

**contract 版本握手**：

- status/next 的 `data` 顶层新增 `"contract": {"version": "1.0.0"}`（语义化契约版本，独立于 CLI 版本）。
- SemVer 规则：**major** = 必填字段删除/改义、闭合枚举语义变化（含移除值）、既有字段挂出判据变更；**minor** = 向后兼容扩展（新增可选字段、闭合枚举新增值）；**patch** = 不改形态与语义的澄清。
- 版本-schema 一一映射：`spec/schema/status.schema.json`、`spec/schema/next.schema.json`（内嵌契约版本号，随 npm prepack 打包）；响应 `contract.version` 与打包 schema 版本一致，CI 校验。
- 消费方约定（规范性引用，验收归 runlogos R5）：未知 major / 缺 `contract` 字段 → 保守模式（仅 next 驱动普通推进 + 看门狗，启发式判定降级为仅观察）；契约内任何枚举遇未知值 → 保守分支。

**step_meta 与步骤注册表**：

- `modules[].active_change.step_meta = {"phase", "kind"}`；`phase ∈ pre-implement|implement|post-implement`；`kind ∈ produce|gate|command-required|residency`。
- 唯一铸造点 = `cli/src/lib/step-registry.ts`（收敛 `detectProposalStep` 与 `detectProposalStepViaFlow` 双镜像及 status/next 覆盖点）；CI lint：字面量赋 proposal_step 不经注册表 → 测试失败。
- 全量注册表（**不新增 proposal_step 枚举值**）：

| proposal_step | phase | kind |
|---|---|---|
| writing | pre-implement | produce |
| ready-to-delta | pre-implement | gate |
| delta-writing | pre-implement | produce |
| ready-to-merge | pre-implement | gate |
| merge-generated | pre-implement | command-required |
| spec-complete-required | pre-implement | command-required |
| test-id-required | pre-implement | residency |
| ready-to-implement | pre-implement | residency |
| coding | implement | produce |
| ready-to-verify | implement | command-required |
| verify-failed | implement | residency |
| verify-passed | post-implement | residency |
| ready-to-deploy | post-implement | gate |
| deploy-done | post-implement | residency |
| ready-to-smoke | post-implement | command-required |
| smoke-passed | post-implement | residency |
| smoke-failed | post-implement | residency |
| implementing（旧兼容） | implement | produce |
| in-progress（旧兼容） | implement | produce |

- `step_meta` 不构成第二枚举——phase/kind 为小闭合枚举，且契约明文规定消费方遇未知值必须走保守分支。

**facts 权威事实块**：

- `modules[].active_change.facts = {"spec_complete", "slices_planned", "slices_approved", "code_required", "has_delta_tasks", "verify_pass"}`（全布尔，仅活跃提案时输出）。
- CLI 权威计算：spec_complete = SPEC_MERGED/MERGED 在场；slices_planned = tasks.md `[code]` 含真实脱占位条目；slices_approved = SLICES_APPROVED marker 在场；code_required / has_delta_tasks 沿现行判定；verify_pass = VERIFY_PASS marker。单一事实源在 CLI，driver 的自读/私有解析降级为低版本 fallback。
- facts 与 `loop_state` 激活判据**同源**（同一份计算，不允许两处实现），driver 可直接从 facts 读出「implement 是否已进入」。

**golden 与不变量破坏声明（主动破例）**：新增 `data` 顶层 `contract` 对象打破「data 顶层逐字节不变（golden 零漂移）」——全部 9 个 golden 基线快照重拍，破坏性集中在此、随大版本发布；`active_change` 新增 `step_meta` / `facts` 走 `spec/cli-json-output.md` 既有可控扩展口径（仅有活跃提案的 golden 重拍，无活跃提案项目零漂移）。

**验收边界**：本项目只验**生产者契约**——注册表/step_meta/schema 三方同步；`pre-implement 步骤不输出 loop_state` 的反面锚（漂移注入 `x-future-step` 生产者一致性测试）；`contract.version` 与打包 schema 一致。消费方保守模式 / 零误杀 / suspect 可逆态验收归 runlogos R5 提案；双向契约测试是跨仓总方案完成定义。

### 2.29 feature 功能分组层（add-feature-model）

在 module（部署/生命周期单元，粗）与 scenario（单一时序，细）之间引入**可选的 feature（功能）分组层**，补上缺失的轻量组织/导航层，并接回已有的 `2-product-design/1-feature-specs/` 文档。

- **定位**：feature 只承担组织/导航语义（把场景聚成能力域），**不复制** module 的 lifecycle/deployment/product_type/baseline 重语义；feature **归属单一 module**（子分组、不跨 module）。
- **范式（AI 维护、CLI 只读）**：`feature_counter.next_id`、`features[]`、`scenario.feature` 由 AI 维护（比照 `scenario_counter`：读→用作 F0X→+1 写回），CLI 不新建取号机制。
- **模型字段**：`features[]` 元素 `{id, name, module, spec?}`；`feature_counter.next_id`；`scenario.feature?`。ID 项目全局唯一、格式 `F0X`（>99 进位三位）；`spec` = feature-specs 文档序号（如 `core-01`，无 `.md`/无锚点），目标缺失视为未链接。
- **计数器冲突恢复（两步式，无歧义）**：`allocated = max(configured_next_id, max(existing)+1)`，用 `allocated` 创建，持久化 `feature_counter.next_id = allocated + 1`（例：已有 F05 + next_id=3 → F06、持久化 7、下次 F07）。
- **CLI 能力边界**：
  - `openlogos feature list [--module <id>] [--format json]`：只读列出各 module 下 feature 桶及成员列表；未注册 module → 错误码 `MODULE_NOT_FOUND`；空列表 → `features:[]` 退出码 0。
  - `openlogos feature-backfill [--module <id>] [--format json]`：复刻 `openlogos index` 范式——CLI 只生成回填 prompt（打包场景清单 + 现有 feature-specs 文档 + 当前 yaml）写入 `logos/feature-backfill-prompt.md`，**不改 yaml**；由 AI 语义聚类回写；幂等、只补未分组、非强制。
  - `status`/`next` 输出条件（回应 delta-F10）：**省略 `features` 当且仅当**该 module 既无注册 feature（`features[]` 中 module==本 module）**且**其下无任何场景带 `feature` 键。**只要**有 ≥1 个注册 feature**或**有 ≥1 个场景带 `feature` 键（含未知/跨 module 悬空引用）即**输出**：列出每个注册 feature（空成员 `scenarios:[]`），末位 `__ungrouped__`（当且仅当有未归属/降级场景）。因此显式写了未知/跨 module 引用的场景**一定**出现在 `__ungrouped__`，不会因"无注册 feature"被省略丢失。
  - **条件版本（回应 delta-F1=B）**：全响应无任何 `features`（纯 pre-feature 项目）时 `contract.version` **保持 `1.0.0`**、输出**逐字节完全不变（含版本字段）**；任一 module 输出 `features` 时响应 `contract.version=1.1.0`。`features` 出现 ⟺ `1.1.0`；`1.0.0` 响应永不含 `features`。
  - `feature list`（专用分组视图，回应 delta-F10）：无 legacy golden、不受零漂移约束——对每个 module 始终展示全部注册 feature（空成员 `[]`）+ `__ungrouped__`（当该 module 有未归属/降级场景）；module 有场景但无注册 feature 时返回 `[{__ungrouped__}]`（非 `[]`）。`features:[]` 仅用于**真正空 module**（无注册 feature 且无场景成员）。
- **空 feature 展示（回应 delta-F4）**：合法模型允许先登记 F01 再逐步归属；此时 F01 成员为空但**必须保留**、输出 `scenarios:[]`（不过滤）。status/next 与 feature list 对**已输出**的 feature 集合一致；差异仅在 status/next 为保零漂移对纯 pre-feature 项目省略字段，而 feature list 始终展示分组。
- **feature_counter 缺失语义（回应 delta-F7）**：`feature_counter` 或其 `next_id` 缺失时（存量首次回填的主输入），`configured_next_id = feature_counter?.next_id ?? 1`，再执行两步式冲突恢复 `allocated = max(configured_next_id, max(existing)+1)`。首次回填从 `F01` 开始。
- **五条不变量**：① feature 完全可选（纯 pre-feature 项目**逐字节完全等同今天，含 `contract.version` 保持 1.0.0**，双向 CLI 兼容）；② 混合态合法（"未分组"桶）；③ 不承担 lifecycle/deployment；④ 归属降级（`scenario.feature` 缺失/未知/跨 module 三态一律入所属 module 的"未分组"桶，不报错、不阻断；**不**类比 `scenario.module` 的兜底行为，也不改动它）；⑤ 契约条件版本 minor（`contract.version` **仅在响应含 `features` 时** `1.1.0`，否则保持 `1.0.0`；两版 schema 并存、`features`⟺`1.1.0`，见 2.28 / `spec/cli-json-output.md`）。
- **存量迁移（A + B）**：A 惰性可选（升级零改动、按需回填）；B 一键回填（`feature-backfill` 生成 prompt、AI 回写、幂等）；迁移永不被 `launch`/`verify` 强制。

### 2.29.1 feature-backfill 纳入逆向候选（feature-backfill-brownfield）

接回 `add-feature-model`（2.29）与 `brownfield-adopter`（2.27）之间的断链。原 `feature-backfill` 只以顶层 `scenarios[]` 为输入，而 S33 逆向产出的场景候选存于 `## 逆向基线来源` 章节 + `baseline_index`（未进 `scenarios[]`），导致逆向接入的存量项目在 feature 侧看不见、也无从聚类。

**方案 A（读侧扩展 + AI 回写登记，CLI 仍只生成 prompt）**：

- **读侧扩展(场景候选唯一查询,回应 F1)**：`feature-backfill` 生成 prompt 时,除 `scenarios[]` 外**只纳入逆向"场景候选"**。因 `BaselineCandidate` 无 `kind` 字段、`scanModuleCandidates` 会混入 system-map 候选,故权威筛选 = 读**已提交 run manifest** 的 `kind==scenario-candidates → target_path`,只取这些文档 `## 逆向基线来源` 的 `candidates[]`,筛选谓词**固定为 `state=="active" && verified==false`**（`verified:true` 候选**排除**,不纳入、不计数);run 历史缺失/迁移项目按目标类型/命名约定回退,仍不可定类则走降级(不静默计 0)。纳入项全部 `verified:false`,prompt 中**如实标注**"逆向候选 · 未进 scenarios[] · provenance verified:false"。
- **提交恢复门(回应 F2)**：`feature-backfill` 是新的基线机器消费者,候选筛选/计数/prompt 构造**全部在 `withRecoveredReadLocks` 同一读锁临界区内**完成（检测/恢复 `prepared`/`committing` journal);无法取锁/恢复 → `--format json` 错误码 `BASELINE_COMMIT_IN_PROGRESS`、非零退出、**不写/不覆盖** prompt。无 `--module` 按 `modules[]` 顺序取多 module 锁。
- **AI 回写职责(scenario 取号契约,回应 F3)**（prompt 指令）：对 `scenarios[]` 已有场景 + 逆向候选一并聚类;对逆向候选**登记为新场景**——复用 scenario 全局取号（`spec/module-naming-convention.md`）:`configured_next_id = scenario_counter.next_id ?? 1`、`allocated = max(configured_next_id, max(existing S)+1)`,按确定顺序逐个分配唯一 `SXX`、持久化 `next_id = 最后分配+1`;每场景写 `{id, name:<候选 anchor/display>, module:<候选所属 module>, feature:F0X}`;feature 取号沿用 2.29 `feature_counter`。**不改动候选 provenance `verified` 状态**。
- **输出契约(必填字段,回应 F4)**：`feature-backfill --format json` 的 `data` **必含** `baseline_candidates_total`（integer ≥0,键恒在场):**最终写入 prompt 的场景候选数**（kind+module+state+去重全部过滤后)。"向后兼容"指响应**新增该键**,而非可省略;消费方据此区分"零候选"与"旧实现无键"。
- **`--module` 口径(回应 F5)**：传 `--module` 只纳入该 module 候选、未注册 module → `MODULE_NOT_FOUND`(与 `feature list` 一致);无 `--module` 按 `modules[]` 顺序聚合全项目;`baseline_candidates_total` 恒等于过滤后最终纳入数。

**必须守住的不变量（逐条）**：

1. **导航 ≠ 可信度（核心红线）**：把逆向候选登记进 `scenarios[]` 只是导航/分组注册，**绝不**赋予 provenance `verified:true`。`## 逆向基线来源` 的 `verified:false` 仍是权威；S33 覆盖率 `coverage = human_verified /（存活 ∪ 未确认 tombstone)` 完全不变、不虚增。
2. **status/next 零漂移不变**：status/next 仍**只读 `scenarios[]`**（不直接读逆向候选）。非存量项目、以及 AI 尚未回写前的存量项目，输出逐字节不变、条件版本沿用 2.28（无 features → `1.0.0`）；**不**让 status/next 直接吞逆向候选（否则 adopted 项目会凭空长出 `features`、破坏零漂移）。
3. **CLI 只读 + 生成 prompt 不变**：`feature-backfill` 不取号、不改 yaml、不启动 AI；登记 `scenarios[]` + feature 由 AI 按 prompt 回写。
4. **非存量项目零改动**：无 `baseline_index` / 无逆向候选时行为与今天一致（`baseline_candidates_total=0`、prompt 无候选段）。
5. **不改 merge / provenance 协议**：不引入双有序 delta、不嵌套 change、不扩展 provenance schema。

**与 2.27 的桥接关系**：S33 负责"逆向出场景候选 + 追踪可信度"；本扩展负责"把这些候选组织成 feature 分组供导航"。两者操作不同结构（provenance 章节 vs `scenarios[]`）、互不改写对方语义。

### 2.29.2 feature-backfill 错误可诊断性：触发文件路径 + 失败分类（provenance-scan-canonical-recompute）

扩展 §2.29.1：`feature-backfill` 报 `BASELINE_PROVENANCE_INVALID` 时，错误 message / JSON envelope 附上判定为 provenance 的**触发文件相对路径清单**与失败原因**分类**，把「只报模块名、需源码级逐环节排查」降为一眼定位。

- **`paths[]`**：本次判定为 provenance 迹象、导致失败的文件相对项目根路径清单（确定性排序）。
- **`reason` 分类**：`unparseable`（权威/约定目标 `## 逆向基线来源` 坏 fenced YAML）| `unclassifiable-evidence`（有 provenance/baseline_index 迹象但无 committed run manifest 且无约定命名文件、不可定类）。
- 该增强为**向后兼容**（错误 envelope 新增字段，不改错误码语义、不改退出码、不改「不写/不覆盖 prompt」红线）。与 §2.27.10 的 canonical 采信配合：真正因编造/示例 key 产生的假迹象在采信阶段即被排除、不再进入本错误路径；进入本路径的必是真实坏结构或真不可定类，`paths[]` 直接指向问题文件。

### 2.30 change-lint 计划产物左移硬检查（S35）

#### 命令形态

`openlogos change-lint [--slug <slug>] [--format json]`

- **独立顶层命令**（F4 碰撞裁决记录：`openlogos change lint` 子命令形态被否决——CLI 现行解析把 `change` 后首个非 flag 参数当 slug，该字节序列的既有含义是「创建 slug 为 `lint` 的提案」，子命令形态会改变 S09 公开行为且使 slug 为 `lint` 的提案无法创建；顶层命令零碰撞、S09 零改动）。
- 无 `--slug` → 取 guard 活跃提案；无活跃提案且未给 slug → 操作错误（`no_active_proposal`，exit 1）。
- **slug 词法**：`[a-z0-9][a-z0-9-]*`；拒绝空值、路径分隔符、`.`、`..`、绝对路径；解析后做 realpath containment 校验（目标必须落在 `logos/changes/` 内，symlink 逃逸同拒，`slug_invalid` / `slug_not_found`）。历史不合词法的提案目录走只读兼容口径：目录直查存在即可 lint，仍过 containment。
- **模块归属解析（module-aware 判据的唯一权威，含 L7）**：经共享 proposal-context resolver 解析——①首选 `proposal.md` 头部 `> module: <id>`（持久事实源）；②仅当该头缺失**且** guard 的 `activeChange` 等于本 slug 时，回退 guard 的 `module` 字段；③两者同时在场且冲突时以 proposal.md 头为准；④仍无法解析出模块、或解析出的模块不存在于 `logos-project.yaml` → 操作错误 `module_unresolved`（exit 1，命令未完成检查，fail-closed，不得静默按非 GUI 跳过）。

#### 检查项矩阵

| # | 检查 | 共享判据 | 生效阶段 |
|---|------|---------|---------|
| L1 | tasks.md 结构可解析（≥1 个 `## [tag]` 标题） | `parseTaskSections` 非 null | 恒生效 |
| L2 | 需代码的提案有 `## [code]` 标题（空段占位合法） | `isCodeRequiredForProposal` × section 在场判定 | 恒生效 |
| L3 | 分阶段测试证据模型 | 共享结构化 test-id evaluator | 恒生效（仅 code_required 提案） |
| L4 | `.md` delta 含 ADDED/MODIFIED/REMOVED 段标记且脱模板骨架 | 共享 `validateMarkdownDelta` | 仅对已存在 delta 文件 |
| L5 | 部署决策一致性（proposal × tasks `[deploy]` 互证） | `resolveProposalDeploymentDecision` conflict 判定 | 恒生效 |
| L6 | delta 路径合法性（正交双结论） | 共享 delta 分类器（lint 读 `lintValidity`） | 仅对已存在 delta 文件 |
| L7 | GUI 项目 ui_impact 声明结构合法 + `ui_impact:true` 逐页对账 | `evaluateUiPrototype` 纯 evaluator；模块经 proposal-context resolver 解析，`product_type ∈ {web,desktop,mobile}` 激活 | 仅 GUI 项目 |

#### L3 分阶段测试证据模型

**证据等级的阶段分类函数（唯一、可判定；输入 = marker 与 tasks.md 的机器事实，无命令参数）**：

| 优先序 | 输入事实 | 证据等级 |
|--------|---------|---------|
| 1 | `SPEC_MERGED` / `MERGED` marker 存在 | **slice 级**：证据集合**限定到本提案（proposal-scoped）**——曾有测试 delta 的提案，把本提案 `deltas/test/**` 的相对路径逐一映射到对应 `logos/resources/test/**` 目标文件，**只读取这些目标文件**的结构化 ID 列；无测试 delta 的纯代码提案**只能**凭合法复用清单。**禁止扫描 `logos/resources/test/` 全目录**——项目全局的无关既有 ID 不构成本提案证据（否则成熟项目任何提案 merge 后都会假通过）。lint 与 flow-derive `test-id-required` 同判据同结论 |
| 2 | 无 merged marker，`[delta]` section 存在且其任务**全部勾选** | **spec-complete 级**：必须能从**本提案**已产出的 `deltas/test/` 文件的结构化 ID 列、或经校验复用清单解析到具体 ID；`[delta]` 任务文字中的 `deltas/test/` 规划字样**不再充当证据**（防「全勾但测试 delta 实际缺失」假通过） |
| 3 | 无 merged marker，`[delta]` section 存在且未全部勾选 | **plan 级**：证据 (a) `[delta]` 任务规划了 `deltas/test/` 目标，或 (b) 合法复用声明 |
| 4 | 无 merged marker，无 `[delta]` section（纯代码提案） | **plan 级**（证据仅 (b) 复用声明或已存在 `deltas/test/` 文件），直至 no-delta merge 写入 `SPEC_MERGED` 进入 slice 级 |

**`[delta]` 勾选度的计数基（防延后非 delta 任务降级证据等级）**：上表第 2/3 档的「勾选度」**仅统计 delta 产出条目**——任务文字含 `deltas/` 目标路径的 checkbox 项；不含 `deltas/` 路径的条目（如「merge 时同步更新元数据」类 merge-time 工作）**不参与计数**。producer 规范（change-writer）同时要求：`[delta]` section 只含一文件一任务的 delta 产出 checkbox，非 delta / merge-time 工作不得以 checkbox 形式写入 `[delta]`（以说明文字或独立小节承载）。双保险缺一即防：即便 producer 违规混入非 delta checkbox，分类函数也不会把「全部真实 delta 已落盘」的提案压回 plan 级、从而绕过 spec-complete 级的测试 delta 实物校验（UT-S35-09a 反例锚定）。

**复用声明固定语法（producer/parser 互操作契约，可整块复制）**——`proposal.md` 中标题**精确**为 `## 复用测试 ID` 的小节，正文为列表，每行一条：

```markdown
## 复用测试 ID

- UT-S09-02 — 覆盖 unknown 目录忽略回归
- ST-S30-04 — 覆盖 cmd-gate 端到端路径
- SMOKE-core-12 — 覆盖部署后命令可见性
```

解析规则：每行 `- <ID> — <一句话用途>`；ID 必须**精确存在于已合并** `logos/resources/test/` 规格的**表格结构化 ID 列（首列）**——散文、覆盖清单或说明文字中提及的 token **不构成存在性**（防「仅散文提及」伪装成已定义用例）；允许 UT/ST/SMOKE 混合；同一 ID 重复 → 该项违规；存在任一非法项（语法不符或 ID 不存在）→ **逐项各报一条** `code_change_requires_real_test_ids` violation（`path` 指向 proposal.md，`message` 含该行原文），合法项不因此失效但小节整体不判过，直至全部合法。

**ID 闭合文法（兼容基线 + 减法拒绝，权威 parser 单点承载）**：
- **兼容基线 = 现行宽语法的锚定整串版（含点号收紧）**：`^(UT|ST|SMOKE)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)*$`——与生产 `TEST_CASE_ID_PATTERN` 同构、整串锚定，且**点号仅允许作段内分隔**（如 `01.1`）：候选以 `.` 开头/结尾或含空 dot 段（如 `xx.`、`a..b`）不构成合法 ID——否则尾随点号会使末段变成 `xx.`、绕过占位黑名单的整段精确匹配。**不收窄形态**：现行语料中的 `ST-S01-EX-adopt`、`UT-S05-bootstrap-01`、`UT-S05-B01`、`UT-JSON-09`、`ST-JSON-21`、`UT-S09-110a-neg`、多段后缀及含连字符 module 的 `SMOKE-<module>-NN` 全部继续合法（模块命名规范「小写字母+连字符」兼容）。
- **减法拒绝（仅以下两类，在基线之上叠加）**：①候选含 `*`、`?`、方括号或其它未被基线消费的尾部字符 → 整候选拒绝；②最末段为 `xx`/`XX`/`NN`/`TBD`/`TODO`（大小写不敏感）→ 拒绝。
- 大小写敏感；token 边界 = 空白、行首尾、反引号、中英文标点（`-` 与 `.` 除外）；**候选首尾的点号按边界标点先行剥除**（句末点号不是 ID 组成部分：`见 UT-S09-02.` 采信为 `UT-S09-02`；`UT-S99-xx.` 规范化为 `UT-S99-xx` 后仍命中占位黑名单）；候选必须整串匹配（`match[0] === 候选全串`，前缀命中不采信）。
- **corpus compatibility 回归（实现前置）**：从当前全部 `logos/resources/test/*.md` 表格首列构建语料回归夹具，既有全部已定义 ID（含非数字尾段形态）必须继续被 parser 接受——flow-derive 换用 parser 后**零合法提案回归**。
- 文法以架构文档指定的共享 parser（`parseTestCaseIds`）单点实现，lint / flow-derive / merge 一律经它——**新 ID 的判定不依赖「已合并语料中存在」**（新 ID 按文法判形 + 从测试 delta 结构化 ID 列读取），复用 ID 才要求存在性（且仅认结构化 ID 列）。

#### L6 正交双结论

共享分类器对每个 delta 条目返回两个正交结论：`mergeDisposition`（`mergeable` / `ignored`——与现行 merge 消费行为逐字节一致，**零改动**）与 `lintValidity`（`valid` / `explicitly_ignored`〔`reference` 具名保留〕/ `invalid`〔unknown 目录、越界目标、symlink 逃逸、根下直放、**非常规 symlink 目标**（解析后非普通文件亦非目录，如 FIFO/socket——与现行 merge 的 `isFile()` 过滤零漂移，恒不消费、恒不预读）〕）。merge 只读前者，lint 只读后者并对 `invalid` 报 `delta_path_invalid`；根级 symlink 与根级普通文件同判（分类器对任何文件系统输入不得崩溃）。

#### 输出

- **人读**（默认，无 `--format json`）：逐项 ✓/✗ + PASS/FAIL 摘要；每个 ✗ 给「缺什么 / 在哪补 / 补成什么样（含示例）」三段式 fix_hint；操作错误输出 `Error [<code>]: <message>` 到 stderr。**默认模式不输出 JSON。**
- **`--format json`**：遵守通用信封（见 `spec/cli-json-output.md` §3.15）；检查完成（无论 pass）→ stdout success envelope；操作错误 → stderr error envelope。
- **exit code**（两种格式一致）：0 = 全过；2 = 有违规；1 = 操作错误。

#### 授权语义

只读、非人类确认点、任何角色任何阶段可跑；不写 marker、不改变任何 step/gate 派生。只读红线为**项目级**：运行前后整个项目根（含 `logos/.openlogos-guard`、marker、`logos-project.yaml`、verify 账本）零写入。

### 2.31 Windows 外部归档 watcher 握手协议

**目标与门控**：Windows 不允许在目录 watcher 持句柄时 rename 目录，导致外部 `openlogos archive` 遇活跃监听时 EPERM。本协议让 CLI 在 rename 前与监听方完成有界握手以释放句柄。**仅在 `process.platform === 'win32'` 启用**；macOS/Linux 不创建/读取/监听任何协议文件、不增加等待，直接走既有 archive 路径。

**发现判据（存在即协商，无版本探测）**：CLI 读取 `logos/.runtime/archive-watch/v1/` 下实例租约，只把「未过期 + projectId 匹配 + capabilities 含 prepare」的租约纳入 ACK 快照。会写租约的新版 RunLogos 才可见；未装/未运行/旧版（不写租约）一律不出现，天然退化为 rename 快路径。

**协议对象**（`openlogos.archive-watch/v1`；JSON 用 UTF-8、同目录临时文件写入后原子 rename；未知字段忽略、未知主版本拒绝）：
- **实例租约** `instances/<instanceId>.json`：`protocol`/`instanceId`/`pid`/`projectId`(realpath 不可逆哈希)/`startedAt`/`heartbeatAt`/`expiresAt`/`capabilities`。RunLogos 周期续租，退出/切项目时删租约。PID 仅辅助诊断，不替代租约与 projectId 校验。
- **准备请求** `requests/<requestId>/prepare.json`：`requestId`/`projectId`/`slug`/`cliPid`/`createdAt`/`deadlineAt`/`expectedInstances`(稳定屏障)/`mode`。CLI 写请求前须完成项目根 realpath、slug 语法、live change 路径与 guard 校验。
- **实例 ACK** `requests/<requestId>/acks/<instanceId>.json`：`status` 至少 `released|failed|ignored`，只有 released 满足屏障；failed 必带稳定 reason。ACK 不得含用户文件内容/绝对路径/命令输出全文。
- **CLI 结果** `requests/<requestId>/result.json`：`status` 至少 `archived|not-archived|inconsistent|cancelled`，附 `archivePathHint`(仅相对名)/`exitCode`。RunLogos 收到后须以磁盘真相(live/archive/guard)决定恢复或换表。

**archive 状态机（Windows 分支）**：
1. 既有归档资格与授权校验；失败不创建 prepare。
2. 解析 runtime 目录，清理过期请求与租约。
3. 快照匹配项目且未过期的活跃实例。
4. **快照为空 → 走既有 rename 快路径，不引入等待**（runtime 缺失即空快照、非错误）。
5. 快照非空 → 原子写 prepare，轮询 ACK 直到全 released / 任一 failed / deadline。
6. 失败或超时 → fail-closed：不 rename、不更新 guard；写 cancelled/not-archived result，返回稳定错误码。
7. 全 released → 执行既有 archive 事务；无论成败在 finally 尽力写 result。
8. 以 live/archive/guard 三态裁决；「命令报错但磁盘已归档」调和为成功并标记 `reconciledFromDisk`。
9. result 保留短 TTL 供迟到消费者读取，再幂等清理；清理失败不反转归档结果。

**去递归（无全局逃生开关）**：RunLogos spawn CLI 时注入仅对子进程可见的一次性 `OPENLOGOS_ARCHIVE_WATCH_PREPARED=<token>` 声明「宿主已协调」。CLI 仅在 token 结构有效、cwd/projectId 与绑定项目一致、slug 一致、未过期时跳过外部握手；不提供长期全局开关。

**稳定错误码（不新增 stdout JSON envelope）**：archive 保持纯文本输出；握手失败以稳定错误码 + 非零退出码返回，机器可读细节写进 result.json：`ARCHIVE_WATCH_PREPARE_FAILED`/`ARCHIVE_WATCH_ACK_TIMEOUT`/`ARCHIVE_WATCH_INSTANCE_FAILED`/`ARCHIVE_WATCH_STATE_INCONSISTENT`（登记于 `spec/cli-json-output.md` §6.1）。

**runtime 目录**：`logos/.runtime/archive-watch/v1/`。根 `.gitignore` 已忽略 `/logos/`，天然不入库。协议路径须由 CLI 提供确定性解析函数并附兼容测试向量，供 RunLogos 复用同一算法。

**并发/崩溃/安全**：同一 projectId+slug 仅一个请求在途（重复共享结果或返回 archive-in-flight）；RunLogos 以 requestId+instanceId 幂等、同一 token 只恢复一次；CLI 崩溃致 result 缺失时 RunLogos 在 deadline/租约过期后重读磁盘三态；RunLogos 崩溃或 ACK 丢失时 CLI 等到 deadline 后拒绝 rename；协议目录拒绝 symlink 越界，slug/requestId/instanceId 严格白名单；日志只记项目哈希/slug/requestId/实例数/耗时/状态/稳定 reason。

**实现边界**：本仓只实现 CLI 消费端；RunLogos 协议端（pause watcher、写 ACK、读 result 恢复）不在本仓。CLI 先行、RunLogos 未配套期间快照恒空 → 走快路径、无回归。

### 2.32 生命周期变更影响分类（impact，S36）

> 提案原文规划为 §2.31；因 win32-archive-watcher-handshake 已先行合入 §2.31，本节顺延为 §2.32，内容不变。

#### 命令形态（双输入模式）

`openlogos impact --base <rev> --head <rev> [--format json]`
`git diff --no-relative --name-status -z <base> <head> | openlogos impact --stdin [--prefix <dir/>] [--format json]`

- **`--base/--head` 模式**：CLI 内部取得变更字节流（要求当前目录处于 git 仓库环境），修订解析走**唯一的安全路径**（见下「修订参数安全」）；git 不可用、非 git 仓库、修订不可解析或 `git diff` 非零退出 → 操作错误 `IMPACT_GIT_DIFF_FAILED`（非零退出；`--format json` 时 stderr error envelope）。
- **`--stdin` 模式**：直接消费管道输入的同格式（`--name-status -z`）字节流，**完全不依赖 git**，供 CI 平台已有 changed paths 的场景。可选 `--prefix <dir/>` 声明路径坐标前缀（见下「路径坐标系」）。
- **参数校验**：`--stdin` 与 `--base`/`--head` 互斥；`--prefix` 仅 `--stdin` 模式合法（与 `--base`/`--head` 并存亦非法）；两组皆缺、或 `--base`/`--head` 只给其一、或 `--stdin` 模式下 stdin 读取失败（I/O 层无法取得输入）→ 操作错误 `IMPACT_INPUT_INVALID`。注意区分：**取不到输入**是操作错误（非零退出）；**取到了字节流但内容不可解析**是判定完成、结论 fail-closed（`lifecycle_only: false`，exit 0，见下）。
- 默认输出人类可读文本（摘要 + 分类清单）；`--format json` 输出机器契约。两模式、两格式下判定逻辑同一套纯函数：**同一（字节流, 前缀）输入逐字段结论一致**（git 模式的自动前缀等价于 `--stdin` + 显式 `--prefix`）。

#### 修订参数安全（防 Git 选项注入，只读红线的前置条件）

`--base` / `--head` 的值即使经 `execFile` 参数数组传递（不经 shell），Git 仍会把 `-` 开头的值解析为选项（如 `--output=<path>` 会令 `git diff` 写文件——真实写入口）。因此规定**三层防线**，任何实现不得绕过：

1. **词法拒绝**：值为空、或以 `-` 开头（option-like）→ 直接 `IMPACT_INPUT_INVALID`，**不把该值传给任何 git 进程**、不交给 Git 猜测。
2. **修订解析隔离**：对 base / head 分别执行 `git rev-parse --verify --end-of-options <rev>^{commit}` 解析为**完整十六进制 commit OID**（兼容 SHA-1/SHA-256）；解析失败 → `IMPACT_GIT_DIFF_FAILED`。
3. **diff 只收规范化 OID 且显式中和 relative 配置**：`git diff --no-relative --name-status -z <base_oid> <head_oid>` 的位置参数只允许上一步产出的十六进制 OID，杜绝任何用户原值到达 diff 进程；**必须显式携带 `--no-relative`**——仓库/用户配置 `diff.relative=true` 时，Git 会把输出路径裁剪为当前目录相对并静默过滤当前目录外的变更，破坏坐标系不变量（见下节），显式命令行开关是覆盖任意 repo/user config 的中和手段。

只读红线因此覆盖**项目内与项目外**：命令全程不因参数值产生任何文件系统写入（ST 以项目内/项目外双哨兵锚定）。

#### 路径坐标系（OpenLogos 项目根对齐，monorepo 兼容）

Git 的 `--name-status` 输出始终相对 **git top-level**；而 OpenLogos 只要求命令在含 `logos/logos.config.json` 的项目根运行，项目根可以位于 monorepo 子目录（如 `/repo/packages/app`）。两个坐标系显式对齐：

- **分类坐标 = OpenLogos 项目根相对路径**。分类前先把输入路径按**已验证的项目前缀**剥除：
  - `--base/--head` 模式：CLI 经 `git rev-parse --show-prefix` 自动取得项目根相对 git top-level 的前缀（项目根即 top-level 时为空前缀）。
  - `--stdin` 模式：由调用方经 `--prefix <dir/>` 显式提供同一前缀；缺省 = 空前缀（输入字节流已是项目根相对）。
- **前缀剥除按路径段边界**：`packages/app/logos/changes/x` 在前缀 `packages/app/` 下剥为 `logos/changes/x` 再查契约表；`packages/app-evil/**` 不命中前缀。
- **项目前缀外的路径不静默丢弃**：直接归 `external` class（non-lifecycle），照常计入 `files[]` 与 `non_lifecycle_paths`——不得用 `--relative` 之类手段让它们从判定中消失。
- **输出坐标 = 原始输入路径**：`files[].path` / `files[].old_path` / `non_lifecycle_paths` 一律保留未剥前缀的原始路径（与输入字节流可直接对照）；前缀剥除仅发生在分类内部。
- **取流配置中和（不变量守卫）**：git 模式取流命令**必须显式携带 `--no-relative`**，以中和仓库/用户配置 `diff.relative=true`——该合法配置等价于启用相对模式，会把路径改写为当前目录相对并**静默裁掉当前目录外的变更**，同时破坏「输出始终为 git top-level 坐标」与「项目前缀外路径不静默丢弃」两条不变量，并使 git 模式无法与消费完整原始字节流的 `--stdin` 模式逐字段一致。仅在文档禁止 `--relative` 不足以覆盖配置来源，必须落在命令行开关上并由 ST 对抗配置档锚定（ST-S36-10⑤）。`--stdin` 模式由调用方保证字节流为 top-level 坐标（示例统一带 `--no-relative`）。

#### 路径语义契约 v1（只声明确定安全的集合，其余不背书）

版本化常量 `PATH_CLASSES_V1` 内置于 `cli/src/lib/impact-classify.ts`，权威文字声明落根 `spec/change-impact.md`（本提案随 delta 一并产出）与本节，三处同源维护、代码与规范一致。下表的匹配对象是**剥除项目前缀后的项目根相对路径**：

| class | 集合 | 语义 |
|-------|------|------|
| `lifecycle` | `logos/.openlogos-guard`（精确文件）；`logos/changes/**`（含 `archive/**`）；`logos/resources/verify/**`；`logos/.runtime/**` | OpenLogos 官方背书：纯生命周期簿记，确定不进入可部署制品 |
| `project` | `logos/**` 下上述之外的一切（含 `resources/database/**`、`logos.config.json`、`resources/prd/**` 等） | 项目自决：可能进入制品或影响 verify/smoke，OpenLogos 不越界背书 |
| `external` | 项目前缀外的一切，以及项目内 `logos/` 之外的一切 | 项目业务域，OpenLogos 完全不判断 |

- 前缀匹配按**路径段边界**判定：`logos/changes/x` 命中，`logos/changes-evil/x`、`logos/changesfoo` 不命中；`logos/.openlogos-guard` 为精确文件匹配。
- 路径以 `/` 分隔（git 原生输出形态）为准；`-z` 分隔规避引号转义与特殊字符文件名问题。

#### 判定规则（全部 fail-closed）

- **只按路径前缀分类**：完全不依赖 rename 配对结果、时间戳归档目录名与 marker 文件名——空 marker 被 Git exact-content rename 检测任意配对（如 `VERIFY_PASS -> SMOKE_PASS`）不影响结论。
- **状态覆盖**：A / M / D（单路径）；R / C（携相似度后缀如 `R100`，双路径）——R/C 必须**新旧路径双侧均为 `lifecycle`** 才算 lifecycle，任一侧越界即该文件非 lifecycle。
- **fail-closed 兜底**：未知状态字母（T / U / X 等）、字节流解析失败（截断记录、字段数不符）、空 diff、空输入，一律判定完成且 `lifecycle_only: false`，并在 `reasons` 给出原因。空 diff 不判 true——CI 语境下空区间多为 sha 传参错误，宁可多构建一次。
- **结论**：`lifecycle_only === true` 当且仅当变更集非空、全部记录解析成功、且每个文件（R/C 含双侧）均为 `lifecycle` class。
- **`lifecycle_only` 是唯一决策字段**：`operations`（如从「guard 删除 + changes 移入 archive」推断出 `archive`）、`changes`（涉及的提案 slug 列表）、`reasons` 仅辅助展示，CI 不得据其做部署决策；退出码也不编码判定结论（判定完成一律 exit 0，无论真假），CI 不得以退出码替代 `lifecycle_only`。

#### 输出契约（版本化、只增不改，字段命名遵守 §1.1 snake_case）

`--format json` 走 `spec/cli-json-output.md` §1.2 通用信封（`command: "impact"`），data 部分（登记于 `spec/cli-json-output.md` §3.16，本提案随 delta 一并产出）：

```jsonc
{
  "schema_version": "openlogos-change-impact.v1",
  "lifecycle_only": false,
  "files": [
    { "status": "R", "path": "logos/changes/archive/20260801-x/proposal.md", "old_path": "logos/changes/x/proposal.md", "class": "lifecycle" },
    { "status": "M", "path": "cli/src/index.ts", "old_path": null, "class": "external" }
  ],
  "non_lifecycle_paths": ["cli/src/index.ts"],
  "operations": ["archive"],
  "changes": ["x"],
  "reasons": ["non-lifecycle path: cli/src/index.ts"]
}
```

- **全部公开字段为 snake_case**（`spec/cli-json-output.md` §1.1「字段命名：snake_case」）：`schema_version` / `lifecycle_only` / `files[]`（`status` / `path` / `old_path` / `class`）/ `non_lifecycle_paths` / `operations` / `changes` / `reasons`。**命名回归红线**：data 递归键集合必须恰为本契约声明的键，不得出现未声明键（防实现内部 camelCase 类型名泄漏到 stdout，测试锚定）。
- `files[]`：逐文件 `status`（规范化单字母 A/M/D/R/C）/ `path`（新路径，原始输入坐标）/ `old_path`（仅 R/C，其余 `null`）/ `class`（该文件归并结论：R/C 取双侧中更不安全的一侧）。
- `non_lifecycle_paths`：导致 `lifecycle_only: false` 的越界路径清单（原始输入坐标，确定性排序）；fail-closed 兜底触发时可为空、原因见 `reasons`。
- **只增不改**：schema 字段只增不改；破坏性变更须升 `openlogos-change-impact.v2` 并保留 v1 过渡期。
- **exit code**：0 = 判定完成（`lifecycle_only` 真假皆 0）；非零 = 操作错误（`IMPACT_GIT_DIFF_FAILED` / `IMPACT_INPUT_INVALID`，stderr error envelope / stderr 文本）。

#### 授权语义与非目标

- 只读命令、非人类确认点，任何角色任何阶段可跑；不写任何项目文件、marker、guard，**也不得因参数值写项目外任何路径**（修订参数安全三层防线是该红线的实现前提）。
- 非目标：不替项目判断业务源码 / Dockerfile / 部署配置是否影响制品（`project` / `external` 类的部署语义归项目自决）；不改变 archive / merge / verify 任何现有行为与输出；不给 archive 新增 stdout JSON envelope；不修改任何 marker 内容（规避「逐字节等价」契约兼容风险，§2.31 亦不受影响）。
- 文档建议 CI 侧 pin 住 CLI 版本，避免隐式升级引入判定行为变化；暂缓 archive 落盘 manifest 形态（只覆盖 archive 单次操作，回答不了任意 `base..head` 区间问题，`impact` 已完整覆盖其场景）。

### 2.33 delta 条目守恒门与 archive 审计定位（S37）

> 来源变更：merge-conservation-archive-audit（社区 RFC issue #12）。位于 §2.32（S36 impact）之后。

#### 2.33.1 守恒判据（形式化定义，按结构化归属）

对每个目标为**带稳定 ID 条目规格**的 `.md` delta 文件，**逐触及章节**做集合对账：

```
对每个被 MODIFIED / REMOVED / REMOVED-ITEMS 锚定的主文档章节 sec：
  违规集合(sec) = sec 的既有结构化 ID 集合
               − delta 中锚定 sec 的新内容（MODIFIED 块正文）的结构化 ID 集合
               − 锚定 sec 的 REMOVED-ITEMS 块点名 ID 集合
               −（sec 被整节 REMOVED 时：sec 全部既有 ID，视为随章节显式删除）
要求：每个 sec 的违规集合 == ∅
```

- **结构化归属（防散文绕过）**：ID 的「存在」与「保留」都只认**结构位置**——测试 ID 只从测试表 **ID 首列单元格**抽取；场景 ID 只从 `## SXX:` 形态章节标题与场景总览 / 场景地图表**行首列**抽取；节号只从**标题行**抽取。散文提及、非 ID 列单元格、代码围栏内引用一律**不计入**——在正文里写一句「SMOKE-core-03 已删除」不构成保留，也不构成显式删除。
- **逐章节对账（防跨节背书）**：保留必须发生在 **ID 原所在章节**锚定的块内；A 章节的 MODIFIED 块中出现 B 章节的 ID，不为 B 章节的删除背书。
- **违规判定**：违规集合中每个 ID 产生一条 `delta_implicit_id_removal` violation（含缺失 ID、所属章节锚、fix_hint：「补回该章节 MODIFIED 块的结构条目，或用锚定该章节的 REMOVED-ITEMS 块点名」）。
- **反向校验**：REMOVED-ITEMS 点名的 ID 不属于其锚定章节的既有结构化 ID 集合 → `delta_removed_unknown_id`（含拼写不存在与「点名了别的章节的 ID」两种形态）。
- **新文件跳过**：目标主文档不存在（delta 创建全新文档）时跳过守恒——无既有条目可保。
- **ADDED 块**：不触及既有章节、不产生守恒义务（纯新增天然守恒）。

#### 2.33.2 章节锚与唯一定位（fail-closed）

- 段标记的标题部分是**章节锚**，支持两种形态：
  - **单段锚**：`## MODIFIED — 二、冒烟测试用例`——仅当该标题在目标主文档中**唯一**时合法；
  - **标题路径锚**：`## MODIFIED — 四、smoke runner 覆盖强制规则发布后冒烟用例 > 二、冒烟测试用例补充`——以 ` > ` 连接父级到目标级标题，用于目标标题在文档中重复时唯一定位（真实语料：`core-smoke-test-cases.md` 中 `### 二、冒烟测试用例补充` 重复 7 次，分属不同父章节）。
- **解析规则（确定性，禁止猜测）**：锚在目标主文档中解析到 **0 个或 ≥2 个**章节 → fail-closed，产生 `delta_section_anchor_unresolvable` violation（诊断区分 not-found / ambiguous 与候选位置列表）；判据**不得**取第一个命中、不得合并同名章节、不得按 delta 内容反猜目标。
- 该定位规则同时约束三方：change-lint L8、`openlogos merge` 消费点、merge-executor 应用 delta 时的人工定位（歧义即暂停询问，与「冲突时询问」原则一致）。

#### 2.33.3 ID 模式注册表（单点维护）

守恒覆盖的 ID 类别由统一注册表定义，注册表是唯一事实源，**严禁在注册表外散落第二份 ID 正则**：

| 类别 | 文法 | 结构化抽取位置 |
|------|------|----------------|
| 测试 ID | `UT-*` / `ST-*` / `SMOKE-*`，token 判形复用既有 `parseTestCaseIds` 权威 parser | 测试用例表 **ID 首列单元格**（结构识别对齐既有 `extractStructuredTestIds` 模式，先认结构位置、再用 parser 判形） |
| 场景 ID | `SXX`（如 `S05`、`S37`） | `## SXX:` / `### SXX` 形态**章节标题**；场景总览 / 场景地图表**行首列** |
| 功能规格节号 | 完整编号 token：`N(.N)*` 多级数字 + 可选**直接单字母后缀**或**末级点分单字母**（等价 `N(?:\.N)*(?:[A-Za-z]|\.[A-Za-z])?`；覆盖 `2.33`、`2.29.1`、`2.29.2`、`2.2b`、`2.2c`、`2.5a`、`2.7A`、`2.13.1`、`2.19.A`、`2.19.B`、`2.19.C`、`2.20.A`、`2.20.B`、`2.20.C`、`2.20.D` 等既有全部形态） | **标题行**（`### <编号> <标题>` 与 `§<编号>` 引用形态）；**完整 token 即 ID**——`2.29.1` 与 `2.29.2` 是不同 ID、二者均不坍缩为 `2.29`；`2.2b` 与 `2.2c` 不同 ID；`2.19.A` 与 `2.19.B` 不同 ID、均不坍缩为 `2.19` |
| 版本号 / 散文小数排除 | — | 节号只从标题行抽取，`0.13.21`、散文中的 `1.5` 等天然不入集合；标题行外的 `§N.NN` 引用视为散文提及、不计入保留 |

- **兼容语料回归（强制）**：实现须先从当前全部受管规格（feature-specs / cli-experience / requirements / test / smoke 等）的标题生成兼容语料，闭合文法必须识别语料中全部既有编号标题；逐个删除任一标题须产生守恒违规（corpus 回归锚定，防文法漏形态）。
- 注册表扩展（未来新增 ID 类别，如决策记录 `DXX`）只改注册表一处，判据函数零改动。
- **残差（如实标注）**：仅「结构化 ID 条目内部的无编号散文」不在机器门内——删散文与改写散文机器不可分，而改写正是 `MODIFIED` 的正当用途；散文所在章节的整体消失仍被章节级 ID（`SXX` / 节号）守恒抓住，最严重的条目级 / 章节级丢失形态均在门内。散文的「不得隐式删除」保留为 spec 契约与 change-writer / merge-executor 行为规范。

#### 2.33.4 显式删除的两种形态（REMOVED 语义零改动）

| 意图 | 写法 | merge 执行语义 |
|------|------|----------------|
| 删除整个章节 | `## REMOVED — <唯一章节锚>`，块内说明删除原因（建议同时列出该节 ID 供审计） | **既有语义不变**：删除锚定章节全节；该节全部既有结构化 ID 视为随章节显式删除，守恒不再另行要求点名 |
| 删除章节内部分条目 | `## MODIFIED — <唯一章节锚>`（携带删除后剩余的**全量**内容）**+** `## REMOVED-ITEMS — <同一章节锚>`（逐行点名被删 ID：`- <ID> — <删除原因>`） | **REMOVED-ITEMS 是纯声明性标记**：merge / merge-executor **不据其执行任何编辑**——物质变更完全由 MODIFIED 块的整节替换完成；REMOVED-ITEMS 仅作为守恒判据的点名采信来源与审计记录 |

- 这样设计使「部分删除」**无需新的合并操作语义**：整节替换（MODIFIED）本就确定性地物化了删除结果，REMOVED-ITEMS 只回答「这些 ID 的消失是否显式授权」。`ADDED / MODIFIED / REMOVED` 三标记基本语义保持零改动（提案非目标成立）。
- 约束：REMOVED-ITEMS 块必须与同锚 MODIFIED 块**成对出现**（有点名而无对应 MODIFIED → 点名无物质载体，判 `delta_implicit_id_removal` 的对偶缺陷，fix_hint 提示补 MODIFIED 块）；点名行固定语法每行 `- <ID> — <删除原因>`，仅散文提及不构成点名。
- L4（段标记与脱模板）扩展承认 `REMOVED-ITEMS` 为合法段标记；仅含 REMOVED-ITEMS 而无 ADDED/MODIFIED/REMOVED 的 delta 仍判非法（无物质变更载体）。

#### 2.33.5 两道点数

| 道次 | 执行者 | 时机 | 拦截目标 | 失败后果 |
|------|--------|------|----------|----------|
| 事前点数（主门） | 确定性 CLI（`cli/src/lib/change-lint.ts` 单点判据） | change-lint L8（产出点）与 `openlogos merge`（消费点，打包调用同一函数） | delta 写错（隐式删除 / 锚不可解析 / 点名越界） | lint exit 2；merge 拒绝生成 MERGE_PROMPT（与模板骨架拒绝同级、非零退出） |
| 事后点数（兜底自检） | merge-executor（AI） | 合并落盘后、写 `SPEC_MERGED` 前 | delta 合法但 AI 合并执行出错 | 报告差异并暂停，不写 `SPEC_MERGED` |

事后点数公式（按结构化口径逐文档清点）：合并后主文档实际结构化 ID 集合 == 合并前 − REMOVED 整节 ID − REMOVED-ITEMS 点名 + delta 新增。

- 遵守既有不变量：lint 与 merge **共享同一批判据函数**（单一事实源，严禁第二份判据）。
- 新增 violation code `delta_implicit_id_removal`、`delta_removed_unknown_id`、`delta_section_anchor_unresolvable` 扩册进 `ChangeLintViolationCode` 闭合枚举（详见 `spec/cli-json-output.md` §3.15）。
- 零回归：L1–L7 行为、合法 delta 的 merge 消费行为、三标记基本语义均不变。

#### 2.33.6 archive 审计定位（audit-only 契约）

- **提案一旦归档，其内容仅供审计**：`logos/changes/archive/` 不是任何规格内容的事实源。
- **resources 自足性**：所有「当前有效」的规格内容必须存在于 `logos/resources/`（方法论规范在根 `spec/`、Skill 在根 `skills/`）；任何流程、Skill、CLI 均不得依赖读取 archive 内容。
- **可删除**：archive 过期后可整体或部分删除，删除不得损失任何当前有效信息；`MERGE_PROMPT.md` 等纯派生物由「全部可删」覆盖，无需单独分类。
- 守恒门（2.33.1–2.33.5）是本契约的机器保障：条目退出 resources 只能显式发生并留有 REMOVED / REMOVED-ITEMS 记录，「resources 自足」从口号变为可验证性质。
- 权威文字声明落 `spec/change-management.md` 与 `spec/directory-convention.md`（随本提案 delta 产出）。


## 三、功能验收摘要

### S01
初始化后必须生成完整目录、配置和 AI 指令文件；其中 `logos/resources/reference/` 必须默认包含 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录。若根目录已存在 `AGENTS.md` / `CLAUDE.md` 或大小写变体，OpenLogos 必须按 managed block 合并策略写入自身托管片段，保留用户自定义配置。

### S05
next 必须输出最可执行建议，而不是多条并列建议；存在活跃提案时，next 必须优先读取提案级部署决策。无需部署的提案在 verify PASS 后建议 archive；需要部署的提案在 verify PASS 后建议由用户明确授权部署；部署决策冲突时建议修正 proposal / tasks，不建议部署、smoke 或归档。

### S08
sync 必须同时处理 AI 资产和资源索引。刷新 `AGENTS.md` / `CLAUDE.md` 时只能替换 OpenLogos 托管片段，不得覆盖托管片段外用户内容。

### S09
change/merge/archive 必须构成闭环；提案填写阶段必须同步形成部署影响判断。`proposal.md` 声明无需部署时，`tasks.md` 不得出现 `[deploy]` section；声明需要部署时，必须有 `[deploy]` section，并在 delta 阶段补齐部署方案与 smoke 影响。AI 生成 proposal/tasks 后必须先做一致性自检，自检失败不得进入 delta-writing。

**Windows 外部归档 watcher 握手（win32-archive-watcher-handshake）**：在 Windows 上，`openlogos archive` 在 rename 前必须与所有「未过期、projectId 匹配、capabilities 含 prepare」的活跃 RunLogos 实例完成有界文件协议握手，等其释放监听句柄后再 rename（详见 §2.31）。握手只负责释放句柄，不改变归档资格、授权、verify、smoke、guard 删除时机、归档目录命名等既有规则。快照为空（未装/未运行/未监听）时走既有 rename 快路径、不引入等待；ACK 超时、实例 failed、遇不可协调监听者（旧版持句柄致 EPERM、capabilities 不足、未知高版本）均 fail-closed：不 rename、不动 guard、不自动重试。**非 Windows 平台完全不启用本协议。**

### S11
status 必须显示阶段进度、活跃变更、提案级部署决策、部署进度摘要和下一步建议。JSON 输出必须暴露部署决策字段、部署进度摘要和任务文档入口，供 RunLogos 面板判断是否展示部署按钮、smoke 按钮和归档按钮。`deployment_decision_conflict=true` 时必须展示为阻塞态。

### S13
verify 必须关联测试用例与运行结果，并负责在读取结果前触发配置的测试预跑命令。若配置了 `regression_command` 与 `incremental_command`，verify 必须按顺序执行并合并结果；若配置了 `verify.sandbox_mode`，预跑命令必须通过沙箱执行器运行，并在 JSON 输出中暴露 `sandbox` 诊断：写入审计豁免沙箱内一次性依赖目录（规范化后存在完整路径段严格等于 `node_modules`，见 §2.9 依赖目录豁免），豁免仅产生 `sandbox.infos` 信息级说明、不改变 `sandbox.status`、不进入 `pre_run.diagnostics`；沙箱复制与执行必须满足 §2.9 symlink 隔离与运行期写保护不变量——启动前逃逸链接按无法隔离处理，运行期由 OS 级写保护在写入发生前阻断（含运行期新建/改写的链接），写保护不可用时 `always` 失败、`auto` 告警降级；白名单结果文件采用定点采集回收，位于 `node_modules` 下亦不丢失。若覆盖不足且无预跑配置，必须诊断可能只运行了局部测试，并给出配置建议。若活跃提案新增或修改 smoke 用例，verify 或 code completion gate 还必须执行 smoke 覆盖预检，提前发现 smoke runner/reporter 缺失，避免问题延迟到部署后暴露。

### S14
launch 必须检查验收、部署和 smoke 门禁。切换 launched 后重新生成 AI 指令与策略时，只能更新 OpenLogos 托管片段，必须保留用户已有根指令配置。

### S15
SQL 注释解析必须保留表与字段元数据。

### S16
JSON 输出必须与文本输出共享同一事实源。`openlogos verify --format json` 必须暴露预跑命令执行状态、阶段结果路径、合并策略、沙箱执行状态、覆盖不足诊断与修复建议，供 RunLogos 展示，不要求客户端复刻测试编排逻辑。`openlogos smoke --format json` 必须暴露 smoke 门禁指标与沙箱执行状态。

### S17
模块增删改必须同步 YAML 与引用。

**YAML 解析错误分层与写路径防护（fix-module-cmd-yaml-error-handling）**：
- **统一读取路径**：`module` 命令族（list / add / rename / remove / set-product-type）读取 `logos-project.yaml` 必须走 `lib/project-yaml` 的恢复读取（严格解析失败时 AST 恢复 + `yaml_diagnostics`），与 `status` / `next` / `verify` / `feature` 同一口径；禁止本地简化读取把解析异常静默折叠为空对象。
- **错误分层，禁止折叠**：解析失败且无法恢复出 modules → 独立错误码 `PROJECT_YAML_UNPARSABLE`（附解析器原始错误与行号），绝不折叠为 `MODULE_NOT_FOUND`；`MODULE_NOT_FOUND` 仅在「yaml 正常解析或已恢复出 modules，且 modules 中确实没有该 id」时使用。恢复态（`parse_status: recovered`）下 `module list` 正常返回恢复出的 modules，JSON envelope 附可选 `yaml_diagnostics` 字段（口径与 `status` 一致）。
- **降级态写防护（数据不摧毁不变量）**：本次读取走过恢复路径或解析失败时，写命令一律拒绝写回，报独立错误码 `PROJECT_YAML_DEGRADED_WRITE_REFUSED` 并提示先修复 yaml；任何降级态下写命令执行前后 `logos-project.yaml` 文件字节必须保持不变——绝不把恢复态或空对象序列化落盘。

### S18
resource_index 必须能反向索引当前真相源。

### S19
smoke 必须验证部署后环境的最小可用链路，但只在提案级 `smoke_required: true` 且部署完成后进入。部署进度摘要仅能来自 `tasks.md` 的 `[deploy]` section，不能把 `[code]` section 误当作部署进度。若配置了 `smoke.sandbox_mode` 且存在 `smoke.command`，CLI 必须通过沙箱执行器运行 smoke 命令，并在文本与 JSON 输出中暴露沙箱诊断；沙箱写入审计豁免沙箱内一次性依赖目录（规范化后存在完整路径段严格等于 `node_modules`，见 §2.9 依赖目录豁免，与 verify 共享同一执行器语义），豁免说明走 `sandbox.infos` 信息级通道；symlink 隔离与运行期写保护不变量（含能力分层）与白名单定点采集回收同样适用。若 smoke 用例来自当前提案新增或修改，`openlogos smoke` 必须能区分 runner 缺失、reporter 缺失与用例 uncovered，并在 JSON 中暴露诊断码。

### S20
adopt 后必须生成完整 `logos/` 目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md`、`CLAUDE.md`、`logos/spec/` 和所选 AI tools 的 Skills / 插件 / 命令资产；生成的模块标记为 `bootstrap: adopted` 与 `lifecycle: launched`；`logos/resources/reference/` 必须默认包含 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录；同时应为可识别测试栈写入 verify 预跑配置与推荐沙箱配置，无法推断时输出 TODO。若存量项目已有 `AGENTS.md` / `CLAUDE.md` 或大小写变体，adopt 必须合并写入 OpenLogos 托管片段并保留用户自定义配置。`status` 必须将 Initial 文档基线显示为「已跳过（存量项目接入）」；`next` 必须输出补文档引导；`launch` 必须豁免 Initial 文档门禁。目录已存在 `logos/logos.config.json` 时必须拒绝重复执行并报错。历史 `bootstrap: skipped` 项目必须保持兼容。

### S21
`deploy-done` 必须让 `VERIFY_PASS → ready-to-deploy → ready-to-smoke/deploy-done` 的状态流转由 CLI 统一管理。`DEPLOY_DONE` 与 `[deploy]` 任务勾选必须保持同步；重新部署后必须清理旧 smoke 结论。

### S22
`flow show` 必须能从包内内置模板加载 raw flow，并在 `--resolved` 时正确应用项目 overlay 的 `skip` / `add` / `modify` / `reorder` 四种操作（按 node id strategic-merge）。`@vN` 版本不匹配必须告警而非静默；overlay schema 非法必须报错而非输出半成品。`--format json` 必须暴露 `lifecycle`、`resolved`、`flow`、`overlay_applied`、`builtin_version`、`warnings[]`。本能力**不得改变** `status` / `next` 既有行为。

### S23
`watch` 必须以 `status` 同一派生数据源（`collectStatusData`）实时输出：**启动先输出一次初始快照**，之后**仅在 `data` 深比较发生变化时**输出，每条携带 `seq` / `timestamp`；必须继承 `--module`；`--interval` 默认 2s；`--format json` 输出 JSON 流，文本模式变化时重渲染；Ctrl-C 优雅退出；全程只读无副作用；项目未初始化报 `PROJECT_NOT_INITIALIZED`。

### S24
`next --auto` 必须只对 launched 现有人类停顿点对应 gate 生效：可跳门 `ready-to-delta`（`plan-exit`）/ `ready-to-merge`（`spec-exit`）/ `ready-to-implement`（`slice-exit`）/ `ready-to-deploy`（`deliver-entry`）均 `skippable:true`、auto 下放行并向 `GATE_AUTO_PASSED` JSONL 追加 `{gate_id, proposal_step, timestamp}`；`gate:implement:loop-exhausted`（默认 `skippable:false`）保持人类停顿；`ready-to-smoke` 不涉及。plan 门与 slice 门放行均仅审计、不推进状态。部署放行依据为本次响应 `gate_auto_passed=true`，历史审计行不构成授权。重复 `--auto` 必须追加多行（不去重）。**默认 `next`（无 `--auto`）与 `status` 必须忽略 `GATE_AUTO_PASSED`、绝不因其越过 gate**，由 golden 锁定 auto/gate 字段。

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
launched `implement` 默认以切片循环推进：切片来自 `tasks.md` `[code]` 的顶层 checkbox，缩进 checkbox 是所属切片的内部子任务。收敛 = 全部父切片勾选 ∧ 全部子任务 checkbox 勾选 ∧ 末轮测试绿（`code_slices_green`），空 `[code]` 退化 `tests_green`。`next` 透出当前未完成切片（`next_node.slice` + `slice_state`），并在存在子任务时同步透出 `slice_state.current_children`、`slice_state.current_unchecked_children` 与 `next_node.slice_children`；`verify` 全量回归并追加可带 `slice` 的 `LOOP_ITERS`；达 `max_iters:30` 未达成升级 `gate:implement:loop-exhausted`（`skippable:false`）。切片提示语义为"下一个未完成切片"，回归修复目标由全量 verify 输出决定、归宿主判。initial 多模块不支持。若切片对应的规格变更新增或修改 smoke 用例，该切片必须同步完成 smoke runner/reporter/dispatcher 接入后才能勾选。

### S32

launched 含代码提案在 spec-complete 后必须进入独立的 `slice` 子流程（`when: code_required`）：`plan-slices` 节点由 `slice-planner` 对**已完成 spec-complete 的规格 + 真实 `UT/ST/SMOKE` ID**划分 `[code]` 切片，内置六维打分 + 垂直/横向判别器 + 删后续证伪门 + 逃生口。纯代码提案无 `[delta]` 时不进入 `write-delta`，但必须通过 no-delta merge 写入 `SPEC_MERGED` 后才可进入 `plan-slices`。缺 spec-complete 或缺真实测试 ID 时，`next/status` 必须返回结构化阻塞，不得派发 `slice-planner`。

### S33
`adopt` 接入后必须写入 `baseline_seed_state: required` 并衔接逆向建基线：AI 会话/driver 检测该状态后派发 `brownfield-adopter` 产出**种子基线**（system-map + 场景候选清单，每份含 `## 逆向基线来源` 与 `candidates[]`：`verified: false`、provenance 派生为 `reverse-engineered`），经 `openlogos baseline-seed commit` 由 CLI 计算 `partial`→`seeded`；CLI 本身绝不启动 AI、不声称基线已建立，能力缺失时降级输出可复制提示并保持 `required`。覆盖率采 tombstone 分母法不虚增；存量 provenance 迁移保守逐产物、缺章节标 `unknown`/`legacy-unclassified`、不伪造不降级。

### S34
feature 是 module 与 scenario 之间的**可选轻量分组层**：由 AI 维护 `feature_counter`/`features[]`/`scenario.feature`，CLI 只读消费。`status`/`next` 输出 `features` 当且仅当 module 有 ≥1 个注册 feature **或**有 ≥1 个场景带 `feature` 键（每个注册 feature，空成员为 `scenarios:[]`，末位 `__ungrouped__` 仅当有未归属/降级场景）；仅在 module 既无注册 feature 且无场景带 `feature` 键时省略字段——**未知/跨 module 引用一定进入 `__ungrouped__`、不被省略（delta-F10）**。`feature list` 为专用分组视图，module 有场景无注册 feature 时返回 `[{__ungrouped__}]`，`[]` 仅用于真正空 module。`openlogos feature list` 只读呈现分组与成员列表 `scenarios:[{id,name}]`（成员列表与 phase 无关，不复用依附 phase 的 `scenario_coverage`）；未注册 module 报 `MODULE_NOT_FOUND`。`openlogos feature-backfill` 只生成 AI 回填 prompt（打印 `prompt_path`）、不改 yaml、幂等；缺 `feature_counter.next_id` 时默认 `?? 1`（首次回填从 F01 起）。**feature-backfill 纳入逆向候选（feature-backfill-brownfield，见 2.29.1）**：生成 prompt 时复用 S33 provenance 只读入口一并纳入逆向场景候选（标注 verified:false / 未进 scenarios[]），AI 回写时登记进 `scenarios[]` 并分配 feature 但**不改 provenance verified**；`--format json` 增 `baseline_candidates_total`；status/next 仍只读 `scenarios[]`、adopted 项目回写前零漂移。`scenario.feature` 缺失/未知/跨 module 三态一律降级为"未分组"、不报错。**条件版本（delta-F1=B）**：`modules[].features` 属 minor 扩展；`contract.version` 仅在响应含 `features` 时升 `1.1.0`，纯 pre-feature 响应保持 `1.0.0`、**逐字节完全不变**；两版 schema 并存、`features`⟺`1.1.0`。

## 自动 driver 完成回报韧性

### 功能目标

OpenLogos 的 CLI JSON 输出、验收报告与测试 reporter 必须共同形成可被 RunLogos driver 消费的证据链。driver 在收到 agent 的完成回报后，应能基于 OpenLogos 输出判断该回报属于局部完成、需补 artifact、需 repair、需重派，还是必须 hard block。

### 完成回报状态

OpenLogos / driver 的完成回报校验至少区分以下结果：

| 状态 | 含义 | 建议下一步 |
|---|---|---|
| `slice_done` | 当前切片的业务代码、UT/ST、reporter、必要 fixture/golden 已满足 | 继续下一切片或全量 verify |
| `slice_done_global_verify_failed` | 当前切片局部完成，但全量 verify 仍失败 | 派生 repair / code，携带失败测试 |
| `slice_incomplete` | 当前切片合同未满足 | 重派当前切片或补缺失项 |
| `invalid_done_claim` | agent 声明与磁盘事实明显不符 | 要求更正 artifacts 或重派 |
| `no_progress` | 无产物、无测试、无状态推进 | 消耗 retry 预算，必要时升级 |

### 失败原因枚举

`claimed-done-but-unverified` 不应作为唯一失败码。机器输出应细分为：

- `artifact-missing`
- `artifact-out-of-scope`
- `focused-tests-missing`
- `reporter-missing`
- `global-verify-failed`
- `driver-cannot-validate-artifacts`
- `no-progress`

### 结构化 block

block / escalated 必须包含：

```json
{
  "reason": "global-verify-failed",
  "failed_tests": ["UT-S05-10c"],
  "validated_artifacts": ["cli/src/commands/next.ts"],
  "missing_artifacts": [],
  "suggested_next_node": "code",
  "human_action_required": false
}
```

`human_action_required=false` 表示无人值守模式可继续派 repair / code。只有需要人类判断产品取舍、授权高危门、或硬红线不可自动跨越时，该字段才为 `true`。

### 兼容要求

- 半自动模式仍保留人类确认点，不因本能力自动执行 merge / verify / deploy / smoke / archive。
- `next --auto` 模式下，用户已有 standing 授权；可恢复失败应尽量进入自动 repair，而不是直接 hard block。
- `gate:implement:loop-exhausted` 仍是硬红线，不因本能力默认放行未通过测试的代码。
