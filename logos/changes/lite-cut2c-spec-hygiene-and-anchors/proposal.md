# 变更提案：lite-cut2c-spec-hygiene-and-anchors

> module: core | created: 2026-09-08

## 变更原因

L9 删除后，纯规格订正不再需要任何计划——本提案一次性收掉前三刀积累的规格债，并补上两处**能力缺口**。

**规格债（四项，均由前三刀的删除操作留下或由 `lint-specs` 发现）**

1. `core-S27-test-cases.md:118`（UT-S27-32）与 `core-S31-test-cases.md:157`（ST-S31-10）的表格行比表头多一格。这是 lite-cut1b 交付的 `openlogos lint-specs` **首次运行就发现的两处真实缺陷**——当时因 L9 会要求为这两个不相干场景编造场景文档变更而未修。
2. `core-S33-test-cases.md` 的 6 条用例仍以「S39 闭包 / EvidenceScanner / effective view」描述判据，而这些机制已随 L9 删除；其实现已在 lite-cut2b 迁座到存活消费者，只剩措辞未跟上。
3. `spec/baseline-closure.md` 在 lite-cut2b 废止时残留 4 节未删——其中两节引用的合并事务早在 lite-cut1b 就已删除，自那时起即为悬空定义。**这正是「靠人逐节枚举」会漏的证据**。
4. `logos/resources/test/smoke/` 的 `SMOKE-core-163～167` 验证的 Authority Closure 已随 lite-cut2a 删除；当时因 L9 禁止在「不需要 smoke」的提案里改 smoke 规格而未删。

**能力缺口（两项，均在前三刀中被实际撞到）**

5. **重复标题使章节永久不可寻址**：`spec/cli-json-output.md`、`spec/change-management.md`、`spec/authority-closure.md`、功能规格 §2.35 各有一处**字节完全相同**的重复 `## ` 标题（历史 ADDED delta 在正文中重复了控制块标题所致）。章节锚必然解析为 ambiguous，而锚解析器只支持祖先路径消歧、重复项的祖先链又相同——这些章节以 delta 机制**无法寻址**。前三刀靠「改锚到唯一子节」绕过，留下一批空标题壳。
6. **`lint-specs` 看不见这类污染**：它检查重复 ID、表格列数与 ID 格式，唯独不检查重复标题——而重复标题的后果（章节不可寻址）比重复 ID 更严重。

**门禁调整**

7. L8 条目守恒降级为警告（减法方案 §4 第二刀）。理由：守恒的真正判据是「删掉的 ID 是否还有测试在跑」，这由 `openlogos verify` 的孤儿结果检查天然覆盖；L8 的静态对账在本次减法中多次因区间引用（`UT-S05-47～UT-S05-50`）等形态产生误报，成本高于收益。

## 变更类型

设计级（补两项 merge 引擎/诊断能力，调整一道门的强度，并订正规格）。

## 变更范围
- 影响的功能规格：`core-01-feature-specs.md`（新增章节锚序数消歧与重复标题检查小节；L8 强度调整）
- 影响的业务场景：S09（merge 锚解析）、S27、S31、S33、S35（change-lint / lint-specs）、S37（条目守恒）
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无
- 影响的机器合同：`spec/baseline-closure.md`（清理残留）

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
    reason: 锚序数是**可选后缀**，既有不带后缀的锚行为逐字节不变；L8 降级只改变严重度分级，不改变判据本身
  security_privacy:
    status: none
    reason: 无安全或隐私面
  public_release:
    status: none
    reason: 0.15.0 打包但不全局安装，不做公开发布
  external_commitment:
    status: none
    reason: 无外部承诺
decisions:
  - id: C01
    category: compatibility
    source: policy
    question: L8 降级为警告后，静默删除 ID 由谁兜住
    answer: 由 openlogos verify 的孤儿结果检查兜住——规格删了 ID 而测试还在跑，verify 判 result ledger 不一致
    rationale: 守恒的真正判据是「删掉的 ID 是否还有测试在跑」，那是运行期事实；L8 的静态对账在本次减法中多次因区间引用形态误报，成本高于收益
    affects:
      - cli/src/lib/change-lint.ts
      - cli/src/commands/merge.ts
    rejected_options:
      - 保持 L8 为阻断门
      - 整体删除 L8（连诊断一并丢失）
  - id: C02
    category: compatibility
    source: repository_fact
    question: 章节锚不可寻址应当加能力还是继续绕
    answer: 给锚加可选序数后缀 `[n]`，按文档序在同名候选中选定；不带后缀时行为完全不变
    rationale: 前三刀已三次撞到该限制并各绕一次，留下一批不可清理的空标题壳；继续绕会让存量污染只增不减。序数消歧改动集中在 resolveSectionAnchor 一处，且对既有锚零影响
    affects:
      - cli/src/lib/markdown-section-authority.ts
      - cli/src/commands/lint-specs.ts
    rejected_options:
      - 继续用「改锚到唯一子节」绕过
      - 用 1675 行的上级 H1 整节 MODIFY 覆盖
  - id: C03
    category: acceptance
    source: policy
    question: L8 的三个码是否一并降级
    answer: 只降 delta_implicit_id_removal 与 delta_removed_unknown_id 两个守恒码；delta_section_anchor_unresolvable 保持违规
    rationale: 锚不可解析不是守恒判断而是定位失败——merge 在合成阶段必然 fail-closed，把它降级只会让用户更晚、在更差的位置看到同一个错误
    affects:
      - cli/src/lib/change-lint.ts
    rejected_options:
      - 三个码一起降级
unresolved: []
defaults: []
```

## 变更概述

**能力**：`resolveSectionAnchor` 支持可选序数后缀——`## REMOVED — <标题> [2]` 在同名候选中按文档序选第 2 处。不带后缀时逐字节沿用既有语义（唯一即命中、多处即 ambiguous）。`openlogos lint-specs` 增加「同文件内重复标题」检查项，使这类污染在产生时即可见。

**门禁**：change-lint 的 L8 由违规降级为警告——`delta_implicit_id_removal` 与 `delta_removed_unknown_id` 改走 warnings 通道，`merge` 不再因条目守恒拒绝；`delta_section_anchor_unresolvable` 保持违规（见决策 C03）。

**规格订正**：修复 UT-S27-32 与 ST-S31-10 的表格列数；订正 S33 六条用例的措辞；删除 `spec/baseline-closure.md` 残留 4 节；删除 `SMOKE-core-163～167`。

**明确不做**：重复标题空壳的实际清理与 S39 场景文档的 H1 改名——两者都要用本提案交付的锚序数能力，而本提案自身的 merge 运行在旧引擎上，故留待下一提案。verify 层级简化（O9）与 0.15.0 发布留待第三刀。
