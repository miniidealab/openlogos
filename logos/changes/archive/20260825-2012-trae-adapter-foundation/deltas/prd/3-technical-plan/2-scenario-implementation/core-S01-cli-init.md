## ADDED — TRAE non-deployable 初始化负向时序

### 目标

S01 在 Registry 选择阶段即排除 TRAE：`all` 只选择既有七个 deployable Adapter；显式 `trae` 在任何资产规划、暂存或写入之前 fail loud。客户端已安装、已登录或存在 `.trae/**` 不改变该结论。

### `all` 初始化时序

```mermaid
sequenceDiagram
    actor U as 用户
    participant C as InitCommand
    participant R as AiToolAdapterRegistry
    participant P as ManagedAssetTransaction
    U->>C: init --ai-tool all
    C->>R: resolve(all)
    R-->>C: 现有七个 deployable Adapter（无 trae）
    C->>P: plan/commit 七宿主资产
    P-->>C: committed / unchanged
    C-->>U: 成功；未创建 TRAE 托管资产
```

### 显式 `trae` 失败时序

```mermaid
sequenceDiagram
    actor U as 用户
    participant C as InitCommand
    participant R as AiToolAdapterRegistry
    participant F as 文件系统
    U->>C: init --ai-tool trae
    C->>R: resolve(trae)
    R-->>C: UnsupportedAiTool（支持列表不含 TRAE）
    C-->>U: fail loud + 原始输入 + 无写入
    Note over C,F: 不调用资产规划器；配置与既有 .trae/** SHA-256 不变
```

### 不变量

- 不把 `trae` 映射为 `other`，不创建 placeholder Adapter/capability。
- 帮助、交互列表和结构化支持值全部由 Registry 派生，保持七宿主稳定顺序。
- TRAE Rules、Skills、Agents、Hooks、MCP、settings、账号和记忆均为用户/宿主资产，初始化不扫描或修改。
