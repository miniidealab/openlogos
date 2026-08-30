## ADDED — 三十五、Merge Transaction Preflight/Reopen 架构

### 35.1 组件与所有权

```text
MergeTransactionService
  ├─ PreflightBuilder              纯只读构建 canonical view
  ├─ PreflightValidator            校验 before/final/derived identity
  ├─ PreflightErrorAttributor      structured target → Agent slot
  ├─ MergeSealWriter               preflight_sha256 → seal_sha256
  ├─ MergeReopenWriter             原子 collecting 状态替换
  └─ BaselineClosureApplyWriter    applying/journal/正式批提交
```

- `PreflightBuilder` 独占 planned/derived target 聚合，不写 transaction、journal、staging 或正式目标。
- `PreflightErrorAttributor` 只消费结构化 error 与冻结 target map，不解析 message。
- `MergeReopenWriter` 只允许首写前转换 sealed/ready→collecting；apply writer 一旦接管即不可逆。
- status/next 只读取 transaction projection，不读取 merge-content/merge-staging 反推状态。

### 35.2 内部数据模型

```ts
interface MergePreflightView {
  schema: 'openlogos/merge-preflight@1';
  transaction_id: string;
  plan_sha256: string;
  target_set_sha256: string;
  targets: Array<{
    path: string;
    mode: 'CREATE' | 'MODIFY';
    producer: 'agent' | 'openlogos';
    before_sha256: string | null;
    final_sha256: string;
  }>;
  test_change_set_sha256: string;
  final_target_paths: string[];
  sha256: string;
}

interface MergePreflightErrorFact {
  code: string;
  target_paths: string[];
  producer: 'agent' | 'openlogos' | 'mixed' | 'unknown';
  retryable: boolean;
}
```

数组必须去重稳定排序；hash 使用 canonical serialization。内部 preflight 记录为 optional，以便读取 legacy stored transaction；不进入公共 projection schema。

### 35.3 Seal 与 Apply 同一性

新 seal 同时绑定 content hashes 与 `preflight_sha256`。apply 的首个可变动作之前重算 view：

1. 校验 Delta source、正式 before、slot content/sealed hash；
2. 重建 planned/derived final bytes；
3. 重建测试定义与 change set；
4. 比较 target path 集合及所有 hash；
5. 完全相等才持久化 `phase=applying` 并进入 batch writer。

metadata 在 seal 后漂移属于 fatal before/derived drift，不允许动态合并新 metadata。

### 35.4 Legacy Sealed 分支

缺 preflight record 且 phase=sealed 的 0.14.1 transaction 进入 legacy branch。它在首写前运行同一 builder/validator：pass 时沿用旧 seal和旧 receipt identity算法；attributable content fail 时执行 reopen。reopen 后的下一次 seal切换到新 preflight算法。completed、applying、存在 journal/receipt/marker 的事务不进入本分支。

### 35.5 Reopen 提交协议

1. 在锁/单 writer 边界内复核无 apply artifacts 和正式 drift。
2. 计算 rejected slot set；若任一错误不可唯一归因则整体 fatal。
3. 构造 collecting snapshot：外层 seal null、所有 target sealed hash null、rejected content hash null、其余 content hash不变。
4. durable temp → fsync → rename → fsync 持久化 transaction。
5. 状态成功后清理 rejected merge-content/merge-staging；清理幂等且不影响 projection。

禁止跨文件“同时删除”伪原子语义。状态文件是提交点，私有字节删除只是垃圾回收。

### 35.6 不可逆边界与失败分类

| 事实 | 允许动作 |
|---|---|
| ready/sealed、无 apply artifacts、可归因 Agent 内容错 | reopen collecting |
| contract/schema/plan/source/before/seal/path/internal invariant | fail closed，保留 slot |
| OpenLogos producer 或 mixed/unknown attribution | fail closed，保留 slot |
| applying/journal/staging/backup/正式新字节 | recover/rollback only |
| completed receipt + marker | 幂等 completed only |

### 35.7 实现与测试映射

- `cli/src/lib/merge-transaction.ts`：builder 编排、seal/apply/reopen 状态边界。
- `cli/src/lib/test-change-set.ts`：结构化 target-aware 错误。
- `cli/src/lib/baseline-apply.ts`：apply 不可逆边界保持不变。
- `cli/src/lib/merge-transaction-semantic.ts` 与 schemas/golden：公共 projection不增字段、collecting 投影同源。
- UT/ST 覆盖 fault injection、legacy fixture、多 target attribution、metadata drift、残留私有字节与 reporter；SMOKE覆盖真实 0.14.2 tarball和 RunLogos 原事务。
