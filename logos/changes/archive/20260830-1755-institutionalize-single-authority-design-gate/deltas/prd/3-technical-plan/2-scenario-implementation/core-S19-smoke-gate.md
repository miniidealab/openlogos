## ADDED — S19 Authority Closure candidate 与 cutover smoke

## S19 Authority Closure candidate 与 cutover smoke

### 场景目标

在隔离安装态证明根规范、六个 Skill、CLI evaluator 和插件/cache 投影来自同一源，并验证 writer cutover、stale projection 与版本回滚不会产生第二权威。

### 时序图

```mermaid
sequenceDiagram
    participant D as deployment-executor
    participant PK as Candidate Package
    participant CL as Installed CLI
    participant FX as Smoke Fixtures
    participant RP as Smoke Reporter
    D->>PK: Step 1: 核对 tarball SHA 与 asset manifest
    D->>CL: Step 2: 隔离安装并校验入口/版本/资产 hash
    CL->>FX: Step 3: 运行 required/not_applicable 与五类 violation
    CL->>FX: Step 4: 运行 stale/conflict/restart/cutover
    FX-->>RP: Step 5: 写 SMOKE-core-163～167
    alt 任一失败
        D->>CL: Step 6: 恢复冻结版本并验证入口
    else 全部通过
        D-->>RP: Step 6: 输出 smoke pass evidence
    end
```

### 门禁

- source Skill、package Skill、plugin/cache 资产与 manifest/hash 一致。
- Authority Closure evaluator 正负例与源码测试一致；status/next/flow 不出现局部重算。
- stale/conflict fixture 只按 authority 得出结论；旧 writer 调用被拒绝。
- 回滚演练后当前版本入口、资产和行为完全恢复；再次安装 candidate 仍幂等。
- 结果由 smoke reporter 写 `logos/resources/verify/smoke-results.jsonl`，禁止手工补写。

### 授权边界

规格 merge、verify、部署和 smoke 是独立确认点。本场景只定义部署后验收，不因 plan 批准自动执行安装或 smoke，也不授权公开 npm 发布。

### 追溯

- 规范：AC-04～AC-08。
- 测试：UT-S19-26～UT-S19-28、ST-S19-17、SMOKE-core-163～SMOKE-core-167。
