# 变更提案：completed 合并事务的跨版本重开死锁（§2.58 终态出路的第四个死锁面）

> module: core | created: 2026-09-07
> 来源：2026-09-07 runlogos 现场——提案 `fix-driver-zero-benefit-blocks-selfheal` 的合并事务 `mtx_25a2e110e581f4223b95b7ca` 在 0.14.24 下 `completed`，随后本机 CLI 升级至 0.14.25，该提案的已合并规格**永久无法再修改**：reopen 被合同兼容门拒、abort 被终态相位拒、merge 认为已完成。

## 变更原因

功能规格 §2.58 的立法目标是「消除三个同族死锁面（abort 死锁 / fatal failed 死锁 / completed 无二次 merge 通道），使**任何终态都存在受控、留痕、可审计的重来路径**」。本次现场证实存在**第四个未被覆盖的死锁面**：`completed` × 跨 CLI 版本。

**现场三条路全堵**（runlogos，CLI 0.14.24 → 0.14.25）：

| 操作 | 结果 |
|---|---|
| `merge transaction reopen` | `unsupported_contract`——事务记录 contract `9cdcc0da…`，当前 CLI `c167ced…` |
| `merge transaction abort` | `action_not_allowed：phase=completed 禁止 abort` |
| `openlogos merge <slug>` | 「规格已合并（SPEC_MERGED 存在），无需重复操作」 |

**根因：两道独立的门恰好互相抵消。**

1. `assertContractCompatible()` 拦截全部写动作。其文档注释明确记载了设计假设：「**abort 不拦——它正是 remediation 出路（abort 后重跑 merge 重开事务）**」；`unsupported_contract` 的错误文案也把「abort 后重跑 merge」作为唯一处置指引。
2. 但 `allowed()` 对 `completed` 只返回 `['reopen']`（§2.58.1「completed 受保护，仅经显式 reopen 让位」）——**不含 abort**。

于是：completed 的唯一出边 `reopen` 被合同门拦下，而合同门自认的兜底出路 `abort` 在 completed 相位并不存在。两处各自都符合自己的设计意图，叠加后却把 completed × 合同不一致这个组合彻底封死。

既有用例 **UT-S09-308「存量事务失配 fail-closed」** 的预期里就写着「remediation（**abort 后重开**）」——该断言对 `collecting/ready/sealed` 成立，对 `completed` 不成立。这是缺陷在规格层的直接证据：规格承诺的 remediation 出路在一个相位上是空的。

**判据错位（同 RunLogos D06「停点准入测试」的 P1 形态）**：合同兼容门保护的对象是「不按旧合同解释存量数据」，而 `reopenMergeTransaction()` 的实际动作序列是——① `MERGE_REOPENS.jsonl` 追加留痕；② 旧终态事务**原样归档**至 `merge-transactions/`；③ 作废 `SPEC_MERGED`；④ `createMergeTransaction()` **按当前 CLI 与当前 delta 全新重建**（新 transaction_id、新 plan/target set）。**全程不按旧合同解释任何事务内容**，旧事务只被整体存档。因此对 reopen 施加合同兼容门，锚的是「合同摘要」这个代理信号，而非「该动作是否需要按旧合同解释存量数据」这个地面真值——保护强度为零，代价是把终态出路封死。

反证：`abort` 同样是「不解释旧内容、只终结并让位」的动作，正因如此它被明确豁免于合同门。reopen 与 abort 在这一点上同构，却被区别对待。

## 变更类型

代码级修复 + 规格对齐（功能规格 §2.58 准入矩阵与合同门边界、S09 场景、S09 测试）。不改变 seal/apply/preflight/receipt 的任何既有判据与原子性语义；不放宽任何「按旧合同解释存量数据」的保护。

## 变更范围

- 影响的需求文档：无（§2.58 的需求层目标不变，本次是其实现边界的缺口修复）
- 影响的功能规格：`core-01-feature-specs.md` §2.58（新增 2.58.5「合同兼容门与终态出路的边界」；2.58.3 准入矩阵补「合同不一致」行）
- 影响的业务场景：`core-S09-change-lifecycle.md`（合同兼容门与终态出路的交互时序与异常臂）
- 影响的 API：无公开 HTTP/RPC 变化；CLI 行为面变化仅为 `reopen` 在合同不一致时可用、`completed` 在合同不一致时额外暴露 `abort`
- 影响的 DB 表：无
- 影响的编排测试：`core-S09-test-cases.md`（新 ID 自 UT-S09-322 / ST-S09-125 起连续分配）
- 预计代码范围：`cli/src/lib/merge-transaction.ts`（`assertContractCompatible` 的适用面、`allowed()` 的 completed 出边）及对应测试

## 部署影响

- 是否需要部署：是
- 部署原因：修复面是 `openlogos merge transaction reopen/abort` 的 CLI 行为，需发布 0.14.26 候选并覆盖安装本机全局 prefix 才对使用者生效；**本机 0.14.25 当前正带着该死锁运行，且 runlogos 有一个提案已被实际锁死、在部署完成前无法解锁**
- 影响环境：本地（本机全局 prefix `/opt/homebrew`）
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（0.14.25 tarball 回滚，沿用既有版本 roundtrip 惯例）
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false
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
    - "「已合并规格」事实的 authority 零变化：SPEC_MERGED + MERGE_RECEIPT 仍是唯一权威事实，唯一 writer 仍为 apply/reopen 受控命令；本次只放开 reopen 在合同不一致时的可达性，不新增、不迁移、不退休任何裁决者"
    - "「事务合同」事实的 authority 零变化：合同摘要仍由随包 schema/contract 文件裁决，seal/apply/submit_content/recover 的合同门逐字不变；reopen 之所以豁免是因为它不按旧合同解释任何事务内容（留痕 → 原样归档 → 作废 marker → 按当前 CLI 重建）"
    - "旧事务仍原样归档至 merge-transactions/，receipt 与哈希可审计、不销毁；无 shadow source、无 cutover"
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: pending
impacts:
  data:
    status: none
    reason: 不触碰用户数据、无迁移（database/ 为空）；旧事务仍原样归档、不销毁
  compatibility:
    status: none
    reason: 纯放行方向的边界修正——reopen/abort 在合同不一致时从"拒绝"变为"可用"，不收紧任何既有可用面；seal/apply/preflight/receipt 判据与"不按旧合同解释存量数据"的保护逐项不变
  security_privacy:
    status: none
    reason: 不新增权限、凭据、网络行为；reopen 的留痕、归档与 marker 作废语义逐字不变
  public_release:
    status: none
    reason: 拟仅本机全局部署 0.14.26 候选，不含 npm publish / tag / GitHub Release（本地部署与公开发布分离原则）
  external_commitment:
    status: none
    reason: 无对外接口承诺变化；CLI JSON 仅在合同不一致时多暴露一个 allowed_action
decisions: []
unresolved:
  - id: C01
    category: compatibility
    question: 除主修（reopen 不受合同门拦）外，是否同时让 completed 在合同不一致时额外暴露 abort 作为冗余出边？
    impact: 决定功能规格 §2.58.5 是否记录该冗余出边、S09 出路矩阵是否含该分支、以及测试是否新增对应用例；不影响主修本身的完成度
    recommendation: 主修 + abort 冗余出边
    recommendation_reason: §2.58 的立法承诺是「任何终态都存在受控、留痕、可审计的重来路径」，既有用例 UT-S09-308 也把「abort 后重开」写进 remediation 断言；只做主修则该承诺仍依赖单一出边，一旦 reopen 未来再被某道门拦住即复现同族死锁
    depends_on: []
    options:
      - id: C01-A
        label: 主修 + abort 冗余出边
        tradeoff: 多一处 allowed_actions 分支与配套用例；换来 §2.58 承诺与 UT-S09-308 断言在所有相位真实成立
      - id: C01-B
        label: 仅主修 reopen
        tradeoff: 改动面更小、评审更快；但 completed × 合同不一致仍只有单一出边，无冗余保护
  - id: C02
    category: deployment
    question: 本提案的发布与部署方式？
    impact: 决定 tasks.md 是否保留 [deploy] section、是否产出部署方案 0.14.26 章节与 smoke 用例；也决定 runlogos 侧被锁死的提案能否解锁——本机 0.14.25 带着该死锁运行，不部署则修复对使用者不生效
    recommendation: 发 0.14.26 并本机部署
    recommendation_reason: runlogos 提案 fix-driver-zero-benefit-blocks-selfheal 已被实际锁死且无本地绕过手段（reopen/abort/merge 三条路全堵），仅合入仓库无法解除；沿用 0.14.25 的部署惯例（候选身份全链同步、隔离矩阵、全局覆盖安装、回滚 tarball 预案、smoke 验证）
    depends_on: []
    options:
      - id: C02-A
        label: 发 0.14.26 并本机部署
        tradeoff: 需走完隔离验证矩阵与回滚预案，工作量较大；但立即解锁 runlogos 侧被锁死的提案
      - id: C02-B
        label: 仅合入仓库不部署
        tradeoff: 改动面最小；但本机 0.14.25 继续带死锁运行，runlogos 提案维持锁死无法推进
defaults:
  - 新增/调整的错误码与文案措辞为可逆实现细节，delta 阶段在 S09 场景与 cli-json-output 契约中定稿
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
  touched_scenario_ids: [S09]
  targets:
    - category: requirement
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "在既有「Preflight 与可修复 reopen 验收要求」段补第四个死锁面的验收要求：合同兼容门的适用面须按「该动作是否需要按旧合同解释存量数据」划定，终态出路（abort/reopen）不在其拦截范围；并补「任何终态在任何合同状态下都存在受控出路」的验收条件。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md", "repo_fact: 现有 AC-MT-PF-* 段（L1908 起）覆盖 preflight/reopen 验收，未覆盖合同不一致 × 终态组合"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "§2.58 补 2.58.5「合同兼容门与终态出路的边界」并在 2.58.3 准入矩阵补「合同不一致」行；按 C01 决定是否记 completed 的 abort 冗余出边。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md", "repo_fact: §2.58 现有 2.58.1～2.58.4，未覆盖合同不一致 × 终态的组合"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "新增合同兼容门与终态出路交互的时序与异常臂，含「合同不一致 × 各相位」出路矩阵与 reopen 崩溃回退。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "0.14.26 章节（候选身份全链同步、隔离验证矩阵、全局覆盖安装、0.14.25 回滚 tarball 预案）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "clarification: 取决于 C02"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "回归锚（复刻 runlogos 跨版本 completed 死锁现场必红→必绿）、合同门零回归对照矩阵、reopen 准入矩阵零回归、崩溃一致性；新 ID 自 UT-S09-322 / ST-S09-125 起。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md", "repo_fact: S09 现有末号 UT-S09-321 / ST-S09-124"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "0.14.26 安装态验收用例：跨版本 completed 事务可 reopen、既有写动作合同门零回归。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "clarification: 取决于 C02"]
      missing_evidence: []
    - category: api
      scenario_ids: [S09]
      mode: SKIP
      delta_path: null
      reason: "CLI 项目无 HTTP API；本次亦不改 CLI JSON 契约字段形态（仅在合同不一致时多暴露一个既有枚举值的 allowed_action）。"
      evidence: ["repo_fact: logos/resources/api/ 为空目录"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S09]
      mode: SKIP
      delta_path: null
      reason: "不新增组件、流程或依赖；变更面为既有模块 merge-transaction.ts 内两处判据边界的调整。"
      evidence: ["repo_fact: 修复点为 cli/src/lib/merge-transaction.ts 内既有函数 assertContractCompatible/allowed，无新架构元素"]
      missing_evidence: []
    - category: database
      scenario_ids: [S09]
      mode: SKIP
      delta_path: null
      reason: "无持久化模型变化；旧事务仍原样归档为既有 JSON 形态。"
      evidence: ["repo_fact: logos/resources/database/ 为空目录"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S09]
      mode: SKIP
      delta_path: null
      reason: "无 API 编排测试（与 api 维度一致）；本次验收由 S09 UT/ST 与 smoke 承担。"
      evidence: ["repo_fact: logos/resources/scenario/ 无 S09 相关编排 JSON"]
      missing_evidence: []
```

## 变更概述

把 `reopen` 与 `abort` 同列为**不受合同兼容门拦截的 remediation 出路**——判据从「合同摘要是否一致」改锚「该动作是否需要按旧合同解释存量数据」这一地面真值。reopen 的动作序列（留痕 → 原样归档 → 作废 marker → 按当前 CLI 重建）全程不解释旧内容，因此不属合同门的保护对象；而 seal / apply / submit-content 等**确实按事务内容推进**的写动作，其合同门拦截逐字不变。

配套在 §2.58.3 准入矩阵补「合同不一致」行，明确该前置下 reopen 仍允许、且重开后由当前 CLI 重建新事务（新合同摘要随之写入，天然完成"迁移"而无需就地迁移）；并按 C02 决定是否为 completed 在该前置下补 abort 冗余出边，使 §2.58 的立法承诺与 UT-S09-308 的 remediation 断言在所有相位真实成立。
