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
| ~~`git push`~~ | ~~远程推送~~（过时：见下方澄清，`git push` 实际已在 Bash 命令安全白名单内、guard 始终放行，不属被阻断写操作） |

**例外**：如果写入目标在文件路径白名单内，仍然放行。

**澄清（`git push` 始终放行）**：`git push` 实际已在 guard-check 的 Bash 命令安全白名单内（`BASH_SAFE_PATTERNS` 含 `^git push`），guard **从不拦截 `git push`**——上表把 `git push` 列为被阻断写操作属过时描述，已划除。因此全自动 / 无人值守模式**无需任何 marker 或 guard 例外**即可自动 `git push`；是否自动推送的唯一约束来自生成的指令文本（AGENTS.md/CLAUDE.md）：全自动下指令文本授权 AI 自动 push，半自动 / 手动下要求人工确认。

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

## plan 阶段写入 allowlist（GUI 原型路径例外）

本节定义 guard 在 **plan 阶段**对 GUI 项目 UI 原型路径的**受限放行**规则。它是既有「文件路径白名单」（§白名单规则）之上、
**仅在 plan 阶段生效且仅针对单一原型路径**的窄例外，服务于 UI-first 特性「把 UI/UX 原型确认前移到批准提案门」。

### 背景与动机

UI-first 特性要求：对已 `launched` 的 GUI 产品项目，当本次提案「动了界面」（`ui_impact:true`）时，
change-writer 在 **plan 阶段**（`plan-exit` 门**之前**）就用 ui-ux-pro-max 产出界面原型，
**原型直接作为 page-design delta 写入** `deltas/prd/2-product-design/2-page-design/core-NN-<slug>.html`。

但 SessionStart 上下文注入与既有流程口径要求 **plan 阶段不得写 delta**（`writing` / `ready-to-delta` 分支注入
"Do not write deltas or source code yet"）。若 guard 一律阻断 plan 阶段的 `deltas/**` 写入，则原型无法在门前产出，
UI-first 的核心价值不成立。因此需要一处**精确、最小**的写入例外。

### allowlist 规则（仅放行原型路径）

在 plan 阶段（提案 `proposal_step ∈ {writing, ready-to-delta}`，即 `PLAN_APPROVED` marker 尚不存在时），
guard 对 Edit/Write 目标路径与 Bash 写入操作目标应用以下判定：

| 目标路径 | plan 阶段行为 | 原因 |
|----------|--------------|------|
| `deltas/prd/2-product-design/2-page-design/*.html` | **放行** | UI-first 原型：GUI 项目在 plan-exit 门前产出的 page-design 原型 delta（`write-ui-prototype` 节点产物） |
| 其余 `deltas/**`（含 `deltas/spec/**`、`deltas/prd/**` 的非原型路径、`.md` 规格 / skill delta 等） | **禁止**（有 guard 时按提案范围、无匹配则阻断） | 规格 / skill delta 属 `spec` subflow 的 `write-delta` 节点产物，须在 `plan-exit` 之后（门后）产出 |

- **仅放行叶子原型 `.html`**：allowlist **只**匹配 `2-page-design/` 目录下的 `*.html` 原型文件；该目录下 `.html` 以外的路径、
  以及 `2-page-design/` 之外的任何 `deltas/**` 路径，在 plan 阶段均**不因本例外放行**。
- **提案目录 `design-system.json`（ui-ux-pro-max 令牌）** 落在 `logos/changes/<slug>/` 提案目录下，已被既有
  `logos/changes/**` 白名单（§文件路径白名单）覆盖，**无需本例外额外放行**。
- **plan 阶段之外不受本例外影响**：`plan-exit` 门放行（`PLAN_APPROVED` 存在）后进入 `spec` / 后续阶段，
  `deltas/**` 的写入按既有 guard 规则（有活跃 guard 文件 → 放行）处理，本节的 plan 阶段窄例外不再介入。
- **非 GUI 项目 / `ui_impact:false`**：不产出原型、不触发本路径写入；本例外对其**无任何影响**（流程零改动）。

### 授权链（producer 写入无新授权）

- producer = **change-writer**（由 driver 在 plan 节点派发），其原型写入的**授权即来自本 plan 阶段 allowlist**——
  越界路径（非 `2-page-design/*.html`）在 plan 阶段仍被 guard 拒。
- 该授权与「写 `proposal.md` / `tasks.md`」的门前普通内容生成**同级**：**不新增门、不新增确认标记、不新增独立授权**。
  唯一人类确认点仍是 `plan-exit`。
- 即：**producer 的原型写入由此 allowlist 授权，无新授权**——guard 从「一律禁写 plan 阶段 delta」放宽为
  「plan 阶段仅放行原型路径」，这是唯一的授权来源。

### 三处口径一致（单一放行边界）

本 allowlist 与另外两处 UI-first 例外**共享完全相同的路径边界**（`deltas/prd/2-product-design/2-page-design/*.html`），
不得各自定义不同的放行范围：

1. **F1 ordering 例外**（`spec/flow-spec.md`）：`flow-derive` 仅当出现**非原型的规格 delta**、或 `plan-exit` 已放行时
   才视为进入 spec 阶段；ordering 例外**仅限** `2-page-design/*.html` 叶子原型。
2. **SessionStart `writing` / `ready-to-delta` 分支注入的 GUI + `ui_impact` 例外**（源模板 `plugin/bin/openlogos-phase`
   与 `plugin-codex/session-start.sh`）：注入文本加「GUI 项目 + 本次触及 UI 时，允许在 plan 阶段产出 page-design 原型 delta
   （`deltas/prd/2-product-design/2-page-design/*.html`）；其余 delta 仍禁于 plan 阶段」。
3. **本 guard plan 阶段写入 allowlist**：工具执行层**硬性**只放行同一路径。

三者构成「指令层告知（SessionStart）+ 派生层不误判（flow-derive）+ 执行层硬放行（guard）」的一致边界。
**任一处的放行范围收窄或放宽，另两处必须同步**——否则出现「指令允许但 guard 拦」或「guard 放行但被 flow-derive 误判进入 spec」
的口径分裂。

### [code] 触点（本 delta 只定契约）

- `plugin/bin/guard-check` 与其 sync 部署副本 `.claude/openlogos/bin/guard-check` 落实「plan 阶段写入 allowlist
  仅放行 `2-page-design/*.html` 原型路径」的判定（改源、sync 分发部署副本，对齐 dogfooding 铁律）。
- plan 阶段的判定依据（`proposal_step` / `PLAN_APPROVED` 存在性）沿用既有派生，不新增状态源。
- guard 的其余判定逻辑（§判定逻辑：initial 全放行 → guard 文件存在放行 → 白名单）与既有 Bash 安全白名单
  （含 `^git push` 始终放行，见 §白名单规则「`git push` 始终放行」澄清）**均保持不变**，本节仅在 plan 阶段叠加此单一原型路径例外。
