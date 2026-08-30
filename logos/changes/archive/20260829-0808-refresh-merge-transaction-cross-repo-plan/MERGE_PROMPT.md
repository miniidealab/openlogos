# 合并指令

## 变更提案
- 提案名称：refresh-merge-transaction-cross-repo-plan
- 提案目录：logos/changes/refresh-merge-transaction-cross-repo-plan/

## 提案内容

# 变更提案：refresh-merge-transaction-cross-repo-plan

> module: core | created: 2026-08-28

## 变更原因

OpenLogos 0.13.31 的合并成功链仍把 canonical target set、外部 `MERGE_APPLY_MANIFEST.json`、Base64 内容、hash 校验和正式目标写入责任分散给 OpenLogos、Agent 与 RunLogos。与此同时，Plan Package completion 与 merge transaction 尚未彻底隔离，no-delta、UI prototype、counter/index、根 spec/skill dogfood 和 `SPEC_MERGED` 也没有统一绑定到同一事务身份。

本提案直接落实 `openlogos-merge-transaction-single-authority-root-fix-plan.md`，不再只刷新 reference：由 OpenLogos 成为 merge transaction 的唯一权威，交付 breaking candidate `0.14.0`，在 verify 通过并取得部署授权后以 npm tarball 安装到本机全局，再由 RunLogos 使用这个全局 candidate 完成真实跨仓 E2E。源码态测试、只生成 tarball 或 mock RunLogos 均不能替代该验收链。

## 变更类型

需求级（兼具架构级、部署级 breaking protocol change）。

## 变更范围

- 影响的需求文档：`core-01-requirements.md`，更新 S05/S09/S11/S16/S19/S39 的合并事务、状态动作与验收条件。
- 影响的功能规格：`core-01-feature-specs.md`，定义 `openlogos/merge-transaction@1`、`allowed_actions/next_action`、content slot、receipt 与错误分类。
- 影响的业务场景：S05、S09、S11、S16、S19、S39；同步更新对应场景实现与 UT/ST 规格。
- 影响的架构与方法论规格：合并权威、baseline closure、flow、tasks、CLI JSON、测试切片、next/status schema、merge transaction schema 及 merge-executor Skill。
- 影响的部署方案：`core-01-deployment-plan.md`，新增 `0.14.0` tarball、本机全局安装、安装态证据与 `0.13.31` 回滚。
- 影响的 API：无 HTTP/RPC/消息 API；CLI transaction envelope 属本地机器合同。
- 影响的 DB 表：无。
- 影响的编排测试：API orchestration 不适用；跨进程行为由 CLI ST 与 RunLogos 真实 E2E 覆盖。
- 影响的 smoke 测试：`core-smoke-test-cases.md`，增加全局安装态、合同 hash、事务恢复及 RunLogos candidate 接缝验证。

## 部署影响

- 是否需要部署：是
- 部署原因：本提案必须把 CLI 升级为 `0.14.0`，用真实 npm tarball 覆盖本机全局 OpenLogos，才能让 RunLogos 验证实际打包资产和跨进程事务合同。
- 影响环境：本机 npm 全局 OpenLogos 环境；后续 RunLogos 验收环境使用同一全局 candidate。
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；部署前记录现有 `0.13.31` 命令路径、版本、安装来源与可复制回滚命令，失败时恢复原版本。
- 是否需要 smoke：是
- smoke 范围：验证全局命令路径、`0.14.0` 版本、随包 schema/Skill、transaction 帮助与真实合并事务链。

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
  touched_scenario_ids: [S05, S09, S11, S16, S19, S39]
  targets:
    - category: decision
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: CREATE
      delta_path: "deltas/decisions/core-D07-merge-transaction-single-authority.md"
      reason: "本案确立跨 OpenLogos/Agent/RunLogos 的长期唯一权威和被否 manifest 方案，提案归档后仍需可检索。"
      evidence: ["target_absent: logos/resources/decisions/core-D07-merge-transaction-single-authority.md", "decision_counter.next_id: 7"]
      missing_evidence: []
    - category: requirement
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "用户可观察的合并、状态、动作、部署与失败恢复条件发生变化。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "需要定义 transaction phase、动作权威、content slot、receipt 和错误恢复功能规格。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "合并目标、phase、hash、apply 与 receipt 的唯一 writer 边界形成新的架构不变量。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"
      reason: "next 必须只投影 transaction 的 allowed_actions/next_action。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "S09 合并生命周期需改为 collecting/sealed/applying/completed/failed 单一事务链。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md"
      reason: "既有 S09 管理时序也引用旧 manifest 成功链，需同场景闭包更新。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md"
      reason: "status 必须只读投影 transaction phase、classification 和动作权威。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"
      reason: "机器输出需公开稳定 transaction envelope、错误和 receipt。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "部署后 smoke 必须验证全局 0.14.0 candidate 与真实事务链。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"
      reason: "resources、metadata、decision/counter/index 与 dogfood 必须归属同批 canonical transaction。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "C01 已确认 0.14.0 tarball 本机全局安装、安装态证据、smoke 与 0.13.31 回滚。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "decision: C01 deployment source=user"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/skills/merge-executor/SKILL.en.md"
      reason: "英文 Skill 与中文权威行为必须同步，避免随包资产出现双合同。"
      evidence: ["target_exists: skills/merge-executor/SKILL.en.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/skills/merge-executor/SKILL.md"
      reason: "merge-executor 必须从生成外部 manifest 改为只写 transaction 声明的原始 content slots。"
      evidence: ["target_exists: skills/merge-executor/SKILL.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/spec/baseline-closure.md"
      reason: "baseline-on-touch 的 resources/metadata 原子闭包改由 transaction 唯一生产。"
      evidence: ["target_exists: spec/baseline-closure.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "变更合并成功谓词和 SPEC_MERGED 身份必须绑定 completed receipt。"
      evidence: ["target_exists: spec/change-management.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S11, S16]
      mode: MODIFY
      delta_path: "deltas/spec/cli-json-output.md"
      reason: "status/next/merge transaction 的 JSON envelope 需要稳定字段和错误语义。"
      evidence: ["target_exists: spec/cli-json-output.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S09, S11, S19]
      mode: MODIFY
      delta_path: "deltas/spec/flow-spec.md"
      reason: "flow 必须隔离 Plan completion 与 merge transaction，并按动作权威推进。"
      evidence: ["target_exists: spec/flow-spec.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S16, S39]
      mode: CREATE
      delta_path: "deltas/spec/schema/merge-transaction.schema.json"
      reason: "现有规格没有 openlogos/merge-transaction@1 的独立公共 schema。"
      evidence: ["target_absent: spec/schema/merge-transaction.schema.json"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S16]
      mode: MODIFY
      delta_path: "deltas/spec/schema/next.schema.json"
      reason: "next schema 需投影稳定 transaction phase、allowed_actions 与 next_action。"
      evidence: ["target_exists: spec/schema/next.schema.json"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S11, S16]
      mode: MODIFY
      delta_path: "deltas/spec/schema/status.schema.json"
      reason: "status schema 需投影只读 transaction 状态、classification 和 receipt 摘要。"
      evidence: ["target_exists: spec/schema/status.schema.json"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/spec/tasks-spec.md"
      reason: "任务、delta closure 与 transaction target 身份需要精确映射。"
      evidence: ["target_exists: spec/tasks-spec.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/spec/test-slice-manifest.md"
      reason: "merge 后切片规划只能消费 completed receipt 和已合并真实测试 ID。"
      evidence: ["target_exists: spec/test-slice-manifest.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/test/core-S05-test-cases.md"
      reason: "补充 next 动作权威、waiting/retryable/fatal 与 no-delta 推进 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S05-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "补充 CREATE/MODIFY/mixed、seal/apply、崩溃恢复、幂等与旧协议拒绝 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/test/core-S11-test-cases.md"
      reason: "补充 status 真只读、phase 与 receipt 投影 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S11-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/test/core-S16-test-cases.md"
      reason: "补充 schema、contract hash、错误字段与源码/安装态一致性 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S16-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "补充 0.14.0 全局安装态与失败回滚验收用例。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/test/core-S39-test-cases.md"
      reason: "补充 metadata、decision/counter/index、dogfood 与正式目标全批原子性 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S39-test-cases.md"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "部署后必须验证全局 0.14.0、随包合同、真实事务恢复及 RunLogos candidate 接缝。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "proposal: smoke_required=true", "decision: C01 deployment source=user"]
      missing_evidence: []
    - category: api
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "本案只改变本地 CLI/文件/JSON 合同，不新增 HTTP、RPC 或消息 API。"
      evidence: ["architecture: local CLI process boundary"]
      missing_evidence: []
    - category: database
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "transaction、slot、journal 和 receipt 都是提案目录文件，不使用数据库且无数据迁移。"
      evidence: ["architecture: filesystem-backed proposal transaction"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "API 维度为 SKIP，不需要 API 编排测试；CLI ST 与 RunLogos 真实跨仓 E2E 覆盖进程接缝。"
      evidence: ["api_disposition: SKIP", "acceptance: RunLogos real E2E"]
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
    reason: "本案不迁移业务数据；transaction、slot、journal 与 receipt 都是提案级文件。"
  compatibility:
    status: none
    reason: "参考方案已把 0.14.0 定义为 breaking cutover：旧 merge-apply 可保留固定非零升级提示，但不得继续形成成功 fallback。"
  security_privacy:
    status: none
    reason: "不新增 Secret、远程权限或个人数据处理；content slot 仍受路径、symlink、大小和 hash 的 fail-closed 校验。"
  public_release:
    status: none
    reason: "本提案只授权本机全局 candidate 部署，不授权 npm publish、Git tag、GitHub Release、官网发布或 git push。"
  external_commitment:
    status: none
    reason: "不引入第三方服务、费用、SLA 或不可逆外部承诺。"
decisions:
  - id: C01
    category: deployment
    question: "本提案是否直接交付并本机全局安装 OpenLogos 0.14.0，再由 RunLogos 使用该全局 candidate 验证？"
    answer: "是。本提案直接实现 0.14.0；verify 通过后以 npm pack 产出 tarball并安装到本机全局，记录安装路径、版本与制品 hash，执行安装态 smoke；失败时恢复部署前记录的 0.13.31 安装来源。随后 RunLogos 必须调用该全局 candidate 完成真实跨仓 E2E。"
    rationale: "用户明确指出原提案部署影响写成‘否’是遗漏，并要求 0.14.0 部署到本机全局后再由 RunLogos 验证；本地 candidate 与公开发布必须保持隔离。"
    source: user
    affects:
      - "0.14.0 package 与本机全局安装"
      - "部署方案、回滚和 smoke 规格"
      - "RunLogos 真实跨仓 E2E 完成门"
      - "公开发布非目标"
    rejected_options:
      - "本提案只更新 reference，把 0.14.0 实现和部署推迟到另一提案"
      - "只运行源码态测试或只生成 tarball，不安装全局 candidate"
unresolved: []
defaults:
  - id: DFLT-01
    category: ownership
    choice: "OpenLogos 唯一生产 canonical transaction、phase、hash、receipt 和正式目标；Agent 只写声明的 content slots，RunLogos 只消费公共合同。"
    reason: "这是参考方案已冻结的根修复边界，可删除 RunLogos 私有 target/manifest/error 分类影子权威。"
  - id: DFLT-02
    category: compatibility
    choice: "旧 merge-apply 命令最多保留固定非零升级提示，不保留成功 fallback。"
    reason: "保留双成功链会重新制造多权威，违背 0.14.0 breaking cutover。"
```

## 已确定的设计决策

- 候选 D07：OpenLogos 是合并事务 target、mode、hash、phase、error、receipt、正式写入和 `SPEC_MERGED` 的唯一权威；Agent 与 RunLogos 不得复制该权威。理由是跨仓多 writer 已造成 manifest、deadline 和完成身份分裂，旧外部 manifest 成功链必须被明确否决。

## 变更概述

新增独立的 `openlogos/merge-transaction@1` 与 `merge-transaction status/seal/apply` 命令面，保留并内聚 `applyBaselineClosureBatch()` 的全批预演、journal、staging、backup、原子提交和崩溃恢复。Agent 只向 transaction 声明的原始字节 content slots 写内容；OpenLogos 独占 canonical target set、metadata 生成、validator、正式写入、receipt 和 marker。no-delta、UI prototype、decision/counter/index、根 spec/skill dogfood 与 `SPEC_MERGED` 全部绑定同一 `plan_hash/transaction_id`。

status/next/flow 只消费 `phase`、`classification`、`allowed_actions/next_action` 和 completed receipt，且与 Plan Producer 的 `next_node.dispatch.completion` 完全隔离。内容缺失为 waiting，内容 validator 失败为可原子替换后重试，schema/identity/path/plan 漂移和不可恢复 journal 才是 fatal；RunLogos 不再维护第二份 target、manifest、错误分类或完成 deadline 权威。

代码与规格完成后把 CLI 版本升级为 `0.14.0`。verify 通过且用户明确授权部署后，构建并哈希 npm tarball、记录 0.13.31 回滚事实、安装到本机全局并执行安装态 smoke。只有全局 `openlogos --version` 为 `0.14.0`、随包 schema/contract hash 一致，且 RunLogos 使用该全局 candidate 完成 CREATE、MODIFY、mixed、response-lost 等真实跨仓 E2E，方案才算完成；不执行 npm publish、tag、GitHub Release 或官网发布。

## 参考方案与跨仓边界

- 设计输入：`logos/resources/reference/openlogos-merge-transaction-single-authority-root-fix-plan.md`。
- 下游输入：RunLogos `logos/resources/reference/runlogos-adopt-openlogos-merge-transaction-root-fix-plan.md`。
- 当前磁盘缺失 D02 决策文件但 index 仍引用它；本案不静默补写 D02，新增候选 D07 记录本案长期不变量。
- OpenLogos candidate 的 schema、contract hash、golden、tarball hash 和 completed receipt 冻结后，RunLogos 才能创建/执行接入提案。
- RunLogos 使用源码相对路径、mock transaction、手工正式写 target 或手工预造 completed receipt，均不能算跨仓验收通过。


## 需要合并的 Delta 文件

### 1. deltas/decisions/core-D07-merge-transaction-single-authority.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/decisions/core-D07-merge-transaction-single-authority.md`
- 目标目录：`logos/resources/decisions/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 10. deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 11. deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 12. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 13. deltas/skills/merge-executor/SKILL.en.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/skills/merge-executor/SKILL.en.md`
- 目标目录：`skills/merge-executor/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 14. deltas/skills/merge-executor/SKILL.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/skills/merge-executor/SKILL.md`
- 目标目录：`skills/merge-executor/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 15. deltas/spec/baseline-closure.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/spec/baseline-closure.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 16. deltas/spec/change-management.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/spec/change-management.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 17. deltas/spec/cli-json-output.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/spec/cli-json-output.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 18. deltas/spec/flow-spec.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/spec/flow-spec.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 19. deltas/spec/schema/merge-transaction.schema.json

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/spec/schema/merge-transaction.schema.json`
- 目标目录：`spec/schema/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 20. deltas/spec/schema/next.schema.json

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/spec/schema/next.schema.json`
- 目标目录：`spec/schema/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 21. deltas/spec/schema/status.schema.json

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/spec/schema/status.schema.json`
- 目标目录：`spec/schema/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 22. deltas/spec/tasks-spec.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/spec/tasks-spec.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 23. deltas/spec/test-slice-manifest.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/spec/test-slice-manifest.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 24. deltas/test/core-S05-test-cases.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/test/core-S05-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 25. deltas/test/core-S09-test-cases.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/test/core-S09-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 26. deltas/test/core-S11-test-cases.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/test/core-S11-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 27. deltas/test/core-S16-test-cases.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/test/core-S16-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 28. deltas/test/core-S19-test-cases.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/test/core-S19-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 29. deltas/test/core-S39-test-cases.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/test/core-S39-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 30. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/refresh-merge-transaction-cross-repo-plan/deltas/test/smoke/core-smoke-test-cases.md`
- 目标目录：`logos/resources/test/smoke/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(refresh-merge-transaction-cross-repo-plan): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive refresh-merge-transaction-cross-repo-plan`。
