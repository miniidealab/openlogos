---
schema: "runlogos/review@1"
slug: "fix-sandbox-node-modules-write-audit"
node: "delta"
round: 2
reviewer:
  agent: "Codex-对抗式评审"
dispatch_id: "drv-drv-ms8j4t5t-f62l-review-review-23a169"
review_mode: "full-fallback"
verdict: "BLOCK"
summary: "F2、F3、F4 已闭环，但 F1 仍只约束复制时已有 symlink，未阻止命令运行期新建或改写逃逸链接，故继续阻断。"
findings:
  - id: "F1"
    severity: "high"
    category: "risk"
    title: "symlink 修复仅覆盖复制时拓扑，运行期新建或改写链接仍可逃逸"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:17-24（仅规定复制时保持字面量、复制后校验，随后快照整段跳过）；deltas/test/core-S13-test-cases.md:14-15（仅覆盖复制前已存在链接）；proposal.md:64（仍声称恶意或异常篡改不会离开沙箱）"
    status: "insisted"
  - id: "F2"
    severity: "high"
    category: "consistency"
    title: "既有 diagnostics 契约无法表达所要求的信息级说明"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:25,31,36；deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md:29；deltas/test/core-S13-test-cases.md:11,22；deltas/test/core-S19-test-cases.md:11"
    status: "resolved"
  - id: "F3"
    severity: "high"
    category: "correctness"
    title: "跳过 node_modules 快照与配置结果文件必须回收的规则互相冲突"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:15,23-24；deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md:14,29；deltas/test/core-S13-test-cases.md:16；deltas/test/core-S19-test-cases.md:12"
    status: "resolved"
  - id: "F4"
    severity: "high"
    category: "spec-gap"
    title: "安全豁免未锁定 node_modules 的精确路径段边界"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:22,26；deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md:22,28；deltas/test/core-S13-test-cases.md:12"
    status: "resolved"
---

# Delta 第 2 轮对抗式复审

本轮逐条复核 R1 triage 对 F1–F4 的 `fixed` 声明。`openlogos change-lint --slug fix-sandbox-node-modules-write-audit --format json` 通过；F2、F3、F4 已形成明确契约与对应测试证据，可关闭。F1 的修订只处理命令启动前已经存在的 symlink，仍未覆盖运行期链接拓扑变化，因此本轮裁决为 **BLOCK**。

## F1：symlink 修复仅覆盖复制时拓扑，运行期新建或改写链接仍可逃逸

**状态：insisted；严重性：high。**

R1 triage 新增的两道措施——复制时保留 symlink 目标字面量、复制完成后执行 realpath containment——能够修复 `cpSync` 把已有相对链接改写为原 workspace 绝对路径的问题，但检查时点只在命令运行之前。功能规格随后要求基线与命令后快照都整目录跳过命中豁免规则的 `node_modules`。

任意预跑或 smoke 命令仍可在通过复制后校验之后执行以下序列：删除或新建 `node_modules/escape`，令其指向原 workspace 或其他沙箱外路径，再经该链接写文件。该写入发生时已经越过唯一一次 containment 检查；命令后快照又不会进入 `node_modules`，因此既无法阻止，也不会进入非白名单 diff。即使事后再检查链接，原 workspace 已经被修改。该路径不只适用于刻意攻击：本提案要容纳的 install/repair 本身就可能重建依赖 symlink，且复制进沙箱的依赖元数据含原项目路径。

本机临时目录复现也验证了这一残留：先用 `verbatimSymlinks: true` 完成副本并视为已通过预检查，再在副本的 `node_modules` 下新建指向源目录的绝对 symlink，经该链接写入后，源目录哨兵文件随即改变；复现结果为 `source_changed=true`，且执行前不存在逃逸链接。

现有 UT-S13-50 仅覆盖复制前已有的内部相对链接，UT-S13-51 仅覆盖复制前已有的逃逸链接；两者都不能证伪运行期新建或 retarget 的逃逸。与此同时，提案仍明确声称即使测试命令“恶意 / 异常地篡改”沙箱内 `node_modules`，symlink 不变量也能保证写入不会离开沙箱，这与当前仅一次的预执行检查自相矛盾。

**建议修法：**规格必须增加运行期不可逃逸的不变量，并由可执行机制保证，而不是仅做命令前静态扫描。可选方向包括让子进程在文件系统层无法解析到沙箱 workspace 之外，或采用其他能在写入发生前阻断动态/改写 symlink 的等价隔离策略；仅在命令后复查不能满足“原 workspace 字节不变”。补充用例：命令运行期间在 `node_modules` 下新建绝对逃逸链接，以及把已通过检查的内部链接 retarget 到原 workspace，随后尝试写入；`always` 必须在原 workspace 零改动的前提下失败，`auto` 必须按无法隔离语义告警，且不得以依赖目录豁免静默通过。

## F2：既有 diagnostics 契约无法表达所要求的信息级说明

**状态：resolved；严重性：high。**

修订已撤销“JSON 结构不变”的冲突约束，新增向后兼容的可选 `sandbox.infos: string[]`，并明确豁免说明不得进入 `sandbox.diagnostics` 或 `pre_run.diagnostics`、文本以 `ℹ️` 全程只渲染一次、不得使用 `⚠️`、不改变 `sandbox.status`。S13 EX-3.3 与 S19 EX-4.4 已同步，UT-S13-47、ST-S13-14、UT-S19-08 也锁定 JSON 分类、文本级别和不重复展示。R1 的不可表达与固定警告问题已消除，无需追加修法。

## F3：跳过 node_modules 快照与配置结果文件必须回收的规则互相冲突

**状态：resolved；严重性：high。**

修订已明确“白名单回收优先于豁免”，并把 copy-back 改为对白名单路径定点采集、存在即回收，不再依赖快照 diff。S13 步骤与 EX-3.3 已同步；UT-S13-52、UT-S19-09 分别覆盖 verify 与 smoke 的结果路径位于 `node_modules` 下仍能回收。原先同一路径同时被要求“必须回收”和“永不回收”的矛盾已解除，无需追加修法。

## F4：安全豁免未锁定 node_modules 的精确路径段边界

**状态：resolved；严重性：high。**

修订已将规则收紧为规范化并统一分隔符后，至少一个完整路径段严格等于 `node_modules`；同时明确禁止子串、前缀和后缀匹配。S13/S19 场景措辞已同步，UT-S13-48 覆盖 `node_modules-cache`、`my-node_modules`、`node_modules.txt` 及 Windows 分隔符归一化，并锁定 `always`/`auto` 的原有阻断语义。R1 的过宽匹配风险已闭环，无需追加修法。
