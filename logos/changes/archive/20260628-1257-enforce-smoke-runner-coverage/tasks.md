# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/` — 更新 S13/S19/S31 的验收条件，要求新增 smoke 用例必须同步形成 runner/reporter 覆盖闭环
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/` — 更新 code 阶段、verify/smoke 门禁和 RunLogos driver 行为，定义 smoke runner 覆盖预检与诊断码
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 更新 S19 smoke 门禁时序与 S31 code 切片闭环，加入 smoke runner/reporter/dispatcher 检查步骤
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/` — 更新部署方案，要求发布后 smoke 覆盖统一 dispatcher 与新增 smoke 用例
- [x] 产出 delta 文件到 `deltas/test/` — 更新 S13/S19/S31 测试用例，覆盖 smoke 覆盖预检、runner 缺失、reporter 缺失和新增 smoke case uncovered
- [x] 产出 delta 文件到 `deltas/test/smoke/` — 新增发布后 smoke 用例，验证 CLI/Skill 对新增 smoke case 的 runner 覆盖强制规则

## [code] 代码实现
- [x] 切片1：强化 Skills 与源规格资产，更新 `skills/change-writer`、`skills/test-writer`、`skills/code-implementor`、相关 `spec/` 与同步产物，使新增或修改 smoke 用例时 `[code]` 任务必须包含 smoke runner/reporter/dispatcher 覆盖要求，并同步更新对应测试或快照（覆盖暂定 UT-S31-SMOKE-01、UT-S31-SMOKE-02、ST-S31-SMOKE-01）
- [x] 切片2：实现 CLI smoke 覆盖预检与诊断，提取当前提案新增/修改的 `SMOKE-*` ID，校验 `smoke-results.jsonl`、runner/dispatcher 接入状态和 `smoke.command` 可达性，输出 `smoke_runner_missing` / `smoke_reporter_missing` / `smoke_cases_uncovered`，并同步更新 UT/ST、OpenLogos reporter 和 golden baseline（覆盖暂定 UT-S13-SMOKE-01、UT-S19-SMOKE-01、UT-S19-SMOKE-02、ST-S19-SMOKE-01）
- [x] 切片3：引入或接入统一 smoke dispatcher，支持自动发现并运行 `scripts/smoke-*.sh` 或等效 runner，确保新增 smoke case 可通过统一 `smoke.command` 执行并写入 `logos/resources/verify/smoke-results.jsonl`，并同步更新 UT/ST、OpenLogos reporter、示例配置和发布 smoke 脚本（覆盖暂定 UT-S19-SMOKE-03、ST-S19-SMOKE-02、SMOKE-core-SMOKE-RUNNER-01）

## [deploy] 部署任务
- [ ] 发布包含本变更的 CLI/npm 包与插件/Skill 资产
- [ ] 同步并部署官网文档到 staging/production，确认 smoke command 与统一 dispatcher 配置可用
- [ ] 保留回滚路径：可回退到上一版本 CLI 包、上一版官网部署和旧 smoke command 配置
