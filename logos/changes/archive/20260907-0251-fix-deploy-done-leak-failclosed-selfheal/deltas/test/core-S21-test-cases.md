# core-S21-test-cases delta — fix-deploy-done-leak-failclosed-selfheal

## ADDED — S21 唯一 writer 与消费侧收口回归测试

> S21 场景文档本次由缺失补齐为完整文档（`core-S21-deploy-done-marker.md` CREATE）。`openlogos deploy-done` 的**命令自身行为零变化**——既有 `UT-S21-01`～`UT-S21-09`、`ST-S21-01`～`ST-S21-03` 与 `cli/test/s21-deploy-done.test.ts` 继续覆盖其六项前置校验、`[deploy]` 勾选同步、旧 smoke 标记清理与错误分支零副作用。
>
> 本节新增的是场景文档新固化的两条**跨命令不变量**的回归锚点：`DEPLOY_DONE` 的唯一 writer 身份，以及漏跑 `deploy-done` 时缺口不再扩散（由下游 fail-closed 与对账投影承接，S21 自身不自愈）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S21-10 | `DEPLOY_DONE` 唯一 writer：除 deploy-done 外无命令写该 marker | S21 原子性与唯一 writer 不变量 1 | 构造需部署提案，`VERIFY_PASS` + `deployment-report.md` 在场、`DEPLOY_DONE` 缺失 | 依次执行 `openlogos smoke`、`openlogos archive`、`openlogos status`、`openlogos next`（含 `--format json`） | 四条命令执行前后 `DEPLOY_DONE` 始终不存在——**无一命令写入或补写该 marker**；`smoke`/`archive` 走 fail-closed 拒绝，`status`/`next` 走只读派生；提案目录内 marker 集合零变化 |
| UT-S21-11 | 成功路径写入顺序：marker 最后写，蕴含勾选与清理已完成 | S21 原子性与唯一 writer 不变量 3 | 六项前置全满足，`[deploy]` 未勾且存在旧 `SMOKE_PASS` | 执行 `openlogos deploy-done` | 成功后 `[deploy]` 全勾、旧 `SMOKE_PASS` 已清理、`DEPLOY_DONE` 在场；`cleared_smoke_markers` 含 `SMOKE_PASS`；对错误分支（如移除 `deployment-report.md`）重放：**三者皆无变化**，不得出现「只写 marker 未勾选」的部分状态 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S21-04 | 漏跑 deploy-done 的缺口不扩散（EX-21.7 闭环） | S21 主时序 Step 10 + EX-21.7 | 真实 CLI；需部署需 smoke 提案，部署与 smoke 实际都已完成，但**未跑** `openlogos deploy-done` | ① `openlogos smoke` → ② `openlogos archive` → ③ `openlogos status --format json` / `next` → ④ 补跑 `openlogos deploy-done` → ⑤ 重放①②③ | ① `SMOKE_DEPLOY_NOT_DONE` 拒绝且无 `SMOKE_PASS` 产生；② `ARCHIVE_DEPLOY_NOT_DONE` 拒绝且目录未移动、guard 未删；③ 输出 `state_inconsistency` 投影并给出 `openlogos deploy-done`；④ 落标成功；⑤ smoke 正常执行、archive 链条按 `SMOKE_PASS` 状态继续判定、投影字段消失——**缺口只能由唯一 writer 补上，且补上后全链自然恢复** |

### 追溯与覆盖

- AC-S21-01～AC-S21-06（deploy-done 六项前置、勾选同步、smoke 标记清理、错误分支零副作用）：既有 UT-S21-01～UT-S21-09、ST-S21-01～ST-S21-03，本次行为零变化、逐项零回归。
- AC-S21-07 唯一 writer 不变量（消费者不得写 `DEPLOY_DONE`）：UT-S21-10、ST-S21-04。
- AC-S21-08 成功路径写入顺序与不产生部分状态更新：UT-S21-11。
- AC-S21-09 漏标缺口不扩散、补标后全链恢复：ST-S21-04。
- 场景：`core-S21-deploy-done-marker.md`（原子性与唯一 writer 不变量、EX-21.7、消费侧收口）；功能规格：§2.11、§2.11.1、§2.67。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S21"`；失败不得写 pass。
- 「无命令写 marker」断言以调用前后提案目录 marker 文件集合比对取证，不得只断言命令退出码。
- 全部断言在一次性临时项目中构造，不得触碰本仓或用户其它项目的活跃提案与 guard。
