# 实现任务

> 目标版本：`0.13.31`。当前只规划规格与部署目标；`[code]` 切片须在规格合并后由 slice-planner 基于真实测试 ID 生成。

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：统一 S05/S08/S09/S11/S35 的完成、诊断、同步与兼容验收。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：收敛 plan gate、change-lint、状态派生与资产同步规格。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：定义 evaluator、locale registry、共享入口与资产 hash。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-00-scenario-overview.md`：登记 S35 并更新五场景依赖追溯。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`：更新 next 完成合同与 dispatch completion。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md`：更新 asset manifest、sync stamp 与过期 Skill 诊断。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：更新中英文 scaffold、plan gate 与历史兼容。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md`：更新 status 统一 plan_state/issues 与只读保证。
- [x] [CREATE] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md`：补建 S35 目标、参与者、时序、步骤、异常与追溯。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义 0.13.31 制品、安装态核验与 0.13.30 回滚。
- [x] [MODIFY] `deltas/skills/change-writer/SKILL.md`：中文 producer 保留 scaffold、延后切片、写后读回并双检查。
- [x] [MODIFY] `deltas/skills/change-writer/SKILL.en.md`：英文 producer 对齐同一机器合同与交付门。
- [x] [MODIFY] `deltas/spec/change-management.md`：定义 canonical 章节、evaluator、issue 与宿主边界。
- [x] [MODIFY] `deltas/spec/tasks-spec.md`：定义 tasks 三态与 launched 空 `[code]` 锚点。
- [x] [MODIFY] `deltas/spec/flow-spec.md`：统一 flow 谓词、plan 前沿与 completion 声明。
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：定义 plan package、completion issues 与 dispatch JSON。
- [x] [MODIFY] `deltas/spec/schema/status.schema.json`：扩展 status JSON Schema。
- [x] [MODIFY] `deltas/spec/schema/next.schema.json`：扩展 next JSON Schema。
- [x] [MODIFY] `deltas/test/core-S05-test-cases.md`：新增 next、completion dispatch 与 ready 等价关系规格。
- [x] [MODIFY] `deltas/test/core-S08-test-cases.md`：新增 asset manifest、sync stamp 与缓存漂移规格。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：新增 scaffold、locale 标题、tasks 三态与历史兼容规格。
- [x] [MODIFY] `deltas/test/core-S11-test-cases.md`：新增 status 四方同源与只读性规格。
- [x] [MODIFY] `deltas/test/core-S35-test-cases.md`：新增 L0 issue、排序、exit code 与四方一致性规格。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：新增 0.13.31 tarball、插件/Skill/hash/cache/sync 与回滚 smoke 规格。

## [code] 代码实现

> 六维评分：11/12（影响范围 2、行为复杂度 2、契约变化 2、测试规模 2、风险等级 2、不确定性 1），属于大任务。横向的 evaluator/schema/reporter/smoke 拆法均已推倒，改为四条用户可观察能力线。
> 删后续证伪门：切片1独立产生 `change → change-lint` 中英文收敛与精确 L0 issue；切片2在切片1之上独立产生 status/next/flow 四方同源机器契约；切片3独立产生可对账的 sync/asset identity 与安装态能力；切片4独立产生历史重复测试 ID 向唯一 after 的原子收敛。四片均无前向依赖，删除其后续片时可通过当片 slice-aware verify，且每片均有端到端可观察产出。
- [x] 切片1：Plan Package 生产与 L0 诊断闭环——实现 locale-aware canonical section registry、proposal/tasks launched scaffold、统一 evaluator 及 proposal-lifecycle wrapper、change-lint L0 投影、历史 marker 旁路、fixture/golden 与 OpenLogos reporter；同步实现/ALREADY回归 `SMOKE-core-136` runner 与 smoke reporter/dispatcher 接入（覆盖 `UT-S09-63`、`UT-S09-110a-neg`、`UT-S09-224`、`UT-S09-225`、`UT-S09-226`、`UT-S09-227`、`UT-S09-228`、`UT-S09-229`、`UT-S09-230`、`UT-S09-231`、`ST-S09-88`、`ST-S09-89`、`UT-S35-100`、`UT-S35-101`、`UT-S35-102`、`UT-S35-103`、`UT-S35-104`、`UT-S35-105`、`UT-S35-106`、`UT-S35-107`、`UT-S35-108`、`UT-S35-109`、`UT-S35-110`、`UT-S35-111`、`ST-S35-16`、`ST-S35-17`、`ST-S35-18`、`SMOKE-core-136`）
- [x] 切片2：Plan Package 状态与下一步机器契约闭环——让 status、next、flow derive 只消费共享 evaluation，输出 1.3.0 plan_state/completion_issues/dispatch completion，同步更新 JSON Schema、fixture/golden、OpenLogos reporter 与只读快照；实现/ALREADY回归 `SMOKE-core-137` runner 与 smoke reporter/dispatcher 接入（覆盖 `UT-S05-30`、`UT-S05-31`、`UT-S05-32`、`UT-S05-33`、`UT-S05-34`、`ST-S05-14`、`ST-S05-15`、`UT-S11-58`、`UT-S11-59`、`UT-S11-60`、`UT-S11-61`、`UT-S11-62`、`ST-S11-36`、`ST-S11-37`、`SMOKE-core-137`）
- [x] 切片3：Plan Contract 托管资产与 sync 身份闭环——生成 `openlogos/asset-manifest@1`，对账 package/plugin/Skill/template/schema hash，扩展 sync stamp、同 semver 缓存漂移诊断、幂等/回滚与用户资产保护，同步 fixture、OpenLogos reporter 以及 `SMOKE-core-135`、`SMOKE-core-138`、`SMOKE-core-139`、`SMOKE-core-140` runner、smoke reporter/dispatcher 与覆盖预检接入（覆盖 `UT-S08-38`、`UT-S08-39`、`UT-S08-40`、`UT-S08-41`、`UT-S08-42`、`ST-S08-28`、`ST-S08-29`、`SMOKE-core-135`、`SMOKE-core-138`、`SMOKE-core-139`、`SMOKE-core-140`）
- [x] 切片4：历史测试 ID 原子自举收敛——TestChangeSet before 侧容纳重复候选并跳过历史歧义行，after 侧继续严格唯一/UTF-8/表结构门，匹配任一 before 候选时保持 unchanged，重编号/修复行进入 changed，并以受控 merge-apply ST、零写回负例和 OpenLogos reporter 闭环（覆盖 `UT-S09-232`、`ST-S09-90`）

## [deploy] 本机全局部署任务

- [ ] verify 通过并另获部署授权后，记录全局 `openlogos` 版本、realpath、npm prefix，并固定 0.13.30 tarball 与 SHA-256。
- [ ] 构建 `@miniidealab/openlogos@0.13.31` tarball，核验 CLI/插件版本、Plan 合同、Skill/模板资产 hash、内容清单与 SHA-256 后安装。
- [ ] 在隔离环境及本机全局入口验证 init/change/sync、缓存刷新、只读零写入与用户资产不覆盖，并生成部署报告。
- [ ] 实际演练 `0.13.31 → 0.13.30 → 0.13.31`；失败立即恢复部署前状态，随后等待独立 smoke 授权。

> 部署任务不授权 smoke、npm publish、dist-tag、Git tag、GitHub Release、官网部署或 git push。
