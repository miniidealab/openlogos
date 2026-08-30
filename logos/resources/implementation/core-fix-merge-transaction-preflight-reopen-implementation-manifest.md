# fix-merge-transaction-preflight-reopen 实现清单

> module: core
>
> change: `fix-merge-transaction-preflight-reopen`
>
> candidate: `@miniidealab/openlogos@0.14.2`

## 实现范围

- merge transaction 在 seal 前构建 `openlogos/merge-preflight@1` canonical view，绑定 planned/derived target、test-change-set、metadata 与最终路径 hash；apply 首个可变动作前重算并逐项对账。
- test-change-set scanner 以结构化 `code/targetPaths/retryable` 错误提供 target-aware 归因；只有全部唯一映射到 Agent slot 时才允许同事务 reopen。
- ready/new-seal 与 0.14.1 legacy sealed 失败时先原子持久化 collecting snapshot，再尽力清理 rejected 私有字节；mixed、OpenLogos、unknown、正式漂移或 apply artifact 均 fail-closed。
- 公共 merge transaction projection、JSON Schema 与 action/classification 集合保持不变；内部 preflight 不泄漏到 status/next/error envelope。
- 候选身份升级为 0.14.2 并冻结 schema/status/next/contract/merge-executor Skill/golden hashes；回滚基线为固定 0.14.1。
- 新增 SMOKE-core-160～162 安装态 runner、fixture、dispatcher 与 `smoke-results.jsonl` reporter；RunLogos 分支要求独立显式授权环境变量。

## 测试追溯

- 切片 1：UT-S09-261、UT-S16-33、UT-S39-56、UT-S39-57。
- 切片 2：UT-S05-46、ST-S05-21、UT-S09-262、UT-S09-263、UT-S09-264、UT-S09-265、ST-S09-102、ST-S09-103、UT-S11-74、ST-S11-43、UT-S16-34、ST-S16-10、UT-S39-58、ST-S39-27。
- 切片 3：UT-S19-24、UT-S19-25、ST-S19-16；SMOKE-core-160、SMOKE-core-161、SMOKE-core-162 已完成 runner 覆盖预检，正式 smoke 尚未执行。
- Vitest 使用项目现有 `cli/test/openlogos-reporter.ts`，逐 ID 写入 `logos/resources/verify/test-results.jsonl`；smoke runner 写入 `logos/resources/verify/smoke-results.jsonl`。

## 已执行自检

- `cd cli && npm run build`：PASS。
- `cd cli && npm run lint`：PASS。
- `cd cli && npm test`：PASS，85 个测试文件、2077 个测试全部通过。
- ST-S19-16：真实 `npm pack` 与隔离 prefix 安装通过，完成 0.14.1→0.14.2→0.14.1→0.14.2；安装态 SMOKE-core-160/161 fixture 通过。
- `node scripts/smoke-release-0-14-2-preflight-reopen.js --self-test`：PASS，确认三条 smoke ID、0.14.2/0.14.1 身份、dispatcher 与 RunLogos 授权锁。
- `git diff --check`：PASS。

## 未执行的人类确认点

本轮未运行 `openlogos verify`、全局部署、正式 `openlogos smoke`、RunLogos 恢复/继续 merge、`openlogos archive` 或 `git push`；这些动作继续分别等待用户明确授权。
