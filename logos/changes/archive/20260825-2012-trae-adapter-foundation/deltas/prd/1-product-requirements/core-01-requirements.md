## ADDED — TRAE 国际版/CN non-deployable 需求

### 用户价值与安全底线

OpenLogos 必须如实区分“宿主存在上下文扩展能力”和“宿主可部署 fail-closed hard guard”。在 TRAE 国际版与 CN 未共同证明内置写工具能被项目资产于执行前可靠阻断时，用户不得看到 TRAE 已受支持、可部署或已被 `all` 覆盖的声明，避免软提示被误认为安全边界。

### P02 宿主选择要求

1. `AiToolAdapterRegistry` 不得包含规范 id `trae` 或相关别名；`all` 继续稳定展开现有七个可部署宿主并排除 `other`。
2. CLI 帮助、交互选择、结构化支持列表和未知值错误不得展示 TRAE 为支持项；显式输入 `trae` 必须按未知或不支持宿主 fail loud，且不得写出任何 TRAE 托管资产。
3. 不得创建空 capability、non-deployable 占位 Adapter 或按宿主名写入特殊分支。
4. 既有 Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy 的规范值、稳定顺序、配置兼容和资产行为保持不变。

### 能力与所有权要求

1. TRAE Rules、Skills、自定义 Agent 与 MCP 只视为上下文或扩展能力；不能证明内置 `Write`、编辑或命令工具在执行前受 OpenLogos hard guard 控制。
2. TRAE 原生记忆、settings、账号、用户 Rules/Skills/Agents/MCP、Commands 和未知文件归宿主或用户所有。OpenLogos 不读取正文、不写入、不迁移、不清理，也不将其用作授权状态。
3. 不建立 TRAE `PreToolUse` normalizer、wrapper、模板或共享 `GuardDecisionService` 映射；项目 Hook 文件存在、用户人工确认或 MCP 拒绝均不能替代 hard enforcement。

### 真实客户端门禁与重新开启条件

- TRAE 国际版 `3.5.91` 与 CN `3.3.93` 的真实内置写入均在项目 `PreToolUse` 未执行时改变目标字节，当前能力状态为 **BLOCKED**。
- 未来新提案必须让两个受支持客户端在隔离工作区共同通过完整 fail-closed 矩阵，包括 allow、deny、越界、路径穿越、symlink、未知潜在写工具、损坏输入、runtime 缺失、状态矛盾和超时。
- 每个 deny 均须证明：工具没有执行、非空理由可见、目标 SHA-256 不变；项目级 guard 还须在不静默修改用户信任状态的条件下可部署并可靠启用。

### 版本、部署与非目标

- 目标 OpenLogos 版本为 `0.13.29`；本需求只记录不支持结论，不产生 TRAE 代码或制品。
- 因能力门 BLOCKED，不构建或安装用于 TRAE 的 `0.13.29` staging tarball，不触发 `0.13.28` 回滚，不执行 smoke 或公开发布。
- 不新增 HTTP/RPC/消息 API，不涉及数据库或数据迁移。
