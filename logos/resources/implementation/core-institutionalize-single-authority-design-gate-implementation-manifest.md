# institutionalize-single-authority-design-gate 实现清单

> module: core
>
> change: `institutionalize-single-authority-design-gate`
>
> candidate: `@miniidealab/openlogos@0.14.2`

## 实现范围

- 新增唯一 `AuthorityClosureEvaluator`，严格解析 `openlogos/authority-impact@1`，统一裁决权威引用、闭包完整性、计划 CREATE、真实测试 ID 与历史兼容。
- `PlanPackageEvaluator`、change-lint、status、next 与 flow 统一消费同一份 Authority Closure evaluation；机器摘要保持八字段闭合合同，问题码保持五值闭合枚举。
- 新增 Authority Registry、场景时序、八维故障矩阵与 Shadow Authority Critical 诊断；六个角色 Skill 的根源与插件投影受资产契约校验。
- 新增 candidate 资产身份、writer cutover/rollback 状态检查与安装态 smoke runner；候选包必须包含根规范、评估器、六个 Skill、插件投影及对应 manifest/hash。
- proposal scaffold、CLI JSON Schema、asset manifest 与测试兼容夹具随新合同同步更新。

## 测试追溯

- 切片 1：UT-S09-266～270、ST-S09-104～105、UT-S16-35～37、ST-S16-11、UT-S35-112～120、ST-S35-19～21，共 23 个真实 UT/ST ID。
- 切片 2：UT-S04-01～04、ST-S04-01、UT-S06-01～06、ST-S06-01～02、UT-S07-01～06、ST-S07-01～02、UT-S12-01～06、ST-S12-01，共 28 个真实 UT/ST ID。
- 切片 3：UT-S19-26～28、ST-S19-17，共 4 个真实 UT/ST ID；SMOKE-core-163～167 已完成 runner 与覆盖预检，正式 smoke 尚未执行。
- Vitest 使用项目现有 OpenLogos reporter，逐 ID 写入 `logos/resources/verify/test-results.jsonl`；smoke runner 按逐 ID 协议写入 `logos/resources/verify/smoke-results.jsonl`。

## 已执行自检

- `cd cli && npm run build`：PASS。
- 本次变更涉及的 CLI 源文件执行 ESLint：PASS；仓库全量 `npm run lint` 仍被未改动的 `merge-transaction.ts` 既有未使用变量阻断。
- Authority Closure、角色门、candidate 与 change-lint 定向回归：PASS，4 个测试文件、96 个测试全部通过。
- `cd cli && npm test`：PASS，88 个测试文件、2132 个测试全部通过。
- `node --check scripts/smoke-authority-closure-candidate.js`：PASS。
- `node scripts/smoke-authority-closure-candidate.js --self-test`：PASS，确认 SMOKE-core-163～167、隔离 candidate/rollback 输入、dispatcher 环境路由，以及每条 reporter 的 version/entry realpath/tarball SHA/asset hash 身份合同。
- `git diff --check`：PASS。

## 未执行的人类确认点

本轮未运行 `openlogos verify`、candidate 部署、正式 `openlogos smoke`、`openlogos archive` 或 `git push`；这些动作继续分别等待用户明确授权。
