# Delta: core-S31-test-cases.md

> change: lite-cut2c-spec-hygiene-and-anchors
> 目标：`logos/resources/test/core-S31-test-cases.md`

`openlogos lint-specs` 报告的 `table_column_mismatch`：ST-S31-10 行有 6 格而表头只有 5 列——构造与执行被多切了一刀。两格合回「操作」列，文字一字不改。

## MODIFIED — 10.2 场景测试用例补充


| ID | 描述 | 覆盖 | 操作 | 期望 |
|---|---|---|---|---|
|  ST-S31-10 | 全量失败只在 implement loop 中驱动 repair | S31 与 S24/S28 边界 | 用同一失败证据分别构造 `ready-to-merge`、未规划切片 `ready-to-implement`、`coding`；随后分别执行 `next --auto --format json` | 前两者不进入 repair；`coding` 输出 repair/code 前沿  |

