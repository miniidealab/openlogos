## ADDED — S09 公共 staging、abort 与 completed receipt 时序补充

### 主路径：声明 staging 到 completed

```mermaid
sequenceDiagram
    participant O as OpenLogos
    participant R as RunLogos
    participant A as Agent
    participant G as Git
    O-->>R: collecting + content_slots.items(staging_path)
    R->>A: 仅授权声明 staging_path
    A->>A: 同目录临时文件写完并 atomic rename
    A-->>R: WorkUnit quiescent
    R->>O: submit-content --slot --file=声明路径
    O->>O: containment/symlink/encoding/size/hash 校验
    R->>O: seal
    O-->>R: sealed + next_action=apply
    R->>O: apply
    O->>O: 原子提交 payload、receipt、SPEC_MERGED
    O-->>R: completed receipt + artifact_hashes
    R->>G: 仅提交 commit_paths
```

### Abort 分支

```mermaid
sequenceDiagram
    participant R as RunLogos
    participant O as OpenLogos
    R->>O: abort --slug
    O->>O: 校验 phase∈collecting|ready|sealed
    O->>O: 清理 staging/content/backup/journal
    O-->>R: failed/aborted, actions=[], receipt=null
    R->>O: 重复 abort
    O-->>R: 同一 aborted_at，无写入
```

### Response-lost 与异常

apply 响应丢失后先 status/recover；completed 必须返回同一 receipt payload identity，并从持久化 receipt/marker 字节重建相同 artifact_hashes。file 参数不是声明 staging path、staging 漂移或 union(commit hash paths) 不等于 commit_paths 时，事务不进入 completed。
