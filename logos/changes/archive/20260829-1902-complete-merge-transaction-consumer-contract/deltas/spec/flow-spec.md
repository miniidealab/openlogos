## ADDED — Merge transaction action-command parity 与跨仓交接

### 动作映射

flow 只能采用固定映射：submit_content→submit-content、seal→seal、apply→apply、recover→recover、abort→abort。next_action 必须属于 allowed_actions；映射缺失、未知枚举或合同 hash 漂移时进入 contract-invalid，不派发 Agent 或物理命令。

### 前沿

- collecting：派发声明 slot producer 或执行 abort；
- ready：seal 或 abort；
- sealed：apply 或 abort；
- applying/recovery_required：只按 recover 权威恢复；
- completed：以 receipt/外层 artifact hashes 进入 slice 前沿；
- failed/aborted 与普通 fatal failed：终止自动 flow。

重复 abort 和 completed status/apply 是终态幂等读取例外，不改变 action 权威或生成第二完成身份。

### Stacked-change 交接

旧 OpenLogos 提案在主 worktree 保持 smoke-failed；follow-up 在独立 worktree 完成 verify/deploy。RunLogos 回传真实命令后，先消费旧 SMOKE-core-150 并归档旧 slug，再消费 follow-up SMOKE-core-151+ 并归档新 slug，最后合入 master 并复验。禁止复制/删除 guard 或跨 slug 共用 marker。
