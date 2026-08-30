## ADDED — S09 公共 staging、abort 与 completed receipt 测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S09-251 | 公共 slot descriptor | 每个 slot 稳定返回 `slot_id/target_ref/staging_path/required/content_encoding/max_bytes/write_protocol/submitted_sha256`，不泄漏 canonical target 写权 |
| UT-S09-252 | submit 路径等值 | `submit-content --file` 仅接受声明 `staging_path`；其它路径、逃逸、symlink 与 canonical target 均在首写前失败 |
| UT-S09-253 | staging 写协议 | 仅同目录临时文件原子 rename、UTF-8 raw、字节上限及提交后 SHA-256 全部满足时接收 |
| UT-S09-254 | abort phase allowlist | 只在 collecting/ready/sealed 接受 abort；applying/recovering/completed/failed 均拒绝新 abort |
| UT-S09-255 | abort 终态与清理 | 成功后固定为 failed/aborted，动作清空、receipt=null，并清理本事务 staging/临时/备份私有制品 |
| UT-S09-256 | abort 幂等 | 同一已 aborted transaction 重复 abort 返回同 identity 与 `aborted_at`，不新增写入或清理外部路径 |
| UT-S09-257 | receipt 无环身份 | `receipt_sha256` 只对排除自身字段的 canonical receipt payload 计算；receipt 不包含自身或 marker 的 file hash |
| UT-S09-258 | completed 提交闭包 | `final_hashes.paths` 与 `artifact_hashes.paths` 互斥，二者并集精确等于 `commit_paths` |
| UT-S09-259 | response-lost 重建 | completed 响应丢失后新进程返回同 receipt、`receipt_sha256`、artifact hashes 与完成时间 |
| UT-S09-260 | 私有制品排除 | slot/journal/staging/temp/backup 不进入 final/artifact hashes 或 commit_paths，完成或 abort 后按合同清理 |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-99 | staging→submit→seal→apply | Agent 原子写声明 staging path，Driver 以同路径 submit，最终得到合法 completed receipt 与精确提交闭包 |
| ST-S09-100 | abort 清理闭环 | collecting、ready、sealed 三夹具可 abort；重复 abort 幂等，正式 target/metadata/marker 均不变 |
| ST-S09-101 | response-lost 精确回放 | apply 已完成但响应丢失，新进程只读恢复同一 receipt/hash/commit paths，不重做 apply 或生成第二 receipt |

### Runner、Reporter 与追溯

- UT 使用临时项目、路径逃逸/symlink 负例、canonical JSON 与故障注入；ST 必须走真实 CLI 子进程，禁止预造 receipt。
- 每个 ID 必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`；evidence 记录脱敏 transaction/receipt/hash、前后树 hash 与清理结果。
- staging：UT-S09-251～253、ST-S09-99；abort：UT-S09-254～256、ST-S09-100；receipt：UT-S09-257～260、ST-S09-101。
