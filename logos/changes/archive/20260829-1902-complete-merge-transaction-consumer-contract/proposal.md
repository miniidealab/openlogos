# 变更提案：complete-merge-transaction-consumer-contract

> module: core | created: 2026-08-29

## 变更原因

OpenLogos `refresh-merge-transaction-cross-repo-plan` 已将规格合并的主体状态机、canonical target、原子 apply 和 completed receipt 实现到本机全局 `0.14.0` candidate，但 RunLogos 消费者接入审查发现安装态公共合同未完整兑现已合并规格：

1. completed projection 只暴露摘要 hash 和 target count，没有完整 `changed_paths` / `created_paths` / 逐路径 final SHA-256 / `commit_paths`，RunLogos 无法只依赖公共 receipt 完成精确 Git 提交。
2. projection 只有 `slot_id` 与 target identity，未签发 Agent 可写的 staging path 及原子替换规则；`submit-content --file` 却接受未声明的任意来源路径，导致宿主必须自建 staging 协议。
3. `allowed_actions` / `next_action` 可返回 `abort`，CLI 却没有 `abort` 子命令，动作权威与可执行命令不对称。

这三处缺口使 RunLogos 只能读取未冻结的内部 `MERGE_RECEIPT.json`、自建 staging/commit 规则或把 `abort` 猜测为人工分支，会重新产生本轮根修复要删除的第二事务权威。用户已批准暂停 RunLogos `adopt-openlogos-merge-transaction-authority` Delta，先由本 follow-up 补齐公共消费者合同。

## 变更类型

接口级（兼具需求验收纠偏、本地 CLI JSON/schema 合同增强与代码修复）。

## 变更范围

- 影响的需求文档：`core-01-requirements.md`；修正 S05/S09/S11/S16/S19/S39 的可执行动作、Agent staging 和 completed receipt 验收条件。
- 影响的功能规格：`core-01-feature-specs.md`；定义公共 slot descriptor/staging 交接、abort 终结语义和完整 receipt shape。
- 影响的架构：`core-01-architecture-overview.md`；确保 OpenLogos 签发写域、校验内容、生产提交白名单并清理私有事务制品。
- 影响的业务场景：S05、S09、S11、S16、S19、S39；不新增场景 ID。
- 影响的 API：无 HTTP/RPC/消息 API；修改已发布的本地 CLI JSON/schema 公共合同。
- 影响的 DB 表：无。
- 影响的编排测试：API orchestration 不适用；更新 S05/S09/S11/S16/S19/S39 CLI ST、部署 smoke 与后续 RunLogos 真实跨进程 E2E。
- 新测试 ID 从已占用上界之后分配：S05 `UT-S05-43` / `ST-S05-20`，S09 `UT-S09-251` / `ST-S09-99`，S11 `UT-S11-71` / `ST-S11-42`，S16 `UT-S16-28` / `ST-S16-09`，S19 `UT-S19-19` / `ST-S19-14`，S39 `UT-S39-51` / `ST-S39-26`；smoke 从 `SMOKE-core-151` 起。

## 变更概述

本提案不重建 merge transaction，而是将已存在的内部完成事实提升为唯一、完整、可验证的公共消费者合同。`content_slots.items[]` 将由 OpenLogos 签发稳定 slot identity、opaque target ref、项目根相对 staging path、编码、大小上限与原子写协议；`submit-content` 只接受该声明路径。Agent 不获得 canonical target、Git、OpenLogos 命令或私有 journal 写权。

completed receipt 将公开冻结 schema/contract/transaction/plan/change/module identity、`changed_paths`、`created_paths`、逐路径 payload `final_hashes`、metadata/test-change-set/`SPEC_MERGED` 摘要和精确 `commit_paths`。持久化 receipt 不自嵌自身文件 hash；外层 completed projection 另行返回 receipt/marker 的 `artifact_hashes`，两层 hash 并集覆盖全部 `commit_paths`。content/staging/backup/journal 不进入提交集并在 completed/abort 后清理。新增 `merge transaction abort` 使所有已知 action 都有唯一可执行命令；未知 action/schema/hash 仍 fail closed。

本地 candidate 保持尚未公开发布的 `0.14.0` package identity，但旧 tarball/schema/contract hash 明确失效。verify 通过并获得部署执行授权后，重新 pack/install，冻结新 tarball SHA-256、schema SHA-256、contract SHA-256 和 golden JSON，供 RunLogos 恢复下游提案。

## 公共合同的无环 hash 与 abort 终态

- `payload_paths = changed_paths ∪ created_paths`，表示事务产生的非自引用正式 payload；`final_hashes[]` 必须与 `payload_paths` 逐路径一一对应。
- 持久化 `MERGE_RECEIPT.json` 包含 payload closure、`commit_paths`、`receipt_sha256`；`receipt_sha256` 是排除该字段后 canonical receipt payload 的 identity，不是 `MERGE_RECEIPT.json` 文件 hash。
- `commit_paths = payload_paths ∪ {MERGE_RECEIPT.json, SPEC_MERGED}`；持久化 receipt 不包含 receipt/marker 自身文件 hash，从而不形成自引用或互引用。
- 公共 completed projection 在 receipt 对象外层返回 `artifact_hashes[] = [{path, sha256}]`，精确覆盖 `MERGE_RECEIPT.json` 与 `SPEC_MERGED`。`final_hashes ∪ artifact_hashes` 的路径集必须精确等于 `commit_paths`，且两者不得重叠。
- OpenLogos 在输出 completed 前同时校验 payload closure、receipt identity、外层 artifact hashes 与磁盘字节；status/recover 从同一持久事实重建外层 hash，不从 Git 或目标扫描发明新 closure。
- `abort` 仅在 `collecting|ready|sealed` 允许；成功后固定为 `phase=failed`、`classification=aborted`、`allowed_actions=[]`、`next_action=null`、`receipt=null`，持久化 `aborted_at` 并清理 content/staging/backup/journal，正式 payload/receipt/marker 不存在。
- 对同一 `failed/aborted` transaction 重复 `abort` 作为终态幂等重放返回同一 identity/`aborted_at`，不重写文件；`recover` 和其它动作均拒绝。普通 fatal `failed` 不再暴露 `abort`，只有 `recovery_required` 可暴露 `recover`。

## stacked change 与 guard 交接

1. 原 OpenLogos 主 worktree 继续由 `refresh-merge-transaction-cross-repo-plan` guard 独占；其 `SMOKE-core-150`、`DEPLOY_DONE`、`SMOKE_FAIL`、部署报告和最终 archive 始终归属旧 slug，follow-up 不改写这些 marker。
2. follow-up 只在独立 branch/worktree `change/complete-merge-transaction-consumer-contract` 及其 guard 下产出 Delta、merge、code、verify、deploy 证据；两个 worktree 不共用 marker、不切换 guard、不在对方 slug 下修文档或代码。
3. follow-up verify 通过并本机部署修正 candidate 后，RunLogos 恢复并完成真实 E2E，产生同一条 `OPENLOGOS_RUNLOGOS_VERIFY_COMMAND`。
4. 先在原主 worktree 用该命令重跑旧提案正式 smoke，使 `SMOKE-core-150` PASS，再经独立 archive 授权归档旧 slug，清除主 worktree guard。
5. 然后在 follow-up worktree 运行归属新 slug 的 `SMOKE-core-151+` 全量正式 smoke；PASS 后经独立 archive 授权归档 follow-up。
6. 两个归档提交均完成且主 worktree 干净后，再将 follow-up branch 合入 master；冲突按两个 completed receipt/commit_paths 和已合并规格解决，合入后重跑 CLI 全量 UT/build 与安装态合同自检。不使用拷贝 guard、删除 guard 或在已归档 slug 下追加实现的方式交接。

## 部署影响

- 是否需要部署：是
- 部署原因：RunLogos 只能验收真实全局 candidate 的公共进程合同；源码/mock 不能证明打包资产和命令面一致。
- 影响环境：本机全局 npm prefix 与隔离测试目录；不发布到 npm registry、GitHub Release 或官网。
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；冻结当前全局 candidate 的 tarball、SHA-256、入口与恢复命令。
- 是否需要 smoke：是
- smoke 说明：先执行安装态合同/abort/staging/receipt 自检；RunLogos 完成后再回传真实 E2E 命令执行正式 smoke。

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

本案只修正 CLI JSON/schema、文件事务和安装态验收，不新增页面、交互或视觉资产。

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data:
    status: none
    reason: 事务制品均为提案目录内文件，不涉及业务数据或数据库迁移。
  compatibility:
    status: none
    reason: 用户已选择上游 follow-up 完整冻结新合同；RunLogos 不消费旧 hash、内部 receipt 或兼容推导。
  security_privacy:
    status: none
    reason: staging path 必须项目根 containment、禁止 symlink/路径逃逸、限制字节数并且不处理 Secret 或个人数据。
  public_release:
    status: none
    reason: 用户只批准本机 candidate 部署和合同冻结，未授权 npm publish、tag、GitHub Release、官网发布或 git push。
  external_commitment:
    status: none
    reason: 本案不新增第三方服务、账号、费用、SLA 或对外交付时间承诺。
decisions:
  - id: C01
    category: ownership
    question: 跨仓环路发现公共 merge transaction 合同缺口时，是否由 OpenLogos follow-up 先补齐？
    answer: 是；暂停 RunLogos Delta，先落地 `complete-merge-transaction-consumer-contract`，完成 verify、本机部署与合同重新冻结后再恢复 RunLogos。
    rationale: 公共 receipt、staging 和 action-command parity 属于 OpenLogos 唯一权威责任；下游自建规则会重现多权威 bug。
    source: user
    affects:
      - OpenLogos S05/S09/S11/S16/S19/S39 公共合同、实现与验收
      - 本机全局 candidate 和新双 hash 冻结
      - RunLogos `adopt-openlogos-merge-transaction-authority` 恢复条件
    rejected_options:
      - RunLogos 直接读取未冻结的内部 `MERGE_RECEIPT.json`
      - RunLogos 自建 staging、commit paths 或 abort 兼容分支
  - id: C02
    category: deployment
    question: follow-up 是否保持未公开的 `0.14.0` candidate identity 并在 verify 后重新本机全局部署？
    answer: 是；保持 `0.14.0` 以兼容已合并的部署/smoke 规格，但作废旧 candidate hash，重新 pack、install 并冻结 tarball/schema/contract hash。
    rationale: "`0.14.0` 尚未获得公开发布授权，本次是 candidate 合同纠偏；保持版本身份可避免旧提案 `SMOKE-core-150` 精确版本断言与新候选包形成新环。"
    source: user
    affects:
      - npm tarball 与本机全局入口
      - schema/contract/golden 新冻结值
      - 旧 candidate 回滚证据
    rejected_options:
      - 直接将 follow-up 候选包改名为新公开版本
      - 只跑源码态测试而不重新安装全局 candidate
  - id: C03
    category: ownership
    question: 原 OpenLogos 变更尚处于 smoke-failed 时，follow-up 如何保持 guard、marker、smoke 和 archive 所有权合法？
    answer: 采用独立 branch/worktree 的 stacked change；旧 slug 独占主 worktree 与 `SMOKE-core-150`，新 slug 独占 follow-up worktree 与 `SMOKE-core-151+`。RunLogos 回传后先归档旧 slug，再归档 follow-up，最后将 follow-up branch 合入已无 guard 的 master 并复验。
    rationale: 主仓事实显示旧 guard 不能在 RunLogos 接缝前归档；独立 worktree 能保证每个 slug 只修自己范围，且不删 guard、不混用 marker。
    source: repository_fact
    affects:
      - 两个 OpenLogos worktree/branch 的 guard 与修改边界
      - "`SMOKE-core-150` 与 `SMOKE-core-151+` 的 slug 归属"
      - 旧变更、follow-up 和 master integration 的顺序
    rejected_options:
      - 手工删除或改写旧 guard 以在主 worktree 硬切 follow-up
      - 在旧 slug 中直接实现 follow-up 或共享 verify/smoke/archive marker
unresolved: []
defaults: []
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
      mode: MODIFY
      delta_path: "deltas/decisions/core-D07-merge-transaction-single-authority.md"
      reason: "补齐公共 staging、完整 receipt 和 action-command parity 责任。"
      evidence: ["target_exists: logos/resources/decisions/core-D07-merge-transaction-single-authority.md"]
      missing_evidence: []
    - category: requirement
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "把已合并但未实现的消费者合同改为可验证强验收条件。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "冻结 slot/staging、abort 和 completed receipt shape。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md", "existing: section 2.44"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "保证 OpenLogos 签发写域、生产提交闭包并清理私有制品。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"
      reason: "next 只投影每个已知且可执行的 transaction action。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "补齐 staging 交接、abort 和 receipt 幂等恢复时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md"
      reason: "Git 提交精确限定为公共 receipt.commit_paths。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md"
      reason: "status 只读返回完整不可变 slot/receipt 投影。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"
      reason: "定义新 projection、abort 与完整 receipt JSON 字段。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "冻结修正后 0.14.0 candidate 安装态与 RunLogos 回传门。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"
      reason: "receipt 覆盖全闭包 hash/commit paths，私有制品不进白名单。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "作废旧 hash，定义修正包 pack/install/自检/回滚与重新冻结。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "proposal: deployment_required=true"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/skills/merge-executor/SKILL.en.md"
      reason: "英文 Skill 同步声明 staging、submit/abort 和 receipt-only 边界。"
      evidence: ["target_exists: skills/merge-executor/SKILL.en.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/skills/merge-executor/SKILL.md"
      reason: "中文 Skill 同步声明 staging、submit/abort 和 receipt-only 边界。"
      evidence: ["target_exists: skills/merge-executor/SKILL.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/spec/baseline-closure.md"
      reason: "明确全闭包 final hashes/commit paths 与私有制品排除。"
      evidence: ["target_exists: spec/baseline-closure.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "规格提交白名单唯一绑定 completed receipt.commit_paths。"
      evidence: ["target_exists: spec/change-management.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S09, S11, S16]
      mode: MODIFY
      delta_path: "deltas/spec/cli-json-output.md"
      reason: "定义 slot descriptors、abort 命令与完整 receipt JSON 合同。"
      evidence: ["target_exists: spec/cli-json-output.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S09, S11, S19]
      mode: MODIFY
      delta_path: "deltas/spec/flow-spec.md"
      reason: "allowed action 必须映射唯一命令，宿主不猜测 staging/提交集。"
      evidence: ["target_exists: spec/flow-spec.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S16, S39]
      mode: MODIFY
      delta_path: "deltas/spec/schema/merge-transaction.schema.json"
      reason: "扩展 @1 slot descriptors、receipt closure 和 abort 一致性。"
      evidence: ["target_exists: spec/schema/merge-transaction.schema.json"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S16]
      mode: MODIFY
      delta_path: "deltas/spec/schema/next.schema.json"
      reason: "next 投影校验新合同与动作对称。"
      evidence: ["target_exists: spec/schema/next.schema.json"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S11, S16]
      mode: MODIFY
      delta_path: "deltas/spec/schema/status.schema.json"
      reason: "status 投影校验完整 slot/receipt 字段。"
      evidence: ["target_exists: spec/schema/status.schema.json"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/spec/tasks-spec.md"
      reason: "冻结 Agent 只写签发 staging path、OpenLogos 独占正式闭包。"
      evidence: ["target_exists: spec/tasks-spec.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/test/core-S05-test-cases.md"
      reason: "补充 abort 映射、未知 action fail-closed 与 next 零推导 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S05-test-cases.md", "next_ids: UT-S05-43/ST-S05-20"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "补充 staging/submit、abort、完整 receipt 与 response-lost UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md", "next_ids: UT-S09-251/ST-S09-99"]
      missing_evidence: []
    - category: test
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/test/core-S11-test-cases.md"
      reason: "补充 status 对 slot descriptors 和 receipt 的真只读投影 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S11-test-cases.md", "next_ids: UT-S11-71/ST-S11-42"]
      missing_evidence: []
    - category: test
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/test/core-S16-test-cases.md"
      reason: "补充 schema、双 hash、action-command parity 和 golden JSON UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S16-test-cases.md", "next_ids: UT-S16-28/ST-S16-09"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "补充修正 candidate pack/install/self-check/回滚与旧 hash 拒绝 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md", "next_ids: UT-S19-19/ST-S19-14"]
      missing_evidence: []
    - category: test
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/test/core-S39-test-cases.md"
      reason: "补充全闭包 hash/commit_paths、私有制品排除与 Git 白名单 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S39-test-cases.md", "next_ids: UT-S39-51/ST-S39-26"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "验证全局修正 candidate、新 hash、abort/staging/receipt 与 RunLogos 接缝。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "next_id: SMOKE-core-151", "proposal: smoke_required=true"]
      missing_evidence: []
    - category: api
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "只修改本地 CLI/JSON/文件合同，不新增 HTTP、RPC 或消息 API。"
      evidence: ["architecture: local CLI process boundary"]
      missing_evidence: []
    - category: database
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "transaction、staging、journal 和 receipt 不使用数据库。"
      evidence: ["architecture: filesystem-backed proposal transaction"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "API 维度为 SKIP；CLI ST、smoke 与 RunLogos 真实 E2E 覆盖跨进程接缝。"
      evidence: ["api_disposition: SKIP", "acceptance: RunLogos real E2E"]
      missing_evidence: []
```

## 完成定义

1. public content slot 具有 OpenLogos 签发的 descriptor/staging path；逃逸、symlink、非声明来源、编码/大小/hash 不符均在正式写前 fail closed。
2. `abort` 只在 `collecting|ready|sealed` 出现且必有 CLI 子命令；成功终态固定为 `failed/aborted`、动作清空、receipt 为 null，重放幂等，未知 action 稳定拒绝。
3. 持久化 receipt 使用排除自身 identity 字段的 canonical payload hash；`final_hashes` 覆盖 payload，外层 `artifact_hashes` 覆盖 receipt/marker，两者无重叠并精确覆盖 `commit_paths`。
4. status/recover/response-lost 返回字节等价 receipt；RunLogos 无需读内部文件或重算目标集。
5. verify PASS 后在独立授权下本机全局安装修正后 `0.14.0` candidate，记录新 tarball/schema/contract hash 与回滚证据。
6. 安装态自检通过后恢复 RunLogos；回传后先使旧 `SMOKE-core-150` PASS 并归档旧 slug，再使 follow-up `SMOKE-core-151+` PASS 并归档新 slug，最后合入 master 并复验。
