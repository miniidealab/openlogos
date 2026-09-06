# Delta: core-S19-test-cases.md（fix-next-ensure-initial-plan-slice-transaction）

## ADDED — 0.14.23 候选身份测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S19-40 | 0.14.23 候选身份全源一致 | `LOCAL_RELEASE_CANDIDATE_VERSION === '0.14.23'`、`LOCAL_RELEASE_ROLLBACK_VERSION === '0.14.22'`；package.json/lockfile/五 plugin manifest/asset-manifest version 全部精确 `0.14.23`；SMOKE-core-194 runner 已接入 `scripts/run-smoke.js` 且 `--self-test` 合同含 `ids:['SMOKE-core-194']`、`public_release_commands:[]` |

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`；失败不得写 pass。
