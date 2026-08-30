# core release-0-14-1-local 实现清单

## 实现范围

- 把当前 npm package、lockfile、Claude/Codex/ZCode/Qoder/WorkBuddy 五类随包插件、asset manifest 与 candidate evidence 的当前版本身份统一为 `0.14.1`，保留 `0.14.0` breaking、history、legacy 与 rollback 语义。
- 新增本地候选身份冻结与命令图校验：同源 `0.14.1` facts 通过，旧版本、混合插件版本、非法 hash、越界路径和 publish/dist-tag/tag/release/deploy/push 动作 fail-closed。
- 提供固定 `0.14.0` tarball 的回滚计划，以及隔离 prefix 中真实 `pack → install → self-check → rollback → restore` 场景测试。
- 新增 SMOKE-core-157～159 runner、JSONL reporter 和统一 dispatcher 接入；SMOKE-core-158 只通过冻结的绝对 CLI 入口使用 status/next/transaction 公共投影，不读取仓库源码或私有 transaction 文件。

## 自闭环切片与真实用例

- [x] 单切片：UT-S19-22、UT-S19-23、ST-S19-15。
- [x] 部署后 smoke 执行器：SMOKE-core-157、SMOKE-core-158、SMOKE-core-159 的 runner/reporter/dispatcher 已实现；真实 PASS 只能在后续获授权的部署与 smoke 门产生。
- [x] OpenLogos reporter 已由 `cli/test/openlogos-reporter.ts` 统一写入 `logos/resources/verify/test-results.jsonl`；最新三条结果均为真实 `pass`。

## 主要产物

- `cli/src/lib/local-release-candidate.ts`
- `cli/src/lib/merge-transaction-candidate.ts`
- `cli/src/lib/merge-transaction-semantic.ts`
- `cli/test/s19-release-0-14-1.test.ts`
- `scripts/smoke-release-0-14-1-local.js`
- `scripts/run-smoke.js`
- `cli/package.json`、`cli/package-lock.json`、五类插件 manifest 与 `cli/asset-manifest.json`
- `CHANGELOG.md` 与必要 golden

## 验证结果

- `cd cli && npm run build`：通过。
- `cd cli && npm run lint`：通过。
- `cd cli && npx vitest run test/s19-release-0-14-1.test.ts`：3/3 通过。
- `cd cli && npm test`：85 个测试文件、2056/2056 通过。
- 安装态公共 transaction 自测：CREATE/MODIFY slots、status/next 投影、seal/apply、completed receipt 闭包、未知 action 与 abort parity 均通过。
- smoke 覆盖预检：SMOKE-core-157～159 均有 runner/reporter/dispatcher 归属，`uncovered_case_ids=[]`，且公共投影约束通过。

## 尚未执行的授权节点

- 未执行 `openlogos verify`。
- 未安装到本机 npm 全局环境，未执行真实 `openlogos smoke`，未写 `DEPLOY_DONE` 或 `SMOKE_PASS`。
- 未执行 npm publish、dist-tag、Git tag、GitHub Release、官网部署、`openlogos archive` 或 `git push`。
