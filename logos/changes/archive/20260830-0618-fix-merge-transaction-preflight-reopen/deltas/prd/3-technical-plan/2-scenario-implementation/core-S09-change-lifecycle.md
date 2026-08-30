## ADDED — S09 Seal Preflight 与 Legacy Sealed Reopen 时序

### 场景目标

确保新事务只在全部确定性派生校验通过后 seal；确保尚未首写的 0.14.1 sealed 事务可以在同一 identity 下只退回错误 Agent slot。

### 新事务 Seal 主路径

```mermaid
sequenceDiagram
    participant C as Consumer
    participant M as MergeTransactionService
    participant P as PreflightBuilder
    participant S as TransactionStore

    C->>M: seal(transaction)
    M->>M: validate source/before/content identity
    M->>P: build(before + candidate finals)
    P->>P: derive metadata/test-change-set/final paths
    P-->>M: canonical PreflightView
    alt preflight pass
      M->>S: atomic sealed + preflight record + new seal
      M-->>C: phase=sealed, next_action=apply
    else attributable content failure
      M->>S: atomic collecting; rejected slots missing
      M-->>C: slot_identity_mismatch, retryable=true
    else fatal/unattributable
      M-->>C: stable fatal; slots unchanged
    end
```

### Legacy Sealed Apply 兼容路径

```mermaid
sequenceDiagram
    participant C as Consumer
    participant M as MergeTransactionService 0.14.2
    participant P as PreflightBuilder
    participant S as TransactionStore
    participant A as AtomicApplyWriter

    C->>M: apply(0.14.1 sealed transaction)
    M->>M: assert no journal/receipt/marker/official write
    M->>P: build ephemeral preflight
    alt pass
      M->>S: phase=applying (legacy seal unchanged)
      M->>A: atomic batch
      A-->>M: committed receipt/marker
      M-->>C: completed
    else uniquely attributable Agent error
      M->>S: atomic collecting snapshot first
      M->>M: best-effort rejected private cleanup
      M-->>C: retryable; same transaction
    else fatal or apply artifacts exist
      M-->>C: fail closed / recover only
    end
```

### 状态与身份规则

- reopen 清除外层 `seal_sha256` 和全部 target `sealed_sha256`；仅 rejected slot `content_sha256` 置 null。
- 无关 slot submitted hash、transaction ID、plan hash、target set 保持。
- 修正并重新 submit 后，新 seal生成 preflight record和新 seal；不得恢复旧 seal。
- legacy pass 不伪造新 seal或修改 transaction identity。
- applying/journal 后任何失败走 existing recover/rollback；不得调用 reopen helper。

### 追溯

UT-S09-261～265、ST-S09-102～103覆盖 seal拒绝、legacy reopen、多 slot归因、崩溃顺序、不可逆边界和同 transaction完成。
