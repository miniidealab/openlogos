# Delta: core-01-feature-specs.md

> change: fix-guard-check-bash-write-target-jurisdiction
> 目标：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`

## ADDED — 2.66 guard-check Bash 写命令路径提取与逐路径管辖判定（含 0.14.24 候选发布验收）

### 2.66.1 问题：管辖边界合同对 Bash 写命令结构性不可达

0.14.22（§2.64）把管辖边界接进了 `is_whitelisted_path`，但 `plugin/bin/guard-check` Bash 分支的消费口径使该合同对 `rm`/`cp`/`mv`/`mkdir`/`touch`/`chmod`/`chown` 类命令不可达：

1. 命令命中 `BASH_WRITE_PATTERNS`（`^rm `、`^cp `、`^mv `、`^mkdir`、`^touch ` 等）即 `NEEDS_BLOCK=1`；
2. `WRITE_TARGET` **只在 `>`/`>>` 重定向形态下提取**，上述命令从不提取路径实参；
3. `WRITE_TARGET` 为空 → 跳过 `is_whitelisted_path`（含管辖边界判定）→ **无条件 block**。

生产实证（2026-09-06，runlogos 仓 launched 无提案）：`rm -rf <session scratchpad 路径>`、`cp <项目外→项目外>` 均被拦——目标全在项目根之外，按合同应放行。

### 2.66.2 路径提取与逐路径管辖判定规则

**路径提取**（仅对命中 `BASH_WRITE_PATTERNS` 的结构化单命令形态生效）：

| 命令族 | 提取范围 |
|---|---|
| `rm` / `mkdir` / `touch` / `chmod` / `chown` | 跳过以 `-` 开头的选项 flag 后的**全量实参** |
| `cp` / `mv` | 跳过选项 flag 后的**全量实参（含源与目标）** |
| `>` / `>>` 重定向 | 既有 `WRITE_TARGET` 提取保持不变 |

**逐路径管辖判定**：每个提取出的路径逐一走既有 `is_whitelisted_path`（含 0.14.22 管辖边界 + `WHITELIST_PREFIXES` 白名单判定）：

- **全部路径均在项目根之外或白名单内** → 放行（exit 0）；
- **任一路径在项目根之内且非白名单** → 维持拦截（`block()` 双通道 stderr 指引保持）。

**解析不出 fail-closed（保守臂）**：命令含变量展开（`$VAR`）、命令替换（`$(…)`/反引号）、管道或复合形态（`|`、`&&`、`;`）等**解析不出确定路径实参**时，维持现行无条件拦截，不放宽；`BASH_SAFE_PATTERNS`（含 `^git push`）先于写模式判定，优先级不变。

**三运行时一致**：路径提取产物交给既有 `is_whitelisted_path`，其 python3 归一化 / node 归一化 / bash 兜底三条路径对同一路径**同判**；提取逻辑本身不因运行时可用性改变结果。

**不变量（安全面零放宽）**：项目根之内的拦截/放行逐项不变——`WHITELIST_PREFIXES`、`BASH_SAFE_PATTERNS`/`BASH_WRITE_PATTERNS` 模式表、拦截文案、stderr 双通道、plan 阶段原型 allowlist、exit 2 阻断合同均保持；硬闸保护面（本项目源码）零收窄。

### 2.66.3 OpenLogos 0.14.24 候选内容与发布验收

`@miniidealab/openlogos@0.14.24` 相对 0.14.23 的全部行为差异即本节修复（提案 `fix-guard-check-bash-write-target-jurisdiction`）：

| # | 内容 | 生效面 |
|---|---|---|
| ① | Bash 写命令路径提取（rm/cp/mv/mkdir/touch/chmod/chown 实参级） | 安装态 guard-check 随包字节 |
| ② | 逐路径管辖判定（全外放行 / 任一内且非白名单拦截 / 解析不出 fail-closed） | 安装态 guard-check 随包字节 |

发布验收口径：

- **身份**：UT-S19-41 tripwire 钉 `LOCAL_RELEASE_CANDIDATE_VERSION=0.14.24`/`ROLLBACK=0.14.23` 与全源一致。
- **安装态行为**：SMOKE-core-195 承载——Bash 写命令管辖判定全链（全外路径 `rm`/`cp` 放行、任一项目内非白名单路径拦截且 stderr 含指引、解析不出维持拦截、项目内拦截与安全白名单零回归）、固定 0.14.23 对照（复现全外路径误拦截，防断言空转）、roundtrip 无混装。
- **发布边界**：仅本机全局；部署与 smoke 各为独立人类确认点；矩阵失败停止部署回实现，全局异常按固定 0.14.23 tarball（sha256 `de042d28…07a5b`）回滚。
