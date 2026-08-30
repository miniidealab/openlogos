# 变更提案：release-0-14-1-local

> module: core | created: 2026-08-30 | target version: 0.14.1

## 变更原因

当前仓库已经包含 0.14.0 之后完成的 merge transaction 消费者合同修正，但 CLI、五类随包插件 manifest、candidate 身份校验和本机全局安装仍停留在 `0.14.0`。用户明确要求把当前代码打包为 `0.14.1` 并部署到本机 npm 全局环境。

本提案只交付本地候选版：构建真实 npm tarball、记录 SHA-256、覆盖本机全局 `openlogos` 并验证安装态入口与随包资产。它不授权 npm publish、dist-tag、Git tag、GitHub Release、官网部署或 git push。

## 变更类型

代码级版本交付变更，包含本地部署与 smoke 规格更新；不改变产品需求、CLI 公共行为或 merge transaction 协议语义。

## 变更范围

- 影响的需求文档：`core-01-requirements.md`，补充 S19 对 0.14.1 本地全局制品、回滚恢复和公开发布隔离的验收条件；用户可观察业务行为不变。
- 影响的功能规格：`core-01-feature-specs.md`，补充 patch candidate 的版本一致性、自检、回滚和成功证据；现有 merge transaction 消费者合同不变。
- 影响的业务场景：S19；`core-S19-smoke-gate.md` 补充 0.14.1 candidate 身份冻结、安装态检查和失败回滚分支，不改变 smoke 门禁主时序。
- 影响的架构：复用 `core-03-release-and-versioning.md` 的版本一致性与本地打包规则，不改变架构。
- 影响的部署方案：`core-01-deployment-plan.md`，补充 0.14.1 tarball、本机全局安装、0.14.0 回滚和公开发布隔离。
- 影响的测试规格：`core-S19-test-cases.md` 与 `core-smoke-test-cases.md`，增加 0.14.1 版本身份、安装态、自检、回滚/恢复与无远程副作用覆盖。
- 影响的实现：`cli/package.json`、`cli/package-lock.json`、五类插件 manifest、candidate 版本常量/证据校验、相关 UT/ST/golden、smoke runner 与 `CHANGELOG.md`；`cli/asset-manifest.json` 由 prepack 基于最终包重新生成。
- 影响的 API：无 HTTP、RPC 或消息 API。
- 影响的 DB 表：无。
- 影响的编排测试：API orchestration 不适用；CLI ST 与本地安装态 smoke 覆盖进程和制品接缝。

## 部署影响

- 是否需要部署：是
- 部署原因：用户要求把当前代码打包成真实 `@miniidealab/openlogos@0.14.1` tarball 并安装到本机全局环境，必须验证安装后的实际命令入口和随包资产，而非仅运行仓库源码。
- 影响环境：本机 npm 全局环境（当前 prefix 为 `/opt/homebrew`，当前入口为 `/opt/homebrew/bin/openlogos`）。
- 是否涉及数据迁移：否
- 是否需要回滚预案：是；部署前冻结当前全局 0.14.0 的入口、安装来源与可恢复制品，安装或自检失败时恢复 0.14.0。
- 是否需要 smoke：是
- smoke 范围：全局命令版本、包/插件/asset manifest 身份、candidate 证据校验、核心 transaction 消费者合同，以及 0.14.0 回滚后恢复 0.14.1。
- 公开发布边界：禁止 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署与 git push。

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
  touched_scenario_ids: [S19]
  targets:
    - category: requirement
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "补充 S19 对 0.14.1 本地全局制品身份、回滚恢复和公开发布隔离的验收条件。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md", "scenario:S19"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "定义 patch candidate 的版本一致性、自检、回滚和本地部署成功证据。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md", "feature:F05"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "在既有 S19 时序中补充 0.14.1 candidate 身份冻结、安装态检查和失败回滚分支。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "定义 0.14.1 真实 tarball、本机全局安装证据、0.14.0 回滚恢复及无公开发布。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md", "decision: C01 deployment source=user"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "补充版本元数据/candidate 身份一致性和真实 pack-install-self-check 测试。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md", "next_test_ids: UT-S19-22,UT-S19-23,ST-S19-15"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "本机全局 0.14.1 必须具备独立的制品、消费者合同与回滚恢复证据。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "next_smoke_ids: SMOKE-core-157-159", "decision: C01 deployment source=user"]
      missing_evidence: []
    - category: api
      scenario_ids: [S19]
      mode: SKIP
      delta_path: null
      reason: "本案不新增或修改 HTTP、RPC、消息或远程 API。"
      evidence: ["architecture: local-cli-package"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S19]
      mode: SKIP
      delta_path: null
      reason: "现有版本与发布架构已规定 CLI、插件、CHANGELOG 和制品身份一致，本案直接复用。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-03-release-and-versioning.md"]
      missing_evidence: []
    - category: database
      scenario_ids: [S19]
      mode: SKIP
      delta_path: null
      reason: "版本交付不使用数据库且无数据迁移。"
      evidence: ["data_impact: none"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S19]
      mode: SKIP
      delta_path: null
      reason: "API 维度为 SKIP；CLI ST 与真实本地安装态 smoke 覆盖进程接缝。"
      evidence: ["api_disposition: SKIP"]
      missing_evidence: []
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data:
    status: none
    reason: "只更新版本元数据、候选身份和本地安装，不迁移或改写业务数据。"
  compatibility:
    status: none
    reason: "0.14.1 是 0.14.0 的 patch 候选；merge transaction 公共协议和既有用户数据格式不变，旧 0.14.0 仅作为可恢复回滚版本。"
  security_privacy:
    status: none
    reason: "不新增网络权限、Secret 或个人数据处理；打包、安装和 smoke 仅访问本机 npm prefix 与隔离临时 fixture。"
  public_release:
    status: none
    reason: "用户只授权本地全局部署；不授权 npm publish、dist-tag、Git tag、GitHub Release、官网部署或 push。"
  external_commitment:
    status: none
    reason: "不创建远程资源、不产生第三方费用，也不形成不可逆外部承诺。"
decisions:
  - id: C01
    category: deployment
    question: "本次 0.14.1 的部署目标、方式、回滚和成功证据是什么？"
    answer: "把当前仓库代码打包成 0.14.1，安装到本机 npm 全局环境；失败时恢复当前 0.14.0；以新 shell 中的全局命令版本、包/插件/asset manifest 一致、candidate 自检和安装态 smoke 作为成功证据。"
    rationale: "用户原文明确要求‘把当前版本的代码打包成0.14.1,部署本地全局’，该授权只覆盖本机全局 candidate，不扩展为公开发布。"
    source: user
    affects:
      - "0.14.1 版本元数据、candidate 身份和 CHANGELOG"
      - "真实 npm tarball 与本机全局安装"
      - "0.14.0 回滚和 0.14.1 恢复"
      - "安装态 smoke 与部署报告"
    rejected_options:
      - "只修改包名或只运行仓库源码，不安装真实 tarball"
      - "执行 npm publish、tag、GitHub Release、官网部署或 push"
unresolved: []
defaults:
  - id: DFLT-01
    category: compatibility
    choice: "只更新代表当前 candidate/package identity 的 0.14.0 断言；描述 0.14.0 breaking cutover 的历史语义、兼容 fixture 和归档规格保持不变。"
    reason: "避免机械替换破坏历史合同与回归语料。"
  - id: DFLT-02
    category: acceptance
    choice: "先执行 CLI 全量测试和构建，再 npm pack、校验 tarball、全局安装并运行安装态检查。"
    reason: "本地全局入口必须来自已通过验证的真实制品。"
```

## 变更概述

将当前 candidate/package identity 从 0.14.0 提升为 0.14.1，同步 CLI package/lockfile、Claude/Codex/ZCode/Qoder/WorkBuddy 插件 manifest、candidate 证据校验、相关测试/golden 和 CHANGELOG；prepack 重新生成与 0.14.1 一致的 asset manifest。历史上用于描述 0.14.0 breaking cutover 的源码注释、错误说明和回归 fixture 不做无差别替换。

规格合并并实现后，先完成全量测试与构建，再生成真实 tarball并记录 SHA-256。部署前冻结当前 `/opt/homebrew/bin/openlogos` 0.14.0 的恢复事实，随后从该 tarball 安装 0.14.1 到本机全局 prefix；安装失败或自检失败立即恢复 0.14.0。部署完成后生成部署报告并停在独立 smoke 授权点，不触发任何公开发布动作。
