# PreToolUse Guard Hook 规格

> 版本：1.0.0
>
> 本文档定义 OpenLogos 的 Claude Code PreToolUse guard hook 机制。该 hook 在 AI 调用 Edit/Write/Bash 工具前执行，硬性拦截无提案的代码修改操作。

## 概述

OpenLogos 的变更管理要求 `launched` 生命周期的项目在修改代码前必须创建变更提案（`openlogos change <slug>`）。此前该规则仅通过 CLAUDE.md 文本约束和 SessionStart hook 提示词注入来"提醒"，AI 可以无视。

PreToolUse guard hook 将该规则从"提醒"升级为"拦截"：在工具层面硬性阻断，AI 物理上无法在没有提案的情况下修改代码。

## 触发条件

Claude Code 的 `PreToolUse` hook 在以下工具调用前触发：

| 工具 | matcher |
|------|---------|
| Edit | 文件编辑 |
| Write | 文件写入 |
| Bash | Shell 命令执行 |

配置于 `.claude/settings.json`：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/openlogos/bin/guard-check"
          }
        ]
      }
    ]
  }
}
```

## 输入格式

hook 从 stdin 接收 JSON：

```json
{
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/absolute/path/to/file.ts",
    "old_string": "...",
    "new_string": "..."
  }
}
```

对于 Bash 工具：

```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "sed -i 's/foo/bar/' src/index.ts"
  }
}
```

## 判定逻辑

```
┌─────────────────────────────────────────┐
│ 1. 读取 logos/logos-project.yaml        │
│    所有模块 lifecycle 均为 initial?      │
│    → YES: exit 0（放行，不受限）         │
│    → NO: 继续检查                       │
├─────────────────────────────────────────┤
│ 2. 检查 logos/.openlogos-guard          │
│    文件存在?                            │
│    → YES: exit 0（有活跃提案，放行）     │
│    → NO: 继续检查白名单                 │
├─────────────────────────────────────────┤
│ 3. 检查白名单                           │
│    目标文件/命令在白名单内?              │
│    → YES: exit 0（豁免，放行）           │
│    → NO: exit 2（阻断）                 │
└─────────────────────────────────────────┘
```

## 白名单规则

### 文件路径白名单（Edit/Write 工具）

以下路径的文件始终允许修改，无论 guard 文件是否存在：

| 路径模式 | 原因 |
|----------|------|
| `logos/changes/**` | 提案目录本身（创建提案时需要写入） |
| `logos/.openlogos-guard` | guard 文件本身（CLI 写入） |
| `logos/logos-project.yaml` | 项目索引（CLI 和 Skill 写入） |
| `.gitignore` | 版本控制配置 |
| `README.md` / `README.*.md` | 项目说明文件 |
| `CLAUDE.md` | AI 指令文件（sync 写入） |
| `AGENTS.md` | AI 指令文件（sync 写入） |
| `opencode.json` | OpenCode 配置（sync 写入） |
| `.claude/**` | Claude Code 插件目录（sync 写入） |
| `.opencode/**` | OpenCode 插件目录（sync 写入） |
| `.codex-plugin/**` | Codex 插件目录（sync 写入） |
| `.cursor/**` | Cursor 规则目录（sync 写入） |
| `logos/skills/**` | Skills 目录（sync 写入） |
| `logos/spec/**` | 规格目录（sync 写入） |

### Bash 命令白名单

以下命令模式始终允许执行：

| 模式 | 原因 |
|------|------|
| `openlogos *` | OpenLogos CLI 命令 |
| `git *`（非 push） | Git 操作（查看状态、提交等） |
| `npm test` / `vitest` / `jest` | 测试命令 |
| `npm run build` / `npm run dev` | 构建命令 |
| `ls` / `cat` / `find` / `grep` / `head` / `tail` | 只读命令 |
| `cd` / `pwd` / `echo`（无重定向） | 无副作用命令 |
| `node -e` / `python3 -c`（无文件写入） | 计算命令 |

### Bash 写入操作检测模式

以下模式被视为文件写入操作，在无 guard 时阻断：

| 模式 | 说明 |
|------|------|
| `>` / `>>` | 重定向写入 |
| `sed -i` | 原地编辑 |
| `tee` | 写入文件 |
| `mv` / `cp` / `rm` / `mkdir -p` | 文件系统修改 |
| `chmod` / `chown` | 权限修改 |
| `npm install` / `npm uninstall` | 依赖修改 |
| `git push` | 远程推送 |

**例外**：如果写入目标在文件路径白名单内，仍然放行。

## 输出格式

### 放行（exit 0）

无输出或输出空 JSON：

```json
{}
```

### 阻断（exit 2）

输出 JSON 到 stdout，包含阻断原因：

```json
{
  "reason": "⛔ 变更管理拦截：项目处于 launched 生命周期，但没有活跃的变更提案。请先运行 `openlogos change <slug>` 创建提案后再修改代码。"
}
```

Claude Code 会将 reason 展示给 AI，AI 会据此调整行为（创建提案）。

## 部署方式

guard-check 脚本由 `openlogos init` / `openlogos sync` 自动部署到 `.claude/openlogos/bin/guard-check`，并自动更新 `.claude/settings.json` 中的 PreToolUse hook 配置。

部署条件：
- `aiTool` 包含 `claude-code` 或为 `all`
- 项目已初始化（`logos/logos.config.json` 存在）

## 与现有机制的关系

| 机制 | 层级 | 作用 |
|------|------|------|
| CLAUDE.md 文本约束 | 提示词 | 告知 AI 规则（可被无视） |
| SessionStart hook | 会话开始 | 注入上下文提醒（可被无视） |
| **PreToolUse guard hook** | **工具执行前** | **硬性拦截（无法绕过）** |

三层机制互补：CLAUDE.md 让 AI "知道"规则，SessionStart 让 AI "记住"当前状态，PreToolUse 让 AI "无法违反"规则。
