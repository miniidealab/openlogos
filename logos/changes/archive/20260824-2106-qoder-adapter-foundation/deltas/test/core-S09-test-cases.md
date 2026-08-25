## ADDED — S09 Qoder SessionStart 与 PreToolUse hard guard 测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S09-198 | 官方公共字段解析 | 合法 `session_id/cwd/hook_event_name` | 归一化为宿主无关事件，原始字段不进入领域服务 |
| UT-S09-199 | PreToolUse 字段解析 | 合法 `tool_name/tool_input/tool_use_id` | 工具、输入和关联 id 正确映射 |
| UT-S09-200 | 输入 fail-closed | 空/超长/非法 JSON、尾随对象、缺字段、类型错误 | 合法 deny 响应、非空 reason、exit 2，详情进 stderr |
| UT-S09-201 | SessionStart 上下文 | launched 项目有/无 guard | hookEventName 正确，additionalContext 含 slug/阶段/范围/确认点 |
| UT-S09-202 | delta-writing allowlist | 当前提案为 delta-writing | 仅本提案 deltas 与 tasks 写入 allow |
| UT-S09-203 | ready-to-merge 重读 | 同 session 内 tasks 全勾 | 下一次 PreToolUse 立即 deny 后续 delta，提示 merge 确认点 |
| UT-S09-204 | 路径安全 | 源码、提案外、`..`、绝对路径、symlink 逃逸 | 全部 deny，规范化目标不执行 |
| UT-S09-205 | 未知/间接写工具 | 未知工具、Bash 重定向/移动/删除、可疑 MCP | 无法证明只读时 deny，不按 matcher 漏放 |
| UT-S09-206 | Qoder 输出与退出语义 | 共享 allow/deny/异常 | allow=exit0；deny/异常=permissionDecision deny + reason + exit2；exit1 不计通过 |
| UT-S09-207 | stdout/stderr 纪律 | 开启诊断并触发各分支 | stdout 只有一条协议 JSON，日志只在 stderr |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S09-77 | Qoder 新会话上下文 | 真实/仿真 CLI 装载 plugin 后触发 SessionStart | additionalContext 与磁盘 lifecycle/proposal_step 一致；协议字段符合 Qoder |
| ST-S09-78 | 允许 delta、拒绝源码 | delta-writing 下依次请求允许目标与源码写入 | 前者执行；后者 permissionDecision=deny、exit2，源码哈希不变 |
| ST-S09-79 | 同会话状态即时收紧 | 启动后把阶段推进到 ready-to-merge，再请求 delta 写入 | 不使用 SessionStart 缓存，立即 deny；新 session 展示最新上下文 |
| ST-S09-80 | runtime/协议故障闭环 | 缺 runtime、非法 hooks、服务抛错或 stdout 污染 | 安装预检或运行时 fail-closed；任何潜在写工具不执行 |

### 自动化与证据要求

- 合同 fixture 使用 Qoder 官方 snake_case；不得把 ZCode/Claude camelCase 兼容当作 Qoder 权威输入。
- 所有 deny 用例同时断言响应体、permissionDecisionReason、exit code 2 和候选目标 SHA-256；一般非零不能计为 hard deny PASS。
- 内嵌 OpenLogos reporter，将全部 ID 写入 `logos/resources/verify/test-results.jsonl`，字段含 `status`、`timestamp`、`duration_ms`、`scenario: "S09"`，失败含 `error`。
- ST-S09-77～80 的合同层可自动化模拟宿主；真实 Qoder CLI 证据由 SMOKE-core-111～113 复验，二者不可互相替代。
