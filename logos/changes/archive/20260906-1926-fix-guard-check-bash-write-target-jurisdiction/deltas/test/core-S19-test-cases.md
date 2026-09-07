# Delta: core-S19-test-cases.md

> change: fix-guard-check-bash-write-target-jurisdiction
> 目标：`logos/resources/test/core-S19-test-cases.md`

## ADDED — 0.14.24 候选身份测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S19-41 | 0.14.24 候选身份全源一致 | `LOCAL_RELEASE_CANDIDATE_VERSION === '0.14.24'`、`LOCAL_RELEASE_ROLLBACK_VERSION === '0.14.23'`；package.json/lockfile/五 plugin manifest/asset-manifest version 全部精确 `0.14.24`；回滚制品身份 tripwire：固定 0.14.23 tarball SHA-256 `de042d28db4e143a0da0e1e4dc63a9169557ac9cc4dde4ead8e8164ccf507a5b` 在场且可校验；SMOKE-core-195 runner 已接入 `scripts/run-smoke.js` 且 `--self-test` 合同含 `ids:['SMOKE-core-195']`、`public_release_commands:[]` |

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`；失败不得写 pass。
