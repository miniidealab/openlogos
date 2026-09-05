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

## ZCode PreToolUse 兼容层与 fail-closed 契约

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

## Qoder PreToolUse 字段映射与 fail-closed 契约

### 配置与启动位置

- OpenLogos Qoder plugin 使用约定目录 `hooks/hooks.json` 注册 SessionStart 与 PreToolUse；避免与 manifest 显式声明重复加载。
- command 通过双引号包裹的 `${QODER_PLUGIN_ROOT}` 或等价 argv 形式定位随包 runtime，不依赖源码路径或 shell 当前目录。
- OpenLogos 不覆盖用户 Qoder settings、permissions 或其它插件配置；Hook owner 只限自身 plugin。

### 输入归一化

Runtime 从 stdin 限长读取一个 JSON 对象，Qoder Adapter 接受官方字段并转换为宿主无关事件：

| 内部字段 | Qoder 输入 | 要求 |
|---|---|---|
| sessionId | `session_id` | 非空字符串 |
| hookEventName | `hook_event_name` | 与入口严格一致 |
| cwd | `cwd` | 只作定位输入，不作信任根 |
| toolName | `tool_name` | PreToolUse 必需 |
| toolInput | `tool_input` | PreToolUse 必需对象 |
| toolUseId | `tool_use_id`（若提供） | 仅作关联，不参与授权扩大 |

- 缺失字段、类型错误、超长 stdin、多对象尾随数据或事件名不匹配均 deny。
- 文件工具提取所有候选路径；Bash/命令/MCP 等潜在写工具识别直接和间接写盘。无法可靠证明只读时按写操作评估或 deny。
- 所有路径按项目配置定位根目录，经绝对化、realpath、symlink 和边界检查后交给共享决策。

### 共享 `proposal_step` 决策

Qoder Adapter 不实现 allowlist，只调用共享 `GuardDecisionService`。服务每次 PreToolUse 重读磁盘：

| 状态 | 写入规则 |
|---|---|
| initial | 沿用既有 initial 规则 |
| launched 无 guard | 源码、规格及其它非安全写入 deny |
| writing / ready-to-delta | 仅当前阶段 proposal/tasks 与精确 UI 原型例外 |
| delta-writing | 仅当前提案 `deltas/**` 和该提案 `tasks.md` |
| ready-to-merge | 停止 delta 写入并提示 merge 人类确认点 |
| merge-generated | 仅 MERGE_PROMPT 指定合并目标 |
| coding | 仅批准切片的业务代码、UT/ST、reporter 与 tasks |

不同 active slug、路径穿越、symlink 逃逸、guard/tasks/marker 矛盾和未知 owner 均 deny；Qoder 宿主不得扩大任何阶段范围。

### 输出与退出语义

#### 放行

stdout 输出一条合法 JSON，`hookSpecificOutput.hookEventName="PreToolUse"`、`permissionDecision="allow"`；exit 0。日志只写 stderr。

#### 阻断

stdout 输出同一事件的 `permissionDecision="deny"` 与非空 `permissionDecisionReason`；同时 exit 2。测试必须同时观察协议体、reason、exit code 和目标未变化。

#### 异常

非法 JSON、缺字段、未知潜在写工具、项目根/guard 解析失败或共享服务异常必须捕获并转为协议 deny + exit 2。Qoder 对其它非零退出按非阻断错误处理，因此 exit 1/一般异常不得作为 hard guard 实现或验收证据。

### SessionStart 配合

- SessionStart exit 0 输出 `hookEventName="SessionStart"` 与 `additionalContext`，内容含 lifecycle、slug、`proposal_step`、允许范围和下一确认点。
- SessionStart 是静态指导，不是授权凭据；PreToolUse 必须重读磁盘。
- 插件/Hook 快照刷新后建议新 session，但旧 session 也必须按每次重读的最新事实收紧。

### 安全验证矩阵

- 合法官方输入、缺字段、类型错误、超长/损坏 JSON、错误事件名。
- allow 路径、源码、提案外、`..`、绝对路径、symlink、未知写工具与间接写盘。
- 无 guard、delta-writing、ready-to-merge、merge-generated、coding 与会话内阶段变化。
- allow/deny JSON、stdout 污染、stderr 诊断、exit 0/2/其它非零语义。
- 合同测试与真实 Qoder CLI smoke 均须断言目标哈希；真实 smoke 不得由 wrapper 直调替代。

### 权威参考

- Qoder CLI Hooks：`https://docs.qoder.com/cli/hooks`

## WorkBuddy / CodeBuddy PreToolUse 适配合同

### 配置与启动位置

- OpenLogos WorkBuddy plugin 使用 `hooks/hooks.json` 注册 SessionStart 与 PreToolUse；不得把 Hook 写进 Skill/Command/Agent frontmatter 或重复注册。
- Hook 命令通过双引号包裹的 `${CODEBUDDY_PLUGIN_ROOT}` 或等价 argv-safe 形式定位随包 runtime，不使用虚构变量或仓库源码路径。
- OpenLogos 不覆盖 WorkBuddy settings、permissions、其它插件或原生记忆；Hook owner 仅限自身 plugin identity。

### 输入与工具归一化

Runtime 从 stdin 限长读取一个 JSON 对象，将官方事件字段的 snake_case/camelCase 兼容形态归一化为宿主无关结构。两套同义字段冲突、类型错误、尾随多对象或缺失必需字段时 deny。

| 内部动作 | WorkBuddy/CodeBuddy 工具名示例 | 处理 |
|---|---|---|
| write | `Write`、`write_to_file` | 提取全部候选目标并做路径校验 |
| edit | `Edit`、`replace_in_file` | 同时校验源/目标或所有编辑路径 |
| command | `Bash`、`execute_command` | 分析直接和间接写盘；不能证明只读时按潜在写操作处理 |
| unknown | 未知工具 | 若可能写盘则 fail-closed，不以未识别为 allow |

`cwd` 和输入路径不是信任根。项目根从 OpenLogos 配置事实解析，所有候选经绝对化、realpath、symlink 和边界校验后交给共享服务。

### 共享 `proposal_step` 决策

WorkBuddy Adapter 不实现 allowlist，只调用共享 `GuardDecisionService`。服务每次 PreToolUse 重读 guard、active slug、tasks 与 `proposal_step`：

| 状态 | 写入规则 |
|---|---|
| initial | 沿用既有 initial 规则 |
| launched 无 guard | 源码、规格及其它非安全写入 deny |
| writing / ready-to-delta | 仅当前阶段 proposal/tasks 与既有精确例外 |
| delta-writing | 仅当前提案 `deltas/**` 和对应 `tasks.md` |
| ready-to-merge | 停止 delta 写入并提示 merge 人类确认点 |
| merge-generated | 仅 MERGE_PROMPT 指定合并目标 |
| coding | 仅批准切片的业务代码、UT/ST、reporter 和 tasks |

不同 active slug、路径逃逸、symlink 逃逸、guard/tasks 状态矛盾、未知 owner 和决策异常均 deny；WorkBuddy 宿主不得扩大阶段范围。

### 输出与退出语义

#### 放行

stdout 输出一条合法 JSON，`hookSpecificOutput.hookEventName="PreToolUse"`、`permissionDecision="allow"` 且 `continue=true`；exit 0。日志只写 stderr。

#### 阻断

stdout 输出同一事件的 `permissionDecision="deny"`、`continue=false` 与非空 `permissionDecisionReason`（或官方当前等价 reason 字段）；同时 exit 2。测试必须同时观察响应、reason、退出码和目标未变化。若具体宿主版本对 `continue` 与 hard deny 的组合有额外约束，以“工具绝不执行”为不变量，并在真实 WorkBuddy 5.3.5+ capability probe 中锁定实际协议。

#### 异常

非法/超限 JSON、缺字段、未知潜在写工具、项目根/状态解析失败或共享服务异常必须捕获并转为协议 deny + exit 2。exit 1 或未结构化异常不得作为 hard guard 成功证据。

### SessionStart 配合与记忆隔离

- SessionStart exit 0，输出 `hookEventName="SessionStart"` 与非空 `additionalContext`，内容来自磁盘 lifecycle、slug、`proposal_step`、范围和下一确认点。
- SessionStart 不读取 WorkBuddy 原生记忆，也不是授权凭据；PreToolUse 每次重读磁盘。
- 插件/Hook 刷新后以新 session 验证；旧 session 的下一次 PreToolUse 仍必须按最新事实收紧。

### 安全验证矩阵

- CLI/桌面工具名、snake_case/camelCase、相等双字段、冲突字段。
- allow、源码、提案外、`..`、绝对路径、symlink、未知工具与间接写盘。
- 无 guard、delta-writing、ready-to-merge、merge-generated、coding 与同会话阶段变化。
- 损坏 stdin、runtime/状态异常、stdout 污染、exit 0/2/其它非零。
- UT/ST 与真实 WorkBuddy 5.3.5+ smoke 均断言目标哈希；直接调用 wrapper/runtime 不替代真实宿主。

### 权威参考

- CodeBuddy Hooks：`https://www.codebuddy.cn/docs/cli/hooks`
- CodeBuddy Permissions：`https://www.codebuddy.cn/docs/cli/permissions`
- WorkBuddy Changelog（5.3.5 扩展插件 Hook）：`https://www.codebuddy.cn/docs/workbuddy/Changelog`

## TRAE PreToolUse 非适配与 hard guard 排除合同

### 当前合同状态

OpenLogos 当前没有 TRAE 国际版或 TRAE CN 的可依赖 PreToolUse 映射。国际版 `3.5.91` 与 CN `3.3.93` 的真实内置写入都在项目 `.trae/hooks.json` 拒绝脚本未运行时改变目标文件，因此不得为 TRAE 声明 SessionStart/PreToolUse 支持、协议 normalizer、wrapper 或共享 guard 绑定。

### 不得替代 hard guard 的能力

以下能力只能提供上下文、扩展或人工安全提示，不能成为 OpenLogos 写入授权边界：

- Rules、Skills、自定义 Agent 或 prompt 中的“禁止写入”指令；
- MCP 工具自身的拒绝，因为它不能证明 TRAE 内置 `Write`、编辑或命令工具受控；
- Hooks UI、配置文件存在、客户端二进制字符串或 wrapper 直接调用成功；
- 用户人工确认、工作区 trust/`enabled_folders` 状态或原生记忆中的约定。

OpenLogos 不得静默修改工作区信任状态以激活项目命令，也不得读取 TRAE 原生记忆、账号、settings 或用户资产来推断权限。

### Registry 与运行时约束

1. `AiToolAdapterRegistry` 不登记 `trae`，共享 `GuardDecisionService` 不接受 TRAE 专有事件或工具名映射。
2. 不生成 `.trae/hooks.json`、runtime、manifest、托管 Rules/Skills/Agents/MCP 或其它 guard 资产。
3. `init`、`adopt`、`sync`、`launch` 和 `all` 不得因探测到 TRAE 安装而自动写入资产。
4. 显式选择 `trae` 必须在目标写入前按未知/不支持宿主失败，并保持现有 `.trae/**` 字节不变。

### 未来 PASS 的最低证据

重新评估须由国际版与 CN 的受支持版本分别通过真实宿主矩阵，而不是仅调用 Hook 脚本：

| 类别 | 必须证明的行为 |
|---|---|
| allow | 合法范围内真实工具执行，结果和协议可审计 |
| deny | 真实工具不执行、非空理由、目标 SHA-256 不变 |
| 路径 | 工作区外、`..`、绝对路径、symlink 逃逸均在执行前拒绝 |
| 工具 | 内置写/编辑/命令及未知潜在写工具均覆盖 |
| 异常 | 非法/超限输入、解析失败、runtime 缺失、状态矛盾、超时全部 fail-closed |
| 启用 | 项目资产可可靠启用，且不由 Adapter 静默篡改用户信任状态 |

任一客户端或任一异常路径 fail-open，结论均保持 BLOCKED。只有未来独立提案通过完整矩阵后，才能定义 TRAE 工具名、输入字段、stdout/stderr、退出码与共享决策映射。

## Cursor hooks 部分强度门禁适配合同

### 适用范围与强度声明

Cursor 宿主经 `.cursor/hooks.json` 接入 OpenLogos 写入门禁。与 ZCode / Qoder / WorkBuddy 的完整 PreToolUse 硬拦不同，**cursor-agent CLI 不提供 `preToolUse` 事件**，Cursor 适配为部分强度组合（Registry capability 声明 `preToolUse: false`，capability honesty，D09）：

| 事件 | 强度 | 语义 |
|---|---|---|
| `beforeShellExecution` | **硬拦** | shell 途径的潜在写入在执行前判定；deny 即阻断 |
| `afterFileEdit` | **事后检测** | 宿主原生编辑完成后判定；越界产出检测报告，不能撤销编辑 |
| `preToolUse`（仅 Cursor IDE） | 硬拦（宿主自身行为） | IDE 读取同一 `hooks.json` 自然生效；OpenLogos 不为 IDE 维护第二份配置、不探测宿主形态 |

任何面向用户的表述（CLI 反馈、AGENTS.md 托管段、根规范）必须如实声明 CLI 侧为部分强度，禁止表述为与 claude-code 等价。

### 事件字段归一化

Cursor hook 经 stdin 传入 JSON（snake_case：`hook_event_name`、`workspace_roots`、`conversation_id` 等）。适配层归一化为共享 GuardDecisionService 的统一输入：

- `beforeShellExecution`：取命令文本走既有 Bash 命令判定路径（含安全白名单，如 `openlogos *`、非 push 的 `git *`、`git push`）。
- `afterFileEdit`：取编辑目标路径走既有文件路径判定路径。
- 路径判定复用本规范既有白名单规则与 proposal_step 范围收敛逻辑，`.cursor/**` 白名单行同时覆盖 Skills 与 hooks 托管资产的 sync 写入。

### 判定与输出契约

- 每次事件调用重新读取 guard 文件与提案状态，无缓存；判定逻辑与其他宿主共用同一 GuardDecisionService，Cursor 适配层只做字段转换。
- `beforeShellExecution` allow：输出 `{"permission": "allow"}`，退出码 0。
- `beforeShellExecution` deny：输出 `{"permission": "deny", "user_message": "<事实+恢复动作>", "agent_message": "<同上>"}`，退出码 2；原因必须包含 active change、proposal_step、允许范围、目标路径与下一步动作。
- `afterFileEdit` 越界：stdout 输出检测报告（编辑路径、允许范围、固定声明「本次编辑未被阻断（cursor-agent CLI 无 preToolUse），请核查并按需回退」）；范围内静默。
- 报告不得伪装成阻断；deny 不得缺原因。

### fail-closed 契约

| 异常 | shell 路径行为 | 编辑路径行为 |
|---|---|---|
| stdin 不可解析 | deny（退出码 2） | 产出「无法安全判断」报告 |
| guard 缺失但提案目录存在 | deny，提示先运行 `openlogos change` | 产出报告 |
| 提案状态文件损坏 / 决策服务异常 | deny | 产出「无法安全判断」报告 |

任何异常路径不得静默放行 shell 写入，不得静默吞掉编辑检测；退出码不得伪装成功。

### 部署与幂等

- 托管条目由 `init` / `adopt` / `sync` / `launch` 合并写入 `.cursor/hooks.json`（`version: 1`）：只增改 OpenLogos 托管条目（以托管 command 路径识别），保留用户条目与未知字段；文件不可解析 fail loud 零写入；重复执行零 diff。
- 卸载 / 回滚只移除托管条目。
- 完整资产布局与 hooks.json 合并算法见 `spec/cursor-plugin.md`。
