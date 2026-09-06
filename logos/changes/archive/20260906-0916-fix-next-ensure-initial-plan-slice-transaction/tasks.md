# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：S28 补 plan-slices 节点携 canonical 事务投影验收；S32 补 initial-plan 问即建时机验收；S19 补 0.14.23 候选发布要求
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：新增 2.65 next 对 initial-plan 事务的 ensure 语义与投影输出（触发条件、幂等、失败如实口径、与 recovery/用即建的关系）
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S28-next-node.md`：next-node 派生补 initial-plan ensure 分支时序
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md`：事务创建时机前移为 next 问即建、submit-content 用即建降为幂等兜底
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：S19 新增 0.14.23 候选发布节（身份冻结→隔离矩阵→全局覆盖→smoke 与失败回滚边界）
- [x] [MODIFY] `deltas/spec/test-slice-manifest.md`：initial-plan 事务创建时机合同补「next 问即建」，用即建标注为幂等兜底
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：next 输出在 ready-to-implement 携带 slice_transaction 投影的字段口径
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：新增 0.14.23 本机全局部署方案章节（隔离矩阵 + 0.14.22 无投影对照 + 回滚制品固定 0.14.22 tarball）
- [x] [MODIFY] `deltas/test/core-S28-test-cases.md`：next ensure 分支用例（初达创建+投影、幂等重入、失败如实、非 plan-slices 节点不创建；新 ID 自 UT-S28-50 / ST-S28-16 起）
- [x] [MODIFY] `deltas/test/core-S32-test-cases.md`：创建时机前移用例（next 已建后 submit-content 幂等续用、懒创建路径零回归；新 ID 自 UT-S32-71 起）
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：0.14.23 候选身份全源一致与回滚身份 0.14.22 tripwire（新 ID 自 UT-S19-40 起）
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：SMOKE-core-194（安装态 next ensure 全链 + 0.14.22 无投影缺陷复现对照 + roundtrip）

## [code] 代码实现

> 六维打分：影响范围 1（cli/src/commands/next.ts ensure 分支 + 版本身份文件族 + runner + 四个测试文件）、行为复杂度 1（ensure 四分支：无事务创建/活跃只读/终态只读不归档/失败如实，外加非触发零回归）、契约变化 1（next 输出在 ready-to-implement 新增携带 slice_transaction 投影 + 候选身份推进，无 API/DB）、测试规模 1（8 个新 ID）、风险 1（部署提案但回滚制品固定 0.14.22 tarball）、不确定性 0（死锁机理已由 runlogos 4 提案实证定性，恢复分支有同构先例）→ 5 分，非大任务，单切片。
> 删后续自检：单切片无后续可删。曾拟拆「next ensure 修复片」+「0.14.23 身份与 runner 片」：UT-S19-40 断言候选身份精确 0.14.23 且 SMOKE-core-194 runner 已接线——前片单独跑全量 verify 时 UT-S19-40（身份仍 0.14.22、runner 不存在）必红，(a) 否；后片单独做则 ensure 新行为不存在，SMOKE-core-194 的问即建断言无字节可验，(b) 亦否。两片共享同一候选发布事实，互相咬死，向前合并为单片。
- [x] 单切片：next 问即建修复 + 0.14.23 候选身份与 SMOKE-core-194 runner——`cli/src/commands/next.ts` 在模块产出层（与 manifest-recovery 分支同层、同构）新增 initial-plan ensure：`proposal_step==ready-to-implement` ∧ `[code]` 标题在场切片未填 ∧ 提案未归档且无 manifest 失效态时，无事务则 `createTestSliceTransaction(origin: initial-plan)` 并输出 `slice_transaction` canonical 投影，已有事务（任意 phase 含终态）只读投影不重建不归档，创建失败省略字段且 detail 携错误信息，幂等（`transaction_id` 稳定）；非触发场景（其它 proposal_step/无 `[code]` 标题/无活跃提案/initial）零变化；`submit-content` 用即建保留为幂等兜底；0.14.23 候选身份全链同步（package/lockfile/五 plugin manifest/asset-manifest/`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.23`、`ROLLBACK=0.14.22`/tripwire/golden）；新增 `scripts/smoke-next-ensure-0-14-23.js`（candidate identity + 安装态问即建全链 + 幂等续用 + 非触发零回归 + 0.14.22 无投影缺陷复现对照 + 0.14.22↔0.14.23 roundtrip）并接入 `scripts/run-smoke.js` 注册表、写 `logos/resources/verify/smoke-results.jsonl`、完成后跑 smoke 覆盖预检；实现含 OpenLogos reporter 的 UT-S28-50～52、ST-S28-16、UT-S32-71～72、UT-S19-40、SMOKE-core-194

## [deploy] 部署任务
- [x] 按部署方案 0.14.23 章节执行隔离矩阵（SMOKE-core-194 runner：candidate identity、next ensure 全链、0.14.22 无投影缺陷复现对照、roundtrip 回滚演练）——0.14.23 tarball sha256 de042d28db4e143a0da0e1e4dc63a9169557ac9cc4dde4ead8e8164ccf507a5b，矩阵 PASS（证据：deployment-artifacts/fix-next-ensure-initial-plan-slice-transaction/matrix-smoke-results.jsonl）
- [x] 矩阵与回滚演练 PASS 后，覆盖安装 0.14.23 tarball 到本机全局 prefix（`/opt/homebrew`），新 shell 复核 identity 全同源 0.14.23，并确认回滚预案（0.14.22 tarball，sha256 0bdcefb3…83ac1）就位——新 shell 复核 entry/realpath/version/五 manifest/asset-manifest 全 0.14.23，随包 next.js 含问即建新字节
