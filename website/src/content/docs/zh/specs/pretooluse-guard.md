---
title: PreToolUse Guard
description: OpenLogos 写入门禁如何判定哪些 AI 写入需要立案——受保护内容、Bash / PowerShell 执行后比对、恢复方式、不可豁免路径，以及各 AI 宿主的接入点。
---

OpenLogos guard 把变更管理规则——*launched 项目不立案不得修改代码与规格*——从「提醒」升级为工具层面的检查。它以 hooks 形式运行在 AI 宿主内：在 AI 写文件、执行命令之前检查，对 shell 命令还会在执行之后再比对一次。

本页是面向用户的摘要。规范性定义见 `logos/spec/pretooluse-guard.md`（由 `init` / `sync` 部署到你的项目中）。

## guard 何时生效

| 项目状态 | 行为 |
|---|---|
| 所有模块均为 `initial` | 放行写入。两个例外：guard 自有状态 `logos/.openlogos-runtime/` 任何工具都不能写；修改保护范围（`openlogos ignore` / `openlogos exempt` 的 `add` 或 `remove`）仍须宿主审批。 |
| `launched`，有活跃提案（存在 `logos/.openlogos-guard`） | 只能在提案范围内修改。guard 放行写入，但在 plan 阶段有一处收窄：plan 获批（`PLAN_APPROVED`）之前，提案 `deltas/` 下只允许写 GUI 原型 `deltas/prd/2-product-design/2-page-design/*.html`。ZCode、Qoder、WorkBuddy 还会按提案当前步骤（`proposal_step`）进一步收窄。 |
| `launched`，无活跃提案 | 只保护**会进入版本控制的内容**（见下文）。写入被忽略的依赖、构建产物、日志、缓存无需立案。受保护的写入会被阻断；shell 命令则在执行后反馈。 |

用 `openlogos change <slug>` 创建提案，它会写入 guard 文件、打开提案范围；`openlogos archive <slug>` 关闭它。

## 什么算受保护

项目处于 launched、无活跃提案、且 git 判据生效（项目根位于 git 工作树内，`git` 与 `node` 可用，事后检查引擎已部署）时，每个目标路径按以下顺序判定，先命中先返回：

| # | 路径 | 结论 |
|---|---|---|
| 1 | 项目根之外 | 不保护 |
| 2 | guard 自有状态：`logos/.openlogos-runtime/` | 保护，不可豁免；工具写入恒阻断 |
| 3 | 保护范围来源：任意层级的 `.gitignore`、`.git/info/exclude`、项目内的 `core.excludesFile`、`logos/logos.config.json` | 保护，不可豁免 |
| 4 | git 元数据（`.git/` 目录） | 保护，不可豁免 |
| 5 | 内置白名单——例如 `logos/changes/`、`logos/logos-project.yaml`、`logos/skills/`、`logos/spec/`、`AGENTS.md`、`CLAUDE.md`、`README*`，以及 `sync` 写入的宿主目录（`.claude/`、`.cursor/`、`.opencode/`、`.codex-plugin/`） | 不保护 |
| 6 | `guard.exempt` 条目（默认：`logos/resources/reference/` 与 `logos/resources/verify/baseline-seed-runs/*/staging/`） | 不保护 |
| 7 | `logos/resources/` 下的任何内容 | 保护，即使被 git 忽略 |
| 8 | 已被 git 跟踪 | 保护（含被忽略目录下强制入库的文件） |
| 9 | 被 git 忽略且未跟踪 | 不保护 |
| 10 | 其余（既未跟踪也未被忽略的新文件） | 保护 |

第 2～4 步先于白名单和 `guard.exempt` 判定，因此即使位于白名单或豁免目录之下也受保护（例如 `.claude/.gitignore`，或豁免了 `docs/` 时的 `docs/.gitignore`）。有活跃提案时，保护范围来源与 git 元数据可以像其他范围内文件一样修改；`logos/.openlogos-runtime/` 在任何状态下都阻断。

要调整保护范围，请使用 [`openlogos ignore` / `openlogos exempt`](/zh/cli/ignore-exempt)，不要直接编辑 `.gitignore` 或 `logos/logos.config.json`。

## Edit / Write 类工具：写入前判定

`Edit`、`Write`、`MultiEdit`、`NotebookEdit` 在执行前判定。目标受保护即阻断，提示中写明目标路径、受保护原因（已跟踪 / 未被忽略的新文件 / 规格目录 / 忽略规则来源 / git 元数据）与下一步——用 `openlogos change <slug>` 立案。目标属于依赖或构建产物目录时，还会提示可执行 `openlogos ignore add <pattern>`（该命令本身须经宿主审批）。

## Bash / PowerShell：事前轻判 + 执行后内容级比对

仅凭命令文字无法可靠判断 shell 命令会写什么，所以 git 判据生效时 guard 这样处理：

1. **事前轻判。** 在引号外按 `&&`、`||`、`;`、`|` 切段。能确定写入目标（重定向目标，或 `rm` / `cp` / `mv` / `mkdir` / `touch` / `chmod` / `chown` 及对应 PowerShell 命令的路径实参）且目标受保护时，执行前即阻断。无法确定目标的写法（变量、命令替换、通配符、`node -e`、脚本、`find -delete` 等）不再因此阻断。
2. **执行前拍快照**，记录受保护内容（`ls`、`cat`、`git status` 等只读命令可跳过）。
3. **执行后内容级比对。** 命令结束后，事后检查引擎按原始字节把受保护内容与快照比对。发现未立案的改动，就向 AI 反馈：
   - 变化文件列表及每个文件的变化类型（新增 / 删除 / 类型变化 / 内容变化）；
   - 归因——本次命令，或「可能来自未结束的后台调用或用户手动修改，需向用户确认」；
   - 每个可恢复文件的恢复命令；
   - 下一步：回滚这些改动，或先立案。无法归因到本次命令的变化会注明「需向用户确认，请勿自行回滚」。

恢复命令按快照恢复单个路径：

```bash
node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" restore <record_id> -- <path>
```

（Cursor 下引擎为 `.cursor/hooks/openlogos-guard-post.cjs`。）报告之后文件若又被改过，恢复会拒绝执行，不会冲掉之后的修改。快照时超过 5 MiB 或无法读取的文件标注为「不可自动恢复」。guard 从不自动执行恢复。

**独立的 `git` / `openlogos` 调用不报告。** 按 `&&`、`||`、`;` 切段后，每段都只是 `git`、`openlogos` 或 `cd` 的命令不报告变化——`git checkout`、`git pull`、`git reset --hard`、`openlogos sync` 等都适用。与其他命令组合（例如 `openlogos sync && node script.js`）即失去豁免，反馈会提示把调用拆开。

## 非 git 项目与回落

git 判据不生效时——项目不是 git 仓库、缺少 `git` 或 `node`、事后检查引擎缺失、或无法拍快照——guard 回落为 fail-closed 规则：安全命令白名单、写入模式识别、路径提取，写入目标解析不出即阻断。此模式下没有执行后比对。

复合命令**按段判定**，每一段都要通过：`ls && rm -rf src`、`true; rm src/x` 即使前一段无害也会被阻断。`cd` / `pushd` 之后的相对写入目标，在同一条 `&&` 链内按有效工作目录解析；有效目录变得不确定时（变量形式的 `cd`、`cd -`，或链被 `;`、`||`、`|`、`&` 打断），之后任何写入段都阻断。若回落是因为引擎缺失，提示中会要求运行 `openlogos sync`。

## 修改保护范围须经宿主审批

`openlogos ignore add|remove` 与 `openlogos exempt add|remove` 会改变 guard 的保护范围，因此在任何生命周期、任何提案状态下都受限（`list` 不受限）。它们只能以独立调用执行（允许 `cd` 前缀），复合形态一律阻断。

- **Claude Code**——权限模式为 `default` 或 `acceptEdits` 时，guard 请宿主针对这一次调用弹出原生审批。其他模式（`bypassPermissions`、`dontAsk`、`auto`、`plan`）或非交互运行下宿主不会弹窗，调用会被阻断；请在终端用 `! <命令原文>` 自行执行，或切换到默认权限模式后重试。
- **Cursor**——`beforeShellExecution` 返回 `ask`；宿主不能保证弹出审批时按 deny 处理。
- **ZCode / Qoder / WorkBuddy**——未接入原生审批。launched 项目中这些命令与其他非只读 shell 命令一样被阻断，请在终端自行执行。
- 对话中的口头同意不算审批；`openlogos next --auto` 的授权也不覆盖保护范围变更。

## 不可豁免的路径

任何 `guard.exempt` 条目或白名单都不能放开以下路径：

- 任意层级的 `.gitignore`；
- `.git/info/exclude`（以及项目内的 `core.excludesFile`）；
- `logos/logos.config.json`；
- git 元数据（`.git/` 及其下路径）；
- guard 自有状态 `logos/.openlogos-runtime/`。

`openlogos exempt add` 会拒绝这类条目；配置中手写的非法条目会被跳过并告警。

## 各宿主接入点

| 宿主 | 接入点 | 门禁强度 |
|---|---|---|
| **Claude Code** | `SessionStart`（阶段上下文与待报告项）；`PreToolUse`，matcher 为 `Edit\|Write\|MultiEdit\|NotebookEdit\|Bash\|PowerShell`；`PostToolUse`，matcher 为 `Bash\|PowerShell\|BashOutput\|TaskOutput\|KillShell\|TaskStop`；`PostToolUseFailure`，matcher 为 `Bash\|PowerShell`；`Stop` | 完整：编辑事前阻断，shell 命令事前轻判 + 执行后比对，保护范围变更走原生审批 |
| **Cursor**（IDE 与 `cursor-agent` CLI） | `.cursor/hooks.json`：`sessionStart`、`beforeShellExecution`（事前轻判 + 快照）、`afterShellExecution`（事后检查）、`afterFileEdit`（事后报告） | 部分强度：OpenLogos 未接入 `preToolUse`，文件编辑只在事后报告，不会事前阻断。受保护判定与 Claude Code 一致 |
| **ZCode / Qoder / WorkBuddy** | 插件 `hooks/hooks.json`：`SessionStart` 与 `PreToolUse` | 保守的 PreToolUse 硬拦：launched 项目中，少量只读命令之外的 shell 命令一律阻断，文件写入按 `proposal_step` 收窄（plan 阶段只允许 `proposal.md` / `tasks.md`，写 delta 阶段只允许 `deltas/**` 与 `tasks.md`）。不使用 git 判据，没有执行后比对 |
| **Codex / OpenCode** | 仅注入会话上下文 | 无写入拦截 |

`init`、`adopt`、`sync`、`launch` 负责部署与刷新这些 hooks。升级 CLI 后请在每个项目中执行 `openlogos sync`，否则项目仍运行旧版 guard——见[从 0.13.x 升级](/zh/getting-started/upgrade-from-0-13)。

## 已知限制

- 执行后比对发生在写入之后：内容已经被改动，需要按报告回滚。恢复在 git 回收所存对象之前有效（默认两周）。
- 宿主始终不报告结束的后台任务，其记录会一直保持打开；期间的变化以「需向用户确认」的形式各报告一次。
- 被 git 忽略、未跟踪、不在 `logos/resources/` 下且不属于不可豁免路径的内容，按设计不受保护。
- guard 防的是 AI 无意或惯性越界，不防有意绕过它的 agent。

## 相关

- [`openlogos ignore` / `openlogos exempt`](/zh/cli/ignore-exempt) —— 管理保护范围
- [`openlogos change`](/zh/cli/change) —— 创建提案
- [`openlogos sync`](/zh/cli/sync) —— 重新部署 guard 脚本与 hooks
- [Cursor 插件](/zh/specs/cursor-plugin) —— Cursor 资产布局与 hooks
- [变更管理](/zh/specs/change-management) —— guard 所守护的 Delta 工作流
