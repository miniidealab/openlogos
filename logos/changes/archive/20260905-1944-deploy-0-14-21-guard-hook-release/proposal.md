# 变更提案：deploy-0-14-21-guard-hook-release

> module: core | created: 2026-09-05

## 变更原因

上一提案 `fix-claude-guard-hook-project-dir-and-sync-deploy`（已归档 `20260905-1818-*`）按当时用户决策「仅规格 + 代码，不部署」交付——guard hook 三项修复（`$CLAUDE_PROJECT_DIR` 注册形态、guard-check 工作目录收敛 fail-closed、sync 托管 guard 资产）已入仓并 verify 通过（2160/2160），但未生效于任何安装态：本机全局 0.14.20 的 guard 仍是旧行为，存量项目（含 runlogos）硬闸缺失也无法经 `openlogos sync` 补齐。

用户现更正决策：**立即发布**。本提案承载 0.14.21 候选发布——版本身份 bump、SMOKE-core-192 安装态验收（子目录 cwd 拦截实测 + 0.14.20 fail-open 对照）、隔离矩阵、本机全局部署与正式 smoke。

## 变更类型
设计级

## 变更范围
- 影响的需求文档：`core-01-requirements.md`（S19 验收补 0.14.21 候选发布要求）。
- 影响的功能规格：`core-01-feature-specs.md`（0.14.21 候选内容清单与发布验收）。
- 影响的业务场景：S19（本地全局 candidate 发布与 smoke 门禁——新增 0.14.21 发布节）。
- 影响的部署方案：`core-01-deployment-plan.md`（新增 0.14.21 本机全局部署方案章节）。
- 影响的 API / DB 表 / 编排测试：无。
- 影响的 smoke 测试：`test/smoke/core-smoke-test-cases.md`（新增 SMOKE-core-192）。

## 部署影响
- 是否需要部署：是
- 部署原因：guard 修复只有进入安装态才生效——非根 cwd fail-open 与存量项目硬闸缺失存在于已安装的 0.14.20 全局 CLI；发布后存量项目一次 `openlogos sync` 即补齐硬闸。
- 影响环境：本机 npm 全局 prefix（`/opt/homebrew`）
- 是否涉及数据迁移：否（settings.json 迁移为幂等合并语义，非数据迁移）
- 是否需要回滚预案：是（固定回滚制品：0.14.20 tarball，SHA-256 `b252cec4465806a4555fa2cc2018fb908fc09f71ba9a198bbd9dd28fec01fcbf`）
- 是否需要 smoke：是（SMOKE-core-192）

## UI/UX 变更声明

```yaml
ui_impact: false            # 纯 CLI 项目，发布提案无界面
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
    - "发布提案零语义变更：guard 判定、hook 注册、sync 资产面的全部权威语义已由上一提案（fix-claude-guard-hook-project-dir-and-sync-deploy）定稿并入仓，本提案只做版本身份 bump 与安装态验收"
    - "候选身份链（package/lock/plugin manifests/asset-manifest/LOCAL_RELEASE_*/tripwire/golden）沿用既有单一发布机制（S19 candidate identity），无新裁决者"
    - "SMOKE-core-192 是消费侧验收证据，不改变任何共享事实的 owner/writer"
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: 无数据迁移；存量项目 settings.json 由已定稿的幂等合并语义处理
  compatibility:
    status: none
    reason: 0.14.21 与 0.14.20 的唯一行为差异即已定稿的 guard 修复（CLAUDE_PROJECT_DIR 是 Claude Code 官方变量；变量缺失且 cwd 非根从静默放行改为 fail-closed 属安全增强，其兼容边界已在上一提案成文）
  security_privacy:
    status: none
    reason: 发布即让 fail-open 消除与存量硬闸补齐生效，纯安全增强
  public_release:
    status: none
    reason: 仅本机全局部署；不 npm publish、不 tag、不 GitHub Release、不官网发布、不 git push
  external_commitment:
    status: none
    reason: 无对外承诺变化
decisions:
  - id: C01
    category: deployment
    source: user
    question: guard hook 修复是否发布 0.14.21 到本机全局并 smoke？
    answer: 是——用户更正上一提案的「不部署」决策，明确要求生成本提案完成新版本部署与 smoke
    rationale: 修复不发布则不生效；存量项目（含 runlogos）硬闸缺失只能等安装态更新后 sync 补齐。目标环境=本机全局 prefix，回滚制品固定 0.14.20 tarball（sha256 b252cec4…1fcbf），成功证据=隔离矩阵+SMOKE-core-192+Gate 3.8 PASS
    affects: ['0.14.21 候选身份 bump', '部署方案 0.14.21 章节', 'SMOKE-core-192 与 runner', 'deploy 任务与回滚预案']
    rejected_options: ['继续等待下一个功能提案顺带发布（修复继续不生效）']
unresolved: []
defaults:
  - '回滚制品取 0.14.20 部署窗口冻结件（deployment-artifacts/fix-reopen-test-change-set-forward-merge/miniidealab-openlogos-0.14.20.tgz）——可逆实现细节，不设用户问项'
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
  touched_scenario_ids: [S19]
  targets:
    - category: requirement
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "S19 验收条件需补 0.14.21 候选发布要求（身份链同步、隔离矩阵含 guard 行为验收与 0.14.20 对照、全局覆盖与 smoke）。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "需成文 0.14.21 候选内容清单（三项 guard 修复）与发布验收口径。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "S19 需新增 0.14.21 候选发布节（身份冻结→隔离矩阵→全局覆盖→smoke 时序与失败回滚边界）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md", "spec_fact: 已有 0.14.0 全局 candidate 先例节"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "新增 0.14.21 本机全局部署方案章节（隔离矩阵含子目录 cwd 拦截实测、存量项目 sync 补齐实测与 0.14.20 fail-open 对照，回滚制品固定 0.14.20 tarball）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "新增 UT-S19-38（0.14.21 候选身份全源一致与回滚身份 0.14.20 tripwire）。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "新增 SMOKE-core-192：安装态 guard 全链（子目录 cwd 拦截/放行、fail-closed、存量项目 sync 补齐）+ 固定 0.14.20 fail-open 对照 + roundtrip。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md"]
      missing_evidence: []
    - category: api
      scenario_ids: [S19]
      mode: SKIP
      delta_path: null
      reason: "CLI 项目，无对外 API。"
      evidence: ["project_fact: product_type=cli，logos/resources/api/ 无本域目标"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S19]
      mode: SKIP
      delta_path: null
      reason: "发布提案零架构变化：候选身份链与部署机制均为既有组件（S19 candidate identity），本次仅版本值推进。"
      evidence: ["code_fact: local-release-candidate.ts 身份链机制已存在，仅字面量 bump"]
      missing_evidence: []
    - category: database
      scenario_ids: [S19]
      mode: SKIP
      delta_path: null
      reason: "无数据库。"
      evidence: ["project_fact: 无 logos/resources/database/ 本域目标"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S19]
      mode: SKIP
      delta_path: null
      reason: "无 API 即无编排测试维度。"
      evidence: ["project_fact: API 维度 SKIP，编排随之不适用"]
      missing_evidence: []
```

## 变更概述

发布 `@miniidealab/openlogos@0.14.21`（内容 = 已合并入仓的 guard hook 三项修复，零新增语义）：

1. **候选身份**：package/lockfile/五 plugin manifest/asset-manifest/`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.21`、`ROLLBACK=0.14.20`/tripwire/golden 全链同步；真实 `npm pack` 冻结 tarball SHA-256。
2. **隔离矩阵（SMOKE-core-192 runner 承载）**：candidate identity；**guard 全链**——init 新项目 hook 为 `$CLAUDE_PROJECT_DIR` 形态、子目录 cwd 无提案 Edit 被拦（exit 2 + reason）有提案放行、变量缺失且 cwd 非根 fail-closed；**存量项目 sync 补齐实测**——构造无 guard-check/仅旧 SessionStart 项目，sync 后硬闸齐备且旧条目迁移；**0.14.20 fail-open 对照**——同一子目录 cwd 场景在固定 0.14.20 上静默放行（缺陷复现，防断言空转）；`0.14.20→0.14.21` roundtrip 无混装。
3. **本机全局部署 + 正式 smoke**：矩阵与回滚演练 PASS 后覆盖全局，新 shell 复核 identity 全同源 0.14.21；`openlogos smoke` 独立授权执行。

不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
