---
schema: "runlogos/review@1"
slug: "fix-sandbox-node-modules-write-audit"
node: "delta"
round: 3
reviewer:
  agent: "Codex-对抗式评审"
dispatch_id: "drv-drv-ms8j4t5t-f62l-review-review-88e91f"
review_mode: "full-fallback"
verdict: "PASS"
summary: "F1 已补齐运行期写前阻断、能力分层与动态 symlink 测试，F2、F3、F4 亦无回退，本轮全部关闭并放行。"
findings:
  - id: "F1"
    severity: "high"
    category: "risk"
    title: "symlink 修复仅覆盖复制时拓扑，运行期新建或改写链接仍可逃逸"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:17-20,32,37；deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md:11,31-37；deltas/test/core-S13-test-cases.md:17-19,34-36；proposal.md:56,64"
    status: "resolved"
  - id: "F2"
    severity: "high"
    category: "consistency"
    title: "既有 diagnostics 契约无法表达所要求的信息级说明"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:26,32,37；deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md:29；deltas/test/core-S13-test-cases.md:11,25,29；deltas/test/core-S19-test-cases.md:11"
    status: "resolved"
  - id: "F3"
    severity: "high"
    category: "correctness"
    title: "跳过 node_modules 快照与配置结果文件必须回收的规则互相冲突"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:15,24-25；deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md:14,29；deltas/test/core-S13-test-cases.md:16,37；deltas/test/core-S19-test-cases.md:12,17"
    status: "resolved"
  - id: "F4"
    severity: "high"
    category: "spec-gap"
    title: "安全豁免未锁定 node_modules 的精确路径段边界"
    location: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md:23,27；deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md:12,22,28；deltas/test/core-S13-test-cases.md:12,30"
    status: "resolved"
---

# Delta 第 3 轮对抗式复审

本轮先核对 R2 triage 对 F1 的 `fixed` 处置，再复查 F2–F4 是否发生回退。`openlogos change-lint --slug fix-sandbox-node-modules-write-audit --format json` 通过；4 条 finding 均已有明确契约与测试证据，未发现满足收敛期迟到采纳门槛的新缺陷，裁决为 **PASS**。

## F1：symlink 修复仅覆盖复制时拓扑，运行期新建或改写链接仍可逃逸

**状态：resolved；严重性：high。**

R2 的残留已被正面关闭。功能规格不再把启动前 containment 当作充分条件，而是明确写出：

- 启动前保留 symlink 原始目标字面量并检查已有链接；
- 命令执行期间必须由 OS 级文件系统写保护在写入发生前拒绝原 workspace 写入，且明确覆盖运行期新建和 retarget 的 symlink；
- 运行期写保护不可用时，`always` 失败，`auto` 仅能告警降级并披露残留风险；
- 命令后复查不能替代写前阻断。

S13 EX-3.4 已把启动前拓扑和运行期动态逃逸拆成独立触发/响应；UT-S13-53、UT-S13-54 分别锁定运行期新建绝对逃逸链接和 retarget，均要求原 workspace 字节零改动；UT-S13-55 锁定能力不可用时的 `always`/`auto` 分层。proposal 的权衡说明也已改为以运行期保护在位为安全前提，不再保留 R2 指出的无条件安全声明。原 finding 无具体残留，无需追加修法。

## F2：既有 diagnostics 契约无法表达所要求的信息级说明

**状态：resolved；严重性：high。**

复查未发现回退：`sandbox.infos: string[]` 仍是独立、向后兼容的信息通道；豁免说明不得进入 `sandbox.diagnostics` 或 `pre_run.diagnostics`，文本仅以 `ℹ️` 展示一次且不改变 `sandbox.status`。S13/S19 场景及 UT-S13-47、ST-S13-14、UT-S19-08 继续覆盖 JSON 分类、文本级别和不重复展示。无需追加修法。

## F3：跳过 node_modules 快照与配置结果文件必须回收的规则互相冲突

**状态：resolved；严重性：high。**

复查未发现回退：白名单回收继续采用定点采集，不依赖快照 diff，并明确优先于依赖目录豁免；S13 场景同步该顺序，UT-S13-52 与 UT-S19-09 分别覆盖 verify/smoke 结果路径位于 `node_modules` 下仍可回收。无需追加修法。

## F4：安全豁免未锁定 node_modules 的精确路径段边界

**状态：resolved；严重性：high。**

复查未发现回退：规则仍要求规范化并统一分隔符后，至少一个完整路径段严格等于 `node_modules`，禁止子串、前缀或后缀匹配；UT-S13-48 继续覆盖近似名称负例和 Windows 分隔符归一化。无需追加修法。
