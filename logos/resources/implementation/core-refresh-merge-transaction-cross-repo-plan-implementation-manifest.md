# refresh-merge-transaction-cross-repo-plan 实现清单

## 实现结论

- OpenLogos CLI 候选版本已切换为 `0.14.0`。
- 新增 OpenLogos 单一写者的 merge transaction：稳定 plan/transaction/slot 身份、受控 content slot、seal、原子 apply、completed receipt、恢复与幂等重试。
- `status`、`next` 与 `merge transaction status` 复用同一只读投影，公共契约版本为 `1.4.0`。
- 旧 `merge-apply --manifest` 安装态成功路径固定返回 `legacy_manifest_rejected`；现有原子 batch applier 仅作为内部原语保留。
- no-delta、UI 原型、metadata、根规格/Skill dogfood、test change set、receipt 与 `SPEC_MERGED` 进入同一事务闭包。
- 新增 `SMOKE-core-141`～`SMOKE-core-150` 候选 smoke runner 和 `SMOKE-core-143`～`SMOKE-core-149` 真实子进程 fixture harness；RunLogos 接缝只接受冻结的全局候选路径。

## 切片交付

| 切片 | 能力闭环 | 测试覆盖 |
|---|---|---|
| 1 | 创建事务、提交 content、seal、status/next 同源投影 | 50 个 S05/S09/S11/S16/S39 UT/ST ID |
| 2 | 原子 apply、metadata/test-change-set/marker、receipt、故障恢复 | 30 个 S09/S11/S39 UT/ST ID |
| 3 | 0.14.0 断代、pack 资产、自检/回滚与跨仓 smoke 接缝 | 13 个 S09/S16/S19 UT/ST ID + 10 个 smoke ID |

## 主要实现文件

- `cli/src/lib/merge-transaction.ts`
- `cli/src/commands/merge-transaction.ts`
- `cli/src/commands/merge.ts`
- `cli/src/commands/merge-apply.ts`
- `cli/src/commands/status.ts`
- `cli/src/commands/next.ts`
- `cli/src/index.ts`
- `cli/test/merge-transaction.test.ts`
- `cli/test/fixtures/merge-transaction-golden.json`
- `scripts/smoke-merge-transaction-candidate.js`
- `scripts/merge-transaction-smoke-fixtures.js`
- `scripts/run-smoke.js`

## 验证证据

- TypeScript build：通过。
- CLI 全量测试：84 个测试文件、2045 个测试全部通过。
- 新增事务用例：93 个真实 UT/ST ID 均由 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`；同一 ID 的故障注入补充断言会产生额外 pass 记录。
- smoke 覆盖预检：10/10 ID 命中正式 smoke 规格，公开发布命令集合为空。
- 本地源码候选 fixture：`SMOKE-core-143`～`SMOKE-core-149` 全部通过。
- `npm pack --json --dry-run`：候选身份为 `@miniidealab/openlogos@0.14.0`，随包包含 transaction 命令、schema 与双语 merge-executor Skill。

## 尚未执行的人类授权节点

本清单不代表 `openlogos verify`、全局部署、`openlogos smoke` 或 RunLogos 跨仓 E2E 已获授权或已完成；这些节点继续按部署方案独立执行。
