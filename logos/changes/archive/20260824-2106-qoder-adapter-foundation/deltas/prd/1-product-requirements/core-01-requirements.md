## ADDED — Qoder 完整宿主集成需求

### 用户价值

OpenLogos 使用者应能在 `init`、`adopt`、`sync` 与 `launch` 中选择 Qoder，并获得与现有宿主同等级的根指令、Skills、Commands、Agents、SessionStart 阶段上下文和 PreToolUse 写入硬门禁。接入 Qoder 不得要求用户理解宿主分支，也不得改变未选择 Qoder 的历史配置与既有宿主行为。

### P02 公共宿主能力要求

1. AI 工具规范值新增 `qoder`；标量、数组和 `all` 均须支持，`all` 以 Registry 稳定顺序包含 Qoder 且排除 `other`。
2. Qoder capability 必须显式声明 instructions、skills、commands、agents、plugin、sessionStart、preToolUse；生命周期命令只能按能力消费，不得按宿主名推断。
3. Qoder 模板必须随真实 npm tarball 分发；源码树存在但 tarball 缺失任一声明资产时，构建或部署预检失败。
4. 既有 Claude Code、OpenCode、Codex、Cursor、ZCode 的规范值、目标路径、配置合并与输出契约保持兼容；未知值继续 fail loud。

### Qoder 资产与 Hook 协议要求

1. 插件使用 `.qoder-plugin/plugin.json`，并提供 `skills/<name>/SKILL.md`、`commands/**/*.md`、必要 `agents/*.md`、`hooks/hooks.json` 与共享 Node.js runtime；manifest 与约定目录不得造成同一组件重复加载。
2. Hook 命令通过 `QODER_PLUGIN_ROOT` 定位 runtime。OpenLogos 不覆盖 Qoder 用户 settings、不同 identity 插件、未知文件或根 `AGENTS.md` 托管片段外内容。
3. `SessionStart` 输出合法 `hookSpecificOutput`，其中 `hookEventName` 为 `SessionStart`、`additionalContext` 非空并与当前磁盘状态一致。
4. `PreToolUse` 接收 Qoder 官方 `session_id`、`cwd`、`tool_name`、`tool_input` 等字段；allow 输出 `permissionDecision: "allow"`，deny 输出 `permissionDecision: "deny"`、非空 `permissionDecisionReason` 并以 exit 2 阻断。
5. 非法 JSON、缺失必需字段、未知潜在写工具、路径穿越/symlink 逃逸、状态矛盾或决策异常必须 fail-closed；其它非零退出不得被计为安全阻断成功。

### 场景验收条件

#### S01 初始化

- `--ai-tool qoder` 生成配置、根 AGENTS 托管片段和完整 Qoder 插件资产；`--ai-tool all` 包含 Qoder，重复规划幂等。
- 任一模板缺失、manifest 非法、owner 冲突或 marker 残缺时，在覆盖用户资产前失败并报告精确路径。

#### S08 同步

- `sync` 经 Registry 只刷新 OpenLogos 托管的 Qoder 资产，保留 Qoder settings、用户插件和未知文件。
- 只有全部 Adapter 成功后才刷新 `.openlogos-sync.json`；Qoder 暂存、替换或读回失败时回滚且版本戳不变。

#### S09 变更生命周期

- 新 Qoder CLI session 的 SessionStart 注入 module、active change、`proposal_step`、精确可写范围和下一确认点。
- 每次 PreToolUse 重新读取磁盘事实；delta-writing 只允许当前提案 delta/tasks，ready-to-merge 立即收紧，源码、提案外路径和解析异常均 deny。

#### S14 launched 刷新

- `launch` 经 Registry 刷新 Qoder launched 指令、Skills、Commands、Agents 与 Hooks，全部 Adapter 成功后才提交 lifecycle。
- adopted + launched 重复执行幂等；用户 settings、插件和 AGENTS marker 外内容字节不变。

#### S20 存量接入

- `adopt --ai-tool qoder` 在保留既有 AGENTS、Qoder settings 与非 OpenLogos 插件的前提下部署完整资产，并继续直接引导首个 change。
- 冲突或中途失败不得留下半套 logos、插件、配置或伪造接入完成信息。

### 部署与非目标

- 必须由本提案真实 tarball 与真实 Qoder CLI 新 session 在隔离 staging 验证插件发现、Skills/Commands/Agents、SessionStart、PreToolUse allow/deny、sync/launch 幂等和既有宿主回归。
- 不新增 HTTP/RPC/消息 API，不涉及数据库迁移。
- 不实现 TRAE/TraeCode、WorkBuddy 或其它新宿主；不授权 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。
