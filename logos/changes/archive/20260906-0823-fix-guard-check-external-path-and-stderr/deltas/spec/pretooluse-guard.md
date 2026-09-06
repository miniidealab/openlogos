# Delta: spec/pretooluse-guard.md（fix-guard-check-external-path-and-stderr）

## MODIFIED — 阻断（exit 2）

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

## MODIFIED — 工作目录收敛与 fail-closed（规范性）

guard-check 在一切文件判定之前收敛工作目录：

1. `CLAUDE_PROJECT_DIR` 在场：`cd` 至该目录；`cd` 失败 → exit 2 + 可读 reason（stdout JSON 与 stderr 双通道，见 §阻断（exit 2））。
2. 变量缺失（旧版 Claude Code 兼容窗口）：cwd 存在 `logos/logos.config.json` 才按 cwd 判定；否则 exit 2 + 可读 reason（同上双通道）。
3. **禁止**把「无法确定项目根」落入「非 OpenLogos 项目 → exit 0」分支——该分支的前提是已确认某个项目根且其下无 `logos/logos.config.json`。
4. 收敛后既有判定合同逐项不变：lifecycle 判定、`logos/.openlogos-guard` 存在性、`BASH_SAFE_PATTERNS` 白名单、Edit/Write 绝对路径 realpath 归一化、阻断 reason 结构与 exit 2 语义。
5. 两处 fail-closed 的诊断输出与常规阻断同一双通道合同：stdout `{"reason":...}` JSON + stderr 可读文本，不得只写 stdout（fix-guard-check-external-path-and-stderr）。

## ADDED — 管辖边界（项目根之外路径放行，规范性）

guard 的保护目标是**本项目源码的变更可追溯性**，管辖范围止于项目根。`is_whitelisted_path` 在白名单前缀匹配**之前**先判管辖：

1. **归一化路径判定**：python3/node 归一化产出的 `rel_path` 为 `..` 或以 `../` 开头 → 目标位于项目根之外 → **放行**（return 0，不进入白名单匹配与阻断分支）。
2. **bash 兜底判定**：python3/node 均不可用时的前缀剥离分支，对绝对路径先判是否位于 `$(pwd)/` 之下；不在 → 放行。
3. **裁决权归属**：项目根之外的写入（用户级 `~/.claude/projects/**` 记忆文件、其他仓库、系统临时目录）由宿主自身权限系统裁决；guard 不拦截、不告警、不越权代管。
4. **覆盖面**：Edit/Write 的 `file_path` 判定与 Bash 写入命令的重定向目标判定复用同一函数，管辖边界一致生效；plan 阶段原型 allowlist 的 delta 前缀匹配天然不命中项目外路径，行为不变。
5. **不变量**：项目根之内的判定逐项不变——白名单前缀表、Bash 安全/写入模式、plan 阶段 allowlist、exit 2 阻断合同均保持。管辖边界收窄不构成安全弱化：项目内硬闸零变化，项目外本就不属 guard 保护目标。
