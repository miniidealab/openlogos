---
title: Cursor 插件
description: OpenLogos 如何接入 Cursor（IDE 与 cursor-agent CLI）——.cursor/skills/ 原生 Skills、hooks.json 托管条目，以及带 afterShellExecution 事后检查的部分强度 guard。
---

OpenLogos 通过三类项目级资产接入 Cursor：原生 Agent Skills、change-reviewer subagent，以及 `.cursor/hooks.json` 中的托管条目。Cursor IDE 与 `cursor-agent` CLI 共用同一份项目配置，部署一次两边都生效。Cursor 没有 marketplace 式的插件打包机制，资产直接写入项目目录。

## 部署内容

执行 `openlogos init --ai-tool cursor`（或 `all`）之后：

```
project-root/
├── .cursor/
│   ├── skills/
│   │   ├── prd-writer/SKILL.md           # OpenLogos 方法论 Skills
│   │   ├── change-writer/SKILL.md
│   │   ├── ...
│   │   ├── openlogos-next/SKILL.md       # 命令 Skills（disable-model-invocation: true）
│   │   └── openlogos-merge/SKILL.md
│   ├── agents/
│   │   └── change-reviewer.md            # subagent
│   ├── hooks.json                        # 合并写入 OpenLogos 托管条目
│   └── hooks/
│       ├── openlogos-runtime.cjs         # hook runtime
│       └── openlogos-guard-post.cjs      # 事后检查引擎
└── AGENTS.md                             # 指令文件（OpenLogos 托管片段）
```

| 资产 | 位置 | 说明 |
|-------|----------|-------|
| 方法论 Skills | `.cursor/skills/<name>/SKILL.md` | frontmatter 的 `name` 与目录名一致，`description` 非空；正文语言跟随项目 locale |
| 命令 Skills | `.cursor/skills/openlogos-<command>/SKILL.md` | 带 `disable-model-invocation: true`；用 `/openlogos-next`、`/openlogos-status`、`/openlogos-change`、`/openlogos-merge`、`/openlogos-verify`、`/openlogos-archive` 等显式触发 |
| subagent | `.cursor/agents/change-reviewer.md` | 审查变更提案 |
| hooks | `.cursor/hooks.json` | 四条托管条目，见下文 |
| runtime 与引擎 | `.cursor/hooks/` | 事后检查引擎与 Claude Code 使用的是同一份字节；缺失或漂移时由 `sync` 刷新 |

多文件 Skill 的附属资产（如 `ui-ux-pro-max` 的脚本）仍放在 `logos/skills/`。

**归属**：每个 OpenLogos Skill 目录都带 `.openlogos-managed` 标记。`.cursor/skills/` 下你自己的目录一律不动；如果某个与 OpenLogos Skill 同名的目录已存在且不属于 OpenLogos，部署会在写入任何内容之前停止。

## Hooks

`.cursor/hooks.json` 是共享文件，OpenLogos 不会整文件替换，只增改自己的条目（以命令中含 `openlogos-runtime.cjs` 识别）。你的条目和未知字段字节不变；文件无法解析时部署停止，零写入。

| 事件 | 托管命令 | 用途 |
|-------|-----------------|---------|
| `sessionStart` | `node .cursor/hooks/openlogos-runtime.cjs session` | 注入模块、活跃变更、`proposal_step`、可写范围、下一确认点与待报告项 |
| `beforeShellExecution` | `node .cursor/hooks/openlogos-runtime.cjs shell` | shell 命令事前轻判；命令执行前对受保护内容建立快照 |
| `afterShellExecution` | `node .cursor/hooks/openlogos-runtime.cjs shell-after` | 事后检查：比对命令执行前后的受保护内容 |
| `afterFileEdit` | `node .cursor/hooks/openlogos-runtime.cjs edit` | 越界文件编辑的事后报告 |

在 `afterShellExecution` 出现之前创建的项目，执行一次 `openlogos sync` 即可补齐；重复 `sync` 零 diff。

## Cursor 下的 guard 强度

Cursor 下的 guard 为**部分强度**，OpenLogos 会在 `AGENTS.md` 与 CLI 输出中如实说明：

- **shell 命令**：`beforeShellExecution` 做事前轻判，可确定为受保护目标的写入会被拒绝；`afterShellExecution` 再检查实际发生的变化。发现未立案的受保护改动时会报告，并说明命令已经执行、改动未被阻断，请你核查后按需回滚或先立案。无法当场送达的报告会在下一次 `beforeShellExecution` 或 `sessionStart` 补送。
- **文件编辑**：只经 `afterFileEdit` 事后报告，不会被事前阻断。
- **未接入 `preToolUse`**：OpenLogos 不注册 Cursor 的 `preToolUse`，因此 Cursor 不具备 Claude Code 那样的事前写入硬拦，二者不等价。

保护对象与 Claude Code 一致：launched 模块且无活跃提案时，受保护的是会进入版本控制的代码与规格，被忽略的依赖、构建产物、日志与缓存不受保护。详见 [PreToolUse Guard](/zh/specs/pretooluse-guard)。

**保护范围变更命令**：`openlogos exempt add|remove` 与 `openlogos ignore add|remove` 在 `beforeShellExecution` 中返回 `permission: "ask"`，由 Cursor 对这一次调用弹出审批；复合命令形态一律拒绝。详见 [`openlogos ignore` / `openlogos exempt`](/zh/cli/ignore-exempt)。

`sessionStart` 注入的上下文只是说明信息，不构成写入授权。

## 生命周期支持

| 命令 | Skills / subagent | hooks.json | 旧版 OpenLogos 规则文件迁移 |
|---------|-------------------|------------|-----------------------------------------|
| `init` | 部署 | 合并写入 | 如存在则清理 |
| `adopt` | 部署（冲突预检） | 合并写入 | 如存在则清理 |
| `sync` | 幂等刷新 | 幂等合并 | 清理 |
| `launch` | 按 launched 内容刷新 | 幂等合并 | 如尚未迁移则清理 |

任一步失败时，Skills 目录回滚、`hooks.json` 恢复原样、旧规则文件保留，不会留下半套资产。旧版 OpenLogos 的 Cursor 规则放在另一个位置，迁移方式见 [`sync`：从旧版迁移](/zh/cli/sync#从旧版迁移)。

## 与 AGENTS.md 的关系

Cursor 原生读取根 `AGENTS.md`。当 Cursor 是唯一配置的工具时，OpenLogos 托管片段会列出 `.cursor/skills/` 下的 Skills，并带一行固定的 guard 强度说明，内容即上文的部分强度。托管片段之外的内容不会被改动。详见 [AGENTS.md](/zh/specs/agents-md)。

## 部署

```bash
# 为新项目或已有项目接入 Cursor
openlogos init --ai-tool cursor

# 升级 CLI 后刷新
openlogos sync
```

你的 Cursor 全局配置（`~/.cursor/**`）不会被读取或修改。

## 相关

- [`openlogos init`](/zh/cli/init)：部署 Cursor 资产
- [`openlogos sync`](/zh/cli/sync)：刷新资产并迁移旧布局
- [PreToolUse Guard](/zh/specs/pretooluse-guard)：guard 保护什么、事后检查如何工作
- [AGENTS.md](/zh/specs/agents-md)：托管指令片段
