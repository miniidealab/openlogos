# 变更提案：fix-claude-guard-hook-project-dir-and-sync-deploy

> module: core | created: 2026-09-05

## 变更原因

来源：`logos/resources/reference/openlogos-claude-guard-hook-project-dir-and-sync-deploy-gap-bug-report.md`（RunLogos `fix-driver-merge-transaction-contract-alignment` 排查移交，2026-09-05 在 0.14.20 安装版与本仓源码复核三项全部成立）。

Claude Code 的 PreToolUse guard hook（launched 无活跃提案时硬拦 Edit/Write/Bash）存在三层缺陷：

1. **缺陷①（P1）**：`init.ts:1141` 的 `guardRelPath = '.claude/openlogos/bin/guard-check'` 为相对路径并被 `mergeClaudePreToolUseGuard` 原样写进 `.claude/settings.json`；全仓 `CLAUDE_PROJECT_DIR` 零命中。非项目根 cwd 的会话每次触发 hook 都报 `No such file or directory`——刷屏且 guard 静默失效。SessionStart hook 同函数族同病。
2. **缺陷②（P1）**：`plugin/bin/guard-check` 第一步 `CONFIG_FILE="logos/logos.config.json"` 及后续全部判定相对 cwd——即使修好①，非项目根 cwd 进来第一步就判「非 OpenLogos 项目」`exit 0` **静默 fail-open**，比刷错误更隐蔽。
3. **缺陷③（P1）**：guard 资产（bin 拷贝 + hook 注册）只在 `init`/`adopt` 部署；`sync.ts` 零涉及、`asset-manifest.json` 无条目。guard 功能上线前 init 的存量项目（runlogos 实测：`.claude/openlogos/bin/` 无 guard-check、settings.json 无 PreToolUse 段）至今没有硬闸——且 `spec/directory-convention.md` §guard-check 明文承诺「由 init / sync 自动部署」，属规格-实现背离。

## 变更类型
设计级

## 变更范围
- 影响的需求文档：`core-01-requirements.md` 中 S01、S08、S09 的 guard 部署与判定验收条件。
- 影响的功能规格：`core-01-feature-specs.md`（hook 注册形态、guard-check 工作目录收敛 fail-closed、sync 托管 guard 资产）。
- 影响的业务场景：S01（init 部署 hook 的注册命令形态与幂等迁移）、S08（sync 托管资产面纳入 guard）、S09（guard-check 工作目录收敛与 fail-closed 语义）。
- 影响的根规范：`spec/pretooluse-guard.md`（§配置示例钉着旧相对路径形态、§部署段需成文 sync 资产面与 fail-closed）。
- 影响的 API / DB 表 / 编排测试：无。
- 影响的 smoke 测试：无（本提案不部署，见「部署影响」）。

## 部署影响
- 是否需要部署：否
- 部署原因：用户决策——本提案仅规格 + 代码入仓并 verify 通过；修复随下一个部署窗口发布（届时存量项目经 `openlogos sync` 补齐硬闸）。
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## UI/UX 变更声明

```yaml
ui_impact: false            # 纯 CLI 项目，hook 注册与脚本行为变更无界面
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
    - "guard 写入权限判定的 owner/sole writer/decision 语义零变化：lifecycle 判定、logos/.openlogos-guard 存在性、白名单与 exit 2 阻断逻辑逐项保持（spec/pretooluse-guard.md 既有合同）"
    - "变更面为执行环境收敛（hook 注册命令形态 + 脚本工作目录 cd \"$CLAUDE_PROJECT_DIR\"）与部署资产面（sync 托管 guard），不新增/迁移任何共享业务事实的裁决者"
    - "无消费者依据文件扫描/mtime 重算决定的路径变化；asset-manifest 登记走既有托管资产机制"
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: 无数据面；settings.json 合并沿用既有幂等 merge 语义，旧相对路径条目迁移为新形态（不并存）
  compatibility:
    status: none
    reason: guard 判定语义逐项不变；hook command 新旧写法由幂等去重兼容迁移；CLAUDE_PROJECT_DIR 是 Claude Code 官方约定环境变量
  security_privacy:
    status: none
    reason: 修复本身是安全增强——消除非根 cwd 静默 fail-open 与存量项目硬闸缺失；fail-closed 语义（变量缺失 exit 2）与 guard 硬闸定位一致
  public_release:
    status: none
    reason: 不部署、不发布；零公开副作用
  external_commitment:
    status: none
    reason: 无对外承诺变化；spec/directory-convention.md 既有「init/sync 自动部署」承诺由本修复兑现而非更改
decisions:
  - id: C01
    category: deployment
    source: user
    question: guard hook 三项修复落地后，是否随本提案部署 0.14.21 到本机全局并 smoke？
    answer: 仅规格 + 代码，不部署
    rationale: 用户选择修复入仓 verify 通过即可，随下一个部署窗口发布；存量项目硬闸缺失与非根 cwd fail-open 在窗口前继续存在（已知状态）
    affects: ['无 deploy section', '无 smoke 用例 delta', '无部署方案 delta', '无版本 bump']
    rejected_options: ['部署 0.14.21 + smoke（隔离矩阵含子目录 cwd 拦截实测与 0.14.20 fail-open 对照）']
unresolved: []
defaults:
  - 'hook 注册采用 Claude Code 官方 "$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check 形态；guard-check 开头 cd 到 CLAUDE_PROJECT_DIR 收敛工作目录——均为可逆实现细节，不设用户问项'
  - '兼容窗口内 CLAUDE_PROJECT_DIR 缺失（旧版 Claude Code）时 guard-check 回退 cwd 判定仅当 cwd 即项目根可行；变量在场以变量为准，缺失且 cwd 无 logos.config.json 时 fail-closed exit 2 给诊断（不静默放行）'
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
  touched_scenario_ids: [S01, S08, S09]
  targets:
    - category: requirement
      scenario_ids: [S01, S08, S09]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "S01/S08/S09 验收条件需补 hook 注册形态、sync 补齐 guard 资产与非根 cwd fail-closed。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S01, S08, S09]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "需成文三项修复的功能规格（注册形态与幂等迁移、工作目录收敛与 fail-closed、sync 托管 guard 资产）。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S01]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md"
      reason: "S01 需补 init 写入 PreToolUse/SessionStart hook 的 $CLAUDE_PROJECT_DIR 注册形态与新旧条目幂等迁移。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S08]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md"
      reason: "S08 托管资产面需纳入 guard 资产（bin 落盘 + hook 注册 + asset-manifest 登记），存量项目 sync 即补齐。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "S09 需补 guard-check 工作目录收敛时序与 fail-closed 异常边界（变量缺失 / 非根 cwd）。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S01, S09]
      mode: MODIFY
      delta_path: "deltas/spec/pretooluse-guard.md"
      reason: "§配置示例钉着旧相对路径 command 形态；需成文 $CLAUDE_PROJECT_DIR 注册、工作目录收敛 fail-closed 与 sync 资产面部署合同。"
      evidence: ["target_exists: spec/pretooluse-guard.md", "spec_fact: §23-34 示例 command 为 .claude/openlogos/bin/guard-check 相对形态"]
      missing_evidence: []
    - category: test
      scenario_ids: [S01]
      mode: MODIFY
      delta_path: "deltas/test/core-S01-test-cases.md"
      reason: "新增 UT-S01-137～138（注册形态 / 新旧条目幂等迁移）与 ST-S01-30（init 后两 hook 形态与重复执行零重复）。"
      evidence: ["target_exists: logos/resources/test/core-S01-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S08]
      mode: MODIFY
      delta_path: "deltas/test/core-S08-test-cases.md"
      reason: "新增 UT-S08-59～60（sync 托管 guard 资产 / 存量项目补齐与迁移）与 ST-S08-37（真实 CLI sync 端到端补齐幂等）。"
      evidence: ["target_exists: logos/resources/test/core-S08-test-cases.md"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "新增 UT-S09-313～314（fail-closed / 子目录 cwd 判定一致性）与 ST-S09-120（子目录 cwd 端到端拦截与放行）。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md"]
      missing_evidence: []
    - category: api
      scenario_ids: [S01, S08, S09]
      mode: SKIP
      delta_path: null
      reason: "CLI 项目，无对外 API；hook 注册与脚本行为无 API 面。"
      evidence: ["project_fact: product_type=cli，logos/resources/api/ 无本域目标"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S01, S08, S09]
      mode: SKIP
      delta_path: null
      reason: "无组件/职责/权威变化：guard 决策器、SessionStart launcher、sync 托管资产机制均为既有组件，本次仅注册形态、脚本工作目录与资产面登记；Authority Impact 判 not_applicable 同理。"
      evidence: ["code_fact: mergeClaudePreToolUseGuard/guard-check/sync 托管资产机制均已存在，无新组件"]
      missing_evidence: []
    - category: database
      scenario_ids: [S01, S08, S09]
      mode: SKIP
      delta_path: null
      reason: "无数据库。"
      evidence: ["project_fact: 无 logos/resources/database/ 本域目标"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S01, S08, S09]
      mode: SKIP
      delta_path: null
      reason: "用户决策不部署（C01）；部署方案无本次变更。"
      evidence: ["decision: C01 仅规格 + 代码，不部署"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S01, S08, S09]
      mode: SKIP
      delta_path: null
      reason: "无 API 即无编排测试维度。"
      evidence: ["project_fact: API 维度 SKIP，编排随之不适用"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S01, S08, S09]
      mode: SKIP
      delta_path: null
      reason: "不部署故本提案无 smoke 用例变更；hook 行为由 UT/ST 直接驱动脚本与 settings 合并覆盖。"
      evidence: ["decision: C01 不部署", "test_fact: guard-check 可用 stdin JSON + 环境变量直接驱动断言"]
      missing_evidence: []
```

## 变更概述

三项联动修复，guard 判定语义零变化：

1. **注册形态（缺陷①）**：`init`/`adopt` 写入的 PreToolUse hook command 改为 `"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check`（Claude Code 官方项目根环境变量），SessionStart 同函数族同步；`mergeClaudePreToolUseGuard` 的幂等去重同时识别新旧两种写法——旧相对路径条目升级迁移为新形态，不并存、不重复注册。
2. **工作目录收敛（缺陷②）**：`plugin/bin/guard-check` 开头收敛工作目录到 `$CLAUDE_PROJECT_DIR`；变量缺失且 cwd 不可判定为项目根时 **fail-closed**（exit 2 + 可读诊断），绝不静默放行。`cd` 后既有判定逻辑（lifecycle/guard 文件/白名单/realpath 归一化）语义自洽、逐项不变。
3. **sync 资产面（缺陷③）**：guard 资产（bin 文件 + PreToolUse hook 注册）纳入 `openlogos sync` 托管资产面（asset-manifest 登记版本化哈希，与 skills/AGENTS.md 同一机制）——存量项目升级 CLI 后 sync 即补齐硬闸，兑现 `spec/directory-convention.md` 既有「init / sync 自动部署」承诺。

本提案不部署（C01）；代码入仓 + verify 通过后归档，随下一个部署窗口发布。
