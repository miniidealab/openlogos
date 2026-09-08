# Delta: change-management.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`spec/change-management.md`（项目根规范，权威）

## REMOVED — Merge transaction 完成、SPEC_MERGED 与归档谓词

合并事务的完成谓词（receipt 在场 + 相位 completed）随事务删除。完成谓词回归单一判据：**`SPEC_MERGED` 在场**——它由 `openlogos merge` 一次调用末步写入，含结构化 `test_change_set` 字段。归档谓词读取该 marker 的行为零改动。

## REMOVED — Merge Transaction Preflight、局部 Reopen 与确认点

seal 绑定 preflight 与局部 reopen 依附于事务相位机，随之删除。其规格结构检查能力由独立命令 `openlogos lint-specs` 承接（不参与任何门）。

## REMOVED — Merge transaction 终态出路与提案内二次 merge（0.14.17）

终态出路依附于事务终态相位。事务删除后不存在终态——重新合并即 `git checkout logos/resources/` 回滚后重跑 `openlogos merge`，2026-09-07 的三向死锁面整体消失。

## REMOVED — reopen 重合并的 test change set 前滚合同（0.14.20）

reopen 通道随事务终态一并删除，前滚语义不再有触发场景。`test_change_set` 本身作为结构化事实源保留，由 merge 直接构建并写入 `SPEC_MERGED`。

## ADDED — merge 直接合并与完成谓词（规范性）

`openlogos merge <slug>` 是规格合并的**唯一写入口**，一次调用完成：

1. 解析 `[delta]` 目标集并做 P==T==D 与路径合法性校验（校验全部前置于写入）；
2. 逐 canonical target 经合并引擎合成最终字节，引擎内含章节锚唯一定位与物质结果复验；
3. 全部目标经原子落盘原语一次提交，失败整批回滚；
4. 末步写 `SPEC_MERGED`（含 `test_change_set`）。

**完成谓词**：`SPEC_MERGED` 在场即 spec-complete。不存在事务相位、receipt 或第二事实源参与该判定——**任何审计产物都不得出现在流程分支的条件里**。

**失败与重来**：合并失败即整批回滚，主文档保持合并前字节；已合并后发现 delta 有误时，`git checkout logos/resources/` 回到合并前，修正 delta 后重跑 `merge`。不提供 reopen / abort / recover——不存在需要出路的中间态。
