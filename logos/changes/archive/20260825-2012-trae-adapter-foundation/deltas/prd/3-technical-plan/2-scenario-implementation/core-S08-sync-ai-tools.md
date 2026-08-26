## ADDED — TRAE non-deployable 同步负向时序

### 目标

S08 不因客户端发现或工作区已有 `.trae/**` 自动增加 TRAE Adapter。`all` 只同步既有七宿主；手工配置中的 `trae` 必须在总事务开始前失败，且不刷新同步版本戳。

### `all` 同步时序

```mermaid
sequenceDiagram
    actor U as 用户
    participant C as SyncCommand
    participant R as AiToolAdapterRegistry
    participant P as ManagedAssetTransaction
    participant S as SyncVersionStamp
    U->>C: sync（配置为 all）
    C->>R: resolve(all)
    R-->>C: 七个 deployable Adapter（无 trae）
    C->>P: 规划、预检、提交七宿主资产
    P-->>C: 全部成功并读回
    C->>S: 最后提交版本戳
    C-->>U: Sync complete；TRAE 用户资产未触达
```

### 非法配置失败时序

```mermaid
sequenceDiagram
    actor U as 用户
    participant C as SyncCommand
    participant R as AiToolAdapterRegistry
    participant P as ManagedAssetTransaction
    participant S as SyncVersionStamp
    U->>C: sync（配置含 trae）
    C->>R: resolve(configured tools)
    R-->>C: UnsupportedAiTool(trae)
    C-->>U: fail loud；不输出 Sync complete
    Note over C,P: 不开始暂存、替换或回滚事务
    Note over C,S: 版本戳保持旧值
```

### 不变量

- `.trae/` Rules、Skills、Agents、Hooks、MCP、settings、账号、记忆和未知文件不进入扫描、计划、暂存、备份、删除或回滚集合。
- 不因探测到 TRAE 国际版/CN 安装或登录状态而改变 Registry。
- 既有七宿主的目标顺序、内容哈希、结果分类、原子提交和版本戳语义保持不变。
