## ADDED — Claude guard hook 项目根定位与 sync 补齐需求

### 用户价值

`openlogos init` 为 Claude Code 部署的 PreToolUse guard hook（launched 无活跃提案时硬拦 Edit/Write/Bash）必须在**任意会话 cwd** 下可靠生效：用户从项目子目录开会话不应导致 hook 报 `No such file or directory` 刷屏，更不应让 guard 静默失效或静默放行；guard 功能上线之前 init 的存量项目升级 CLI 后运行 `openlogos sync` 必须补齐硬闸——变更纪律不能只剩 SessionStart 提示文本 + AI 自律（来源：`openlogos-claude-guard-hook-project-dir-and-sync-deploy-gap-bug-report.md`，0.14.20 复核三项全部成立）。

### hook 注册形态要求（缺陷①）

1. `init`/`adopt` 写入 `.claude/settings.json` 的 PreToolUse hook command 必须为 `"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check`（Claude Code 官方项目根环境变量）；SessionStart hook 同函数族同步为 `$CLAUDE_PROJECT_DIR` 形态。
2. 幂等去重必须同时识别新旧两种 command 写法：重复执行零重复条目；检测到旧相对路径条目时升级迁移为新形态，新旧不并存。

### guard-check 工作目录收敛要求（缺陷②）

1. `guard-check` 脚本必须在判定前把工作目录收敛到 `$CLAUDE_PROJECT_DIR`；收敛后既有判定逻辑（lifecycle、`logos/.openlogos-guard`、白名单、绝对路径 realpath 归一化）语义逐项不变。
2. `CLAUDE_PROJECT_DIR` 缺失时的兼容回退：cwd 恰为项目根（存在 `logos/logos.config.json`）可按 cwd 判定；否则 **fail-closed**——exit 2 并输出可读诊断，**禁止**静默 `exit 0` 放行。
3. 非项目根 cwd 的会话在正确注册（含 `$CLAUDE_PROJECT_DIR`）下：无提案改码被阻断（exit 2 + reason），有提案在范围内放行——与项目根 cwd 行为逐项一致。

### sync 资产面要求（缺陷③）

1. guard 资产（`guard-check` bin 文件 + PreToolUse hook 注册）纳入 `openlogos sync` 的托管资产面：asset-manifest 登记版本化哈希，与 skills/AGENTS.md 同一机制；升级 CLI 后 sync 即补齐/更新。
2. 存量项目（无 guard-check、无 PreToolUse 段）sync 后：bin 落盘、hook 注册齐备；幂等重跑零重复；旧相对路径条目被迁移。
3. 该要求兑现 `spec/directory-convention.md` 既有「由 init / sync 自动部署」承诺（修复规格-实现背离）。

### 场景验收条件

#### S01 初始化

- init 新项目后 `settings.json` 的 PreToolUse 与 SessionStart command 均含 `$CLAUDE_PROJECT_DIR`；重复 init 零重复条目。

#### S08 同步 AI 工具资产

- 存量项目 sync 后 guard-check 落盘、hook 注册齐备、旧条目迁移、幂等重跑零重复。

#### S09 变更生命周期

- guard-check 在 `CLAUDE_PROJECT_DIR` 缺失且 cwd 非项目根时 fail-closed（exit 2 + 诊断）；子目录 cwd + 变量在场时判定与项目根 cwd 逐项一致。

### 非目标

- 不改变 guard 判定语义（lifecycle/guard 文件/白名单/exit 2 阻断合同不动）；不部署（用户决策 C01，随下一部署窗口发布）；不触及其它宿主（codex/zcode/qoder/workbuddy/cursor）的 hook 机制。
