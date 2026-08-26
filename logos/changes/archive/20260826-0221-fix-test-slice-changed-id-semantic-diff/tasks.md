# 实现任务

> 目标版本：`0.13.30`。仅允许在 verify 通过并再次获得部署授权后安装到本机 npm 全局环境；禁止公开发布。

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：补充 S32/S39 的语义 changed/removed 集合、原样携带 baseline、`O = C` 与 fail-closed 验收条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：修正 §2.37 的 C/B/O 集合来源，定义 canonical change set、共享消费与历史边界。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：定义 merge 前后结构化测试记录对账、原子固化、完整性校验和单一读取入口。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md`：更新 slice-planner/validator 从 canonical C 规划归属及 invalid 恢复时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md`：把 test change set 计算、写入、复核与回滚纳入 apply 原子事务。
- [x] [MODIFY] `deltas/spec/test-slice-manifest.md`：定义 `openlogos/test-change-set@1`、规范化差异、C/R/B/O、不支持/篡改/历史行为。
- [x] [MODIFY] `deltas/spec/baseline-closure.md`：定义不扩展严格 apply manifest 的前提下，由结构化 `SPEC_MERGED` 原子持久化 change set。
- [x] [MODIFY] `deltas/test/core-S32-test-cases.md`：新增 UT-S32-43～UT-S32-49、ST-S32-14～ST-S32-16，覆盖新增、真实修改、原样、删除、O=C、篡改与事故六 ID。
- [x] [MODIFY] `deltas/test/core-S39-test-cases.md`：新增 UT-S39-33～UT-S39-38、ST-S39-17～ST-S39-19，覆盖 before/after、no-delta 空集合、原子回滚、重启稳定与无 Git 依赖。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义 0.13.30 真实 tarball、本机全局安装证据、0.13.29 回滚/恢复和禁止公开发布。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：新增 SMOKE-core-130～SMOKE-core-134，覆盖全局制品身份、事故六 ID、删除/篡改、重启一致性与真实回滚。

## [code] 代码实现

> 六维评分：影响范围 2 + 行为复杂度 2 + 契约变化 2 + 测试规模 2 + 风险等级 1 + 不确定性 1 = 10，属于大任务。垂直/横向判别：按“merge 产出事实 → lifecycle 消费事实 → 安装态交付”三条端到端能力线拆分，不把 parser、schema、测试、reporter、版本或 runner 单独横切。
>
> 删后续证伪：切片 1 删除切片 2～3 后仍能以真实 merge-apply 产出、复核并回滚 canonical change set，覆盖自身 eligible tests 与全量 baseline；切片 2 只依赖已完成的切片 1，删除切片 3 后可由 status/next/change-lint/validator/verify 端到端消费同一事实并安全恢复；切片 3 只依赖前两片完成态，独立产生可安装、可回滚、可由 smoke dispatcher 观察的 0.13.30 制品能力。三片均可观察、无前向依赖，无需合并。

- [x] 切片 1：实现 merge 时 canonical test change set 闭环（authority table parser、before/final semantic diff、canonical hash、`merge-apply` 原子 marker/后置复核/fault rollback），同步业务代码、UT/ST、OpenLogos reporter 与必要 golden（覆盖 UT-S39-33、UT-S39-34、UT-S39-35、UT-S39-36、UT-S39-37、UT-S39-38、ST-S39-17、ST-S39-18、ST-S39-19）。
- [x] 切片 2：实现 canonical change set 消费与分层恢复闭环（共享 TestChangeSetReader、slice manifest validator、status/next/change-lint/verify 同源 C/R、invalid fail-closed 与 valid manifest recovery），同步业务代码、UT/ST、OpenLogos reporter 与 JSON schema/golden（覆盖 UT-S32-43、UT-S32-44、UT-S32-45、UT-S32-46、UT-S32-47、UT-S32-48、UT-S32-49、ST-S32-14、ST-S32-15、ST-S32-16）。
- [x] 切片 3：完成 0.13.30 本机全局交付闭环（版本元数据与 CHANGELOG、`scripts/smoke-*` runner、`smoke-results.jsonl` reporter、`scripts/run-smoke.js` 接入及 smoke 覆盖预检），保留 0.13.29 回滚且禁止公开发布（覆盖 SMOKE-core-130、SMOKE-core-131、SMOKE-core-132、SMOKE-core-133、SMOKE-core-134）。

## [deploy] 本地全局部署任务

- [x] 在用户另行明确授权部署后，先记录当前全局 `openlogos` 的命令 realpath、npm prefix、包版本与可恢复的 `0.13.29` tarball/SHA-256；不得使用未固定的网络下载作为唯一回滚来源。
- [x] 完成全量 verify 后构建真实 `@miniidealab/openlogos@0.13.30` tarball，校验包名、版本、入口、清单、随包插件版本、大小与 SHA-256，再安装到本机 npm 全局环境。
- [x] 使用临时 fixture 项目验证实际执行入口来自全局 `0.13.30` 包，而非 workspace link、仓库源码或旧 shell cache；记录版本、realpath、prefix 与安装命令。
- [x] 实际演练 `0.13.30 → 0.13.29 → 0.13.30`，每一步校验入口与版本；任一步失败立即恢复部署前全局状态并保留脱敏诊断。
- [x] 生成 `logos/resources/verify/deployment-report.md`，记录制品、安装、回滚、恢复、失败处置及公开发布副作用为零；随后等待独立 smoke 授权，不在部署任务中执行 smoke。

> 部署任务不授权 `npm publish`、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`；这些动作即使本地部署成功也保持禁止。
