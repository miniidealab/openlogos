# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/decisions/core-D07-merge-transaction-single-authority.md`：补齐公共 staging、完整 receipt 与 action-command parity 的单一权威决策。
- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：修正 S05/S09/S11/S16/S19/S39 的消费者合同验收条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：冻结 slot descriptor/staging、abort 与 completed receipt 完整功能 shape。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：定义 OpenLogos 签发写域、提交闭包和私有制品清理架构。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`：使 next 只投影具有唯一可执行命令的事务动作。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：补齐 staging→submit、`failed/aborted` 终态、completed receipt 无环 hash 与 response-lost 时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md`：将精确 Git 提交白名单唯一绑定 receipt.commit_paths，并冻结 stacked-change guard/archive 交接。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md`：定义 slot descriptors 与完整 receipt 的真只读状态投影。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`：定义新公共字段、abort 动作和跨字段 JSON 约束。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：定义修正 candidate 自检、RunLogos 回传、旧 `SMOKE-core-150` 与新 `SMOKE-core-151+` 的 slug 归属。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md`：冻结全闭包 final hashes/commit_paths 与私有制品排除规则。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义旧 candidate hash 作废、重新 pack/install/self-check/回滚、合同冻结与两分支归档/集成顺序。
- [x] [MODIFY] `deltas/skills/merge-executor/SKILL.en.md`：同步英文 Agent staging、submit/abort 和 receipt-only 执行边界。
- [x] [MODIFY] `deltas/skills/merge-executor/SKILL.md`：同步中文 Agent staging、submit/abort 和 receipt-only 执行边界。
- [x] [MODIFY] `deltas/spec/baseline-closure.md`：明确全闭包逐路径 final hash、commit paths 与私有事务制品排除。
- [x] [MODIFY] `deltas/spec/change-management.md`：将规格提交成功谓词唯一绑定 completed receipt。
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：定义 public slot descriptors、`failed/aborted` 幂等命令与 payload-final/artifact hash 无环 receipt JSON 合同。
- [x] [MODIFY] `deltas/spec/flow-spec.md`：要求已知 action 与注册命令一一对称，宿主不猜测 staging/提交集。
- [x] [MODIFY] `deltas/spec/schema/merge-transaction.schema.json`：扩展 `openlogos/merge-transaction@1` slot descriptors、receipt closure 和 abort 一致性。
- [x] [MODIFY] `deltas/spec/schema/next.schema.json`：校验 next 事务投影的新公共字段和动作对称。
- [x] [MODIFY] `deltas/spec/schema/status.schema.json`：校验 status 事务投影的 slot/receipt 完整性。
- [x] [MODIFY] `deltas/spec/tasks-spec.md`：冻结 Agent 只写签发 staging path、OpenLogos 独占正式闭包的任务边界。
- [x] [MODIFY] `deltas/test/core-S05-test-cases.md`：规划 abort 动作映射、未知 action fail-closed 与 next 零推导 UT/ST。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：规划 staging/submit、abort 终态/清理、receipt 无环 hash 和 response-lost 幂等 UT/ST。
- [x] [MODIFY] `deltas/test/core-S11-test-cases.md`：规划 status 对 slot descriptors 与 completed receipt 的真只读投影 UT/ST。
- [x] [MODIFY] `deltas/test/core-S16-test-cases.md`：规划 schema 约束、双 hash、action-command parity 和 golden JSON UT/ST。
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：规划修正后 0.14.0 candidate pack/install/self-check/回滚和旧 hash 拒绝 UT/ST。
- [x] [MODIFY] `deltas/test/core-S39-test-cases.md`：规划 payload final hashes 与 artifact hashes 的无环完整性、commit_paths、私有制品排除与 Git 白名单 UT/ST。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：规划全局修正 candidate、新 hash、abort/staging/receipt、RunLogos 接缝和两 slug 独立 marker 归属 smoke。

API、数据库、页面设计与 API orchestration 在本案中为 SKIP，理由与证据已写入 `proposal.md` 的 `baseline_closure.targets[]`。

## [code] 代码实现

> 六维评分：影响范围 2 + 行为复杂度 2 + 契约变化 2 + 测试规模 2 + 风险等级 2 + 不确定性 1 = 11，属于大任务。垂直/横向判别：按“成功 merge transaction 公共消费者闭环 → abort/action-command 权威闭环 → 可部署 candidate 与跨仓交接闭环”三条端到端能力线拆分；拒绝 schema-only、command-only、receipt-only、smoke-only、reporter-only 等横向拆法。
>
> 删后续证伪：切片 1 删除切片 2～3 后，仍可独立完成公共 staging→submit→seal→apply→completed、无环 receipt、精确 Git 暂存及只读投影，并通过本片 eligible tests 与 baseline；切片 2 只依赖已完成的切片 1，删除切片 3 后，仍可独立完成 abort 终态、清理、幂等和 status/next 可执行动作权威，并通过本片 checkpoint；切片 3 只依赖前两片完成态，可独立完成修正 candidate 的 pack/install/self-check/rollback 与 RunLogos 交接。三片均产生可观察能力且无前向依赖，不需合并。

- [x] 切片 1：实现成功 merge transaction 公共消费者闭环（公共 slot descriptor/staging path、原子写入与精确 submit、seal/apply、completed 无环 receipt、payload/artifact hashes 与 commit_paths 精确闭包、response-lost 幂等、私有制品清理、status 只读投影、精确 Git staging，并补齐 OpenLogos producer 对根 `spec/schema/*.json` 整文件 Delta 的受控自举产出），同步业务代码、UT/ST、OpenLogos reporter、Schema 与必要 golden；更新安装态 smoke runner、`scripts/run-smoke.js` dispatcher、`smoke-results.jsonl` reporter 和覆盖预检（覆盖 UT-S09-251、UT-S09-252、UT-S09-253、UT-S09-257、UT-S09-258、UT-S09-259、UT-S09-260、ST-S09-99、ST-S09-101、UT-S11-71、UT-S11-72、UT-S16-28、UT-S16-29、UT-S39-51、UT-S39-52、UT-S39-53、UT-S39-54、UT-S39-55、ST-S39-26、SMOKE-core-152、SMOKE-core-153）。
- [x] 切片 2：实现 abort 终态与 action-command 权威闭环（新增 `merge transaction abort`，限定 collecting/ready/sealed，failed/aborted 稳定幂等与私有制品清理，普通 fatal 零动作、recovery_required 仅 recover、未知 action fail-closed，以及 status/next 与真实子命令一一对应），同步业务代码、UT/ST、OpenLogos reporter、Schema 与必要 golden；更新安装态 smoke runner、`scripts/run-smoke.js` dispatcher、`smoke-results.jsonl` reporter 和覆盖预检（覆盖 UT-S05-43、UT-S05-44、UT-S05-45、ST-S05-20、UT-S09-254、UT-S09-255、UT-S09-256、ST-S09-100、UT-S11-73、ST-S11-42、UT-S16-30、UT-S16-31、UT-S16-32、SMOKE-core-151、SMOKE-core-154）。
- [x] 切片 3：实现可部署修正 candidate 与跨仓交接闭环（修正后 `0.14.0` pack/install/self-check/rollback、三份 Schema/双语 merge-executor Skill/semantic validator/abort/golden 入包、旧 candidate hash 拒绝，以及只暴露冻结公共事实的 RunLogos handoff），同步业务代码、UT/ST、OpenLogos reporter 与必要 golden；更新真实安装态及跨仓 smoke runner、`scripts/run-smoke.js` dispatcher、`smoke-results.jsonl` reporter，并对 SMOKE-core-151～156 执行覆盖预检（覆盖 ST-S16-09、UT-S19-19、UT-S19-20、UT-S19-21、ST-S19-14、SMOKE-core-155、SMOKE-core-156）。

## [deploy] 部署任务

- [x] 在 verify PASS 且获得部署执行授权后，作废旧 candidate 冻结值，构建修正后 `@miniidealab/openlogos@0.14.0` npm tarball 并记录绝对路径、大小与 SHA-256。
- [x] 部署前记录当前全局 `openlogos` 入口、realpath、精确版本、candidate tarball/hash 及可复制回滚命令。
- [x] 将修正 candidate 安装到本机全局 npm prefix，验证版本/入口、abort 命令、slot descriptor、completed receipt、随包 schema/Skill 和 golden JSON，冻结新 schema/contract hash。
- [x] 部署或安装态自检失败时，使用预先冻结的 candidate 恢复全局环境并保留失败/回滚证据。

`openlogos smoke` 是部署后的独立人类确认点，不以 `[deploy]` checkbox 代替。安装态自检通过后允许恢复 RunLogos 提案；RunLogos 真实 E2E 回传后再运行本仓正式 smoke。
