# 实现任务

## [delta] 规格变更

- [x] [CREATE] `deltas/decisions/core-D10-merge-frontier-transaction-fact.md`：记录 merge 前沿权威事实切换（marker → 事务在盘）与两条跨仓合同不变量（后置条件二分、存量事务不迁移 fail-closed）的长期决策。
- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：新增 S05/S09/S16 的 merge 前沿推进、事务投影必挂与错误码验收条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：定义 merge flow 契约自洽功能规格（done_when 事务事实、后置条件二分、投影必挂、存量事务 fail-closed、错误 envelope 验收）。
- [x] [MODIFY] `deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md`：merge 收尾提示从「执行 MERGE_PROMPT.md」改为事务引导文案（submit-content → seal → apply）。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：确立 merge 前沿判据与事务事实同源（authority cutover），marker 影子判据退休。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`：补充 merge 事务各相位下 next 的前沿与引导时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：补充「开事务 → merge-generated → apply-merge 派活 → SPEC_MERGED → coding」生产链路时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`：补充 merge_transaction 投影必挂与失败路径结构化错误码的机器消费时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义 0.14.19 本机全局部署方案（隔离矩阵含跨组件全链验收与 0.14.18 死区零回归对照、固定回滚制品）。
- [x] [MODIFY] `deltas/spec/change-management.md`：merge 流程段改述为事务语义并成文中间态合法性。
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：成文 merge 后置条件二分、投影「必挂」升格、存量事务失配稳定错误码与 remediation、status/next 失败路径结构化 error.code 验收。
- [x] [MODIFY] `deltas/spec/flow-spec.md`：merge-generated 权威 done 事实改述为事务在盘（step 枚举与序列不变）。

说明（非 delta 工作，merge 后归 [code] 切片）：`spec/flow/launched.yaml` 的 done_when/artifacts_hint 变更（方案 A 核心）经合并事务整文件协议不可交付（白名单不含 flow YAML），改由 [code] 切片与 flow-derive 同批实现，保证两处判据一次同源落地；权威规格文本见 flow-spec §12.10。
- [x] [MODIFY] `deltas/test/core-S05-test-cases.md`：补充 next 在事务各相位的前沿推导、引导文案与投影透传 UT/ST。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：补充 flow-derive 事务判据、merge 后置条件二分、legacy marker 兼容、存量事务失配 fail-closed UT/ST。
- [x] [MODIFY] `deltas/test/core-S16-test-cases.md`：补充 merge_transaction 投影必挂、失败路径结构化 error.code 与瞬态码集合稳定性回归 UT/ST。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：新增 SMOKE-core-190 安装态跨组件全链用例（merge 开事务 → submit → seal → apply → SPEC_MERGED → status/next step 前进）+ 固定 0.14.18 死区对照。

## [code] 代码实现

> 六维打分：影响范围 1（CLI 单包：flow 规格资产 + flow-derive + merge 文案 + status/next + 测试）＋行为复杂度 1（判据替换与文案，无新状态机）＋契约变化 2（flow done 事实、后置条件二分、投影必挂、错误码验收均为合同变更）＋测试规模 2（21 个变更 ID）＋风险 2（涉 0.14.19 部署）＋不确定性 0（判据已由 §2.60/§12.10/四十七 定死）= 8 分 → 大任务，进入垂直拆分。
> 删后续自检（3 片，逐片结论）：片1 删 2/3——done_when+flow-derive 同源落地后「merge 开事务→前沿推进」端到端可观察（临时项目真实命令链），全量 verify 绿（片2/3 owned ID 由 manifest 归属豁免，既有回归随文案断言同步修）；片2 删 3——投影必挂与错误码注册表合同独立可观察、verify 绿；片3 无后续。三片按 1→2→3 串行、无前向依赖（片3 的 SMOKE runner 断言片1 行为，但 runner 本身在片3 内自闭环交付、安装态执行在部署阶段）。均过 (a)(b)，无向前合并需要。

- [x] 切片1：merge 前沿事务事实落地——spec/flow/launched.yaml 的 generate-merge-prompt.done_when 改为 any_present:[MERGE_TRANSACTION.json, MERGE_PROMPT_GENERATED, MERGE_PROMPT.md] 且 artifacts_hint 同步、flow-derive step 推导改认同一判据（事务在盘∨legacy marker）、判据两处同源回归、merge（有 delta）收尾提示改事务引导且不含 MERGE_PROMPT.md 字样（幂等/重建情形体现现状）、既有断言随新文案同步，实现含 OpenLogos reporter 的 UT-S05-52～55、ST-S05-24～25、UT-S09-303～307、ST-S09-116～117
- [x] 切片2：投影必挂与错误码合同——status/next 在活跃事务在场时 data.merge_transaction 必挂（同快照一致、next 不改写事务动作）、存量事务 contract/schema 失配 fail-closed 稳定码 + details 双方版本摘要 + remediation（abort 后重开、retryable:false）、status/next 失败路径「路径→error.code」注册表回归与瞬态码集合快照，实现含 OpenLogos reporter 的 UT-S09-308、UT-S16-38～41、ST-S16-12～13
- [x] 切片3：0.14.19 候选身份与 SMOKE-core-190 runner——package/lockfile/asset-manifest/plugin manifests/LOCAL_RELEASE_*/tripwire/golden 同步 0.14.19（回滚 0.14.18），新增 scripts/smoke-merge-frontier-0-14-19.js（跨组件全链：merge 开事务→status/next 前沿推进→submit/seal/apply→SPEC_MERGED→前沿越过；0.14.18 死区零回归对照；环境缺失显式 skip）并接入 scripts/run-smoke.js 注册表、写 smoke-results.jsonl，覆盖 SMOKE-core-190

## [deploy] 部署任务

- [x] 使用本提案构建的真实 npm tarball（0.14.19）完成隔离矩阵（含跨组件全链验收与 0.14.18 死区零回归对照）后部署到本机全局；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
- [x] 按合并后的部署方案确认制品哈希、回滚制品（固定 0.14.18 tarball）、全局 identity 同源与失败回滚准备，并更新部署报告。
