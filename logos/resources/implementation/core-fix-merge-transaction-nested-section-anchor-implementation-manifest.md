# fix-merge-transaction-nested-section-anchor 实现清单

> module: core
>
> change: `fix-merge-transaction-nested-section-anchor`
>
> candidate: `@miniidealab/openlogos@0.14.4`

## 实现范围

- 新增唯一 `MarkdownSectionAuthority`，统一提供 fence-aware Delta block parser、真实 ATX heading tree、路径锚唯一解析、Agent material outcome verifier 与 OpenLogos Markdown composer。
- change-lint 的 S37 守恒判据直接消费共享 block/hit；merge transaction 的 Agent preflight/apply 重验和 OpenLogos producer 合成也消费同一 authority。
- 删除 transaction 私有非 fence `parseDeltaSections`、扁平路径 heading 正则与精确 H2 composer；`REMOVED-ITEMS` 只参与守恒声明，不进入物质写入。
- 保持 submit 原始字节职责、可归因 slot 局部 reopen、preflight/seal/apply 首写前身份校验、公共 transaction schema 与 JSON projection 不变。
- 将 package、lockfile、五类 plugin manifest、candidate/rollback 常量与 asset manifest 同步到 `0.14.4` / `0.14.3`。
- 新增 `SMOKE-core-168` 安装态临时 fixture、受控本机全局往返/RunLogos 原事务 runner、JSONL reporter 与 `scripts/run-smoke.js` 显式路由；正式 smoke 仍受独立授权约束。

## 测试追溯

- S09：`UT-S09-271`、`UT-S09-272`、`UT-S09-273`、`UT-S09-274`、`ST-S09-106`、`ST-S09-107`。
- S37：`UT-S37-37`、`UT-S37-38`、`UT-S37-39`、`UT-S37-40`、`ST-S37-09`、`ST-S37-10`。
- 安装态：`SMOKE-core-168` 已实现 runner、dispatcher、`smoke-results.jsonl` reporter 与覆盖预检；正式授权态 smoke 尚未执行。
- Vitest 使用项目现有 `cli/test/openlogos-reporter.ts`，逐 ID 写入 `logos/resources/verify/test-results.jsonl`。

## 已执行自检

- `cd cli && npm run lint`：PASS。
- `cd cli && npm run build`：PASS。
- 本提案 13 个真实 UT/ST/SMOKE ID 定向回归：PASS，3 个测试文件、12 个测试通过。
- `cd cli && npm test`：PASS，90 个测试文件、2144 个测试全部通过。
- `node scripts/merge-preflight-reopen-smoke-fixtures.js --case SMOKE-core-168 --openlogos cli/dist/index.js`：PASS；临时 transaction completed，真实 H3/path 身份与 receipt/final hash 可复算。
- `node scripts/smoke-nested-section-anchor-0-14-4.js --self-test`：PASS；确认 0.14.4/0.14.3 身份、RunLogos 独立授权锁、原 transaction ID 与零公开发布动作。
- smoke 覆盖预检测试：PASS，确认 `SMOKE-core-168` 由 dispatcher 可达且 reporter 结果可唯一覆盖。
- `git diff --check`：PASS。

## 未执行的人类确认点

本轮未运行 `openlogos verify`、candidate 打包/本机全局部署、正式 `openlogos smoke`、RunLogos 原 transaction 写入、`openlogos archive` 或 `git push`；这些动作继续分别等待用户明确授权。
