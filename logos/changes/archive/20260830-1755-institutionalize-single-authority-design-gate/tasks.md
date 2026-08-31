# 实现任务

## [delta] 规格变更

- [x] [CREATE] `deltas/decisions/core-D08-authority-closure.md`：记录单一语义权威、多可重建投影和拒绝长期双写的取舍。
- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：新增 Authority Closure 问题、触发、不变量与验收。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：定义 Registry、authority_impact、Skill 分工与共享 evaluator。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：建立项目 Authority Registry、投影血缘与 writer/cutover 边界。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S04-scenario-architect.md`：显式建模 authority 读写、投影刷新与恢复来源。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S06-test-design.md`：纳入 Authority Closure 故障与切换证伪矩阵。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S07-code-generation.md`：阻断影子权威、旁路写入、反推与长期双写。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：加入 authority_impact 生产、修复与 plan 完成门。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S12-architecture-designer.md`：增加共享事实盘点和 Authority Registry 交付。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`：定义 summary、violations 与同源机器投影。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：定义 writer 切换、投影重建、安装态资产与回滚门。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md`：让 PlanPackageEvaluator 唯一裁决 Authority Closure。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：规划 candidate、asset hash、隔离安装、切换验证与回滚。
- [x] [MODIFY] `deltas/skills/architecture-designer/SKILL.en.md`：同步英文 Authority Registry producer 合同。
- [x] [MODIFY] `deltas/skills/architecture-designer/SKILL.md`：增加事实盘点与 Authority Registry 设计门。
- [x] [MODIFY] `deltas/skills/change-writer/SKILL.en.md`：同步英文 authority_impact 生产与闭包检查。
- [x] [MODIFY] `deltas/skills/change-writer/SKILL.md`：增加 authority_impact 影响分析与交付门。
- [x] [MODIFY] `deltas/skills/code-reviewer/SKILL.en.md`：同步英文 shadow authority Critical 规则。
- [x] [MODIFY] `deltas/skills/code-reviewer/SKILL.md`：将影子判据、旁路写入、反推和长期双写列为 Critical。
- [x] [MODIFY] `deltas/skills/deployment-designer/SKILL.md`：增加单向 writer 切换、投影重建、freshness probe 与回滚边界。
- [x] [MODIFY] `deltas/skills/scenario-architect/SKILL.en.md`：同步英文 authority/projection 时序规则。
- [x] [MODIFY] `deltas/skills/scenario-architect/SKILL.md`：增加 authority 参与方、命令/查询与恢复建模。
- [x] [MODIFY] `deltas/skills/test-writer/SKILL.en.md`：同步英文 Authority Closure 负向矩阵。
- [x] [MODIFY] `deltas/skills/test-writer/SKILL.md`：增加滞后、冲突、重启、双写与回滚用例生成。
- [x] [CREATE] `deltas/spec/authority-closure.md`：创建唯一 Authority Closure 规范源与 `openlogos/authority-impact@1` 合同。
- [x] [MODIFY] `deltas/spec/change-management.md`：把 authority_impact 纳入 proposal、plan 完成与历史兼容。
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：定义 violations、summary、排序与同源消费。
- [x] [MODIFY] `deltas/spec/flow-spec.md`：让 proposal_filled、status、next 与 flow 只消费共享 evaluation。
- [x] [CREATE] `deltas/test/core-S04-test-cases.md`：规划 UT-S04-01～04、ST-S04-01。
- [x] [CREATE] `deltas/test/core-S06-test-cases.md`：规划 UT-S06-01～06、ST-S06-01～02。
- [x] [CREATE] `deltas/test/core-S07-test-cases.md`：规划 UT-S07-01～06、ST-S07-01～02。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：规划 UT-S09-266～270、ST-S09-104～105。
- [x] [CREATE] `deltas/test/core-S12-test-cases.md`：规划 UT-S12-01～06、ST-S12-01。
- [x] [MODIFY] `deltas/test/core-S16-test-cases.md`：规划 UT-S16-35～37、ST-S16-11。
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：规划 UT-S19-26～28、ST-S19-17。
- [x] [MODIFY] `deltas/test/core-S35-test-cases.md`：规划 UT-S35-112～120、ST-S35-19～21。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：规划 SMOKE-core-163～167。

API、数据库、页面设计与 API orchestration 为 SKIP；证据见 `proposal.md` 的 `baseline_closure.targets[]`。

## [code] 代码实现

> 六维评分：11/12（影响范围 2、行为复杂度 2、契约变化 2、测试规模 2、风险等级 2、不确定性 1），属于大任务。横向候选“先写解析器、再接命令、最后补测试/runner”已合并回能力切片。
>
> 删后续证伪：切片 1 删除切片 2～3 后，Authority Impact 从 proposal 输入到 Plan Package、change-lint/status/next/flow 输出及本片 reporter 可独立观察并通过基线+本片 verify；切片 2 在切片 1 已完成时删除切片 3，六角色根源资产到产物检查、反例诊断及本片 reporter 自闭环；切片 3 只依赖已完成能力，candidate 资产身份、有限 cutover、回滚、smoke runner/reporter 与覆盖预检同片交付。三片均无前向依赖。

- [x] 切片 1：Authority Impact 计划门与四消费者同源输出——实现唯一 `AuthorityClosureEvaluator`、严格 YAML/authority 引用/真实测试 ID/历史兼容求值，接入 proposal scaffold、`PlanPackageEvaluator`、change-lint/status/next/flow JSON，配套独立 UT/ST、golden 与 OpenLogos reporter（覆盖 UT-S09-266、UT-S09-267、UT-S09-268、UT-S09-269、UT-S09-270、ST-S09-104、ST-S09-105、UT-S16-35、UT-S16-36、UT-S16-37、ST-S16-11、UT-S35-112、UT-S35-113、UT-S35-114、UT-S35-115、UT-S35-116、UT-S35-117、UT-S35-118、UT-S35-119、UT-S35-120、ST-S35-19、ST-S35-20、ST-S35-21）
- [x] 切片 2：六角色 Authority Closure 设计产物与 Shadow Authority 证伪——让 architecture/scenario/test/review 根源资产按 `fact_id` 产出 Registry、时序、八维矩阵和 Critical 诊断，加入完整/双 writer/stale/restart/旁路写/永久双写夹具、资产契约测试与 OpenLogos reporter（覆盖 UT-S04-01、UT-S04-02、UT-S04-03、UT-S04-04、ST-S04-01、UT-S06-01、UT-S06-02、UT-S06-03、UT-S06-04、UT-S06-05、UT-S06-06、ST-S06-01、ST-S06-02、UT-S07-01、UT-S07-02、UT-S07-03、UT-S07-04、UT-S07-05、UT-S07-06、ST-S07-01、ST-S07-02、UT-S12-01、UT-S12-02、UT-S12-03、UT-S12-04、UT-S12-05、UT-S12-06、ST-S12-01）
- [x] 切片 3：Candidate 资产同源、有限 cutover 与回滚 smoke——实现 candidate 根规范/六 Skill/plugin/cache/manifest hash 核验、writer cutover/rollback 状态检查，更新 `scripts/smoke-*` runner 与 `scripts/run-smoke.js` 接入，逐 ID 写 `smoke-results.jsonl` reporter 并运行 smoke 覆盖预检（覆盖 UT-S19-26、UT-S19-27、UT-S19-28、ST-S19-17、SMOKE-core-163、SMOKE-core-164、SMOKE-core-165、SMOKE-core-166、SMOKE-core-167）

## [deploy] 部署任务

- [x] 规格 merge、实现与 `openlogos verify` PASS 后，等待用户明确授权，再构建固定 candidate tarball并记录清单与 SHA-256。
- [x] 在隔离 npm prefix 安装 candidate，核对 CLI、根规范、六个 Skill、插件/cache 投影与 asset manifest/hash。
- [x] 部署阶段确认 SMOKE-core-163～167 的 runner、固定 candidate/回滚身份与 OpenLogos reporter 输入已就绪；正式执行仍须另行获得 smoke 授权。
- [x] 演练当前版本→candidate→当前版本→candidate；失败时恢复冻结版本，不保留混合安装或伪成功 marker。

`[code]` 在规格 merge 前保持空白，待 merge 后由 `slice-planner` 按已合并规格和真实 UT/ST/SMOKE ID 生成自闭环切片。本轮已按批准方案完成 Delta；该批准不等于授权 merge、verify、部署、smoke、archive、公开发布或 git push。
