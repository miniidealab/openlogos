# Delta: core-01-requirements.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/prd/1-product-requirements/core-01-requirements.md`

## REMOVED — S05/S09/S11/S16/S19/S39 合并事务单一权威与 0.14.0 验收要求

合并事务外壳（content slot 与 staging、submit-content 逐 slot 提交与重读校验、seal、apply 事务提交、receipt、相位机与准入矩阵）随本提案删除，其单一权威验收要求整节失效。规格合并的权威改由 `openlogos merge <slug>` 的**一次性直接合并**承载，完成判据回归 `SPEC_MERGED` 在场（含结构化 `test_change_set` 字段），见本次新增的「merge 直接合并要求」。

## REMOVED — S05/S09/S11/S16/S19/S39 Preflight 与可修复 reopen 验收要求

seal 绑定的确定性 preflight 与其可修复 reopen（局部退回 collecting、只重提受影响 slot）依附于事务相位机，随事务删除。其中**规格结构检查能力**（重复 ID、表格列数）由本次新增的 `openlogos lint-specs` 独立命令承接，不再作为合并门。

## REMOVED — S09/S37 Merge Transaction 嵌套章节锚同源解析与 0.14.4 本机恢复要求

嵌套章节锚的同源解析是合并引擎 `resolveSectionAnchor` 的能力，本身随引擎保留；本节要求的是「slot 级嵌套锚 preflight 与同事务恢复」，依附于事务，随之删除。

## REMOVED — 合并事务终态出路与提案内二次 merge 通道

终态出路（abort 重建 / completed reopen / MERGE_REOPENS 留痕）依附于事务终态相位。事务删除后不存在终态——重新合并即 `git checkout logos/resources/` 回滚后重跑 `openlogos merge`，该死锁面整体消失。

## REMOVED — merge 流程契约自洽（flow 前沿与事务事实同源）需求

flow 前沿与事务事实同源的要求依附于事务在盘这一前沿事实源。事务删除后前沿直接由 `SPEC_MERGED` 在场判定，无第二事实源需要同源。

## REMOVED — reopen 后 test change set 提案级前滚需求

reopen 通道随事务终态一并删除，其前滚语义不再有触发场景。**注意**：`test_change_set` 本身作为结构化事实源保留——它由 `buildTestChangeSet` 构建并写入 `SPEC_MERGED`，被 verify / change-lint / test-slice-manifest 三处消费，不随本节删除。

## ADDED — merge 直接合并与规格结构检查要求

### 用户价值

合并事务把「把 N 个 delta 合进主文档」拆成 N×3 + 3 次 CLI 往返（11 目标的提案即 36 次），每次都是失败机会；其保护的「多方并发写同一批文件的原子性」在实际场景中不存在——写入方只有一个顺序执行的 AI，且 `logos/resources/` 受 git 跟踪。2026-09-07 的三向死锁（reopen 拒 / abort 拒 / merge 认为已完成）正是该外壳的产物。

同时，seal preflight 承担的**规格结构检查**（重复 ID、表格列数）是真实价值——它曾发现同一测试 ID 被两个用例共用、验收结果被静默覆盖。删除事务不得连带丢失该能力，故同批提供独立命令替代。

### 验收条件

#### S09 merge 直接合并

- **GIVEN** 活跃提案的 `[delta]` 已全部产出且 change-lint 通过
- **WHEN** 执行 `openlogos merge <slug>`
- **THEN** 命令**一次调用**完成：读 `deltas/` → 逐目标合成最终字节（含物质结果复验）→ 原子落盘全部目标 → 写含 `test_change_set` 的 `SPEC_MERGED`
- **AND** 无 content slot、无 staging、无 seal、无 receipt、无相位机
- **AND** 合并中途任一目标失败即整批回滚，主文档保持合并前字节，并提示 `git checkout logos/resources/` 作为回滚点

#### S09 SPEC_MERGED 结构化字段零回归

- **GIVEN** merge 成功
- **THEN** `SPEC_MERGED` 含 `test_change_set` 结构化字段，其 schema 与内容口径与事务时代逐字段一致；verify / change-lint / test-slice-manifest 三处消费方读取行为零改动

#### S09 规格结构检查独立可用

- **GIVEN** 测试规格中存在重复 ID 或表格列数异常
- **WHEN** 执行 `openlogos lint-specs`
- **THEN** 命令报出重复 ID 与结构问题并非零退出
- **AND** 该命令**不参与任何门**——merge / verify / archive 均不因其结论而阻断；它是用户主动运行的诊断工具

### 非目标

- 不触及 change-lint 的 L8 / L9 / L10（归后续提案）。
- 不触及 1a 已确立的 `slice plan` 与 slice-checkpoint 增量验收。
