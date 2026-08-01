---
schema: runlogos/triage@1
slug: fix-sandbox-node-modules-write-audit
node: delta
round: 2
responder:
  agent: "Claude Fable 5 (change-writer)"
dispatch_id: drv-drv-ms8j4t5t-f62l-review-triage-709144
responses:
  - id: F1
    decision: fixed
    change_ref: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md（「symlink 隔离不变量」升级为「symlink 隔离与运行期写保护不变量」：新增运行期不可逃逸核心不变量——含运行期新建/retarget 的链接——由 OS 级写保护在写入发生前于文件系统层阻断（macOS sandbox-exec 拒写原 workspace 子树 / Linux mount namespace 只读绑定 / 等价机制），并明确写「启动前一次性静态扫描不满足本不变量」「事后检查无法挽回」；新增能力分层：写保护不可用时 always FAIL、auto 继续沙箱执行但 warn 并披露残留风险，复用既有『无法启用写入保护』语义）；deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md（步骤第 4 步 + EX-3.4 扩展为『启动前拓扑 + 运行期动态逃逸』双触发条件，运行期期望响应要求任一模式原 workspace 字节不变、仅命令后复查不满足）；deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md（EX-4.4 同步共享执行器语义）；deltas/prd/1-product-requirements/core-01-requirements.md（S13/S19 WHEN 增补『无法启用运行期写保护』情形）；deltas/test/core-S13-test-cases.md（新增正文点名的用例：UT-S13-53 运行期新建绝对逃逸链接写入被阻断且原 workspace 零改动、UT-S13-54 retarget 已通过校验的内部链接后写入被阻断、UT-S13-55 写保护不可用时能力分层 always FAIL / auto warn）；proposal.md（③升级为运行期写保护不变量；权衡说明改为条件式表述，撤销与一次性预检查自相矛盾的『恶意篡改也不会离开沙箱』无条件声明，auto 降级档残留风险显式披露）"
    reason: "成立。正文论证与本机复现均确认：一次性启动前 containment 校验无法阻止命令运行期新建/改写链接后写入，命令后快照跳过 node_modules 使其既不被阻止也不进 diff，事后检查无法挽回。按正文建议修法落规格：以『写入发生前阻断』的可执行 OS 级机制承载运行期不变量，而非命令前静态扫描或命令后复查；补齐正文点名的两类运行期用例并加能力分层用例。"
---

# Delta 第 2 轮 triage 结论

F1（insisted）判定成立，处置为 fixed。核心修订：把 symlink 不变量从「启动前拓扑校验」升级为「启动前拓扑校验 + 运行期 OS 级写保护」双层——运行期新建或 retarget 的 symlink 经文件系统层写保护在写入发生前被阻断，任一模式下原 workspace 字节不变；写保护机制不可用时按能力分层处理（`always` 失败、`auto` 告警降级并披露残留风险），复用 spec 既有「无法启用写入保护」语义。proposal 中与一次性预检查自相矛盾的无条件安全声明已改为条件式表述。F2 / F3 / F4 本轮已由评审方判 resolved，无需动作。`openlogos change-lint` 复跑通过。
