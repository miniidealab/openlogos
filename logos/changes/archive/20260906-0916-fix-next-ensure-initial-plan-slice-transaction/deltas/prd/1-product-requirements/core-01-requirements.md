# Delta: core-01-requirements.md（fix-next-ensure-initial-plan-slice-transaction）

## ADDED — next 对 initial-plan 切片事务的问即建需求

### 用户价值

全自动 driver（如 runlogos）在派发 slice-planner **之前**，写域必须由 `openlogos next` 输出携带的 `slice_transaction` canonical 投影派生（双方已立之约 adopt-openlogos-test-slice-transaction-authority，投影缺失即 fail-closed）；而 0.14.22 的 initial-plan 事务为懒创建——仅在首次 `submit-content` 时「用即建」，`next` 在正常 ready-to-implement 路径既不创建也不输出投影。两条各自成立的契约拼在一起构成鸡生蛋死锁：投影只有 slice-planner 提交内容后才存在，driver 没投影又拒绝派发 slice-planner——任何新提案在全自动流程中**首达 plan-slices 节点必然 blocked**（runlogos 连续 4 个提案实证，每次靠人工代跑 slice-planner 绕过）。事务的「发证时机」必须与消费方的「投影前置」对齐：恢复路径已有正确先例（`next` 的 manifest-recovery 分支 ensure 并输出投影），initial-plan 正常路径需要同构语义。

### 问即建要求（S28 / S32）

1. **触发条件**：模块 `proposal_step == ready-to-implement` 且需要代码（`[code]` 标题在场、切片未填）且提案未归档——即建议节点为 `plan-slices` 的时刻，`next` 必须 ensure initial-plan 切片事务。
2. **无事务** → `createTestSliceTransaction(origin: initial-plan)` 创建后输出 canonical 投影；**已有事务（任意 phase，含 completed / failed）** → 只读投影输出，不重建、不归档、不推进 phase。
3. **投影输出**：`next` 输出在该场景携带 `slice_transaction` 字段，schema 沿用 manifest-recovery 分支既有 `openlogos/test-slice-transaction@1` 投影（仅扩大出现场景，不新增第二事实源）。
4. **失败如实**：事务创建失败时如实反映为「无投影」并携带错误信息，不降级为仅建议节点（避免消费方误以为可自行恢复）。
5. **幂等**：同一状态下重复执行 `next` 不重复创建、投影 `transaction_id` 稳定不变。
6. **用即建降为幂等兜底**：`submit-content` 的按需创建保留（手动流程零回归）——`next` 已建则直接续用同一事务，无事务时仍可用即建；**不新增** `slice transaction open` 子命令。

### 场景验收条件

#### S28 next 建议节点派生

- ready-to-implement 且切片未填时：`next --format json` 的模块项建议节点为 `plan-slices` **且携带 `slice_transaction` canonical 投影**（首达时创建，`origin=initial-plan`、`content_slots.required=2`）；重复执行幂等（`transaction_id` 不变）；事务创建失败时无投影并携错误信息；非 plan-slices 节点（如 delta-writing、coding）不创建事务。

#### S32 切片规划

- initial-plan 事务创建时机前移为 `next` 问即建；`next` 已建后 slice-planner 的 `submit-content` 幂等续用同一事务（不重建、不冲突）；无 `next` 前置的手动 `submit-content` 懒创建路径零回归。

### 非目标

- 不改变事务 schema、slot 契约、seal/apply 判定与 manifest 语义；不改变 manifest-recovery 分支既有行为；消费方（runlogos）契约零改动。

## ADDED — OpenLogos 0.14.23 候选发布需求

### 用户价值

问即建修复必须发布到本机全局才能生效：已安装的 0.14.22 全局 CLI 的 `next` 仍不输出 initial-plan 投影，runlogos 每个新提案首达 plan-slices 仍死锁需人工绕过；发布 0.14.23 后全自动链路经全局 CLI 刷新即痊愈（用户决策 C01：捆绑发布 0.14.23 + 全局部署 + smoke）。

### 候选发布要求（S19）

1. **候选身份链同步**：CLI package/lockfile、全部随包 plugin/资产模板 manifest、package asset manifest、`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.23`、`LOCAL_RELEASE_ROLLBACK_VERSION=0.14.22` 与发布身份 tripwire/golden 全链一致；真实 `npm pack` 冻结唯一 tarball SHA-256。
2. **隔离矩阵（部署前强制）**：一次性 npm prefix 安装固定 tarball，从绝对入口验收——candidate identity 无 workspace link；**next ensure 全链**（安装态构造 ready-to-implement 提案 → `next --format json` 携 `slice_transaction` 投影且事务文件落盘 → 重跑幂等 → `submit-content` 续用同一事务）；`0.14.22→0.14.23` roundtrip 无混装。
3. **零回归对照（强制）**：同一 ready-to-implement 场景在固定 `0.14.22` 上必须复现**无投影**（`next` 输出不含 `slice_transaction` 且事务文件不落盘——缺陷本身）；旧版也有投影则矩阵空转，必须重写矩阵而非放行部署。
4. **全局覆盖与 smoke**：矩阵与回滚演练 PASS 且用户授权后覆盖本机全局；新 shell 复核 identity 全同源 `0.14.23`；`openlogos smoke`（SMOKE-core-194）独立授权执行。
5. 回滚制品固定 0.14.22 tarball（SHA-256 `0bdcefb37a0743575d44c7645169c0c668bbcaaa22e206e7e209325f8a283ac1`）；回滚自检失败不得覆盖全局。

### 场景验收条件

#### S19 候选发布与 smoke 门禁

- 0.14.23 候选身份全源一致（UT-S19-40 tripwire）；SMOKE-core-194 全链 PASS 且 0.14.22 对照有效；部署与 smoke 各为独立人类确认点。

### 非目标

- 除问即建修复外零新增语义；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
