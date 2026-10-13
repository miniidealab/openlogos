---
title: WorkBuddy 插件
description: OpenLogos 的 WorkBuddy 原生插件——部署位置、Skills/命令/agents、SessionStart 与 PreToolUse hooks、生命周期支持、AGENTS.md 与原生记忆边界。
---

OpenLogos 为 WorkBuddy 提供一个自足的原生插件（CodeBuddy 插件格式）。`openlogos init`、`adopt`、`sync`、`launch` 会把它安装到项目中，并维护根 `AGENTS.md` 中的 OpenLogos 托管片段。Adapter 只负责映射 WorkBuddy 的协议与目录布局，方法论状态机仍由 OpenLogos CLI 负责。

验收所用的宿主版本为 WorkBuddy 5.3.5 及以上。

## 部署内容

执行 `openlogos init --ai-tool workbuddy`（或 `all`）之后：

```
project-root/
├── .workbuddy/
│   └── plugins/
│       └── openlogos/
│           ├── .workbuddy-plugin/
│           │   └── plugin.json        # 插件清单（name: openlogos，version 与 CLI 版本一致）
│           ├── skills/<name>/SKILL.md # OpenLogos 方法论 Skills
│           ├── commands/<name>.md     # OpenLogos 命令（status、next、change、merge、verify 等）
│           ├── agents/change-reviewer.md
│           └── hooks/
│               ├── hooks.json         # SessionStart + PreToolUse
│               ├── runtime.mjs
│               └── runtime.cjs
└── AGENTS.md                          # OpenLogos 托管片段
```

- 所有资产来自 npm 包，安装时不联网下载。
- WorkBuddy 设置与权限（`.workbuddy/settings.json`）以及其他插件**不会被修改**。
- 你放在 `.workbuddy/plugins/openlogos/` 里的额外文件，`sync` 时会保留。
- 目标目录属于其他 owner 或不完整时，部署会停止，不会覆盖。

## 原生记忆边界

WorkBuddy 的原生记忆属于你和宿主。OpenLogos 不读取、不写入、不清空、不导入导出、不迁移原生记忆，也不用它判定权限。OpenLogos 的事实只来自项目磁盘（guard、tasks、资源索引）。

## Hooks

hooks 只在 `hooks/hooks.json` 中注册，不写进 Skill、命令或 agent 的 frontmatter。两个 hook 都执行 `node "${CODEBUDDY_PLUGIN_ROOT}/hooks/runtime.mjs"`：

| Hook | 匹配 | 作用 |
|------|---------|--------------|
| `SessionStart` | `startup\|resume\|clear\|compact\|new` | 注入模块、lifecycle、活跃变更、`proposal_step`、可写范围与下一确认点 |
| `PreToolUse` | 所有工具（含 `write_to_file`、`replace_in_file`、`execute_command`） | 放行或拒绝调用；拒绝时以退出码 2 结束并给出原因 |

WorkBuddy 上没有注册事后检查 hook。

### 写入门禁行为

每次调用都从磁盘重新读取项目状态。静态指令、`SessionStart` 上下文与原生记忆都不构成授权。

- **已知只读工具**（`Read`、`Glob`、`Grep`、`WebFetch`、`WebSearch`、`Task`、`TodoRead`）始终放行；可能写盘的**未知工具**一律拒绝（fail-closed）。
- **initial 生命周期**：写工具不启用硬门禁。
- **launched 模块且无活跃提案**：拒绝文件写入，请先运行 `openlogos change <slug>`。
- **launched 模块且有活跃提案**：按提案步骤放行。编写提案阶段只允许写该提案的 `proposal.md` 与 `tasks.md`；编写 delta 阶段只允许写其 `deltas/**` 与 `tasks.md`；等待 `openlogos merge` 时不允许任何写入；merge 之后允许写项目文件，其他提案目录除外。
- **launched 模块中的 shell 命令**（`Bash` / `execute_command`）：只放行少量单条只读命令：`pwd`、`ls`、`cat`、`sed`、`rg`、`git status|log|diff|show|branch|rev-parse|ls-files`、`openlogos status|next|flow`。命令中含 `;`、`&`、`|`、`>`、`<`、反引号、`$` 或括号时一律拒绝。`openlogos change`、`openlogos merge`、`openlogos verify`、测试与构建等其他命令请你在终端自行执行。
- 输入非法、路径越界、symlink 逃逸与 runtime 异常一律拒绝；退出码 1 不会被当作安全阻断。

## 生命周期支持

| 命令 | 插件变体 | 行为 |
|---------|----------------|----------|
| `init --ai-tool workbuddy` | initial | 全量预检、暂存、读回成功后提交 |
| `adopt --ai-tool workbuddy` | launched | 保留你的已有资产，接入后可直接 `openlogos change` |
| `sync` | 当前 lifecycle | 幂等刷新；全部宿主成功后才写版本戳 |
| `launch` | launched | 全部宿主资产成功后才提交 lifecycle |

任一步失败都会整体回滚，不会留下半套插件、已写的版本戳或已提交的 lifecycle。`init`、`sync`、`launch` 之后请**新建 WorkBuddy session** 以加载刷新后的插件。

## 与 AGENTS.md 的关系

OpenLogos 只维护根 `AGENTS.md` 中的托管片段（`<!-- OPENLOGOS:BEGIN -->` … `<!-- OPENLOGOS:END -->`），片段外内容保持原样。WorkBuddy 是唯一配置的工具时，片段会附带 WorkBuddy 段落：方法论上下文来自插件 Skills / 命令与 `SessionStart`，原生记忆不构成授权，写入权限只由 `PreToolUse` hook 决定。详见 [AGENTS.md](/zh/specs/agents-md)。

## 部署

```bash
openlogos init --ai-tool workbuddy   # 新项目，或为已有项目补齐 WorkBuddy
openlogos sync                       # 升级 CLI 后刷新
```

非交互运行 `init` / `adopt` 时，若设置了 `CODEBUDDY_PLUGIN_ROOT`，会自动选择 `workbuddy`。

## 相关

- [`openlogos init`](/zh/cli/init) 与 [`openlogos sync`](/zh/cli/sync)
- [ZCode 插件](/zh/specs/zcode-plugin) 与 [Qoder 插件](/zh/specs/qoder-plugin)
- [PreToolUse Guard](/zh/specs/pretooluse-guard)
- [AGENTS.md](/zh/specs/agents-md)
