# Delta: core-01-feature-specs.md

> change: lite-cut2b-remove-baseline-closure
> 目标：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`

本节的 `## 2.35` 与 `### 2.35` 两处标题文本完全相同（历史 ADDED delta 在正文中重复了控制块标题），章节锚不可唯一定位，故按其唯一的 `#### 2.35.x` 子节逐节删除；两个空标题壳留待后续清理。

## REMOVED — 2.35.1 能力目标

闭包能力的目标陈述随 change-lint L9 删除。

## REMOVED — 2.35.2 输入与受影响场景识别

touched 场景识别的输入与判据随 change-lint L9 删除。

## REMOVED — 2.35.3 目标模式与 delta 语义

MODIFY/CREATE/SKIP/AMBIGUOUS 的模式语义随 change-lint L9 删除。

## REMOVED — 2.35.4 闭包维度与适用性

九个维度的强制与条件适用规则随 change-lint L9 删除。

## REMOVED — 2.35.5 effective view 与目标去重

effective view 组成与 canonical target 去重随 change-lint L9 删除。

## REMOVED — 2.35.6 plan/spec 两阶段结构校验

P==T 与 P==T==D 的两阶段对账随 change-lint L9 删除。

## REMOVED — 2.35.7 棕地与无 JIT 边界

棕地兼容与禁止 JIT 确认的红线随 change-lint L9 删除。

## REMOVED — 2.35.8 验收摘要

闭包能力的验收摘要随 change-lint L9 删除。

## ADDED — 2.71 merge 目标集由 delta 文件派生

### 2.71.0 问题：两份数据必然对不上

合并需要「把哪些 delta 合进哪些主文档」这个集合。此前它有两个来源：作者在 `proposal.md` 手工枚举的 `baseline_closure.targets`，和 `deltas/` 目录里真实存在的文件。两份数据不可能自动一致，于是需要 P==T==D 三方对账去发现不一致——而不一致正是手工枚举本身带来的。

对账还不够，因为计划是在 plan 阶段写的、目标事实是在 merge 时刻的：计划说 CREATE 而目标已被外部创建，就是「模式漂移」，需要又一道检查。

### 2.71.1 判据

merge 的目标集 = `deltas/` 下**可 merge delta 的无逻辑投影**：

| 步骤 | 判据 | 复用 |
|---|---|---|
| 枚举 | `classifyProposalDeltas` 的 `mergeDisposition === 'mergeable'` | 与 change-lint L6 同源 |
| 映射 | `canonicalTargetFromDeltaPath`：delta 相对路径 → 唯一 canonical target | 既有判据，逐行保留 |
| 模式 | 目标文件存在即 `MODIFY`，缺失即 `CREATE`，在 merge 执行时按磁盘事实判定 | 新 |

**merge 不读 `proposal.md` 的任何 YAML 声明。** 存量 `baseline_closure` 块被忽略而非报错。

### 2.71.2 失效面随之消失

| 原失败类型 | 现状 |
|---|---|
| `baseline_closure_malformed`（schema/排序/证据组合） | 不存在——没有可写错的声明 |
| `baseline_closure_target_missing`（触达场景四维不全） | 不存在——不需要枚举触达场景 |
| `delta_target_unplanned` / `delta_target_duplicate` | 不存在——delta 即计划，无从不一致 |
| 模式漂移（plan 后目标被外部创建） | 不存在——模式在 merge 时刻按事实判定 |

### 2.71.3 保留的 fail-closed

路径不可映射为 canonical target 的 delta（越界、`..`、未知类别目录），必须在写入任何文件前整体失败并点名该文件；`logos/resources/` 零改动。该判据与 change-lint L6 同源，不新增第二份。
