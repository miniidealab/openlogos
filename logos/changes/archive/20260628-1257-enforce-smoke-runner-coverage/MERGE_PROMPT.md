# 合并指令

## 变更提案
- 提案名称：enforce-smoke-runner-coverage
- 提案目录：logos/changes/enforce-smoke-runner-coverage/

## 提案内容

# 变更提案：强制 smoke runner 覆盖新增 smoke 用例

> module: core | created: 2026-06-28

## 变更原因
收到 bug report：RunLogos 提案 `driver-smoke-repair-loop` 在规格阶段新增了 `SMOKE-DRV-SMOKE-01` ~ `SMOKE-DRV-SMOKE-07`，但 code 阶段没有同步生成 smoke runner / reporter，也没有把 runner 接入 `smoke.command` 或统一 dispatcher，导致部署后执行 `openlogos smoke --format json` 时 7 个新增 smoke 用例全部进入 `uncovered_cases`，Gate 3.8 失败。

本仓库核对后确认该报告成立。当前 `openlogos smoke` 能在运行时发现 `defined_count > executed_count` 并判定 `incomplete_coverage`，但 OpenLogos skills / workflow 只强制 UT/ST reporter 写入 `test-results.jsonl`，没有在 code 阶段强制新增 smoke 用例同步交付可执行 smoke runner、写入 `smoke-results.jsonl`、接入 `smoke.command`，也没有在实现完成前提供 smoke 覆盖预检。因此 smoke 用例可能停留在规格层，直到部署后才暴露为 uncovered。

## 变更类型
设计级变更

## 变更范围
- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md`（S13/S19/S31 验收条件，新增 smoke runner 覆盖闭环要求）
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`（code 阶段、verify/smoke 门禁、RunLogos driver 行为）
- 影响的业务场景：S13（verify 预检）、S19（部署后 smoke 门禁）、S31（code 切片闭环）
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`（发布后 smoke 覆盖验证）
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无
- 影响的 smoke 测试：`logos/resources/test/smoke/core-smoke-test-cases.md`（新增发布包对 smoke runner 覆盖预检的 smoke 用例）

## 部署影响
- 是否需要部署：是
- 部署原因：需要修改 CLI 行为、内置 Skills、规格文档和官网文档资产；修复生效依赖发布新的 CLI/npm 包并同步网站文档。
- 影响环境：本地 / 测试 / 预发 / 生产
- 是否涉及数据迁移：否
- 是否需要回滚预案：是
- 是否需要 smoke：是

## 变更概述
本变更补齐 smoke 用例从规格到可执行验收的闭环：当提案新增或修改 `logos/resources/test/smoke/*.md` 时，change-writer/test-writer/code-implementor 必须把 smoke runner / reporter / dispatcher 接入作为 code 阶段自闭环任务的一部分；每个新增 `SMOKE-*` ID 必须有对应 runner 执行结果写入 `logos/resources/verify/smoke-results.jsonl`，不得只新增 smoke 用例文档。

CLI 层新增 smoke 覆盖预检能力：读取当前提案新增或修改的 smoke 用例 ID，与 `smoke-results.jsonl` 中已执行 ID 以及可发现的 smoke runner/dispatcher 接入状态对齐；若存在新增 smoke 用例但没有可执行结果或 runner 接入证据，应输出明确诊断（如 `smoke_runner_missing`、`smoke_reporter_missing`、`smoke_cases_uncovered`），并阻止 code 阶段被误判为完成。`openlogos smoke` 仍保留部署后 Gate 3.8 判定，但 failure reason 应让 RunLogos 能区分 runner 缺失、reporter 缺失和用例未覆盖。

推荐实现统一 smoke dispatcher（例如 `scripts/run-smoke.js` 或等效入口），由 `logos.config.json.smoke.command` 指向统一入口，自动发现并运行 `scripts/smoke-*.sh` 或等效 runner，减少每个提案手工修改 `smoke.command` 的遗漏风险。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/enforce-smoke-runner-coverage/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md

- Delta 文件：`logos/changes/enforce-smoke-runner-coverage/deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md

- Delta 文件：`logos/changes/enforce-smoke-runner-coverage/deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md

- Delta 文件：`logos/changes/enforce-smoke-runner-coverage/deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/core-S31-code-slice-loop.md

- Delta 文件：`logos/changes/enforce-smoke-runner-coverage/deltas/prd/3-technical-plan/2-scenario-implementation/core-S31-code-slice-loop.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/enforce-smoke-runner-coverage/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/test/core-S13-test-cases.md

- Delta 文件：`logos/changes/enforce-smoke-runner-coverage/deltas/test/core-S13-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/test/core-S19-test-cases.md

- Delta 文件：`logos/changes/enforce-smoke-runner-coverage/deltas/test/core-S19-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/test/core-S31-test-cases.md

- Delta 文件：`logos/changes/enforce-smoke-runner-coverage/deltas/test/core-S31-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 10. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/enforce-smoke-runner-coverage/deltas/test/smoke/core-smoke-test-cases.md`
- 目标目录：`logos/resources/test/smoke/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(enforce-smoke-runner-coverage): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive enforce-smoke-runner-coverage`。
