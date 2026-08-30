## ADDED — S09 Missing-slot 修复、授权与提交边界

### 责任矩阵

| 责任方 | 允许 | 禁止 |
|---|---|---|
| OpenLogos core | preflight、结构化归因、原子 reopen、seal/apply/recover | 猜测错误消息、首写后 reopen |
| Merge consumer/Agent | 读取 status/next、重建 rejected target final bytes、写声明 staging、submit | 写正式 resources、transaction 私有状态、receipt/marker |
| 用户 | 在独立门批准 merge/verify/deploy/smoke/archive/push | 以 proposal/tasks 文案代替确认点 |

### Missing-slot 修复时序

```mermaid
sequenceDiagram
    participant O as OpenLogos Core
    participant C as Consumer
    participant G as Declared Staging
    participant T as Transaction

    O-->>C: retryable + phase=collecting
    C->>T: status
    T-->>C: one/more missing_slot_ids; others submitted
    C->>C: regenerate final bytes from approved Delta/effective baseline
    C->>G: temp write + fsync + atomic rename
    C->>O: submit-content --slot --file declared-path
    O->>T: verify bytes/hash; update submitted
    O-->>C: ready when all required slots present
    C->>O: seal
```

消费者不得把 retryable 解释成“修改现有 sealed slot”：只有 core 已持久化 collecting 且该 slot 出现在 missing 集合时才可重提。无关 slot 不重新生成、不重新 submit。

### Git 与制品边界

- reopen、slot 私有清理和 staging 都不是可提交规格产物。
- 只有 completed receipt 的 `commit_paths` 可以进入精确规格提交。
- legacy transaction 完成后仍按 receipt 校验 final/artifact hashes；不能因 transaction ID 沿用而跳过。
- RunLogos 的 `UT-S44-24` 修复发生在其当前提案声明 staging 中；不得直接修改正式 `logos/resources/test/core-S44-test-cases.md`。

### 授权边界

本次 plan approval 只允许 Delta。Delta 完成后的 `openlogos merge`、代码完成后的 verify、0.14.2 部署、smoke、RunLogos transaction继续、archive与push分别遵守确认点。只有明确的当前用户消息或 `--auto` standing授权可以消费对应门；proposal/decision/tasks自身不是执行授权。

### 异常

- status显示fatal/unattributable：停止，不清 slot、不abort掩盖原因。
- plan/source/before drift：停止并按稳定分类处理，不生成新 transaction规避。
- journal/recovery错误：只执行 recover/rollback路径。
- 修正后仍有内容错误：core可再次按同规则只退回新 rejected slots。
