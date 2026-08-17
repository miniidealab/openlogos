# 变更提案：fix-scenario-create-completeness-contract

> module: core | created: 2026-08-17

## 变更原因

`logos/resources/reference/bug-report-scenario-create-completeness-contract-mismatch.md` 记录了场景 CREATE 完整性校验与仓库文档契约不一致的问题：语义完整的 `## 主流程` 加编号步骤会被误判为缺少“步骤”，而普通散文只要偶然包含“步骤”二字就可能通过。

当前根因位于 `cli/src/lib/baseline-closure.ts`：`createCompletenessProblems()` 只对整段文本执行宽松正则，没有先解析 Markdown 权威结构，也没有验证步骤列表、Mermaid 时序图、异常/边界与追溯章节的实际内容。现有 `cli/test/s39-baseline-on-touch.test.ts` 只覆盖 `## 主路径步骤`，没有覆盖 `## 主流程` 和散文误命中的反例，因此测试全绿不能证明该缺陷已修复。

## 变更类型

需求级缺陷修复。校验器的用户可见行为、方法论契约、生成 Skill 和验收用例需要同步调整。

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 中 S39 的 CREATE 完整性与验收条件。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` 中 F04/S39 的 baseline-on-touch 规则。
- 影响的架构文档：`logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md` 中 CREATE 完整性校验边界。
- 影响的业务场景：S39；补齐缺失的 `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md`。
- 影响的方法论规格：`spec/baseline-closure.md`，以及承载同一合并门禁合同的 `spec/change-management.md`。
- 影响的 Skill：`skills/scenario-architect/SKILL.md` 与 `skills/change-writer/SKILL.md`；`logos/skills/` 仅作为同步产物，不直接作为 delta 目标。
- 影响的测试规格：`logos/resources/test/core-S39-test-cases.md`，并新增对应 CLI UT/ST 覆盖。
- 影响的 API：无；本次只调整本地 CLI 对 Markdown delta 的校验，不改变 HTTP/RPC/消息接口。
- 影响的 DB 表：无；不新增持久化结构、迁移或数据写入。
- 影响的编排测试：无；API 维度为 SKIP，跨进程合并行为由 CLI 场景测试覆盖。
- 影响的实现：预期修改 `cli/src/lib/baseline-closure.ts` 及相关测试；若复用现有 Markdown 权威区扫描能力需要提取小型共享解析器，文件边界在实现阶段按规格确定。

## 部署影响

- 是否需要部署：是
- 部署原因：用户已在 C01 确认对 CLI 产物执行本机真实安装与 smoke，避免修复只在源码测试入口生效。
- 影响环境：当前开发机的 npm 全局 OpenLogos 环境，不包含公开发布或生产环境。
- 是否涉及数据迁移：否
- 是否需要回滚预案：是
- 回滚预案：部署前保留当前 `0.13.26` 安装包与版本证据，失败时恢复该版本。
- 是否需要 smoke：是
- smoke 范围：至少验证合法 `主流程` 可通过、散文误命中会失败、缺少真实步骤的 merge 仍 fail-closed 且无副作用。

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 基线闭包计划

```yaml
baseline_closure:
  policy: on-touch-v1
  schema_version: 1
  unit: canonical-merge-target-path
  delta_cardinality: exactly-one-per-non-skip-target
  effective_view: merged-resources-plus-current-change-deltas
  ambiguity: block-before-existing-plan-exit
  standalone_baseline_required: false
  jit_confirmation: disabled
  touched_scenario_ids: [S39]
  targets:
    - category: requirement
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "本案修改 S39 场景 CREATE 完整性的用户可观察验收条件。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "F04/S39 需要定义结构化 Markdown 完整性、兼容标题和反误判行为。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "CREATE 校验从全文正则升级为权威 Markdown 结构解析，形成新的校验边界与 fail-closed 不变量。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S39]
      mode: CREATE
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"
      reason: "resource index 已登记 S39，但权威场景实现文件缺失；本次直接触达其 CREATE 完整性校验，须同案补齐完整时序。"
      evidence: ["target_absent: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md", "index_declares: S39"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "C01 已确认构建下一 patch npm 包并安装到当前开发机全局环境，需要成功证据和 0.13.26 回滚方案。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "decision: C01 deployment source=user"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/skills/change-writer/SKILL.md"
      reason: "change-writer 规划 CREATE 场景 delta 时必须生成与 CLI 验收一致的规范结构。"
      evidence: ["target_exists: skills/change-writer/SKILL.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/skills/scenario-architect/SKILL.md"
      reason: "scenario-architect 是场景文档生成者，需统一写入规范步骤标题和可结构化验收的正文。"
      evidence: ["target_exists: skills/scenario-architect/SKILL.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/spec/baseline-closure.md"
      reason: "该规格是 baseline-on-touch 与 CREATE 完整性合同的权威来源。"
      evidence: ["target_exists: spec/baseline-closure.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "变更合并门禁需引用同一结构化完整性合同并保持失败无副作用。"
      evidence: ["target_exists: spec/change-management.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/test/core-S39-test-cases.md"
      reason: "补充规范标题、兼容别名、反误判、Mermaid/章节内容及 merge 原子性的 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S39-test-cases.md"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "部署后需用全局安装包验证合法主流程、无效散文和失败无副作用。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "proposal: smoke_required=true", "decision: C01 deployment source=user"]
      missing_evidence: []
    - category: api
      scenario_ids: [S39]
      mode: SKIP
      delta_path: null
      reason: "本案只改变本地 CLI 对 Markdown 文件的校验，不引入 HTTP、RPC 或消息边界。"
      evidence: ["architecture: local CLI process boundary"]
      missing_evidence: []
    - category: database
      scenario_ids: [S39]
      mode: SKIP
      delta_path: null
      reason: "本案不新增数据库、持久化实体、DDL 或数据迁移。"
      evidence: ["data_impact: none"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S39]
      mode: SKIP
      delta_path: null
      reason: "API 维度为 SKIP，因此不需要 API 编排测试；跨进程合并行为由 CLI ST 覆盖。"
      evidence: ["api_disposition: SKIP"]
      missing_evidence: []
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: "只读取和校验 Markdown 规格，不迁移、删除或改写用户业务数据。"
  compatibility:
    status: none
    reason: "Bug 报告与既有仓库事实已唯一确定兼容策略：保留步骤说明、主路径步骤、主路径、主流程、正常流程等历史别名；仅拒绝依靠散文关键词误通过的无效文档。"
  security_privacy:
    status: none
    reason: "不新增权限、Secret、个人数据处理、网络访问或审计范围。"
  public_release:
    status: none
    reason: "本提案不授权 npm publish、Git tag、GitHub Release、官网发布、生产开放或 git push。"
  external_commitment:
    status: none
    reason: "不引入付费服务、供应商锁定、法律承诺或其他不可逆外部影响。"
decisions:
  - id: C01
    category: deployment
    question: "本次修复通过 verify 后，是否把构建出的 npm 包安装到当前开发机的全局 OpenLogos 环境，并执行安装态 smoke？"
    answer: "全局安装并执行：构建下一 patch npm tarball，安装到当前开发机的全局 OpenLogos 环境；部署前保留 0.13.26 安装包、哈希和回滚命令；以命令路径、版本/制品一致性及安装态 smoke 全通过作为成功证据。"
    rationale: "用户原文确认“全局安装并执行”，选择真实安装态验证，同时明确不授权任何公开发布。"
    source: user
    affects:
      - "下一 patch npm tarball"
      - "当前开发机 npm 全局 OpenLogos 环境"
      - "S39 安装态 smoke 与部署报告"
      - "0.13.26 回滚路径"
    rejected_options:
      - "仅在源码工作区执行测试，不安装全局包"
unresolved: []
defaults:
  - "规范写入统一使用“## 步骤说明”；读取端兼容步骤说明、主路径步骤、主路径、主流程、正常流程。"
  - "步骤章节必须唯一且包含至少 3 个非空有序列表项；围栏代码块、HTML 注释和普通散文中的关键词不计入完整性。"
  - "普通 bug 修复不新增长期 DXX 决策；RunLogos 的 write-delta lint 屏障由独立 companion change 处理。"
```

## 变更概述

### 1. 用 Markdown 结构替换全文关键词匹配

将场景 CREATE 完整性校验改为先扫描 Markdown 权威结构，再判断必需章节。扫描必须忽略 fenced code、HTML 注释和样例正文，避免示例文字或 Mermaid 代码中的关键词冒充章节。

步骤合同采用“规范写入、兼容读取”：生成端统一写 `## 步骤说明`；读取端兼容 `步骤说明`、`主路径步骤`、`主路径`、`主流程`、`正常流程`。步骤章节必须唯一，并包含至少 3 个非空有序列表项；只有散文出现“步骤”不能通过。

### 2. 加强场景正文的内容完整性

- Mermaid 必须来自有效的 fenced Mermaid 代码块，正文包含 `sequenceDiagram`，且至少有 2 个参与者和 1 条消息。
- 异常/边界章节必须存在且包含非空正文或列表，只有标题不能通过。
- 追溯章节必须存在且包含可验证的非空追溯内容，只有标题不能通过。
- 校验失败继续通过 change-lint/merge 门禁 fail-closed；失败合并不得留下资源写入、guard 变更或其他副作用。

### 3. 对齐生成 Skill 与权威规格

`scenario-architect` 输出规范章节标题和完整结构；`change-writer` 在规划 CREATE 场景 delta 时复用同一合同，避免 Agent 生成的文档与 CLI 验收规则分裂。`spec/baseline-closure.md` 作为完整性合同的权威来源，`spec/change-management.md` 只承载合并门禁所需的引用与行为说明。

### 4. 补齐回归测试

S39 的测试矩阵至少覆盖：规范标题通过、`主流程` 通过、全部历史别名通过、散文关键词失败、空步骤/无有序列表失败、伪 Mermaid 失败、空异常或追溯失败、完整场景通过、原始四份 delta fixture 不再误报，以及真正缺步骤时 merge 失败且无副作用。

## 非目标

- 不在本提案中修改 RunLogos；其普通 `write-delta` 完成屏障需要独立的 `enforce-write-delta-lint-barrier` companion change。
- 不改变 baseline-on-touch 的 target 分类、CREATE/MODIFY/SKIP 基数或合并原子性。
- 不新增 API、数据库、GUI、公开发布或生产部署。
- 在用户确认提案并授权 merge 前，不生成 delta、不修改源码。

## 验收条件

1. `## 步骤说明` 加完整编号列表通过 CREATE 完整性校验。
2. `## 主流程` 加完整编号列表通过，历史别名矩阵全部有明确兼容测试。
3. 无步骤章节、仅散文偶然包含“步骤”、空步骤章节或无有序列表均失败。
4. fenced code、HTML 注释或样例文本中的标题/关键词不计入权威结构。
5. Mermaid 仅在有效 Mermaid fence 中按结构验收；普通 fence 或散文中的 `sequenceDiagram` 不通过。
6. Mermaid 至少包含 2 个参与者和 1 条消息，否则失败。
7. 异常/边界与追溯章节存在但内容为空时失败，内容完整时通过。
8. bug 报告点名的四份历史场景 delta 不再因 `主流程` 被误报缺少步骤。
9. 真正缺少步骤结构的 CREATE delta 在 change-lint/merge 中继续失败，并证明合并无副作用。
10. `scenario-architect`、`change-writer`、方法论规格、需求/功能/架构/场景/test 文档使用同一完整性合同。
11. 所有新增 UT/ST 用例 ID 与 `logos/resources/test/core-S39-test-cases.md` 对齐，并由 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
12. 若 C01 选择本机部署，则安装态 smoke 通过且保留可执行的 `0.13.26` 回滚路径；任何公开发布仍需独立提案与用户授权。
