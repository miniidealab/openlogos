# Delta: core-01-feature-specs.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`

## REMOVED — 2.44 合并事务单一权威与跨仓消费功能规格

合并事务外壳整节删除：content slot 声明与 staging 写协议、`submit-content` 逐 slot 提交与读回校验、`seal` 与 `seal_sha256`、`apply` 事务提交与回滚、receipt、`target_set_sha256`、相位机与 `allowed_actions` 准入矩阵、跨仓消费方的 schema/contract hash 精确匹配。其承载的合并能力改由 §2.69 的直接合并承载。

## REMOVED — 2.44.10 Merge Transaction Preflight 与局部 Reopen

seal 绑定的确定性 preflight 与局部 reopen 依附于事务相位机，随事务删除。其规格结构检查能力由 §2.70 的 `openlogos lint-specs` 承接。

## REMOVED — 2.46 Merge Transaction 嵌套章节锚同源解析

嵌套锚的同源解析能力属合并引擎 `resolveSectionAnchor`（随引擎保留）；本节规定的是其在 slot preflight 与同事务恢复中的用法，随事务删除。

## REMOVED — 2.58 合并事务的终态出路（spec-mutability）

终态出路（abort 重建 / completed reopen / 留痕与归档让位）依附于事务终态相位。事务删除后不存在终态，重新合并即回滚后重跑 `openlogos merge`。

## REMOVED — 2.60 merge 流程契约自洽：前沿事务事实、后置条件二分与机器消费验收

前沿事务事实作为第二事实源随事务删除；merge 节点完成回归单一判据 `SPEC_MERGED` 在场，无需二分与同源校验。

## ADDED — 2.69 merge 直接合并（一次调用完成）

### 2.69.0 问题：36 次往返保护一个不存在的并发场景

合并事务把「把 N 个 delta 合进主文档」拆成 N×3 + 3 次 CLI 往返，用 slot 双哈希与 staging 保证多方并发写的原子性。实际写入方只有**一个顺序执行的 AI**，且 `logos/resources/` 受 git 跟踪。2026-09-07 三向死锁（`reopen` 拒 / `abort` 拒 / `merge` 认为已完成）即该外壳的直接产物。

### 2.69.1 命令合同

```
openlogos merge <slug> [--format json]
```

**行为**（单次调用内顺序完成，无中间相位）：

1. 解析提案的 `[delta]` 目标集与 canonical target 映射，做既有的 P==T==D 与路径合法性校验。
2. 逐目标读取 delta 与当前主文档，调 `composeOpenLogosMarkdown` 合成最终字节——该引擎内部执行章节锚唯一定位、标题层级 rebase 与 `verifyAgentMaterialOutcome` 物质结果复验，任一不符即在写入任何文件前失败。
3. 全部目标合成完毕后，交 `applyBaselineClosureBatch` **一次性原子落盘**（temp + fsync + rename，失败整批回滚）。
4. 末步写 `SPEC_MERGED`，含结构化 `test_change_set` 字段（由 `buildTestChangeSet` + `forwardMergeTestChangeSets` 构建）。

**失败语义**：任一步失败即整批回滚，主文档保持合并前字节；错误信息附 `git checkout logos/resources/` 作为回滚点提示。不再有 `recover` / `abort` / `reopen` 出路——**因为不再有需要出路的中间态**。

**重新合并**：`git checkout logos/resources/` 回到合并前，修正 delta 后重跑 `openlogos merge`。

### 2.69.2 SPEC_MERGED 结构（结构化事实源，零回归）

marker 去掉三个事务字段（`transaction_id` / `seal_sha256` / `receipt_sha256`），保留：

| 字段 | 说明 |
|---|---|
| `type` | `merge_complete` |
| `completed_at` | ISO 时间戳 |
| `test_change_set` | **结构化事实源**，schema 与内容口径逐字段不变 |

`test_change_set` 被 `verify`（eligible 与覆盖判定）、`change-lint`、`test-slice-manifest`（切片验证状态）三处消费——**流程判断使用结构化数据**，故它不随事务删除，消费方读取行为零改动。

### 2.69.3 保留不变

`lib/markdown-section-authority.ts`（合并引擎与物质结果复验）、`lib/test-change-set.ts`、`lib/baseline-apply.ts` 的 `applyBaselineClosureBatch`（原子落盘原语）逐行保留——删的是外壳，不是引擎与原语。

## ADDED — 2.70 lint-specs 独立规格结构检查

### 2.70.0 为什么必须同批提供

seal preflight 承担了规格结构检查（重复 ID、表格列数），它曾发现同一测试 ID 被两个用例共用、导致一个验收结果被长期静默覆盖。减法方案 B 类第二项明确要求为其提供廉价替代，否则「这类污染会无声累积」。因此本能力与事务删除**同批落地**，不留真空窗口。

### 2.70.1 命令合同

```
openlogos lint-specs [--format json]
```

检查 `logos/resources/test/` 下全部测试规格：

| 检查项 | 判据 |
|---|---|
| 重复 ID | 同一 `UT-*` / `ST-*` / `SMOKE-*` 在表格首列出现多次 |
| 表格列数 | 同一表格内各行管道分隔列数一致 |
| ID 格式 | 首列 ID 符合 `(UT|ST)-S<数字>-<数字>` / `SMOKE-<模块>-<数字>` |

**不参与任何门（强制）**：`merge` / `verify` / `archive` / `change-lint` 均不因本命令结论而阻断。它是用户主动运行的只读诊断工具，呼应「任何审计产物都不得出现在流程分支的条件里」。发现问题时非零退出并逐条列出位置，供人判断。
