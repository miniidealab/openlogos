# 变更提案：lite-cut3b-verify-layers-and-release-0-15-0

> module: core | created: 2026-09-08

## 变更原因

减法方案 §12.1 的最后两项 O9、O11，外加前五刀积累的收尾清理。

**O9 verify 层级简化**：`openlogos verify` 目前有三层判定同时参与 Gate——Layer1（从测试规格「三、覆盖度校验」清单解析的设计时断言）、Layer2（测试执行结果）、Layer3（AC → 用例 → 结果的追溯矩阵）。方案的裁定是：**Layer2 保留，Layer1/Layer3 的复杂追溯矩阵简化为一条集合比对**——「规格声明的 ID 集合 ⊆ 测试结果中出现的 ID 集合」。

理由与前几刀一致：Layer1 是**作者在设计期写下的自我断言**（勾选框），Layer3 是**人工维护的追溯表**。两者都是「人声称覆盖了」，而 Layer2 与 ID 覆盖检查是「机器看到确实跑了」。让前者参与放行，等于让声明覆盖事实。真正不可替代的是 ID 覆盖检查本身——规格声明 10 个用例只实现 3 个、那 3 个绿了就判通过，规格驱动的核心价值就没了——**这一条完整保留**。

**O11 发 0.15.0**：破坏性变更，不做兼容层。按 §13 保险条款，**打包但不全局安装**——全局保持 0.14.25 直到 runlogos 侧改造完成，任何时刻只有一个项目处于施工中。

**收尾清理**（前五刀留下的，现已零成本或已具备能力）：

1. `UT-S27-32` 与 `ST-S31-10` 行首多余空格——lite-cut2c 合并单元格时我引入的瑕疵。
2. 三份 spec 与功能规格中的**重复标题空壳**——lite-cut2c 交付的序数锚 `[n]` 使其首次可寻址。
3. 清理过程中发现的**两处前几刀漏网**：`spec/flow-spec.md` 的「Authority Closure plan 前沿派生」仍有正文（lite-cut2a 应删未删）、功能规格 `2.35` 下仍剩 `2.35.9`（lite-cut2b 逐节枚举时遗漏）。
4. 测试规格中同一父节下重名的 `### 单元测试` / `### 场景测试`——路径锚无法消歧，改名消除。

## 变更类型

设计级（verify 判定层收敛）+ 发布级（0.15.0 破坏性版本）。

## 变更范围
- 影响的需求文档：`core-01-requirements.md`（verify 判定层要求）
- 影响的功能规格：`core-01-feature-specs.md`（§2.75 verify 判定层收敛；清理 2.35 残留）
- 影响的业务场景：S13（verify 结果消费）、S19（发布与安装态 smoke）
- 影响的部署方案：新增 0.15.0 打包方案节
- 影响的 API：无
- 影响的 DB 表：无
- 影响的机器合同：`spec/cli-json-output.md`（verify envelope 去 checklist/ac_trace）、`spec/flow-spec.md`、`spec/change-management.md`（清理空壳与漏网）

## 部署影响
- 是否需要部署：是
- 部署原因：0.15.0 是破坏性版本，必须以真实 tarball 在隔离 prefix 中证明安装态身份与行为；这是 runlogos 侧改造的输入
- 影响环境：**仅一次性隔离 npm prefix**——按减法方案 §13 保险条款，**不触碰本机全局**（全局保持 0.14.25）
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（固定 0.14.25 tarball 为回滚基线；本机全局本就未被改动，回滚成本为零）
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data: {status: none, reason: 不触及任何持久化数据结构}
  compatibility: {status: required, reason: 0.15.0 是破坏性版本，移除的命令面与 JSON 投影是 runlogos 的消费对象}
  security_privacy: {status: none, reason: 无安全或隐私面}
  public_release: {status: none, reason: 只打包与隔离验证，不做 npm publish / dist-tag / Git tag / GitHub Release}
  external_commitment: {status: none, reason: 无外部承诺}
decisions:
  - id: C01
    category: release
    source: policy
    question: 0.15.0 是否本机全局安装
    answer: 否——只打包并在一次性隔离 prefix 中验证，本机全局保持 0.14.25
    rationale: 减法方案 §13 的保险条款。若阶段 1 就全局装 0.15.0，runlogos 会立刻找不到已删除的命令面而全面失效，届时同时面对两个坏掉的项目、无法二分定位。保持全局 0.14.25 直到两侧都绿
    affects:
      - logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md
    rejected_options:
      - 打包后立即本机全局安装
      - 不打包，让 runlogos 直接引用工作区源码
  - id: C02
    category: acceptance
    source: policy
    question: Layer1/Layer3 是删除还是保留为报告
    answer: 从 Gate 判定中移除，报告段一并删除
    rationale: 「简化为这一条」指的就是判定收敛。留着报告段而不参与判定，等于留一份没人负责维护的追溯表——它会随规格漂移而失真，反而误导读者。ID 覆盖检查已完整回答「规格声明的用例是否都真跑了」
    affects:
      - cli/src/commands/verify.ts
      - spec/cli-json-output.md
    rejected_options:
      - 保留报告段但不参与 Gate
      - 整体保留
unresolved: []
defaults: []
```

## 变更概述

**O9**：`verify` 的 Gate 判据由五项收敛为三项——账本一致性、零失败、零未覆盖。删除 Layer1 覆盖度校验清单的解析与判定、Layer3 AC 追溯矩阵的构建与判定，以及二者在 Markdown 报告与 JSON envelope 中的输出段。**ID 覆盖检查（`uncovered`）完整保留**，它就是方案要求留下的那一条。

**O11**：版本推进到 `0.15.0`——CLI `package.json` 与 lockfile、随包 plugin/资产模板 manifest、asset manifest、携带版本的 schema/golden/runner 元数据同步。真实 `npm pack` 冻结 tarball 身份，在一次性隔离 npm prefix 中证明：candidate identity 全部来自固定 tarball；`merge` 一次调用可完成多目标合并；已删除的命令面（`merge transaction *`、`merge-apply`、切片事务）一律 fail-closed；`change-lint` 为 9 项；新命令 `slice plan` / `lint-specs` 可用。**不执行本机全局安装**。

**清理**：两处行首空格；`spec/change-management.md`、`spec/cli-json-output.md`、`spec/flow-spec.md` 与功能规格 `2.35` 的重复标题空壳（用 `[n]` 序数锚精确删除）；`spec/flow-spec.md` 的 Authority Closure 派生正文与功能规格 `2.35.9` 两处漏网；测试规格中路径锚无法消歧的重名子节改名。

**明确不做**：npm publish、dist-tag、Git tag、GitHub Release、官网部署、`git push`、本机全局安装——每一项都是独立的人类确认点。S39 场景文档的 H1 标题仍无法通过 delta 修改（缺「改文档级标题」能力），留作已知遗留。
