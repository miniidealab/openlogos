# 合并指令

## 变更提案
- 提案名称：fix-test-slice-changed-id-semantic-diff
- 提案目录：logos/changes/fix-test-slice-changed-id-semantic-diff/

## 提案内容

# 变更提案：修复测试切片 changed ID 的语义差异判定

> module: core | created: 2026-08-26 | target version: 0.13.30

## 变更原因

`logos/resources/reference/openlogos-runlogos-test-slice-manifest-invalid-recovery-cross-repo-bug-report.md` 记录了一起跨仓事故。OpenLogos 当前的 `extractChangedTestIds(proposalDir)` 扫描 `deltas/test/**/*.md` 中出现的全部测试 ID，并把它们都当作本提案新增或修改的测试；当 `MODIFIED` Delta 为了完整替换章节而原样携带历史表格行时，未变化的基线测试也被错误提升为 `owned_test_ids` 必须覆盖的集合。

事故样本中 OpenLogos 报告 18 个 changed ID，但正确集合只有 6 个：真实修改的 `UT-S10-129`，以及新增的 `UT-S10-137`～`UT-S10-140`、`ST-S10-44`。原样携带的 `UT-S10-121`～`UT-S10-128` 与 `ST-S10-36`～`ST-S10-39` 必须继续属于 baseline。根因是切片阶段只有 Delta“出现集合”，没有利用 merge-apply 已掌握的正式规格写入前后字节进行结构化语义对账，也没有持久化对账结果。

## 变更类型

设计级缺陷修复。它改变测试—切片归属的权威输入与 merge-apply 的原子产物，但不降低 `O = C`、唯一归属、selector 覆盖、测试定义存在性或 final verify 的硬门。

## 变更概述

本提案把测试变更集合的判定时点从 merge 后的 Delta 文件扫描，前移到 `merge-apply` 已同时掌握正式测试规格 before/final 字节的原子事务中。OpenLogos 将按结构化测试定义计算新增、真实修改、原样保留和删除 ID，并把稳定、可校验的 `openlogos/test-change-set@1` 固化到 `SPEC_MERGED.test_change_set`。

切片 manifest、status、next、change-lint 与 verify 随后只消费这一 canonical 事实，继续严格执行 `O = C`。change set 自身缺失或损坏时保守阻塞，不能误派无法重建 merge 前态的 slice-planner；只有 change set 有效而 `TEST_SLICE_MANIFEST.json` 失效时，才沿用既有 `plan-slices` recovery。实现版本统一提升到 `0.13.30`，仅部署本机 npm 全局候选并验证 `0.13.29` 回滚，不公开发布。

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 中多切片验收边界。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` §2.37，修正 `C` 的来源，消除“manifest 自己定义 C”的循环口径。
- 影响的技术架构：`logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md` §二十七，增加 merge 前后测试定义解析、规范化、原子固化和共享消费边界。
- 影响的业务场景：S32（切片规划与 manifest 校验）、S39（按触达规格闭包与原子 apply）。
- 影响的方法论规格：`spec/test-slice-manifest.md`、`spec/baseline-closure.md`。
- 影响的测试规格：`core-S32-test-cases.md`、`core-S39-test-cases.md` 与 `core-smoke-test-cases.md`。
- 影响的实现：merge-apply 批事务、测试定义语义差异模块、manifest validator 及 `status`/`next`/`change-lint`/`verify` 共用入口；同步版本元数据、安装态 runner、reporter 与 golden。
- 影响的版本：CLI、lockfile 和随包插件 manifest 统一升级为 `0.13.30`，更新 CHANGELOG 与打包断言。
- 影响的 API：无 HTTP、RPC 或消息 API；只增加内部提案文件的版本化事实。
- 影响的 DB 表：无。
- 影响的编排测试：无 API 编排测试；跨进程与安装态行为由 CLI ST/smoke 覆盖。
- 明确不做：不修改 RunLogos 的 `manifest_data` 可空解析、`classifyManifest()` 生产接线、recovery WorkUnit、提示词或命令 allowlist；这些属于 companion change `fix-manifest-invalid-recovery-contract`。

## 核心设计

### Canonical test change set

保持 `MERGE_APPLY_MANIFEST.json` 的 `openlogos/baseline-merge-apply@1` 严格键合同不变。`merge-apply` 在真正落盘前，对 category=`test` 的 prepared target 使用正式目标当前字节与 `content_base64` 解码后的最终字节进行结构化对账，生成 `openlogos/test-change-set@1`：

```json
{
  "schema": "openlogos/test-change-set@1",
  "change": "fix-test-slice-changed-id-semantic-diff",
  "module": "core",
  "source": "semantic-before-after-diff",
  "changed_test_ids": [],
  "removed_test_ids": [],
  "targets": [
    {
      "target_path": "logos/resources/test/core-S32-test-cases.md",
      "before_sha256": "<64-hex-or-null-for-CREATE>",
      "after_sha256": "<64-hex>"
    }
  ],
  "sha256": "sha256:<canonical-payload-hash>"
}
```

该对象随新版结构化 `SPEC_MERGED.test_change_set` 在同一 apply 事务原子落盘。v1 顶层键必须精确为 `schema`、`change`、`module`、`source`、`changed_test_ids`、`removed_test_ids`、`targets`、`sha256`；`targets[]` 项的精确键为 `target_path`、`before_sha256`、`after_sha256`。`change/module` 必须匹配当前 guard；`source` 必须逐字为 `semantic-before-after-diff`；哈希字段使用小写 64 位 hex，只有 CREATE 的 `before_sha256` 可为 `null`。

`changed_test_ids`、`removed_test_ids` 与 `targets` 分别按 ASCII 升序、去重；两类 ID 集合不得相交。`sha256` 是去掉自身字段后，按上述固定键序列化为无额外空白 UTF-8 canonical JSON 的 SHA-256，并带 `sha256:` 前缀；时间戳不进入该对象，保证相同前后态得到逐字节稳定事实。现有 `SPEC_MERGED.manifest_sha256` 继续绑定严格 apply manifest；change set 的 target identity 必须与 apply manifest 中 category=`test` 的 prepared target 精确一致。

### 计算与原子提交顺序

1. `merge-apply` 完成 L1～L9、guard、严格 manifest、P=T=D、source/before/final 哈希与 CREATE/MODIFY 身份预检。
2. 对全部 category=`test` 目标，在任何正式写入发生前读取当前目标字节作为 before；CREATE 使用空前态；after 直接使用已校验的 prepared final bytes。
3. 对 before/after 建立全局 `ID → 规范化测试记录` 映射；任一侧存在重复 ID、非法 UTF-8、不可唯一解析的测试表或 target identity 漂移时立即失败，写零正式字节。
4. 计算全局 changed/removed 集合、target hashes 与 canonical payload hash，构造包含 `test_change_set` 的完整 `SPEC_MERGED` 最终字节。
5. 把正式 targets、必要 metadata 与 `SPEC_MERGED` 作为同一批 inputs 交给 `applyBaselineClosureBatch()`；marker 保持最后写入，但任一步 fault 都恢复所有 MODIFY、删除本批 CREATE 并恢复 metadata。
6. 事务成功后重读正式测试 targets 与 marker，复核 after hashes、change-set hash、schema、change/module 和 apply-manifest 绑定；复核失败同样按事务失败处理，不得留下半完成 spec-complete。

### 结构化差异语义

对写入前后测试规格分别解析真实 UT/ST/SMOKE 表格定义。只接受 authority 区域内、具备 Markdown 表头与分隔行、首个逻辑单元格精确匹配 canonical 测试 ID 的数据行；围栏代码、HTML 注释、普通散文和示例字符串中的 ID 不构成测试定义。解析器必须正确处理 escaped pipe 与 inline-code pipe。测试 ID 在同一前态或后态的全部正式测试 targets 中重复、表结构无法唯一解释、字节哈希与 manifest identity 不一致时，apply 必须在首写前 fail-closed。

规范化测试记录包含“正式 target 路径 + 规范化列身份 + 有序单元格语义”。统一 UTF-8/LF、Markdown 表格外层空白与转义解析；忽略仅用于排版的对齐和单元格外围空白，但保留列顺序、内部文本、代码片段、前置、输入与期望等有意义内容。

- 后态新增 ID进入 `changed_test_ids`。
- 前后都存在且规范化记录不同的 ID进入 `changed_test_ids`。
- 前后都存在且规范化记录相同的 ID留在 baseline。
- 前态存在而后态不存在的 ID只进入 `removed_test_ids`，不得要求 manifest owned。
- 仅调整表格对齐、行尾、外围空白或测试行顺序不构成修改；列身份、列顺序或任一有意义单元格变化均构成修改。
- ID 在正式 target 间迁移视为修改；两个数组去重并按 ASCII 稳定排序。

### 单一消费入口与兼容边界

manifest validator 的集合定义改为：`C = SPEC_MERGED.test_change_set.changed_test_ids`，`R = removed_test_ids`，`O = 所有 owned_test_ids 的并集`，并继续强制 `O = C`。`status`、`next`、`change-lint` 与 `verify` 必须调用同一读取/校验函数，不得再次扫描 Delta 推断 C。

读取器必须先验证 canonical change set，再验证 `TEST_SLICE_MANIFEST.json`，两层状态不得混为一谈：

| Change set | Slice manifest | 结论 |
|---|---|---|
| valid | valid | 按既有 checkpoint/final 规则继续 |
| valid | missing/invalid/stale | 保持既有 `plan-slices` recovery；slice-planner 只重建 manifest |
| missing/invalid/unsupported/hash 或 target identity 失配 | 任意 | `manifest_status=invalid`、`reason=test-slice-manifest-invalid`，输出 `test-slice-change-set-*` 精确 violation，`human_action_required=true`；不得派 `plan-slices` |
| legacy marker + 合法 final `VERIFY_PASS` | 任意 | 保持已完成，不因升级回退 |
| `type=no_delta_spec_complete` 且磁盘确无 mergeable delta | 未规划 | 读取器可信派生 `C=[]、R=[]`，不要求改写旧 no-delta marker |

change set 缺失或损坏时 slice-planner 无法证明 merge 前态，因此禁止提示它“自动恢复”；不得回退到 Delta 出现集合，不得静默改写 marker，也不得写 `VERIFY_FAIL`、Gate、loop、checkpoint 或消耗 repair budget。需要修复旧活跃提案时，必须由另行明确、带可信 before snapshot 的迁移流程处理；本提案不伪造历史前态。

### 实现触点与单一事实源

- `cli/src/commands/merge-apply.ts`：只负责从已校验 before/final bytes 构造 change set 和结构化 marker，不改变严格 apply manifest 的允许键。
- 新增或收敛一个纯函数模块负责 Markdown 测试定义解析、规范化、前后差异、canonical hash 与 marker 读取校验；`merge-apply` 和 manifest validator 共同依赖它，禁止复制判据。
- `cli/src/lib/test-slice-manifest.ts`：删除生产路径对 `extractChangedTestIds()` 的依赖；`C/R` 只来自已校验 change set。旧函数若为迁移测试保留，必须不可从 status/next/change-lint/verify 生产链到达。
- `status`、`next`、`change-lint` 与 `verify` 继续通过 `deriveSliceVerificationState()` 或等价单一入口消费结论；命令层不得直接解析 `SPEC_MERGED` 或自行扫描 Delta。
- `TEST_SLICE_MANIFEST.json` schema、checkpoint 文件与 final 覆盖率公式不变；本提案只纠正 `C` 的权威来源并增加来源完整性门。

### 版本一致性边界

`0.13.30` 实现必须同时更新 `cli/package.json`、`cli/package-lock.json` 根包版本、`plugin/.claude-plugin/plugin.json`、`plugin-codex/plugin.json`、`plugin-zcode/.zcode-plugin/plugin.json`、`plugin-qoder/.qoder-plugin/plugin.json`、`plugin-workbuddy/.workbuddy-plugin/plugin.json` 与相关版本 golden；不存在版本字段的插件目录不得凭空新增。`CHANGELOG.md` 增加 0.13.30 本地候选说明，但不创建 tag 或 release。

## 部署影响

- 是否需要部署：是
- 部署原因：版本升级到 `0.13.30`，必须用真实 npm tarball 验证安装态 merge-apply、跨进程重启、manifest 判定与回滚。
- 影响环境：本机 npm 全局环境；不使用 staging、生产或公开 registry。
- 是否涉及数据迁移：否；只为后续提案写入版本化 `SPEC_MERGED.test_change_set`。
- 是否需要回滚预案：是；部署前记录当前全局包、入口 realpath、版本与可恢复制品，失败或演练时恢复 `0.13.29`。
- 是否需要 smoke：是
- Smoke 说明：使用临时 fixture 项目验证全局安装的 `0.13.30`，不得对本仓库活跃提案执行破坏性 merge fixture。
- 公开发布：禁止 `npm publish`、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署与 `git push`。

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
  touched_scenario_ids: [S32, S39]
  targets:
    - category: requirement
      scenario_ids: [S32, S39]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "明确 canonical changed/removed、原样 baseline 与 O=C 验收条件。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md", "section_exists: S13/S16/S27/S28/S31/S32"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S32, S39]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "§2.37 需把 C 修正为 merge 时固化的语义差异事实。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md", "section_exists: 2.37"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S32, S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "定义 before/after 对账、原子 marker、完整性校验与单一消费入口。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md", "section_exists: 二十七"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S32]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md"
      reason: "S32 从 canonical C 规划归属并给出正确 invalid 诊断。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md", "scenario:S32"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md"
      reason: "S39 apply 事务需原子固化 test change set。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md", "scenario:S39"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S32, S39]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "定义 0.13.30 本机全局安装、证据、0.13.29 回滚及无公开发布。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "user_decision: local-global-no-publish"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/spec/baseline-closure.md"
      reason: "把 change set 纳入全有或全无 apply 事务与事后复核。"
      evidence: ["target_exists: spec/baseline-closure.md", "contract_exists: atomic apply"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S32]
      mode: MODIFY
      delta_path: "deltas/spec/test-slice-manifest.md"
      reason: "定义 change set schema、规范化差异、C/R/B/O 与共享消费。"
      evidence: ["target_exists: spec/test-slice-manifest.md", "contract_exists: O=C"]
      missing_evidence: []
    - category: test
      scenario_ids: [S32]
      mode: MODIFY
      delta_path: "deltas/test/core-S32-test-cases.md"
      reason: "覆盖新增、修改、原样、删除、O=C、篡改与事故六 ID。"
      evidence: ["target_exists: logos/resources/test/core-S32-test-cases.md", "next_test_ids: UT-S32-43-49,ST-S32-14-16"]
      missing_evidence: []
    - category: test
      scenario_ids: [S39]
      mode: MODIFY
      delta_path: "deltas/test/core-S39-test-cases.md"
      reason: "覆盖 apply 前后对账、回滚、no-delta、重启与无 Git 依赖。"
      evidence: ["target_exists: logos/resources/test/core-S39-test-cases.md", "next_test_ids: UT-S39-33-38,ST-S39-17-19"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S32, S39]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "全局 0.13.30 入口需验证事故六 ID、原子事实、重启与回滚。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "next_smoke_ids: SMOKE-core-130-134"]
      missing_evidence: []
    - category: api
      scenario_ids: [S32, S39]
      mode: SKIP
      delta_path: null
      reason: "只改变本地 CLI/文件协议，不新增 HTTP、RPC 或消息 API。"
      evidence: ["architecture: local-cli-filesystem"]
      missing_evidence: []
    - category: database
      scenario_ids: [S32, S39]
      mode: SKIP
      delta_path: null
      reason: "change set 随提案 marker 持久化，不使用数据库。"
      evidence: ["data_impact: none"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S32, S39]
      mode: SKIP
      delta_path: null
      reason: "API 维度为 SKIP；CLI ST/smoke 覆盖跨进程闭环。"
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
    reason: "只增加提案级版本化 marker 事实，不迁移或改写业务数据。"
  compatibility:
    status: none
    reason: "新 merge 强制写 change set；已有 final VERIFY_PASS 不回退，活跃提案缺失或篡改事实时按既有 fail-closed 恢复边界诊断，绝不沿用错误 Delta 扫描。"
  security_privacy:
    status: none
    reason: "不新增网络、权限、Secret 或个人数据处理；部署 smoke 使用临时 fixture。"
  public_release:
    status: none
    reason: "用户明确限定本地全局部署且不发布；npm publish、dist-tag、Git tag、GitHub Release、官网部署与 push 均不授权。"
  external_commitment:
    status: none
    reason: "不购买服务、不创建外部账号、不修改远端或形成不可逆外部承诺。"
decisions:
  - id: C01
    category: deployment
    question: "本次 0.13.30 修复采用何种部署与发布边界？"
    answer: "verify 后部署真实 0.13.30 tarball 到本机 npm 全局环境，以 0.13.29 回滚，不公开发布。"
    rationale: "用户明确要求升级版本、部署本地全局且不发布；真实全局入口验证安装态，同时避免公开 registry 副作用。"
    source: user
    affects:
      - "0.13.30 版本元数据与 npm tarball"
      - "本机 npm 全局安装、smoke 和部署报告"
      - "0.13.29 回滚与 0.13.30 恢复"
    rejected_options:
      - "npm 公开发布或 dist-tag 更新"
      - "只运行仓库源码、不验证安装态"
unresolved: []
defaults:
  - id: DFLT-01
    category: compatibility
    choice: "change set 缺失、schema 不支持或完整性失配时 fail-closed，不回退到 Delta 出现集合。"
    reason: "仅凭 Delta 无法区分完整 MODIFIED 中原样携带的历史定义。"
  - id: DFLT-02
    category: architecture
    choice: "保持 MERGE_APPLY_MANIFEST 严格合同不变，把 change set 固化在同事务的结构化 SPEC_MERGED 中。"
    reason: "避免破坏 baseline-merge-apply@1，同时复用现有原子 marker 事务。"
```

## 测试追溯矩阵

| ID | 锁定合同 |
|---|---|
| UT-S32-43 | 读取合法 `openlogos/test-change-set@1` 并以其 C/R 作为唯一归属事实 |
| UT-S32-44 | 原样携带历史 ID 被 owned 时返回 unknown，不进入 C |
| UT-S32-45 | 新增或真实修改 ID 未 owned 时返回 missing |
| UT-S32-46 | changed ID 多片归属继续 duplicate/ambiguous fail-closed |
| UT-S32-47 | removed ID 只进入 R，不要求定义存在或 owned |
| UT-S32-48 | change set 缺失、未知 schema、hash/target 漂移时阻塞且不得误派 `plan-slices` |
| UT-S32-49 | 事故 fixture 的 C 精确为 6 个 ID，12 个原样 ID 留在 baseline |
| ST-S32-14 | `status`、`next`、`change-lint`、validator 与 `verify` 对同一 C/R 同源一致 |
| ST-S32-15 | change set 有效但 slice manifest 非法时仍可安全进入既有 `plan-slices` recovery |
| ST-S32-16 | change set 自身不可信时保持人类处置边界且 Gate/loop/checkpoint 零副作用 |
| UT-S39-33 | change set 严格字段、ASCII 排序、去重和 canonical payload hash |
| UT-S39-34 | before/after 的新增、修改、原样、删除及跨 target 移动分类 |
| UT-S39-35 | authority table、escaped pipe/inline-code pipe 与排版归一化语义 |
| UT-S39-36 | 重复 ID、非法 UTF-8、不可唯一解析或 manifest identity 漂移均在首写前失败 |
| UT-S39-37 | resources、metadata、change set、marker 的批事务顺序与 fault rollback |
| UT-S39-38 | CREATE 空前态、MODIFY 当前前态及无 Git 环境的确定性 |
| ST-S39-17 | 生产 apply 入口对事故样本原子写出六 ID change set 与 `SPEC_MERGED` |
| ST-S39-18 | marker 前/后 fault injection 均恢复正式 targets 与 metadata、删除本批 CREATE |
| ST-S39-19 | 跨进程重启读取同一事实；篡改 marker/hash/target 后稳定拒绝 |
| SMOKE-core-130 | 全局入口、包名、CLI/插件版本和 tarball SHA-256 均为 0.13.30 候选 |
| SMOKE-core-131 | 全局安装态 merge fixture 得到事故精确六 ID，原样历史 ID 不 owned |
| SMOKE-core-132 | 安装态验证 missing/unknown/duplicate 与 removed 独立语义 |
| SMOKE-core-133 | 删除 Git 元数据后重启结论不变；change set 篡改保持 fail-closed |
| SMOKE-core-134 | 实际完成 `0.13.30 → 0.13.29 → 0.13.30` 全局回滚恢复且公开副作用为零 |

## 验收边界

1. 事故 fixture 的 `changed_test_ids` 精确等于 `UT-S10-129`、`UT-S10-137`～`UT-S10-140`、`ST-S10-44`；12 个原样历史 ID 均不在 C。
2. 原样历史 ID 被 manifest owned 时返回 unknown；changed ID 漏配或多片归属继续 fail-closed。
3. 删除 ID 只进入 `removed_test_ids`，不要求 manifest owned。
4. 无 Git、未提交、squash/rebase 等环境下均由前后字节得到相同 change set；重启后从 `SPEC_MERGED` 读取同一事实。
5. 资源、metadata、change set、marker 任一步失败全部回滚；hash、target identity 或 schema 失配不启动 runner、不写 checkpoint、不推进 Gate，也不得误派 `plan-slices`。
6. `status`、`next`、`change-lint`、manifest validator 与 `verify` 对同一 fixture 得出一致 C/R。
7. 合法 no-delta marker 可可信派生空 C/R；旧 marker + final PASS 不回退，旧活跃 marker 无可信前态时明确阻塞且不伪造迁移结果。
8. 真实 tarball 与全局入口均为 `0.13.30`，可实际回滚到 `0.13.29` 并恢复 `0.13.30`。
9. 全流程不执行 npm publish、dist-tag、Git tag、GitHub Release、官网部署或 git push。

## 非目标

- 不修改 RunLogos 仓库或声称已修复其 recovery 消费链。
- 不降低既有 manifest/verify 安全门。
- 不依赖 Git 提交历史作为正式差异来源。
- 不自动伪造无法证明前态的旧活跃提案 change set。
- 不在 proposal 获批前生成 Delta、规划 `[code]`、修改源码、升级版本或部署。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/fix-test-slice-changed-id-semantic-diff/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md

- Delta 文件：`logos/changes/fix-test-slice-changed-id-semantic-diff/deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md

- Delta 文件：`logos/changes/fix-test-slice-changed-id-semantic-diff/deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md

- Delta 文件：`logos/changes/fix-test-slice-changed-id-semantic-diff/deltas/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md

- Delta 文件：`logos/changes/fix-test-slice-changed-id-semantic-diff/deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/fix-test-slice-changed-id-semantic-diff/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/spec/baseline-closure.md

- Delta 文件：`logos/changes/fix-test-slice-changed-id-semantic-diff/deltas/spec/baseline-closure.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/spec/test-slice-manifest.md

- Delta 文件：`logos/changes/fix-test-slice-changed-id-semantic-diff/deltas/spec/test-slice-manifest.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/test/core-S32-test-cases.md

- Delta 文件：`logos/changes/fix-test-slice-changed-id-semantic-diff/deltas/test/core-S32-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 10. deltas/test/core-S39-test-cases.md

- Delta 文件：`logos/changes/fix-test-slice-changed-id-semantic-diff/deltas/test/core-S39-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 11. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/fix-test-slice-changed-id-semantic-diff/deltas/test/smoke/core-smoke-test-cases.md`
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
   git add -A && git commit -m "docs(fix-test-slice-changed-id-semantic-diff): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive fix-test-slice-changed-id-semantic-diff`。
