## ADDED — S13/S19/S31 smoke runner 覆盖闭环验收补充

### S13: smoke 覆盖预检
- **GIVEN** 活跃提案新增或修改了 `logos/resources/test/smoke/*.md`，并新增一个或多个 `SMOKE-*` 用例 ID
- **WHEN** code 阶段准备完成或 `openlogos verify` 进行实现完成前检查
- **THEN** CLI 必须检查新增 smoke 用例是否已有对应可执行 smoke runner/reporter 计划或执行结果；若新增 smoke 用例没有任何 runner/reporter 覆盖证据，必须输出明确诊断，不得让提案被误判为完整实现。

### S19: smoke 用例必须可执行
- **GIVEN** smoke 用例规格中存在 `SMOKE-*` ID
- **WHEN** 用户明确授权执行 `openlogos smoke --format json`
- **THEN** 每个已定义 smoke 用例必须由 `smoke.command`、统一 smoke dispatcher 或等效 runner 写入 `logos/resources/verify/smoke-results.jsonl`；未写入执行结果的用例必须进入 `uncovered_cases`，Gate 3.8 必须失败。

### S31: code 切片包含 smoke runner 交付物
- **GIVEN** `[code]` 切片对应的规格变更新增或修改了 smoke 用例
- **WHEN** change-writer / code-implementor 生成或执行该 `[code]` 切片
- **THEN** 该切片必须同时包含业务代码、UT/ST、OpenLogos verify reporter，以及 smoke runner/reporter/dispatcher 接入；不得把 smoke runner 留到部署后手工补齐。

### 异常：新增 smoke 用例未覆盖
- **GIVEN** 当前提案新增了 `SMOKE-*` 用例，但 `smoke-results.jsonl` 没有对应结果，且 `smoke.command` 无法发现会执行该用例的 runner
- **WHEN** 执行 smoke 覆盖预检或部署后 smoke
- **THEN** 输出 `smoke_runner_missing`、`smoke_reporter_missing` 或 `smoke_cases_uncovered` 之一，并列出缺失的 `SMOKE-*` ID。
