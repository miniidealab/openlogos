# Delta: core-01-requirements.md

> change: fix-guard-check-bash-write-target-jurisdiction
> 目标：`logos/resources/prd/1-product-requirements/core-01-requirements.md`

## ADDED — guard-check Bash 写命令路径级管辖判定需求

### 用户价值

0.14.22 立下的管辖边界合同——「guard 只管本项目源码的变更可追溯性，项目根之外的写入交宿主权限系统」——必须对 **Bash 写命令同样成立**。现状是该合同在 `plugin/bin/guard-check` 的 Bash 分支对 `rm`/`cp`/`mv`/`mkdir`/`touch`/`chmod`/`chown` 类命令**结构性不可达**：命令命中 `BASH_WRITE_PATTERNS` 即预备拦截，但 `WRITE_TARGET` 只在 `>`/`>>` 重定向形态下提取，上述命令从不提取路径实参，`WRITE_TARGET` 为空即跳过 `is_whitelisted_path`（含 0.14.22 已修好的管辖边界判定）而**无条件拦截**。生产实证（2026-09-06，runlogos 仓 launched 无提案）：`rm -rf <session scratchpad 路径>`、`cp <项目外→项目外>` 均被误拦——目标全在项目根之外，按合同应放行；日常 AI 会话在无提案期写 scratchpad / 用户级文件被持续误拦，与 0.14.22 合同自相矛盾（来源：runlogos 仓 `logos/resources/reference/openlogos-guard-check-bash-branch-external-path-still-blocked-bug-report.md`）。

### Bash 写命令路径级管辖判定要求

1. **路径提取**：命中 `BASH_WRITE_PATTERNS` 的 `rm`/`cp`/`mv`/`mkdir`/`touch`/`chmod`/`chown` 类命令，跳过以 `-` 开头的选项 flag 后提取**全部路径实参**（`rm`/`mkdir`/`touch`/`chmod`/`chown` 全量实参；`cp`/`mv` 全量实参含源与目标）；既有 `>`/`>>` 重定向目标提取保持不变。
2. **逐路径管辖判定**：每个提取出的路径逐一走既有 `is_whitelisted_path`（含 0.14.22 管辖边界与白名单前缀判定）——**全部路径均在项目根之外或白名单内 → 放行**；**任一路径在项目根之内且非白名单 → 维持拦截**（携既有 stderr 双通道指引）。
3. **解析不出 fail-closed**：含变量展开、命令替换、管道/复合形态等解析不出路径实参的命令，**维持现行无条件拦截**，fail-closed 不放宽；`BASH_SAFE_PATTERNS`（含 `^git push`）优先级不变。
4. **三运行时一致**：python3 归一化、node 归一化与 bash 兜底三条判定路径对同一命令**同判**。
5. **安全面零放宽**：项目根之内的拦截/放行判定逐项不变——白名单前缀表、拦截文案、stderr 双通道、plan 阶段原型 allowlist、exit 2 阻断合同均保持；硬闸保护面（本项目源码）零收窄。

### 场景验收条件

#### S09 变更生命周期

- launched 无提案时：Bash `rm`/`cp`/`mv`/`mkdir`/`touch`/`chmod`/`chown` 命令的**全部路径实参在项目根之外**（含 session scratchpad、用户级 `~/.claude` 形态路径、项目外→项目外的 `cp`）→ exit 0 放行；**任一路径实参在项目根之内且非白名单** → exit 2 拦截且 stderr 含变更管理指引；**解析不出**（变量展开/命令替换/管道复合）→ exit 2 维持现行拦截（fail-closed）。

### 非目标

- 不改变 Edit/Write 分支判定；不改变 `BASH_SAFE_PATTERNS`/`BASH_WRITE_PATTERNS` 模式表本身；不实现完整 shell 解析器（解析不出即保守拦截）；不触及其它宿主（zcode/qoder/workbuddy/cursor）适配层合同。

## ADDED — OpenLogos 0.14.24 候选发布需求

### 用户价值

Bash 写命令路径级管辖判定修复必须发布到本机全局才能生效：误拦存在于**已安装的 0.14.23 CLI** 随 `openlogos sync` 分发到各项目的 guard-check 托管资产；不发布不部署则存量项目（含 runlogos）继续误拦项目外写入。发布 0.14.24 后存量项目一次 `openlogos sync` 即刷新 guard-check 字节（用户决策 C01：「捆绑 0.14.24 + 全局部署 + smoke」）。

### 候选发布要求（S19）

1. **候选身份链同步**：CLI package/lockfile、全部随包 plugin/资产模板 manifest、package asset manifest、`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.24`、`LOCAL_RELEASE_ROLLBACK_VERSION=0.14.23` 与发布身份 tripwire/golden 全链一致；真实 `npm pack` 冻结唯一 tarball SHA-256。
2. **隔离矩阵（部署前强制）**：一次性 npm prefix 安装固定 tarball，从绝对入口验收——candidate identity 无 workspace link；**Bash 写命令管辖判定全链**（launched 无提案：全外路径 `rm`/`cp` 放行 exit 0；任一项目内非白名单路径拦截 exit 2 且 stderr 含指引；解析不出维持拦截）；`0.14.23→0.14.24` roundtrip 无混装。
3. **零回归对照（强制）**：同一全外路径 `rm`/`cp` 场景在固定 `0.14.23` 上必须复现**误拦截 exit 2**（缺陷本身）；旧版也放行则矩阵空转，必须重写矩阵而非放行部署。
4. **全局覆盖与 smoke**：矩阵与回滚演练 PASS 且用户授权后覆盖本机全局；新 shell 复核 identity 全同源 `0.14.24`；`openlogos smoke`（SMOKE-core-195）独立授权执行。
5. 回滚制品固定 0.14.23 tarball（SHA-256 `de042d28db4e143a0da0e1e4dc63a9169557ac9cc4dde4ead8e8164ccf507a5b`）；回滚自检失败不得覆盖全局。

### 场景验收条件

#### S19 候选发布与 smoke 门禁

- 0.14.24 候选身份全源一致（UT-S19-41 tripwire）；SMOKE-core-195 全链 PASS 且 0.14.23 误拦对照有效；部署与 smoke 各为独立人类确认点。

### 非目标

- 除 Bash 写命令路径级管辖判定修复外零新增语义；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
