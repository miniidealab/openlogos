## ADDED — 2.43 Plan Package 统一完成合同功能规格

### 2.43.1 产品目标

把“proposal/tasks 是否完成”从多个布尔函数和 Agent 文案收敛为一个版本化产品能力。用户只需处理最终问题列表或批准门，不再辨别 lint、status、next 哪一个结论可信。

### 2.43.2 PlanPackageEvaluation 视图

统一视图至少包含：

| 字段 | 语义 |
|---|---|
| `schema` | 固定 `openlogos/plan-package-evaluation@1` |
| `contract_version` | 完成合同版本，独立于 CLI semver |
| `ready` | 当前 plan 前沿是否满足批准门前全部完成条件 |
| `proposal.filled` | locale canonical proposal 是否完整 |
| `tasks.plan_filled` | `[delta]/[deploy]` 是否完成 plan 规划 |
| `tasks.code_required` | merge 后是否需要 slice-planner |
| `tasks.code_slices_filled` | merge 后真实 `[code]` 切片是否已写入 |
| `issues[]` | 稳定、可定位、可修复的问题集合 |

### 2.43.3 locale-aware proposal 体验

- section registry 以 `reason/type/scope/deployment/summary/clarification` 语义 ID 管理中文、英文标题。
- 必需章节必须唯一、正文非空、无模板占位；变更类型、部署字段与 clarification 必须合法。
- Agent 可保留额外“核心设计”等详细章节，但不得用其替换 canonical `summary`。
- 用户看到的问题按文件、行号与 section 呈现，避免仅显示“请继续完善”。

### 2.43.4 tasks 三态与 scaffold

- launched scaffold 的 `[delta]` 条目仍是必须替换的计划模板。
- 需要代码时 scaffold 生成空 `## [code]` 标题，不生成 `实现代码变更`。
- plan 阶段 `[code]` 下出现 checkbox 返回 `tasks_code_entry_before_spec_complete`。
- spec-complete 前 `tasks_plan_filled` 决定 plan gate；spec-complete 后 `tasks_code_slices_filled` 决定 `plan-slices/slice-exit`，两者不得复用同一布尔量。

### 2.43.5 L0 与状态一致性

在无 Delta、无 `PLAN_APPROVED` 且无更高优先级错误的 plan 前沿：

```text
change-lint.data.pass
  == change-lint.data.plan_package.ready
  == status.modules[].plan_state.plan_ready
  == (next.modules[].proposal_step == "ready-to-delta")
```

任一消费者输出的 issue code、path、section 与修复建议必须同源；文本层可本地化，但机器字段不可漂移。

### 2.43.6 producer 完成与宿主边界

- change-writer 读取并填充 CLI scaffold，不整体自由重建结构。
- 写入后从磁盘读回，先运行 change-lint，再运行 next；两者不收敛时继续修复，禁止报告“方案可批准”。
- `next_node.dispatch.completion` 提供命令与期望值；RunLogos 只消费声明，不复制标题、正则或状态机。
- OpenLogos 不管理宿主 WorkUnit 重试次数、UI 或用户可见合并文案。

### 2.43.7 资产一致性体验

- 根 `skills/change-writer/` 是权威源；插件副本只能由构建生成。
- `openlogos/asset-manifest@1` 绑定 package version、plan contract version、模板与 Skill hash。
- `.openlogos-sync.json` 记录 `cliVersion`、`syncedAt`、`planContractVersion`、`managedAssetsHash`。
- 确认过期时只读命令仍可观测，但 producer dispatch 明确要求 `openlogos sync` 并重开 Agent session。

### 2.43.8 兼容与验收摘要

- 新 JSON 字段只增不改；旧消费方可忽略。
- 已越过 plan 的历史提案不回退，writing 中旧提案只诊断不自改。
- 中英文、合法/非法模板、四方一致、零写副作用、构建/安装/cache/sync hash 与回滚均需 UT/ST/smoke 覆盖。

### 2.43.9 merge-apply 历史测试 ID 自举收敛

- test change set 的 after 侧保持严格唯一；任何重复 ID 立即阻断。
- before 侧允许同一 ID 暂存多个历史定义，只用于差异计算，不写入 marker；after 保留该 ID 时，只要其 canonical 定义匹配任一 before 候选即视为未变。
- before 的某 ID 在 after 完全消失时只产生一个 removed ID；before 重复不会让 changed/removed 集合重复。
- before 的历史歧义表行按行跳过候选匹配；after 修复后的对应 ID 因无可靠旧候选而保守计入 changed。
- 该兼容仅允许“坏 before → 唯一 after”单向收敛，不允许唯一 before 退化为重复 after，也不放宽表结构、UTF-8、target identity 或事务回滚门。
