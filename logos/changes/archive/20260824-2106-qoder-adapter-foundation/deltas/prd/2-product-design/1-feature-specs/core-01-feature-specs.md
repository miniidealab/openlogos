## ADDED — 2.39 Qoder 薄 Adapter 与原生插件功能规格

### 2.39.1 目标与边界

本功能在既有 `AiToolAdapterRegistry`、`ManagedAssetTransaction`、`SessionContextService` 与 `GuardDecisionService` 上增加 Qoder 薄 Adapter。共享层继续拥有宿主选择、资产事务和 OpenLogos 方法论事实；Qoder 层只拥有插件布局、事件字段、stdout/stderr 与退出码映射。

本功能仅涉及本地 CLI、文件资产和 Hook 子进程协议，不新增远程 API、数据库或后台服务。

### 2.39.2 Qoder capability 与 Registry 语义

- 规范 id：`qoder`；display name：`Qoder`；输入别名不得与现有 Adapter 规范值/别名冲突。
- capability 至少声明 `instructions=true`、`skills=true`、`commands=true`、`agents=true`、`plugin=true`、`sessionStart=true`、`preToolUse=true`。
- 标量/数组解析持久化规范 id；`all` 按 Registry 稳定序新增 Qoder，排除 `other`，去重规则不变。
- 历史配置未选择 Qoder 时不得自动部署；未知值继续返回结构化错误与 Registry 派生的支持列表。

### 2.39.3 原生插件布局

随包模板采用：

```text
qoder-plugin-template/
├── .qoder-plugin/plugin.json
├── skills/<openlogos-skill>/SKILL.md
├── commands/<openlogos-command>.md
├── agents/<openlogos-agent>.md
└── hooks/
    ├── hooks.json
    └── runtime.mjs
```

- `.qoder-plugin/plugin.json` 至少包含合法、稳定的 `name`，版本与 npm 包版本同源；其它元数据和组件声明必须符合 Qoder Plugin Reference。
- 未在 manifest 显式声明的组件由约定目录自动发现；同一路径不得同时以两种方式注册造成重复加载。
- Hook 命令以 `"${QODER_PLUGIN_ROOT}"/hooks/runtime.mjs <event>` 或等价 argv-safe 方式定位 runtime；不得硬编码安装路径。
- 根 `AGENTS.md` 只维护完整 `OPENLOGOS:BEGIN/END` 片段。Qoder settings、其它插件和未知组件不属于 OpenLogos owner。

### 2.39.4 Hook runtime 合同

Qoder 官方事件的公共输入为 snake_case。Adapter 对 `session_id`、`transcript_path`、`cwd`、`hook_event_name` 及事件特有字段执行类型、长度与冲突校验：

1. `SessionStart` 读取 `source`，调用共享上下文服务，stdout 输出一条 JSON：`hookSpecificOutput.hookEventName="SessionStart"` 且 `additionalContext` 非空；exit 0。
2. `PreToolUse` 读取 `tool_name`、`tool_input`，必要时保留 `tool_use_id`，规范化路径后调用共享 guard 服务。
3. allow 输出 `permissionDecision="allow"` 并 exit 0；deny 输出 `permissionDecision="deny"`、非空 `permissionDecisionReason`，同时 exit 2。
4. stdout 只含协议 JSON；诊断写 stderr。非法 JSON、缺字段、未知潜在写工具、项目根/状态解析失败和决策异常必须走显式 deny + exit 2。
5. 其它非零退出在 Qoder 中是非阻断错误，因此不得作为安全失败实现。

### 2.39.5 生命周期行为

| 入口 | Qoder 行为 | 提交条件 |
|---|---|---|
| `init` / `init --ai-tool qoder` | 规划 initial 根指令与完整插件 | 所有目标预检、暂存、读回成功 |
| `adopt --ai-tool qoder` | 直接规划 adopted + launched 变体 | 存量用户资产 preserved，冲突零覆盖 |
| `sync` | 刷新托管资产和当前 lifecycle 文案 | 全部 Adapter 成功后写同步版本戳 |
| `launch` | 刷新 launched Skills/Commands/Agents/Hooks | 全部 Adapter 成功后提交 lifecycle |

### 2.39.6 CLI/IDE 隔离与缓存边界

- 本案以 Qoder CLI 文档、协议和真实 CLI smoke 为验收权威；不得假定 Qoder IDE 暴露完全相同的 Hook 输出结构。
- 插件/Hook 配置刷新后以新 CLI session 验证。`SessionStart` 是指导上下文，不是授权凭据。
- 同一旧 session 内的每次 PreToolUse 仍重新读取磁盘状态并即时收紧；不得缓存 active slug 或 `proposal_step`。

### 2.39.7 错误与兼容体验

- owner 冲突、残缺 marker、非法 manifest/hooks、tarball 缺资产或读回失败均在全局成功前阻断并给出精确路径。
- 结果逐资产区分 `created|updated|unchanged|preserved|blocked`；失败不打印总成功，不写版本戳/lifecycle。
- Claude Code、OpenCode、Codex、Cursor、ZCode 的配置、资产计划和输出结构由 golden/结构化清单回归锁定。

### 2.39.8 验收摘要

- S01：qoder/all 解析、capability、随包模板、冲突保护和原子初始化。
- S08：托管刷新、用户资产保留、回滚、版本戳与幂等。
- S09：SessionStart、PreToolUse allow/deny、exit 2、每次重读与 fail-closed。
- S14：launched 刷新、提交顺序、幂等和既有宿主零漂移。
- S20：存量项目安全接入、配置持久化与 change 可达性。
