# 变更提案：fix-merge-transaction-preflight-reopen

> module: core | created: 2026-08-30

## 变更原因

RunLogos 在执行 `openlogos merge fix-status-next-timestamp-generation-conflict` 时，已完成 15 个 content slot 的提交并成功 seal，但 apply 在生成 `test-change-set` 时才发现正式基线 `logos/resources/test/core-S44-test-cases.md` 中 `UT-S44-24` 少一列，返回 `internal_failure: test-change-set-ambiguous-table`。本次失败发生在任何正式目标写入之前，说明 fail-closed 生效，但暴露了两个流程缺口：

1. `test-change-set`、after 测试表结构等可由候选内容确定的校验没有在 seal 前完成，错误被推迟到 apply 才暴露；
2. 已 sealed 的事务只有 apply/abort，没有把“可由修正某个 Agent slot 解决的前置校验错误”安全退回 collecting 的公共路径。abort 又是终态，会丢掉已经正确提交的其余 14 个 slot，迫使消费者整单重建。

现有规格已经要求“Agent 内容语义或 validator 失败保持 collecting、允许替换对应 slot 后重新 seal”，但当前实现只覆盖单文件 Delta 合成校验，没有覆盖 OpenLogos-produced 的 `test-change-set` 等跨目标确定性派生产物。本提案补齐这个实现与规格断点，并用同一 RunLogos 真实事务验证恢复能力。

## 变更类型

接口级（兼具状态机行为修复、原子事务前置校验、patch candidate 部署与跨仓恢复验收）。

## 变更范围

- 影响的需求文档：`core-01-requirements.md`，补充 seal 前确定性 preflight 和同事务可修复恢复验收。
- 影响的功能规格：`core-01-feature-specs.md`，明确 preflight 覆盖范围、可归因失败和 sealed→collecting 转移语义。
- 影响的架构与决策：`core-01-architecture-overview.md`、`core-D07-merge-transaction-single-authority.md`，冻结“正式写入前派生、按 slot 归因、保留无关提交”的单一权威边界。
- 影响的业务场景：S05 下一步动作投影、S09 合并生命周期、S11 状态投影、S16 机器输出、S19 本机部署门、S39 baseline/test-change-set 原子闭包；不新增场景 ID。
- 影响的方法论规格：`change-management.md`、`baseline-closure.md`、`cli-json-output.md`、`flow-spec.md` 与双语 `merge-executor` Skill。
- 影响的 API：无 HTTP/RPC/消息 API；只修正本地 CLI merge transaction 行为，不新增命令或公共 JSON 字段。
- 影响的 DB 表：无。
- 影响的编排测试：API orchestration 不适用；由真实 CLI ST、安装态 smoke 和 RunLogos 真实事务恢复覆盖。
- 新测试 ID 从真实已占用上界之后分配：S05 `UT-S05-46` / `ST-S05-21`，S09 `UT-S09-261`～`UT-S09-265` / `ST-S09-102`～`ST-S09-103`，S11 `UT-S11-74` / `ST-S11-43`，S16 `UT-S16-33`～`UT-S16-34` / `ST-S16-10`，S19 `UT-S19-24`～`UT-S19-25` / `ST-S19-16`，S39 `UT-S39-56`～`UT-S39-58` / `ST-S39-27`；smoke 使用 `SMOKE-core-160`～`SMOKE-core-162`。既有 `UT-S05-36`、`UT-S09-239`、`UT-S11-63` 继续作为历史合同锚，新用例负责把旧 sealed reopen、结构化归因和崩溃窗口落实为独立可失败的真实断言，不再只把多个 ID 挂在宽泛 happy-path 测试名称上。

## 变更概述

OpenLogos 在 seal 冻结事务之前，先以正式 before 字节和所有候选 final 字节构建一份只读 preflight view，并执行所有不需要正式写入即可确定的校验：Delta 合成结果、目标身份与 hash、after 测试表结构和 ID 唯一性、`test-change-set`、metadata/counter/index 计划、dogfood/prototype 绑定以及最终 target set。全部通过后才写入 sealed phase 与 `seal_sha256`，因此新事务不会再把可修复内容错误带入 sealed。preflight 不是一次性探测：其 canonical identity 必须进入 seal 绑定，apply 只能提交与该 identity 完全相同的确定性结果。

为兼容本次已经 sealed 的真实事务，apply 在写 `phase=applying`、journal、backup、apply staging 或正式目标之前复用同一 preflight。若错误能够唯一归因到一个或多个 Agent content slot，OpenLogos 先原子持久化权威 collecting 状态，再清理已失去权威性的旧 slot 私有字节；保留其它正确 slot 的 submitted content hash，把同一 transaction 退回 `collecting`，公开既有 `slot_identity_mismatch + retryable=true` 错误及更新后的 `missing_slot_ids/allowed_actions/next_action`。消费者只需修正缺失 slot、重新 submit、seal、apply；transaction ID、plan identity、target set 和未受影响 slot 的 submitted content hash 均保持不变。

不可归因于 Agent 内容的 contract/schema、OpenLogos producer、plan drift、路径越权或内部 hash 不变量错误不得伪装成 collecting 重试；它们继续 fail closed，并保留可操作诊断。任何 reopen 都必须发生在首个正式写入和 apply journal 之前；一旦进入 applying 或产生 journal，只能走既有 recover/rollback，不允许倒退 collecting。

本提案计划以本机 patch candidate `0.14.2` 交付。规格 merge、代码实现和 verify 均通过后，仍须在独立部署确认点获得用户明确授权，才可构建真实 npm tarball、冻结 SHA-256、在隔离 prefix 完成安装/回滚验证并覆盖本机全局 0.14.1；smoke 与恢复 RunLogos 同一事务 `mtx_7e0341e3719feccd22ef7615` 也分别遵守对应确认点。提案批准只批准方案与后续 Delta 范围，不等于授权 merge、verify、部署、smoke、RunLogos merge、archive、远程发布或 git push。

## 核心状态机与原子边界

```text
collecting --submit all--> ready --preflight PASS + seal--> sealed
     ^                                      |
     |                                      | apply preflight 发现可归因内容错误
     +-- clear only rejected slots ----------+

sealed --apply preflight PASS--> applying --atomic batch--> completed
applying/recovering --故障--> 仅 recover/rollback；禁止 reopen
```

- seal preflight 失败时从未形成新的 sealed 快照；事务保持/退回 collecting，只有被拒绝 slot 重新进入 missing 集合。
- 兼容已 sealed 事务的 apply preflight 必须在 `phase=applying` 持久化之前运行；失败时目标树、metadata、counter/index、receipt、marker、journal、apply backup/staging 全部保持 apply 前事实。reopen 状态成功落盘后，只允许 best-effort 清理 rejected slot 的 producer staging/content 私有字节。
- `slot_identity_mismatch` 沿用现有公共 classification；本案不新增 action、classification、phase 或 JSON 字段，避免无必要的协议破坏。
- 归因依据来自 canonical target→slot 映射和失败 target path，不按错误消息文本猜测；无法唯一归因时不清 slot、不自动 reopen。
- reopen 保留 transaction ID、plan hash、target set 和无关 slot 的 submitted content hash；清除外层旧 seal hash/时间、全部 target 的 sealed hash、受影响 slot 的 submitted content hash，并重新计算 phase/actions 投影。全部 sealed hash 必须在重新 seal 时从当前完整候选集重算，禁止混用旧快照。

## Preflight 冻结合同与旧事务兼容

preflight 必须是纯只读、确定性计算，内部至少产出以下 canonical facts：

- transaction/plan/target-set identity；
- 每个正式 target 的 path、mode、producer、before hash 与 candidate final hash；
- metadata/counter/index 等 OpenLogos 派生 target 的 before hash、candidate final hash 与 producer；
- after 测试定义扫描结果、`test-change-set` canonical hash；
- dogfood/prototype 绑定结果和最终提交 target path 集合；
- 排除 apply 时刻才产生的 `completed_at` 等非确定性字段。

新 seal 必须把上述 facts 的 canonical `preflight_sha256` 纳入 `seal_sha256` 计算；内部存储可以增加向后兼容的可选 preflight 记录，但本案不增加公共 projection 字段。apply 必须先重算同一 view，并逐项确认 before hash、candidate final hash、派生产物 hash 与 target path 集合均等于 sealed view；任一漂移在写 `phase=applying` 前 fail closed。尤其 `logos/logos-project.yaml` 在 seal 与 apply 之间发生变化时不得基于新字节静默 rebase，必须按不可归因 drift 拒绝并保留 sealed 事实。

对 0.14.1 已 sealed 且没有 preflight 记录的事务采用唯一兼容分支：apply 首写前生成一次临时 preflight；若发现可归因内容错误则按本提案 reopen；若通过则保留原 legacy seal identity 完成本次 apply，不回写伪造的新 seal。旧事务一旦因内容错误 reopen，后续重新 seal 必须生成新 preflight 记录与新 `seal_sha256`，但 transaction ID、plan hash、target set 不变。不得因缺少新内部字段拒绝读取本次 RunLogos 真实事务，也不得把任意历史 completed/已写 journal 事务迁移为 collecting。

## 结构化归因与 reopen 崩溃一致性

所有参与 preflight 的 validator/producer 必须返回或抛出内部结构化错误，至少包含稳定 `code`、canonical `target_paths[]`、`producer` 与 `retryable`；`target_paths[]` 去重并按 ASCII 排序。`test-change-set-ambiguous-table` 等错误不得再只把 path 编进自然语言消息。错误 envelope 的公共字段保持现状，内部结构化事实只用于稳定分类和 target→slot 归因。

归因规则为：每个失败 target path 必须通过冻结的 canonical target map 唯一映射到 `producer=agent` 的 slot，且全部错误均属于候选内容可修复类别，才可形成 rejected slot set。多个可唯一归因的 Agent target 可以在同一次 reopen 中共同退回；任一 target 无映射、多映射、属于 OpenLogos producer，或错误属于 contract/schema、plan/source/before/seal drift、路径 containment、内部 hash 不变量时，整次失败均不可 reopen，不清任何 slot。

reopen 使用以下崩溃安全顺序，不声称跨文件删除具有物理原子性：

1. 确认不存在 apply journal、receipt、marker、apply staging/backup，且正式 target before hash 全部未变；
2. 在内存构造新权威状态：`phase=collecting`、`classification=slot_identity_mismatch`、外层 `seal_sha256=null`、全部 target `sealed_sha256=null`、仅 rejected slots 的 `content_sha256=null`，其它 submitted content hash 保留；
3. 通过临时文件 + fsync + atomic rename 一次性替换 `MERGE_TRANSACTION.json`；只有该步成功后，公共错误才可返回 retryable collecting 投影；
4. best-effort 清理 rejected slots 的 `merge-content` 与 `merge-staging` 旧字节。若步骤 3 后崩溃，残留字节不再权威且后续 submit 必须原子覆盖；若步骤 3 前崩溃，原 sealed 事务仍完整，可再次执行同一 preflight；
5. 清理失败不得把 collecting 改回 sealed，也不得误删未受影响 slot。status/next 只读权威 transaction state，不从残留私有文件反推 submitted。

由此，reopen 的逻辑状态转换是单文件原子的，私有字节回收是可重放清理；不需要为首写前错误创建 apply journal，也不会制造“sealed 事务引用已被先删除 slot”的中间态。

## RunLogos 真实事务恢复闭环

1. 部署 0.14.2 后，在 RunLogos 项目根读取既有 transaction status，确认 transaction ID、plan hash、15 个 slot 与 seal hash仍对应原事务。
2. 对同一 sealed transaction 执行 apply；OpenLogos 必须在零正式写入条件下返回 retryable，并把 `core-S44-test-cases.md` 对应 slot 置为 missing，其余 14 个 slot 保持 submitted。
3. 在 RunLogos 当前 `fix-status-next-timestamp-generation-conflict` 提案范围内修复 `UT-S44-24`：为六列表格补齐“预期输出”单元格，不改测试 ID 或需求语义。
4. 重新生成该 target 的最终内容，按声明 staging path 原子写入并 submit；不得直接写正式测试文档、transaction 私有文件、receipt 或 marker。
5. 对同一 transaction 重新 seal/apply，直至 `phase=completed`；校验 `commit_paths/final_hashes/artifact_hashes`、test change set 和 `SPEC_MERGED`，再按 receipt 精确提交规格。
6. 如果修正后的 slot 仍有真实内容问题，重复步骤 3～5；如果出现不可归因 fatal、plan drift 或 journal/recovery 错误，停止自动清 slot并按稳定分类诊断，绝不通过 abort/新事务掩盖原因。

## 非目标

- 不为用户手工构造或长期保存旧版本提案提供兼容迁移器；本次只恢复仍存在且未产生正式写入的真实 transaction。
- 不允许 sealed 后任意编辑 slot；只有 OpenLogos preflight 明确认定、且首写前可归因的 slot 才能被系统退回。
- 不改变 abort 的终态语义，不新增 `reopen` 人工命令，不让 RunLogos维护第二套状态转换表。
- 不放宽 after 测试表的列数、唯一 ID、UTF-8、路径 containment 或 hash 校验；`UT-S44-24` 必须真正修好，不能靠忽略歧义通过。
- 不公开发布 0.14.2，不执行远程发布、tag、release、官网部署或 git push。

## 部署影响

- 是否需要部署：是
- 部署原因：RunLogos 的 sealed 事务只能由实际全局 OpenLogos CLI 恢复；源码测试或 mock 不能替代真实跨进程状态迁移。
- 影响环境：隔离 npm prefix、本机全局 npm OpenLogos 与 RunLogos 当前提案；不触达其它用户项目。
- 是否涉及数据迁移：否；只升级 CLI package 和事务局部状态文件。
- 是否需要回滚预案：是；部署前冻结当前 0.14.1 tarball、全局入口、realpath、package/plugin/asset identity 与可复制恢复命令。
- 是否需要 smoke：是
- smoke 范围：覆盖新事务、旧 sealed 事务、0.14.2 安装态和 RunLogos 真实恢复。
- 失败边界：隔离 pack/install/verify/rollback 任一步失败不覆盖全局；全局安装或自检失败立即恢复固定 0.14.1；RunLogos 恢复失败不得伪造 completed/marker。

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

本案只修正 CLI 状态机、文件事务与本机安装态，不新增页面、交互或视觉资产。

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data:
    status: none
    reason: 只处理提案目录事务制品与正式规格文件，不涉及数据库或业务数据迁移。
  compatibility:
    status: none
    reason: 采用 seal 前 preflight，并仅为首写前的既有 sealed 事务提供按 slot 归因的同事务 reopen；不提供任意历史提案迁移。
  security_privacy:
    status: none
    reason: 沿用项目根 containment、symlink 拒绝、slot 大小/编码/hash 校验，不读取 Secret 或个人数据。
  public_release:
    status: none
    reason: 本提案只规划本机 0.14.2 patch candidate；部署、smoke、RunLogos 恢复及任何公开发布均按各自确认点另行授权。
  external_commitment:
    status: none
    reason: 不新增第三方服务、账号、费用、SLA 或外部时间承诺。
decisions:
  - id: C01
    category: ownership
    question: 是否把 RunLogos 的 UT-S44-24 缺列基线修复纳入当前跨仓闭环？
    answer: 是；由 OpenLogos 先提供 preflight/reopen，再在 RunLogos 当前提案中只替换对应 slot 并继续同一 transaction。
    rationale: 缺列属于 after 严格基线必须修复的真实内容问题；忽略它会破坏 test-change-set 可信性，整单 abort 又会浪费其余正确 slot。
    source: user
    affects:
      - OpenLogos S05/S09/S11/S16/S39 状态机、动作/状态投影、机器合同与测试闭包
      - RunLogos UT-S44-24 最终内容和现存 transaction 恢复
    rejected_options:
      - 放宽或跳过 after 歧义表校验
      - abort 后重建全部 15 个 slot
  - id: C02
    category: compatibility
    question: 可修复错误发生在已 sealed 事务时，如何恢复？
    answer: OpenLogos 仅在首个 apply 写入前、且错误可唯一归因到 Agent slot 时，清除受影响 slot并将同一事务退回 collecting；其余 slot 和 identity 保持。
    rationale: 这兑现既有 collecting+retryable 合同，同时不把任意 sealed 编辑能力暴露给消费者。
    source: user
    affects:
      - merge transaction phase transition
      - slot 私有制品清理与错误 envelope
      - status/next 的既有动作投影
    rejected_options:
      - 新增不受约束的人工 reopen 命令
      - 让 RunLogos 直接修改 transaction 私有文件
      - 先删除 slot 私有字节、再尝试持久化 collecting 状态
  - id: C03
    category: deployment
    question: 修复如何交付并恢复当前 RunLogos merge？
    answer: 计划交付本机 0.14.2 patch candidate；规格 merge、代码实现与 verify 通过后，分别在部署、smoke 和 RunLogos 恢复确认点取得用户明确授权，再执行对应动作。
    rationale: 必须以真实全局进程合同验证修复，且新 patch 版本可与当前 0.14.1 回滚基线清晰区分。
    source: user
    affects:
      - package/plugin/asset candidate identity
      - 本机全局 OpenLogos
      - RunLogos 当前提案 merge 完成条件
    rejected_options:
      - 只修源码而不部署
      - 复用 0.14.1 版本号覆盖不同字节
      - 以 proposal.md 自身声明替代后续人类确认点
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
      reason: "补充 preflight 冻结、结构化归因、崩溃安全 reopen 和非可归因错误边界。"
      evidence: ["target_exists: logos/resources/decisions/core-D07-merge-transaction-single-authority.md"]
      missing_evidence: []
    - category: requirement
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "增加 seal 前失败、既有 sealed 恢复和真实跨仓验收条件。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "冻结 preflight、slot 归因、collecting retry 与 patch candidate 行为。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md", "existing: section 2.44"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "把确定性派生校验前移并绑定 seal，定义旧事务兼容和崩溃安全可逆边界。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md"
      reason: "把 preflight reopen 后的 collecting/missing-slot/submit-content 动作投影纳入 next 权威时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md", "existing_contract: retryable validator keeps collecting"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "补充 ready→seal preflight 与 sealed→collecting 兼容恢复时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md"
      reason: "明确消费者只按 missing slot 重提，不直接编辑正式目标或事务私有文件。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md"
      reason: "明确 status 只投影原子落盘后的 collecting 权威状态，不从残留 slot 私有字节反推 submitted。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md", "existing_contract: collecting status projection"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"
      reason: "定义 retryable error 与退回 collecting 后投影的同源机器语义。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "定义 0.14.2 安装态、回滚和 RunLogos 真实事务恢复门。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"
      reason: "把 test-change-set 等确定性派生物纳入 seal/apply 共用 preflight。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "定义 0.14.2 pack、隔离安装、本机全局部署、0.14.1 回滚及跨仓恢复。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "proposal: deployment_required=true"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S05, S09, S11, S39]
      mode: MODIFY
      delta_path: "deltas/skills/merge-executor/SKILL.en.md"
      reason: "英文执行合同补充 preflight retry、missing slot 替换和同事务继续规则。"
      evidence: ["target_exists: skills/merge-executor/SKILL.en.md"]
      missing_evidence: []
    - category: skill
      scenario_ids: [S05, S09, S11, S39]
      mode: MODIFY
      delta_path: "deltas/skills/merge-executor/SKILL.md"
      reason: "中文执行合同补充 preflight retry、missing slot 替换和同事务继续规则。"
      evidence: ["target_exists: skills/merge-executor/SKILL.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/spec/baseline-closure.md"
      reason: "规定 test-change-set/metadata 等派生产物在 seal 前可预演校验。"
      evidence: ["target_exists: spec/baseline-closure.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09, S39]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "补充 seal/apply 共用 preflight 与可修复状态迁移。"
      evidence: ["target_exists: spec/change-management.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S09, S11, S16]
      mode: MODIFY
      delta_path: "deltas/spec/cli-json-output.md"
      reason: "明确沿用现有 classification/action 字段表达 reopen 后状态和 retryable error。"
      evidence: ["target_exists: spec/cli-json-output.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S05, S09, S11, S16]
      mode: MODIFY
      delta_path: "deltas/spec/flow-spec.md"
      reason: "flow 必须跟随事务退回 collecting 后的 missing slot 与 submit-content 动作。"
      evidence: ["target_exists: spec/flow-spec.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S05]
      mode: MODIFY
      delta_path: "deltas/test/core-S05-test-cases.md"
      reason: "在既有 UT-S05-36 合同锚之外，新增旧 sealed reopen 后 next 动作投影的独立 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S05-test-cases.md", "existing: UT-S05-36/ST-S05-20", "next_ids: UT-S05-46/ST-S05-21"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "规划 seal preflight、旧 sealed reopen、slot 保留和不可逆边界 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md", "next_ids: UT-S09-261/ST-S09-102"]
      missing_evidence: []
    - category: test
      scenario_ids: [S11]
      mode: MODIFY
      delta_path: "deltas/test/core-S11-test-cases.md"
      reason: "在既有 UT-S11-63 合同锚之外，新增崩溃窗口与残留私有字节下 status 权威投影 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S11-test-cases.md", "existing: UT-S11-63", "next_ids: UT-S11-74/ST-S11-43"]
      missing_evidence: []
    - category: test
      scenario_ids: [S16]
      mode: MODIFY
      delta_path: "deltas/test/core-S16-test-cases.md"
      reason: "规划 retryable error、collecting projection 与 status/next/schema 同源 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S16-test-cases.md", "next_ids: UT-S16-33/ST-S16-10"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "规划 0.14.2 制品身份、0.14.1 回滚和安装态恢复 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md", "next_ids: UT-S19-24/ST-S19-16"]
      missing_evidence: []
    - category: test
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/test/core-S39-test-cases.md"
      reason: "规划歧义 after 表、test-change-set preflight、零写和按 target 归因 UT/ST。"
      evidence: ["target_exists: logos/resources/test/core-S39-test-cases.md", "next_ids: UT-S39-56/ST-S39-27"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "规划新事务 seal 拒绝、旧 sealed 恢复和 RunLogos 原事务完成 smoke。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "next_ids: SMOKE-core-160"]
      missing_evidence: []
    - category: api
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "本案只改变本地 CLI 文件事务，不新增 HTTP、RPC 或消息 API。"
      evidence: ["architecture: local CLI process boundary"]
      missing_evidence: []
    - category: database
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "本案无持久化业务实体或数据库 schema 变化。"
      evidence: ["repository_fact: file-backed merge transaction"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S05, S09, S11, S16, S19, S39]
      mode: SKIP
      delta_path: null
      reason: "项目无 HTTP API；跨进程接缝由 CLI ST 和真实 RunLogos smoke 覆盖。"
      evidence: ["api: skipped", "test_strategy: cli-subprocess-st"]
      missing_evidence: []
```

## 用户确认点

- 用户在本次对话中明确要求“补齐上述边界再批准本提案”；仅当补齐内容写后读回且 change-lint / next 双检查通过时，才写入 `PLAN_APPROVED` 消费 plan-exit。该批准只进入 Delta 编写，不构成 `--auto` 全链路授权。
- Delta 完成后，`openlogos merge fix-merge-transaction-preflight-reopen` 仍是独立授权点。
- 代码完成后，`openlogos verify` 仍是独立授权点。
- verify 通过后的 0.14.2 本机部署、smoke、恢复 RunLogos 当前事务并继续其 merge，均须到对应阶段再次取得用户明确授权；本提案、tasks 或 `PLAN_APPROVED` 不能替代这些授权。OpenLogos archive、任何 git push 与公开发布同样保持独立确认。
