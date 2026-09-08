# 实现任务

## [delta] 规格变更

- [ ] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：在既有「Preflight 与可修复 reopen 验收要求」段补第四个死锁面的验收要求——合同兼容门的适用面按「该动作是否需要按旧合同解释存量数据」划定（终态出路 abort/reopen 不在其拦截范围），并补「任何终态在任何合同状态下都存在受控、留痕、可审计的出路」这一验收条件；既有 AC-MT-PF-* 逐条不变。
- [ ] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：§2.58 补「2.58.5 合同兼容门与终态出路的边界」——按「该动作是否需要按旧合同解释存量数据」这一地面真值划定合同门适用面：`submit_content` / `seal` / `apply` / `recover`（按事务内容推进）继续受拦，逐字不变；`abort`（既有豁免）与 `reopen`（本次新增豁免，动作序列为留痕 → 原样归档 → 作废 marker → 按当前 CLI 重建，全程不解释旧内容）不受拦；并在 2.58.3 准入矩阵补「`phase=completed` 且合同不一致」行（reopen 仍允许，重开后由当前 CLI 重建新事务并写入新合同摘要，天然完成迁移而不承诺就地迁移）。按 C01 决定是否同时记「合同不一致时 completed 的 `allowed_actions` 补 `abort` 冗余出边」。§2.58.1/2.58.2/2.58.4 与 seal/apply/preflight/receipt 判据逐字不变。
- [ ] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：新增合同兼容门与终态出路交互的时序与异常臂——跨版本 completed 走 reopen 成功重建（含新旧合同摘要留痕）、跨版本 sealed/collecting 的写动作仍 fail-closed 拒绝（零回归）、reopen 过程任一步失败整体不生效（回退全旧态）、以及「合同不一致 × 各相位」的出路矩阵；新 EX 编号按 S09 现有末号连续分配。
- [ ] [MODIFY] `deltas/test/core-S09-test-cases.md`：新增回归锚与边界用例（新 ID 自 UT-S09-322 / ST-S09-125 起连续分配）——① 回归锚必红→必绿：复刻 runlogos 现场（0.14.24 建 completed 事务 + 0.14.25 合同摘要，SPEC_MERGED 在场），旧行为 reopen 抛 `unsupported_contract` 且 abort 抛 `action_not_allowed`（必红），新行为 reopen 成功留痕/归档/作废 marker 并重建新事务（必绿）；② 合同门零回归对照矩阵：跨版本 `submit_content`/`seal`/`apply`/`recover` 仍 `unsupported_contract`、retryable:false、details 携双方版本与摘要；③ reopen 既有准入矩阵逐行零回归（缺 `--reason` 拒、SPEC_MERGED 在场未附 `--confirm-spec-merged` 拒且零副作用、marker 不可判定 fail-closed、非 completed 相位 `action_not_allowed`）；④ 崩溃一致性：跨版本 reopen 在留痕/归档/marker 三步各注入故障，均整体不生效、回退全旧态；⑤ UT-S09-308 的 remediation 断言在各相位成立性对照（含 completed）；⑥ 按 C01 决定是否加 completed 合同不一致的 abort 冗余出边用例。
- [ ] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：新增 0.14.26 章节（候选身份全链同步、隔离验证矩阵、全局覆盖安装、0.14.25 回滚 tarball 预案）——按 C02 决定是否纳入。
- [ ] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：0.14.26 安装态验收用例（跨版本 completed 事务可 reopen、既有写动作合同门零回归）——按 C02 决定是否纳入。

## [deploy] 部署任务
- [ ] 按部署方案 0.14.26 章节执行隔离验证矩阵（跨版本 completed reopen 必绿、合同门写动作零回归拒绝矩阵、reopen 准入矩阵零回归、崩溃回退、0.14.25 死锁复现对照、roundtrip 回滚演练），PASS 后覆盖安装 0.14.26 tarball 到本机全局 prefix（`/opt/homebrew`），新 shell 复核 identity 全同源 0.14.26
- [ ] 确认回滚预案就位（0.14.25 tarball 及 sha256 留痕），完成后运行 `openlogos deploy-done` 受控落标（部署失败不得写 DEPLOY_DONE，输出失败点与回滚建议）

## [code] 代码实现
（本段在 plan 段留空：本提案需要代码实现，但 `[code]` 切片由 merge 后的 `slice-planner` 基于已合并规格和真实 UT/ST ID 统一规划。此处仅保留 `## [code]` 标题，勿提前填写切片项。）
