# 变更提案：fix-merge-flow-transaction-contract

> module: core | created: 2026-09-05

## 变更原因

0.14.x 把 `openlogos merge` 的生产语义改为「开启合并事务」（`MERGE_TRANSACTION.json` → submit-content → seal → apply 后写 `SPEC_MERGED`），但内置 flow 规格与部分下游合同仍停留在 0.13.x「merge 生成 MERGE_PROMPT → step 变 merge-generated」的旧世界，CLI 自身不自洽：

1. **（P1）flow 死区**：`spec/flow/launched.yaml` 节点 `generate-merge-prompt` 的 `done_when: any_present:[MERGE_PROMPT_GENERATED, MERGE_PROMPT.md]`，而生产路径（`createMergeTransaction()`）永不写这两个 marker（仅 `legacyMergeTestMode` 测试模式写）；`flow-derive` step 推进同样只认这两个 marker。后果：merge exit 0 后 `proposal_step` 停在 `ready-to-merge`、`next` 永远返回 `generate-merge-prompt` 且该节点生产永不 done——宿主 driver 据 CLI 自己的 flow 事实判「前沿未动」硬停。
2. **（P1）merge 成功后置条件未成文**：「有 delta 时 exit 0 + 事务在盘 + 前沿暂不动」是合法中间态这一事实无契约表述；`spec/change-management.md` §「merge 流程」仍明文「生成 MERGE_PROMPT.md / 写入 MERGE_PROMPT_GENERATED」；merge 命令的收尾提示文案也仍指向「执行 MERGE_PROMPT.md」。
3. **（P2）存量事务合同兼容边界未成文**：CLI 升级后对 contract/schema 摘要失配的存量事务如何处置（fail-closed 拒绝、稳定错误码、remediation、不承诺迁移）无成文契约。
4. **（P2）status/next 错误 envelope 的稳定 errorCode 未钉为验收**：宿主有界恢复依赖机器可判的 `error.code`，需规格钉死「所有 status/next 失败路径必须输出结构化 error.code、瞬态码集合稳定」并以回归防退化。

来源：RunLogos 移交需求 `logos/resources/reference/openlogos-merge-flow-contract-fix-requirements.md`（2026-09-04，生产现场即本仓 cursor-adapter-parity run `drv-mtnt31lq-6354`）；四项已逐一对照当前 0.14.18 代码核实（P1×2 完全属实；P2×2 收窄后属实——`merge_transaction` 投影已在 status/next 实现并于 cli-json-output §2828 成文为「可挂载」，缺口是后置条件二分成文与「必挂」升格）。

## 变更类型

设计级变更

## 变更范围
- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 中 S05、S09、S16 的 merge 前沿推进、事务投影与错误码验收条件。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`（新增 merge flow 契约自洽章节）；`logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md`（merge 收尾提示从「执行 MERGE_PROMPT.md」改为事务引导文案）。
- 影响的技术架构：`logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`（merge 前沿推进判据与事务事实同源，marker 影子判据退休）。
- 影响的业务场景：S05（next 引导）、S09（变更生命周期 flow 推进）、S16（机器 JSON 契约）；不新增场景编号。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`（0.14.19 本机全局部署方案）。
- 影响的 API：无 HTTP/RPC/消息 API。
- 影响的 DB 表：无。
- 影响的编排测试：无 API 编排测试；由 CLI 场景测试与安装态 smoke 覆盖。
- 影响的根规范：`spec/flow/launched.yaml`（方案 A：`generate-merge-prompt.done_when` 改认事务存在）、`spec/flow-spec.md`（merge-generated 权威事实改述）、`spec/change-management.md`（merge 事务语义与中间态合法性成文）、`spec/cli-json-output.md`（后置条件二分、投影必挂、存量事务失配错误码、错误 envelope 验收）。
- 明确非目标：不采用方案 B（不合并 merge 子流节点、不改 `proposal_step` 闭合枚举与 step 序列）；不实现存量事务迁移；不改变 merge 事务 seal/apply/receipt 的任何既有判据；不在本提案授权 npm publish、Git tag、GitHub Release、官网发布或 git push。

## 部署影响
- 是否需要部署：是
- 部署原因：flow 推导与 merge/status/next 行为属已发布 CLI（本机全局 0.14.18）的运行时行为，不部署则现场死区仍在、RunLogos 侧提案 `fix-driver-merge-transaction-contract-alignment` 的跨仓验收无法闭合。
- 影响环境：本机全局（隔离矩阵 + 覆盖 `/opt/homebrew` 前缀，照 0.14.x 现行惯例）
- 是否涉及数据迁移：否（存量失配事务显式不迁移，fail-closed + 重开）
- 是否需要回滚预案：是（固定 0.14.18 tarball 回滚）
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

本案只修改 CLI 行为、文本提示与规格，不触及网站、桌面界面或移动界面；`core-01-cli-experience.md` 是纯 CLI 体验文本规格，不需要 UI 原型。

## Authority Impact

```yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [shared_business_fact]
  facts:
    - fact_id: merge-frontier.generate-node-done
      change: cutover
      authority_ref: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md#merge-frontier-transaction-fact
      authority_owner: merge 前沿推进判据（flow done_when 与 flow-derive step 推导）
      canonical_state: 「generate-merge-prompt 节点已完成」的唯一裁决事实——生产路径为活跃提案目录存在 MERGE_TRANSACTION.json（事务已创建/重开），legacy 测试模式兼容既有 marker
      sole_writer: openlogos merge 的 createMergeTransaction()（事务文件唯一写者）
      mutation_entry: openlogos merge <slug>（创建/幂等返回/终态归档让位后重建）
      decision_api: flow-derive 的 step 推导与 launched.yaml done_when（同一判据、两处同步声明、由回归钉一致）
      projections: [proposal_step:merge-generated, next.next_node:apply-merge, status/next.data.merge_transaction]
      freshness_proof: 每次 status/next 调用重读提案目录事务文件与 marker，无缓存
      rebuild_rule: 事务文件可重读重算；不可读时按既有事务读取 fail-closed，不猜测前沿
      recovery_source: 提案目录 MERGE_TRANSACTION.json 与 merge-transactions/ 归档
      retired_shadow_sources: [production-MERGE_PROMPT_GENERATED-marker, production-MERGE_PROMPT.md-marker]
      forbidden_fallbacks:
        - host-stat-transaction-file-to-derive-step
        - treat-exit0-with-frozen-frontier-as-failure
        - write-merge-prompt-markers-in-production
        - migrate-stale-transaction-in-place
      cutover:
        old_writer_stop: 生产路径本就不写 MERGE_PROMPT marker（影子判据只存在于 flow 规格与 flow-derive 的死引用）；legacy 测试模式保留 marker 仅供 0.13.x 合同回归
        new_writer_start: launched.yaml done_when 与 flow-derive 同步改认 MERGE_TRANSACTION.json 存在性（含 legacy marker 兼容或），status/next 投影升格必挂
        rollback_boundary: 仅判据与规格文本变更，无数据迁移；回退须同时还原 done_when、flow-derive 与规格文本
        exit_evidence: 安装态 smoke 全链「merge 开事务 → submit → seal → apply → SPEC_MERGED → status/next step 前进」通过（本提案新增 SMOKE-core-190 承载），且固定 0.14.18 对照复现 ready-to-merge 死区（防断言空转）；新增 flow 判据 UT/ST 见 deltas/test/ 规划
      tests: [UT-S09-292, ST-S09-111, SMOKE-core-181]
  unresolved: []
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: "不迁移、不改写任何持久化数据；存量失配事务显式不迁移（fail-closed + abort 重开），事务文件格式不变。"
  compatibility:
    status: none
    reason: "方案 A 只为 done_when 增加生产可满足的 done 事实、不收紧任何既有行为；proposal_step 闭合枚举、step 序列、merge 事务 seal/apply 判据均不变；legacy 测试 marker 继续被兼容接受。宿主侧（RunLogos）已立案按新契约对齐，方向一致。"
  security_privacy:
    status: none
    reason: "不涉及凭据、网络、用户数据或权限边界。"
  public_release:
    status: none
    reason: "只规划实现、隔离矩阵与本机全局部署 + smoke，不授权 npm publish、Git tag、GitHub Release、官网发布或 git push。"
  external_commitment:
    status: none
    reason: "不引入付费服务、供应商锁定、法律承诺或 SLA。"
decisions:
  - id: C01
    category: product
    question: "flow 死区的修法选哪个？（移交报告给出 A/B 两案，由本仓裁决）"
    answer: "方案 A：generate-merge-prompt.done_when 改认事务存在（any_present 含 MERGE_TRANSACTION.json，兼容保留旧 marker），flow-derive/step-registry 同步。"
    rationale: "用户确认推荐方案：改动最小、step 枚举与宿主可见序列不变、对宿主是纯放宽（只增加 done 事实）；开事务即 done，next 随即推进到 apply-merge 派 merge-executor。方案 B（合并单节点）语义更干净但改 step 枚举/overlay 映射/宿主消费面，回归风险高。"
    source: user
    affects:
      - "spec/flow/launched.yaml 的 generate-merge-prompt 节点"
      - "flow-derive step 推导与 step-registry 一致性"
      - "S05/S09 场景时序与宿主推进契约"
    rejected_options:
      - "方案 B：合并 generate-merge-prompt/apply-merge 为单节点，done 以 SPEC_MERGED 为准（改动面大、破 step 枚举兼容）"
  - id: C02
    category: deployment
    question: "部署与验证方式？（flow 推导是已发布 CLI 的行为，不部署则现场死区仍在）"
    answer: "0.14.19 本机全局部署 + smoke：真实 tarball、隔离矩阵（含跨组件全链验收）、0.14.18 零回归对照、新增 SMOKE 用例。"
    rationale: "用户确认推荐方案：照 0.14.x 现行惯例，隔离矩阵含「merge 开事务 → slot → seal → apply → SPEC_MERGED → status step 前进」全链与 0.14.18 死区对照；失败以固定 0.14.18 tarball 回滚。"
    source: user
    affects:
      - "0.14.19 候选身份与部署方案"
      - "SMOKE-core-190 跨组件全链用例"
      - "回滚制品与证据"
    rejected_options:
      - "仅本地合同测试，不部署（现场死区仍在，跨仓验收无法闭合）"
unresolved: []
defaults:
  - id: DFLT-01
    category: compatibility
    choice: "保留 merge-generated step 枚举值与宿主可见 step 序列；done_when 采用 any_present 并集（事务文件 + legacy marker），不删除 legacy 测试模式。"
    reason: "对既有宿主与 0.13.x 合同回归零破坏，可由既有回归测试验证。"
  - id: DFLT-02
    category: ownership
    choice: "前沿判据单源：launched.yaml done_when 与 flow-derive step 推导声明同一判据，由回归测试钉两处一致；status/next 的 merge_transaction 投影继续以 readMergeTransactionIfPresent 为唯一读取入口。"
    reason: "沿用「判据只能有一个实现」既有架构原则（§四十一.4），避免第二裁决者。"
  - id: DFLT-03
    category: acceptance
    choice: "存量事务失配错误码沿用既有稳定码命名惯例；status/next 失败路径错误码集合变更走 CLI JSON 合同版本。"
    reason: "与 spec/cli-json-output.md 既有错误 envelope 体系一致，属可逆实现细节。"
```

## 已确定的设计决策

- 拟定 D10：merge 前沿推进的权威事实从「MERGE_PROMPT marker」切换为「合并事务在盘」（`MERGE_TRANSACTION.json` 存在性；legacy 测试 marker 仅兼容保留），并确立两条跨仓合同不变量——①「`openlogos merge` 成功后置条件按情形二分：no-delta 当场写 `SPEC_MERGED` 前沿即进；有 delta 开事务、前沿暂不动为合法中间态，宿主以 exit 0 + 事务在盘且 phase 合法判本跳成功」；②「contract/schema 摘要失配的存量事务一律 fail-closed 拒绝并给稳定错误码与 remediation（abort 后重开），永不承诺就地迁移」。理由：前沿裁决事实必须是生产路径真实产生的事实，宿主与 CLI 才能双向一致；被否方案为「方案 B 单节点重构」与「存量事务就地迁移」。

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
  touched_scenario_ids: [S05, S09, S16]
  targets:
    - category: decision
      scenario_ids: [S05, S09, S16]
      mode: CREATE
      delta_path: "deltas/decisions/core-D10-merge-frontier-transaction-fact.md"
      reason: "前沿权威事实切换与两条跨仓合同不变量（后置条件二分、存量事务不迁移）是后续 flow/merge/宿主变更必须遵守的边界，需归档后可检索。"
      evidence: ["target_absent: logos/resources/decisions/core-D10-merge-frontier-transaction-fact.md", "decision_counter.next_id: 10"]
      missing_evidence: []
    - category: requirement
      scenario_ids: [S05, S09, S16]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "S05/S09/S16 新增 merge 前沿推进、事务投影必挂与错误码验收条件。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S05, S09, S16]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "merge flow 契约自洽需形成统一功能规格（done_when 事务事实、后置条件二分、投影必挂、存量事务 fail-closed、错误 envelope 验收）。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S05, S09]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md"
      reason: "merge 收尾提示仍指向「执行 MERGE_PROMPT.md」（生产误导文案），需改为事务引导（submit-content → seal → apply）。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md", "code_fact: merge.ts 收尾 console 提示含 MERGE_PROMPT.md", "artifact_type: CLI markdown without pages declaration"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S05, S09, S16]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "确立 merge 前沿推进判据与事务事实同源（authority cutover），marker 影子判据退休进 Registry 语义。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md", "code_fact: flow-derive.ts:541 仅认 MERGE_PROMPT marker"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"
      reason: "S05 需表达 merge 事务各相位（待开事务/collecting/ready/sealed/completed）下 next 的前沿与引导时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "S09 需补充「merge 开事务 → step 推进 merge-generated → apply-merge 派活 → SPEC_MERGED → coding」的生产链路时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"
      reason: "S16 需补充 merge_transaction 投影必挂与 status/next 失败路径结构化错误码的机器消费时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S05, S09, S16]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "0.14.19 本机全局部署方案：隔离矩阵含跨组件全链验收与 0.14.18 死区零回归对照。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "module_policy: deployment_required=true"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "merge 流程段仍明文 0.13.x「生成 MERGE_PROMPT/写 marker」，需改述为事务语义并成文中间态合法性。"
      evidence: ["target_exists: spec/change-management.md", "spec_fact: §192-196/§327 明文旧世界"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/spec/cli-json-output.md"
      reason: "成文 merge 成功后置条件二分、status/next 投影从「可挂载」升「活跃事务在场必挂」、存量事务失配稳定错误码与 remediation、status/next 失败路径结构化 error.code 验收。"
      evidence: ["target_exists: spec/cli-json-output.md", "spec_fact: §2828 现为「可挂载」措辞"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S09]
      mode: MODIFY
      delta_path: "deltas/spec/flow-spec.md"
      reason: "merge-generated 的权威 done 事实需从 marker 改述为事务在盘（step 枚举与序列不变）。"
      evidence: ["target_exists: spec/flow-spec.md", "spec_fact: §781/§859/§1012 引用 merge-generated 旧判据"]
      missing_evidence: []
    - category: test
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/test/core-S05-test-cases.md"
      reason: "补充 next 在事务各相位的前沿推导、引导文案与投影透传 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S05-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "补充 flow-derive 事务判据、merge 后置条件二分、legacy marker 兼容、存量事务失配 fail-closed UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/test/core-S16-test-cases.md"
      reason: "补充 merge_transaction 投影必挂、失败路径结构化 error.code 与瞬态码集合稳定性回归 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S16-test-cases.md"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S05, S09, S16]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "SMOKE-core-190：安装态跨组件全链（merge 开事务 → submit → seal → apply → SPEC_MERGED → status/next step 前进）+ 固定 0.14.18 对照复现死区。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "proposal: smoke_required=true"]
      missing_evidence: []
    - category: api
      scenario_ids: [S05, S09, S16]
      mode: SKIP
      delta_path: null
      reason: "本案仅改变本地 CLI flow 判据、JSON 投影与规格文本，不引入 HTTP、RPC 或消息 API。"
      evidence: ["architecture: local CLI and filesystem boundary"]
      missing_evidence: []
    - category: database
      scenario_ids: [S05, S09, S16]
      mode: SKIP
      delta_path: null
      reason: "不新增持久化实体、查询或迁移；事务文件格式不变。"
      evidence: ["architecture: flow derivation and spec text only"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S05, S09, S16]
      mode: SKIP
      delta_path: null
      reason: "API 维度为 SKIP，因此不需要 API 编排测试；跨进程行为由 CLI ST 与安装态 smoke 覆盖。"
      evidence: ["api_disposition: SKIP"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S09]
      mode: SKIP
      delta_path: null
      reason: "spec/flow/launched.yaml 属随包 flow 资产：合并事务整文件协议白名单仅 API YAML/JSON、DB SQL 与受控根 schema JSON，不含 flow YAML（seal 实测拒绝）；其 done_when/artifacts_hint 变更归 [code] 切片与 flow-derive 同批交付（保证两处判据一次同源落地），规格权威文本由 spec/flow-spec.md §12.10 与架构「四十七」承载。"
      evidence: ["seal_rejection: 整文件协议只支持 API YAML/YML/JSON、database SQL 与受控根 spec/schema JSON", "authority_text: deltas/spec/flow-spec.md §12.10 已成文同一判据"]
      missing_evidence: []
```

## 变更概述

按方案 A 让 merge 子流的前沿推进事实与 0.14.x 生产语义自洽：`spec/flow/launched.yaml` 的 `generate-merge-prompt.done_when` 改为 `any_present:[MERGE_TRANSACTION.json, MERGE_PROMPT_GENERATED, MERGE_PROMPT.md]`（事务在盘即 done，legacy 测试 marker 兼容保留），`artifacts_hint` 同步；`flow-derive` 的 step 推导与之同源（回归钉两处一致）。由此 `openlogos merge` 开事务后 step 立即推进 `merge-generated`、`next` 派发 `apply-merge`（merge-executor 走 submit → seal → apply），死区消除。merge 收尾提示文案同步改为事务引导。

契约成文三件：①`spec/cli-json-output.md` 与 `spec/change-management.md` 明确 merge 成功后置条件二分（no-delta 当场 `SPEC_MERGED` 前沿即进；有 delta 开事务、前沿暂不动为合法中间态，宿主以 exit 0 + 事务在盘且 phase 合法判本跳成功）、`status/next` 的 `data.merge_transaction` 投影从「可挂载」升格为「活跃提案存在事务时必挂」、merge 对非终态事务幂等返回的既有语义显式引用；②存量事务合同兼容边界：contract/schema 摘要失配一律 fail-closed 拒绝，错误码稳定、diagnostic 含双方版本与摘要及标准 remediation（abort 后重开），不承诺迁移；③status/next 所有失败路径必须输出结构化 `error.code`、瞬态码集合稳定且变更走合同版本，补回归用例防纯文本 stderr 退化。

交付含 S05/S09/S16 场景与测试规格更新、D10 决策记录、0.14.19 候选身份与本机全局部署方案（隔离矩阵含跨组件全链验收与固定 0.14.18 死区零回归对照）、SMOKE-core-190。不改 `proposal_step` 枚举与 step 序列，不实现事务迁移,不授权任何公开发布动作。
