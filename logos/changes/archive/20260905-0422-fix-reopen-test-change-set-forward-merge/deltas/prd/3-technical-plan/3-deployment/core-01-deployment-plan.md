## ADDED — OpenLogos 0.14.20 reopen 前滚修复本机全局部署方案

### 部署目标与授权边界

把「reopen 后 test change set 提案级前滚合并」冻结为唯一 `@miniidealab/openlogos@0.14.20` npm tarball，先在隔离 prefix 完成行为矩阵与回滚演练，再在 verify PASS 且用户明确授权后覆盖本机全局 `openlogos@0.14.19`。部署完成后仍需独立 smoke 授权。

本方案不包含 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 git push。

**本次为何必须部署**：缺陷存在于**已发布的 0.14.19 全局 CLI**——现场任何 reopen 后的提案被迫单切、owned 维度失真；跨仓 RunLogos driver 消费的也是安装态 CLI。

**本次为何必须走安装态**：前滚读取的是安装态 apply 路径在提案目录产生的真实产物链（`MERGE_REOPENS.jsonl` + 归档 receipt + `SPEC_MERGED`）；「reopen → 幂等重合并 → 前滚 → 多切片校验」全链只有安装态能构造；零回归对照（0.14.19 上必须复现空 change set）同理。

### 部署前置与冻结事实

1. 本提案全部 Delta 已 merge，代码切片与 UT/ST 已真实实现并由 OpenLogos reporter 报告，`openlogos verify` 为 PASS。
2. 冻结当前本机全局 `0.14.19`：`command -v openlogos`、realpath、npm prefix、package/plugin/asset manifest version/hash。
3. 固定回滚制品：`logos/resources/verify/deployment-artifacts/fix-merge-flow-transaction-contract/miniidealab-openlogos-0.14.19.tgz`（SHA-256 `ad6575ded72996f9d4bd2b820c96f5358826cc97bd9f1d57f9f08b76bd8109c3`，0.14.19 部署窗口冻结件）；回滚自检失败时不得覆盖全局。
4. 部署输入绑定可追溯 source commit。

### 0.14.20 版本与制品身份

实现阶段必须同步：CLI `package.json` 与 lockfile 根包版本；全部随包 plugin/资产模板 manifest 版本；package asset manifest 与携带版本的 schema/golden/runner 元数据；`openlogos --version` 编译输出与 tarball 包名版本；`LOCAL_RELEASE_CANDIDATE_VERSION` 提升为 `0.14.20`、`LOCAL_RELEASE_ROLLBACK_VERSION` 置为 `0.14.19`，并同步发布身份 tripwire 断言。禁止继续以 `0.14.19` 构建新字节。

### 构建与 Tarball 冻结

1. 仓库真实 CLI package 完整 test/build/package-assets 流程；真实 `npm pack`，记录 tarball 路径、字节数、清单与 SHA-256。
2. 从解包 tarball 核对 CLI entry、`0.14.20` version 与 reporter 资产。
3. 任何重新 pack 产生新 candidate identity。

### 隔离 Prefix 行为矩阵

`mktemp -d` 一次性 npm prefix 安装固定 `0.14.20` tarball，从新 shell/绝对入口执行：

| 类别 | 必须证明 |
|---|---|
| candidate identity | version、entry realpath、package/asset hash 全部来自固定 tarball，无 workspace link |
| **reopen 前滚全链（核心验收）** | 临时 launched 项目：首次 merge 全链 completed（changed 含全部新增 ID）→ reopen --confirm-spec-merged → 仅修正非测试目标、其余 delta 幂等 → 重合并 → `SPEC_MERGED.changed_test_ids` 仍含首轮全部 ID → 多切片 manifest owned 校验通过 |
| **removed 后写胜出** | 本轮删除首轮 ID 的重合并：该 ID 出现在 removed、不在 changed |
| **失配 fail-closed** | 篡改归档 receipt 身份 → seal/apply 稳定拒绝并点名路径 |
| **无留痕零回归** | 未 reopen 的提案全链行为与 0.14.19 一致（change set 逐字节等价） |
| **既有能力零回归** | merge 前沿事务事实（SMOKE-core-190 断言族）、seal/apply/preflight/receipt、切片/verify 链路保持通过 |
| rollback roundtrip | `0.14.19→0.14.20→0.14.19→0.14.20` 每阶段 identity 与行为对应固定制品，无混装 |

### 零回归对照（强制，不可省略）

reopen 前滚矩阵项必须在固定 `0.14.19` 上执行一次并记录：

| 矩阵项 | 在 0.14.19 上的预期表现 |
|---|---|
| reopen 后部分幂等重合并 | **空 change set 复现**——`changed_test_ids` 为空或缺失首轮 ID（缺陷本身） |
| 未 reopen 的提案 | change set 与 0.14.20 一致（旧行为保持） |

若 0.14.19 上 changed 也保持提案级完整，说明矩阵空转，必须重写矩阵而非放行部署。

### 本机全局部署

隔离矩阵、零回归对照与 `0.14.19` 回滚演练全部 PASS，且用户明确授权后，把同一 SHA-256 的 `0.14.20` tarball 安装到已冻结 npm global prefix；新 shell 复核 entry/realpath/version 与 manifest 全同源 `0.14.20`。

### 失败处置与回滚边界

- 隔离矩阵失败：停止部署，回实现，重新 verify/build/pack。
- 全局安装后行为异常：以固定 `0.14.19` tarball 回滚并复核 identity 全回 `0.14.19`。
- 不得为让矩阵通过而伪造留痕/receipt、手改 SPEC_MERGED 或跳过零回归对照。

### 追溯

- 需求：reopen 后 test change set 提案级前滚需求「部署与非目标」。
- smoke：SMOKE-core-191。
