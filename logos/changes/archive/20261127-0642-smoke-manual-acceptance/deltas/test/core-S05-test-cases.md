## ADDED — 等待人工验收的 next 建议测试（smoke-manual-acceptance）

> 覆盖场景 `core-S05-next-guidance.md`「等待人工验收的 next 建议」Step 1～3、EX-5.6～EX-5.8，功能规格 §2.107.7～§2.107.9，需求 AC-SMOKE-MANUAL-13、AC-SMOKE-MANUAL-14。全部用例在 `mktemp -d` 一次性项目中构造（活跃提案已 verify PASS、`[deploy]` 全勾、`DEPLOY_DONE` 指向账本中的部署 D），测试代码写入 OpenLogos reporter，`scenario_id="S05"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|----|--------|---------|------|---------|
| UT-S05-58 | pending 派生驻留态与建议 | 无 `SMOKE_PASS` / `SMOKE_FAIL`；账本中 D 的最近 smoke 行 `result=pending`、`manual_pending=[ST-S01-05, SMOKE-core-901]` | `next --format json`、`status --format json` | 驻留态 `awaiting-manual-acceptance`，label「等待人工验收」；建议命令原文为 `openlogos accept --env prod --deploy <D> --case ST-S01-05,SMOKE-core-901 --result pass\|fail`，并注明需要人执行；`auto_execute=false`；`data.manual_acceptance.remaining` 两条 |
| UT-S05-59 | `--auto` 不放行 | 同上 | `next --auto --format json` | `gate_auto_passed` 不为 true；不追加 `GATE_AUTO_PASSED`；`auto_execute=false` |
| UT-S05-60 | 剩余为空时建议重跑 smoke | pending 行之后 D 的 manual 行覆盖了全部 `manual_pending` | `next --format json`；`next --auto --format json` | 驻留态仍为 `awaiting-manual-acceptance`；建议命令为 `openlogos smoke --env prod`；`auto_execute` 与 `ready-to-smoke` 同口径（`--auto` 下按 smoke standing 授权可执行） |
| UT-S05-61 | 派生只读账本 | UT-S05-58 夹具，spy 包装 git 调用 | `next` | 不调用任何 git 子进程；不运行 smoke 命令 |
| UT-S05-62 | 重新部署后旧 pending 失效 | pending 行属于 D1；`DEPLOY_DONE.deploy_id=D2`，D2 没有 smoke 行 | `next` | 回到 `ready-to-smoke` |
| UT-S05-63 | 通过已过期或不属于本部署 | 两臂：① `SMOKE_PASS` 在场，账本中 D 的通过记录之后有 D 的 manual 行；② 环境开启人工验收，`SMOKE_PASS` 由旧部署 D1 的 smoke 写回，`DEPLOY_DONE` 指向 D2，D2 没有 smoke 记录 | `next` | 不派生为可归档；驻留态 `ready-to-smoke`，文案说明「人工结果在通过后有更新，需重跑 smoke」 |
| UT-S05-64 | 版本通道不派生提案驻留态 | 无活跃提案；`prod` 当前部署最近 smoke 行为 pending | `next`、`status` | `next` 没有 `awaiting-manual-acceptance` 驻留态；`status.environments[]` 中 `prod.manual_acceptance.waiting.remaining` 正确 |
| UT-S05-65 | 没有 pending 时既有派生不变 | 既有 S05 deploy-done / ready-to-smoke / 归档建议夹具（账本无 pending 行、无 manual 行） | `next` / `status` | 输出与引入前逐字一致 |
| UT-S05-66 | next.schema.json 覆盖新驻留态 | UT-S05-58 的输出 | 用 `spec/schema/next.schema.json` 校验 | 校验通过 |

### 覆盖度校验

| 来源 | 覆盖用例 |
|------|---------|
| 派生条件 1～3 | UT-S05-58、UT-S05-62、UT-S05-65 |
| 建议内容（剩余非空 / 为空 / 通过已过期） | UT-S05-58、UT-S05-60、UT-S05-63 |
| 只读账本 | UT-S05-61 |
| EX-5.6 | UT-S05-59 |
| EX-5.7 | UT-S05-62 |
| EX-5.8 | UT-S05-64 |
| JSON 契约 | UT-S05-66 |

### 自动化与证据要求

- 账本与标记在一次性项目中构造；全部用例写 OpenLogos reporter，测试名含对应 ID。
