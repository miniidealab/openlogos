# Delta: core-01-feature-specs.md（fix-guard-check-external-path-and-stderr）

## ADDED — 2.64 guard 管辖边界与阻断 reason 双通道输出（含 0.14.22 候选发布验收）

### 2.64.1 管辖边界：guard 只管辖项目根之内（缺陷①修复）

`plugin/bin/guard-check` 的 `is_whitelisted_path` 在白名单前缀匹配**之前**先判管辖：

- **判定位置与规则**：python3/node 归一化产出 `rel_path` 后，`rel_path` 为 `..` 或以 `../` 开头 → 目标在项目根之外 → **放行**（return 0，不进入白名单匹配）；bash 兜底分支（python3/node 均不可用）对绝对路径先判是否位于 `$(pwd)/` 之下，不在则放行。
- **语义**：guard 的保护目标是**本项目源码的变更可追溯性**；项目根之外的写入（用户级 `~/.claude/projects/**` 记忆文件、其他仓库、系统临时目录）归宿主权限系统判定，guard 不拦截。Bash 写入命令的重定向目标判定复用同一函数，随之获得同一边界。
- **不变量**：项目根之内的判定逐项不变——lifecycle 判定、`logos/.openlogos-guard` 存在性、`WHITELIST_PREFIXES` 前缀表、`BASH_SAFE_PATTERNS`/`BASH_WRITE_PATTERNS`、plan 阶段原型 allowlist、exit 2 阻断合同均保持。

### 2.64.2 阻断 reason 双通道输出（缺陷②修复）

Claude Code 对 PreToolUse hook 的 exit 2 **读取 stderr** 展示拦截原因；stdout JSON 仅旧协议向后兼容。因此：

- `block()` 必须双通道：stdout 保留 `{"reason":"..."}` JSON 原样不变；同时以 `printf '%b\n' "$msg" >&2` 把 reason 可读文本写入 stderr。
- Step 0 两处 fail-closed（`CLAUDE_PROJECT_DIR` 不可进入 / 变量缺失且 cwd 非项目根）同样在既有 stdout JSON 之外补 stderr 诊断输出。
- **不变量**：任何阻断路径不得出现「exit 2 但 stderr 为空」；stdout JSON 的结构与字面内容不因本修复改变。

### 2.64.3 OpenLogos 0.14.22 候选内容与发布验收

`@miniidealab/openlogos@0.14.22` 相对 0.14.21 的全部行为差异即本节两处修复（提案 `fix-guard-check-external-path-and-stderr`）：

| # | 内容 | 生效面 |
|---|---|---|
| ① | is_whitelisted_path 管辖边界（项目外路径放行） | 安装态脚本随包字节 |
| ② | block() 与 Step 0 fail-closed 阻断 reason 双通道（stderr + stdout JSON） | 安装态脚本随包字节 |

发布验收口径：

- **身份**：UT-S19-39 tripwire 钉 `LOCAL_RELEASE_CANDIDATE_VERSION=0.14.22`/`ROLLBACK=0.14.21` 与全源一致。
- **安装态行为**：SMOKE-core-193 承载——guard 两处修复全链（项目外写放行、项目内拦截 stderr 含指引且 stdout JSON 不变、fail-closed stderr 可见）、固定 0.14.21 对照（复现项目外误拦截与 "No stderr output"，防断言空转）、roundtrip 无混装。
- **发布边界**：仅本机全局；部署与 smoke 各为独立人类确认点；矩阵失败停止部署回实现，全局异常按固定 0.14.21 tarball（sha256 `ac173f5f…c285f`）回滚。
