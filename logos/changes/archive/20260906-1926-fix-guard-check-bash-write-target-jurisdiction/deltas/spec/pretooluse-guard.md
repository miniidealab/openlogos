# Delta: pretooluse-guard.md

> change: fix-guard-check-bash-write-target-jurisdiction
> 目标：`spec/pretooluse-guard.md`（项目根规范，权威；`logos/spec/` 为 merge 后同步副本）

## MODIFIED — Bash 写入操作检测模式

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

**澄清（`git push` 始终放行）**：`git push` 实际已在 guard-check 的 Bash 命令安全白名单内（`BASH_SAFE_PATTERNS` 含 `^git push`），guard **从不拦截 `git push`**——上表把 `git push` 列为被阻断写操作属过时描述，已划除。因此全自动 / 无人值守模式**无需任何 marker 或 guard 例外**即可自动 `git push`；是否自动推送的唯一约束来自生成的指令文本（AGENTS.md/CLAUDE.md）：全自动下指令文本授权 AI 自动 push，半自动 / 手动下要求人工确认。

## ADDED — Bash 写命令路径提取与逐路径管辖判定（规范性）

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
