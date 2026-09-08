# Delta: core-S16-test-cases.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/test/core-S16-test-cases.md`

## REMOVED — S16 merge-transaction@1 机器合同测试用例

事务 JSON 机器合同用例随事务删除。

## REMOVED — S16 完整 merge-transaction@1 Schema 与 golden 测试用例

事务 schema 与 golden 用例随事务删除；merge 的机器输出改由通用 envelope 承载，其契约见 `spec/cli-json-output.md`。

## REMOVED — S16 Preflight/Reopen JSON 兼容测试

preflight/reopen 的 JSON 兼容用例依附于事务相位，随之删除。

## REMOVED — merge 事务投影必挂与错误 envelope 验收测试用例

`data.merge_transaction` 只读投影随事务删除，投影必挂（UT-S16-38）、投影同快照一致（UT-S16-39）与两条宿主分流场景（ST-S16-12/13）失去验证对象。其中与事务无关的两条——失败路径结构化错误码枚举、瞬态码集合稳定——原样迁至下一节保留 ID 不变。

## ADDED — status/next 错误 envelope 与瞬态码验收测试用例

> 承接上一节中与合并事务无关的两条：status/next 的失败路径一律结构化报码、瞬态码集合与合同版本绑定。ID 沿用不变（UT-S16-40 / UT-S16-41），仅脱离事务语境独立成节。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S16-40 | 失败路径结构化错误码枚举 | 枚举 status/next 既有失败路径（flow 配置错误、baseline 读锁、guard/提案状态损坏等）逐一断言 stderr error envelope 携带稳定 error.code，无一路径纯文本退化 |
| UT-S16-41 | 瞬态码集合稳定 | 瞬态类错误码集合（含 baseline_commit_in_progress）与合同版本绑定；集合快照回归，增删未走合同版本即红 |

### 自动化与证据要求

- 错误路径枚举用例维护「失败路径 → 期望 error.code」注册表，新增失败路径必须登记，防单路径退化。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S16"`；失败不得写 pass。
