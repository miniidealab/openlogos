# Delta: core-01-deployment-plan.md

> change: lite-cut3b-verify-layers-and-release-0-15-0
> 目标：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`

## ADDED — OpenLogos 0.15.0 打包方案（隔离验证，不做本机全局安装）

### 部署目标与授权边界

把 OpenLogos Lite 减法的六刀成果冻结为唯一 `@miniidealab/openlogos@0.15.0` tarball，并在一次性隔离 npm prefix 中证明其安装态身份与破坏性契约行为。

**本方案与既往发布的关键差异**：**不执行本机全局安装**。本机全局保持 `0.14.25`。

依据减法方案 §13 保险条款：若阶段 1 就全局装 0.15.0，runlogos 会立刻找不到已删除的命令面而全面失效，届时同时面对两个坏掉的项目、无法二分定位。保持全局 0.14.25 直到 runlogos 侧改造完成、两侧都绿，再单独授权全局切换。

本方案不包含 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 git push。

### 部署前置与冻结事实

1. 本提案 Delta 已 merge、代码切片与 UT/ST/SMOKE runner 已实现并 `openlogos verify` PASS。
2. 冻结当前本机全局 `0.14.25`：`command -v openlogos`、realpath、npm prefix、package/plugin/asset manifest version 与 hash。**该冻结事实在部署前后各取证一次，必须一致**。
3. 固定回滚基线：本机全局本就未被改动，回滚成本为零；隔离 prefix 为 `mktemp -d` 一次性目录，用后即弃。
4. 部署输入绑定可追溯 source commit。

### 0.15.0 版本与制品身份

实现阶段必须同步：CLI `package.json` 与 lockfile 根包版本；全部随包 plugin/资产模板 manifest 版本；package asset manifest 与携带版本的 schema/golden/runner 元数据。任一处残留 `0.14.25` 即判失败（UT-S19-46）。

### 构建与 Tarball 冻结

1. 仓库真实 CLI package 完整 test/build/package-assets 流程；真实 `npm pack`，记录 tarball 路径、字节数、清单与 SHA-256。
2. 从解包 tarball 核对 CLI entry、`0.15.0` version 与 asset-manifest 一致性。
3. 任何重新 pack 产生新 candidate identity。

### 隔离 Prefix 行为矩阵

`mktemp -d` 一次性 npm prefix 安装固定 `0.15.0` tarball，从新 shell / 绝对入口执行；全部提案态在一次性临时项目内构造，**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**：

| 类别 | 必须证明 |
|---|---|
| candidate identity | version、entry realpath、package/asset hash 全部来自固定 tarball，无 workspace link |
| **破坏性命令面（核心验收①）** | `merge transaction status` / `merge-apply` / 切片事务命令一律非零退出——0.15.0 不做兼容层 |
| **直接合并（核心验收②）** | 临时项目内 `merge <slug>` 一次调用完成多目标合并并写 `SPEC_MERGED`，无任何事务中间态文件 |
| **判定层收敛（核心验收③）** | `change-lint` 输出恰 9 项检查（L0～L8）；`verify` 报告不含 Layer1/Layer3 段 |
| **新命令可用（核心验收④）** | `slice plan --file` 与 `lint-specs` 均可执行并给出预期输出 |
| **全局零触碰（核心验收⑤）** | 部署前后 `command -v openlogos` 指向同一路径且 version 均为 `0.14.25`；全局 prefix 下无 0.15.0 制品 |

### 回滚预案

隔离 prefix 为一次性目录，删除即回滚；本机全局未被改动，无需任何恢复动作。若 pack 或隔离矩阵失败，删除临时目录后按失败项修复重跑，**不得以「先装上再说」绕过**。

### 后续（本提案不含，需独立授权）

runlogos 侧改造完成、两侧测试皆绿后，再单独提案执行本机全局 `0.15.0` 安装与端到端连通验证（减法方案 §13 阶段 3～4）。
