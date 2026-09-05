# 实现任务

## [delta] 规格变更

- [x] [CREATE] `deltas/decisions/core-D11-test-change-set-proposal-scope.md`：决策记录——提案级累计事实不变量、前滚仅在核心 writer 内、归档对消费者 audit-only（含被否方案）
- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：S09/S32 验收条件补 reopen 重合并后 changed_test_ids 提案级完整
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：reopen 后 test_change_set 前滚合并功能规格（触发、规则、fail-closed 边界）
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：Authority Registry 新增 test-change-set.proposal-scope 行；apply 前滚组件职责
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：reopen 重建事务 apply 的前滚时序与异常边界
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md`：change set 语义升格为提案级累计事实、消费侧不变
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：OpenLogos 0.14.20 本机全局部署方案章节
- [x] [MODIFY] `deltas/spec/change-management.md`：completed reopen 生命周期段补前滚合同
- [x] [MODIFY] `deltas/spec/test-slice-manifest.md`：test_change_set 权威段成文提案级语义与前滚规则
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：UT-S09-309～312、ST-S09-118～119
- [x] [MODIFY] `deltas/test/core-S32-test-cases.md`：UT-S32-69～70、ST-S32-23
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：SMOKE-core-191（安装态 reopen 前滚全链 + 0.14.19 对照）

## [code] 代码实现

> 六维打分：影响范围 1（cli/src/lib 少量文件+测试+runner）、行为复杂度 2（lineage/边界/失配多分支）、契约变化 2（共享事实语义升格+发布身份）、测试规模 2（10 个新 ID+smoke）、风险 2（含部署）、不确定性 0 → 9 分，大任务，进入垂直拆分。
> 删后续自检：3 片各自删后续可过全量 verify（未完成切片 ID 由 manifest 归属豁免）、各有端到端可观察能力（片1=reopen 重合并后 changed 提案级完整；片2=消费侧多切片归属成立；片3=0.14.20 身份自证+SMOKE-core-191 runner 自检），无前向依赖；无横向红旗（无地基/接线/纯测试工种片——片2 是消费场景回归能力线，非"补测试"工种片）。
- [x] 切片1：reopen 前滚合并核心——buildMergePreflight 读 MERGE_REOPENS.jsonl 时序 lineage 与归档 receipt，前滚合并 changed/removed（changed 前滚并集、removed 后写胜出），targets/hash 保持当前快照、sha256 重算；abort 祖先跳过、null 记空集；祖先身份失配/留痕或 receipt 损坏 fail-closed 点名路径；无留痕逐字节不变；preflight test_change_set_sha256 与 SPEC_MERGED 同源；实现含 OpenLogos reporter 的 UT-S09-309～312、ST-S09-118～119
- [x] 切片2：reopen 后切片归属消费回归——前滚 change set 下 owned⊆changed 放行、removed 后写胜出触发 test-slice-test-id-unknown、reopen 后多切片规划全链（manifest 校验+按归属豁免+删后续门成立），消费者只读当前 marker、不读归档；实现含 OpenLogos reporter 的 UT-S32-69～70、ST-S32-23
- [x] 切片3：0.14.20 候选身份与 SMOKE-core-191 runner——package/lockfile/五 plugin manifest/asset-manifest/LOCAL_RELEASE_CANDIDATE_VERSION=0.14.20、ROLLBACK=0.14.19/tripwire/golden 同步；新增 scripts/smoke-merge-reopen-0-14-20.js（安装态前滚全链+removed 后写胜出+失配 fail-closed+无留痕零回归+0.14.19 空 change set 对照+roundtrip）并接入 scripts/run-smoke.js 注册表、写 smoke-results.jsonl，覆盖 SMOKE-core-191

## [deploy] 部署任务

- [x] 使用本提案构建的真实 npm tarball（0.14.20）完成隔离矩阵（含 reopen→幂等重合并→change set 前滚全链与 0.14.19 空 change set 零回归对照）后部署到本机全局；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
- [x] 按合并后的部署方案确认制品哈希、回滚制品（固定 0.14.19 tarball，sha256 ad6575ded72996f9d4bd2b820c96f5358826cc97bd9f1d57f9f08b76bd8109c3）、全局 identity 同源与失败回滚准备，并更新部署报告。
