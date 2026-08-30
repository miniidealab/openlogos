## ADDED — Preflight 冻结与局部 reopen 补充（2026-08-30）

### 状态

Accepted。本补充扩展 D07，不改变 `openlogos/merge-transaction@1` 的公共 phase、action、classification 或 projection 字段集合。

### 决策

1. `seal` 前由 OpenLogos 单一 writer 构建纯只读、确定性的 preflight view。它覆盖正式 target before/final hash、OpenLogos 派生 metadata/counter/index、after 测试定义、`test-change-set`、dogfood/prototype 绑定和最终 target path 集合。
2. 新事务的 canonical `preflight_sha256` 必须进入 `seal_sha256`；`apply` 在写 `phase=applying` 前重算同一 view，并逐项确认与 sealed view 一致。`completed_at` 等 apply 时刻事实不进入 preflight。
3. 0.14.1 已 sealed 且没有 preflight 记录的事务只允许首写前兼容：apply 临时计算 preflight；通过则沿用 legacy seal 完成 apply，失败且可归因则同 transaction reopen。reopen 后再次 seal 必须生成新 preflight 与新 seal。
4. validator/producer 内部错误必须结构化携带稳定 `code`、canonical `target_paths[]`、`producer`、`retryable`。只有全部失败 target 都能唯一映射到可修复 Agent slot 时才可 reopen；不按错误文案解析路径。
5. reopen 的权威转换以 `MERGE_TRANSACTION.json` 单文件原子替换为提交点：先持久化 collecting、清空外层 seal、全部 sealed hash 和 rejected slot submitted hash，再 best-effort 清理 rejected slot 私有字节。无关 slot 的 submitted hash 保留。
6. apply journal、receipt、marker、apply staging/backup 或任何正式首写一旦存在，只能 recover/rollback，禁止退回 collecting。

### 冻结事实

```text
PreflightView = canonical(
  transaction_identity,
  planned_targets[path, mode, producer, before_sha256, final_sha256],
  derived_targets[path, producer, before_sha256, final_sha256],
  test_change_set_sha256,
  final_target_paths
)

new_seal_sha256 = sha256(transaction_id, target_set_sha256, content_hashes, preflight_sha256)
```

公共 projection 不新增 `preflight_sha256`；它是 OpenLogos-owned 的内部冻结事实。`target_set_sha256` 与 transaction ID 对旧事务保持不变。

### 崩溃一致性

- 原子状态替换前崩溃：原 sealed 事实完整，下一次 apply 可重复 preflight。
- 原子状态替换后、私有清理前崩溃：collecting 已是唯一权威；残留旧字节不可恢复 submitted，后续 submit 原子覆盖。
- 私有清理失败：保留 collecting，不回滚为 sealed，不清理无关 slot。
- metadata 或正式 before 在 seal/apply 间漂移：首写前 fatal，禁止静默 rebase。

### 备选方案

- 放宽 after 测试表校验：拒绝，会损害 `test-change-set` 可信性。
- abort 后重建全部 slot：拒绝，会丢失无关正确提交。
- 新增人工 reopen 命令：拒绝，会暴露不受约束的 sealed 编辑入口。
- 先删除 slot 文件再写 collecting 状态：拒绝，会产生 sealed 引用缺失内容的崩溃窗口。
- 只在 seal 运行 preflight、apply 不复核：拒绝，无法证明 seal 与实际提交同一。

### 验收锚

S05、S09、S11、S16、S19、S39 的新增 UT/ST 与 SMOKE-core-160～162 必须共同证明：新事务 seal 前拒绝、旧 sealed 局部 reopen、状态投影同源、崩溃窗口可恢复、不可归因错误不清 slot、安装态同一事务最终 completed。
