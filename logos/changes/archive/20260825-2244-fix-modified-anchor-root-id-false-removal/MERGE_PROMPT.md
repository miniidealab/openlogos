# 合并指令

## 变更提案
- 提案名称：fix-modified-anchor-root-id-false-removal
- 提案目录：logos/changes/fix-modified-anchor-root-id-false-removal/

## 提案内容

# 变更提案：修复 MODIFIED 根标题 ID 守恒误报

> module: core | created: 2026-08-26

## 变更原因

`logos/resources/reference/openlogos-change-lint-modified-anchor-root-id-false-removal-bug-report.md` 记录了一个可在当前 `0.13.29` 构建稳定复现的 L8 守恒缺陷：当目标章节根标题以稳定 ID 开头，例如 `## S10 人工刷新恢复保证`，合法 Delta 使用 `## MODIFIED — S10 人工刷新恢复保证` 并只携带替换后的章节正文时，`evaluateDeltaConservation()` 会误报根 ID `S10` 被隐式删除。相同问题也影响 `DXX` 与数字节号。

根因是现有实现对目标章节从“根标题 + 正文”抽取 `existing`，却只从 `MODIFIED` 控制行下方的正文抽取 `retained`。章节锚虽然已经唯一命中目标根标题，却没有按真实合并结果重建为 retained 的根标题，导致比较模型不对称。该假阳性同时影响 `openlogos change-lint` 与 `openlogos merge`，会阻断合法 Delta 生成 `MERGE_PROMPT.md`。

## 变更类型

需求级缺陷修复。用户可观察的 lint/merge 放行行为、S37 守恒形式化定义、技术实现模型、场景时序与验收用例需要同步闭合；不改变 Delta 的 `ADDED / MODIFIED / REMOVED / REMOVED-ITEMS` 操作语义。

## 变更范围

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` 中 S37 的合法 `MODIFIED` 放行条件与隐式删除边界。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` §2.33，明确 retained 必须按真实最终章节结构计算。
- 影响的架构文档：`logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md` §二十四，补充唯一命中后重建根标题的算法、不变量与失败边界。
- 影响的业务场景：S37；补齐已被 `logos-project.yaml` 索引但当前缺失的 `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S37-delta-conservation.md`。
- 影响的方法论规格：`spec/change-management.md`，澄清 `MODIFIED` 的新内容集合等于“已解析目标根标题 + Delta 正文”，而不是只计算正文。
- 影响的测试规格：`logos/resources/test/core-S37-test-cases.md`，规划 UT-S37-32～UT-S37-36 与 ST-S37-07～ST-S37-08。
- 影响的实现：预期修改 `cli/src/lib/change-lint.ts` 与 `cli/test/s37-delta-conservation.test.ts`；lint 和 merge 继续消费同一个 `evaluateDeltaConservation()`，不新增第二份判据。
- 影响的 API：无；不改变 HTTP、RPC、消息或公开编程接口。
- 影响的 DB 表：无；不涉及持久化实体、DDL 或数据迁移。
- 影响的编排测试：无；API 维度为 SKIP，跨进程行为由 CLI 场景测试覆盖。
- 不影响 `ChangeLintViolationCode`、JSON envelope、错误码、i18n 文案、archive 或 merge apply 语义。

## 部署影响

- 是否需要部署：否
- 部署原因：本提案只修正本地 CLI 判据并通过纯函数 UT 与临时项目 CLI ST 验证；不授权 npm publish、全局安装或任何环境发布。
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否；代码回退即可恢复原实现，且本案不写用户业务数据。
- 是否需要 smoke：否
- Smoke 说明：真实 CLI 入口已由 ST 覆盖，verify 通过后即可进入归档确认。

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
  touched_scenario_ids: [S37]
  targets:
    - category: requirement
      scenario_ids: [S37]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "S37 的用户可观察验收需要明确合法根标题 ID 不构成隐式删除。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md", "section_exists: S37"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S37]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "§2.33 需把 retained 的形式化对象从块正文修正为真实最终章节结构。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md", "section_exists: 2.33"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S37]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "守恒算法需在唯一命中后使用 hit.level 与 hit.text 重建根标题，并保持内嵌 ID 对账。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md", "section_exists: 二十四"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S37]
      mode: CREATE
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S37-delta-conservation.md"
      reason: "S37 已在需求、场景总览和 resource_index 中登记，但权威场景时序文件缺失；本次直接触达其 lint/merge 守恒流程，须同案补齐。"
      evidence: ["target_absent: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S37-delta-conservation.md", "index_declares: S37"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S37]
      mode: MODIFY
      delta_path: "deltas/spec/change-management.md"
      reason: "变更管理权威规范需明确控制锚保留目标根标题身份及其安全边界。"
      evidence: ["target_exists: spec/change-management.md", "contract_exists: L8 delta conservation"]
      missing_evidence: []
    - category: test
      scenario_ids: [S37]
      mode: MODIFY
      delta_path: "deltas/test/core-S37-test-cases.md"
      reason: "新增 SXX、DXX、数字节号根标题正例、内嵌 ID 删除反例及 lint/merge CLI 闭环用例。"
      evidence: ["target_exists: logos/resources/test/core-S37-test-cases.md", "current_max_ids: UT-S37-31/ST-S37-06"]
      missing_evidence: []
    - category: api
      scenario_ids: [S37]
      mode: SKIP
      delta_path: null
      reason: "S37 仅校验本地 Markdown Delta 字符串，不跨 HTTP、RPC 或消息边界。"
      evidence: ["architecture: in-process CLI pure evaluator"]
      missing_evidence: []
    - category: database
      scenario_ids: [S37]
      mode: SKIP
      delta_path: null
      reason: "本案不新增或修改任何持久化实体、DDL、查询或迁移。"
      evidence: ["data_impact: none"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S37]
      mode: SKIP
      delta_path: null
      reason: "proposal 明确无需部署，修复由源码 UT 与临时项目 CLI ST 验收。"
      evidence: ["proposal: deployment_required=false"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S37]
      mode: SKIP
      delta_path: null
      reason: "API 维度为 SKIP，因此不需要 API 编排测试；CLI 跨进程验证由 S37 ST 承担。"
      evidence: ["api_disposition: SKIP"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S37]
      mode: SKIP
      delta_path: null
      reason: "proposal 明确无需部署，真实 CLI 入口已由临时项目 ST 覆盖。"
      evidence: ["proposal: smoke_required=false"]
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
    reason: "只读取内存中的 Delta 与目标 Markdown 字符串，不改写用户业务数据。"
  compatibility:
    status: none
    reason: "兼容策略由既有 Delta 协议唯一确定：合法根标题 ID 改为放行，真正删除内嵌 ID、锚点零命中或多命中继续 fail-closed。"
  security_privacy:
    status: none
    reason: "不新增权限、网络访问、Secret、个人数据处理或文件系统写入边界。"
  public_release:
    status: none
    reason: "本提案不授权 npm publish、Git tag、GitHub Release、官网发布或 git push。"
  external_commitment:
    status: none
    reason: "不引入供应商、付费服务、法律承诺或不可逆外部状态。"
decisions: []
unresolved: []
defaults:
  - "只有章节锚唯一命中目标标题后，才使用命中的真实 level/text 重建 retained 根标题；不得直接扫描 anchor 字符串猜测 ID。"
  - "重建根标题只豁免该根标题自身的稳定 ID；原章节内嵌标题、测试表和场景表中的既有 ID 仍须逐结构位置守恒。"
  - "不新增长期 DXX 决策记录：本案是对既有 S37 协议的实现纠偏，没有引入新的架构取舍。"
```

## 变更概述

在 `evaluateDeltaConservation()` 已唯一解析 `MODIFIED` 锚点后，以目标命中的真实 `hit.level` 和 `hit.text` 重建最终章节根标题，并与该块正文共同送入现有 `extractRegistryIds()`。不得从 anchor 文本直接提取 token，因为路径锚或标题散文可能包含不属于目标根标题的其它 ID；锚点未命中或多命中时仍维持 `delta_section_anchor_unresolvable`。

修复必须同时证明两面：`SXX`、`DXX`、数字节号作为目标根标题时，同锚合法 `MODIFIED` 不再误报；根标题以下真正消失的 `SXX`、测试 ID、节号或带表身份的场景行仍产生原有守恒违规。lint 与 merge 继续共享单一纯函数，违规码、输出 schema、稳定排序、只读性和失败无副作用契约保持不变。

## 验收边界

1. `## S10 ...`、`## D12：...`、`## 2.3 ...` 配合同锚 `MODIFIED` 且正文不重复根标题时，守恒结果为空。
2. 根标题被保留但内嵌 `### S11`、测试表 ID、编号小节或场景表身份被删除时，只报告真实缺失项，不误报根 ID。
3. 标题路径锚只使用最终命中的真实目标标题；路径父标题中的 ID 不进入 retained。
4. 锚点 0 命中、多命中、同锚多写者、REMOVED 与 REMOVED-ITEMS 行为保持不变。
5. `openlogos change-lint` 对合法根 ID Delta exit 0；`openlogos merge` 能生成 `MERGE_PROMPT.md`，且失败分支仍无副作用。
6. 所有新增测试写入 OpenLogos reporter；全量 verify 通过后，本提案无需部署与 smoke。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/fix-modified-anchor-root-id-false-removal/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md

- Delta 文件：`logos/changes/fix-modified-anchor-root-id-false-removal/deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md

- Delta 文件：`logos/changes/fix-modified-anchor-root-id-false-removal/deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/2-scenario-implementation/core-S37-delta-conservation.md

- Delta 文件：`logos/changes/fix-modified-anchor-root-id-false-removal/deltas/prd/3-technical-plan/2-scenario-implementation/core-S37-delta-conservation.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/spec/change-management.md

- Delta 文件：`logos/changes/fix-modified-anchor-root-id-false-removal/deltas/spec/change-management.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/test/core-S37-test-cases.md

- Delta 文件：`logos/changes/fix-modified-anchor-root-id-false-removal/deltas/test/core-S37-test-cases.md`
- 目标目录：`logos/resources/test/`
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
   git add -A && git commit -m "docs(fix-modified-anchor-root-id-false-removal): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive fix-modified-anchor-root-id-false-removal`。
