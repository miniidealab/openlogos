# Delta: core-S32-test-cases.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/test/core-S32-test-cases.md`

## REMOVED — reopen 后切片归属消费回归

驱动方式（reopen 重合并）随合并事务删除；三条用例的判据本身不变，ID 全部沿用，整体迁至下一节。

## ADDED — 二次合并后切片归属消费回归

> 覆盖 change set 提案级语义在二次合并（回滚重来）后对切片归属的影响，判据与 ID 逐条沿用。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S32-69 | 多轮 ID 并存的 change set 下 owned 校验放行 | SPEC_MERGED.test_change_set 的 changed 同时含 ID A/B 与 C：多切片 manifest 分别 own A/B 与 C 均通过 owned⊆changed；reader 不读 deltas/test |
| UT-S32-70 | removed 后写胜出的消费行为 | removed 含被本提案删除的 ID X：own X 触发 `test-slice-test-id-unknown` 并指出 owned 字段路径；changed 不含 X |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S32-23 | 二次合并后多切片规划全链 | 真实命令链：首次 `merge` → 回滚主文档并删除 `SPEC_MERGED` → 修正测试 delta 后二次 `merge`（无 reopen 通道）→ 进入切片规划：多切片 manifest 校验通过、slice-aware verify 按归属豁免未完成切片 ID、删后续证伪门成立；全程消费者只读当前 marker |

### 自动化与证据要求

- 三条用例均只读当前 `SPEC_MERGED`，不得读取任何历史或归档来源补齐 changed/removed。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S32"`；失败不得写 pass。
