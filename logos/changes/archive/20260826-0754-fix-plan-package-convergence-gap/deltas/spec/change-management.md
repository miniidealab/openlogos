## ADDED — Plan Package 统一完成合同（openlogos/plan-package-evaluation@1）

### 单一事实源

launched change 在 plan 前沿的 proposal/tasks 完成语义由 `PlanPackageEvaluator` 唯一持有。CLI scaffold、change-writer、change-lint、status、next 与 flow derive 必须消费同一 locale section registry 和 evaluation；禁止通过自然语言完成声明、checkbox 总数、文件存在或第二套正则旁路。

### proposal canonical 章节

registry 使用稳定语义 ID：`reason`、`type`、`scope`、`deployment`、`summary`、`clarification`。locale 只决定显示标题；必需章节必须唯一、非空、无模板占位，字段必须满足各自共享 evaluator。额外详细章节可存在，但不能替代 canonical 章节。

### tasks 完成分层

- `tasks_plan_filled`：plan 阶段 `[delta]/[deploy]` 已脱模板并与 proposal 一致。
- `tasks_code_required`：本 change 在 spec-complete 后需要切片与代码实现。
- `tasks_code_slices_filled`：merge 后 slice-planner 已写真实 `[code]` 切片。

空 `[code]` 在 plan 阶段是代码必需锚点；plan 阶段任何 `[code]` checkbox 均非法。三个状态不得压缩回一个 `tasks_filled`。

### L0 与等价关系

change-lint 在 L1～L9 前运行 L0。无 Delta、无 `PLAN_APPROVED`、无更高优先级错误的 plan 前沿必须满足：

```text
change-lint.pass
  ⇔ plan_package.ready
  ⇔ status.plan_state.plan_ready
  ⇔ next.proposal_step == ready-to-delta
```

L0 失败 exit 2；文件不可读、解析器故障等操作错误 exit 1。所有消费者共享 issue code/path/section/actual/expected/fix_hint 与稳定排序。

### producer 交付纪律

change-writer 必须填充 CLI scaffold、写后从磁盘读回、运行 change-lint 与 next 双检查。任一未收敛时不得报告 plan 完成。该检查不写 marker，不替代 plan-exit 批准，也不授权 Delta、merge、部署或发布。

### 历史与跨仓边界

已存在 `PLAN_APPROVED|SPEC_MERGED|MERGED|VERIFY_PASS` 的历史提案不因新模板规则回退；writing 中旧提案只诊断、不由只读命令自动修复。OpenLogos 在 dispatch 中声明 completion；RunLogos 独立执行并管理 WorkUnit，禁止复制 Markdown parser 或 proposal_step 规则。

### merge-apply 的历史测试 ID 收敛

当测试规格的 before 基线含历史重复 ID、而 prepared after 已收敛为唯一结构化定义时，test change set 构造必须允许 before 以同 ID 多候选参与语义匹配：after 定义匹配任一候选即视为该 ID 未变；after 不含该 ID 时只记录一次 removed；重编号后的新 ID进入 changed。before 中列数不一致的历史歧义行跳过候选匹配，对应 after 定义保守计入 changed；after 侧仍严格拒绝任何重复或歧义表行。

该规则是单向兼容门，不是重复 ID 豁免：只有 after 全局唯一、表结构明确、UTF-8 合法且事务全部预检通过才可 apply。任何 after 重复或歧义继续在首写前失败，正式 targets、metadata 与 `SPEC_MERGED` 全部保持旧态。
