# Delta: core-01-deployment-plan.md（fix-next-ensure-initial-plan-slice-transaction）

## ADDED — OpenLogos 0.14.23 next 问即建本机全局部署方案

### 部署目标与授权边界

把 next 问即建修复（initial-plan 事务 ensure + `slice_transaction` 投影输出）冻结为唯一 `@miniidealab/openlogos@0.14.23` npm tarball，先在隔离 prefix 完成行为矩阵与回滚演练，再在用户明确授权后覆盖本机全局 `openlogos@0.14.22`。部署完成后仍需独立 smoke 授权。

本方案不包含 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 git push。

**本次为何必须部署**：死锁存在于**已安装的 0.14.22 全局 CLI**——其 `next` 在正常 ready-to-implement 路径不创建事务、不输出投影，runlogos 全自动流程每个新提案首达 plan-slices 必然 blocked、需人工代跑 slice-planner 绕过；不发布则修复永不生效。

**本次为何必须走安装态**：消费方 driver 调用的是全局安装的 `openlogos next`；「投影随 next 输出到位」只有安装态能实测。

### 部署前置与冻结事实

1. 本提案 Delta 已 merge、代码切片与 UT/SMOKE runner 已实现并 verify PASS。
2. 冻结当前本机全局 `0.14.22`：`command -v openlogos`、realpath、npm prefix、package/plugin/asset manifest version/hash。
3. 固定回滚制品：`logos/resources/verify/deployment-artifacts/fix-guard-check-external-path-and-stderr/miniidealab-openlogos-0.14.22.tgz`（SHA-256 `0bdcefb37a0743575d44c7645169c0c668bbcaaa22e206e7e209325f8a283ac1`，0.14.22 部署窗口冻结件）；回滚自检失败时不得覆盖全局。
4. 部署输入绑定可追溯 source commit。

### 0.14.23 版本与制品身份

实现阶段必须同步：CLI `package.json` 与 lockfile 根包版本；全部随包 plugin/资产模板 manifest 版本；package asset manifest 与携带版本的 schema/golden/runner 元数据；`openlogos --version` 编译输出与 tarball 包名版本；`LOCAL_RELEASE_CANDIDATE_VERSION` 提升为 `0.14.23`、`LOCAL_RELEASE_ROLLBACK_VERSION` 置为 `0.14.22`，并同步发布身份 tripwire 断言。禁止继续以 `0.14.22` 构建新字节。

### 构建与 Tarball 冻结

1. 仓库真实 CLI package 完整 test/build/package-assets 流程；真实 `npm pack`，记录 tarball 路径、字节数、清单与 SHA-256。
2. 从解包 tarball 核对 CLI entry、`0.14.23` version 与 asset-manifest 一致性。
3. 任何重新 pack 产生新 candidate identity。

### 隔离 Prefix 行为矩阵

`mktemp -d` 一次性 npm prefix 安装固定 `0.14.23` tarball，从新 shell/绝对入口执行：

| 类别 | 必须证明 |
|---|---|
| candidate identity | version、entry realpath、package/asset hash 全部来自固定 tarball，无 workspace link |
| **next 问即建（核心验收①）** | 安装态构造 ready-to-implement 提案（spec-complete、`[code]` 标题在场切片未填）→ `next --format json` 携带 `slice_transaction` 投影（`origin=initial-plan`、`phase=collecting`、`content_slots.required=2`）且 `TEST_SLICE_TRANSACTION.json` 落盘 |
| **幂等与续用（核心验收②）** | 重跑 `next` 投影 `transaction_id` 不变；`submit-content` 续用同一事务不重建 |
| **非触发场景零回归** | 非 ready-to-implement 前沿（如 delta-writing）`next` 不创建事务、不输出该字段 |
| rollback roundtrip | `0.14.22→0.14.23→0.14.22→0.14.23` 每阶段 identity 与行为对应固定制品，无混装 |

### 零回归对照（强制，不可省略）

next ensure 矩阵项必须在固定 `0.14.22` 上执行一次并记录：

| 矩阵项 | 在 0.14.22 上的预期表现 |
|---|---|
| ready-to-implement 场景 `next --format json` | 输出**不含 `slice_transaction` 字段**且 `TEST_SLICE_TRANSACTION.json` **不落盘**（缺陷复现） |

若 0.14.22 上也有投影或事务文件也落盘，说明矩阵空转，必须重写矩阵而非放行部署。

### 本机全局部署

隔离矩阵、零回归对照与 `0.14.22` 回滚演练全部 PASS，且用户明确授权后，把同一 SHA-256 的 `0.14.23` tarball 安装到已冻结 npm global prefix；新 shell 复核 entry/realpath/version 与 manifest 全同源 `0.14.23`。

### 失败处置与回滚边界

- 隔离矩阵失败：停止部署，回实现，重新 verify/build/pack。
- 全局安装后行为异常：以固定 `0.14.22` tarball 回滚并复核 identity 全回 `0.14.22`。
- 不得为让矩阵通过而伪造 next 输出或跳过零回归对照。

### 追溯

- 需求：OpenLogos 0.14.23 候选发布需求。
- smoke：SMOKE-core-194。
