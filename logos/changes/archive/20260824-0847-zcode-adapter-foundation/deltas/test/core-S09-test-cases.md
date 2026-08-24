## ADDED — S09 ZCode SessionStart 与 PreToolUse guard 测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S09-188 | 兼容字段归一化 | 仅 camelCase 或仅 snake_case 事件 | 得到同一规范事件与决策输入 |
| UT-S09-189 | 别名冲突 | 两套同义字段值不一致 | fail-closed deny，不任选其一 |
| UT-S09-190 | SessionStart 上下文 | launched 项目有/无 guard | 输出当前 slug、阶段、范围、禁止动作与下一确认点 |
| UT-S09-191 | delta-writing allowlist | 当前提案在 delta-writing | 仅本提案 `deltas/**` 与对应 `tasks.md` 写入可放行 |
| UT-S09-192 | ready-to-merge 收紧 | `[delta]` 已全勾 | 后续 delta 写入 deny，并提示 merge 人类确认点 |
| UT-S09-193 | 缺 guard 阻断 | launched 项目无 guard，请求写源码 | deny 且 reason 明确要求创建提案 |
| UT-S09-194 | 路径/符号链接逃逸 | 表面合法路径解析到 allowlist 外 | deny；目标文件不变 |
| UT-S09-195 | 损坏 JSON | 空输入、非法 JSON、字段类型错误 | stdout 仍为合法 deny 响应并采用 exit 2；详情进 stderr |
| UT-S09-196 | ZCode 输出映射 | 共享决策分别为 allow/deny | 映射为 `permissionDecision`；deny 带 reason 与阻断退出语义 |
| UT-S09-197 | stdout/stderr 纪律 | 开启诊断日志后执行 Hook | stdout 仅一条协议 JSON，日志只写 stderr |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S09-73 | 新会话上下文注入 | 真实/仿真 ZCode 启动新 session，触发 SessionStart | ZCode 获得与磁盘 `proposal_step` 一致的 additionalContext |
| ST-S09-74 | 允许 delta、拒绝源码 | delta-writing 下依次写本提案 delta 和 `src/**` | 前者执行，后者在 PreToolUse 被 exit 2 阻断且源码哈希不变 |
| ST-S09-75 | 阶段变化不使用旧缓存 | 同一 session 内把 tasks 推进到 ready-to-merge 后再次请求 delta 写入 | 决策立即收紧并 deny；新 session 显示最新上下文 |
| ST-S09-76 | Hook 配置/运行时故障 | 缺 runtime、非法 hooks JSON 或决策服务抛错 | 安装预检或运行时 fail-closed；任何写工具均不执行 |

### 自动化与证据要求

- fixture 同时覆盖 `sessionId/session_id`、`hookEventName/hook_event_name`、`toolName/tool_name`、`toolInput/tool_input`。
- deny 用例必须同时断言协议体、reason、exit code 2 和目标文件无变化；不能只断言标准错误。
- 实现测试时必须内嵌 OpenLogos reporter，将本节全部 ID 写入 `logos/resources/verify/test-results.jsonl`，包含 `status`、`timestamp`、`duration_ms`、`scenario: "S09"`，失败含 `error`。
- ST-S09-76 不允许把一般非零退出当成安全阻断成功；必须观察 ZCode 不执行工具。
