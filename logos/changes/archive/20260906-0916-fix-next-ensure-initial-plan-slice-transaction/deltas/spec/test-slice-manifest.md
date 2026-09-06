# Delta: test-slice-manifest.md（fix-next-ensure-initial-plan-slice-transaction）

## ADDED — initial-plan 事务创建时机（next 问即建）

### 创建时机合同

initial-plan 切片事务的创建时机为 **`openlogos next` 问即建**：模块前沿派生为 `plan-slices`（`proposal_step == ready-to-implement`、需要代码——`[code]` 标题在场且切片未填、提案未归档）时，`next` 必须 ensure 事务——无事务则 `createTestSliceTransaction(origin: initial-plan)` 创建并输出 canonical 投影；已有事务（任意 phase，含 `completed` / `failed` 终态）则只读投影输出，不重建、不归档、不推进 phase（终态归档让位仍只发生在新一轮 `createTestSliceTransaction` 内）。

动机：消费方（driver）契约要求派发 slice-planner **之前**由 `next` 输出的投影派生写域（投影缺失 fail-closed）；懒创建（首次 `submit-content` 用即建）下投影只有提交内容后才存在，构成鸡生蛋死锁。恢复路径已有同构先例（manifest-recovery 由 `next` ensure），本节把 initial-plan 正常路径对齐。

### 行为约束

1. **幂等**：同一状态重复 `next` 不重复创建，投影 `transaction_id` 稳定；除事务文件外 `next` 不产生任何其它写副作用。
2. **失败如实**：创建失败反映为「无投影」并携错误信息，不降级为仅建议节点。
3. **`submit-content` 用即建降为幂等兜底**：其「无事务才创建」判定保留——`next` 已建时条件不成立、直接续用同一事务；无 `next` 前置的手动路径仍按需创建（懒创建零回归）。**不新增 `slice transaction open` 子命令**。
4. **与 manifest-recovery 互斥**：`deriveSliceVerificationState()` 判定失效态时走既有 recovery ensure（`origin=manifest-recovery`、required 收窄），本合同的 initial-plan ensure 不介入。
5. 事务 schema、slot 契约、seal/apply 判定、manifest 语义与 §2 写入者归属零变化。

### 消费方口径

消费方在派发 slice-planner 前以 `next` 输出的 `slice_transaction` 投影为唯一写域来源（字段口径见 `spec/cli-json-output.md`）；投影缺失一律结构化 fail-closed，不得本地推导写域、不得自行创建事务。
