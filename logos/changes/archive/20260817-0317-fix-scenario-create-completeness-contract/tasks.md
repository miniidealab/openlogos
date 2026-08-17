# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：更新 S39 的场景 CREATE 完整性与兼容验收条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：定义结构化 Markdown 校验、兼容标题和反误判行为。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：明确权威区解析、内容完整性和 fail-closed 边界。
- [x] [CREATE] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md`：补齐 S39 完整时序、步骤、异常与追溯。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义下一 patch 本机全局安装、成功证据和 0.13.26 回滚方案。
- [x] [MODIFY] `deltas/skills/change-writer/SKILL.md`：对齐 CREATE 场景 delta 的规范输出和完整性自检。
- [x] [MODIFY] `deltas/skills/scenario-architect/SKILL.md`：统一生成 `## 步骤说明` 及可结构化验收的场景正文。
- [x] [MODIFY] `deltas/spec/baseline-closure.md`：建立场景 CREATE 结构化完整性的权威合同。
- [x] [MODIFY] `deltas/spec/change-management.md`：对齐 change-lint/merge 完整性门禁和失败无副作用语义。
- [x] [MODIFY] `deltas/test/core-S39-test-cases.md`：新增 UT-S39-28…32 与 ST-S39-14…16。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：新增 SMOKE-core-67…69。

## [code] 代码实现

> 六维评分：影响范围 2、行为复杂度 2、契约变化 2、测试规模 2、风险等级 1、不确定性 0，合计 9/12，属于大任务。
>
> 删后续自检：场景 CREATE 的 Markdown 权威扫描、完整性 evaluator、change-lint/merge 同源判定、历史兼容回归及安装态 smoke 共同构成一个原子合同。若把解析器、UT、CLI ST 或 smoke 横向拆开，任一前片在删除后续片后都无法独立通过全量 verify，且不能形成完整可观察能力；因此不按 helper/测试/reporter 工种拆分，合并为单一自闭环切片。

- [x] 单切片：实现场景 CREATE 权威 Markdown 结构扫描与完整性合同，覆盖 canonical/历史标题、步骤列表、Mermaid、异常/追溯及 lint/merge fail-closed；同片交付 CLI UT/ST、全局 OpenLogos reporter、SMOKE-core-67～69 的真实安装态 runner/reporter 与统一 dispatcher 接入（覆盖 UT-S39-28、UT-S39-29、UT-S39-30、UT-S39-31、UT-S39-32、ST-S39-14、ST-S39-15、ST-S39-16、SMOKE-core-67、SMOKE-core-68、SMOKE-core-69）

## [deploy] 部署任务

- [x] 在 verify 通过且获得部署执行授权后，构建下一 patch npm tarball，记录版本、绝对路径与 sha256。
- [x] 部署前保存当前全局 `openlogos` 命令路径、精确版本，并保留 0.13.26 tarball、哈希与可复制的回滚命令。
- [x] 将新 tarball 安装到当前开发机 npm 全局环境，在新 shell 中确认命令路径、CLI/package/plugin 版本和随包 Skill/规格一致。
- [x] 执行 SMOKE-core-67…69；任一失败则不归档，保留诊断证据并按部署方案恢复 0.13.26。
