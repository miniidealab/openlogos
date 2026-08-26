## ADDED — 18. 测试变更集原子固化

### 18.1 事务边界与协议分层

baseline closure 的严格 Agent 输入继续精确使用 `openlogos/baseline-merge-apply@1`。`MERGE_APPLY_MANIFEST.json` 的顶层、prepared target 与 metadata target 字段合同不得为测试变化扩展；Agent 不填写 changed/removed ID，也不拥有正式测试记录的语义差异。

只有 `openlogos merge-apply` 同时掌握已验证 before/current 字节与 prepared final 字节，因而由它在首写前为 category=`test` targets 计算 `openlogos/test-change-set@1`，嵌入最终 `SPEC_MERGED.test_change_set`，并将完整 marker 字节加入同一 `applyBaselineClosureBatch()`。`SPEC_MERGED` 必须最后写入。

### 18.2 before/final 事实

- MODIFY：before 是与 strict manifest `before_sha256` 匹配的当前正式目标原始字节；final 是已验证 `content_base64` 解码字节。
- CREATE：语义 before 是空态，change-set `before_sha256` 必须为 `null`；final 是已验证解码字节。
- SKIP/AMBIGUOUS：不得进入 apply 批次或 change-set targets。
- 未触及 category=`test`：本批 change set 的 targets/C/R 为空。

TestDefinitionDiff 必须按 `spec/test-slice-manifest.md` 的 authority scanner 在所有测试 targets 上构建全局 before/final 记录映射，得到新增或语义修改集合 C、删除集合 R 与原样记录集合。整份 Delta 中原样携带的已有测试不能进入 C；正式 target 路径属于规范化记录，跨 target 移动必须进入 C。

### 18.3 预写校验

生成 marker 前必须完成：

1. strict apply manifest 既有 L1～L9、P=T=D、source/before/final hash 与路径 containment 校验；
2. before/final UTF-8、Markdown authority 表格和全局测试 ID 唯一性校验；
3. change-set 精确字段、排序、集合、target identity 与 canonical payload hash 自校验；
4. `change`、`module`、guard、baseline plan、strict manifest 和 marker 身份一致性校验。

任一步失败都必须在第一个正式目标写入前返回非零；不得写 resources、metadata、counter、index、marker 或恢复性 slice manifest。Git 仓库、commit、parent、branch、squash/rebase 状态不得参与计算。

### 18.4 原子 apply、复核与回滚

批事务按既有规范备份 MODIFY/metadata，跟踪本批 CREATE，并以 marker 为最后写入。写入后必须从磁盘重读全部 category=`test` targets 与 `SPEC_MERGED`，复核：

- 正式目标字节哈希等于 change-set `after_sha256`；
- marker 中 change set 可由 TestChangeSetReader 完整读取，payload hash 正确；
- targets 精确等于 baseline plan 中 category=`test` 的 canonical targets；
- marker 的 `manifest_sha256` 继续只绑定严格 apply manifest，未被 change-set payload 替代。

任一写入、fault injection、fsync/rename 或后置复核失败时，必须恢复所有 MODIFY/metadata/counter/index，删除本批 CREATE 与 marker，并返回 `rolled_back=true`。不得留下只有资源或只有 change set 的半提交状态。

### 18.5 no-delta 与历史兼容

`type=no_delta_spec_complete` 且磁盘确无 mergeable Delta 的既有 marker 可由读取器可信派生空 C/R；不得为此改写旧 marker，也不得扫描正式规格声称存在本提案变化。

新 baseline apply marker 缺少 `test_change_set` 是完整性错误。历史 marker 的兼容读取必须由明确 marker 类型和可证 no-delta 条件约束；含测试 Delta、身份不一致、未知 schema 或 target 哈希漂移时一律 fail-closed，不从 Delta 或 Git 补算。

### 18.6 验收

- before/final 的新增、语义修改、原样、删除与跨 target 移动分类准确且确定；
- 严格 apply manifest 字段合同保持逐字不变；
- resources、metadata 与带 change set 的 marker 全有或全无；
- 重启和无 Git 环境读取结果一致；篡改 target 或 marker 必须稳定拒绝；
- S32 所有消费者只读取同一 change set，`O = C`，R 不进入切片归属。
