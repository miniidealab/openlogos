# 变更提案：lite-cut3a-degate-clarification-ui-seed

> module: core | created: 2026-09-08

## 变更原因

减法方案 §12.1 的 O5、O6、O7——三处**产品能力被实现成阻断门**的形态订正。方案 §5 的划线原则说得明确：

> 前四刀砍的是纯机制；而评审、部署、smoke、UI 原型、baseline seed、clarification 是**产品能力，一个都不删**。它们真正的问题不是「存在」，而是被实现成了**阻断门 + 状态机 + 审计判据**。正确的减法是：能力保留，形态从「门」改成「步骤」。

本提案对三者各做一次形态订正，**能力一项不减**：

1. **O5 决策澄清（clarification）**：`openlogos/clarification@1` 契约把「作者是否想清楚了」变成机器判定——schema 非法即 plan 不完成。但「想清楚没有」不是机器能判的事；契约实际拦下的是 `id` 不匹配 `C\d+`、`source` 不在三值枚举、`affects` 不是字符串数组这类形态问题。本次减法自身在 lite-cut2a 就被它拦过一次，改的全是字段形态。**决策澄清作为文档保留**（它对读者有真实价值），只是不再作为判定。

2. **O6 UI provenance**：原型 hash 对账目前是 merge 的 fail-closed 前置门，且在 flow 中占一个 overlay 节点（`verify-ui-provenance`）。它要防的是「批准后原型漂移」——这是**审计性质的观察**，按 §10「任何审计产物都不得出现在流程分支的条件里」应降为警告。原型产出能力（`write-ui-prototype` 节点、`check-ui-prototype`、`check-ui-hash-match` 命令）全部保留。

3. **O7 baseline seed 恢复门**：未终结的 seed journal 会让 `status` / `next` / `change-lint` 等只读消费者以 `baseline_commit_in_progress` 硬阻塞。**这道门保护的读者已经不存在了**——它防的是 ClosureEvaluator / EvidenceScanner 读到半新半旧的资源树，而这两者已随 lite-cut2b 的 L9 删除。当前模型下 merge 的目标集由 `deltas/` 派生、模式按磁盘事实即时判定，**部分播种的资源树天然被正确处理**：已落盘的目标判 MODIFY、未落盘的判 CREATE，两种都对。

**O10（审计改为纯日志）经核查已随前三刀完成**：方案点名的四个病灶——receipt 参与完成判定、合同摘要参与放行判定、权威闭包/条目守恒作为 lint 门、provenance 决定能否推进——前三者分别随 lite-cut1b / 2a / 2c 归零（本仓当前 `receipt` / `contract_sha256` / `authority_closure` 参与条件判断均为 0 处），第四者即本提案的 O6。故不单列改动。

## 变更类型

设计级（三处能力的形态由「阻断门」改为「警告/文档」，能力本身不变）。

## 变更范围
- 影响的功能规格：`core-01-feature-specs.md`（三处形态订正）
- 影响的业务场景：S05（next 派生）、S09（merge 准入）、S11（status 投影）、S16（机器合同）、S33（seed 三态）、S35（change-lint）
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无
- 影响的流程定义：`logos/flow/launched.yaml`（移除 `verify-ui-provenance` overlay 节点）
- 影响的机器合同：`spec/cli-json-output.md`（`plan_state.clarification` 不再发射）

## 部署影响
- 是否需要部署：否
- 部署原因：减法方案 §13 保险条款——全局 CLI 保持 0.14.25 直到 runlogos 侧改造完成
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 决策澄清

> 说明：本小节自本提案起是**纯文档**——它记录作者的取舍供读者理解，不再被任何机器判据消费（O5）。

```yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data:
    status: none
    reason: 不触及任何持久化数据结构
  compatibility:
    status: none
    reason: 三处对外面均无在用消费方——runlogos 仍锁定全局 0.14.25（§13 保险条款）
  security_privacy:
    status: none
    reason: 无安全或隐私面
  public_release:
    status: none
    reason: 0.15.0 打包但不全局安装
  external_commitment:
    status: none
    reason: 无外部承诺
decisions:
  - id: C01
    category: product
    source: policy
    question: 决策澄清小节是删除还是保留为文档
    answer: 保留为纯文档——模板继续生成该小节，change-writer 继续填写，但不再被解析、不再影响任何判定
    rationale: 「作者的取舍」对后来的读者有真实价值，删掉是能力损失；机器判不了「想清楚没有」，只判得了字段形态，那部分才是过度设计
    affects:
      - cli/src/lib/plan-package.ts
      - cli/src/i18n.ts
    rejected_options:
      - 连同小节一并删除
      - 保留契约但把违规降级为警告（仍需维护 431 行解析器）
  - id: C02
    category: ownership
    source: repository_fact
    question: seed 恢复门降级后，半新半旧的资源树由谁兜住
    answer: 不需要兜——该门保护的读者（ClosureEvaluator / EvidenceScanner）已随 lite-cut2b 删除
    rationale: 当前 merge 的目标集由 deltas 派生、模式按磁盘事实即时判定，部分播种的资源树天然被正确处理（已落盘判 MODIFY、未落盘判 CREATE）。继续为一个不存在的读者维持硬阻塞，是纯粹的成本
    affects:
      - cli/src/lib/baseline-seed-txn.ts
      - cli/src/commands/status.ts
    rejected_options:
      - 维持硬阻塞
      - 只对写入方保留硬阻塞（merge 经 change-lint 间接取锁，无法干净分层）
  - id: C03
    category: acceptance
    source: policy
    question: 损坏的 journal 直接丢弃还是隔离留存
    answer: 隔离留存——重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 后继续，并打印告警
    rationale: 「作废重来」不等于「毁尸灭迹」。损坏的恢复指令是事故现场，留存成本接近零而事后可查；直接删除会让同类问题无法复盘
    affects:
      - cli/src/lib/baseline-seed-txn.ts
    rejected_options:
      - 直接删除 journal
      - 保持抛错阻塞
unresolved: []
defaults: []
```

## 变更概述

**O5**：`evaluatePlanPackage` 不再产出 `proposal_clarification_invalid`；`status` / `next` 的 `plan_state` 不再携带 `clarification` 字段；删除 `lib/clarification.ts`（431 行）及其在 change-lint / plan-package / proposal-lifecycle 的接线。提案模板的「## 决策澄清」小节**原样保留**，change-writer 继续按现有格式填写。

**O6**：merge 的 UI provenance 前置门由 fail-closed 改为打印告警后继续；`logos/flow/launched.yaml` 移除 `verify-ui-provenance` overlay 节点。`write-ui-prototype` 节点、`check-ui-prototype` 与 `check-ui-hash-match` 两个命令、原型产出与落盘能力**全部保留**——后者从「门」变成用户主动运行的诊断。

**O7**：`withRecoveredReadLocks` 遇到无法恢复的 journal 时，不再抛 `BaselineCommitInProgressError`，改为把损坏的 journal 隔离（重命名留存）、打印告警并继续。可恢复路径（前滚 / 回滚）**逐行不变**；锁竞争仍按既有语义返回 `inProgress`（那是真实的瞬态条件，不是审计判据）。

**明确不做**：O9（verify 层级简化）与 O11（发 0.15.0）留待下一提案；`smoke` / `deploy` / `archive` / `launch` / `adopt` / `init` / `sync` 一律不动（方案 §12.1「openlogos 侧不动」清单）。
