# core S37 MODIFIED 根标题守恒误报修复实现清单

## 实现范围

- 在共享 `evaluateDeltaConservation()` 中，仅当 `MODIFIED` 章节锚唯一命中后，使用目标标题的真实 `hit.level` 与 `hit.text` 重建 retained 根标题，并与 Delta 正文共同送入既有结构化 ID 抽取器。
- 根标题身份不从控制锚字符串扫描；标题路径中的父级 `SXX`、`DXX` 或数字 token 不构成叶章节 retained 伪证。
- 根标题重建只保留命中的根 ID；内嵌场景标题、测试表 ID、编号小节与带身份场景表行仍按原有结构位置 fail-closed。
- lint 与 merge 继续复用同一纯函数；不改变违规码、JSON envelope、稳定排序或 `ADDED / MODIFIED / REMOVED / REMOVED-ITEMS` 操作语义。

## 自闭环切片与真实用例

- [x] 单切片：实现根标题最终态重建、内嵌 ID 删除反例、标题路径边界与真实 lint/merge CLI 闭环。
- [x] 单元测试：UT-S37-32、UT-S37-33、UT-S37-34、UT-S37-35、UT-S37-36。
- [x] 场景测试：ST-S37-07、ST-S37-08。
- [x] Reporter：沿用 `cli/test/openlogos-reporter.ts` 与 `cli/vitest.config.ts` 的全局 OpenLogos reporter，7 个新增 ID 均已写入 `logos/resources/verify/test-results.jsonl`。

## 主要产物

- `cli/src/lib/change-lint.ts`
- `cli/test/s37-delta-conservation.test.ts`
- `logos/resources/verify/test-results.jsonl`（测试运行产物，不纳入源码提交）

## 验证结果

- `cd cli && npm run build`：通过。
- `cd cli && npx vitest run test/s37-delta-conservation.test.ts`：44/44 通过。
- `cd cli && npm test`：79 个测试文件、1973/1973 通过。
- Reporter 中 UT-S37-32～UT-S37-36、ST-S37-07～ST-S37-08 均为最新 `pass`。

## 非适用边界

- 无 HTTP、RPC、消息 API 或数据库变更。
- 无部署任务与 smoke；未执行 `openlogos verify`、archive、公开发布或 `git push`。
