# core-01-deployment-plan delta — fix-deploy-done-leak-failclosed-selfheal

## ADDED — OpenLogos 0.14.25 生命周期 fail-closed 本机全局部署方案

### 部署目标与授权边界

把生命周期命令 fail-closed 收口（`openlogos smoke` 前置校验、`openlogos archive` 链条校验）与 `state_inconsistency` 只读对账投影冻结为唯一 `@miniidealab/openlogos@0.14.25` npm tarball，先在隔离 prefix 完成行为矩阵与回滚演练，再在用户明确授权后覆盖本机全局 `openlogos@0.14.24`。部署完成后仍需独立 smoke 授权。

本方案不包含 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 git push。

**本次为何必须部署**：三处缺陷都在**已安装的 CLI 行为**里——本机全局 0.14.24 的 `smoke` 仍会在 deploy 门未过时执行并写 `SMOKE_PASS`、`archive` 仍会归档缺口提案、`status`/`next` 仍在矛盾状态下沉默停滞。不发布不部署，本机所有项目继续带着漏标缺口运行（20260907 事故正是如此发生）。

**本次为何必须走安装态**：验收对象是 `openlogos smoke` / `archive` / `status` / `next` 四个命令的**安装态行为**与其磁盘副作用（marker 是否产生、目录是否移动、guard 是否删除），只有从全局绝对入口驱动真实命令才能取证；库级函数直调不构成闭环证据。

### 部署前置与冻结事实

1. 本提案 Delta 已 merge、代码切片与 UT/SMOKE runner 已实现并 `openlogos verify` PASS。
2. 冻结当前本机全局 `0.14.24`：`command -v openlogos`、realpath、npm prefix、package/plugin/asset manifest version/hash。
3. 固定回滚制品：`logos/resources/verify/deployment-artifacts/fix-guard-check-bash-write-target-jurisdiction/miniidealab-openlogos-0.14.24.tgz`（0.14.24 部署窗口冻结件，部署报告中留痕其 SHA-256）；回滚自检失败时不得覆盖全局。
4. 部署输入绑定可追溯 source commit。

### 0.14.25 版本与制品身份

实现阶段必须同步：CLI `package.json` 与 lockfile 根包版本；全部随包 plugin/资产模板 manifest 版本；package asset manifest 与携带版本的 schema/golden/runner 元数据；`openlogos --version` 编译输出与 tarball 包名版本；`LOCAL_RELEASE_CANDIDATE_VERSION` 提升为 `0.14.25`、`LOCAL_RELEASE_ROLLBACK_VERSION` 置为 `0.14.24`，并同步发布身份 tripwire 断言（UT-S19-45）。禁止继续以 `0.14.24` 构建新字节。

### 构建与 Tarball 冻结

1. 仓库真实 CLI package 完整 test/build/package-assets 流程；真实 `npm pack`，记录 tarball 路径、字节数、清单与 SHA-256。
2. 从解包 tarball 核对 CLI entry、`0.14.25` version 与 asset-manifest 一致性。
3. 任何重新 pack 产生新 candidate identity。

### 隔离 Prefix 行为矩阵

`mktemp -d` 一次性 npm prefix 安装固定 `0.14.25` tarball，从新 shell/绝对入口执行；全部提案态在一次性临时项目内构造，**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**：

| 类别 | 必须证明 |
|---|---|
| candidate identity | version、entry realpath、package/asset hash 全部来自固定 tarball，无 workspace link |
| **smoke fail-closed（核心验收①）** | 需部署需 smoke 提案缺 `DEPLOY_DONE` → `openlogos smoke` 非零退出、`SMOKE_DEPLOY_NOT_DONE`、提示含 `openlogos deploy-done`，且 `smoke.command` 未执行、`SMOKE_PASS`/`SMOKE_FAIL`/`smoke-report.md` 均未产生、`smoke-results.jsonl` 行数未变；`[deploy]` 未全勾 → `SMOKE_DEPLOY_TASKS_INCOMPLETE` |
| **archive fail-closed（核心验收②）** | 缺 `VERIFY_PASS` → `ARCHIVE_VERIFY_NOT_PASSED`；需部署缺 `DEPLOY_DONE`（即使 `SMOKE_PASS` 在场）→ `ARCHIVE_DEPLOY_NOT_DONE`；需 smoke 缺 `SMOKE_PASS` → `ARCHIVE_SMOKE_NOT_PASSED`；三者均**不移动提案目录、不删除 guard** |
| **对账投影（核心验收③）** | 孤儿状态（`SMOKE_PASS` 在场、`DEPLOY_DONE` 缺失、`[deploy]` 全勾）→ `status --format json` 的 `active_change.state_inconsistency` 三字段齐备且 `evidence` 顺序稳定；`next` 人读引导含 `openlogos deploy-done` |
| **补标后放行（核心验收④）** | 执行 `openlogos deploy-done` 后重跑：smoke 进入正常执行路径、archive 链条通过并成功归档、投影字段消失 |
| **零回归** | 无需部署提案 `VERIFY_PASS` 后 archive 照常成功；一致状态下 `status`/`next` 输出无 `state_inconsistency` 键；smoke 前置满足时 gate/覆盖/sandbox 判定与 0.14.24 逐项一致 |
| rollback roundtrip | `0.14.24→0.14.25→0.14.24→0.14.25` 每阶段 identity 与行为对应固定制品，无混装 |

### 零回归对照（强制，不可省略）

fail-closed 与投影矩阵项必须在固定 `0.14.24` 上执行一次并记录：

| 矩阵项 | 在 0.14.24 上的预期表现 |
|---|---|
| 缺 `DEPLOY_DONE` 时 `openlogos smoke` | **照常执行并写入 `SMOKE_PASS`**（缺陷复现） |
| 缺 `DEPLOY_DONE`（或缺 `VERIFY_PASS`）时 `openlogos archive` | **照常成功归档**（缺陷复现） |
| 孤儿状态下 `status --format json` | **无 `state_inconsistency` 字段**（缺陷复现） |
| 前置满足时 smoke gate/覆盖判定、无需部署提案 archive | 与 0.14.25 一致（行为面本就不变） |

若 0.14.24 上缺标场景也被拒绝、或已输出投影字段，说明矩阵空转，必须重写矩阵而非放行部署。

### 本机全局部署

隔离矩阵、零回归对照与 `0.14.24` 回滚演练全部 PASS，且用户明确授权后，把同一 SHA-256 的 `0.14.25` tarball 安装到已冻结 npm global prefix；新 shell 复核 entry/realpath/version 与 manifest 全同源 `0.14.25`，并确认回滚预案（0.14.24 tarball 及其 SHA-256 留痕）就位。

### 失败处置与回滚边界

- 隔离矩阵失败：停止部署，回实现，重新 verify/build/pack。
- 全局安装后行为异常（fail-closed 误伤——前置满足却被拒绝；或投影漂移——一致状态仍输出字段；或缺陷未修复）：以固定 `0.14.24` tarball 回滚并复核 identity 全回 `0.14.24`。
- 不得为让矩阵通过而伪造 marker、手写 `DEPLOY_DONE` 或跳过零回归对照。
- 部署失败时不得写入 `DEPLOY_DONE`；必须输出失败点与回滚建议。部署成功后由 `openlogos deploy-done` 受控落标（S21）。

### 追溯

- 需求：OpenLogos 0.14.25 候选发布需求。
- 功能规格：§2.67.5。
- 场景：S19 OpenLogos 0.14.25 生命周期 fail-closed 候选发布时序。
- 测试：UT-S19-45；smoke：SMOKE-core-196。
