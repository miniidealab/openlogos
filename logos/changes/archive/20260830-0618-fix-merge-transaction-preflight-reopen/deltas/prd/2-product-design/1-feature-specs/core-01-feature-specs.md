## ADDED — 2.44.10 Merge Transaction Preflight 与局部 Reopen

### 功能目标

把所有可由 before/candidate final 字节确定的校验前移到 seal，并为首写前的 legacy sealed 内容错误提供系统控制的 missing-slot 重提体验。用户保留同一 transaction 和正确 slot，不获得任意编辑 sealed 内容的能力。

### Preflight View

OpenLogos 以纯函数生成 canonical view：

- 冻结 transaction/plan/target-set identity；
- 列出每个 planned/derived target 的 path、mode、producer、before/final hash；
- 扫描 after 测试定义并生成 `test-change-set`；
- 计算 metadata/counter/index、dogfood/prototype 绑定与最终 path 集合；
- 排除 `completed_at` 等 apply 时刻事实。

新 seal 将 view hash 纳入 `seal_sha256`。apply 重算不相等时首写前拒绝，不使用新的 metadata 或 before 字节静默 rebase。

### 结构化错误与归因

内部 preflight 错误包含 `code`、排序去重后的 `target_paths[]`、`producer`、`retryable`。只有全部 target 唯一映射到 `producer=agent` 且 code 属于内容可修复 allowlist 时，系统才形成 rejected slot set。公共错误继续使用 `slot_identity_mismatch`，不暴露私有路径或新增字段。

### 状态转换与用户反馈

```text
ready --preflight pass--> sealed --apply identity pass--> applying --> completed
  |                           |
  +-- attributable fail -----+--> collecting(missing rejected slots)
```

- seal 失败：从未形成 sealed；问题 slot 回到 missing。
- legacy sealed apply 失败：在 `phase=applying` 和 journal 前执行相同归因并 reopen。
- UI/CLI 显示同一 transaction ID、精确 missing slots、其余 submitted 数量及 `submit_content` 下一动作。
- 修复者只写声明 staging path 并 submit；不得编辑正式 target、`MERGE_TRANSACTION.json`、receipt 或 marker。

### 崩溃安全提交点

1. 验证不存在 apply journal/receipt/marker/正式写入。
2. 内存清除外层 seal、全部 sealed hash 和 rejected submitted hash。
3. 原子替换 transaction 文件，collecting 成为权威。
4. best-effort 删除 rejected content/staging；残留不参与状态派生。

崩溃发生在步骤 3 前，旧 sealed 完整；发生在步骤 3 后，collecting 完整。不得先删 slot 后写状态。

### Legacy 兼容

0.14.1 sealed transaction 缺 preflight 记录时，0.14.2 apply 临时生成 view。通过则沿用旧 seal完成 apply；可归因失败则 reopen，重新提交后生成新 preflight/new seal。transaction ID、plan hash 与 target set 始终不变。

### 验收体验

- status 与 next 从持久化 transaction 同源投影，不扫描残留私有字节。
- retryable error 明确指出替换 missing slot 后重新 seal，不建议 abort 或新建事务。
- fatal/drift/recovery error 不清 slot、不返回 submit_content。
- 安装态必须在独立授权后以固定 0.14.2 tarball完成隔离、回滚和 RunLogos 原事务 smoke。
