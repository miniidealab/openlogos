# core Plan Package 收敛修复实现清单

## 实现范围

- 建立 `openlogos/plan-package-evaluation@1` 共享求值器与中英文 canonical section registry，将 proposal、tasks、澄清状态和部署声明统一投影为稳定 L0 issue。
- launched 项目新建变更时只生成空 `[code]` 锚点；spec 合并前禁止提前写入代码切片，历史 marker 保持兼容旁路。
- change-lint、status、next 与 flow derive 复用同一 Plan Package 结果，并以 `1.3.0` 合同输出 `plan_state`、`completion_issues` 和 producer dispatch completion。
- 建立 `openlogos/asset-manifest@1` 与 hash 绑定的 sync stamp/cache key，覆盖随包插件、Skill、模板和 Schema 的安装态对账、幂等、回滚及用户资产保护。
- TestChangeSet 对 before 侧历史重复 ID 采用候选集合匹配，对 after 侧继续执行唯一 ID、UTF-8 与表结构 fail-closed 校验。
- 新增 `SMOKE-core-135`～`SMOKE-core-140` 安装态 runner，并接入统一 smoke dispatcher；正式 smoke 留待独立授权节点执行。

## 自闭环切片与真实用例

- [x] 切片1：Plan Package 生产与 L0 诊断，27 个 UT/ST ID。
- [x] 切片2：Plan Package 状态与下一步机器合同，14 个 UT/ST ID。
- [x] 切片3：托管资产与 sync 身份，7 个 UT/ST ID。
- [x] 切片4：历史测试 ID 原子自举收敛，2 个 UT/ST ID。
- [x] `TEST_SLICE_MANIFEST.json` 共分配 50 个唯一 UT/ST ID，无遗漏、无跨切片重复。
- [x] Reporter：沿用 `cli/test/openlogos-reporter.ts` 与 `cli/vitest.config.ts`；全量回归后上述 50 个 ID 均有最新 `pass` 记录。

## 主要产物

- `cli/src/lib/plan-package-contract.ts`、`cli/src/lib/plan-package.ts`
- `cli/src/lib/proposal-lifecycle.ts`、`cli/src/lib/flow-derive.ts`、`cli/src/lib/flow-overlay-derive.ts`、`cli/src/lib/step-registry.ts`
- `cli/src/lib/asset-manifest.ts`、`cli/scripts/build-asset-manifest.mjs`、`cli/asset-manifest.json`
- `cli/src/lib/test-change-set.ts`
- `cli/src/commands/change.ts`、`change-lint.ts`、`status.ts`、`next.ts`、`sync.ts`
- `cli/test/plan-package.test.ts`、`plan-state-contract.test.ts`、`asset-manifest.test.ts`、`test-change-set.test.ts` 及相关兼容回归夹具/快照
- `scripts/smoke-plan-package-convergence.js`、`scripts/run-smoke.js`
- `logos/changes/fix-plan-package-convergence-gap/TEST_SLICE_MANIFEST.json`

## 验证结果

- `cd cli && npm run lint`：通过。
- `cd cli && npm run build`：通过。
- `cd cli && npm test`：83 个测试文件、2040/2040 通过。
- 50 个本变更 UT/ST ID 均由 OpenLogos reporter 记录为 `pass`。
- `node scripts/smoke-plan-package-convergence.js --self-test`：通过；确认 6 个 smoke ID、候选版 `0.13.31`、回滚版 `0.13.30`、tarball 环境变量路由及零公开发布命令。

## 非适用边界

- 无 HTTP、RPC、消息 API、数据库或迁移变更。
- 本轮未执行 `openlogos verify`、正式 smoke、部署、archive、公开发布或 `git push`。
