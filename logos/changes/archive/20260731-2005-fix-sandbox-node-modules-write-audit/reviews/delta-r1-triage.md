---
schema: runlogos/triage@1
slug: fix-sandbox-node-modules-write-audit
node: delta
round: 1
responder:
  agent: "Claude Fable 5 (change-writer)"
dispatch_id: drv-drv-ms8j4t5t-f62l-review-triage-a8e2d5
responses:
  - id: F1
    decision: fixed
    change_ref: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md（新增「symlink 隔离不变量」小节：保持链接目标字面量 + 复制后 realpath containment 校验，逃逸链接按无法隔离处理且不得进入豁免）；deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md（步骤说明第 4 步 + ADDED EX-3.4）；deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md（EX-4.4 引用同一不变量）；deltas/prd/1-product-requirements/core-01-requirements.md（S13/S19 WHEN 增补 symlink 逃逸情形）；deltas/test/core-S13-test-cases.md（新增 UT-S13-50 内部相对链接写入后原 workspace 字节不变、UT-S13-51 逃逸链接 always FAIL / auto 降级告警不静默豁免，正是正文要求的两类证据）"
    reason: "成立。已在本机实证复现正文论据：cpSync 默认（无 verbatimSymlinks）把相对 symlink 改写为指向原目录的绝对路径，经沙箱副本 node_modules/pkg 写入的文件实际落在原 workspace（scratchpad 复现脚本输出 written-through-link.txt 出现在源 packages/pkg）。按正文建议修法落规格与用例。"
  - id: F2
    decision: fixed
    change_ref: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md（可观测性改为新增可选字段 sandbox.infos: string[]，additive；说明不得入 diagnostics / pre_run.diagnostics，文本 ℹ️ 单次渲染，status 不受影响，cli-json-output.md 随代码阶段补字段定义）；两场景 delta EX-3.3 / EX-4.4 期望响应同步；deltas/test/core-S13-test-cases.md UT-S13-47 / ST-S13-14 与 deltas/test/core-S19-test-cases.md UT-S19-08 补齐 JSON 分类、文本级别与不重复展示断言；proposal.md 变更类型注明接口级成分（additive 字段）"
    reason: "成立。正文给出两个方向（结构不变 + 机器可判别分类规则，或显式 severity/独立 infos 通道），采纳其推荐的更稳妥方案：独立 infos 通道。原 delta「不改 JSON 结构」约束随之撤销，改为向后兼容的可选字段新增并同步 JSON 规格。"
  - id: F3
    decision: fixed
    change_ref: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md（新增「白名单回收采用定点采集」条款：copy-back 对白名单路径存在即拷回、不依赖快照 diff，白名单回收优先于豁免，快照跳过与结果回收互不影响）；deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md（步骤说明第 6 步同步）；deltas/test/core-S13-test-cases.md（新增 UT-S13-52：verify result_path 配置在 node_modules 下仍回收）；deltas/test/core-S19-test-cases.md（新增 UT-S19-09：smoke result_path 同）"
    reason: "成立。采纳正文推荐的「白名单回收优先」语义，并按建议为 verify 与 smoke 各补一个嵌套 node_modules 结果路径用例锁定语义；定点采集同时消除了原实现 copy-back 依赖 diff 的隐式耦合。"
  - id: F4
    decision: fixed
    change_ref: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md（新增「匹配规则（精确路径段边界）」条款：规范化 + 分隔符归一后，至少一个完整路径段严格等于 node_modules 才豁免，禁止子串/前缀/后缀匹配并列举近似名称反例）；两场景 delta EX-3.2 / EX-3.3 / EX-4.3 / EX-4.4 及需求 delta 措辞由「路径段含」收紧为「完整路径段严格等于」；deltas/test/core-S13-test-cases.md UT-S13-48 扩充负例（src/node_modules-cache/evil.txt、vendor/my-node_modules/data、node_modules.txt，分别锁定 always FAIL 与 auto warn）并保留 Windows 分隔符归一化证据"
    reason: "成立。原措辞「路径段含 node_modules」确实允许 includes 式过宽实现通过全部原用例。按正文建议修法逐点落实。"
---

# Delta 第 1 轮 triage 结论

4 条 finding 全部判定成立并按正文建议修法处置为 fixed。F1 的技术前提（cpSync 默认改写 symlink 目标导致穿透写入原 workspace）已在本机实证复现。修订涉及全部 6 份 delta 与 proposal.md / tasks.md 同步；`openlogos change-lint` 复跑通过。
