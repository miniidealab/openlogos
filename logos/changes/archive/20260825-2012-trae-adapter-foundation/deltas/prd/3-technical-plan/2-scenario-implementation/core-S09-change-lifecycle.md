## ADDED — TRAE hard guard 不成立的生命周期负向时序

### 目标

S09 不为 TRAE 注册 SessionStart/PreToolUse normalizer，不把 Rules、Skills、Agent prompt、MCP、人工确认、工作区信任或原生记忆作为 OpenLogos 授权状态。当前双客户端真实基础 deny 已失败，故生命周期中不存在 TRAE hard guard 调用链。

### Registry 排除时序

```mermaid
sequenceDiagram
    participant T as TRAE 国际版/CN
    participant H as 项目 .trae/hooks.json
    participant R as AiToolAdapterRegistry
    participant G as GuardDecisionService
    T->>H: 真实内置 Write
    Note over T,H: 3.5.91 与 3.3.93 探测中 Hook 未调用，目标已改变
    R-->>R: 不登记 trae capability/normalizer
    Note over R,G: 不构造 TRAE 事件，不调用共享决策服务冒充宿主拦截
```

### 生命周期状态变化

```mermaid
sequenceDiagram
    actor U as 用户
    participant L as ChangeLifecycle
    participant R as AiToolAdapterRegistry
    participant F as TRAE 用户资产
    U->>L: writing → delta-writing → ready-to-merge
    L->>R: 查询 deployable Adapter
    R-->>L: 现有七宿主（无 trae）
    Note over L,F: 不写 .trae/hooks.json，不读取 enabled_folders 或原生记忆
    L-->>U: 阶段按 OpenLogos 磁盘事实推进；TRAE 不获得授权声明
```

### 不变量与重新开启门

- wrapper 直调返回 deny、Hooks UI 存在或项目配置文件可解析，均不得产生 TRAE capability PASS。
- 已支持宿主仍按既有合同每次重读 guard、slug、tasks 与 `proposal_step`；deny 必须有非空 reason、正确退出语义且目标哈希不变。
- 未来独立提案只有在国际版与 CN 的真实内置工具共同通过 allow/deny、路径边界、symlink、未知工具及全部异常 fail-closed 矩阵后，才能新增 TRAE normalizer 与正向时序。
