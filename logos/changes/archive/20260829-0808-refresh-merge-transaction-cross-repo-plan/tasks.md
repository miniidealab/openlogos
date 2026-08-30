# 实现任务

## [delta] 规格变更

- [x] [CREATE] `deltas/decisions/core-D07-merge-transaction-single-authority.md`：记录 OpenLogos 合并事务单一权威、被否 manifest 方案与跨仓约束。
- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：更新 S05/S09/S11/S16/S19/S39 的用户可观察验收条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：定义 transaction phase、动作权威、content slot、receipt 与错误恢复。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：确立 merge transaction 唯一 writer 与原子 apply 架构。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`：让 next 只消费 allowed_actions/next_action。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：改写 collecting 至 completed/failed 的合并生命周期。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md`：清除 S09 旧 manifest 成功链与多 writer 时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md`：定义只读 transaction 状态投影。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`：定义稳定 transaction envelope、错误与 receipt 输出。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：定义 0.14.0 全局安装态与跨仓 smoke 门。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md`：把 resources/metadata/dogfood/marker 纳入同一原子事务。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义 0.14.0 tarball、本机全局安装、证据与 0.13.31 回滚。
- [x] [MODIFY] `deltas/skills/merge-executor/SKILL.en.md`：同步英文 merge-executor 合同，避免随包双语行为分裂。
- [x] [MODIFY] `deltas/skills/merge-executor/SKILL.md`：删除外部 manifest/Base64 写入职责，改为只写声明的 content slots。
- [x] [MODIFY] `deltas/spec/baseline-closure.md`：定义 resources 与 OpenLogos-produced metadata 的同批原子闭包。
- [x] [MODIFY] `deltas/spec/change-management.md`：绑定 completed receipt、SPEC_MERGED 与归档成功谓词。
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：定义 transaction status/seal/apply 的机器输出合同。
- [x] [MODIFY] `deltas/spec/flow-spec.md`：隔离 Plan completion 与 merge transaction 命名空间及动作推进。
- [x] [CREATE] `deltas/spec/schema/merge-transaction.schema.json`：新增 `openlogos/merge-transaction@1` 公共 schema。
- [x] [MODIFY] `deltas/spec/schema/next.schema.json`：加入 transaction phase、allowed_actions 与 next_action 投影。
- [x] [MODIFY] `deltas/spec/schema/status.schema.json`：加入只读 transaction 状态、classification 与 receipt 摘要。
- [x] [MODIFY] `deltas/spec/tasks-spec.md`：对齐任务、delta closure 与 transaction target 身份。
- [x] [MODIFY] `deltas/spec/test-slice-manifest.md`：让 merge 后切片只消费 completed receipt 与真实测试 ID。
- [x] [MODIFY] `deltas/test/core-S05-test-cases.md`：规划 next 动作权威与错误恢复 UT/ST。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：规划 transaction 原子性、幂等、崩溃恢复和旧协议拒绝 UT/ST。
- [x] [MODIFY] `deltas/test/core-S11-test-cases.md`：规划 status 真只读与状态投影 UT/ST。
- [x] [MODIFY] `deltas/test/core-S16-test-cases.md`：规划 schema、contract hash、错误字段及安装态一致性 UT/ST。
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：规划 0.14.0 本机全局部署、安装态 smoke 与回滚 UT/ST。
- [x] [MODIFY] `deltas/test/core-S39-test-cases.md`：规划 metadata、counter/index、dogfood 与正式目标全批原子性 UT/ST。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：规划全局 0.14.0、随包合同、事务恢复及 RunLogos candidate 接缝 smoke。

API、数据库与 API orchestration 在本案中为 SKIP：本案只改变本地 CLI/文件/JSON 合同，跨进程接缝由 CLI ST 与 RunLogos 真实 E2E 覆盖。

## [code] 代码实现

> 六维评分：影响范围 2 + 行为复杂度 2 + 契约变化 2 + 测试规模 2 + 风险等级 2 + 不确定性 2 = 12，属于大任务。
>
> 垂直/横向判别：按三条用户可观察能力线切分；每片都同时包含生产代码、UT/ST、OpenLogos reporter 与必要 golden，不把 schema、helper、测试或 reporter 单独横切。
>
> 删后续证伪：切片 1 删除后续后，仍可通过 checkpoint verify 交付“创建事务→提交内容→seal→status/next 动作投影”完整能力；切片 2 删除切片 3 后，仍可在切片 1 上完成“原子 apply→receipt→崩溃恢复”完整能力；切片 3 独立完成 breaking cutover、制品自检、隔离部署/回滚与全局 smoke/RunLogos 交接。三片均端到端可观察、无前向依赖，无需向前合并。

- [x] 切片 1：实现 canonical merge plan、稳定 transaction/target/slot identity、受控内容槽、validator retry、seal 冻结、公共 JSON schema/contract hash，以及 status/next 的只读同源动作投影；同片交付 UT/ST、OpenLogos reporter 与 golden（覆盖 UT-S05-35、UT-S05-36、UT-S05-37、UT-S05-38、UT-S05-39、UT-S05-40、UT-S05-41、UT-S05-42、ST-S05-16、ST-S05-17、ST-S05-18、ST-S05-19、UT-S09-233、UT-S09-234、UT-S09-235、UT-S09-236、UT-S09-237、UT-S09-238、UT-S09-239、UT-S09-240、UT-S09-250、ST-S09-94、ST-S09-98、UT-S11-63、UT-S11-64、UT-S11-65、UT-S11-67、UT-S11-68、UT-S11-70、ST-S11-38、ST-S11-41、UT-S16-18、UT-S16-19、UT-S16-20、UT-S16-21、UT-S16-22、UT-S16-23、UT-S16-24、UT-S16-25、UT-S16-26、UT-S16-27、ST-S16-05、ST-S16-06、ST-S16-08、UT-S39-39、UT-S39-40、UT-S39-41、UT-S39-42、UT-S39-49、ST-S39-25）
- [x] 切片 2：实现 sealed transaction 的全闭包预演与原子 apply、metadata/dogfood/test-change-set/SPEC_MERGED 同批提交、completed receipt、幂等 response-lost、journal 崩溃恢复、no-delta 与 UI receipt 绑定；同片交付 UT/ST、OpenLogos reporter 与故障注入 golden（覆盖 UT-S09-241、UT-S09-242、UT-S09-243、UT-S09-244、UT-S09-245、UT-S09-246、UT-S09-247、UT-S09-248、ST-S09-91、ST-S09-92、ST-S09-93、ST-S09-95、ST-S09-96、ST-S09-97、UT-S11-66、UT-S11-69、ST-S11-39、ST-S11-40、UT-S39-43、UT-S39-44、UT-S39-45、UT-S39-46、UT-S39-47、UT-S39-48、UT-S39-50、ST-S39-20、ST-S39-21、ST-S39-22、ST-S39-23、ST-S39-24）
- [x] 切片 3：完成 0.14.0 breaking cutover，固定拒绝旧 merge-apply 成功路径，更新版本/帮助/prepack/asset identity，交付隔离 prefix 的 pack→install→self-check→回滚与 RunLogos candidate evidence；同步实现 `scripts/run-smoke.js` 可发现的真实 smoke runner、向 `logos/resources/verify/smoke-results.jsonl` 写 reporter、保持 `logos.config.json.smoke.command` 接入并运行覆盖预检（覆盖 UT-S09-249、ST-S16-07、UT-S19-12、UT-S19-13、UT-S19-14、UT-S19-15、UT-S19-16、UT-S19-17、UT-S19-18、ST-S19-10、ST-S19-11、ST-S19-12、ST-S19-13、SMOKE-core-141、SMOKE-core-142、SMOKE-core-143、SMOKE-core-144、SMOKE-core-145、SMOKE-core-146、SMOKE-core-147、SMOKE-core-148、SMOKE-core-149、SMOKE-core-150）

## [deploy] 部署任务

- [x] 在 verify PASS 且获得部署执行授权后构建 `@miniidealab/openlogos` 0.14.0 npm tarball，记录绝对路径与 SHA-256。
- [x] 部署前记录当前全局 `openlogos` 的命令路径、精确版本、0.13.31 安装来源及可复制回滚命令。
- [x] 将 0.14.0 tarball 安装到本机 npm 全局环境，并冻结供安装态 smoke 与 RunLogos 使用的命令路径、版本、schema hash 和 contract hash。
- [x] 部署失败时按部署方案恢复 0.13.31，并保留失败诊断与回滚结果。

`openlogos smoke` 与 RunLogos 真实跨仓 E2E 属部署后的独立验收节点，不以 tasks checkbox 代替；本案只有在二者按规格通过后才满足完成条件。
