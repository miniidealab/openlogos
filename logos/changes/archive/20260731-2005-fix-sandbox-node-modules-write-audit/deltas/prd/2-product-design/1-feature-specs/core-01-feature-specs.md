## MODIFIED — 2.9 verify / smoke 沙箱执行策略

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

## MODIFIED — 验收摘要 S13

### S13
verify 必须关联测试用例与运行结果，并负责在读取结果前触发配置的测试预跑命令。若配置了 `regression_command` 与 `incremental_command`，verify 必须按顺序执行并合并结果；若配置了 `verify.sandbox_mode`，预跑命令必须通过沙箱执行器运行，并在 JSON 输出中暴露 `sandbox` 诊断：写入审计豁免沙箱内一次性依赖目录（规范化后存在完整路径段严格等于 `node_modules`，见 §2.9 依赖目录豁免），豁免仅产生 `sandbox.infos` 信息级说明、不改变 `sandbox.status`、不进入 `pre_run.diagnostics`；沙箱复制与执行必须满足 §2.9 symlink 隔离与运行期写保护不变量——启动前逃逸链接按无法隔离处理，运行期由 OS 级写保护在写入发生前阻断（含运行期新建/改写的链接），写保护不可用时 `always` 失败、`auto` 告警降级；白名单结果文件采用定点采集回收，位于 `node_modules` 下亦不丢失。若覆盖不足且无预跑配置，必须诊断可能只运行了局部测试，并给出配置建议。若活跃提案新增或修改 smoke 用例，verify 或 code completion gate 还必须执行 smoke 覆盖预检，提前发现 smoke runner/reporter 缺失，避免问题延迟到部署后暴露。

## MODIFIED — 验收摘要 S19

### S19
smoke 必须验证部署后环境的最小可用链路，但只在提案级 `smoke_required: true` 且部署完成后进入。部署进度摘要仅能来自 `tasks.md` 的 `[deploy]` section，不能把 `[code]` section 误当作部署进度。若配置了 `smoke.sandbox_mode` 且存在 `smoke.command`，CLI 必须通过沙箱执行器运行 smoke 命令，并在文本与 JSON 输出中暴露沙箱诊断；沙箱写入审计豁免沙箱内一次性依赖目录（规范化后存在完整路径段严格等于 `node_modules`，见 §2.9 依赖目录豁免，与 verify 共享同一执行器语义），豁免说明走 `sandbox.infos` 信息级通道；symlink 隔离与运行期写保护不变量（含能力分层）与白名单定点采集回收同样适用。若 smoke 用例来自当前提案新增或修改，`openlogos smoke` 必须能区分 runner 缺失、reporter 缺失与用例 uncovered，并在 JSON 中暴露诊断码。
