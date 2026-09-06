# Delta: core-01-feature-specs.md（fix-next-ensure-initial-plan-slice-transaction）

## ADDED — 2.65 next 对 initial-plan 切片事务的问即建与投影输出（含 0.14.23 候选发布验收）

### 2.65.1 问题：发证时机与投影前置错位

消费方契约（runlogos，adopt-openlogos-test-slice-transaction-authority）：派发 slice-planner **之前**写域必须由 `next` 输出的 `slice_transaction` canonical 投影派生，投影缺失即 fail-closed（`slice-slot-projection-missing`）；消费方无任何「打开事务」的调用路径——事务执行权归 OpenLogos 是双方共同立场。而 0.14.22 的 initial-plan 事务仅在首次 `submit-content` 时「用即建」，`next` 只在 manifest-recovery 分支 ensure 并输出投影，正常 ready-to-implement 路径既不创建也不输出。两条契约拼合 = 鸡生蛋死锁：任何新提案首达 plan-slices 必然 blocked。

恢复路径已确立正确先例——「恢复的执行权归 OpenLogos——此处创建或返回事务投影，而非仅返回一个建议节点」；本节把同构语义补进 initial-plan 正常路径。

### 2.65.2 ensure 语义（触发、行为、幂等、失败口径）

**触发条件**（全部满足才 ensure）：

1. 模块 `proposal_step == ready-to-implement`（即建议节点为 `plan-slices` 的时刻，`[code]` 已脱模板待 slice-exit 的驻留态同样命中）；
2. 需要代码：`[code]` 标题在场（`code_required==true`）；
3. 提案未归档、提案目录存在。

**行为表**：

| 现场 | ensure 行为 | 输出 |
|---|---|---|
| 无事务 | `createTestSliceTransaction(origin: initial-plan)` | 携带新建事务投影（`phase=collecting`、`content_slots.required=2`） |
| 已有活跃事务（collecting/ready/sealed/applying） | 只读，不重建 | 携带该事务投影 |
| 已有终态事务（completed/failed） | **只读，不重建、不归档**（归档让位是 `createTestSliceTransaction` 在新一轮创建时的行为，ensure 不触发它） | 携带该事务投影 |
| 创建失败（IO 异常等） | 如实反映 | **无 `slice_transaction` 字段**，detail 携带错误信息，不降级为仅建议节点（消费方 fail-closed，不误以为可自行恢复） |

**幂等**：同一状态下重复 `next` 不重复创建；投影 `transaction_id` 稳定不变；`next` 为只读命令的例外仅此一处写入（与 manifest-recovery 分支同构、同层），除事务文件外不产生任何其它写副作用。

**非触发场景零变化**：非 ready-to-implement（writing/delta-writing/ready-to-merge/coding/verify 各步）、无 `[code]` 标题的纯 docs 提案、无活跃提案、initial 生命周期——`next` 一律不创建事务、不输出该字段。

### 2.65.3 与 recovery 分支及 submit-content 用即建的关系

- **与 manifest-recovery 分支**：同层、同构、互斥——recovery 由 `deriveSliceVerificationState()` 判定失效态触发（`origin=manifest-recovery`、required 收窄）；本节 ensure 只在无失效态的正常 plan-slices 前沿触发（`origin=initial-plan`）。两者共用投影 schema 与「失败如实」口径，不新增第二事实源。
- **与 submit-content 用即建**：用即建**保留为幂等兜底**（手动流程零回归）——`next` 已建则 `submit-content` 直接续用同一事务；无 `next` 前置（如人工直接跑 slice-planner）时仍按需创建。**不新增 `slice transaction open` 子命令**——避免再造一条双边契约接缝。
- **消费方**：runlogos 零改动痊愈——其 `next` 消费处本就在找 `slice_transaction` 字段。

### 2.65.4 OpenLogos 0.14.23 候选内容与发布验收

`@miniidealab/openlogos@0.14.23` 相对 0.14.22 的全部行为差异即本节问即建修复（提案 `fix-next-ensure-initial-plan-slice-transaction`）：

| # | 内容 | 生效面 |
|---|---|---|
| ① | next 对 initial-plan 事务的问即建（ready-to-implement 首达即创建） | 安装态 CLI `next` 命令 |
| ② | next 输出在 ready-to-implement 携带 `slice_transaction` canonical 投影 | 安装态 CLI JSON 输出 |

发布验收口径：

- **身份**：UT-S19-40 tripwire 钉 `LOCAL_RELEASE_CANDIDATE_VERSION=0.14.23`/`ROLLBACK=0.14.22` 与全源一致。
- **安装态行为**：SMOKE-core-194 承载——next ensure 全链（安装态构造 ready-to-implement 提案 → `next --format json` 携投影且事务落盘 → 幂等 → `submit-content` 续用）、固定 0.14.22 对照（复现无投影且事务不落盘，防断言空转）、roundtrip 无混装。
- **发布边界**：仅本机全局；部署与 smoke 各为独立人类确认点；矩阵失败停止部署回实现，全局异常按固定 0.14.22 tarball（sha256 `0bdcefb3…83ac1`）回滚。
