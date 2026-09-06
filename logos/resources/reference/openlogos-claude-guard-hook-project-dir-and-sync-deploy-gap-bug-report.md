# OpenLogos 侧 Bug Report：Claude PreToolUse guard hook 相对路径失效 + 存量项目硬闸缺失（移交 openlogos 仓立案）

> 记录日期：2026-09-05（America/Los_Angeles）
> 来源：RunLogos 提案 `fix-driver-merge-transaction-contract-alignment` 排查期间发现（遗留项 ②），2026-09-05 在 openlogos 0.14.20 安装版与上游源码复核确认**均未修复**
> 文档性质：跨仓移交 bug report，**不是** openlogos 仓的正式提案；openlogos 仓需自行创建变更提案、完成 Delta 与验收
> 状态：**已修复（待部署发布）**——提案 `fix-claude-guard-hook-project-dir-and-sync-deploy`（2026-09-05 verify 2160/2160 通过，归档于 `logos/changes/archive/20260905-1818-*`）；三项缺陷全部修复入仓，按用户决策随下一个部署窗口（0.14.21）发布，届时存量项目一次 `openlogos sync` 即补齐硬闸
> 检查基线：OpenLogos CLI `0.14.20`（`/opt/homebrew/lib/node_modules/@miniidealab/openlogos`）与 openlogos 仓 `~/gitlab/openlogos` 工作树（HEAD `eb2aeb5`）；实证项目：runlogos（`~/gitlab/runlogos`，launched）

## 背景一句话

`openlogos init` 为 Claude Code 部署的 PreToolUse guard hook（launched 项目无活跃提案时硬拦 Edit/Write/Bash）存在**双层 cwd 依赖缺陷**：hook 注册命令是相对路径、guard-check 脚本内部判定也全部相对 cwd——非项目根 cwd 的会话要么刷 `No such file or directory`，要么静默 fail-open 放行；同时 `openlogos sync` **不部署** guard 资产，导致 guard 功能上线之前 init 的存量项目（如 runlogos 本身）至今没有硬闸，变更纪律只剩 SessionStart 提示文本 + AI 自律。

## 缺陷 ①（P1）：hook 注册命令为相对路径，非项目根 cwd 会话直接找不到脚本

**事实（0.14.20 安装版 dist 与上游源码逐字一致，已核实）**：

- 上游 `cli/src/commands/init.ts:1141` / 安装版 `dist/commands/init.js:984`：

  ```js
  const guardRelPath = '.claude/openlogos/bin/guard-check';   // 相对路径
  ```

- `mergeClaudePreToolUseGuard(root, guardRelPath)`（init.ts:978 / init.js:832）把它**原样**写进 `.claude/settings.json`：

  ```js
  const hookEntry = { type: 'command', command: guardRelPath };
  ```

- 全仓（openlogos 上游 + 安装版）搜索 `CLAUDE_PROJECT_DIR` **零命中**；`plugin/bin/guard-check` 与 `init.ts` 近期提交（`eb2aeb5` 等）均为适配器功能，无修复痕迹。

**后果**：Claude Code 执行 hook 时以**会话 cwd** 解析相对命令。会话 cwd 不在项目根（用户 `cd src/` 后开会话、多目录工作区、子目录终端等）时，每次 Edit/Write/Bash 前置钩子都报 `No such file or directory`——既刷屏，又意味着 guard **静默失效**（hook 失败不阻断工具调用）。

**同病**：SessionStart hook 同函数族写入的也是相对路径。runlogos 项目 `.claude/settings.json` 实测：

```json
"SessionStart": [{ "hooks": [{ "type": "command", "command": "node \".claude/openlogos/bin/openlogos-phase-launcher.cjs\"" }] }]
```

**修法**：注册命令改为 `"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check`（Claude Code 官方约定的项目根环境变量；SessionStart 同步改）。幂等去重判据（`alreadyRegistered` 按 command 字符串精确匹配）需同时兼容新旧两种写法，避免升级后重复注册或漏迁移。

## 缺陷 ②（P1，仅修 ① 不够）：guard-check 脚本内部判定全部相对 cwd，非项目根时静默 fail-open

**事实**（`plugin/bin/guard-check` 全文核读）：

- 脚本第一步：

  ```bash
  CONFIG_FILE="logos/logos.config.json"
  if [ ! -f "$CONFIG_FILE" ]; then
    exit 0   # Not an OpenLogos project — allow everything
  fi
  ```

- 后续 lifecycle 判定（`logos/logos-project.yaml`）、guard 文件（`logos/.openlogos-guard`）、PLAN_APPROVED、白名单相对路径归一化（`os.getcwd()` / `process.cwd()`）**全部以 cwd 为根**。

**后果**：即使修好缺陷 ①（脚本能被找到并执行），非项目根 cwd 的会话进来第一步就判「不是 OpenLogos 项目」→ `exit 0` **静默放行**。硬闸对这类会话等于不存在，且没有任何可见信号——比刷错误更隐蔽。

**修法**：脚本开头统一收敛工作目录，例如：

```bash
cd "${CLAUDE_PROJECT_DIR:?openlogos guard-check requires CLAUDE_PROJECT_DIR}" || exit 2
```

失败语义建议 fail-closed（exit 2 阻断并给出诊断），与 guard「硬闸」定位一致；至少不得静默 fail-open。脚本内白名单归一化（Edit/Write 的 `file_path` 可能是绝对路径）已有 realpath 处理，`cd` 到项目根后语义自洽，无需改动判定逻辑本身。

## 缺陷 ③（P1）：`openlogos sync` 不部署 guard 资产，存量项目硬闸永久缺失

**事实（以 runlogos 项目实证）**：

- guard-check 的部署（拷贝 `plugin/bin/guard-check` → `.claude/openlogos/bin/` + 注册 PreToolUse hook）**只发生在 `init`/`adopt`**（init.ts:1139-1153）；
- `dist/commands/sync.js` 对 `guard` **零涉及**，`asset-manifest.json` 也不含 guard 条目——sync 的托管资产面不覆盖它；
- runlogos 项目于 guard 功能上线之前 init，之后随 CLI 升级只跑过 `openlogos sync`（当前 `.openlogos-sync.json` 记录 cliVersion 0.14.20）。实测结果：`.claude/settings.json` **没有 PreToolUse hook**，`.claude/openlogos/bin/` 目录下**没有 guard-check 文件**（只有 openlogos-phase / openlogos-phase-launcher.cjs）。

**后果**：所有在 guard 功能之前创建的存量项目至今没有硬闸。launched 生命周期的变更纪律仅剩 SessionStart 注入的提示文本（"⛔ NO guard file found… FORBIDDEN"）与 AI 自律——正是 guard hook 想消灭的软约束状态。讽刺的是,这也让缺陷 ①② 在存量项目上"看不见"：没有 hook 可失败。

**修法**：把 guard 资产（bin 文件 + hook 注册）纳入 `openlogos sync` 的托管资产面（asset-manifest 登记 + 版本化哈希，与 skills/AGENTS.md 同一机制），使升级 CLI 后 sync 即补齐/更新；hook 注册沿用 `mergeClaudePreToolUseGuard` 的幂等语义（含缺陷 ① 修复后的新旧 command 兼容）。

## 复现步骤

**缺陷 ①②（需 guard 功能之后 init 的项目，或手工按 init 模板补部署）**：

1. 在一个 launched、无活跃提案的 OpenLogos 项目里，确认 `.claude/settings.json` 含相对路径的 PreToolUse hook；
2. `cd <project>/src` 后启动 Claude Code 会话，触发任意 Edit/Write；
3. 观察：hook 报 `No such file or directory`（缺陷 ①）；若把 hook command 改成绝对路径重试,则 guard-check 静默 exit 0 放行（缺陷 ②）——两种形态下无提案改码均**不被拦截**。

**缺陷 ③**：

1. 取任一 guard 功能之前 init 的项目（如 runlogos），升级全局 CLI 后运行 `openlogos sync`；
2. 检查 `.claude/openlogos/bin/`（无 guard-check）与 `.claude/settings.json`（无 PreToolUse 段）——guard 从未到位。

## 验收锚建议（openlogos 仓自行立案时参考）

1. init 新项目：`settings.json` 的 PreToolUse/SessionStart command 均含 `"$CLAUDE_PROJECT_DIR"`；从项目子目录 cwd 触发 Edit/Write，无提案 → 阻断（exit 2 + reason），有提案 → 放行；
2. guard-check 在 `CLAUDE_PROJECT_DIR` 缺失时 fail-closed 并给出可读诊断，不静默放行；
3. 存量项目 `openlogos sync` 后：guard-check 落盘、hook 注册齐备、幂等重跑零重复条目；旧相对路径条目被迁移或与新条目不并存；
4. 白名单/plan 阶段 page-design 例外等既有判定语义在 cwd 收敛后逐项不变（回归）。

## 与 RunLogos 侧的关系

- RunLogos 仓**无需任何改动**：本报告三项全部归属 openlogos 仓（init 模板、guard-check 脚本、sync 资产面）。
- 关联历史：本问题最早记录于 `fix-driver-merge-transaction-contract-alignment` 排查（作为遗留项 ②）；当时描述仅覆盖缺陷 ①，本次复核补齐 ②③。
- 运行时身份混用问题（0.14.17/0.14.20 双版本）与本报告无关，已由 RunLogos 提案 `fix-driver-transaction-runtime-lifecycle`（archive/20260905-0926-）根治。
