# Delta: core-01-feature-specs.md

> change: lite-cut3a-degate-clarification-ui-seed
> 目标：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`

## REMOVED — 2.36 Plan 阶段决策澄清协议（openlogos/clarification@1）

本节定义 `openlogos/clarification@1` 契约：`impacts` 五类影响的 none/required 判定、`decisions[]` 的 id/category/source/question/answer/rationale/affects/rejected_options 八字段闭合、`unresolved[]` 的稳定拓扑序、以及「未满足必选类别必须恰有一个对应 unresolved」的完成条件。plan 完成度以该契约为判据。

删除理由见 §2.74。**决策澄清小节本身不删**——它作为文档保留，只是不再作为判定。

## ADDED — 2.74 三处能力的形态订正：门 → 警告 / 文档

### 2.74.0 划线原则

减法方案 §5 的裁定：评审、部署、smoke、UI 原型、baseline seed、决策澄清是**产品能力，一个都不删**；它们的问题不是「存在」，而是被实现成了**阻断门 + 状态机 + 审计判据**。正确的减法是能力保留、形态从「门」改成「步骤」。

本节记录三处形态订正的判据。三者的共同点：被删的都不是能力，而是「机器替人做它判不了的判断」这一层。

### 2.74.1 决策澄清：判定 → 文档

| 维度 | 订正前 | 订正后 |
|---|---|---|
| 提案模板 | 生成「## 决策澄清」小节 | **不变** |
| change-writer 填写 | 按 `openlogos/clarification@1` 填写 | **不变**（格式沿用，作为写作约定） |
| 机器解析 | `evaluateProposalClarification` 全量校验 | 不解析 |
| 对 plan 完成度 | schema 非法 → `proposal_clarification_invalid` → plan 不完成 | 无影响 |
| status/next 输出 | `plan_state.clarification` 携带 pending/complete | 不发射该字段 |

**为什么**：「作者是否想清楚了」不是机器能判的。契约实际拦下的是 `id` 不匹配 `C\d+`、`source` 不在三值枚举、`affects` 不是字符串数组这类**字段形态**问题——本次减法自身在 lite-cut2a 就被它拦过一次，改的全是形态。而小节的真实价值（记录取舍供后来者理解）不依赖任何校验。

### 2.74.2 UI provenance：阻断门 → 警告

| 维度 | 订正前 | 订正后 |
|---|---|---|
| 原型产出（`write-ui-prototype` 节点） | 保留 | **不变** |
| `check-ui-prototype` / `check-ui-hash-match` 命令 | 保留 | **不变**（用户主动运行的诊断） |
| `verify-ui-provenance` overlay 节点 | flow 中的 `done_when` 门 | 移除该节点 |
| merge 前置 hash 门 | 失配即 fail-closed 拒绝合并 | 打印告警后继续 |

**为什么**：原型 hash 对账要防的是「批准后原型漂移」——这是**审计性质的观察**。按 §10「任何审计产物都不得出现在流程分支的条件里」，它应当可查、可导出、可给用户看，但不参与放行。漂移本身仍会被 `check-ui-hash-match` 如实报告。

### 2.74.3 baseline seed 恢复门：硬阻塞 → 隔离并继续

| 情形 | 订正前 | 订正后 |
|---|---|---|
| journal 可前滚 | 自动前滚 | **不变** |
| journal 可回滚 | 自动回滚 | **不变** |
| journal 损坏/不可恢复 | 抛 `baseline_commit_in_progress`，只读消费者一并阻塞 | 隔离留存该 journal（重命名为 `<run>.commit-journal.corrupt-<时间戳>.json`）、打印告警并继续 |
| 读锁被其它活进程持有 | 返回 `inProgress` | **不变**（真实瞬态条件，不是审计判据） |

**为什么这样安全**：这道门保护的读者是 ClosureEvaluator 与 EvidenceScanner——防它们读到半新半旧的资源树。**两者已随 lite-cut2b 的 L9 删除**。当前 merge 的目标集由 `deltas/` 派生、模式按磁盘事实即时判定，部分播种的资源树天然被正确处理：已落盘的目标判 MODIFY、未落盘的判 CREATE，两种都对。继续为一个不存在的读者维持硬阻塞是纯粹的成本。

**为什么隔离而非删除**：损坏的恢复指令是事故现场。留存成本接近零，事后可复盘；直接删除会让同类问题无法归因。

### 2.74.4 追溯

- 测试：UT-S09-344～346、ST-S09-142～143。
