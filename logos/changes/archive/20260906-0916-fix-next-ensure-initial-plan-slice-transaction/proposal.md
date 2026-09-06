# 变更提案：next 对 initial-plan 切片事务的问即建与投影输出

> module: core | created: 2026-09-06
> slug: fix-next-ensure-initial-plan-slice-transaction

## 变更原因

来源：runlogos 全自动 driver 生产实证（2026-09-06 排查定性）。消费方与本 CLI 的两条各自成立的契约拼在一起构成**鸡生蛋死锁**，使任何新提案在全自动流程中**首达 plan-slices 节点必然 blocked**：

1. **消费方契约（runlogos，adopt-openlogos-test-slice-transaction-authority 立约）**：派发 slice-planner **之前**，写域必须由 `openlogos next` 输出携带的 `slice_transaction` canonical 投影派生；投影缺失即 fail-closed（`slice-slot-projection-missing`），本地推导写域已作为 retired shadow source 删除、不得复活。消费方全代码无任何「打开事务」的调用路径——事务执行权归 OpenLogos 是双方共同立场。
2. **本 CLI 现状（0.14.22）**：initial-plan 事务为**懒创建**——`cli/src/commands/slice-transaction.ts:102` 仅在首次 `submit-content` 时 `createTestSliceTransaction`（注释自称「用即建」）；CLI 无 `open` 动作；创建前 `slice transaction status` 返回 `transaction: null`；`next` 仅在 **manifest-recovery** 分支（`cli/src/commands/next.ts:1011` `ensureManifestRecoveryTransaction`）ensure 并输出 `slice_transaction`，正常 ready-to-implement 路径既不创建也不输出。
3. **死锁与实证**：投影只有 slice-planner 提交内容后才存在，driver 没投影又拒绝派发 slice-planner。runlogos 仓连续 4 个提案（fix-trusted-commit-gitignored-artifact-paths 09-06 00:59、fix-driver-wait-state-observability、fix-review-dispatch-late-strong-evidence 09-06 04:29、fix-spec-commit-stale-state-selfheal 09-06 14:23）首达 plan-slices 全部 blocked 同一停点，每次靠人工代跑 slice-planner（submit-content 触发用即建）绕过，事务均在 blocked 后 1～5 分钟才出现。

根因定性：**事务「发证时机」与消费方「投影前置」错位**。恢复路径已确立正确先例——「恢复的执行权归 OpenLogos——此处创建或返回事务投影，而非仅返回一个建议节点」（next.ts:1004 注释原文）；initial-plan 正常路径缺同构语义。

用户决策（2026-09-06）：修复不止入仓——**发布 0.14.23 并本机全局部署**，runlogos 全自动链路经全局 CLI 刷新后真正解锁。本提案因此同时承载 0.14.23 候选发布：版本身份 bump、SMOKE-core-194 安装态验收、隔离矩阵、本机全局部署与正式 smoke。

## 变更类型
设计级

## 变更范围
- 影响的需求文档：`core-01-requirements.md`——S28 next 建议节点补「plan-slices 节点携带 canonical 事务投影」验收条件；S32 补 initial-plan 事务创建时机（问即建）验收；S19 补 0.14.23 候选发布要求。
- 影响的功能规格：`core-01-feature-specs.md`（新增 2.65：next 对 initial-plan 事务的 ensure 语义与投影输出、幂等与失败口径、与 recovery 分支及 submit-content 用即建的关系）。
- 影响的业务场景：S28（next-node 派生补 initial-plan ensure 分支时序）、S32（切片规划——事务创建时机前移为 next 问即建，submit-content 用即建降为幂等兜底）、S19（0.14.23 候选发布节）。
- 影响的根规范：`spec/test-slice-manifest.md`（initial-plan 事务创建时机补「next 问即建」合同）、`spec/cli-json-output.md`（next 输出在 ready-to-implement 携带 `slice_transaction` 的字段口径）。
- 影响的部署方案：`core-01-deployment-plan.md`（新增 0.14.23 本机全局部署方案章节）。
- 影响的 API / DB 表 / 编排测试：无。
- 影响的 smoke 测试：`test/smoke/core-smoke-test-cases.md`（新增 SMOKE-core-194）。

## 部署影响
- 是否需要部署：是
- 部署原因：用户决策（「捆绑发布 0.14.23 + 全局部署 + smoke」）——修复不发布则不生效：已安装的 0.14.22 全局 CLI 的 `next` 仍不输出 initial-plan 投影，runlogos 每个新提案首达 plan-slices 仍死锁需人工绕过。
- 影响环境：本机 npm 全局 prefix（`/opt/homebrew`）
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（固定回滚制品：0.14.22 tarball，SHA-256 `0bdcefb37a0743575d44c7645169c0c668bbcaaa22e206e7e209325f8a283ac1`）
- 是否需要 smoke：是（SMOKE-core-194）

## UI/UX 变更声明

```yaml
ui_impact: false            # 纯 CLI 项目，next 输出与事务创建时机变更无界面
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## Authority Impact

```yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: not_applicable
  evidence:
    - "事务的 owner/sole writer 语义零变化：test-slice 事务仍由 OpenLogos CLI 独占创建与推进（TEST_SLICE_TRANSACTION.json 唯一 writer 不变），本案仅把 initial-plan 创建时机从 submit-content 前移/复制到 next 问即建，与 recovery 分支既有 ensure 同构"
    - "next 输出的 slice_transaction 投影字段沿用 manifest-recovery 分支既有 schema（spec/cli-json-output.md 已成文），仅扩大出现场景，不新增第二事实源；消费方（runlogos）契约零改动即痊愈"
    - "无消费者依据文件扫描/mtime 重算决定的路径变化；0.14.23 候选身份链沿用既有单一发布机制（S19 candidate identity），SMOKE-core-194 为消费侧验收证据，不改变任何共享事实的 owner/writer"
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: 无业务数据面；事务文件为提案目录内 CLI 私有运行态，创建时机前移不改其 schema 与生命周期
  compatibility:
    status: none
    reason: next 输出仅在 ready-to-implement 场景「新增」slice_transaction 字段（recovery 分支已有同字段先例，消费方按字段存在性消费）；status/submit-content/seal/apply 行为逐项不变；submit-content 的用即建保留为幂等兜底，手动流程零回归
  security_privacy:
    status: none
    reason: 不新增权限面；事务创建为提案目录内文件写入，与既有 submit-content 创建同一写域
  public_release:
    status: none
    reason: 仅本机全局部署；不 npm publish、不 tag、不 GitHub Release、不 git push
  external_commitment:
    status: none
    reason: 对 runlogos 的投影前置契约本就是双方已立之约（adopt-openlogos-test-slice-transaction-authority），本案是履约而非新承诺
decisions:
  - id: C01
    category: deployment
    source: user
    question: next ensure 修复是否随本提案发布 0.14.23 到本机全局并 smoke？
    answer: 是——用户选择「捆绑发布 0.14.23 + 全局部署 + smoke（推荐）」（2026-09-06 会话决策）
    rationale: 修复不发布则不生效——已安装的 0.14.22 的 next 不输出 initial-plan 投影，runlogos 全自动每案首达 plan-slices 仍死锁；发布后全局 CLI 刷新即痊愈。目标环境=本机 npm 全局 prefix（/opt/homebrew），回滚制品固定 0.14.22 tarball（sha256 0bdcefb3…83ac1），成功证据=隔离矩阵+SMOKE-core-194+正式 smoke PASS
    affects: ['0.14.23 候选身份 bump', '部署方案 0.14.23 章节', 'SMOKE-core-194 与 runner', 'deploy 任务与回滚预案', 'S19 场景与测试 delta']
    rejected_options: ['仅规格 + 代码入仓，随下一个发版列车生效（期间 runlogos 每案仍需人工绕过）']
unresolved: []
defaults:
  - 'ensure 触发条件：proposal_step == ready-to-implement 且需要代码（[code] 标题在、切片未填）且提案未归档——即建议节点为 plan-slices 的时刻；已有事务（任意 phase，含 completed）则只读投影输出，不重建——可逆实现细节'
  - '创建失败口径对齐 recovery 分支既有语义：如实反映为「无投影」并携错误信息，不降级为仅建议节点（避免消费方误以为可自行恢复）——可逆实现细节'
  - 'submit-content 的用即建保留（幂等兜底，手动流程兼容）；不新增 slice transaction open 子命令——避免再造一条双边契约接缝——可逆实现细节'
  - '回滚制品取 0.14.22 部署窗口冻结件（deployment-artifacts/fix-guard-check-external-path-and-stderr/…0.14.22.tgz，sha256 0bdcefb3…83ac1）——可逆实现细节'
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
  touched_scenario_ids: [S19, S28, S32]
  targets:
    - category: requirement
      scenario_ids: [S19, S28, S32]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "S28 补 plan-slices 节点携 canonical 事务投影验收；S32 补 initial-plan 问即建时机验收；S19 补 0.14.23 候选发布要求。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S19, S28, S32]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "新增 2.65：next 对 initial-plan 事务的 ensure 语义、投影输出、幂等/失败口径、与 recovery 及 submit-content 用即建的关系；并载 0.14.23 候选内容清单与发布验收口径。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md", "spec_fact: 现最大功能编号 2.64"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "S19 新增 0.14.23 候选发布节（身份冻结→隔离矩阵→全局覆盖→smoke 与失败回滚边界）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md", "spec_fact: 已有 0.14.21/0.14.22 全局 candidate 先例节"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S28]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S28-next-node.md"
      reason: "next-node 派生补 initial-plan ensure 分支时序（ready-to-implement → ensure → 投影输出/失败如实）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S28-next-node.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S32]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md"
      reason: "initial-plan 事务创建时机前移为 next 问即建；submit-content 用即建降为幂等兜底的时序与边界。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S19, S28, S32]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "新增 0.14.23 本机全局部署方案章节（隔离矩阵含 next ensure 实测与 0.14.22 无投影对照，回滚制品固定 0.14.22 tarball）；S28/S32 的行为修复经该方案进入安装态。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S28]
      mode: MODIFY
      delta_path: "deltas/spec/cli-json-output.md"
      reason: "next 输出在 ready-to-implement 携带 slice_transaction 投影的字段口径（沿用 recovery 分支既有 schema，扩大出现场景）。"
      evidence: ["target_exists: spec/cli-json-output.md", "spec_fact: :3029 起已有 slice_transaction 投影字段表"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S32]
      mode: MODIFY
      delta_path: "deltas/spec/test-slice-manifest.md"
      reason: "initial-plan 事务创建时机合同补「next 问即建」；submit-content 用即建标注为幂等兜底。"
      evidence: ["target_exists: spec/test-slice-manifest.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "新增 0.14.23 候选身份全源一致与回滚身份 0.14.22 tripwire 用例（对齐 UT-S19-39 先例；新 ID 自 UT-S19-40 起）。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S28]
      mode: MODIFY
      delta_path: "deltas/test/core-S28-test-cases.md"
      reason: "新增 next ensure 分支用例（初达创建+投影、幂等重入、失败如实、非 plan-slices 节点不创建；现末号 UT-S28-49 / ST-S28-15）。"
      evidence: ["target_exists: logos/resources/test/core-S28-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S32]
      mode: MODIFY
      delta_path: "deltas/test/core-S32-test-cases.md"
      reason: "新增创建时机前移用例（next 已建后 submit-content 幂等续用、懒创建路径零回归；现末号 UT-S32-70 / ST-S32-23）。"
      evidence: ["target_exists: logos/resources/test/core-S32-test-cases.md"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S19, S28, S32]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "新增 SMOKE-core-194（安装态 next ensure 全链 + 0.14.22 无投影缺陷复现对照 + roundtrip 回滚演练），承载 S28/S32 修复的安装态验收。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "spec_fact: 现末号 SMOKE-core-193"]
      missing_evidence: []
    - category: api
      scenario_ids: [S19, S28, S32]
      mode: SKIP
      delta_path: null
      reason: "无 HTTP/RPC 接口；next JSON 输出口径由根规范 cli-json-output.md 承载（本计划 spec target 已覆盖）。"
      evidence: ["项目无 logos/resources/api/ 目录"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S19, S28, S32]
      mode: SKIP
      delta_path: null
      reason: "无架构文档目标：ensure 语义为 next 命令内部分支，复用 recovery 分支既有结构，不引入新组件/新边界；发布链沿用既有 candidate identity 机制。"
      evidence: ["先例：fix-guard-check-external-path-and-stderr 同类 CLI 行为修复 architecture=SKIP"]
      missing_evidence: []
    - category: database
      scenario_ids: [S19, S28, S32]
      mode: SKIP
      delta_path: null
      reason: "无业务数据；事务文件为提案目录内 CLI 私有运行态 JSON。"
      evidence: ["TEST_SLICE_TRANSACTION.json 为 CLI 私有运行态"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S19, S28, S32]
      mode: SKIP
      delta_path: null
      reason: "无 API 编排；行为纳入 S28/S32 场景测试与 SMOKE-core-194。"
      evidence: ["api disposition=SKIP"]
      missing_evidence: []
```

## 变更概述

在 `next` 的模块产出层（与 manifest-recovery 分支同层、同构）新增 initial-plan 事务的**问即建**：当模块处于 ready-to-implement、需要代码且切片未填、提案未归档时——已有事务（任意 phase）则只读投影输出；无事务则 `createTestSliceTransaction(origin: initial-plan)` 后输出投影；创建失败如实反映为「无投影」携错误，不降级为仅建议节点。`submit-content` 的用即建保留为幂等兜底，不新增 `open` 子命令（避免再造双边契约接缝）。消费方（runlogos）零改动痊愈：其 `next` 消费处本就在找 `slice_transaction` 字段。随提案捆绑 0.14.23 候选发布：身份 bump、SMOKE-core-194（安装态 next ensure 全链 + 0.14.22 无投影对照 + roundtrip）、隔离矩阵、本机全局部署与正式 smoke。

预计代码范围：`cli/src/commands/next.ts`（ensure 分支）、`cli/src/lib/test-slice-transaction.ts`（如需导出 ensure 辅助）、版本身份文件族、`scripts/smoke-*` runner 及对应测试。不得修改无关用户改动。

## 交付状态与后续边界

本次只填写 proposal.md 与 tasks.md。确认提案后才产出 delta；merge 后由 slice-planner 规划代码切片。merge、verify、部署执行、smoke、archive、push 按现行授权规则执行。runlogos 仓当前被挡提案不依赖本案——已由人工代跑 slice-planner 解锁；本案根治的是「以后每个新提案不再需要人工绕过」。
