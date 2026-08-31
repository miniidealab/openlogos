# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：补充嵌套标题路径锚放行、失败无副作用与同 transaction 恢复验收。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：定义共享 fence-aware block parser/resolver、真实叶标题身份、Agent verifier 与 OpenLogos composer 的同源语义。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：冻结标题树解析权威、合成算法、hash/fail-closed 与影子判据退出边界。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：补充原始 slot submit、seal preflight 拒绝/局部 reopen、apply 重验与同事务重提时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S37-delta-conservation.md`：明确 merge transaction 与 change-lint 共同消费标题路径 resolver。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义 0.14.4 candidate pack/install、0.14.3 回滚和 RunLogos 原事务交接。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：规划 UT-S09-271～274、ST-S09-106～107，覆盖 transaction 正反例与局部重提。
- [x] [MODIFY] `deltas/test/core-S37-test-cases.md`：规划 UT-S37-37～40、ST-S37-09～10，覆盖 fence-aware block parser、共享 resolver、Agent verifier/OpenLogos composer 与同源判据。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：规划 SMOKE-core-168，覆盖安装态嵌套锚 transaction 和跨仓恢复。

API、数据库、方法论根规范、Skill、长期决策与 API orchestration 为 SKIP；理由和证据已冻结在 `proposal.md` 的 `baseline_closure.targets[]`。

## [code] 代码实现

> 六维评分：影响范围 2 + 行为复杂度 2 + 契约变化 1 + 测试规模 2 + 风险等级 1 + 不确定性 1 = 9，属于大任务。
>
> 删后续自检：曾尝试按“共享解析权威”“transaction 消费”“安装态 smoke”拆为三片，但任一前置片删去后续后都会遗漏本提案已合并的测试变更集，且在 Agent verifier 与 OpenLogos composer 同时切换前仍保留可达的影子判据，无法独立通过全量 verify，也不能形成完整的 `lint → submit → seal → apply` 可观察闭环。因此该能力不可安全垂直拆分，合并为单片；单片不存在后续依赖，完成后可独立执行全量 verify。

- [x] 单切片：建立 fence-aware Markdown section authority，令 change-lint、Agent material verifier 与 OpenLogos composer 同源消费真实 heading `level/text/path/start/end`，移除 transaction 私有非 fence parser、扁平路径正则与精确 H2 fallback；保持 submit 原始字节职责、局部 reopen/故障恢复、apply 首写前重验和公共 schema 不变；同步 0.14.4 candidate 身份、UT/ST 测试及 OpenLogos reporter，并实现显式分派 `SMOKE-core-168`、写入 `smoke-results.jsonl` 的受控 smoke runner 与 smoke 覆盖预检（覆盖 `UT-S09-271`、`UT-S09-272`、`UT-S09-273`、`UT-S09-274`、`ST-S09-106`、`ST-S09-107`、`UT-S37-37`、`UT-S37-38`、`UT-S37-39`、`UT-S37-40`、`ST-S37-09`、`ST-S37-10`、`SMOKE-core-168`）。

## [deploy] 部署任务

- [ ] 在规格 merge、实现与 `openlogos verify` PASS 后，等待用户明确授权部署；获授权后才将 package/plugin/asset identity 同步提升到 `0.14.4`、构建 npm candidate，并冻结 tarball 路径、大小、文件清单与 SHA-256。
- [ ] 冻结本机全局 `0.14.3` 的命令入口、realpath、package/plugin/asset identity、固定回滚制品与可复制回滚命令。
- [ ] 在隔离 npm prefix 安装 candidate，验证嵌套路径锚 submit 成功、seal/apply 正反例及 `0.14.3→0.14.4→0.14.3→0.14.4` 往返恢复；失败不得覆盖全局。
- [ ] 获得独立全局部署授权后安装固定 candidate；获得 smoke 授权后执行安装态 `SMOKE-core-168`。任何失败均修复后重新 verify/pack/install/smoke，或恢复固定 `0.14.3`，不得伪造通过。
- [ ] 获得 RunLogos merge 的独立授权后，回到原项目复用 `mtx_e7f7b924499d49f96aaf8a2f`，只重提缺失 slot并完成 seal/apply；失败时按稳定摘要修复并重试，不 abort、不新建 transaction。

本次提案批准只授权后续 Delta 编写，不构成 OpenLogos merge、verify、部署、smoke、RunLogos merge、archive、公开发布或任何仓库 git push 的 standing 授权。
