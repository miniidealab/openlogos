# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/decisions/core-D07-merge-transaction-single-authority.md`：补充 preflight seal 绑定、结构化归因、崩溃安全 reopen、旧 sealed 兼容和不可逆边界。
- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：增加 seal 前失败、既有 sealed 恢复与跨仓验收条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：冻结 preflight、slot 归因、collecting retry 与 0.14.2 行为。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：定义确定性派生校验、preflight canonical identity、seal/apply 同一性和可逆状态边界。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`：定义 reopen 后 collecting/missing-slot/submit-content 的 next 权威动作投影。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：补充 seal preflight 与旧 sealed→collecting 时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md`：限定消费者只替换 missing slot并继续同一事务。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md`：定义崩溃窗口和残留私有字节下 status 只投影权威 transaction state。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`：定义 retryable error 与 collecting 投影同源语义。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：定义 0.14.2 安装、回滚和 RunLogos 恢复门。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md`：把 test-change-set 纳入 seal/apply 共用 preflight。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义 0.14.2 pack/install、自检、0.14.1 回滚和跨仓交接。
- [x] [MODIFY] `deltas/skills/merge-executor/SKILL.en.md`：同步英文 preflight retry 与 missing-slot 重提规则。
- [x] [MODIFY] `deltas/skills/merge-executor/SKILL.md`：同步中文 preflight retry 与 missing-slot 重提规则。
- [x] [MODIFY] `deltas/spec/baseline-closure.md`：规定确定性派生产物的首写前预演、canonical hash 与 seal 绑定。
- [x] [MODIFY] `deltas/spec/change-management.md`：补充 seal/apply 共用 preflight、结构化错误、旧事务兼容和状态先落盘/私有字节后清理的同事务恢复。
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：明确既有 classification/action 字段表达 retryable reopen。
- [x] [MODIFY] `deltas/spec/flow-spec.md`：让 flow 跟随 collecting/missing slot 的权威动作。
- [x] [MODIFY] `deltas/test/core-S05-test-cases.md`：规划 UT-S05-46、ST-S05-21，并继续锚定既有 UT-S05-36、ST-S05-20。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：规划 UT-S09-261～265、ST-S09-102～103。
- [x] [MODIFY] `deltas/test/core-S11-test-cases.md`：规划 UT-S11-74、ST-S11-43，并继续锚定既有 UT-S11-63。
- [x] [MODIFY] `deltas/test/core-S16-test-cases.md`：规划 UT-S16-33～34、ST-S16-10。
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：规划 UT-S19-24～25、ST-S19-16。
- [x] [MODIFY] `deltas/test/core-S39-test-cases.md`：规划 UT-S39-56～58、ST-S39-27。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：规划 SMOKE-core-160～162。

API、数据库、页面设计与 API orchestration 在本案中为 SKIP；理由和证据已冻结在 `proposal.md` 的 `baseline_closure.targets[]`。

## [code] 代码实现

> 六维评分：影响范围 2、行为复杂度 2、契约变化 2、测试规模 2、风险等级 2、不确定性 1，共 11 分，属于大任务。
>
> 删后续证伪：切片 1 单独保留时即可让新事务在 seal 前拒绝确定性闭包错误、回到 collecting 并完成修复重试；切片 2 单独删除切片 3 时即可让既有 sealed 事务按结构化归因同事务 reopen，且 status/next/JSON 与崩溃窗口均可观察；切片 3 依赖的是前两片已经完成并稳定的公共行为，自身闭合候选 pack/install/rollback 与 smoke runner/reporter。三片均可在删除后续切片后通过当时全量回归，无前向依赖；未按 helper、测试或 reporter 横切。

- [x] 切片 1：实现新事务 seal-bound canonical preflight、严格 test-change-set 扫描、单一 Agent slot 结构化归因与 collecting 修复重试闭环，同批补齐 Vitest 用例并复用 OpenLogos reporter（覆盖 UT-S09-261、UT-S16-33、UT-S39-56、UT-S39-57）。
- [x] 切片 2：实现 legacy sealed 同事务局部 reopen、混合/未知归因 fail-closed、不可逆边界、崩溃安全状态先落盘与 status/next/JSON 跨进程投影闭环，同批补齐 Vitest 用例并复用 OpenLogos reporter（覆盖 UT-S05-46、ST-S05-21、UT-S09-262、UT-S09-263、UT-S09-264、UT-S09-265、ST-S09-102、ST-S09-103、UT-S11-74、ST-S11-43、UT-S16-34、ST-S16-10、UT-S39-58、ST-S39-27）。
- [x] 切片 3：实现 0.14.2 真实候选 pack/install/0.14.1 rollback 闭环，新增并接入 `scripts/run-smoke.js` 的安装态 preflight/reopen/RunLogos smoke runner 与 `smoke-results.jsonl` reporter，完成 smoke 覆盖预检（覆盖 UT-S19-24、UT-S19-25、ST-S19-16、SMOKE-core-160、SMOKE-core-161、SMOKE-core-162）。

## [deploy] 部署任务

- [x] 在规格 merge、代码实现和 `openlogos verify` PASS 后，等待用户明确授权部署；获得授权后才构建真实 `@miniidealab/openlogos@0.14.2` npm tarball并记录绝对路径、文件清单、大小与 SHA-256。
- [x] 在隔离 npm prefix 安装 0.14.2，执行新事务 seal preflight、旧 sealed reopen、重新 submit/seal/apply、reporter 与 0.14.1→0.14.2→0.14.1→0.14.2 回滚恢复验证。
- [x] 部署前冻结当前全局 0.14.1 的命令路径、realpath、package/plugin/asset identity、固定回滚 tarball SHA-256 和可复制回滚命令。
- [x] 将固定 0.14.2 tarball 安装到本机全局 npm prefix；新 shell 校验入口、版本、随包 Skill/spec/test/golden/asset hash 和 merge transaction 最小正反例。
- [x] 获得用户对 smoke 的明确授权后执行安装态 smoke；任一失败先修复、重新 verify/pack/install/smoke，或恢复固定 0.14.1，绝不保留混合安装与伪成功 marker。
- [x] 获得用户对 RunLogos 恢复及继续 merge 的明确授权后，在 RunLogos 项目根恢复 `mtx_7e0341e3719feccd22ef7615`，确认只退回 `UT-S44-24` 所在 slot、其余 slot 保留；补齐六列表格缺失的预期输出列，重新 submit/seal/apply，按失败摘要持续修复并重试直至 completed。

本次 plan 批准不构成 merge、verify、部署、smoke、RunLogos merge、OpenLogos archive、公开发布或任何仓库 `git push` 的 standing 授权；各动作到达时分别提交用户确认。
