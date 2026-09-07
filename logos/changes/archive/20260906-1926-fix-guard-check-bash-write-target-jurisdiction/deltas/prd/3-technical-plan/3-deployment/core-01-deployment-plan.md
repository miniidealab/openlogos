# Delta: core-01-deployment-plan.md

> change: fix-guard-check-bash-write-target-jurisdiction
> 目标：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`

## ADDED — OpenLogos 0.14.24 guard Bash 管辖判定本机全局部署方案

### 部署目标与授权边界

把 guard-check Bash 写命令路径提取与逐路径管辖判定修复冻结为唯一 `@miniidealab/openlogos@0.14.24` npm tarball，先在隔离 prefix 完成行为矩阵与回滚演练，再在用户明确授权后覆盖本机全局 `openlogos@0.14.23`。部署完成后仍需独立 smoke 授权。

本方案不包含 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 git push。

**本次为何必须部署**：误拦存在于**已安装的 0.14.23 CLI**——guard-check 是随 `openlogos sync` 分发到各项目的托管资产，Bash 分支对 `rm`/`cp`/`mv`/`mkdir` 类命令从不提取路径实参、无条件拦截；不发布不部署则存量项目（含 runlogos）在无提案期继续误拦项目外写入（session scratchpad、用户级文件）。

**本次为何必须走安装态**：各项目消费的是 sync 部署的 `.claude/openlogos/bin/guard-check` 随包字节；「新判定逻辑随 sync 到位」只有安装态能实测。

### 部署前置与冻结事实

1. 本提案 Delta 已 merge、代码切片与 UT/SMOKE runner 已实现并 verify PASS。
2. 冻结当前本机全局 `0.14.23`：`command -v openlogos`、realpath、npm prefix、package/plugin/asset manifest version/hash。
3. 固定回滚制品：`logos/resources/verify/deployment-artifacts/fix-next-ensure-initial-plan-slice-transaction/miniidealab-openlogos-0.14.23.tgz`（SHA-256 `de042d28db4e143a0da0e1e4dc63a9169557ac9cc4dde4ead8e8164ccf507a5b`，0.14.23 部署窗口冻结件）；回滚自检失败时不得覆盖全局。
4. 部署输入绑定可追溯 source commit。

### 0.14.24 版本与制品身份

实现阶段必须同步：CLI `package.json` 与 lockfile 根包版本；全部随包 plugin/资产模板 manifest 版本；package asset manifest 与携带版本的 schema/golden/runner 元数据；`openlogos --version` 编译输出与 tarball 包名版本；`LOCAL_RELEASE_CANDIDATE_VERSION` 提升为 `0.14.24`、`LOCAL_RELEASE_ROLLBACK_VERSION` 置为 `0.14.23`，并同步发布身份 tripwire 断言。禁止继续以 `0.14.23` 构建新字节。

### 构建与 Tarball 冻结

1. 仓库真实 CLI package 完整 test/build/package-assets 流程；真实 `npm pack`，记录 tarball 路径、字节数、清单与 SHA-256。
2. 从解包 tarball 核对 CLI entry、`0.14.24` version 与 asset-manifest 一致性（含 guard-check 新字节的 manifest 条目）。
3. 任何重新 pack 产生新 candidate identity。

### 隔离 Prefix 行为矩阵

`mktemp -d` 一次性 npm prefix 安装固定 `0.14.24` tarball，从新 shell/绝对入口执行：

| 类别 | 必须证明 |
|---|---|
| candidate identity | version、entry realpath、package/asset hash 全部来自固定 tarball，无 workspace link |
| **项目外放行（核心验收①）** | 隔离 prefix init 新项目 → launched 无提案，以 stdin JSON + env 驱动随包 guard-check：`rm -rf <项目外路径>`（session scratchpad 形态）、`cp <项目外→项目外>`、`mkdir <项目外>` → 一律 exit 0 放行 |
| **项目内拦截零回归（核心验收②）** | `rm <项目内源码>`、混合形态 `cp <项目外> <项目内非白名单>` → exit 2 且 stderr 含变更管理指引、stdout `{"reason":…}` JSON 结构不变；白名单路径目标放行；`git push` 等安全白名单先判放行；`>`/`>>` 重定向判定不变 |
| **解析不出保守臂（核心验收③）** | 变量展开（`$VAR`）、命令替换（`$(…)`）、管道复合形态命中写模式 → exit 2 维持现行拦截，不放宽 |
| rollback roundtrip | `0.14.23→0.14.24→0.14.23→0.14.24` 每阶段 identity 与行为对应固定制品，无混装 |

### 零回归对照（强制，不可省略）

Bash 管辖判定矩阵项必须在固定 `0.14.23` 上执行一次并记录：

| 矩阵项 | 在 0.14.23 上的预期表现 |
|---|---|
| 全外路径 `rm -rf <项目外>` / `cp <外→外>` | **exit 2 误拦截**（缺陷复现） |
| 项目内非白名单拦截与安全白名单放行 | 与 0.14.24 一致（安全面本就不变） |

若 0.14.23 上全外路径写命令也放行，说明矩阵空转，必须重写矩阵而非放行部署。

### 本机全局部署

隔离矩阵、零回归对照与 `0.14.23` 回滚演练全部 PASS，且用户明确授权后，把同一 SHA-256 的 `0.14.24` tarball 安装到已冻结 npm global prefix；新 shell 复核 entry/realpath/version 与 manifest 全同源 `0.14.24`，并确认回滚预案（0.14.23 tarball，sha256 `de042d28…07a5b`）就位。

### 失败处置与回滚边界

- 隔离矩阵失败：停止部署，回实现，重新 verify/build/pack。
- 全局安装后行为异常（误拦复发或安全面放宽）：以固定 `0.14.23` tarball 回滚并复核 identity 全回 `0.14.23`。
- 不得为让矩阵通过而伪造 guard 输出或跳过零回归对照。

### 追溯

- 需求：OpenLogos 0.14.24 候选发布需求。
- smoke：SMOKE-core-195。
