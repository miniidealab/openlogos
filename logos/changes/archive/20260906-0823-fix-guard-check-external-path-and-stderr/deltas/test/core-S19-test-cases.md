# Delta: core-S19-test-cases.md（fix-guard-check-external-path-and-stderr）

## ADDED — 0.14.22 候选身份测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S19-39 | 0.14.22 候选身份全源一致 | `LOCAL_RELEASE_CANDIDATE_VERSION === '0.14.22'`、`LOCAL_RELEASE_ROLLBACK_VERSION === '0.14.21'`；package.json/lockfile/五 plugin manifest/asset-manifest version 全部精确 `0.14.22`；asset-manifest 含 `claude-plugin-template/bin/guard-check` 版本化哈希条目且与随包字节一致（含管辖边界判定与 block() stderr 输出的新字节） |

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`；失败不得写 pass。
