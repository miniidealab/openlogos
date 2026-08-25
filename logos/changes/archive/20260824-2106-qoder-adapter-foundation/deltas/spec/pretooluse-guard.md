## ADDED — Qoder PreToolUse 字段映射与 fail-closed 契约

### 配置与启动位置

- OpenLogos Qoder plugin 使用约定目录 `hooks/hooks.json` 注册 SessionStart 与 PreToolUse；避免与 manifest 显式声明重复加载。
- command 通过双引号包裹的 `${QODER_PLUGIN_ROOT}` 或等价 argv 形式定位随包 runtime，不依赖源码路径或 shell 当前目录。
- OpenLogos 不覆盖用户 Qoder settings、permissions 或其它插件配置；Hook owner 只限自身 plugin。

### 输入归一化

Runtime 从 stdin 限长读取一个 JSON 对象，Qoder Adapter 接受官方字段并转换为宿主无关事件：

| 内部字段 | Qoder 输入 | 要求 |
|---|---|---|
| sessionId | `session_id` | 非空字符串 |
| hookEventName | `hook_event_name` | 与入口严格一致 |
| cwd | `cwd` | 只作定位输入，不作信任根 |
| toolName | `tool_name` | PreToolUse 必需 |
| toolInput | `tool_input` | PreToolUse 必需对象 |
| toolUseId | `tool_use_id`（若提供） | 仅作关联，不参与授权扩大 |

- 缺失字段、类型错误、超长 stdin、多对象尾随数据或事件名不匹配均 deny。
- 文件工具提取所有候选路径；Bash/命令/MCP 等潜在写工具识别直接和间接写盘。无法可靠证明只读时按写操作评估或 deny。
- 所有路径按项目配置定位根目录，经绝对化、realpath、symlink 和边界检查后交给共享决策。

### 共享 `proposal_step` 决策

Qoder Adapter 不实现 allowlist，只调用共享 `GuardDecisionService`。服务每次 PreToolUse 重读磁盘：

| 状态 | 写入规则 |
|---|---|
| initial | 沿用既有 initial 规则 |
| launched 无 guard | 源码、规格及其它非安全写入 deny |
| writing / ready-to-delta | 仅当前阶段 proposal/tasks 与精确 UI 原型例外 |
| delta-writing | 仅当前提案 `deltas/**` 和该提案 `tasks.md` |
| ready-to-merge | 停止 delta 写入并提示 merge 人类确认点 |
| merge-generated | 仅 MERGE_PROMPT 指定合并目标 |
| coding | 仅批准切片的业务代码、UT/ST、reporter 与 tasks |

不同 active slug、路径穿越、symlink 逃逸、guard/tasks/marker 矛盾和未知 owner 均 deny；Qoder 宿主不得扩大任何阶段范围。

### 输出与退出语义

#### 放行

stdout 输出一条合法 JSON，`hookSpecificOutput.hookEventName="PreToolUse"`、`permissionDecision="allow"`；exit 0。日志只写 stderr。

#### 阻断

stdout 输出同一事件的 `permissionDecision="deny"` 与非空 `permissionDecisionReason`；同时 exit 2。测试必须同时观察协议体、reason、exit code 和目标未变化。

#### 异常

非法 JSON、缺字段、未知潜在写工具、项目根/guard 解析失败或共享服务异常必须捕获并转为协议 deny + exit 2。Qoder 对其它非零退出按非阻断错误处理，因此 exit 1/一般异常不得作为 hard guard 实现或验收证据。

### SessionStart 配合

- SessionStart exit 0 输出 `hookEventName="SessionStart"` 与 `additionalContext`，内容含 lifecycle、slug、`proposal_step`、允许范围和下一确认点。
- SessionStart 是静态指导，不是授权凭据；PreToolUse 必须重读磁盘。
- 插件/Hook 快照刷新后建议新 session，但旧 session 也必须按每次重读的最新事实收紧。

### 安全验证矩阵

- 合法官方输入、缺字段、类型错误、超长/损坏 JSON、错误事件名。
- allow 路径、源码、提案外、`..`、绝对路径、symlink、未知写工具与间接写盘。
- 无 guard、delta-writing、ready-to-merge、merge-generated、coding 与会话内阶段变化。
- allow/deny JSON、stdout 污染、stderr 诊断、exit 0/2/其它非零语义。
- 合同测试与真实 Qoder CLI smoke 均须断言目标哈希；真实 smoke 不得由 wrapper 直调替代。

### 权威参考

- Qoder CLI Hooks：`https://docs.qoder.com/cli/hooks`
