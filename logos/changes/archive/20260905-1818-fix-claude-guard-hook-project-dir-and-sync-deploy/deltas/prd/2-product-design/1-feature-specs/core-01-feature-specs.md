## ADDED — 2.62 Claude guard hook 项目根定位、fail-closed 与 sync 补齐

### 2.62.1 问题

Claude Code 执行 hook 时以**会话 cwd** 解析相对命令与相对路径。0.14.20 及以前存在三层缺陷（bug report 复核全部成立）：

| # | 缺陷 | 后果 |
|---|---|---|
| ① | hook 注册 command 为相对路径 `.claude/openlogos/bin/guard-check`（SessionStart 同族同病） | 非项目根 cwd 会话每次工具调用报 `No such file or directory`——刷屏且 guard 静默失效 |
| ② | guard-check 内部判定全部相对 cwd（第一步找 `logos/logos.config.json` 不存在即 `exit 0`） | 即使修好①，非根 cwd 静默 fail-open，比刷错误更隐蔽 |
| ③ | guard 资产只在 init/adopt 部署，sync 零涉及、asset-manifest 无条目 | guard 功能前 init 的存量项目永久无硬闸；与 directory-convention 「init/sync 自动部署」承诺背离 |

### 2.62.2 hook 注册形态与幂等迁移（缺陷①）

- `mergeClaudePreToolUseGuard` 及 SessionStart 同函数族写入的 command 形态统一为 `"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check`（SessionStart 为 `node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/openlogos-phase-launcher.cjs"` 等价形态）。
- 幂等去重判据从「command 字符串精确匹配」升级为**新旧两种写法都命中**：
  - 已有新形态条目 → 不动；
  - 只有旧相对路径条目 → 就地升级为新形态（迁移，不并存）；
  - 两者皆无 → 追加新形态条目。
- 用户自有的其它 hooks 条目字节不变（既有合并保真语义保持）。

### 2.62.3 guard-check 工作目录收敛与 fail-closed（缺陷②）

脚本在读取 stdin 之后、一切文件判定之前收敛工作目录：

```bash
if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
  cd "$CLAUDE_PROJECT_DIR" || { printf '{"reason":"openlogos guard: 无法进入 CLAUDE_PROJECT_DIR"}'; exit 2; }
elif [ ! -f "logos/logos.config.json" ]; then
  printf '{"reason":"openlogos guard: CLAUDE_PROJECT_DIR 缺失且 cwd 非项目根，fail-closed"}'; exit 2
fi
```

- 变量在场：`cd` 后按项目根判定；`cd` 失败 fail-closed。
- 变量缺失（旧版 Claude Code 兼容窗口）：cwd 恰为项目根 → 按 cwd 判定（与 0.14.20 行为一致）；否则 fail-closed exit 2 + 可读诊断——**禁止静默放行**。
- `cd` 之后既有判定逻辑零改动：lifecycle 判定、`logos/.openlogos-guard`、PLAN_APPROVED/plan 阶段 page-design 例外、`BASH_SAFE_PATTERNS` 白名单、Edit/Write 绝对路径 realpath 归一化全部语义自洽。
- 注意「非 OpenLogos 项目放行」分支的语义边界：只有**确认处于某项目根**（变量或 cwd 事实）且该根无 `logos/logos.config.json` 时才 `exit 0`；「不知道项目根在哪」不属于该分支。

### 2.62.4 sync 托管 guard 资产（缺陷③）

- guard 资产两件套纳入 `openlogos sync` 托管资产面：
  1. `plugin/bin/guard-check` → `.claude/openlogos/bin/guard-check`（bin 落盘，asset-manifest 登记版本化哈希，与 skills/AGENTS.md 同一机制——哈希漂移即刷新）；
  2. `.claude/settings.json` 的 PreToolUse hook 注册（复用 §2.62.2 的幂等迁移语义）。
- 触发条件与既有托管资产一致：仅 Claude Code 适配项目（settings.json / .claude 面存在或 config ai-tool 含 claude-code）；非 Claude 宿主项目不受影响。
- 存量项目升级 CLI 后一次 `openlogos sync` 即补齐硬闸；重复 sync 幂等零重复。

### 2.62.5 验收

- UT-S01-137～138、ST-S01-30（注册形态、幂等迁移、init 端到端）。
- UT-S08-59～60、ST-S08-37（sync 资产面、存量补齐、端到端幂等）。
- UT-S09-313～314、ST-S09-120（fail-closed、子目录 cwd 判定一致性、端到端拦截/放行）。
- 既有 guard 行为回归：白名单、plan 阶段例外、exit 2 reason 四要素等由既有用例锚定不变。
