---
schema: "runlogos/review@1"
slug: "fix-sandbox-node-modules-write-audit"
node: "delta"
round: 1
reviewer:
  agent: "Codex-对抗式评审"
dispatch_id: "drv-drv-ms8j4t5t-f62l-review-review-5b1527"
review_mode: "full"
verdict: "BLOCK"
summary: "Delta 结构合法，但 symlink 逃逸、信息级诊断不可表达、白名单回收冲突及路径匹配边界未锁定，会使豁免破坏 workspace 写保护或关键验收。"
findings:
  - id: "F1"
    severity: "high"
    category: "risk"
    title: "未定义 symlink 约束，node_modules 豁免可绕回真实 workspace"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:17-21；deltas/test/core-S13-test-cases.md:13,19"
    status: "open"
  - id: "F2"
    severity: "high"
    category: "consistency"
    title: "既有 diagnostics 契约无法表达所要求的信息级说明"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:21,27；deltas/test/core-S13-test-cases.md:11,19；deltas/test/core-S19-test-cases.md:11"
    status: "open"
  - id: "F3"
    severity: "high"
    category: "correctness"
    title: "跳过 node_modules 快照与配置结果文件必须回收的规则互相冲突"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:12-20；deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md:12-13"
    status: "open"
  - id: "F4"
    severity: "high"
    category: "spec-gap"
    title: "安全豁免未锁定 node_modules 的精确路径段边界"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:17,22；deltas/test/core-S13-test-cases.md:11-13"
    status: "open"
---

# Delta 第 1 轮对抗式评审

本轮裁决为 **BLOCK**。`openlogos change-lint --slug fix-sandbox-node-modules-write-audit --format json` 已通过，6 份 delta 的目录、段标记和任务映射均合法；阻断原因不是格式，而是豁免边界仍存在 4 项会破坏本次验收语义的高严重度缺陷。

## F1：未定义 symlink 约束，node_modules 豁免可绕回真实 workspace

**状态：open；严重性：high。**

功能规格把所有路径段为 `node_modules` 的对象视为“沙箱内一次性依赖目录”，并据此承诺这些写入不参与审计、从不回收到 workspace。这个前提只对真实复制进沙箱的普通目录成立，对 symlink 不成立。

当前执行器使用 `cpSync(normalizedRoot, sandboxProjectRoot, { recursive: true })` 复制 workspace，未启用 `verbatimSymlinks`，也没有复制后的 realpath containment 校验。Node 的默认复制语义会解析 symlink；例如 monorepo 常见的 `node_modules/pkg -> ../packages/pkg` 在副本中可能指回原 workspace 的 `packages/pkg`，外链依赖也可能继续指向沙箱外目录。此时命令经 `node_modules/pkg/**` 写入，实际修改的是原 workspace 或共享依赖存储。拟议快照又直接跳过 `node_modules`，现有快照对 symlink 本来也只记录链接本身，因此该越界写入不会被审计发现。

这直接反驳了本提案“写入永远不会污染真实 workspace”的安全依据，并违反 `sandbox_deny_workspace_write=true` 的核心验收。UT-S13-49 只覆盖嵌套普通目录，ST-S13-14 只覆盖 `.bin/*`，均没有证明 symlink 写入仍被约束在沙箱内。

**建议修法：**在依赖目录豁免之前补充 symlink 隔离不变量：复制后所有可经沙箱 workspace 到达的链接目标必须位于沙箱 workspace 内；内部相对链接应保持相对语义，逃逸链接必须按沙箱建立失败处理，不能进入豁免。实现可采用保留相对 symlink 并执行 realpath containment 校验，或其他等价的安全复制策略。测试至少增加两类证据：经 monorepo workspace-package symlink 写文件后原 workspace 字节不变；绝对或相对逃逸 symlink 在 `always` 下被阻断，而不是静默豁免。

## F2：既有 diagnostics 契约无法表达所要求的信息级说明

**状态：open；严重性：high。**

Delta 同时要求“固定信息级说明”和“JSON 契约结构不变，继续使用自由文本 `sandbox.diagnostics: string[]`”。现有契约没有单条诊断的 severity/code；verify 还会把所有 `sandbox.diagnostics` 无差别复制到 `pre_run.diagnostics`，文本输出对两处诊断均使用 `⚠️`。因此按当前 delta 直接实现后，几乎每个含 `node_modules` 的 JS 项目都会在成功 verify 时看到固定警告，verify 还可能重复展示同一句。这正是提案声称要消除的“固定告警训练用户忽略告警”，并不属于可观察的信息级行为。

新增用例只断言 `sandbox.status="pass"` 和数组中存在字符串，没有断言文本模式使用信息标识、没有重复展示，也没有给 RunLogos / CI 一个可区分“信息”与“问题诊断”的稳定信号。仅保持 status 为 pass 不能把一个被 UI 和消费方当作 warning 的条目变成信息级诊断。

**建议修法：**先在规格中选择可执行的诊断契约并与“不改 JSON 结构”的约束对齐。若坚持结构不变，至少需要定义稳定、机器可判别的分类规则以及 verify/smoke 文本渲染和 `pre_run.diagnostics` 传播规则，确保该说明只以 `ℹ️` 展示一次且不进入“问题诊断”；更稳妥的方案是为诊断增加显式 severity/code 或独立 infos 通道，并同步 JSON 规格。UT/ST 必须同时断言 JSON 分类、文本级别和不重复展示。

## F3：跳过 node_modules 快照与配置结果文件必须回收的规则互相冲突

**状态：open；严重性：high。**

功能规格一方面要求 verify 的 `result_path`、`regression_result_path`、`incremental_result_path` 与 smoke 的 `result_path` 始终作为白名单回收，另一方面规定快照遍历直接跳过全部 `node_modules`，并称“豁免路径从不回收”。现有配置 schema 只要求这些路径是项目根相对字符串，并未禁止 `node_modules/**`。因此合法配置如 `verify.result_path="node_modules/.cache/openlogos/test-results.jsonl"` 同时属于“必须回收的白名单”和“从不回收的豁免路径”，规格没有定义优先级。

这不是抽象歧义：当前执行器的 copy-back 只遍历快照 diff 得到的 `changedPaths`。若实现按 delta 跳过该目录，命令在沙箱中写出的白名单结果文件不会进入 diff，也就不会回收到原 workspace；verify 读到的仍是执行前清空的文件，最终可能报无结果或覆盖不足。它违反了 delta 自己声明的“copy-back 行为不变”。

**建议修法：**明确白名单与豁免的优先级。推荐“白名单回收优先”：`node_modules` 下除精确配置的结果/报告路径外不遍历、不审计，但白名单路径仍被定点采集和回收。若产品决定禁止结果路径落在 `node_modules`，则必须把它声明为配置约束和兼容性变化，并增加明确的配置错误，而不能静默丢结果。为 verify 与 smoke 各补一个嵌套 `node_modules` 结果路径用例，锁定所选语义。

## F4：安全豁免未锁定 node_modules 的精确路径段边界

**状态：open；严重性：high。**

Delta 使用“路径段含 `node_modules`”描述安全边界，但没有明确要求标准化后的某一完整 segment **等于** `node_modules`。新增三个 UT 都是正例；唯一负例 UT-S13-48 使用完全无关的 `src/evil.txt`。因此采用 `relPath.includes("node_modules")` 或 `segment.includes("node_modules")` 的过宽实现，也会通过全部新增用例，却会把 `src/node_modules-cache/evil.txt`、`vendor/my-node_modules/data` 等普通源码/资产目录错误豁免，违反“`node_modules` 之外语义一字不改”和“不开放通用 allow-path”的验收边界。

**建议修法：**把规则收紧为：先将相对路径规范化并统一分隔符，再仅当至少一个完整路径段严格等于 `node_modules` 时豁免；不得使用子串、前缀或后缀匹配。扩充 UT-S13-48，加入 `node_modules-cache`、`my-node_modules`、`node_modules.txt` 等近似名称，分别锁定 `always` FAIL 与 `auto` warn，并保留 Windows 分隔符归一化证据。
