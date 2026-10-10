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

**`.gitignore` 移出白名单（guard-versioned-content-scope，C14）**：`.gitignore` 决定哪些内容进入版本控制，而 guard 以「是否进入版本控制」为保护判据，它本身就是保护范围的来源。继续放在白名单内，AI 可以先把源码目录写进 `.gitignore`，再在被忽略的范围内写代码，绕开整个门禁。因此 `.gitignore`（任意层级）不再属于白名单；它与 `.git/info/exclude`、`core.excludesFile` 指向的项目内文件一起，按 §版本控制内容保护与事后检查（规范性）「受保护判定」第 4 步受保护。`.gitignore` 托管区块只由经人类确认的 `openlogos ignore` 与按已确认配置重渲染的 `openlogos sync` 写入。本条在 git 判据生效与非 git 回落两种模式下都适用（回落时保护 `.gitignore` 只会更保守）。

**reference 与基线 staging 改由 `guard.exempt` 表达**：`logos/resources/reference` 及其后代、`logos/resources/verify/baseline-seed-runs/<run_id>/staging` 及其后代不再是硬编码白名单项，改为 `logos.config.json` 中 `guard.exempt` 的内置默认值（缺省时生效，用户可增删）。缺省配置下放行范围与匹配约束与原 R-REF / R-STAGING 逐项一致，见 §资料目录与基线 staging 默认路径豁免（规范性）与 §版本控制内容保护与事后检查（规范性）「guard.exempt 与内置默认」。

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

**按段匹配（verify-smoke-guard-fixes-0-15-20，决策 C04）**：本表是**逐段**匹配的模式——非 git 回落时，复合命令先按顶层分隔符拆段（见 §Bash 非 git 回落的复合命令逐段判定），只有**每一段**都命中本表才凭白名单放行。`cd` 在本表内只表示「该段无副作用」，它改变的工作目录会影响后续写入段相对目标的解析（同节「有效工作目录」）。单条命令的匹配结果不变。

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

**例外**：命中写入模式不直接等于阻断——写入目标经路径提取后逐一走文件路径白名单与管辖边界判定（见 §Bash 写命令路径提取与逐路径管辖判定）：全部目标在项目根之外或白名单内仍然放行；解析不出目标的形态维持无条件阻断（fail-closed）。

**按段匹配**：非 git 回落时本表同样逐段匹配，模式不再只锚定整条命令的开头——`true; rm src/x` 的第二段命中 `rm`，按该段做路径提取与逐路径管辖判定。命令替换、反引号、进程替换与 heredoc 中出现本表模式时按解析不出阻断（见 §Bash 非 git 回落的复合命令逐段判定）。

**澄清（`git push` 始终放行）**：`git push` 实际已在 guard-check 的 Bash 命令安全白名单内（`BASH_SAFE_PATTERNS` 含 `^git push`），guard **从不拦截 `git push`**——上表把 `git push` 列为被阻断写操作属过时描述，已划除。因此全自动 / 无人值守模式**无需任何 marker 或 guard 例外**即可自动 `git push`；是否自动推送的唯一约束来自生成的指令文本（AGENTS.md/CLAUDE.md）：全自动下指令文本授权 AI 自动 push，半自动 / 手动下要求人工确认。

## 输出格式

### 放行（exit 0）

无输出或输出空 JSON：

```json
{}
```

### 阻断（exit 2）

**双通道输出（fix-guard-check-external-path-and-stderr）**：Claude Code 对 PreToolUse hook 的 exit 2 **读取 stderr** 展示拦截原因；stdout JSON 仅旧协议向后兼容。阻断时必须同时输出两个通道：

stdout 输出 JSON（结构与字面内容保持不变，旧协议宿主零影响）：

```json
{
  "reason": "⛔ 变更管理拦截：项目处于 launched 生命周期，但没有活跃的变更提案。请先运行 `openlogos change <slug>` 创建提案后再修改代码。"
}
```

stderr 同步输出同一 reason 的可读文本（`printf '%b\n' "$msg" >&2` 等价写法，`\n` 转义按可读换行展开）。

任何阻断路径（含 Step 0 fail-closed）不得出现「exit 2 但 stderr 为空」的形态——否则 Claude Code 侧只显示 "No stderr output"，可操作指引整体丢失。

Claude Code 会将 stderr 中的 reason 展示给 AI，AI 会据此调整行为（创建提案）。

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

Cursor 宿主经 `.cursor/hooks.json` 接入 OpenLogos 写入门禁。与 ZCode / Qoder / WorkBuddy 的完整 PreToolUse 硬拦不同，Cursor 适配为部分强度组合（Registry capability 声明 `preToolUse: false`，capability honesty，D09）。强度只按 OpenLogos **已接入且实测**的事件声明；宿主支持某事件，不代表插件已经接入（guard-versioned-content-scope，C11）：

| 事件 | 强度 | 语义 |
|---|---|---|
| `beforeShellExecution` | **事前轻判** | 保护范围变更受限命令返回 `permission: ask`（宿主能否保证弹出审批以实测为准，不能保证则 deny；两种模式均适用）；launched、git 可用时：能确定写入目标且目标受保护 → deny；其余 allow，并为事后检查拍快照。非 git 回落时沿用既有 shell 判定（安全白名单先判、写入模式、解析不出即阻断） |
| `afterShellExecution` | **事后检查** | 与 Claude Code 共用同一事后检查引擎对比执行前后的受保护内容；反馈能否注入 agent、能否阻断后续以真实宿主实测为准，实测证明之前按事后报告（observe-only）声明 |
| `afterFileEdit` | **事后检测** | 宿主原生编辑完成后按「受保护判定」判定；越界产出检测报告，不能撤销编辑 |
| `preToolUse` | **未接入** | OpenLogos 不在 `.cursor/hooks.json` 注册 `preToolUse`（`CURSOR_HOOK_EVENTS` 不含该事件）。Cursor IDE 与 cursor-agent CLI 的文件编辑**均**只有 `afterFileEdit` 事后报告，不承诺事前阻断。「Cursor IDE 经同一 hooks.json 获得完整 preToolUse 硬拦」的旧表述与实际接线不符，已撤销；IDE preToolUse 接线另行立案 |

分两层承诺：

1. **保护对象一致**：Cursor 与 Claude Code 对同一路径、同一 git 状态给出相同的「是否受保护」结论（共享判据与同一组测试向量）。
2. **阻断能力按已接入事件声明**：上表即全部承诺。任何面向用户的表述（CLI 反馈、AGENTS.md 托管段、根规范、`cursor-adapter.ts` 托管文案）必须如实声明 Cursor（IDE 与 CLI）下写入门禁为部分强度，禁止表述为与 claude-code 等价，禁止宣称 IDE 存在 OpenLogos 的事前编辑硬拦。

### 事件字段归一化

Cursor hook 经 stdin 传入 JSON（snake_case：`hook_event_name`、`workspace_roots`、`conversation_id`、`generation_id` 等）。适配层归一化为共享 GuardDecisionService 的统一输入：

- `beforeShellExecution`：取命令文本。launched、git 可用且无活跃提案时走 §版本控制内容保护与事后检查（规范性）「Bash / PowerShell 判定顺序」的事前轻判，并调用事后检查引擎 `snapshot`；非 git 回落时走既有 Bash 命令判定路径（含安全白名单，如 `openlogos *`、非 push 的 `git *`、`git push`）。保护范围变更受限命令在任何模式下先于其他判定识别。
- `afterShellExecution`：取命令文本与调用关联标识，调用事后检查引擎 `check`。
- `afterFileEdit`：取编辑目标路径。launched、git 可用时走「受保护判定」；非 git 回落时走既有文件路径判定路径。
- 调用关联标识：优先使用宿主输入中唯一标识单次 shell 调用的字段；宿主只提供 `generation_id` 时，以 `generation_id` + 命令文本 SHA-256 作为关联键，仅当真实宿主实测证明同一 generation 内不会并发执行字面相同的命令时才可采用；否则按匿名记录处理，不按「最近一次」猜测关联（匿名记录的生命周期见 §版本控制内容保护与事后检查（规范性）「执行记录生命周期」）。实测采用的字段名记录在 `spec/cursor-plugin.md` 与 smoke 报告中。
- 路径判定复用本规范既有白名单规则与 proposal_step 范围收敛逻辑，`.cursor/**` 白名单行同时覆盖 Skills 与 hooks 托管资产的 sync 写入。

### 判定与输出契约

- 每次事件调用重新读取 guard 文件、提案状态与 `logos.config.json` 的 `guard` 配置，无缓存；判定逻辑与其他宿主共用同一 GuardDecisionService 与同一事后检查引擎（部署副本 `.cursor/hooks/openlogos-guard-post.cjs`，与 `plugin/bin/guard-post-check.cjs` 字节一致），Cursor 适配层只做字段转换。
- `beforeShellExecution` allow：输出 `{"permission": "allow"}`，退出码 0。存在待报告项且宿主经实测会把 allow 时的 `agent_message` 送达 agent 时，可附带 `agent_message` 送达待报告项，不改变 allow 结论。
- `beforeShellExecution` deny：输出 `{"permission": "deny", "user_message": "<事实+恢复动作>", "agent_message": "<同上>"}`，退出码 2；原因必须包含 active change、proposal_step、允许范围、目标路径与下一步动作。
- `beforeShellExecution` 遇保护范围变更受限命令（`openlogos exempt add|remove`、`openlogos ignore add|remove`）：输出 `{"permission": "ask", "user_message": "<完整命令原文与影响说明>", "agent_message": "<该命令修改 guard 保护范围，需用户在宿主审批中确认>"}`，由宿主弹出审批；宿主不支持 `ask`，或在自动运行等模式下不能保证弹出审批（以真实宿主实测为准）时按 deny 处理。受限命令的复合形态（`cd` 前缀之外与其他命令组合）一律 deny。
- `afterShellExecution`：发现受保护变化时，输出与 §版本控制内容保护与事后检查（规范性）「反馈内容与送达渠道」同内容的检测报告；宿主是否把该输出注入 agent、退出码是否能阻断后续，以真实宿主实测为准，实测证明之前报告固定声明「本次 shell 命令已执行，以下改动未被阻断，请核查并按需回滚或先立案」。无变化时静默。
- `afterFileEdit` 越界：stdout 输出检测报告（编辑路径、允许范围、固定声明「本次编辑未被阻断（OpenLogos 未接入 Cursor preToolUse），请核查并按需回退」）；范围内静默。
- 报告不得伪装成阻断；deny 不得缺原因。

### fail-closed 契约

| 异常 | shell 前置路径（`beforeShellExecution`）行为 | shell 后置路径（`afterShellExecution`）行为 | 编辑路径行为 |
|---|---|---|---|
| stdin 不可解析 | deny（退出码 2） | 产出「无法安全判断」报告 | 产出「无法安全判断」报告 |
| guard 缺失但提案目录存在 | deny，提示先运行 `openlogos change` | 照常对比并报告 | 产出报告 |
| 提案状态文件损坏 / 决策服务异常 | deny | 产出「无法安全判断」报告 | 产出「无法安全判断」报告 |
| 事后检查引擎缺失或 node 无法执行引擎 | 按非 git 回落判定（既有 shell 判定，解析不出即阻断），并提示运行 `openlogos sync` | 产出「事后检查不可用」报告 | 按非 git 回落判定 |
| git 查询失败（launched、git 判据生效中） | 目标按受保护处理；无法拍快照时按非 git 回落判定 | 产出「无法安全判断」报告，记录保持打开 | 目标按受保护处理 |

任何异常路径不得静默放行 shell 写入，不得静默吞掉编辑或 shell 事后检测；退出码不得伪装成功。

### 部署与幂等

- 托管条目由 `init` / `adopt` / `sync` / `launch` 合并写入 `.cursor/hooks.json`（`version: 1`）：只增改 OpenLogos 托管条目（以托管 command 路径识别），保留用户条目与未知字段；文件不可解析 fail loud 零写入；重复执行零 diff。
- 卸载 / 回滚只移除托管条目。
- 完整资产布局与 hooks.json 合并算法见 `spec/cursor-plugin.md`。

## Claude 宿主项目根定位与部署合同（fix-claude-guard-hook-project-dir-and-sync-deploy）

### hook 注册形态（规范性）

`.claude/settings.json` 中 OpenLogos 自有 hook 的 command **必须**使用 Claude Code 官方项目根环境变量：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/openlogos/bin/guard-check" }
        ]
      }
    ]
  }
}
```

SessionStart 同形态（`node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/openlogos-phase-launcher.cjs"` 等价写法）。本节取代早前配置示例中的相对路径 command 形态——相对形态在非项目根 cwd 会话下不可解析，属缺陷而非可选写法。

matcher 覆盖面（fix-windows-platform-compat）：`MultiEdit` 与 `NotebookEdit` 是与 `Edit` / `Write` 同类的文件写入工具，此前未被 matcher 覆盖、写入绕过 guard；`PowerShell` 为 Windows 版 Claude Code 的 shell 工具，按 shell 写入路径判定（见 §Claude Code guard 跨平台可移植性与输入 fail-closed（规范性））。PowerShell 工具名以实施时 Claude Code 实际 hook 输入的 `tool_name` 核实为准；matcher 中列出一个宿主当前不存在的工具名不产生副作用。

幂等注册判据必须同时识别新旧两种写法：旧相对路径条目升级迁移为新形态（不并存、不重复）；旧 matcher（`Edit|Write|Bash`）的 OpenLogos 托管条目同样原地升级为新 matcher，不新增第二条；用户自有 hooks 条目字节保真。

### 工作目录收敛与 fail-closed（规范性）

guard-check 在一切文件判定之前收敛工作目录：

1. `CLAUDE_PROJECT_DIR` 在场：`cd` 至该目录；`cd` 失败 → exit 2 + 可读 reason（stdout JSON 与 stderr 双通道，见 §阻断（exit 2））。
2. 变量缺失（旧版 Claude Code 兼容窗口）：cwd 存在 `logos/logos.config.json` 才按 cwd 判定；否则 exit 2 + 可读 reason（同上双通道）。
3. **禁止**把「无法确定项目根」落入「非 OpenLogos 项目 → exit 0」分支——该分支的前提是已确认某个项目根且其下无 `logos/logos.config.json`。
4. 收敛后既有判定合同逐项不变：lifecycle 判定、`logos/.openlogos-guard` 存在性、`BASH_SAFE_PATTERNS` 白名单、Edit/Write 绝对路径 realpath 归一化、阻断 reason 结构与 exit 2 语义。
5. 两处 fail-closed 的诊断输出与常规阻断同一双通道合同：stdout `{"reason":...}` JSON + stderr 可读文本，不得只写 stdout（fix-guard-check-external-path-and-stderr）。

### sync 部署合同（规范性）

guard 资产为 `openlogos sync` 托管资产面成员（不再仅 init/adopt 部署）：

- `guard-check` bin：asset-manifest 登记版本化哈希，缺失/漂移即落盘刷新（与 skills/AGENTS.md 同一机制）；
- PreToolUse hook 注册：复用上文幂等迁移语义。

存量项目（guard 功能上线前 init）升级 CLI 后一次 `openlogos sync` 必须补齐硬闸；重复 sync 幂等零变化。非 Claude 宿主项目不部署、不触碰 settings.json。

## 管辖边界（项目根之外路径放行，规范性）

guard 的保护目标是**本项目源码的变更可追溯性**，管辖范围止于项目根。`is_whitelisted_path` 在白名单前缀匹配**之前**先判管辖：

1. **归一化路径判定**：python3/node 归一化产出的 `rel_path` 为 `..` 或以 `../` 开头 → 目标位于项目根之外 → **放行**（return 0，不进入白名单匹配与阻断分支）。
2. **bash 兜底判定**：python3/node 均不可用时的前缀剥离分支，对绝对路径先判是否位于 `$(pwd)/` 之下；不在 → 放行。
3. **裁决权归属**：项目根之外的写入（用户级 `~/.claude/projects/**` 记忆文件、其他仓库、系统临时目录）由宿主自身权限系统裁决；guard 不拦截、不告警、不越权代管。
4. **覆盖面**：Edit/Write 的 `file_path` 判定与 Bash 写入命令的重定向目标判定复用同一函数，管辖边界一致生效；plan 阶段原型 allowlist 的 delta 前缀匹配天然不命中项目外路径，行为不变。
5. **不变量**：项目根之内的判定逐项不变——白名单前缀表、Bash 安全/写入模式、plan 阶段 allowlist、exit 2 阻断合同均保持。管辖边界收窄不构成安全弱化：项目内硬闸零变化，项目外本就不属 guard 保护目标。

## Bash 写命令路径提取与逐路径管辖判定（规范性）

§管辖边界确立了「项目根之外的写入交宿主权限系统」，并要求 Bash 写入命令的目标判定复用 `is_whitelisted_path` 获得同一边界。本节把该要求从「重定向目标」扩展为**路径实参级合同**——修复此前 `rm`/`cp`/`mv`/`mkdir`/`touch`/`chmod`/`chown` 类命令因不提取路径实参而无条件拦截、致管辖边界结构性不可达的缺陷（fix-guard-check-bash-write-target-jurisdiction）。

### 判定顺序（不变）

1. `BASH_SAFE_PATTERNS` 安全白名单（含 `^git push`）**先判**，命中即放行——优先级不变；
2. `BASH_WRITE_PATTERNS` 写入模式匹配，命中进入路径提取与逐路径判定；
3. 未命中任何模式的未知命令默认放行（现行行为不变）。

### 路径提取规则

命中写入模式后按命令形态提取写入目标：

| 命令形态 | 提取规则 |
|---|---|
| `rm` / `mkdir` / `touch` / `chmod` / `chown` | 跳过以 `-` 开头的选项 flag 后，取**全量路径实参** |
| `cp` / `mv` | 跳过选项 flag 后，取**全量实参（含源与目标）** |
| `>` / `>>` 重定向 | 既有 `WRITE_TARGET` 提取保持不变 |
| 其它写模式（`sed -i`、`tee`、`writeFileSync` 等）与解析不出的形态 | 不提取，维持现行无条件阻断 |

**解析不出（fail-closed 边界）**：命令含变量展开（`$VAR`）、命令替换（`$(…)`/反引号）、管道或复合形态（`|`、`&&`、`;`）等无法确定全部路径实参时，**维持现行无条件阻断**，不做部分提取后放行；guard 不实现完整 shell 解析器，解析能力之外一律保守。

### 逐路径管辖判定（放行判据）

每个提取出的路径逐一走既有 `is_whitelisted_path`（含 §管辖边界的项目外放行与白名单前缀匹配）：

- **全部路径均在项目根之外或白名单内** → 放行（exit 0）；项目外路径由宿主权限系统裁决，guard 不越权代管。
- **任一路径在项目根之内且非白名单** → 阻断（exit 2，`block()` 双通道 stdout JSON + stderr 可读指引保持）。

### 三运行时一致

路径提取产物统一交给 `is_whitelisted_path`；其 python3 归一化、node 归一化与 bash 兜底三条路径对同一路径**必须同判**（bash 兜底对绝对路径按 `$(pwd)/` 前缀判管辖）。提取逻辑本身不依赖 python3/node 可用性。

### 不变量

- 项目根之内的拦截/放行判定逐项不变：`WHITELIST_PREFIXES` 前缀表、`BASH_SAFE_PATTERNS`/`BASH_WRITE_PATTERNS` 模式表、拦截文案与 stderr 双通道、plan 阶段原型 allowlist、exit 2 阻断合同均保持。
- 管辖边界收窄不构成安全弱化：任一项目内非白名单路径命中即拦截；解析不出不放宽；硬闸保护面（本项目源码）零收窄。
- Edit/Write 分支判定不因本节改变。

### [code] 触点（本 delta 只定契约）

- `plugin/bin/guard-check` 与其 sync 部署副本 `.claude/openlogos/bin/guard-check` 落实路径提取与逐路径管辖判定（改源、sync 分发部署副本，对齐 dogfooding 铁律；guard-check 为 asset-manifest 托管资产，随 0.14.24 发布刷新存量项目字节）。
- 其它宿主适配层（zcode/qoder/workbuddy/cursor）合同独立成文，不在本节范围。

## 资料目录与基线 staging 默认路径豁免（规范性）

来源变更 fix-guard-reference-baseline-staging-whitelist。launched 且无活跃提案时，guard 此前拦截两类本不属于「本项目源码 / 规格变更」的正常输入，造成流程自相矛盾：

- **参考资料**：信息架构把 `logos/resources/reference/` 定义为需求素材、待办、代码片段、图片、临时资料与笔记的存放处，维护它不改变任何规格或源码，却被要求先建提案；
- **基线 staging**：`spec/logos-project.md` 与 S33 规定 AI 在 `begin` 之后把逆向产物写入 `baseline-seed-runs/<run_id>/staging/`、再由 `baseline-seed commit` 校验提交；guard 拦截该写入，逼用户手改白名单或建临时提案。

本节把两类路径纳入内置默认豁免，**不新增配置开关、白名单管理命令、审批标记或 run 状态解析**。

### 匹配规则（按规范化相对路径的完整目录段）

判定对象为 `is_whitelisted_path` 既有归一化产出的项目根相对路径 `rel_path`（管辖边界判定在前，项目外路径已先行放行）。新增两条规则：

| 规则 | 命中条件 |
|---|---|
| R-REF | `rel_path` 恰为 `logos/resources/reference`，或以 `logos/resources/reference/` 开头 |
| R-STAGING | `rel_path` 按 `/` 切段后：前 4 段恰为 `logos` / `resources` / `verify` / `baseline-seed-runs`；第 5 段为 `<run_id>`，满足既有 run_id 标识符约束 `^[A-Za-z0-9][A-Za-z0-9._-]*$` 且不含 `..`；第 6 段恰为 `staging`；其后可有 0 个或多个后代段 |

两条规则共同的保守约束：

1. **完整段匹配**：R-REF 以「恰等于目录」或「目录 + `/`」判定，`reference-evil`、`references` 不命中；R-STAGING 逐段相等比较，`staging-backup`、`staging.old` 不命中。
2. **单层 run_id**：缺 run_id（`baseline-seed-runs/staging/...` 中 `staging` 被当作 run_id 时，第 6 段须再为 `staging` 才命中）、多层伪 run 路径（`baseline-seed-runs/a/b/staging/...`）不命中。
3. **点段与空段不命中**：`rel_path` 中任一段为 `.`、`..` 或空段（`//`）时，两条新规则**均不命中**，按原规则判定。python3/node 归一化已消去点段；bash 兜底分支不做词法归一化，此约束保证兜底只会更保守、不会更宽松。
4. **符号链接不放宽**：python3/node 归一化解析最深已存在祖先的真实路径；reference 或 staging 下指向项目内其他位置的符号链接按解析后的真实路径判定，不因入口位于豁免目录而放行。

### 仍受保护的相邻路径（launched 无提案时照常 exit 2）

| 路径 | 原因 |
|---|---|
| `baseline-seed-runs/<run_id>/run.json` | run 记录（含签发 nonce），仅 CLI 写入 |
| `baseline-seed-runs/<run_id>/commit-journal.json` | 提交日志，事务恢复依据 |
| `baseline-seed-runs/<run_id>/resolved/**` | commit 对账后的最终内容，恢复用 |
| `baseline-seed-runs/<run_id>/backup/**` | 提交前备份，回滚用 |
| `baseline-seed-runs/<module>.commit.lock` 及 run 根目录其它文件 | 模块提交锁与 CLI 受控状态 |
| `logos/resources/verify/` 下 staging 之外的一切（`test-results.jsonl`、`baseline-events.jsonl`、验收报告等） | 验收证据与审计账本 |
| `logos/resources/` 下 reference 之外的正式规格（PRD、API、DB、测试规格等）与源码 | 变更可追溯性的保护对象 |

begin 所需的逻辑计划 manifest 放在已豁免的 `logos/resources/reference/temp/` 等位置即可，**不为此开放 run 根目录**。正式基线的唯一写入入口仍是 `baseline-seed commit`（begin/commit 校验、nonce 核对、事务恢复与锁均不变）。

### Bash 写入复用

- Bash 重定向目标（既有 `WRITE_TARGET` 提取）与 `rm`/`cp`/`mv`/`mkdir`/`touch`/`chmod`/`chown` 路径实参（§Bash 写命令路径提取与逐路径管辖判定）均经 `is_whitelisted_path` 判定，自动获得两条新规则，无需另写分支。
- 逐路径判定语义不变：**全部**提取路径均在项目外或白名单内才放行；混合目标中任一路径为项目内非白名单（如 `cp logos/resources/reference/a.md src/a.md`）→ 阻断。
- 解析能力不扩展：对**未先命中 `BASH_SAFE_PATTERNS`、进入写模式检查**的命令，变量展开、命令替换、管道、复合命令、`sed -i`/`tee`/`writeFileSync` 等不提取目标的形态维持现行无条件阻断（如 `tee logos/resources/reference/a.md`、`sed -i ... logos/resources/reference/a.md`）；正常文件产出优先使用 Edit/Write。
- `BASH_SAFE_PATTERNS` 先判的优先级不变：命中安全模式的命令（如以 `echo ` 开头的 `echo x | tee logos/resources/reference/a.md`）在写模式与路径提取之前即放行，本节不改变该既有行为，也不以新增阻断规则覆盖它。

### 三运行时一致（函数层合同）

本条约束对象是 **`is_whitelisted_path` 函数**的三条归一化分支：对不含点段 / 空段的输入，python3 归一化、node 归一化与 bash 兜底三条分支对两条新规则**必须同判**（放行集合与阻断集合一致）；对含点段的原始输入，bash 兜底允许比 python3/node 更保守（不命中新规则），不得更宽松。

**测试层级**：完整 hook 读取 `tool_name` / `tool_input` 与解析模块 lifecycle 依赖 python3 或 node（既有行为，本案不改）；两者均不可用时 hook 在到达路径判定前即按既有逻辑返回，**本案不承诺完整 hook 在无 python3 / node 环境下可工作**，也不为此扩展 hook 的无运行时 JSON / YAML 解析能力。因此：bash 兜底分支的一致性在函数层验证（加载分发源中的真实 `WHITELIST_PREFIXES` 与 `is_whitelisted_path`，在受控 PATH 下调用，不得另写规则副本）；调用完整 hook 的用例限定在 python3 或 node 可用的环境。

### 不变量

- 既有 `WHITELIST_PREFIXES` 前缀表、`BASH_SAFE_PATTERNS` / `BASH_WRITE_PATTERNS`、管辖边界、plan 阶段原型 allowlist、有活跃提案时的放行语义、拦截文案与 stderr 双通道、exit 2 合同均不变。
- 不放开整个 `logos/resources/`、`logos/resources/verify/` 或 `baseline-seed-runs/`。

### [code] 触点（本 delta 只定契约）

- 改分发源 `plugin/bin/guard-check`（`is_whitelisted_path` 内在前缀表匹配后追加两条规则）；`.claude/openlogos/bin/guard-check` 等托管副本经既有 init / sync 与资产 manifest 分发获得，不作为独立事实源手改。
- 其它宿主适配层（zcode/qoder/workbuddy/cursor）若复用同一 guard 判定则随之生效；各自合同不在本节改写范围。

## Claude Code guard 跨平台可移植性与输入 fail-closed（规范性）

来源变更 fix-windows-platform-compat。约束依据见架构文档「五十二、Windows 平台兼容约束」52.1 / 52.4 / 52.5。本节约束分发源 `plugin/bin/guard-check`（及同源的 `plugin/bin/openlogos-phase` 中对应的输入与探测逻辑）；托管副本经既有 init / sync 与资产 manifest 分发获得。

### 缺陷形态

Windows 上 guard-check 读取 `tool_name` 的两条路径同时失效：`python3` 常为可被 `command -v` 发现、但运行即失败的微软商店占位别名；node 分支读 `/dev/stdin`，Windows 版 Node 解析为 `<盘>:\dev\stdin` 而 ENOENT。两步皆败时 `TOOL_NAME` 为空，落入「其它工具一律放行」分支——**launched 项目无活跃提案时 Edit / Write / Bash 全部放行，且无任何报错**。即使 python 可用，原生 Windows 下 `os.path.relpath` / `path.relative` 产出的相对路径为 `\` 分隔，与 `/` 前缀白名单及 plan 阶段 delta 收窄前缀比较，造成误拦与收窄失效。

### 输入解析（规范性）

1. **node 为主路径**：以 `node -e` 解析 hook 输入 JSON，stdin 以 `require('fs').readFileSync(0, 'utf-8')` 读取；**禁止**读取 `/dev/stdin`。node 是 OpenLogos 运行前提，正常环境下该路径必然可用。
2. **Python 仅在真实可执行时使用**：候选依次 `python3` → `python` → `py -3`，以执行 `-c "import sys"` 退出 0 为可用判据；**禁止**以 `command -v python3` 作为可用判据，**禁止** `if command -v python3 … elif node …` 这种「探测为真即不再尝试 node」的结构。探测结果在一次 hook 调用内复用。
3. `tool_name`、`tool_input.file_path`、`tool_input.notebook_path`、`tool_input.command`、`ACTIVE_SLUG` 等全部字段读取走同一解析实现，不得各自一套探测。

### 输入不可解析时 fail-closed（规范性）

- stdin 非空、但所有可用解析路径均无法得到 `tool_name`（JSON 非法、解析器全部不可用、字段缺失）时：**exit 2**，reason 说明「guard 无法解析 hook 输入，写入门禁无法判定」并提示检查 node 是否可用；输出遵循 §阻断（exit 2）双通道合同（stdout JSON + stderr 可读文本）。
- 本条取代 §资料目录与基线 staging 默认路径豁免「三运行时一致（函数层合同）」中「本案不承诺完整 hook 在无 python3 / node 环境下可工作」的边界表述在**结论**上的含义：无运行时时 hook 仍不承诺放行任何写入，而是 fail-closed；该节关于 `is_whitelisted_path` 三分支同判的函数层合同不变。
- 与 ZCode / Qoder / Cursor / WorkBuddy 适配层既有「解析失败 fail-closed」契约同口径。
- 不改变的放行：已成功解析出 `tool_name` 且属于只读工具（Read / Glob / Grep 等）时，维持 exit 0。

### 工具覆盖（规范性）

| tool_name | 判定路径 | 目标路径字段 |
|---|---|---|
| `Edit` / `Write` / `MultiEdit` | 文件路径判定（白名单、管辖边界、plan 阶段收窄） | `tool_input.file_path` |
| `NotebookEdit` | 文件路径判定（同上） | `tool_input.notebook_path` |
| `Bash` | Bash 命令判定（安全白名单 → 写入模式 → 路径提取与逐路径管辖判定） | `tool_input.command` |
| `PowerShell` | 与 Bash 同一判定流水线，写入模式表追加下表 PowerShell / cmd 写入命令 | `tool_input.command` |

文件路径类工具取不到目标路径字段时按「解析不出」fail-closed（exit 2），不放行。

### PowerShell / cmd 写入检测模式（规范性）

在 §Bash 写入操作检测模式之外，对 `PowerShell` 工具输入及 Cursor `beforeShellExecution`（Windows 下宿主 shell 为 PowerShell）追加以下写入模式（大小写不敏感，命中即视为写入）：

| 模式 | 说明 |
|---|---|
| `Set-Content` / `Add-Content` / `Out-File` | 写文件 |
| `New-Item` / `Remove-Item` / `Copy-Item` / `Move-Item` / `Rename-Item` | 文件系统修改 |
| 别名 `sc` / `ac` / `ni` / `ri` / `rm` / `del` / `erase` / `rd` / `rmdir` / `cp` / `copy` / `mv` / `move` / `ren` | 同上（以命令词边界匹配） |
| `>` / `>>`（含无空格形态，如 `echo x>f`） | 重定向写入 |
| `[System.IO.File]::Write*` / `[IO.File]::Write*` | .NET 写文件 |

命中后的处置与 Bash 相同：能提取出全部目标路径则逐路径走白名单与管辖边界判定；解析不出（变量、子表达式 `$(...)`、管道、复合语句）维持无条件阻断。安全白名单与写入检测的先后顺序见下节——对 Windows shell 输入**不**沿用「安全白名单先判」。

### Windows shell 输入的判定顺序（规范性）

**适用对象**（下称「Windows shell 输入」）：`tool_name` 为 `PowerShell` 的 Claude Code 输入；以及 `process.platform === 'win32'` 时 Cursor 的 `beforeShellExecution` 输入。**不适用**：任何平台上 `tool_name` 为 `Bash` 的输入（含 Windows 版 Claude Code 经 Git Bash 执行的 Bash 工具）与非 win32 平台的 Cursor 输入——它们沿用 §Bash 写命令路径提取与逐路径管辖判定 与 §资料目录与基线 staging 默认路径豁免「Bash 写入复用」中「`BASH_SAFE_PATTERNS` 先判」的既有顺序，本案不改变其任何结论（含 `echo … | tee …` 等既有放行形态）。

**为何需要例外**：`BASH_SAFE_PATTERNS` / `SHELL_SAFE_PATTERNS` 以命令首词判定（如 `^echo `、`^printf `），POSIX 下该取舍是既有合同；但在 Windows shell 中 `echo x>src\a.ts`、`Write-Output x > src\a.ts` 是最常见的写文件方式，若首词命中安全白名单即放行，本节新增的 PowerShell / cmd 重定向检测永远到达不了，Windows 写入门禁的缺口依旧存在。

**判定顺序**：

1. **先识别写入信号**（在剥离单 / 双引号字面量之后扫描）：
   - 重定向 `>` / `>>`（含无空格形态与 `1>` / `2>` / `*>`），但目标为 `$null`、`NUL`（大小写不敏感）或 `2>&1` 等流合并形态时**不算**写入信号；
   - 复合形态（`;`、`&&`、`||`、`|`、`&`）中任一段命中上表 PowerShell / cmd 写入模式或既有 `BASH_WRITE_PATTERNS`。
2. **有写入信号**：安全白名单**不适用于整条命令**，直接进入写入处置——提取全部写入目标路径，逐路径走白名单与管辖边界判定，全部在项目根之外或在白名单内才放行；任一目标解析不出（变量、子表达式、通配符）即阻断。
3. **无写入信号**：按既有顺序先判安全白名单（放行），再判上表写入模式（命中则按第 2 条处置），均未命中则放行。

**对照结论（规范性示例）**：

| 输入（Windows shell） | 结论 |
|---|---|
| `echo x`、`Write-Output x`、`git status`、`openlogos status`、`Get-Content src\a.ts` | 放行（无写入信号，安全白名单或非写入） |
| `echo x > $null`、`git status 2>&1` | 放行（流合并 / 丢弃不算写入信号） |
| `echo x>src\a.ts`、`echo x > src/a.ts`、`git log > src\log.txt` | 阻断（有写入信号，安全白名单不适用，目标为受保护路径） |
| `echo x>logos\resources\reference\n.md`、`echo x > logos/changes/<slug>/n.md`（有活跃提案时按提案范围） | 按目标路径判定：reference 豁免放行 |
| `echo x > $p` | 阻断（目标解析不出） |
| `echo x; Remove-Item src\a.ts` | 阻断（复合形态中一段命中写入模式） |

### 路径比较（规范性）

1. `rel_of_cwd` 与 `is_whitelisted_path` 在任何前缀比较之前，把相对路径中的 `\` 统一替换为 `/`；python、node 与 bash 兜底三条归一化分支同判（§三运行时一致 不变）。
2. Windows 绝对路径（`C:\...` 或 `C:/...`）在 bash 兜底分支同样识别为绝对路径，按项目根前缀（大小写不敏感）判管辖，不得因不以 `/` 开头而落入相对路径分支。
3. 目标与项目根不在同一盘符、无法求相对路径时，按「项目根之外」处理（§管辖边界 既有语义），不回退为绝对路径再与相对前缀比较。

### 字节保真（规范性）

托管 bash 脚本（`guard-check`、`openlogos-phase`）必须以 LF 字节运行。`init` / `sync` 写入的托管 `.gitattributes` 块对托管钩子目录设 `-text`，已被转换为 CRLF 的托管脚本由 `sync` 以随包字节覆盖恢复（架构文档 52.4）。

### 不变量

- 既有 `WHITELIST_PREFIXES`、`BASH_SAFE_PATTERNS` / `BASH_WRITE_PATTERNS`、管辖边界、plan 阶段原型 allowlist、有活跃提案时的放行语义、拦截文案与 stderr 双通道、exit 2 合同均不变。
- POSIX 上除「输入不可解析 → fail-closed」与 matcher 覆盖面扩大外，判定结果逐项不变；「Windows shell 输入的判定顺序」例外只作用于其适用对象，`Bash` 工具输入（任何平台）的安全白名单先判顺序不变。

### [code] 触点（本 delta 只定契约）

- 分发源 `plugin/bin/guard-check`、`plugin/bin/openlogos-phase`；`cli/src/commands/init.ts` 的 matcher 常量与幂等升级；`plugin-cursor/hooks/runtime.cjs` 的 `SHELL_WRITE_PATTERNS`；托管副本经 sync 分发，不手改。

## 版本控制内容保护与事后检查（规范性）

来源变更 guard-versioned-content-scope（决策 C01–C14）。本节把 launched 项目无活跃提案时「什么写入需要立案」的判据，从「命令文字与硬编码白名单」改为「是否改动了会进入版本控制的内容」：Edit / Write 类工具事前按路径判定；Bash / PowerShell 事前只做轻判，最终以执行前后受保护内容的对比为准。本节约束分发源 `plugin/bin/guard-check`、新增的事后检查引擎 `plugin/bin/guard-post-check.cjs`、Cursor runtime 与 CLI 的 `change` / `archive`；托管副本经既有 init / sync 与资产 manifest 分发获得。

### 术语

| 术语 | 含义 |
|---|---|
| 受保护内容 | launched、无活跃提案时，写入需要立案的内容，由「受保护判定」给出 |
| 执行记录（execution record） | 一次 Bash / PowerShell（或 Cursor shell）调用的快照与生命周期状态 |
| 待报告项（pending report） | 已发现、尚未送达 AI 的变化 |
| 宿主原生审批 | 宿主对这一次实际工具调用弹出的权限确认，由用户在宿主界面批准或拒绝 |
| 不可豁免项 | guard 自有状态、保护范围来源与 git 元数据；先于硬编码白名单与 `guard.exempt` 判定，位于任何白名单或 exempt 目录之下都受保护 |
| 独立 git / openlogos 调用 | 按「独立调用豁免」切段规则，每段只由 `git`、`openlogos` 或 `cd` 构成的调用 |

### 适用条件与非 git 回落

1. **git 判据生效条件**（下文简称「git 判据生效」）：`logos/logos-project.yaml` 中存在 `launched` 模块；项目根位于 git 工作树内（`git -C <项目根> rev-parse --is-inside-work-tree` 输出 `true`）；`git` 可执行；事后检查引擎存在且 node 可执行。四项同时满足才生效。
2. **无活跃提案（无 `logos/.openlogos-guard`）**：按本节全部规则判定。
3. **有活跃提案**：Edit / Write 的 proposal_step 收窄与 plan 阶段原型 allowlist 逻辑不变；Bash / PowerShell 照常拍快照建立执行记录（用于识别提案结束后仍在运行的后台调用），但各检查点只维护记录（最终对比、关闭、去重），不报告新变化；`openlogos change` 固定提案起点时存入的待报告项照常送达。
4. **initial 生命周期**：沿用既有「全部放行」，唯一例外是「保护范围变更的人类确认」在 lifecycle 判定之前生效（保护范围配置会延续到 launch 之后）。
5. **非 git 回落（fail-closed）**：git 判据生效条件任一不满足时，沿用修改前的 Bash / PowerShell 判定要素（安全白名单 → 写入模式 → 路径提取与逐路径管辖判定 → 解析不出即阻断）与 Edit / Write 白名单判定，不拍快照、不做事后检查。Bash 一侧改为**逐段**套用上述要素，写入段的相对目标按有效工作目录解析，规则见 §Bash 非 git 回落的复合命令逐段判定（规范性）；PowerShell 一侧沿用既有 `ws_scan` 拆段判定。以下四处保守修改在两种模式下都生效：
   1. `.gitignore` 不在硬编码白名单内（§白名单规则「文件路径白名单（Edit/Write 工具）」）；
   2. 不可豁免项（guard 自有状态、保护范围来源、git 元数据，见「受保护判定」第 2–4 步）受保护，且先于白名单与 exempt 判定；
   3. reference 与基线 staging 豁免从 `guard.exempt` 读取，缺省与损坏按「guard.exempt 与内置默认」处理；
   4. 保护范围变更受限命令按「保护范围变更的宿主原生审批」处理，且先于安全白名单识别。

   引擎缺失或 node 不可用导致回落时，阻断 reason 附带「运行 `openlogos sync` 补齐事后检查引擎」。
6. git 判据生效期间，单个路径的 git 查询失败（命令非零退出、超时、输出无法解析）时，该路径按受保护处理；整体状态采集失败（无法拍快照）时，本次调用按非 git 回落判定。

### 受保护判定（is_protected）

判定对象为既有归一化产出的项目根相对路径 `rel_path`（绝对化、realpath 解析最深已存在祖先、`\` → `/`，见 §管辖边界 与 §Claude Code guard 跨平台可移植性与输入 fail-closed（规范性）「路径比较」）。按以下顺序判定，先命中先返回：

| 步骤 | 条件 | 结论 |
|---|---|---|
| 1 | 位于项目根之外（`rel_path` 为 `..` 或以 `../` 开头） | 不保护（既有管辖边界） |
| 2 | guard 自有状态：运行时目录 `logos/.openlogos-runtime/` 及其后代 | 保护（不可豁免）；任何 lifecycle 与提案状态下 Edit / Write / MultiEdit / NotebookEdit 恒阻断，Bash / PowerShell 可确定目标恒阻断 |
| 3 | 保护范围来源：任意层级名为 `.gitignore` 的文件、git 目录下的 `info/exclude`、`git config core.excludesFile` 指向且位于项目根之内的文件、`logos/logos.config.json` | 保护（不可豁免），无论是否被 git 忽略、是否已跟踪 |
| 4 | git 元数据：git 目录（`git rev-parse --absolute-git-dir` 与 `--git-common-dir` 所指目录位于项目根之内的部分，通常为 `.git/`）下的路径 | 保护（不可豁免），防止改写 git 元数据绕过 |
| 5 | 命中硬编码白名单 `WHITELIST_PREFIXES`（已去掉 `.gitignore`） | 不保护 |
| 6 | 命中 `guard.exempt`（缺省为内置默认） | 不保护 |
| 7 | 位于 `logos/resources/` 下 | 保护，无论是否被 git 忽略（C07） |
| 8 | 已被 git 跟踪：`git ls-files --error-unmatch -- <rel_path>` 成功（目录路径下存在任一已跟踪文件同样成功） | 保护（含被忽略目录下强制入库的文件） |
| 9 | 被 git 忽略且未跟踪：`git check-ignore -q -- <rel_path>` 成功 | 不保护 |
| 10 | 其余（未跟踪、未被忽略的新文件 / 目录，含尚不存在的路径） | 保护 |

- 第 2–4 步为不可豁免项，位于白名单目录或 exempt 目录之下同样受保护。例如：exempt `docs/` 时 `docs/.gitignore` 受保护；exempt `logos/` 时 `logos/logos.config.json` 受保护；白名单 `.claude/` 下的 `.claude/.gitignore` 受保护。
- 第 3、4 步在有活跃提案时按既有提案范围规则处理（立案后可修改）；第 2 步在任何状态下都阻断工具写入。
- git 查询一律以项目根为 `-C`、`core.quotePath=false`，批量场景使用 `-z`；路径含 `.`、`..` 或空段时第 6 步不命中（与原 R-REF / R-STAGING 同样保守）。
- 符号链接不放宽：按解析后的真实路径判定，入口位于 exempt 或被忽略目录不构成放行理由。
- **非 git 回落时**：第 1–4 步照常生效（第 3 步不读取 `core.excludesFile`，第 4 步按字面 `.git` 路径段识别，均不调用 git）；第 5、6 步沿用既有 `is_whitelisted_path`（其中 reference / staging 规则改为读取 `guard.exempt`）；第 7–10 步不使用，未命中放行规则即按既有结论阻断。

### guard.exempt 与内置默认（取代 R-REF / R-STAGING 硬编码）

- 配置位置：`logos/logos.config.json` 的可选字段 `guard.exempt`（字符串数组）；字段定义见 `spec/logos.config.schema.json`。另一可选字段 `guard.unversioned` 只用于渲染 `.gitignore` 托管区块，guard 不直接读取它（它通过 git 忽略状态间接生效）。
- **内置默认**：`guard.exempt` 缺省时等价于 `["logos/resources/reference/", "logos/resources/verify/baseline-seed-runs/*/staging/"]`；显式写出时以写出内容为准，包括显式空数组 `[]`（表示不豁免任何路径，不回落内置默认）。`guard.exempt` 缺省时，`openlogos exempt add` 与 `openlogos exempt remove` 都先把内置默认物化为显式数组再修改；删光全部条目后写入显式 `[]`。
- **条目语法**：项目根相对路径，`/` 分隔；以 `/` 结尾表示该目录本身及其全部后代（完整段匹配），否则只匹配该单个文件；`*` 只能独占一个路径段，匹配恰好一个路径段，且被匹配的实际段须满足 `^[A-Za-z0-9][A-Za-z0-9._-]*$`。拒绝：绝对路径、含 `..` / `.` / 空段、含 `\`、空串、`/`、单独 `*`、以 `logos/.openlogos-runtime/` 开头、忽略规则来源（任意层级的 `.gitignore`、`.git/info/exclude`）、`.git` 本身或 `.git/` 下路径，以及 `logos/logos.config.json`——exempt 不能把保护范围来源与 git 元数据移出保护。手工写入配置的此类条目按非法条目跳过。
- **与原规则的等价性**：内置默认第一项与原 R-REF 命中集合相同（`logos/resources/reference` 本身及其后代，`reference-evil`、`references` 不命中）；第二项与原 R-STAGING 相同（第 5 段为单层 run_id 且满足标识符约束、第 6 段恰为 `staging`、其后 0 个或多个后代段；`staging-backup`、多层伪 run 路径不命中）。§资料目录与基线 staging 默认路径豁免（规范性）「仍受保护的相邻路径」表继续有效。
- **字段缺省**（`guard` 或 `guard.exempt` 不存在）→ 使用内置默认。
- **配置损坏**（`logos.config.json` 无法解析，或 `guard` / `guard.exempt` 类型不符）→ exempt 视为 `[]`，不豁免任何路径，并在 stderr 输出警告；不回落内置默认（例如显式 `guard.exempt: []` 之后配置损坏，`logos/resources/reference/x.md` 仍受保护）。单个非法条目跳过并警告，其余条目照常生效。
- 两种模式（git 判据生效 / 非 git 回落）都从 `guard.exempt` 读取豁免；`is_whitelisted_path` 不再硬编码 R-REF / R-STAGING 两条规则。

### Edit / Write / MultiEdit / NotebookEdit 事前判定

- git 判据生效且无活跃提案：按「受保护判定」：受保护 → exit 2；不受保护 → exit 0。
- 阻断 reason 写明目标路径与命中原因（已跟踪 / 未被忽略的新文件 / 规格目录 / 忽略规则来源 / git 元数据），下一步为 `openlogos change <slug>` 立案；目标属于依赖或构建产物时，补充提示「如该目录不应入库，可执行 `openlogos ignore add <pattern>`；该命令会改变保护范围，须经宿主原生审批由用户批准」。
- 有活跃提案时的 proposal_step 收窄、plan 阶段原型 allowlist 不变。
- 每次 PreToolUse 同时对未关闭执行记录做补查（见「执行记录生命周期」），补查结果不影响当前工具调用的放行结论。

### Bash / PowerShell 判定顺序（事前轻判 + 事后检查）

适用于 Claude Code 的 `Bash` 与 `PowerShell` 工具输入（任何平台），以及 Cursor `beforeShellExecution`。git 判据生效时按以下顺序：

1. **补查**：对全部未关闭执行记录做一次对比，新发现写入待报告项；不阻断当前调用。
2. **保护范围变更受限命令**（任何 lifecycle、任何提案状态）：按「保护范围变更的宿主原生审批」处理，结论即最终结论。
3. **lifecycle 全部 initial** → exit 0。
4. **有活跃提案** → 沿用既有提案期判定；放行时照常拍快照（只维护记录，不报告）。
5. **独立 git / openlogos 调用** → exit 0，按「独立 git / openlogos 调用豁免」处理基线。
6. **可确定写入目标的形态**：在引号外按 `&&`、`||`、`;`、`|` 切段（复用 PowerShell 侧既有切段与重定向提取），对每段提取能确定的写入目标——重定向目标（既有 `WRITE_TARGET` 提取，PowerShell 含无空格形态）、`rm` / `cp` / `mv` / `mkdir` / `touch` / `chmod` / `chown`（PowerShell 含对应写入 cmdlet 与别名）的路径实参。任一已确定目标受保护（含不可豁免项）→ exit 2。含变量、命令替换、通配符等无法确定的目标**不再导致阻断**，交给事后检查。
7. **其余** → exit 0，并在执行前调用引擎 `snapshot` 建立执行记录。只读优化：命令命中 `BASH_SAFE_PATTERNS` 中的只读模式（`ls`、`cat`、`grep`、`head`、`tail`、`pwd`、`git status` 等）且不含重定向、管道、复合形态、命令替换、后台符时，可跳过快照；命中与否不改变放行 / 阻断结论。

- `BASH_SAFE_PATTERNS` 在 git 判据生效时只承担上述「可跳过快照」的优化职责，不再作为放行依据；`BASH_WRITE_PATTERNS` 只作为第 6 步的目标提取入口，不再作为「命中即阻断」的依据。未知命令、`node -e`、脚本、`find -delete`、`curl -o` 等写法一律事前放行，由事后检查发现受保护变化。
- 「Windows shell 输入的判定顺序」中的写入信号识别继续用于第 6 步的目标提取；其「任一目标解析不出即阻断」在 git 判据生效时由事后检查取代。
- 非 git 回落时，第 2 步之后沿用既有判定顺序（安全白名单先判、写入模式、解析不出即阻断），并叠加「适用条件与非 git 回落」第 5 条的四处保守修改。

### 执行记录与内容级快照（C09）

**存放位置**：项目运行时目录 `logos/.openlogos-runtime/`（由 `.gitignore` 托管区块固定忽略）：

| 路径 | 内容 |
|---|---|
| `guard-records/<record_id>.json` | 执行记录；`record_id` = 宿主调用标识（Claude Code 为 `tool_use_id`）；缺失时为 `anon-<时间戳>-<随机>` 且 `anonymous: true` |
| `pending-reports.jsonl` | 待报告项 |
| `reported.jsonl` | 已报告变化的去重表，每条含去重键 `(path, raw_digest, 事件签名)`、`record_id`、执行前状态与执行后状态（供 `restore` 校验） |
| `raw-baseline.json` | 项目级原始字节基线缓存：每个已跟踪文件 `{stat 签名 (size, mtime_ns, ino, ctime_ns), raw_oid}` |
| `state.lock` | 项目级状态锁，内容 `{pid, host, acquired_at}` |
| `pending-spill/<pid>-<时间戳>.json` | 拿不到锁时溢出写入的待报告项，下次持锁时合并 |
| `guard-records/<id>.closed` | 已关闭记录的墓碑，保留到下一次会话开始后清理 |
| `untrack-<时间戳>.lst` | `openlogos ignore add` 生成的待移出版本控制文件清单（NUL 分隔，CLI 写入） |

**执行记录字段**：`id`、`anonymous`、`host`、`session_id`、`command`、`background`（bool，来自工具输入的后台执行标志）、`background_task_id`（后台调用的 PostToolUse 返回后回填）、`created_at`、`head`（`HEAD` 提交，未出生分支为空）、`index_tree`（执行前索引对应的树对象）、`entries`（`{path: {exists, type, digest, raw_oid?, recoverable}}`，`type` ∈ `file` / `symlink` / `dir`）、`generation`（记录代际，见「共享状态的并发与中断」）、`closed`（bool）。

**快照覆盖范围**：

1. 执行前的脏已跟踪文件（工作区内容与索引或 `HEAD` 不同）；
2. 未跟踪且未被忽略的文件；
3. `logos/resources/` 下被忽略、且不被 `guard.exempt` 命中的文件（C07）；
4. 保护范围来源（各级 `.gitignore`、`info/exclude`、项目内的 `core.excludesFile`，以及作为特殊条目的 `logos/logos.config.json`），无论其是否已跟踪、是否干净、是否被忽略，每次快照都纳入；
5. git 元数据：git 目录（`git rev-parse --absolute-git-dir`，以及位于项目根内的 `--git-common-dir`）中的 `config`、`info/` 下全部文件、`hooks/` 下全部文件；`core.hooksPath` 指向项目根内且未跟踪的目录同样纳入。

git 元数据**不采集**（git 自身或引擎写入、变化频繁）：`objects/`、`refs/`、`logs/`、`index`、`HEAD`、`ORIG_HEAD`、`FETCH_HEAD`、`MERGE_*`、`packed-refs`、`*.lock`、`modules/` 下的对象库。引擎 `git hash-object -w` 只写 `objects/`，因此不会自报。独立 git 调用（如 `git config …`）造成的元数据变化按「独立 git / openlogos 调用豁免」只更新基线。

**已跟踪文件的原始字节基线**：引擎维护项目级缓存 `raw-baseline.json`，每个已跟踪文件对应 `{stat 签名, raw_oid}`。

- 首次建立时全量计算：`git hash-object -w --no-filters --stdin-paths`。没有内容转换的文件，其 raw_oid 与索引中的 blob 相同，不额外占用对象库。
- 之后只对 stat 签名变化的文件重算；mtime 不早于缓存记录时刻的条目一律重算（racy 规避）。
- 快照为每个已跟踪文件引用缓存中的 raw_oid，作为执行前基线（`head` / `index_tree` 仅作审计与「是否脏」的辅助信息）。
- 合法写入（提案期间、独立 git / openlogos 调用、提案边界）之后，按「执行记录生命周期」「独立 git / openlogos 调用豁免」「提案边界」更新缓存与基线。

**摘要与内容留存（原始字节）**：

- 快照条目摘要一律为原始字节的 git blob oid（`git hash-object --no-filters`，记为 `raw_oid`），不经 `core.autocrlf`、clean filter 等转换；符号链接以链接目标文本计算 blob；`dir` 仅用于记录空目录占位与「文件被目录取代」类变化。
- git 不能恢复的条目（脏文件、未跟踪文件、被忽略规格、保护范围来源与 git 元数据的未提交内容）在执行前用 `git hash-object -w --no-filters --stdin-paths` 批量写入对象库，`recoverable: true`；已跟踪干净文件的原始字节已由 `raw-baseline.json` 建立时写入对象库，同样 `recoverable: true`。
- 单文件超过 5 MiB 或无法读取时只记摘要（无法读取时摘要为读取失败标记），`recoverable: false`。
- 允许按 stat 签名（size、mtime_ns、ino、ctime_ns）复用上一份记录或基线缓存中的摘要；mtime 不早于该签名被记录时刻的条目必须重新计算，避免同一时间粒度内的改写被漏检。

**变化判定**：对每个路径比较「基线」与当前状态，以下任一计为变化：新增、删除、类型变化、原始摘要变化。一律以原始字节（`--no-filters`）为准：执行后对 stat 签名变化的文件（含已跟踪文件）重算原始摘要，与执行前基线比较；不依赖过滤后的 `git diff` / `git status` 决定是否检查（clean filter 下过滤后 diff 为空的改动同样被发现），过滤后的比较只作为「是否脏」的辅助信息。只比较受保护内容：变化路径须经「受保护判定」判为受保护才进入反馈。

### 共享状态的并发与中断

- **项目级锁**：`logos/.openlogos-runtime/state.lock`，以 `O_CREAT|O_EXCL` 创建，内容为 `{pid, host, acquired_at}`。执行记录、待报告项、去重表、原始字节基线缓存与基线更新等一切状态变更都在锁内进行。等锁最多 5 秒；持锁超过 30 秒且持有进程已不存在时视为过期锁，可以打破。
- **原子落盘**：每个状态文件先写同目录临时文件 `*.tmp-<pid>-<rand>`，再 `rename` 覆盖。读取时忽略 `*.tmp-*`；过期临时文件在下次持锁时清理。
- **记录代际与墓碑**：每个执行记录带 `generation`，更新时在锁内比对，代际落后的写入丢弃。关闭记录时写入墓碑 `guard-records/<id>.closed`（保留到下一次会话开始后清理）；之后对该 id 的迟到写入看到墓碑即丢弃，已关闭的记录不会被复活。
- **拿不到锁**：
  - PreToolUse 拍快照拿不到锁 → 本次调用按「整体状态采集失败」处理，即非 git 回落判定（更保守）。
  - PostToolUse / PostToolUseFailure / Stop 拿不到锁 → 把待报告项以 `O_EXCL` 写入 `pending-spill/<pid>-<时间戳>.json`；下次持锁时合并进 `pending-reports.jsonl` 后删除，报告不丢失。
- **中断的方向性保证**：多文件更新（如对多个记录做基线更新）中途中断，只会留下部分记录仍是旧基线，结果只会多报、不会漏报。

### 执行记录生命周期（C12）

- **建立**：PreToolUse（Cursor 为 `beforeShellExecution`）放行一次需要快照的调用前建立，记录持久化，不随会话结束清理。
- **关闭条件**（只以宿主给出的执行结束证据为准，关闭前都做一次最终对比）：
  1. 收到同一 `record_id` 的 PostToolUse / PostToolUseFailure（Cursor 为 `afterShellExecution`），且该调用不是后台调用；
  2. 后台调用的 PostToolUse 返回了后台任务标识，之后宿主的工具结果确认该任务已结束：查询类工具（`BashOutput` / `TaskOutput`）输出显示已完成、失败或被终止，或终止类工具（`KillShell` / `TaskStop`）成功。工具名与 tool_response 中后台任务标识、结束状态字段以实施时 Claude Code 真实 hook 输入核实。
  3. **前台记录在 Stop 时关闭**：Stop 表明本回合的前台工具调用已全部结束（含被用户在权限确认中拒绝、被其他 hook 拦下、执行出错的调用）。Stop 时对全部**非后台**记录（`background:false`，含匿名的非后台记录）做最终对比后关闭；后台记录不受影响。用户中断（宿主不触发 Stop）时，前台记录保留到下一次 Stop 再关闭，被中断的前台进程已由宿主终止。
- **不算结束证据**：SessionEnd、补查时暂未发现变化、会话结束（含 `/clear`、切换会话）；Stop 对后台记录不算结束证据。不注册 SessionEnd；会话结束时记录保留，下一会话由 SessionStart 接管并继续对比，SessionStart 不关闭记录。
- **未关闭记录持续对比**：之后每个 PreToolUse、PostToolUse、PostToolUseFailure、Stop、SessionStart 都对全部未关闭记录做对比，发现变化即进入反馈，记录仍保持打开。
- **基线**：只要存在未关闭记录，判断某处改动是否「执行前已有」时，以最早一个未关闭记录为基线；之后建立的新记录不得把期间出现的受保护变化吸收为既有改动。基线只在两种情况下更新：独立 git / openlogos 调用（只更新它改动的路径）与提案边界（见「提案边界」）。
- **归因**：
  - 变化相对本次调用自身的快照出现，且没有其他未关闭记录 → 归因本次调用；
  - 其余情况（存在其他未关闭的后台或匿名记录、变化早于本次调用快照、结束事件缺少标识）→ 无法唯一归因，反馈标明「可能来自未结束的后台调用或用户手动修改，需向用户确认」，列出相关未关闭记录的命令；AI 不得自行回滚这类变化。
- **去重**：去重键为 `(path, raw_digest, 事件签名)`。事件签名取变化被观测时文件的 `(ino, ctime_ns)`；文件已删除时取 `"absent"` 加观测序号。同一事件只报一次，反复检查同一未变化状态不重复报告；结束事件迟到时照常做最终对比后关闭，已报过的不再重复。
- **去重条目清除**：以下情况清除该路径的去重条目，使同一内容再次出现时能重新报告：检查点观测到该路径回到基线（已恢复）；该路径基线被合法更新（独立 git / openlogos 调用的基线更新、提案边界）；该路径出现新的事件签名（再次被写入，即使内容相同，ctime 也会变）。例如「修改为 X → 报告 → 恢复 → 再次修改为 X」会再次报告，「修改为 X → 不恢复 → 多次检查」只报一次。
- **匿名记录**：缺少调用标识时不按「最近一次」猜测关联。匿名记录无法被任何结束事件关闭，长期保留；没有标识的结束事件只触发对比，不关闭任何记录。
- **删除**：记录在按上述条件关闭并完成最终对比后删除。已写入对象库的内容不随记录删除，按 git 自身的对象回收规则过期。

### 提案边界（C12）

提案起止边界由 CLI 在写入和删除 guard 文件时固定，不推迟到之后的检查：

- `openlogos change` 写入 `logos/.openlogos-guard` 之前调用引擎 `boundary-start`：对全部未关闭记录做一次对比，把尚未报告的受保护变化写入 `pending-reports.jsonl`。这些待报告项在提案期间不丢弃，之后的检查照常送达；提案开始前的后台写入因此不会混进提案期，也不会被归档吸收。
- `openlogos archive` 删除 guard 文件之前调用引擎 `boundary-end`：把全部未关闭记录的基线整体更新为当时的内容，再删除 guard 文件。提案期间的写入不报告，也不会在归档后被误报。归档之后的检查只做对比、不再更新基线，归档后、首次检查前发生的后台写入照样会被发现。
- 引擎不存在（非 Claude / Cursor 项目或未部署）→ 跳过边界调用，不阻断 `change` / `archive`。
- **边界缺失**：guard 文件不经 CLI 被删除或创建（如手动删除）时，不补做基线更新，按原基线对比；提案期间的改动以「需向用户确认」各报告一次，宁可多报，不静默吸收。

### 反馈内容与送达渠道

**反馈内容**（exit 2，stderr 输出可读文本；Claude Code 宿主 stdout 同时输出 JSON `{"reason": "<同一文本>"}`，与 §阻断（exit 2）双通道合同一致）：

1. 变化文件列表，逐项标明变化类型（新增 / 删除 / 类型变化 / 内容变化）；
2. 归因：本次调用，或「可能来自未结束的后台调用或用户手动修改」并列出相关调用命令；
3. 可恢复条目的恢复命令（见「恢复合同」），不可恢复条目标明「不可自动恢复」；
4. 下一步：归因到本次调用时，要求回滚这些改动或先 `openlogos change <slug>` 立案；无法归因时写明「需向用户确认，请勿自行回滚」；
5. 改动由非独立的 git / openlogos 复合调用造成时，提示把 git / openlogos 操作拆成单独调用后重试。

**送达渠道**：

| 发现时机 | 送达方式 |
|---|---|
| 归因到本次调用 | 该调用的 PostToolUse / PostToolUseFailure 以 exit 2 反馈（命令先写后报错同样经 PostToolUseFailure 发现） |
| PreToolUse 补查 | 写入待报告项，不阻断当前工具调用；在下一次 Bash / PowerShell 的 PostToolUse / PostToolUseFailure 或 Stop 时以 exit 2 送达 |
| Stop 补查 | 以 exit 2 送达全部未送达项；送达后若无新的未送达项则 exit 0，`stop_hook_active` 不导致重复送达 |
| SessionStart 补查 | 把待报告项并入 SessionStart 注入的上下文 |
| `boundary-start` 存入的待报告项 | 同 PreToolUse 补查 |

送达成功即从 `pending-reports.jsonl` 移除并写入 `reported.jsonl`。

### 恢复合同（C09）

- **恢复命令**：反馈中的恢复命令统一为 `node "<引擎路径>" restore <record_id> -- <path>`，不给出 shell 重定向或 git 检出类写法。Claude 宿主下引擎路径为 `$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs`，Cursor 下为 `.cursor/hooks/openlogos-guard-post.cjs`。
- **前置校验**：当前状态（是否存在、文件类型、原始摘要）必须与该报告记录的「执行后状态」完全一致；不一致（如已被后续修改）则拒绝恢复、只报告，退出码 1，避免冲掉之后的用户修改。
- **按执行前状态区分的恢复动作**（均按目录项原子替换）：
  - 执行前是普通文件（含已跟踪且干净的文件，使用 `raw-baseline.json` 中的 raw_oid）：在同一目录写临时文件 `.<name>.openlogos-restore-<pid>`，写入原始字节内容、设置原权限位、fsync，再以 `rename` 替换目录项。被替换的是目录项本身，即使当前是符号链接也不会沿链接写入、不改写链接目标。
  - 执行前是符号链接：用临时链接加 `rename` 重建。
  - 执行前不存在：当前是普通文件或符号链接则删除目录项；当前是目录则拒绝自动恢复，只报告。
  - 执行前是普通文件、当前是目录：拒绝自动恢复，只报告。
  - `recoverable: false` 的条目：拒绝自动恢复，只报告。
- 恢复本身不产生新报告：恢复后状态等于基线，按「去重条目清除」清除去重条目。`restore` 以 Bash 调用执行时，只有独立调用形态享受豁免：不报告，只把被恢复路径的基线改回被恢复记录中的执行前状态（见「独立 git / openlogos 调用豁免」中的「引擎 restore 调用」）；复合形态按普通 Bash 处理。
- guard 不自动执行恢复；无法归因的变化不给出「请回滚」指令。
- 对象库中由 `hash-object -w` 写入的内容不被任何引用持有，恢复在 git 对象回收（默认 `gc.pruneExpire` 两周）之前有效。

### 独立 git / openlogos 调用豁免（C05 / C10 / C13）

- **切段规则**：在引号外按 `&&`、`||`、`;` 切段；引号外任一处出现 `|`、`>`、`<`、`$(`、反引号、`(`、`)`、单独 `&`、`<<` → 不是独立调用。
- **独立调用判定**：每段首词为 `git`、`openlogos` 或 `cd`，且 `cd` 段之外至少有一段 git / openlogos；git 与 openlogos 混合也算独立调用。全部 git 子命令都适用，包括 `checkout`、`merge`、`rebase`、`stash pop`、`reset --hard`、`restore` 与 `push`（C05：防误删交给宿主自身权限系统）。
- **处理**：独立调用不报告变化。不存在未关闭记录时不拍快照；存在未关闭记录时，调用前 `snapshot --rebase-only`、调用后（PostToolUse / PostToolUseFailure）`check --rebase-only`，求出本次调用改动的路径，只把这些路径在全部未关闭记录中的基线更新为调用后的内容，其余路径的基线不动。后台服务运行期间的 `checkout` / `pull` 因此不会在之后的检查中被误报；后台随后再改这些路径时，内容与新基线不同，照样会被发现。
- **引擎 restore 调用（R9a，按 C13 同等对待）**：允许 `cd` 前缀段，`node "<引擎路径>" restore <record_id> -- <path>` 必须是唯一的非 `cd` 段，且引擎路径须等于已部署的托管路径（Claude 宿主 `$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs`，Cursor 宿主 `.cursor/hooks/openlogos-guard-post.cjs`）。满足时不报告变化，只把被恢复路径的基线（各未关闭记录中的条目与 `raw-baseline.json`）改回被恢复记录中的执行前状态，并清除该路径的去重条目；其他路径的基线不受影响。这样这次调用拍下的快照不会把违规后的内容当作执行前状态，恢复动作也就不会被误报为新变化。与其他命令组成复合调用（如 `node "<引擎路径>" restore … && echo x > other`）时不享受此豁免，按普通 Bash 调用拍快照并对比。
- **不豁免**：任一段不满足（如 `git status && node modify-source.js`、`git diff > src/a.ts`、`git apply $(…)`、`openlogos sync && node modify-source.js`）→ 豁免不传播到整条调用，按普通调用拍快照并对比，反馈提示拆分调用。
- **受限命令优先**：`openlogos exempt add|remove`、`openlogos ignore add|remove` 先过「保护范围变更的宿主原生审批」，用户批准并执行后再按本条处理基线。
- **残余风险（规范性声明）**：
  1. git 自身触发的钩子（如 pre-commit 改写文件）、git 别名中以 `!` 执行的 shell 命令、过滤器与外部 diff 驱动产生的写入，都归属该 git 调用，不报告；
  2. 独立 openlogos 调用内部执行的用户配置命令（如 `openlogos verify` 的 `pre_run_command`、`openlogos smoke` 的 `command`）产生的写入同样归属该调用，不报告；
  3. git / openlogos 调用执行期间，后台对同一路径的并发写入随基线更新一起被吸收。

### 保护范围变更的宿主原生审批（C14）

- **受限命令**：`openlogos exempt add|remove`、`openlogos ignore add|remove`（`list` 不受限）。在任何 lifecycle、任何提案状态下都受限（有活跃提案时也需确认），且在两种模式下都先于安全白名单与独立调用豁免识别。受限命令只接受独立调用形态（允许 `cd` 前缀段）；复合形态一律 exit 2。
- **确认来源**：确认必须来自宿主对**这一次实际工具调用**的原生审批。guard 不采信 AI 在对话中转述的「用户已同意」，也不使用任何可被普通工具调用伪造的本地凭据文件。
- **Claude Code**：PreToolUse 按 hook 输入的 `permission_mode` 处理：
  - `default` 或 `acceptEdits` → stdout 输出 `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"该命令会改变 guard 的保护范围（<命令原文>），需要您确认后执行"}}`，exit 0。由宿主对这一次调用弹出审批：用户批准则执行（之后按独立 openlogos 调用更新基线），拒绝则不执行。
  - 其他值（`bypassPermissions`、`dontAsk`、`auto`、`plan`）、字段缺失或未知值、非交互运行 → exit 2 阻断，reason：「当前权限模式（<mode>）下宿主不会弹出确认，无法证明由用户批准。请让用户在终端用 `! <命令原文>` 自行执行，或切换到默认权限模式后重试；不要用对话中的口头同意替代。」（双通道输出）。
  - **依据**：Claude Code 官方 hooks 文档说明，`permissionDecision: "ask"` 在 `bypassPermissions` / `dontAsk` 模式下静默放行，在非交互模式下按 `defer` 处理，因此只有 `default` / `acceptEdits` 能保证弹出审批。实施时以真实宿主再次核实；若核实结果与此不同，以「不能证明会弹出审批即阻断」为不变量收紧。
- **Cursor**：`beforeShellExecution` 对受限命令返回 `{"permission": "ask", ...}`；宿主在自动运行等模式下是否仍弹出审批，以真实宿主实测为准；实测不能保证弹出时改为 deny，并在 `spec/cursor-plugin.md` 写明。
- **其他宿主**：不能保证人机审批 → 阻断受限命令（本案不改其适配层的，见「已知覆盖限制」）。
- **`--auto` / 无人值守**：`openlogos next --auto` 的 standing 授权不覆盖保护范围变更。无人值守运行通常处于 `bypassPermissions` / `auto` / 非交互模式，受限命令因此被阻断，不另设机制。**对宿主的合同要求**：任何驱动 AI 会话的宿主 driver（如 RunLogos 全自动模式）不得代替用户批准此类宿主审批，必须把审批交给真实用户，或让该调用保持阻断。
- **保护范围来源受保护**：各级 `.gitignore`、`info/exclude`、项目内 `core.excludesFile` 文件与 `logos/logos.config.json`（`guard.exempt` / `guard.unversioned` 所在的配置文件）属不可豁免项，纳入受保护判定与每次事后检查快照，即使被 git 忽略、位于白名单或 exempt 目录之下也受保护，Edit / Write / Bash 直接修改须立案；`logos.config.json` 中的保护范围只由经审批的受限子命令写入（之后按独立 openlogos 调用更新基线），`openlogos sync` 只按配置当前内容渲染托管区块、不改配置；`.gitignore` 托管区块只由经审批的 `openlogos ignore` 与 `openlogos sync`（按配置重渲染，适用独立 openlogos 调用豁免）写入。

### Claude Code hook 注册与引擎分发

- **事后检查引擎**：单一实现 `plugin/bin/guard-post-check.cjs`（Node，CommonJS），由 guard-check、Claude hooks、Cursor runtime、CLI 的 `change` / `archive` 共用。子命令：`snapshot`（PreToolUse 拍快照，含 `--rebase-only`）、`check`（PostToolUse / PostToolUseFailure / Stop / PreToolUse 补查 / SessionStart，含 `--stop`、`--session-start`、`--rebase-only`）、`restore`（按报告记录恢复单个路径）、`boundary-start`、`boundary-end`。
- **分发**：作为 asset-manifest 托管资产随 init / sync 部署到 `.claude/openlogos/bin/guard-post-check.cjs`（Claude 宿主）与 `.cursor/hooks/openlogos-guard-post.cjs`（Cursor 宿主，同一份字节）；缺失 / 漂移即刷新，重复 sync 零变化。
- **注册**（`.claude/settings.json`，`"$CLAUDE_PROJECT_DIR"` 形态，幂等合并，旧托管条目原地升级，用户条目字节保真）：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/openlogos/bin/guard-check" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|PowerShell|BashOutput|TaskOutput|KillShell|TaskStop",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs\" check" }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs\" check" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs\" check --stop" }
        ]
      }
    ]
  }
}
```

- `PreToolUse` 既有条目不变：guard-check 内部对 Bash / PowerShell 调用 `snapshot`，对命中 matcher 的任意工具调用做补查。
- `PostToolUse` 收到后台任务查询 / 终止类工具时只处理后台记录的关闭判定。matcher 中写入宿主当前不存在的工具名无副作用。
- SessionStart：既有 phase launcher 调用 `check --session-start`，把待报告项并入注入上下文。
- 不注册 SessionEnd。
- 引擎缺失或 node 不可执行时，PreToolUse 按「非 git 回落」判定；Post / Stop hook 自身无法运行属宿主非阻断错误，不构成放行依据（事前已回落）。

### 非 Claude 宿主

- **Cursor**：按 §Cursor hooks 部分强度门禁适配合同 与 `spec/cursor-plugin.md` 接入 `beforeShellExecution`（事前轻判 + 快照）、`afterShellExecution`（事后检查）与 `afterFileEdit`（事后检测），保护对象与 Claude Code 一致。
- **qoder / workbuddy / zcode**：沿用各自按 proposal_step 收窄的保守模型，本案不改；它们不使用 git 判据，也不实现保护范围变更的宿主原生审批。
- **codex / opencode**：无写入拦截，不涉及。

### 已知覆盖限制

1. 宿主始终不报告结束的后台任务（脱离会话的守护进程、缺少调用标识的调用），其记录长期保留，期间的受保护变化以「需向用户确认」形式各报告一次，不会静默放过。
2. 事后检查发生在写入之后：受保护内容已被改动，依赖反馈与恢复合同回滚；超过 5 MiB 或无法读取的条目不可自动恢复；恢复命令在 git 对象回收前有效。
3. 独立 git / openlogos 调用的残余风险见「独立 git / openlogos 调用豁免」。
4. Bash 经无法事前确定目标的写法（如 `node -e`）写入 `logos/.openlogos-runtime/` 时，该目录被忽略且不在快照范围内，事后检查无法发现；运行时目录的保护以 Edit / Write 事前阻断与可确定目标的 Bash 事前阻断为限。
5. qoder / workbuddy / zcode 的现有 shell 判定若把 `openlogos *` 视为安全命令，会放行保护范围变更受限命令而不经宿主审批；本案不改这三个适配层，该差异如实保留。
7. **威胁模型**：guard 防的是 AI 无意或惯性越界，不防有意对抗的 agent（例如它可以修改白名单内 `.claude/` 下的 hook 注册，或以无法事前确定目标的写法篡改运行时目录）。C14 的保证范围是：在宿主会弹出审批的模式下，保护范围变更必须经用户在宿主界面批准。
6. 被 git 忽略、不在 `logos/resources/` 下、未被跟踪且不属不可豁免项的内容按设计不受保护，事后检查不覆盖。

### 取代声明

以下取代除特别注明「两种模式均取代」外，均限于「git 判据生效」时；非 git 回落时被取代的原结论仍然生效。两种模式均取代的是「适用条件与非 git 回落」第 5 条列出的四处保守修改：`.gitignore` 白名单行、不可豁免项先于白名单与 exempt、R-REF / R-STAGING 硬编码改读 `guard.exempt`、受限命令的宿主原生审批。既有用例中断言「`.gitignore` 白名单放行」「R-REF / R-STAGING 硬编码」的，在两种模式下结论都已改变，须改写断言，不再作为回落回归锚：

1. §判定逻辑 框图第 3 步「检查白名单 → 未命中即 exit 2」：取代为「受保护判定」（Edit / Write 类）与「Bash / PowerShell 判定顺序」（shell 类）；第 1、2 步不变，保护范围变更受限命令的确认先于第 1 步。
2. §白名单规则「Bash 命令白名单」与「Bash 写入操作检测模式」作为放行 / 阻断依据的结论：取代为只读快照优化与事前目标提取入口；其中「`git push` 始终放行」澄清的结论不变（全部独立 git 调用放行）。
3. §Bash 写命令路径提取与逐路径管辖判定「判定顺序（不变）」三条与「解析不出（fail-closed 边界）」的「维持现行无条件阻断」：取代为「Bash / PowerShell 判定顺序」第 5–7 步，解析不出事前放行、由事后检查兜底。
4. §资料目录与基线 staging 默认路径豁免（规范性）中「本节把两类路径纳入内置默认豁免，**不新增配置开关、白名单管理命令、审批标记或 run 状态解析**」：取代为两类路径由 `guard.exempt` 内置默认表达，并新增 `openlogos exempt` / `openlogos ignore` 与宿主原生审批（两种模式均取代）；该节「Bash 写入复用」中「维持现行无条件阻断」与「`BASH_SAFE_PATTERNS` 先判」两项结论按第 2、3 条取代；匹配约束与「仍受保护的相邻路径」不变。
5. §Claude Code guard 跨平台可移植性与输入 fail-closed（规范性）「工具覆盖」表中 `Bash` / `PowerShell` 行的判定路径「安全白名单 → 写入模式 → 路径提取与逐路径管辖判定」：取代为「Bash / PowerShell 判定顺序」；「Windows shell 输入的判定顺序」第 2 条「任一目标解析不出即阻断」取代为事后检查兜底，写入信号识别保留用于事前目标提取。
6. 各「不变量」小节（§管辖边界 第 5 条、§Bash 写命令路径提取与逐路径管辖判定、§资料目录与基线 staging 默认路径豁免（规范性）、§Claude Code guard 跨平台可移植性与输入 fail-closed（规范性））中「`WHITELIST_PREFIXES` 前缀表不变」「`BASH_SAFE_PATTERNS` / `BASH_WRITE_PATTERNS` 不变」「解析不出不放宽」的结论：按本节第 1–5 条取代；管辖边界、plan 阶段原型 allowlist、有活跃提案时的放行语义、拦截文案双通道与 exit 2 合同仍然不变。
7. §plan 阶段写入 allowlist（GUI 原型路径例外）「[code] 触点」第 3 条中「guard 的其余判定逻辑……均保持不变」：按本节第 1–3 条取代；plan 阶段原型 allowlist 本身不变。
8. §与现有机制的关系 表中 PreToolUse guard hook「硬性拦截（无法绕过）」：Edit / Write 类仍为事前硬拦；Bash / PowerShell 改为「事前轻判 + 事后检查」，最终判定在执行后给出。
9. §Cursor hooks 部分强度门禁适配合同 中 `preToolUse`（仅 Cursor IDE）「硬拦（宿主自身行为）」一行：已在该节「适用范围与强度声明」改为「未接入」，两种模式均适用。

### 不变量

- 管辖边界：项目根之外的写入不拦截、不告警。
- 路径归一化、符号链接防逃逸、`\` → `/` 统一与三运行时同判合同不变。
- 有活跃提案时的 proposal_step 收窄与 plan 阶段原型 allowlist 不变。
- 阻断输出的 stdout JSON + stderr 双通道合同与 exit 2 语义不变；任何阻断与事后反馈不得出现 exit 2 但 stderr 为空。
- 输入不可解析时 fail-closed 不变。
- 非 git 回落时，除「适用条件与非 git 回落」第 5 条的四处保守修改外，判定结论与修改前一致。

### [code] 触点（本 delta 只定契约）

- 分发源 `plugin/bin/guard-check`：受保护判定（不可豁免项先于白名单与 exempt）、`guard.exempt` 读取（缺省 / 损坏区分）（移除 R-REF / R-STAGING 硬编码与 `.gitignore` 白名单项）、Bash / PowerShell 事前轻判、补查、独立调用识别、受限命令按 `permission_mode` 返回 `ask` 或 exit 2、非 git 回落。
- 新增分发源 `plugin/bin/guard-post-check.cjs`：`snapshot` / `check` / `restore` / `boundary-start` / `boundary-end`，以及原始字节基线缓存、状态锁与原子落盘；快照含 git 元数据，留存与比较使用 `--no-filters` 原始字节。
- `plugin/bin/openlogos-phase`：SessionStart 调用 `check --session-start` 并注入待报告项。
- `cli/src/commands/init.ts` 与 sync 链路：PostToolUse / PostToolUseFailure / Stop hook 幂等注册、引擎资产分发与 asset-manifest 登记；`cli/src/commands/change.ts` / `archive.ts`：`boundary-start` / `boundary-end`。
- `plugin-cursor/hooks/runtime.cjs`、`plugin-cursor/hooks/hooks.json`、`cli/src/lib/cursor-adapter.ts`：见 `spec/cursor-plugin.md`。
- 托管副本经 sync 分发，不手改。

## Bash 非 git 回落的复合命令逐段判定（规范性）

> 来源变更：verify-smoke-guard-fixes-0-15-20（决策 C04，proposal r1 F1）。适用于 §版本控制内容保护与事后检查「适用条件与非 git 回落」第 5 条的 Bash 判定，以及引擎缺失 / node 不可用 / 整体状态采集失败导致的回落。git 判据生效时的事前轻判与事后检查**不受影响**。

### 缺陷形态

修改前回落路径 `bash_fallback_verdict` 拿**整条命令**匹配 `BASH_SAFE_PATTERNS`，命中即放行；写入模式也只锚定整条命令开头。于是 `ls && rm -rf src`、`cd <项目根> && sed -i … src/x`、`true; rm src/x` 在 launched 且无活跃提案时都被放行。PowerShell 一侧的 `ws_scan` 已按顶层分隔符拆段判定，Bash 一侧没有。

### 拆段

1. 先剥离单引号与双引号字面量（引号内的 `&&`、`;` 等不作分隔符；`echo "a && rm b"` 是一段）。
2. 再按顶层 `&&`、`||`、`;`、`|`、`&` 与换行拆段；空段忽略。
3. 命令含 `$( … )`、反引号、`<( … )` / `>( … )` 或 heredoc（`<<`）时，只要整条命令任意位置出现写入模式，即按解析不出阻断；不解析其内部命令。

### 逐段判定

1. **安全白名单**：只有**每一段**都命中 `BASH_SAFE_PATTERNS` 才凭白名单放行。
2. **写入模式**：任一段命中 `BASH_WRITE_PATTERNS`，即对**该段**做既有的路径提取（§Bash 写命令路径提取与逐路径管辖判定「路径提取规则」）与逐路径管辖判定；该段解析不出目标时阻断。
3. **整条结论**：任一段不放行，整条命令阻断（exit 2，`block()` 双通道保持）；全部段放行才放行。
4. 未命中任何模式的段按既有规则（未知命令默认放行）处理。

### 有效工作目录（路径基准合同）

逐段套用既有判据时，既有路径解析以 guard 进程自身的 cwd 为基准，而白名单放行 `cd`——若不规定基准，`cd src && rm ../src/a.ts` 中的 `../src/a.ts` 会按 guard cwd 解析为项目外而被误放行，实际写入的却是 `<项目根>/src/a.ts`。因此：

1. 各段按出现顺序维护「有效工作目录」，初值为 guard 自身 cwd。
2. 写入段的**相对**目标先按当时的有效工作目录解析为绝对路径，再对项目根做既有管辖判定；**绝对**目标按其本身判定，不受前序目录切换影响。
3. **可确定的推进及其作用域**：目录切换段是 `cd` 或 `pushd` 后跟**单个**字面量参数（不含 `$` 变量、通配符 `*` `?` `[`、波浪号 `~`、命令替换）时，有效工作目录推进为该参数解析出的目录（相对参数按当前有效目录解析）。该推进**只在从该段起以 `&&` 连续相连的条件链内有效**：链内后续段只有在目录切换成功时才会执行，因而必然使用新目录。目录参数形态合法并不证明切换会成功（如目标不是目录），所以不能把新目录带出这条链（delta r1 F2）。
4. **不确定**：以下任一情形使有效工作目录变为不确定，此后整条命令中**任一写入段**按解析不出阻断，**绝不**以 guard 原 cwd 或假定的新目录的解析结果作为项目外放行依据；不确定一经产生即持续到命令结束：
   1. 非字面量的目录切换——无参数 `cd`、`cd -`、`popd`、参数含变量或通配、位于子 shell 或条件分支内；
   2. 字面量目录切换所在的 `&&` 条件链被 `;`、换行、`||`、`|` 或 `&` 结束——无论这个边界紧跟在切换段之后（`cd src; rm ../src/a.ts`），还是链中又经过若干段之后才出现（`cd /dev/null && true; rm src/a.ts`：`cd` 失败时 `true` 被跳过，`;` 之后的 `rm` 仍在原目录执行）。边界之后的段可能在新目录、也可能在原目录执行，基准不唯一。
5. 只读段（命中安全白名单或未命中写入模式）不受有效工作目录影响。

### 验收矩阵（非 git、launched、无活跃提案）

| 命令 | 结论 |
|---|---|
| `ls && rm -rf src`、`true; rm src/x`、`cd <项目根> && sed -i 's/a/b/' src/x`、`echo $(rm src/x)` | 阻断（修改前放行） |
| `cd src && rm ../src/a.ts` | 阻断（有效目录推进后目标为受保护源码） |
| `cd src; rm ../src/a.ts`、`cd "$D" && rm a.ts`、`cd - && rm a.ts`、`cd a \|\| cd b && rm x` | 阻断（有效目录不确定） |
| `cd /dev/null && true; rm src/a.ts`、`cd /dev/null && true` 换行 `rm src/a.ts`、`cd src && true \|\| rm ../src/a.ts`、`cd src && ls & rm ../src/a.ts` | 阻断（条件链被结束后有效目录不确定；按假定新目录解析会把受保护源码误算到项目外） |
| `cd src && cat a.ts; cat b` | 放行（只读段不受有效目录影响） |
| `ls && cat x`、`git status \| head`、`echo "a && rm b"`、`cd src && cat a.ts` | 放行 |
| `cd src && rm /项目外绝对路径/x` | 按真实目标判定：项目外 → 放行 |
| 任意单条命令 | 判定结果与修改前逐字一致 |

### 不变量

- 单条命令（拆段后只有一段）的判定结果逐字不变；`WHITELIST_PREFIXES`、`BASH_SAFE_PATTERNS` / `BASH_WRITE_PATTERNS` 模式表、拦截文案、exit 2 合同与 plan 阶段原型 allowlist 不变。
- 收紧只影响复合命令；解析能力之外一律保守阻断，guard 不实现完整 shell 解释器。
- git 判据生效时的事前轻判、快照与事后检查不受影响。

### [code] 触点（本 delta 只定契约）

- `plugin/bin/guard-check` 的 `bash_fallback_verdict` 落实拆段、逐段判定与有效工作目录；sync 部署副本 `.claude/openlogos/bin/guard-check` 经 `openlogos sync` 分发（guard-check 为 asset-manifest 托管资产，随 0.15.20 发布刷新）。

## Bash 模式表的 ERE 解释与跨平台同判（规范性）

> 来源变更：fix-guard-tee-pattern-linux（决策 C01；由 release-0-16-0 部署门② Linux 干净克隆预演暴露）。适用于 `plugin/bin/guard-check` 中的 `BASH_SAFE_PATTERNS` 与 `BASH_WRITE_PATTERNS`，以及经 sync 分发的托管副本。

### 缺陷形态

guard 用 `grep -qE` 对模式表逐条匹配，条目因此按 POSIX 扩展正则（ERE）解释，而不是按字面串解释。修改前，`BASH_WRITE_PATTERNS` 含条目 `"| tee "`：开头的 `|` 在 ERE 里是交替符，该条目的实际含义是「空串，或 ` tee `」。不同 grep 对空分支的处理不同：

| 平台 | grep | `"| tee "` 的实际行为 | 后果 |
|---|---|---|---|
| Linux / CI | GNU grep | 空分支匹配任意输入 | 非 git 回落时，所有不在 `BASH_SAFE_PATTERNS` 里的命令都被判为写入：`make build`、`git status \| head` 被阻断；git 判据下的事前轻判也对任意命令进入目标提取 |
| macOS | BSD grep | 整条不匹配任何输入 | `… \| tee 文件` 不被识别为写入 |

Cursor 侧同一张表写作 `/\| tee /`（`plugin-cursor/hooks/runtime.cjs`），本意为字面量「管道接 tee」，只有 Bash 侧漏了转义。

### 规则

1. **按 ERE 书写**：模式表每一条都是 POSIX ERE，由 `grep -E` 解释。需要字面量含义的元字符必须转义：`|` 写作 `\|`（bash 双引号字符串内写作 `"\\| …"`），`[`、`(`、`.`、`*`、`+`、`?` 等同理。
2. **禁止空分支**：任一条目都不得产生空的交替选项。具体为：不得以未转义的 `|` 开头或结尾，不得出现相邻的未转义 `||`，也不得在分组内出现 `(|`、`|)`。有意的交替（如 `"^ls |^ls$"`，两侧都非空）合法。
3. **`| tee ` 的语义**：`BASH_WRITE_PATTERNS` 中该条目写作 `"\\| tee "`，语义为字面量「管道接 tee」，与 Cursor 侧 `/\| tee /` 一致。
4. **跨平台同判**：对同一输入，guard 在 GNU grep 与 BSD grep 下必须给出相同的退出码与阻断文案。模式表条目只能使用两者语义一致的 ERE 子集，不得依赖任一实现的扩展或未定义行为（空分支、`\d`、`\s`、反向引用等）。

### 修复后的判定

| 输入（非 git 回落、launched、无活跃提案） | Linux | macOS |
|---|---|---|
| `make build`、`npm run release:local`（未知单条命令） | exit 0（修改前 exit 2） | exit 0 |
| `git status \| head`、`ls \| head` | exit 0（修改前 exit 2） | exit 0 |
| `cat src/x \| tee src/a.ts` | exit 2 | exit 2 |

### 不变量

- 模式表的条目集合、判定顺序（`BASH_SAFE_PATTERNS` 先判）、逐段判定、有效工作目录、路径提取与逐路径管辖判定、拦截文案、exit 2 合同、git 判据下的事前轻判与事后检查均不变。本节只修正一条模式的写法，使其回到既有本意，并约束今后的写法。
- 各「不变量」小节中「`BASH_SAFE_PATTERNS` / `BASH_WRITE_PATTERNS` 模式表不变」的含义是**语义不变**；本节对 `| tee ` 的转义属于语义修正，不构成对这些不变量的违反。

### [code] 触点（本 delta 只定契约）

- `plugin/bin/guard-check`：`"| tee "` 改为 `"\\| tee "`；托管副本 `.claude/openlogos/bin/guard-check` 与源模板逐字节一致；`cli/asset-manifest.json` 由生成器重算。
- 测试：UT-S09-459（模式表无空分支的静态守卫）、UT-S09-460（非 git 回落的跨平台同判行为矩阵），见 `logos/resources/test/core-S09-test-cases.md`。
