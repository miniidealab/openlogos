# Delta: core-01-deployment-plan.md（fix-guard-check-external-path-and-stderr）

## ADDED — OpenLogos 0.14.22 guard 修复本机全局部署方案

### 部署目标与授权边界

把 guard-check 两处修复（管辖边界、阻断 stderr 可见性）冻结为唯一 `@miniidealab/openlogos@0.14.22` npm tarball，先在隔离 prefix 完成行为矩阵与回滚演练，再在用户明确授权后覆盖本机全局 `openlogos@0.14.21`。部署完成后仍需独立 smoke 授权。

本方案不包含 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 git push。

**本次为何必须部署**：两处缺陷存在于**已安装的 0.14.21 全局 CLI**——项目根之外路径被误拦截（如用户级 `~/.claude` 记忆文件写入）、拦截原因只写 stdout 导致 Claude Code 显示 "No stderr output"；不发布则修复永不生效，runlogos 只能长期依赖未提交的本地热修。

**本次为何必须走安装态**：guard-check 为随包 bin，经 init/sync 落盘到各项目 `.claude/openlogos/bin/`；「存量项目 sync 刷新字节」只有安装态能实测。

### 部署前置与冻结事实

1. 本提案 Delta 已 merge、代码切片与 UT/SMOKE runner 已实现并 verify PASS。
2. 冻结当前本机全局 `0.14.21`：`command -v openlogos`、realpath、npm prefix、package/plugin/asset manifest version/hash。
3. 固定回滚制品：`logos/resources/verify/deployment-artifacts/deploy-0-14-21-guard-hook-release/miniidealab-openlogos-0.14.21.tgz`（SHA-256 `ac173f5fddff6717bfaf15787ee7ebf9c5029837277e71c20c77370abf5c285f`，0.14.21 部署窗口冻结件）；回滚自检失败时不得覆盖全局。
4. 部署输入绑定可追溯 source commit。

### 0.14.22 版本与制品身份

实现阶段必须同步：CLI `package.json` 与 lockfile 根包版本；全部随包 plugin/资产模板 manifest 版本；package asset manifest 与携带版本的 schema/golden/runner 元数据；`openlogos --version` 编译输出与 tarball 包名版本；`LOCAL_RELEASE_CANDIDATE_VERSION` 提升为 `0.14.22`、`LOCAL_RELEASE_ROLLBACK_VERSION` 置为 `0.14.21`，并同步发布身份 tripwire 断言。禁止继续以 `0.14.21` 构建新字节。

### 构建与 Tarball 冻结

1. 仓库真实 CLI package 完整 test/build/package-assets 流程；真实 `npm pack`，记录 tarball 路径、字节数、清单与 SHA-256。
2. 从解包 tarball 核对 CLI entry、`0.14.22` version、随包 `claude-plugin-template/bin/guard-check` 新字节（含管辖边界判定与 block() stderr 输出）与 asset-manifest 的 guard-check 条目。
3. 任何重新 pack 产生新 candidate identity。

### 隔离 Prefix 行为矩阵

`mktemp -d` 一次性 npm prefix 安装固定 `0.14.22` tarball，从新 shell/绝对入口执行：

| 类别 | 必须证明 |
|---|---|
| candidate identity | version、entry realpath、package/asset hash 全部来自固定 tarball，无 workspace link |
| **管辖边界（核心验收①）** | launched 无提案项目：Edit/Write 项目根之外目标（`~/.claude/projects/**` 形态路径与另一临时仓库绝对路径）→ exit 0 放行；Bash 重定向项目外目标 → 放行 |
| **阻断 stderr 可见性（核心验收②）** | 同项目 Edit 项目内源码 → exit 2 且 **stderr 含「变更管理拦截」与 `openlogos change` 指引**、stdout `{"reason":…}` JSON 结构不变；Step 0 fail-closed 两形态（变量指向坏目录 / 变量缺失且 cwd 非根）→ exit 2 且 stderr 非空 |
| **项目内判定零回归** | 白名单路径放行、有提案放行、`git push` 等 BASH_SAFE_PATTERNS 放行——逐项与 0.14.21 一致 |
| rollback roundtrip | `0.14.21→0.14.22→0.14.21→0.14.22` 每阶段 identity 与行为对应固定制品，无混装 |

### 零回归对照（强制，不可省略）

guard 矩阵项必须在固定 `0.14.21` 上执行一次并记录：

| 矩阵项 | 在 0.14.21 上的预期表现 |
|---|---|
| 项目外路径 Edit/Write | **exit 2 误拦截**（缺陷①复现） |
| 项目内源码拦截 | exit 2 但 **stderr 为空**（缺陷②复现，Claude Code 侧即 "No stderr output"） |

若 0.14.21 上项目外也放行、或 stderr 也非空，说明矩阵空转，必须重写矩阵而非放行部署。

### 本机全局部署

隔离矩阵、零回归对照与 `0.14.21` 回滚演练全部 PASS，且用户明确授权后，把同一 SHA-256 的 `0.14.22` tarball 安装到已冻结 npm global prefix；新 shell 复核 entry/realpath/version 与 manifest 全同源 `0.14.22`。

### 失败处置与回滚边界

- 隔离矩阵失败：停止部署，回实现，重新 verify/build/pack。
- 全局安装后行为异常：以固定 `0.14.21` tarball 回滚并复核 identity 全回 `0.14.21`。
- 不得为让矩阵通过而伪造 guard 输出或跳过零回归对照。

### 追溯

- 需求：OpenLogos 0.14.22 guard 修复候选发布需求。
- smoke：SMOKE-core-193。
