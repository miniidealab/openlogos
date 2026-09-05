# D10：merge 前沿权威事实切换为事务在盘，与后置条件二分 / 存量事务不迁移合同边界

- **状态**：accepted
- **日期**：2026-09-05
- **来源**：提案 `fix-merge-flow-transaction-contract`；RunLogos 移交需求 `openlogos-merge-flow-contract-fix-requirements.md`（生产现场 cursor-adapter-parity run `drv-mtnt31lq-6354` 的 driver 硬停）

## 背景

0.14.x 把 `openlogos merge` 的生产语义改为合并事务，但 flow 前沿的 done 裁决仍指向 0.13.x 的 MERGE_PROMPT marker——生产路径永不产生的影子事实，造成「命令成功、前沿永久冻结」的结构性死区。同时「有 delta 时 merge 成功但 SPEC_MERGED 未落盘」这一中间态无成文合同，宿主无法据 CLI 事实判进退；CLI 升级后对 contract/schema 摘要失配的存量事务也无成文处置边界。

## 决策

1. **前沿权威事实切换（方案 A）**：`generate-merge-prompt` 节点的 done 裁决事实 = 活跃提案目录存在 `MERGE_TRANSACTION.json`（事务已创建 / 幂等在场 / 归档让位重建）；MERGE_PROMPT marker 降为 legacy 测试模式兼容影子。`launched.yaml` `done_when` 与 flow-derive step 推导是同一判据的两处声明，回归钉一致；`proposal_step` 闭合枚举与 step 序列不变。
2. **后置条件二分（跨仓合同不变量）**：`openlogos merge` 成功后置条件——no-delta 当场写 `SPEC_MERGED`、前沿即进；有 delta 开事务、前沿推进 `merge-generated` 并停在 apply 前为**合法中间态**；宿主以「exit 0 + 事务在盘且 phase 合法」判本跳成功。活跃事务在场时 status/next 的 `data.merge_transaction` 投影必挂，宿主禁止自行 stat 事务文件。
3. **存量事务不迁移（合同不变量）**：contract/schema 摘要失配的存量事务一律 fail-closed 拒绝写动作，错误码稳定、diagnostic 含双方版本与摘要及标准 remediation（`abort` 后重开事务），**永不承诺就地迁移**。

## 理由

前沿裁决事实必须是生产路径真实产生的事实，CLI 与宿主才能双向一致——影子判据的死引用使 CLI 自己的 flow 事实系统性说谎，宿主要么硬停要么被迫绕过 CLI 直接 stat 内部文件（制造第二裁决者）。后置条件二分把「事务中间态」从隐式惯例升为合同，宿主判据（RunLogos `fix-driver-merge-transaction-contract-alignment`）与 CLI 事实同源。存量事务不迁移是把复杂度锁在最小面：事务是短生命周期产物，重开成本低，迁移承诺则是长期兼容负担。

## 备选方案

1. **方案 B：合并 generate-merge-prompt/apply-merge 为单节点，done 以 SPEC_MERGED 为准**：拒绝。改 step 枚举、overlay 映射与宿主消费面，回归风险高；中间态派活提示仍需节点内二分，复杂度未消失只是搬家。
2. **宿主侧自行 stat 事务文件推导前沿**：拒绝。绕过 CLI 投影制造第二裁决者，违反 Authority Closure（D08）。
3. **存量事务就地迁移**：拒绝。为短生命周期产物背长期迁移合同；fail-closed + 重开语义简单、可测、可恢复。

## 影响面

- `spec/flow/launched.yaml`（done_when/artifacts_hint）、`cli/src/lib/flow-derive.ts`（step 推导）、step 一致性回归。
- `spec/flow-spec.md` §12.10、`spec/change-management.md`（工作流步骤 5/6 与中间态成文）、`spec/cli-json-output.md`（后置条件二分、投影必挂、失配错误码、错误 envelope 验收）。
- S05/S09/S16 场景与测试、SMOKE-core-190、0.14.19 部署。
- 宿主合同：RunLogos driver 判据与本决策第 2 条双向对齐。

## 来源

- 提案：`fix-merge-flow-transaction-contract`（C01 方案 A、C02 0.14.19 部署均为用户决策）。
- 关联决策：D07（merge transaction 单一权威）、D08（Authority Closure）。
