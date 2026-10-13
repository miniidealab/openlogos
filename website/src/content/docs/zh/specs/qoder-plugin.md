---
title: Qoder 插件
description: OpenLogos 的 Qoder CLI 原生插件——部署位置、Skills/命令/agents、SessionStart 与 PreToolUse hooks、生命周期支持，以及作为静态记忆的 AGENTS.md。
---

OpenLogos 为 Qoder CLI 提供一个自足的原生插件。`openlogos init`、`adopt`、`sync`、`launch` 会把它安装到项目中，并维护根 `AGENTS.md` 中的 OpenLogos 托管片段，Qoder CLI 会把该文件作为静态记忆读取。

本集成以 Qoder CLI 为验收对象，不覆盖 Qoder IDE 的 hook 行为。

## 部署内容

执行 `openlogos init --ai-tool qoder`（或 `all`）之后：

```
project-root/
├── .qoder/
│   └── plugins/
│       └── openlogos/
│           ├── .qoder-plugin/
│           │   └── plugin.json        # 插件清单（name: openlogos，version 与 CLI 版本一致）
│           ├── skills/<name>/SKILL.md # OpenLogos 方法论 Skills
│           ├── commands/<name>.md     # OpenLogos 命令（status、next、change、merge、verify 等）
│           ├── agents/change-reviewer.md
│           └── hooks/
│               ├── hooks.json         # SessionStart + PreToolUse
│               ├── runtime.mjs
│               └── runtime.cjs
└── AGENTS.md                          # OpenLogos 托管片段（静态记忆）
```

- 所有资产来自 npm 包，安装时不联网下载。
- Qoder 设置（`.qoder/settings.json`）、用户级 `~/.qoder/AGENTS.md`、`AGENTS.local.md`、`.qoder/rules/**` 与其他插件**不会被修改**。
- 你放在 `.qoder/plugins/openlogos/` 里的额外文件，`sync` 时会保留。
- 目标目录属于其他 owner 或不完整时，部署会停止，不会覆盖。

## Hooks

`hooks/hooks.json` 注册两个 hook，都以单一参数形式执行 `node "${QODER_PLUGIN_ROOT}/hooks/runtime.mjs"`，路径含空格也不受影响：

| Hook | 匹配 | 作用 |
|------|---------|--------------|
| `SessionStart` | `startup\|resume\|clear\|compact\|new` | 注入当前 lifecycle、活跃变更、`proposal_step`、允许范围与下一确认点 |
| `PreToolUse` | 所有工具 | 放行或拒绝调用；拒绝时以退出码 2 结束并给出原因 |

Qoder 上没有注册事后检查 hook。

### 写入门禁行为

每次调用都从磁盘重新读取项目状态，`SessionStart` 上下文与 `AGENTS.md` 都不会被当作授权。

- **已知只读工具**（`Read`、`Glob`、`Grep`、`WebFetch`、`WebSearch`、`Task`、`TodoRead`）始终放行；可能写盘的**未知工具**一律拒绝（fail-closed）。
- **initial 生命周期**：写工具不启用硬门禁。
- **launched 模块且无活跃提案**：拒绝文件写入，请先运行 `openlogos change <slug>`。
- **launched 模块且有活跃提案**：按提案步骤放行。编写提案阶段只允许写该提案的 `proposal.md` 与 `tasks.md`；编写 delta 阶段只允许写其 `deltas/**` 与 `tasks.md`；等待 `openlogos merge` 时不允许任何写入；merge 之后允许写项目文件，其他提案目录除外。
- **launched 模块中的 shell 命令**：只放行少量单条只读命令：`pwd`、`ls`、`cat`、`sed`、`rg`、`git status|log|diff|show|branch|rev-parse|ls-files`、`openlogos status|next|flow`。命令中含 `;`、`&`、`|`、`>`、`<`、反引号、`$` 或括号时一律拒绝。`openlogos change`、`openlogos merge`、`openlogos verify`、测试与构建等其他命令请你在终端自行执行。
- 输入非法、路径越界、symlink 逃逸与 runtime 异常都会转换为拒绝并以退出码 2 结束。Qoder 把其他非零退出码视为非阻断错误，OpenLogos 不依赖它们。

## 生命周期支持

| 命令 | 插件变体 | 行为 |
|---------|----------------|----------|
| `init --ai-tool qoder` / `all` | initial | 全量预检后写入 |
| `adopt --ai-tool qoder` / `all` | launched | 保留已有资产，接入后可直接 `openlogos change` |
| `sync` | 当前 lifecycle | 幂等刷新；全部宿主成功后才写版本戳 |
| `launch` | launched | 全部宿主资产成功后才提交 lifecycle |

插件目录整体替换，失败时恢复原目录。`init`、`sync`、`launch` 之后请**新建 Qoder CLI session** 以加载刷新后的插件快照；已有 session 的门禁判定仍按磁盘最新状态执行。

## 与 AGENTS.md 的关系

Qoder CLI 把根 `AGENTS.md` 作为静态记忆加载。OpenLogos 只维护其中的托管片段（`<!-- OPENLOGOS:BEGIN -->` … `<!-- OPENLOGOS:END -->`），片段外内容保持原样。托管片段是自含的，包含语言策略、Why → What → How、delta / guard 规则、reporter 要求与人类确认点，不依赖子目录记忆或 Qoder rules 被加载。Qoder 是唯一配置的工具时，片段会附带指向插件 Skills 的 Qoder 段落。静态记忆只起指导作用，真正的拦截来自 `PreToolUse` hook。详见 [AGENTS.md](/zh/specs/agents-md)。

## 部署

```bash
openlogos init --ai-tool qoder   # 新项目，或为已有项目补齐 Qoder
openlogos sync                   # 升级 CLI 后刷新
```

非交互运行 `init` / `adopt` 时，若设置了 `QODER_PLUGIN_ROOT`，会自动选择 `qoder`。

## 相关

- [`openlogos init`](/zh/cli/init) 与 [`openlogos sync`](/zh/cli/sync)
- [ZCode 插件](/zh/specs/zcode-plugin) 与 [WorkBuddy 插件](/zh/specs/workbuddy-plugin)
- [PreToolUse Guard](/zh/specs/pretooluse-guard)
- [AGENTS.md](/zh/specs/agents-md)
