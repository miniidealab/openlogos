# 变更提案：guard-check Bash 写命令路径提取与管辖判定补齐

> module: core | created: 2026-09-06
> slug: fix-guard-check-bash-write-target-jurisdiction
> 来源：runlogos 仓 `logos/resources/reference/openlogos-guard-check-bash-branch-external-path-still-blocked-bug-report.md`（2026-09-06，验证 0.14.23 部署时实测发现）。

## 变更原因

0.14.22（fix-guard-check-external-path-and-stderr）立下的管辖边界合同——「guard 只管本项目源码的变更可追溯性，项目根之外的写入交宿主权限系统」——在 `plugin/bin/guard-check` 的 **Bash 分支对 `rm`/`cp`/`mv`/`mkdir` 类命令结构性不可达**：

1. 命令命中 `BASH_WRITE_PATTERNS`（`^rm `、`^cp `、`^mv `、`^mkdir`、`^touch ` 等）即 `NEEDS_BLOCK=1`；
2. `WRITE_TARGET` **只在 `>` / `>>` 重定向形态下提取**，上述命令从不提取路径参数；
3. `WRITE_TARGET` 为空 → 跳过 `is_whitelisted_path`（含 0.14.22 已修好的管辖边界判定）→ **无条件 block**。

生产实证（2026-09-06，runlogos 仓 launched 无提案）：`rm -rf <session scratchpad 路径>`、`cp <项目外→项目外>` 均被拦——目标全在项目根之外，按合同应放行。日常影响：AI 会话在无提案期写 scratchpad / 用户级文件被持续误拦，与 0.14.22 合同自相矛盾。

用户决策（2026-09-06）：修复不止入仓——**发布 0.14.24 并本机全局部署**，存量项目经 `openlogos sync` 拿到正式字节。本提案因此同时承载 0.14.24 候选发布：版本身份 bump、SMOKE-core-195 安装态验收、隔离矩阵、本机全局部署与正式 smoke。

## 变更类型
设计级

## 变更范围
- 影响的需求文档：`core-01-requirements.md`——S09 guard 验收补「Bash 写命令路径级管辖判定」；S19 补 0.14.24 候选发布要求。
- 影响的功能规格：`core-01-feature-specs.md`（新增 2.66：Bash 写命令路径提取规则、全外放行/任一内且非白名单拦截、解析不出 fail-closed、三运行时一致）。
- 影响的业务场景：S09（guard-check Bash 判定时序补路径提取与逐路径管辖分支）、S19（0.14.24 候选发布节）。
- 影响的根规范：`spec/pretooluse-guard.md`（Bash 写模式判定节补路径提取与管辖判定合同）。
- 影响的部署方案：`core-01-deployment-plan.md`（新增 0.14.24 本机全局部署方案章节）。
- 影响的 API / DB 表 / 编排测试：无。
- 影响的 smoke 测试：`test/smoke/core-smoke-test-cases.md`（新增 SMOKE-core-195）。

## 部署影响
- 是否需要部署：是
- 部署原因：用户决策（「捆绑 0.14.24 + 全局部署 + smoke」）——guard-check 是随 `openlogos sync` 分发到各项目的托管资产，不发布不部署则存量项目（含 runlogos）继续误拦项目外写入。
- 影响环境：本机 npm 全局 prefix（`/opt/homebrew`）
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（固定回滚制品：0.14.23 tarball，SHA-256 `de042d28db4e143a0da0e1e4dc63a9169557ac9cc4dde4ead8e8164ccf507a5b`）
- 是否需要 smoke：是（SMOKE-core-195）

## UI/UX 变更声明

```yaml
ui_impact: false            # 纯 CLI 项目，guard 脚本行为变更无界面
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
    - "guard 写入权限判定的 owner/sole writer/decision 语义零变化：lifecycle 判定、guard 文件存在性、白名单前缀表、exit 2 阻断逻辑与 stderr 双通道输出逐项保持（spec/pretooluse-guard.md 既有合同）"
    - "变更面仅为 Bash 分支把既有 is_whitelisted_path 管辖判定接到此前不可达的命令形态（路径提取），不新增/迁移任何共享事实的裁决者"
    - "guard-check 字节刷新走既有 asset-manifest 托管资产机制；0.14.24 候选身份链沿用既有单一发布机制（S19 candidate identity），SMOKE-core-195 为消费侧验收证据"
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
    reason: 项目根之内的拦截/放行判定逐项不变（白名单表、拦截文案、stderr 双通道保持）；唯一行为差异是「全部路径在项目外」的命令从误拦改为放行——与 0.14.22 已立合同一致，属缺陷修正而非语义变更；解析不出的复杂形态维持现行拦截
  security_privacy:
    status: none
    reason: 放行仅限全部路径参数确证在项目根之外或白名单内——任一路径落在项目内非白名单仍拦；解析失败 fail-closed 不放宽；硬闸保护面（本项目源码）零收窄
  public_release:
    status: none
    reason: 仅本机全局部署；不 npm publish、不 tag、不 GitHub Release、不 git push
  external_commitment:
    status: none
    reason: 无对外承诺变化；是对 0.14.22 已立管辖边界合同的补全履约
decisions:
  - id: C01
    category: deployment
    source: user
    question: guard-check Bash 分支修复是否随本提案发布 0.14.24 到本机全局并 smoke？
    answer: 是——用户选择「捆绑 0.14.24 + 全局部署 + smoke（推荐）」（2026-09-06 会话决策）
    rationale: guard-check 是 sync 分发的托管资产，不发布则存量项目继续误拦项目外写入（影响日常 AI 会话写 scratchpad/记忆文件）。目标环境=本机 npm 全局 prefix（/opt/homebrew），回滚制品固定 0.14.23 tarball（sha256 de042d28…07a5b），成功证据=隔离矩阵+SMOKE-core-195+正式 smoke PASS
    affects: ['0.14.24 候选身份 bump', '部署方案 0.14.24 章节', 'SMOKE-core-195 与 runner', 'deploy 任务与回滚预案', 'S19 场景与测试 delta']
    rejected_options: ['仅仓内修复等下一发版列车（期间各项目 guard 继续误拦项目外写入）']
unresolved: []
defaults:
  - '路径提取规则：跳过以 - 开头的选项 flag 后，取命令的全部路径实参（rm/mkdir/touch/chmod/chown 全量实参；cp/mv 全量实参含源与目标）；逐一走既有 is_whitelisted_path 管辖判定——可逆实现细节'
  - '放行判据：全部路径参数均在项目根之外或白名单内 → 放行；任一路径在项目根之内且非白名单 → 维持拦截（携既有 stderr 指引）——可逆实现细节'
  - '解析不出（含变量展开、命令替换、管道复合形态）→ 维持现行无条件拦截，fail-closed 不放宽；BASH_SAFE_PATTERNS（含 git push）优先级不变——可逆实现细节'
  - '回滚制品取 0.14.23 部署窗口冻结件（sha256 de042d28…07a5b）——可逆实现细节'
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
      reason: "S09 补 Bash 写命令路径级管辖判定验收（全外放行/任一内拦截/解析不出 fail-closed）；S19 补 0.14.24 候选发布要求。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S09, S19]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "新增 2.66：Bash 写命令路径提取与管辖判定功能规格 + 0.14.24 候选内容清单与发布验收口径。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md", "spec_fact: 现最大功能编号 2.65"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "S09 guard-check Bash 判定时序补路径提取与逐路径管辖分支（含解析不出保守臂）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md"
      reason: "S19 新增 0.14.24 候选发布节（身份冻结→隔离矩阵→全局覆盖→smoke 与失败回滚边界）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md", "spec_fact: 已有 0.14.21~0.14.23 全局 candidate 先例节"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S09, S19]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"
      reason: "新增 0.14.24 本机全局部署方案章节（隔离矩阵含项目外 rm/cp 放行实测与 0.14.23 误拦对照，回滚制品固定 0.14.23 tarball）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/pretooluse-guard.md"
      reason: "Bash 写模式判定节补路径提取与逐路径管辖判定合同（放行判据、fail-closed 边界、三运行时一致）。"
      evidence: ["target_exists: spec/pretooluse-guard.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "新增回归锚（项目外 rm/cp 误拦必红→放行必绿）/安全面零放宽/解析不出保守臂/三运行时一致用例（新 ID 自 UT-S09-317 / ST-S09-122 起）。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S19]
      mode: MODIFY
      delta_path: "deltas/test/core-S19-test-cases.md"
      reason: "新增 0.14.24 候选身份全源一致与回滚身份 0.14.23 tripwire 用例（新 ID 自 UT-S19-41 起）。"
      evidence: ["target_exists: logos/resources/test/core-S19-test-cases.md"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S09, S19]
      mode: MODIFY
      delta_path: "deltas/test/smoke/core-smoke-test-cases.md"
      reason: "新增 SMOKE-core-195（安装态项目外放行 + 项目内拦截零回归 + 0.14.23 误拦缺陷复现对照 + roundtrip）。"
      evidence: ["target_exists: logos/resources/test/smoke/core-smoke-test-cases.md", "spec_fact: 现末号 SMOKE-core-194"]
      missing_evidence: []
    - category: api
      scenario_ids: [S09, S19]
      mode: SKIP
      delta_path: null
      reason: "无 HTTP/RPC 接口；guard-check 为 hook 脚本。"
      evidence: ["项目无 logos/resources/api/ 目录"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S09, S19]
      mode: SKIP
      delta_path: null
      reason: "无架构文档目标：复用既有 is_whitelisted_path 判定与发布链，不引入新组件/新边界。"
      evidence: ["先例：fix-guard-check-external-path-and-stderr 同类修复 architecture=SKIP"]
      missing_evidence: []
    - category: database
      scenario_ids: [S09, S19]
      mode: SKIP
      delta_path: null
      reason: "无业务数据。"
      evidence: ["guard-check 为无状态判定脚本"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S09, S19]
      mode: SKIP
      delta_path: null
      reason: "无 API 编排；行为纳入 S09 场景测试与 SMOKE-core-195。"
      evidence: ["api disposition=SKIP"]
      missing_evidence: []
```

## 变更概述

在 `plugin/bin/guard-check` 的 Bash 写模式分支补「路径提取 → 逐路径管辖判定」：命中 `BASH_WRITE_PATTERNS` 的 `rm`/`cp`/`mv`/`mkdir`/`touch`/`chmod`/`chown` 等命令，跳过选项 flag 提取全部路径实参，逐一走既有 `is_whitelisted_path`（含 0.14.22 管辖边界与白名单判定）——全部路径在项目根之外或白名单内则放行，任一路径在项目内且非白名单维持拦截（stderr 指引保持）；解析不出的复杂形态（变量展开/命令替换/管道复合）维持现行无条件拦截，fail-closed 不放宽；python3/node/bash 兜底三运行时同判。随提案捆绑 0.14.24 候选发布：身份 bump、SMOKE-core-195（安装态放行/拦截矩阵 + 0.14.23 误拦对照 + roundtrip）、隔离矩阵、本机全局部署。

预计代码范围：`plugin/bin/guard-check`（为主）、版本身份文件族、`scripts/smoke-*` runner 及对应测试。不得修改无关用户改动。

## 交付状态与后续边界

本次只填写 proposal.md 与 tasks.md。确认提案后才产出 delta；merge 后由 slice-planner 规划代码切片。merge、verify、部署执行、smoke、archive、push 按现行授权规则执行。
