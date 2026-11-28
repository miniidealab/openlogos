## ADDED — 提案的「受影响场景」段（layered-verification）

> 规则权威见功能规格 §2.109.4～§2.109.7。本节说明该段在变更流程中的位置与责任。

`openlogos change <slug>` 生成的 `proposal.md` 在「验收标准」之后含「受影响场景」段（en：`Affected Scenarios`）。它回答：这次改动除了本提案自己新增或修改的用例之外，还会波及哪些已有场景。

```yaml
schema: openlogos/affected-scenarios@1
assessment: assessed         # pending（未填写）| assessed | unknown
shared_change: false         # 是否涉及共享代码、配置或依赖
scenarios:
  - id: S13
    reason: 修改了 verify 的门禁判定，S13 的结果读取与门禁用例都依赖它
```

- **谁填**：change-writer 在写提案时评估并填写（`skills/change-writer/SKILL.md`「Step 4 补充：『受影响场景』段」）。无法判断时写 `assessment: unknown`，不猜测。
- **谁审**：用户在「批准方案」时随方案一起审视。提案改动核心流程时，同时审视主链路用例是否需要调整。
- **谁检查**：`openlogos change-lint`。缺段只警告；未填写（`pending`）、结构非法、理由为空、引用不存在的场景报违规。
- **谁用**：分层开启（`verify.layered.enabled: true`）的项目上，`openlogos verify` 用它确定提案级验收要跑哪些场景的用例。未开启的项目不读取它。
- **只扩大不缩小**：提案 delta 触及的场景自动并入，不依赖声明；声明缺失、非法、无法评估或引用不存在的场景时，验收范围扩大而不是失败，且声明中已能识别的场景仍然保留；声明或实际改动涉及共享代码、配置、依赖时扩大到全量——`shared_change: true` 只要能读出就生效，不要求声明的其余部分合法。
- **持续有效**：实现过程中发现影响面扩大，更新该段；verify 每次运行重新读取。声明之外的场景被代码改动波及时，verify 无法从代码差异发现——发布级全量验收是兜底。
- 该段不是 canonical 必填章节；0.16.27 之前创建的提案没有它，不影响流程推进。
