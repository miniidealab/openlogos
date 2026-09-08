# Delta: core-S37-test-cases.md

> change: lite-cut2c-spec-hygiene-and-anchors
> 目标：`logos/resources/test/core-S37-test-cases.md`

## ADDED — S37 条目守恒降级后的端到端行为

> 覆盖 L8 由阻断门降级为警告后，merge 不再因守恒拒绝、而运行期由 verify 兜底这一分工。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S37-41 | merge 不再因条目守恒拒绝 | delta 的 MODIFIED 块隐式删除目标章节既有 ID，且无 REMOVED-ITEMS 点名 | 发起 `merge` | 合并**成功**并写 `SPEC_MERGED`；stdout 携带该守恒告警且点名被删 ID；判据函数 `evaluateDeltaConservation` 的返回值与降级前逐字段相同 |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S37-11 | 静默删除由 verify 的孤儿检查兜住 | 真实 CLI；规格中删除某 ID 而其测试仍在跑 | ① `change-lint` 取结论；② `merge`；③ 跑 `verify` | ① 守恒告警在 `warnings`、不阻断；② merge 成功；③ **verify 判 result ledger 不一致并点名该孤儿 ID**——证明守恒的兜底位置由静态门移到了运行期事实 |

### 追溯与覆盖

- AC-L8-WARN-02 merge 不再因守恒拒绝：UT-S37-41。
- AC-L8-WARN-03 运行期兜底：ST-S37-11。
- 功能规格：§2.73。
