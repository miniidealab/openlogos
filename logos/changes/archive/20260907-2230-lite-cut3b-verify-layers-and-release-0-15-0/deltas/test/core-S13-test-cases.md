# Delta: core-S13-test-cases.md

> change: lite-cut3b-verify-layers-and-release-0-15-0
> 目标：`logos/resources/test/core-S13-test-cases.md`

## ADDED — S13 verify 判定层收敛测试

> 覆盖 Gate 判据收敛为三项、ID 覆盖检查强度不变、报告与 envelope 去字段。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S13-67 | 设计时清单与 AC 追溯不再影响 Gate | 同一账本下参数化三例：① 覆盖度校验清单存在未勾选项；② AC 追溯存在无链接用例的条目；③ 两者皆有 | 求 verify 的 Gate 结论 | 三例的 Gate 结论与「清单全勾且 AC 全链」的对照组**逐字段相同**；失败原因码集合中不出现 `checklist_incomplete` / `ac_trace_incomplete` |
| UT-S13-68 | ID 覆盖检查强度逐字不变 | 规格声明 10 个 ID、结果账本只含其中 3 个（且均 pass） | 求 verify 结论 | 判 FAIL；**逐个点名**其余 7 个未覆盖 ID；点名文本与收敛前逐字相同 |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S13-19 | 真实 CLI 下报告与 envelope 去字段 | 真实 CLI；一个测试全绿且 ID 全覆盖的项目 | ① 跑 `verify`；② 跑 `verify --format json`；③ 读 `acceptance-report.md` | ① Gate PASS；② envelope 的 `data` 不含 `checklist` 与 `ac_trace`，但含 `summary` / `gate` / 未覆盖清单；③ 报告不含 Layer1 / Layer3 段，覆盖度与通过率段照常 |

### 追溯与覆盖

- AC-VERIFY-LAYER-01 判据收敛：UT-S13-67。
- AC-VERIFY-LAYER-02 覆盖检查强度不变：UT-S13-68。
- AC-VERIFY-LAYER-03 去字段：ST-S13-19。
- 功能规格：§2.75。
