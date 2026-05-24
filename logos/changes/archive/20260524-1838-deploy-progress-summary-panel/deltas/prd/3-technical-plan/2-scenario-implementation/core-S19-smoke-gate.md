## MODIFIED — S19: 执行部署后 smoke 门禁 — 时序图
# S19: 执行部署后 smoke 门禁 — 时序图

```mermaid
sequenceDiagram
    participant U as User
    participant C as OpenLogos CLI
    participant P as Proposal Workspace
    participant S as Smoke Runner

    U->>C: Step 1: openlogos smoke --env staging
    C->>P: Step 2: 读取活跃提案部署决策、tasks.md 和 DEPLOY_DONE
    C->>C: Step 3: 校验 proposal.md 与 [deploy] section 是否冲突
    alt 提案需要 smoke 且已部署
        C->>S: Step 4: 可选执行 smoke.command
        S-->>C: Step 5: 写入 smoke-results.jsonl
        C->>C: Step 6: 读取 smoke 用例与结果
        C->>C: Step 7: 计算覆盖度和门禁
        C-->>U: Step 8: 写入 smoke-report.md 并输出 Gate
    else 提案无需 smoke、未部署或部署决策冲突
        C-->>U: Step 4: 输出门禁不满足、无需 smoke 或冲突说明
    end
```

## 步骤说明
1. **用户**明确授权运行 smoke。
2. **CLI** 读取提案级部署决策、`tasks.md` 和 `DEPLOY_DONE`。
3. **CLI** 先校验 `proposal.md` 与 `[deploy]` section 是否冲突；冲突时不得进入 smoke。
4. **CLI** 只有在 `smoke_required: true` 且 `DEPLOY_DONE` 存在时才继续；`deployment_progress` 仅用于展示，不替代 `DEPLOY_DONE` 门禁。
5. **Smoke Runner** 写入结果。
6. **CLI** 读取用例与结果。
7. **CLI** 判断 smoke 门禁。
8. **CLI** 输出报告。

## 异常用例
### EX-4.1: 缺少 smoke 用例
- **触发条件**：`logos/resources/test/smoke/` 没有用例。
- **期望响应**：输出错误并退出。

### EX-2.1: 提案无需 smoke
- **触发条件**：活跃提案声明 `smoke_required: false`。
- **期望响应**：不要求运行部署后 smoke，下一步应允许 archive。

### EX-3.1: 部署决策冲突
- **触发条件**：`proposal.md` 与 `tasks.md` 的部署结论不一致。
- **期望响应**：输出冲突警告并拒绝进入 smoke。
