# Delta: core-S09-test-cases.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/test/core-S09-test-cases.md`

## REMOVED — S09 合并事务单一权威测试用例

事务化合并（逐 slot 提交 → seal → apply → receipt）用例随外壳删除。

## REMOVED — S09 公共 staging、abort 与 completed receipt 测试用例

公共 staging、abort 分支与 completed receipt 依附于事务，随之删除。

## REMOVED — S09 Seal Preflight、Legacy Reopen 与崩溃边界测试

seal 绑定 preflight、legacy sealed reopen 与其崩溃边界依附于事务相位机，随之删除。规格结构检查能力由 `openlogos lint-specs` 承接，其用例见本次新增节。

## REMOVED — S09 嵌套章节锚 Transaction 生命周期测试

嵌套锚解析能力属合并引擎并随引擎保留；本节测的是其在 slot preflight 与同事务恢复中的用法，随事务删除。

## REMOVED — S09 合并事务终态出路测试（fix-merge-transaction-abort-recover-reopen）

终态出路依附于事务终态相位，随之删除——事务没了就没有终态，也就没有需要出路的死局。

## REMOVED — merge 前沿事务判据与后置条件二分测试用例

前沿事务事实作为第二事实源随事务删除；merge 完成回归 `SPEC_MERGED` 在场单一判据，无需二分。

## REMOVED — reopen 后 test change set 前滚合并测试用例

reopen 通道随事务终态删除，前滚语义不再有触发场景。`test_change_set` 结构化事实源本身保留。

## ADDED — S09 merge 直接合并与 lint-specs 测试

> 覆盖 `openlogos merge` 一次调用完成合并、失败零副作用与整批回滚、`SPEC_MERGED` 结构化字段零回归，以及 `openlogos lint-specs` 独立结构检查且不参与任何门。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-340 | 一次调用完成合并且 SPEC_MERGED 结构化字段零回归 | 构造 3 个 delta 目标（含 ADDED / MODIFIED / REMOVED 三种块）→ 一次 `merge` 调用后：三个 canonical target 均为最终态、章节锚正确定位、标题层级 rebase 正确；`SPEC_MERGED` 在场且含 `type: merge_complete`、`completed_at`、**`test_change_set`（schema 与字段口径与事务时代逐字段一致）**；提案目录**无** `MERGE_TRANSACTION.json` / `MERGE_RECEIPT.json` / `merge-staging/` / `merge-content/` 任一残留 |
| UT-S09-341 | 失败零副作用与整批回滚 | 分别构造：delta 缺段标记、章节锚解析到 0 处、章节锚解析到多处、P≠T≠D、`SPEC_MERGED` 已在场 → 各自非零退出并报对应稳定错误码（`MERGE_DELTA_INVALID` / `MERGE_TARGET_MISMATCH` / `MERGE_ALREADY_COMPLETE`）；每种情形下**全部** canonical target 的字节与 mtime 均不变、`SPEC_MERGED` 不被创建；错误 message 含 `git checkout logos/resources/` 回滚提示 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-140 | 合并 → 回滚重来 → lint-specs 不参与门的端到端 | 真实 CLI：① `openlogos merge <slug>` 一次调用合并多目标成功，`SPEC_MERGED` 在场 → ② 模拟「发现 delta 有误」：`git checkout logos/resources/` 回滚 + 删除 `SPEC_MERGED`，修正 delta 后重跑 `merge` 成功（**无需 reopen / abort 通道**）→ ③ 在测试规格中植入重复 ID，`openlogos lint-specs` 非零退出并点名该 ID 与位置 → ④ **同一状态下 `openlogos merge` 与 `openlogos verify` 均不因 lint-specs 的结论而阻断**（证明它不参与任何门）|

### 追溯与覆盖

- AC-MERGE-DIRECT-01 一次调用完成合并：UT-S09-340、ST-S09-140 步骤①。
- AC-MERGE-DIRECT-02 SPEC_MERGED 结构化字段零回归：UT-S09-340。
- AC-MERGE-DIRECT-03 失败零副作用与整批回滚：UT-S09-341。
- AC-MERGE-DIRECT-04 回滚后重来无需 reopen 通道：ST-S09-140 步骤②。
- AC-LINT-SPECS-01 独立结构检查可用：ST-S09-140 步骤③。
- AC-LINT-SPECS-02 不参与任何门：ST-S09-140 步骤④。
- 场景：`core-S09-change-lifecycle.md`「S09 merge 直接合并时序」；功能规格：§2.69、§2.70；JSON 契约：`spec/cli-json-output.md`。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
