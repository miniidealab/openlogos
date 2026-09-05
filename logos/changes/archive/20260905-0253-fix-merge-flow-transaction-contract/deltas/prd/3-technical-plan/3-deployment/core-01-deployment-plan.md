## ADDED — OpenLogos 0.14.19 merge 流程契约自洽本机全局部署方案

### 部署目标与授权边界

把「merge 前沿事务事实（方案 A）+ 后置条件二分 + 投影必挂 + 存量事务 fail-closed + 错误码验收」冻结为唯一 `@miniidealab/openlogos@0.14.19` npm tarball，先在隔离 prefix 完成行为矩阵与回滚演练，再在 verify PASS 且用户明确授权后覆盖本机全局 `openlogos@0.14.18`。部署完成后仍需独立 smoke 授权。

本方案不包含 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 git push。

**本次为何必须部署**：flow 死区存在于**已发布的 0.14.18 全局 CLI**——现场（本仓与 RunLogos driver）merge 后前沿冻结只能靠人为跳过。不部署则死区不消除、RunLogos 提案 `fix-driver-merge-transaction-contract-alignment` 的跨仓验收无法闭合。

**本次为何必须走安装态**：前沿推进是 flow 规格（随包 `spec/flow/launched.yaml`）+ flow-derive 编译产物 + step 注册表的组合行为；两处判据一致性与「merge → 事务 → apply → SPEC_MERGED → step 前进」全链只有安装态能构造；零回归对照（0.14.18 上必须锁死复现死区）同理。

### 部署前置与冻结事实

1. 本提案全部 Delta 已 merge，代码切片与 UT/ST 已真实实现并由 OpenLogos reporter 报告，`openlogos verify` 为 PASS。
2. 冻结当前本机全局 `0.14.18`：`command -v openlogos`、realpath、npm prefix、package/plugin/asset manifest version/hash。
3. 固定回滚制品：`logos/resources/verify/deployment-artifacts/cursor-adapter-parity/miniidealab-openlogos-0.14.18.tgz`（SHA-256 `070ab5622b02129bf20bfae0ec38415fd5058ce32fe90912a21ec7c7c77f534a`，0.14.18 部署窗口冻结件）；回滚自检失败时不得覆盖全局。
4. 部署输入绑定可追溯 source commit。

### 0.14.19 版本与制品身份

实现阶段必须同步：CLI `package.json` 与 lockfile 根包版本；全部随包 plugin/资产模板 manifest 版本；package asset manifest 与携带版本的 schema/golden/runner 元数据；`openlogos --version` 编译输出与 tarball 包名版本；`LOCAL_RELEASE_CANDIDATE_VERSION` 提升为 `0.14.19`、`LOCAL_RELEASE_ROLLBACK_VERSION` 置为 `0.14.18`，并同步发布身份 tripwire 断言。禁止继续以 `0.14.18` 构建新字节。

### 构建与 Tarball 冻结

1. 仓库真实 CLI package 完整 test/build/package-assets 流程；真实 `npm pack`，记录 tarball 路径、字节数、清单与 SHA-256。
2. 从解包 tarball 核对 CLI entry、`0.14.19` version、`spec/flow/launched.yaml` 的新 `done_when`、根规范更新与 reporter 资产。
3. 任何重新 pack 产生新 candidate identity。

### 隔离 Prefix 行为矩阵

`mktemp -d` 一次性 npm prefix 安装固定 `0.14.19` tarball，从新 shell/绝对入口执行：

| 类别 | 必须证明 |
|---|---|
| candidate identity | version、entry realpath、package/asset hash 全部来自固定 tarball，无 workspace link |
| **跨组件全链（核心验收）** | 临时 launched 项目：`merge` 开事务 → `status/next` 即刻 `merge-generated` + `next_node: apply-merge` + `data.merge_transaction` 必挂 → submit-content ×N → seal → apply → `SPEC_MERGED` → `status/next` 前沿越过 merge 段 |
| **merge 幂等与终态** | 非终态重跑 merge 幂等返回、前沿不回退；abort 后重跑归档让位重建、前沿仍 merge-generated |
| **后置条件二分** | no-delta 提案 merge 当场 `SPEC_MERGED` 前沿即进；收尾提示为事务引导（无 MERGE_PROMPT.md 字样） |
| **错误码验收** | 存量失配事务 fixture → 稳定码 + 双方摘要 + remediation；status/next 既有失败路径逐一结构化 `error.code` |
| **legacy 兼容** | legacy 测试模式 marker 路径 done_when 兼容通过（0.13.x 合同回归） |
| **既有能力零回归** | seal/apply/preflight/receipt、0.14.17 终态出路（SMOKE-core-181 断言族）、切片/verify 链路保持通过 |
| rollback roundtrip | `0.14.18→0.14.19→0.14.18→0.14.19` 每阶段 identity 与行为对应固定制品，无混装 |

### 零回归对照（强制，不可省略）

跨组件全链矩阵项必须在固定 `0.14.18` 上执行一次并记录：

| 矩阵项 | 在 0.14.18 上的预期表现 |
|---|---|
| merge 开事务后 status/next | **死区**——`proposal_step` 停 `ready-to-merge`、`next_node` 停 `generate-merge-prompt`（死区本身） |
| apply 后 | `SPEC_MERGED` 在场则前沿越过（旧行为一致） |

若 0.14.18 上前沿也能随开事务推进，说明矩阵空转，必须重写矩阵而非放行部署。

### 本机全局部署

隔离矩阵、零回归对照与 `0.14.18` 回滚演练全部 PASS，且用户明确授权后，把同一 SHA-256 的 `0.14.19` tarball 安装到已冻结 npm global prefix；新 shell 复核 entry/realpath/version 与 manifest 全同源 `0.14.19`。

### 失败处置与回滚边界

- 隔离矩阵失败：停止部署，回实现，重新 verify/build/pack。
- 全局安装后行为异常：以固定 `0.14.18` tarball 回滚并复核 identity 全回 `0.14.18`。
- 不得为让矩阵通过而放宽 done_when、伪造事务文件或跳过零回归对照。

### 追溯

- 需求：merge 流程契约自洽需求「部署与非目标」。
- smoke：SMOKE-core-190。
