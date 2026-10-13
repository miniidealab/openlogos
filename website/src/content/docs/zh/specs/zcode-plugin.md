---
title: ZCode 插件
description: OpenLogos 的 ZCode 原生插件——部署位置、Skills/命令/agents、SessionStart 与 PreToolUse hooks、生命周期支持与根 AGENTS.md。
---

OpenLogos 为 ZCode 提供一个自足的原生插件。`openlogos init`、`adopt`、`sync`、`launch` 会把它安装到项目中，并同时维护根 `AGENTS.md` 中的 OpenLogos 托管片段。

## 部署内容

执行 `openlogos init --ai-tool zcode`（或 `all`）之后：

```
project-root/
├── .zcode/
│   └── plugins/
│       └── openlogos/
│           ├── .zcode-plugin/
│           │   └── plugin.json        # 插件清单（name: openlogos，version 与 CLI 版本一致）
│           ├── skills/<name>/SKILL.md # OpenLogos 方法论 Skills
│           ├── commands/<name>.md     # OpenLogos 命令（status、next、change、merge、verify 等）
│           ├── agents/change-reviewer.md
│           ├── hooks/hooks.json       # SessionStart + PreToolUse
│           └── runtime/hook-runtime.js
└── AGENTS.md                          # OpenLogos 托管片段
```

- 所有资产来自 npm 包，安装时不联网下载。
- 项目的 `.zcode/config.json` **不会被修改**，OpenLogos 也不在其中注册 hooks；用户级 `~/.zcode/AGENTS.md` 同样不动。
- 你放在 `.zcode/plugins/openlogos/` 里的额外文件，`sync` 时会保留。
- 如果 `.zcode/plugins/openlogos/` 已存在其他 owner 的插件或不完整目录，部署会停止，不会覆盖。

## Hooks

`hooks/hooks.json` 注册两个 hook，都由 Node.js 通过 `${ZCODE_PLUGIN_ROOT}/runtime/hook-runtime.js` 执行：

| Hook | 匹配 | 作用 |
|------|---------|--------------|
| `SessionStart` | （全部） | 注入当前 lifecycle、活跃变更、`proposal_step`、允许范围与下一确认点 |
| `PreToolUse` | `Edit\|Write\|MultiEdit\|NotebookEdit\|Bash` | 放行或拒绝写入；拒绝时以退出码 2 结束并给出原因 |

ZCode 上没有注册事后检查 hook。

### 写入门禁行为

每次调用都从磁盘重新读取项目状态，`SessionStart` 注入的上下文不会被当作授权。

- **initial 生命周期**：不启用硬门禁。
- **launched 模块且无活跃提案**：拒绝文件写入，请先运行 `openlogos change <slug>`。
- **launched 模块且有活跃提案**：按提案步骤放行。编写提案阶段只允许写该提案的 `proposal.md` 与 `tasks.md`；编写 delta 阶段只允许写其 `deltas/**` 与 `tasks.md`；delta 完成、等待 `openlogos merge` 时不允许任何写入；merge 之后允许写项目文件，其他提案目录除外。
- **launched 模块中的 shell 命令**：只放行少量只读命令：`pwd`、`ls`、`cat`、`sed`、`rg`、`git status|log|diff|show|branch|rev-parse|ls-files`、`openlogos status|next|flow`。其余命令一律拒绝（fail-closed）。`openlogos change`、`openlogos merge`、`openlogos verify`、测试与构建等命令请你在终端自行执行。
- hook 输入非法、路径越出项目根、symlink 逃逸或 runtime 异常时一律拒绝。

## 生命周期支持

| 命令 | 插件变体 | 行为 |
|---------|----------------|----------|
| `init --ai-tool zcode` | initial | 先预检配置、`AGENTS.md` 与插件目标，再写入 |
| `init --ai-tool zcode`（已初始化项目） | 当前 lifecycle | 只补齐 ZCode，保留其他宿主与你的文件 |
| `adopt --ai-tool zcode` | launched | 接入后可直接 `openlogos change` |
| `sync` | 当前 lifecycle | 幂等刷新；全部宿主成功后才写版本戳 |
| `launch` | launched | 全部宿主资产成功后才提交 lifecycle |

插件目录整体替换。替换失败时恢复原目录；连恢复也失败时保留备份并报告位置，方便你手动移回。

`init`、`sync`、`launch` 之后请**新建 ZCode session**。ZCode 在 session 启动时以快照方式加载插件与 hooks；已有 session 的门禁判定仍按磁盘最新状态执行。

## 与 AGENTS.md 的关系

ZCode 读取根 `AGENTS.md`。OpenLogos 只维护其中的托管片段（`<!-- OPENLOGOS:BEGIN -->` … `<!-- OPENLOGOS:END -->`），片段外内容保持原样。ZCode 是唯一配置的工具时，片段会列出插件中的 Skills，并附带 ZCode 段落：直接读取根 `AGENTS.md` 与插件 Skills，不依赖子目录 AGENTS、include 指令或 `CLAUDE.md`。指令文件只起指导作用，真正的拦截来自 `PreToolUse` hook。详见 [AGENTS.md](/zh/specs/agents-md)。

## 部署

```bash
openlogos init --ai-tool zcode   # 新项目，或为已有项目补齐 ZCode
openlogos sync                   # 升级 CLI 后刷新
```

非交互运行 `init` / `adopt` 时，若设置了 `ZCODE_PLUGIN_ROOT`，会自动选择 `zcode`。

## 相关

- [`openlogos init`](/zh/cli/init) 与 [`openlogos sync`](/zh/cli/sync)
- [Qoder 插件](/zh/specs/qoder-plugin) 与 [WorkBuddy 插件](/zh/specs/workbuddy-plugin)：同一插件模型的宿主
- [PreToolUse Guard](/zh/specs/pretooluse-guard)
- [AGENTS.md](/zh/specs/agents-md)
