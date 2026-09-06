# Delta: core-01-requirements.md（fix-guard-check-external-path-and-stderr）

## ADDED — Claude guard hook 管辖边界与阻断可见性需求

### 用户价值

PreToolUse guard hook 的硬闸必须**只管辖本项目源码**且**拦截时给出可操作原因**：AI 宿主写项目根之外的文件（用户级 `~/.claude/projects/**/memory/*.md` 记忆文件、其他仓库、系统临时目录）不应被本项目的变更纪律误拦——那些路径的权限归宿主自身权限系统；而项目内被拦截时，用户与 AI 必须能看到「请先运行 `openlogos change <slug>`」的指引，而不是 "No stderr output"（来源：runlogos 仓库实际使用发现并本地热修验证，2026-09-06 于 0.14.21 安装版复核两项全部成立）。

### 管辖边界要求（缺陷①）

1. `is_whitelisted_path` 在白名单前缀匹配**之前**先判管辖：目标路径归一化后位于项目根之外（relpath 为 `..` 或以 `../` 开头；bash 兜底分支下绝对路径不在 `$(pwd)/` 之下）→ **放行**，不进入白名单匹配与阻断分支。
2. guard 的保护目标是**本项目源码的变更可追溯性**；项目根之外的写入一律交由宿主权限系统判定，guard 不拦截、不告警。
3. 项目根之内的判定语义逐项不变：lifecycle、`logos/.openlogos-guard` 存在性、白名单前缀表、Bash 安全/写入模式、exit 2 阻断合同均保持。

### 阻断可见性要求（缺陷②）

1. `block()` 阻断时必须**双通道输出**：stdout 保留 `{"reason":"..."}` JSON（旧协议向后兼容），同时把 reason 以可读文本写入 **stderr**（Claude Code 对 PreToolUse hook exit 2 实际读取的通道）。
2. Step 0 两处 fail-closed（`CLAUDE_PROJECT_DIR` 不可进入 / 变量缺失且 cwd 非项目根）同样双通道输出诊断。
3. 任何阻断路径不得出现「exit 2 但 stderr 为空”的形态。

### 场景验收条件

#### S09 变更生命周期

- launched 无提案时：Edit/Write 项目根之外目标（含 `~/.claude` 用户级路径与其他仓库绝对路径）→ exit 0 放行；Edit/Write 项目内源码 → exit 2 且 **stderr 含变更管理指引**、stdout JSON 结构不变。

### 非目标

- 不改变项目根之内的任何判定语义；不触及其它宿主（codex/zcode/qoder/workbuddy/cursor）适配层的输出协议（各自合同独立成文）。

## ADDED — OpenLogos 0.14.22 guard 修复候选发布需求

### 用户价值

两处 guard-check 修复（管辖边界、阻断 stderr 可见性）必须发布到本机全局才能生效：项目外误拦截与 "No stderr output" 存在于**已安装的 0.14.21 CLI**；发布 0.14.22 后存量项目一次 `openlogos sync` 即刷新 guard-check 字节，runlogos 本地热修同步转正（用户决策 C01：「请帮我本机全局部署，升级到 0.14.22」）。

### 候选发布要求（S19）

1. **候选身份链同步**：CLI package/lockfile、全部随包 plugin/资产模板 manifest、package asset manifest、`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.22`、`LOCAL_RELEASE_ROLLBACK_VERSION=0.14.21` 与发布身份 tripwire/golden 全链一致；真实 `npm pack` 冻结唯一 tarball SHA-256。
2. **隔离矩阵（部署前强制）**：一次性 npm prefix 安装固定 tarball，从绝对入口验收——candidate identity 无 workspace link；**guard 两处修复全链**（launched 无提案写项目外路径放行 exit 0；写项目内源码拦截 exit 2 且 stderr 含指引、stdout JSON 结构不变；Step 0 fail-closed stderr 可见）；`0.14.21→0.14.22` roundtrip 无混装。
3. **零回归对照（强制）**：同一项目外写入场景与项目内拦截场景在固定 `0.14.21` 上必须复现**误拦截**与**stderr 为空**（缺陷本身）；旧版也放行/也有 stderr 则矩阵空转，必须重写矩阵而非放行部署。
4. **全局覆盖与 smoke**：矩阵与回滚演练 PASS 且用户授权后覆盖本机全局；新 shell 复核 identity 全同源 `0.14.22`；`openlogos smoke`（SMOKE-core-193）独立授权执行。
5. 回滚制品固定 0.14.21 tarball（SHA-256 `ac173f5fddff6717bfaf15787ee7ebf9c5029837277e71c20c77370abf5c285f`）；回滚自检失败不得覆盖全局。

### 场景验收条件

#### S19 候选发布与 smoke 门禁

- 0.14.22 候选身份全源一致（UT-S19-39 tripwire）；SMOKE-core-193 全链 PASS 且 0.14.21 对照有效；部署与 smoke 各为独立人类确认点。

### 非目标

- 除两处修复外零新增语义；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
