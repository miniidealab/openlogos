## ADDED — S39 completed 提交闭包与 Git 白名单测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S39-51 | payload 路径闭包 | `payload_paths=changed_paths∪created_paths`，且 `final_hashes.paths` 与 payload_paths 精确相等 |
| UT-S39-52 | 双层 hash 互斥 | receipt final hashes 不含 receipt/marker；外层 artifact hashes 只覆盖 `MERGE_RECEIPT.json` 与 `SPEC_MERGED` |
| UT-S39-53 | commit_paths 精确并集 | `final_hashes.paths∪artifact_hashes.paths=commit_paths`，缺失、额外、重复或交集均 fail-closed |
| UT-S39-54 | receipt canonical 身份 | `receipt_sha256` 可从排除自身字段的 canonical payload 唯一重算，不依赖文件自 hash 或生成顺序 |
| UT-S39-55 | 私有制品与 Git 隔离 | slot/journal/staging/temp/backup/unrelated dirty 不进入公共闭包，`git add -- <commit_paths...>` 后 staged paths 必须精确相等 |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S39-26 | mixed closure 精确提交 | 多根 CREATE/MODIFY/metadata 事务完成后仅按公共 commit_paths 暂存；unrelated dirty 保留未暂存，所有公开 hash 可从磁盘重算 |

### Runner、Reporter 与追溯

- UT 使用固定 payload/receipt/artifact fixture 与增删改反例；ST 在隔离 Git 仓库走真实 transaction 和固定 argv 暂存。
- 每个 ID 必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`，evidence 记录脱敏路径集合摘要、receipt/tree/staged hashes。
- payload/双层 hash：UT-S39-51～54；私有制品/Git：UT-S39-55、ST-S39-26。
