# Delta: cli-json-output.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`spec/cli-json-output.md`（项目根规范，权威）

## REMOVED — Merge transaction JSON 契约（0.14.0）

事务投影（相位、`allowed_actions`、`content_slots`、`seal_sha256`、`target_set_sha256`）随事务删除。

## REMOVED — Merge transaction 消费者合同完成版（0.14.0）

跨仓消费方按 schema/contract hash 精确匹配事务投影的合同随事务删除。

## REMOVED — Merge Transaction Preflight/Reopen JSON 兼容合同（0.14.2）

preflight/reopen 的 JSON 兼容合同依附于事务相位，随之删除。

## REMOVED — Merge transaction 终态出路 JSON 合同（0.14.17）

终态出路合同随事务终态删除。

## REMOVED — merge 成功后置条件与前沿推进契约（fix-merge-flow-transaction-contract）

前沿事务事实作为第二事实源随事务删除；merge 成功后置条件回归 `SPEC_MERGED` 在场这一单一判据。

## ADDED — openlogos merge 直接合并输出合同

`openlogos merge <slug> [--format json]` 一次调用完成合并。

### 成功输出

stdout 输出标准 envelope，`data` 至少含 `slug`、`target_count`、`targets`（canonical target 路径数组）、`spec_merged_path`、`test_change_set`（结构化，与 `SPEC_MERGED` 中同源）。

### 稳定错误码

| 错误码 | 触发 |
|---|---|
| `MERGE_NO_ACTIVE_CHANGE` | 无活跃提案或提案目录缺失 |
| `MERGE_DELTA_INVALID` | delta 段标记缺失、章节锚解析到 0 或多处、物质结果复验不通过 |
| `MERGE_TARGET_MISMATCH` | P==T==D 不成立（proposal / tasks / deltas 目标集不等） |
| `MERGE_ALREADY_COMPLETE` | `SPEC_MERGED` 已在场（重新合并须先 `git checkout logos/resources/` 回滚） |
| `MERGE_APPLY_FAILED` | 落盘中途失败（已整批回滚） |

**零副作用（强制）**：除 `MERGE_APPLY_FAILED`（已回滚）外，任一错误码触发时 `logos/resources/` 与 `SPEC_MERGED` 均未被触碰。错误 message 附 `git checkout logos/resources/` 作为兜底回滚提示。

### SPEC_MERGED 结构（结构化事实源）

```jsonc
{
  "type": "merge_complete",
  "completed_at": "<ISO 时间戳>",
  "test_change_set": { /* schema 与内容口径与事务时代逐字段一致 */ }
}
```

`test_change_set` 被 `verify`、`change-lint`、`test-slice-manifest` 三处消费——**流程判断使用结构化数据**，消费方读取行为零改动。

## ADDED — openlogos lint-specs 输出合同

`openlogos lint-specs [--format json]` 是规格结构的**只读诊断**命令，检查 `logos/resources/test/` 下的重复 ID、表格列数一致性与 ID 格式。

成功时 stdout 输出 envelope，`data` 含 `checked_files`、`issues`（每项含 `code` / `path` / `line` / `message`）。发现问题时非零退出。

**不参与任何门（强制）**：`merge` / `verify` / `archive` / `change-lint` 均不读取本命令结论、不因其结果阻断——它承接的是 seal preflight 删除后的结构检查能力，但以诊断工具而非门的形态提供。
