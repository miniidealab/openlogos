# 变更提案：fix-guard-check-external-path-and-stderr

> module: core | created: 2026-09-06

## 变更原因

来源：runlogos 仓库实际使用中发现并本地热修验证（`~/gitlab/runlogos/.claude/openlogos/bin/guard-check` 未提交 diff，2026-09-06 复核成立），属 0.14.21 已发布 guard hook 的两处缺陷：

1. **缺陷①（P1，误拦截）**：`plugin/bin/guard-check` 的 `is_whitelisted_path` 对**项目根之外**的路径误拦截。python3/node 归一化产出的 relpath 以 `..` 开头（bash 兜底分支下绝对路径前缀剥离失败仍为全路径）时不匹配任何 `WHITELIST_PREFIXES` 前缀 → 落入 block。但 guard 的管辖对象只是**本项目源码的变更可追溯性**；项目根之外的写入（如用户级 `~/.claude/projects/**/memory/*.md` 记忆文件、其他仓库、系统临时目录）应交由宿主权限系统处理，guard 无权也不应拦截。runlogos 实测：launched 无提案时 Claude Code 写用户级记忆文件被硬拦。
2. **缺陷②（P1，拦截原因不可见）**：`block()` 只向 stdout 输出 `{"reason":"..."}`；而 Claude Code 对 PreToolUse hook 的 **exit 2 读取的是 stderr**（stdout JSON 仅旧协议向后兼容），导致每次拦截用户与 AI 只看到 "No stderr output"，「请先运行 `openlogos change <slug>`」的可操作指引整体丢失——硬闸在但引导链路断裂。Step 0 两处 fail-closed（`CLAUDE_PROJECT_DIR` 不可进入 / 变量缺失且 cwd 非项目根）直接 `printf` stdout 后 exit 2，同病。

用户决策（2026-09-06 评审批注）：修复不止入仓——**发布 0.14.22 并本机全局部署**，存量项目（含 runlogos，撤销其本地热修）经 `openlogos sync` 拿到正式字节。本提案因此同时承载 0.14.22 候选发布：版本身份 bump、SMOKE-core-193 安装态验收、隔离矩阵、本机全局部署与正式 smoke。

## 变更类型
设计级

## 变更范围
- 影响的需求文档：`core-01-requirements.md` 中 S09 guard 的管辖边界与阻断可见性验收条件，及 S19 补 0.14.22 候选发布要求。
- 影响的功能规格：`core-01-feature-specs.md`（新增 2.64：guard 管辖边界=项目根之内；阻断 reason 双通道输出；0.14.22 候选内容清单与发布验收）。
- 影响的业务场景：S09（guard-check 判定时序补管辖边界分支与阻断输出通道）、S19（本地全局 candidate 发布与 smoke 门禁——新增 0.14.22 发布节）。
- 影响的根规范：`spec/pretooluse-guard.md`（§阻断（exit 2）输出格式、§工作目录收敛与 fail-closed、新增管辖边界节）。
- 影响的部署方案：`core-01-deployment-plan.md`（新增 0.14.22 本机全局部署方案章节）。
- 影响的 API / DB 表 / 编排测试：无。
- 影响的 smoke 测试：`test/smoke/core-smoke-test-cases.md`（新增 SMOKE-core-193）。

## 部署影响
- 是否需要部署：是
- 部署原因：用户决策（评审批注「请帮我本机全局部署，升级到 0.14.22」）——两处修复只有进入安装态才生效：已安装的 0.14.21 全局 CLI 仍会误拦项目外路径、拦截原因不可见；发布后存量项目一次 `openlogos sync` 即刷新 guard-check 字节，runlogos 本地热修同步转正。
- 影响环境：本机 npm 全局 prefix（`/opt/homebrew`）
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（固定回滚制品：0.14.21 tarball，SHA-256 `ac173f5fddff6717bfaf15787ee7ebf9c5029837277e71c20c77370abf5c285f`）
- 是否需要 smoke：是（SMOKE-core-193）

## UI/UX 变更声明

```yaml
ui_impact: false            # 纯 CLI 项目，guard 脚本行为变更无界面
design_system_mode: generated   # generated | fallback（fallback 时须填 design_system_fallback_reason）
design_system_fallback_reason: ""
pages: []                   # 每项 {id, prototype: core-NN-<slug>.html, description}
```

## Authority Impact

```yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: not_applicable
  evidence:
    - "guard 写入权限判定的 owner/sole writer/decision 语义零变化：lifecycle 判定、logos/.openlogos-guard 存在性、白名单前缀表、exit 2 阻断逻辑逐项保持（spec/pretooluse-guard.md 既有合同）"
    - "变更面为管辖边界收窄（项目根之外路径放行，交宿主权限系统）与阻断 reason 输出通道补齐（stderr 同步写入，stdout JSON 向后兼容保留），不新增/迁移任何共享业务事实的裁决者"
    - "无消费者依据文件扫描/mtime 重算决定的路径变化；guard-check 字节刷新走既有 asset-manifest 托管资产机制"
    - "0.14.22 候选身份链（package/lock/plugin manifests/asset-manifest/LOCAL_RELEASE_*/tripwire/golden）沿用既有单一发布机制（S19 candidate identity），无新裁决者；SMOKE-core-193 是消费侧验收证据，不改变任何共享事实的 owner/writer"
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: 无数据面；guard-check 为无状态判定脚本，不读写业务数据
  compatibility:
    status: none
    reason: 阻断时 stdout JSON 原样保留（旧协议宿主不受影响），仅新增 stderr 通道；项目外路径从「误拦截」改为「放行交宿主权限系统」，项目内判定逐项不变；0.14.22 与 0.14.21 的唯一行为差异即本两处修复
  security_privacy:
    status: none
    reason: 管辖边界收窄不构成弱化——项目根之内的硬闸逐项保持；项目外写入本就不属 guard 保护目标（变更可追溯性只覆盖本项目源码），由宿主自身权限系统兜底
  public_release:
    status: none
    reason: 仅本机全局部署；不 npm publish、不 tag、不 GitHub Release、不官网发布、不 git push
  external_commitment:
    status: none
    reason: 无对外承诺变化；spec/pretooluse-guard.md 的阻断输出合同由本修复更新为与 Claude Code 实际协议一致
decisions:
  - id: C01
    category: deployment
    source: user
    question: guard-check 两处修复是否随本提案发布 0.14.22 到本机全局并 smoke？
    answer: 是——用户评审批注原文「请帮我本机全局部署,升级到0.14.22」
    rationale: 修复不发布则不生效——已安装的 0.14.21 全局 CLI 仍误拦项目外路径且拦截原因不可见；发布后存量项目一次 sync 即刷新字节，runlogos 本地热修转正。目标环境=本机 npm 全局 prefix（/opt/homebrew），回滚制品固定 0.14.21 tarball（sha256 ac173f5f…c285f），成功证据=隔离矩阵+SMOKE-core-193+正式 smoke PASS
    affects: ['0.14.22 候选身份 bump', '部署方案 0.14.22 章节', 'SMOKE-core-193 与 runner', 'deploy 任务与回滚预案', 'S19 场景与测试 delta']
    rejected_options: ['仅规格 + 代码入仓，随下一个部署窗口发布（初稿口径，已被用户更正）']
unresolved: []
defaults:
  - '阻断 reason 采用双通道输出：stdout 保留 {"reason":...} JSON（向后兼容），stderr 以 printf %b 输出可读文本（Claude Code exit 2 实际读取通道）——可逆实现细节，不设用户问项'
  - '项目外判定位置：python3/node 归一化后 rel_path 以 `..`（`..` 本身或 `../` 前缀）开头即放行；bash 兜底分支对绝对路径先判是否位于 "$(pwd)/" 之下，不在则放行——可逆实现细节'
  - '回滚制品取 0.14.21 部署窗口冻结件（deployment-artifacts/deploy-0-14-21-guard-hook-release/miniidealab-openlogos-0.14.21.tgz，sha256 ac173f5f…c285f）——可逆实现细节，不设用户问项'
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
  touched_scenario_ids: [S09, S19]
  targets:
    - category: requirement
      scenario_ids: [S09, S19]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "S09 验收条件需补 guard 管辖边界（项目外路径放行）与阻断原因可见性（stderr 可读 reason）；S19 验收补 0.14.22 候选发布要求。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S09, S19]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "需成文两项修复的功能规格（新增 2.64：管辖边界=项目根之内、项目外交宿主权限系统；阻断 reason stdout JSON + stderr 双通道）及 0.14.22 候选内容清单与发布验收口径。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md", "spec_fact: 现最大功能编号 2.63"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "S09 需补 guard-check 管辖边界判定分支（项目外路径提前放行）与阻断输出双通道时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "S19 需新增 0.14.22 候选发布节（身份冻结→隔离矩阵→全局覆盖→smoke 时序与失败回滚边界）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md", "spec_fact: 已有 0.14.21 全局 candidate 先例节"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S09, S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "新增 0.14.22 本机全局部署方案章节（隔离矩阵含项目外路径放行实测、stderr reason 实测与 0.14.21 误拦截/无 stderr 对照，回滚制品固定 0.14.21 tarball）；S09 的 guard 行为经该方案进入安装态。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/pretooluse-guard.md"
      reason: "§阻断（exit 2）现只成文 stdout JSON，与 Claude Code 实际读取 stderr 的协议不符；§工作目录收敛与 fail-closed 需补 stderr 语义；需新增管辖边界节（项目根之外路径放行）。"
      evidence: ["target_exists: spec/pretooluse-guard.md", "spec_fact: §输出格式/阻断（exit 2）仅要求 stdout JSON，未提 stderr"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "新增 UT-S09-315（项目外路径放行）、UT-S09-316（阻断 reason 双通道）与 ST-S09-121（端到端：项目外写放行 + 项目内阻断 stderr 含指引）。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md", "test_fact: 现最大 UT-S09-314 / ST-S09-120"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "新增 UT-S19-39（0.14.22 候选身份全源一致与回滚身份 0.14.21 tripwire）。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md", "test_fact: 现最大 UT-S19-38"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S09, S19]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "新增 SMOKE-core-193：安装态 guard 两处修复全链（项目外写放行、项目内拦截 stderr 含指引、fail-closed stderr）+ 固定 0.14.21 对照 + roundtrip；覆盖 S09 行为的安装态验收与 S19 发布门禁。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "test_fact: 现最大 SMOKE-core-192"]
      missing_evidence: []
    - category: api
      scenario_ids: [S09, S19]
      mode: SKIP
      delta_path: null
      reason: "CLI 项目，无对外 API；guard 脚本行为与发布无 API 面。"
      evidence: ["project_fact: product_type=cli，logos/resources/api/ 无本域目标"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S09, S19]
      mode: SKIP
      delta_path: null
      reason: "无组件/职责/权威变化：guard 决策器为既有组件，本次仅其内部判定边界与输出通道；候选身份链与部署机制均为既有组件（S19 candidate identity），仅版本值推进；Authority Impact 判 not_applicable 同理。"
      evidence: ["code_fact: plugin/bin/guard-check 与 local-release-candidate.ts 身份链机制均已存在，无新组件与职责迁移"]
      missing_evidence: []
    - category: database
      scenario_ids: [S09, S19]
      mode: SKIP
      delta_path: null
      reason: "无数据库。"
      evidence: ["project_fact: 无 logos/resources/database/ 本域目标"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S09, S19]
      mode: SKIP
      delta_path: null
      reason: "无 API 即无编排测试维度。"
      evidence: ["project_fact: API 维度 SKIP，编排随之不适用"]
      missing_evidence: []
```

## 变更概述

两处联动修复 + 0.14.22 候选发布与本机全局部署。项目根之内的判定语义逐项不变：

1. **管辖边界（缺陷①）**：`is_whitelisted_path` 在白名单前缀匹配**之前**先判管辖——python3/node 归一化后 `rel_path` 为 `..` 或以 `../` 开头 → 项目根之外 → 放行（return 0）；bash 兜底分支对绝对路径先判是否位于 `$(pwd)/` 之下，不在则放行。guard 只保护本项目源码的变更可追溯性，项目外写入交宿主权限系统。
2. **阻断可见性（缺陷②）**：`block()` 在既有 stdout JSON 之外，把 reason 以 `printf '%b\n' >&2` 同步写入 stderr（Claude Code 对 exit 2 实际读取通道）；Step 0 两处 fail-closed 直写 stdout 的分支同样补 stderr 输出。stdout `{"reason":...}` 原样保留，旧协议宿主零影响。
3. **发布 `@miniidealab/openlogos@0.14.22`（C01）**：
   - **候选身份**：package/lockfile/五 plugin manifest/asset-manifest/`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.22`、`ROLLBACK=0.14.21`/tripwire/golden 全链同步；真实 `npm pack` 冻结 tarball SHA-256。
   - **隔离矩阵（SMOKE-core-193 runner 承载）**：candidate identity；guard 两处修复全链——项目外路径（如用户级 `~/.claude` 记忆文件路径形态）写入放行、项目内无提案写入拦截且 **stderr 含可操作 reason**、Step 0 fail-closed stderr 可见；**0.14.21 对照**——同场景在固定 0.14.21 上复现项目外误拦截与 "No stderr output"（缺陷复现，防断言空转）；`0.14.21→0.14.22` roundtrip 无混装。
   - **本机全局部署 + 正式 smoke**：矩阵与回滚演练 PASS 后覆盖全局 prefix（`/opt/homebrew`），新 shell 复核 identity 全同源 0.14.22；`openlogos smoke` 独立授权执行。

不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
