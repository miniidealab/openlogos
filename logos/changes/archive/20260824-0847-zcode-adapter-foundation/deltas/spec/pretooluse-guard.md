## ADDED — ZCode PreToolUse 兼容层与 fail-closed 契约

### 配置与部署位置

- ZCode Hooks 随 OpenLogos plugin 的标准 `hooks/hooks.json` 自动发现，命令指向同一 plugin 内的共享 Node.js runtime。
- 不向项目 `.zcode/config.json` 写入 Hooks：当前 ZCode 项目级该配置中的 hooks 不作为可靠团队分发入口，且该文件属于用户配置。
- plugin manifest 不重复声明已由标准 `hooks/hooks.json` 自动发现的 Hooks，避免同一事件执行两次。
- Hook 命令通过 `ZCODE_PLUGIN_ROOT` 或等价 plugin root 环境定位随包 runtime，不依赖仓库源码绝对路径。

### 输入归一化

Runtime 从 stdin 读取且只读取一条 JSON 事件。ZCode Adapter 接受官方 camelCase 字段及 Claude 兼容 snake_case alias，并归一化为宿主无关结构：

| 规范字段 | 接受字段 |
|---|---|
| sessionId | `sessionId` / `session_id` |
| hookEventName | `hookEventName` / `hook_event_name` |
| toolName | `toolName` / `tool_name` |
| toolInput | `toolInput` / `tool_input` |
| cwd | `cwd` |

- 同义字段只出现一套时正常接受；两套值深度相等时接受一次；值冲突、类型错误或缺必需字段时 deny。
- `cwd` 和事件内路径只是输入，不是信任根；项目根必须从配置事实解析，所有文件路径 realpath/规范化后再决策。
- Edit/Write/Notebook 等文件工具提取目标路径；Bash/通用命令工具必须识别直接及间接写盘，无法可靠归类的潜在写操作 deny。

### 共享决策与 `proposal_step` allowlist

ZCode Adapter 只做字段、输出和退出码转换，写入授权完全委托共享 Guard Decision Service。服务每次调用重新读取磁盘，不缓存 SessionStart 授权：

| 状态 | 写入规则 |
|---|---|
| initial | 保持既有 initial 规则 |
| launched 无 guard | 源码、规格和其它非安全写入 deny；只读不受影响 |
| writing / ready-to-delta | 仅当前阶段明确许可的 proposal/tasks；GUI 原型例外沿用既有精确路径规则 |
| delta-writing | 仅当前提案 `deltas/**` 与该提案 `tasks.md` 对应勾选写入 |
| ready-to-merge | 停止新增/修改 delta，提示 merge 人类确认点 |
| merge-generated | 仅 MERGE_PROMPT 指定的规格合并范围 |
| coding | 仅已批准切片定义的业务代码、UT/ST、reporter 与对应 tasks |

路径穿越、symlink 逃逸、不同 active slug、guard 与 tasks 状态矛盾均 deny。允许范围不得因为 ZCode 宿主扩大。

### 输出与退出语义

#### 放行

stdout 输出一条合法 Hook JSON，使用 `hookSpecificOutput.permissionDecision: "allow"` 或 ZCode 当前官方等价字段；进程 exit 0。stdout 不得混入日志。

#### 阻断

stdout 输出一条合法 Hook JSON，至少包含 `hookSpecificOutput.permissionDecision: "deny"` 与可操作的 `permissionDecisionReason`；随后 exit 2，确保工具在执行前被硬阻断。

#### 异常

非法 JSON、别名冲突、未知潜在写工具、项目根/guard 解析失败、决策服务异常都按阻断处理。诊断写 stderr，stdout 仍保持协议 JSON。禁止仅以其它非零退出表示安全失败，因为宿主可把一般 Hook 非零视为可恢复故障而继续工具。

### SessionStart 配合

- SessionStart 使用 `hookSpecificOutput.additionalContext` 注入当前 lifecycle、slug、`proposal_step`、允许范围和下一确认点。
- SessionStart 是指导上下文，不是授权凭据；PreToolUse 必须重新读取状态。
- Hook 配置和 plugin 快照按新 session 生效。sync/launch 后输出应提示重开 session，但既有 session 的每次 PreToolUse 仍须按最新磁盘状态收紧。

### 安全验证矩阵

- camelCase、snake_case、相等双字段、冲突双字段。
- allow 路径、源码路径、提案外路径、`..` 穿越、symlink 逃逸、未知写工具。
- 无 guard、delta-writing、ready-to-merge、merge-generated、coding。
- 损坏 stdin、缺 runtime、决策异常、stdout 日志污染。
- 自动化测试必须断言响应体、reason、exit code 与目标哈希；真实 ZCode smoke 复验 allow 和 exit 2 deny。
