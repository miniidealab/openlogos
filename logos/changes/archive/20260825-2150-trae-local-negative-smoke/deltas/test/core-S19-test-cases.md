## ADDED — `local-isolated` TRAE 负向 Smoke 门禁测试

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S19-10 | 双 tarball 输入与 `local-isolated` 部署前置校验 | S19 前置门禁 / 部署方案 | 活跃提案需要部署与 smoke | 候选/回滚 tarball 的存在性、包名、版本、SHA；`DEPLOY_DONE` 的存在性和环境 | 仅候选 0.13.29、回滚 0.13.28 均有效，且 `[deploy]` 完成、`DEPLOY_DONE.environment="local-isolated"` 时 ready；任一缺失、版本漂移、环境不符均阻断且不调度 runner |
| UT-S19-11 | 负向 dispatcher/reporter 覆盖与证据校验 | S19 主时序 / reporter 合同 | dispatcher 声明 SMOKE-core-124～129 | runner 发现列表及 JSONL：覆盖缺失、skip、fail、重复矛盾、环境/SHA 不符、完整 pass 等组合 | 仅六个 ID 各有唯一真实 pass、环境为 local-isolated、制品 SHA 匹配且 evidence 完整时 Gate PASS；其余均给出精确诊断且不得写 `SMOKE_PASS` |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S19-09 | 部署完成后执行真实本地负向 smoke 闭环 | 前置读取 → dispatcher → runner → reporter → Gate | verify 已通过；部署报告及同环境 DEPLOY_DONE 存在；两个固定 tarball 有可追溯 SHA；用户明确授权 smoke | 执行 `openlogos smoke --env local-isolated`；dispatcher 发现 runner；runner 实际执行 SMOKE-core-124～129；collector 校验结果和审计链 | 六个用例全部 pass 时生成环境为 local-isolated 的 `smoke-report.md` 与 `SMOKE_PASS`；任一失败/skip/缺失或证据不符时写 FAIL、保留诊断且不生成成功 marker；全程无真实 TRAE/用户/公开发布副作用 |

### 异常覆盖

- 缺少 `DEPLOY_DONE`、环境不是 `local-isolated`、`[deploy]` 未完成或 proposal/tasks 冲突：命令在 runner 前失败。
- 候选不是 `0.13.29`、回滚不是 `0.13.28`、tarball SHA 漂移或 CLI 入口逃逸：门禁/runner 失败。
- wrapper 直调、项目 Hook 文件存在、UI/Rules/MCP 软拒绝被报告为 capability PASS：reporter 审计失败。
- runner 访问真实 HOME、全局 npm、真实 `.trae/**`、账号/记忆，或触发 publish/tag/release/官网部署：立即失败并记录副作用诊断。

### 自动化、证据与覆盖

- UT/ST 名称必须包含对应 ID，并通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`；至少包含 `test_id`、`scenario_id="S19"`、`status`、`duration_ms` 和脱敏 evidence。
- [x] 双 tarball 与部署环境前置：UT-S19-10、ST-S19-09。
- [x] dispatcher 发现、六 ID 覆盖及 reporter 审计：UT-S19-11、ST-S19-09。
- [x] 缺失/skip/fail/证据不符不得产生 PASS：UT-S19-11、ST-S19-09。
