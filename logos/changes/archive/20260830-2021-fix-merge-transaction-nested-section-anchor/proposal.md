# 变更提案：修复 Merge Transaction 嵌套章节锚解析

> module: core | created: 2026-08-31

## 变更原因

RunLogos 在合并 `fix-open-file-atomic-replace-editor-refresh` 时，既有 merge transaction `mtx_e7f7b924499d49f96aaf8a2f` 已完成 6/7 个 Agent content slot，只剩产品设计 Delta 对应 slot。该 Delta 使用 OpenLogos 已公开支持的标题路径锚：

```text
七、项目文件夹动态 watcher 交互规则 > 7.1 已打开文件外部变化感知
```

正式目标中父、子标题分别真实存在，`change-lint` 的 S37 标题树解析器也能唯一命中；`submit-content` 也已经按合同完成原始 slot 字节、UTF-8、marker 与 hash 入库。真正的失败发生在后续 `sealMergeTransaction → buildMergePreflight → validateAgentSemantics`：`validateAgentSemantics()` 把整条路径转义成一个扁平标题正则，要求 before/final 文档存在字面量标题 `七、… > 7.1 …`，因而把合法 Agent slot 归因为 `slot_identity_mismatch`，只清空该 slot 并将事务 reopen 到 `collecting`。与此同时，OpenLogos producer 使用的 `applyMarkdownDelta()` 仍只按精确 `## ${section.title}` 查找目标，无法把路径锚解析为真实叶标题。两套 transaction 私有判据与 `spec/change-management.md`、S37 架构及 `ConservationEvaluator` 的单一权威语义发生漂移。

这会把可恢复的单 slot 预检问题放大为跨仓流程阻塞：消费者可以重提第 7 个 slot，却无法让该合法内容通过 seal preflight，也不应通过伪造字面量路径标题、abort 或新建 transaction 绕过。修复必须让现有 transaction 在安装修正版 OpenLogos 后继续使用同一 ID 完成 submit、seal 与 apply。

## 变更类型

架构级与代码级缺陷修复，兼具 merge transaction 兼容恢复、本机 CLI candidate 部署及跨仓真实事务验收；不新增命令、phase、classification 或公共 JSON 字段。

## 变更范围

- 影响的需求文档：`core-01-requirements.md`，补充 merge transaction 对嵌套标题路径锚的放行与同事务恢复验收。
- 影响的功能规格：`core-01-feature-specs.md`，明确 Agent content 由共享 resolver 做语义校验、OpenLogos content 由共享 resolver/composer 合成，seal 与 apply 重验同源。
- 影响的架构文档：`core-01-architecture-overview.md`，冻结共享 resolver、叶标题身份、标题层级重建及影子判据退出边界。
- 影响的业务场景：S09 变更合并生命周期与 S37 Delta 守恒门；不新增场景 ID。
- 影响的测试规格：`core-S09-test-cases.md`、`core-S37-test-cases.md` 与 `core-smoke-test-cases.md`。
- 影响的实现：预期从 `cli/src/lib/change-lint.ts` 提取共享的 fence-aware Delta 控制块/标题树/section-anchor 模块，由 `change-lint.ts` 与 `merge-transaction.ts` 共同消费，并补齐相应 Vitest/CLI ST；具体文件名以 Delta 架构和实现阶段代码检索为准。
- 影响的方法论规格与 Skill：无。`spec/change-management.md` 和 `skills/merge-executor/SKILL.md` 已正确规定标题路径锚及 0/多命中 fail-closed，本案只消除实现漂移。
- 影响的 API：无 HTTP、RPC 或消息 API；本地 CLI 命令与 JSON schema 保持不变。
- 影响的 DB 表：无。
- 影响的编排测试：API orchestration 不适用；使用真实 CLI ST、安装态 smoke 和现存 RunLogos transaction 覆盖。
- 新测试 ID 从真实已占用上界后分配：S09 `UT-S09-271`～`UT-S09-274` / `ST-S09-106`～`ST-S09-107`，S37 `UT-S37-37`～`UT-S37-40` / `ST-S37-09`～`ST-S37-10`，smoke 使用 `SMOKE-core-168`。

## 部署影响

- 是否需要部署：是
- 部署原因：当前 RunLogos transaction 由本机全局 OpenLogos `0.14.3` 执行；源码测试通过不能替代真实安装态恢复。
- 影响环境：隔离 npm prefix、本机全局 OpenLogos 与 RunLogos 当前提案；不触达生产、远程 registry 或其它用户项目。
- 是否涉及数据迁移：否；只替换 CLI candidate，并继续读取既有 transaction 制品。
- 是否需要回滚预案：是；部署前冻结当前全局 `0.14.3` 的入口、realpath、package/plugin/asset identity 与可复制回滚制品。
- 是否需要 smoke：是
- smoke 范围：以真实安装态嵌套锚 transaction 和 RunLogos 原 transaction ID 为验收对象。
- candidate 身份：实现阶段将 package/plugin/asset identity 从当前 `0.14.3` 同步提升为新的本地 patch candidate `0.14.4`；禁止以 `0.14.3` 同版本不同字节覆盖全局，也不在本提案中授权 npm publish、tag、GitHub Release、官网发布或 git push。

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

本案只修改本地 CLI 的 Markdown Delta 解析、事务合成与安装态验收，不新增页面、交互或视觉资产。

## Authority Impact

```yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [shared_business_fact, derived_projection, ownership_or_cutover]
  facts:
    - fact_id: delta.section-anchor-resolution
      change: modify
      authority_ref: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md#二十四-delta-条目守恒判据架构
      authority_owner: OpenLogos S37 ConservationEvaluator 标题树解析合同
      canonical_state: approved Delta bytes、正式目标 before bytes 与唯一命中的 heading-tree hit
      sole_writer: 获授权的 OpenLogos merge transaction apply
      mutation_entry: merge transaction submit-content 原始字节入库，以及 seal preflight 与 apply 的受控事务入口
      decision_api: 共享模块导出的 fence-aware Delta block parser、section-anchor resolver、Agent semantic verifier 所需命中身份与 OpenLogos Delta composer
      projections:
        - change-lint L8 守恒结论
        - merge transaction slot 语义校验结果
        - merge transaction candidate final bytes
        - apply 后正式 canonical target section
      freshness_proof: source_sha256、before_sha256、resolved hit.level/text/path、content_sha256 与 final_sha256
      rebuild_rule: OpenLogos target 从冻结的 Delta、before target 与共享 resolver/composer 确定性重建；Agent target 从冻结 content slot/hash 恢复，并以同一 resolver 对 before/final 重验
      recovery_source: 同一 transaction 的 plan identity、before hash、已提交 slot hash、修正后的缺失 slot 与 completed receipt
      retired_shadow_sources:
        - merge-transaction.ts validateAgentSemantics 的整条路径扁平标题正则
        - merge-transaction.ts applyMarkdownDelta 的精确 H2 私有匹配器
      forbidden_fallbacks:
        - 把父标题与叶标题路径字面量写入正式文档
        - 仅按叶标题取第一个命中或合并多个同名章节
        - abort 或创建新 transaction 掩盖可修复的嵌套锚拒绝
      cutover:
        old_writer_stop: transaction content 校验与 apply 路径删除扁平正则和精确 H2 两个裁决分支
        new_writer_start: submit-content 只保存原始 slot 字节；change-lint、seal/apply 的 Agent semantic verifier 与 OpenLogos Delta composer 全部消费同一共享解析结果
        rollback_boundary: 修正版 candidate 覆盖本机全局 CLI 且 RunLogos 原 transaction 首次成功 apply 之前
        exit_evidence: 共享 resolver UT、真实 CLI ST、安装态 smoke 通过，且原 transaction ID 完成 seal/apply
      tests: [UT-S37-20, UT-S37-36, ST-S37-04]
  unresolved: []
```

本区块只声明本次触达的既有权威事实，不新建第二套 Registry。实现不得在 merge transaction 中复制第三份标题解析器。

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data:
    status: none
    reason: 只处理提案 Delta、transaction 私有制品与 Markdown 正式目标，不涉及数据库或业务数据迁移。
  compatibility:
    status: none
    reason: 修复严格兑现既有标题路径锚合同；单段唯一锚、0/多命中 fail-closed 和事务公共 schema 均保持不变。
  security_privacy:
    status: none
    reason: 沿用项目根 containment、symlink 拒绝、UTF-8、大小与 SHA-256 校验，不读取 Secret 或个人数据。
  public_release:
    status: none
    reason: 只规划隔离与本机 0.14.4 candidate；不授权 npm publish、Git tag、GitHub Release、官网发布或 git push。
  external_commitment:
    status: none
    reason: 不新增第三方服务、账号、费用、SLA 或外部时间承诺。
decisions:
  - id: C01
    category: ownership
    question: 该阻塞应由 RunLogos 绕过，还是由 OpenLogos 修复标题锚权威实现？
    answer: 在 OpenLogos 建立本提案并由用户在该仓库实施；RunLogos 不伪造标题、不 abort、不创建新 transaction。
    rationale: 标题路径锚是 OpenLogos 已发布的方法论合同，跨仓消费者不应维护私有兼容分支。
    source: user
    affects:
      - OpenLogos S09/S37 规格、实现与测试
      - RunLogos fix-open-file-atomic-replace-editor-refresh 原 transaction 恢复
    rejected_options:
      - 在 RunLogos Delta 中写入字面量父子路径标题
      - abort 并重建已完成 6/7 slot 的 transaction
  - id: C02
    category: deployment
    question: 修复完成后如何让当前 RunLogos transaction 实际消费新语义？
    answer: OpenLogos verify 通过后，在独立确认点构建并隔离验证新的 0.14.4 candidate；再经部署授权覆盖本机全局 0.14.3，经 smoke 授权验证安装态，最后返回 RunLogos 复用原 transaction。
    rationale: 只有真实全局 CLI 才能证明跨进程 transaction 恢复；分离 merge、verify、部署、smoke 与 RunLogos merge 授权可保持人类确认点。
    source: user
    affects:
      - OpenLogos package candidate 与本机全局入口
      - 0.14.3 回滚基线
      - RunLogos mtx_e7f7b924499d49f96aaf8a2f
    rejected_options:
      - 仅运行源码测试而不验证安装态
      - 提案批准后自动执行全部后续确认点
unresolved: []
defaults: []
```

## 变更概述

把 S37 现有 fence-aware Delta 控制块解析、标题树与唯一锚解析能力提取为独立共享 API，`change-lint` 和 merge transaction 不再各自解析控制 marker 或标题。对 `MODIFIED — 父标题 > 叶标题`，resolver 必须按层级路径唯一命中叶标题，并返回真实 `hit.level`、`hit.text`、路径身份与章节 `[start,end)` 边界。Agent producer 的 semantic verifier 必须在 before/final 中按同一锚规则验证唯一真实命中；OpenLogos producer 的 content composer 必须用 before 中的真实命中替换目标章节，保持父标题、叶标题级别、相对子标题层级和未触及区域，不把路径字符串写入正文。

`validateAgentSemantics()` 不再用整条 section title 构造扁平正则，`applyMarkdownDelta()` 不再只接受精确 H2，transaction 私有的非 fence-aware `parseDeltaSections()` 也不得继续成为第二套控制块判据。`submit-content` 只负责原始字节与 slot identity 入库；change-lint、seal preflight、apply 重验和 OpenLogos composer 对同一 before/Delta 必须得出相同的 0/1/多命中结论。零命中、多命中、路径层级不匹配、同锚多写者或最终结构漂移继续 fail-closed，并只把 seal preflight 可唯一归因的 Agent slot 留在 collecting 供同事务重提；`REMOVED-ITEMS` 继续只参与守恒声明，不成为物质写操作。

修复完成后，使用与 RunLogos 失败内容同形的夹具先证明第 7 个 slot 可成功 submit，并在 seal preflight 中按真实嵌套锚通过；再在获得相应授权后部署修正版 CLI，回到 `mtx_e7f7b924499d49f96aaf8a2f` 重提缺失 slot、seal、apply。transaction ID、plan identity、target set 与其余 6 个已提交 slot hash 必须保持不变。

## 验收边界

1. 标题路径 `父标题 > 叶标题` 仅在标题树层级关系唯一时解析成功；相同叶标题位于其它父章节不得误命中。
2. 合成结果保留真实父标题与叶标题级别，不产生字面量 `父标题 > 叶标题` 标题；Delta 正文中的相对子标题层级保持正确。
3. `submit-content` 对合法最终字节只执行原始 slot 入库；change-lint、seal/apply 的 Agent semantic verifier 与 OpenLogos composer 对同一输入消费同一个 block parser/resolver，不存在 transaction 私有 marker 正则、扁平路径正则或精确 H2 判据。
4. fence 内伪 marker 不得被解析为 Delta 控制块；`REMOVED-ITEMS` 保持非物质声明语义；单段锚和 `ADDED / MODIFIED / REMOVED` 的既有合法行为不回归。
5. 锚 0 命中、多命中、层级不匹配、同锚多写者继续稳定拒绝，且正式目标、receipt、marker、journal 均无部分写入。
6. seal preflight 拒绝可唯一归因的 Agent slot 时，只清空该 slot；修正后可在同一 transaction 重新 submit/seal/apply，其它 slot identity/hash 不变。
7. `0.14.4 → 0.14.3 → 0.14.4` 安装往返与安装态 `SMOKE-core-168` 通过后，RunLogos 原 transaction 能完成 7/7 slot、seal 与 apply；失败时按稳定摘要修复并重试，不 abort、不换 transaction。

## 非目标

- 不改变 Delta `ADDED / MODIFIED / REMOVED / REMOVED-ITEMS` 操作语义或放宽 L8 守恒。
- 不新增兼容旧非法字面量路径标题的迁移器，不按内容相似度猜测目标章节。
- 不改变 merge transaction 公共 JSON schema、phase、classification、allowed action 或 receipt shape。
- 不修改 RunLogos 源代码或规格；跨仓恢复在 OpenLogos 修复部署后回到其原提案按独立授权执行。
- 不执行公开发布、远程推送、tag、release 或官网部署。

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
  touched_scenario_ids: [S09, S37]
  targets:
    - category: requirement
      scenario_ids: [S09, S37]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "补充 merge transaction 对嵌套标题路径锚的放行、失败无副作用和同事务恢复验收。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md", "sections_exist: S09/S37"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S09, S37]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "定义共享 fence-aware block parser/resolver、真实叶标题身份、Agent verifier 与 OpenLogos composer 的 transaction 全链路同源语义。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S09, S37]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "冻结标题树 resolver 的唯一权威、composer 算法、hash/fail-closed 与影子判据退出边界。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md", "section_exists: 二十四"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "补充嵌套锚 Agent slot 的 submit、seal、apply 与同事务重提时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S37]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S37-delta-conservation.md"
      reason: "明确 merge transaction 与 change-lint 共同消费标题路径 resolver，禁止私有扁平判据。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S37-delta-conservation.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S09, S37]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "定义 0.14.4 pack、隔离安装、本机全局部署、0.14.3 回滚与 RunLogos 原事务交接。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "proposal: deployment_required=true"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "新增 transaction submit/seal/apply、局部重提、hash 保持及真实 CLI 回归用例。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md", "current_max_ids: UT-S09-270/ST-S09-105"]
      missing_evidence: []
    - category: test
      scenario_ids: [S37]
      mode: MODIFY
      delta_path: "deltas/test/core-S37-test-cases.md"
      reason: "新增 fence-aware block parser、共享 resolver、Agent verifier/OpenLogos composer 的层级路径正反例和 lint/transaction 同源用例。"
      evidence: ["target_exists: logos/resources/test/core-S37-test-cases.md", "current_max_ids: UT-S37-36/ST-S37-08"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S09, S37]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "增加 0.14.4 安装态嵌套锚 transaction 与 RunLogos 原事务恢复验收。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "current_max_id: SMOKE-core-167", "proposal: smoke_required=true"]
      missing_evidence: []
    - category: api
      scenario_ids: [S09, S37]
      mode: SKIP
      delta_path: null
      reason: "本案只处理本地 Markdown 字节与 CLI 文件事务，不跨 HTTP、RPC 或消息边界。"
      evidence: ["architecture: in-process CLI and filesystem transaction"]
      missing_evidence: []
    - category: database
      scenario_ids: [S09, S37]
      mode: SKIP
      delta_path: null
      reason: "不新增或修改数据库、DDL、查询、迁移或业务持久化实体。"
      evidence: ["data_impact: none"]
      missing_evidence: []
    - category: decision
      scenario_ids: [S09, S37]
      mode: SKIP
      delta_path: null
      reason: "既有 S37 架构和单一权威决策已唯一确定解法，本案没有新的长期架构取舍。"
      evidence: ["authority_ref: architecture section 二十四", "existing_decision: core-D07-merge-transaction-single-authority.md"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S09, S37]
      mode: SKIP
      delta_path: null
      reason: "API 维度为 SKIP；跨进程行为由 CLI ST 和安装态 smoke 覆盖。"
      evidence: ["api_disposition: SKIP"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S09, S37]
      mode: SKIP
      delta_path: null
      reason: "change-writer 与 merge-executor 已规定父级标题到目标标题的路径锚，无需复制实现细节。"
      evidence: ["skills/change-writer/SKILL.md: 标题路径锚", "skills/merge-executor/SKILL.md: 标题路径锚"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S37]
      mode: SKIP
      delta_path: null
      reason: "根规范已明确标题路径锚及 0/多命中 fail-closed，本案只纠正实现偏差。"
      evidence: ["spec/change-management.md: 章节锚唯一定位（fail-closed）"]
      missing_evidence: []
```
