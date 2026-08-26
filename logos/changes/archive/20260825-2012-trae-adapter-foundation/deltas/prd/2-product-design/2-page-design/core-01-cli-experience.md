## ADDED — 2.39 TRAE non-deployable CLI 体验

### 2.39.1 支持列表与交互选择

TRAE 国际版/CN capability gate 为 **BLOCKED**。`init` 与 `adopt` 的交互列表继续由 Registry 枚举现有七个 deployable 宿主，不出现 TRAE：

```text
? 选择 AI 工具：
  Claude Code
  OpenCode
  Codex
  Cursor
  ZCode
  Qoder
  WorkBuddy
  Other
  All supported tools
```

`All supported tools` 只展开上述七宿主，不含 `other` 或 TRAE。帮助、completion、机器可读支持列表和文档化示例必须使用同一 Registry 事实源，不得通过静态文案暗示 TRAE 已支持。

### 2.39.2 显式参数错误

`--ai-tool trae` 不被静默忽略、映射为 `other` 或创建占位资产，应在首个目标写入前返回不支持错误：

```text
✗ Unsupported AI tool: trae
Supported tools: claude-code, opencode, codex, cursor, zcode, qoder, workbuddy, other, all
TRAE is not deployable: its real international and CN clients have not passed the fail-closed PreToolUse gate.
No TRAE-managed assets were written.
```

结构化错误须包含原始输入、错误码和由 Registry 派生的支持值；不得泄露本机客户端路径、账号、记忆或用户配置。

### 2.39.3 能力状态说明

当诊断或变更文档展示 TRAE 结论时，应明确区分：

```text
TRAE International: 3.5.91 — hard guard BLOCKED
TRAE CN:            3.3.93 — hard guard BLOCKED
Rules/Skills/Agent/MCP: context capabilities only
Deployable: no
Managed assets: none
```

不得输出“Hooks 可用”“已安装 Rules”或“需要人工确认”等模糊成功语句来替代真实 hard guard 失败。

### 2.39.4 版本与非目标

- 目标 OpenLogos 版本为 `0.13.29`，但不构建或安装 TRAE staging tarball；`0.13.28` 回滚路径未触发。
- 本节只定义 CLI 文本与结构化错误，不生成 TRAE GUI 原型，不修改 TRAE 客户端 UI。
- 成功或错误反馈不得暗示部署、smoke、npm publish、Git tag、GitHub Release、官网部署或 `git push` 已完成。
