# S21: 标记部署完成 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S21-01 | 解析 guard 定位活跃提案 | deploy-done command | 存在 `logos/.openlogos-guard` | root path | 返回 slug 和 proposalDir |
| UT-S21-02 | 缺少 VERIFY_PASS 时拒绝写 DEPLOY_DONE | deploy-done preflight | 活跃提案缺少 `VERIFY_PASS` | deploy-done | 失败且不写 marker |
| UT-S21-03 | 存在 VERIFY_FAIL 时拒绝写 DEPLOY_DONE | deploy-done preflight | 活跃提案存在 `VERIFY_FAIL` | deploy-done | 失败且不写 marker |
| UT-S21-04 | 部署决策冲突时拒绝写 DEPLOY_DONE | deployment decision | proposal/tasks 冲突 | deploy-done | 失败并输出冲突原因 |
| UT-S21-05 | 缺少 `[deploy]` section 时拒绝写 DEPLOY_DONE | tasks parser | 提案声明需要部署但 tasks 缺少 `[deploy]` | deploy-done | 失败且不写 marker |
| UT-S21-06 | 缺少部署报告时拒绝写 DEPLOY_DONE | deploy report gate | 缺少 `deployment-report.md` | deploy-done | 失败且不写 marker |
| UT-S21-07 | 成功时勾选 `[deploy]` 并写入 DEPLOY_DONE | deploy-done command | 前置条件满足 | deploy-done | `[deploy]` 全勾，`DEPLOY_DONE` 存在 |
| UT-S21-08 | 成功时清理旧 smoke marker | deploy-done command | 存在旧 `SMOKE_PASS` / `SMOKE_FAIL` | deploy-done | 删除旧 smoke marker |
| UT-S21-09 | JSON 输出包含部署完成摘要 | deploy-done json | 前置条件满足 | deploy-done --format json | 输出 slug、marker_path、deploy_tasks、next_step |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S21-01 | 需要 smoke 的提案部署完成后进入 ready-to-smoke | Step 1→10 | 活跃提案 `VERIFY_PASS`、需要部署和 smoke、存在部署报告 | `openlogos deploy-done --env staging` → `openlogos status --format json` | 写入 `DEPLOY_DONE`，`proposal_step=ready-to-smoke` |
| ST-S21-02 | 无需 smoke 的提案部署完成后进入 deploy-done | Step 1→10 | 活跃提案 `VERIFY_PASS`、需要部署但无需 smoke、存在部署报告 | `openlogos deploy-done` → `openlogos next --format json` | `proposal_step=deploy-done`，建议 archive |
| ST-S21-03 | deploy-done 不执行实际部署命令 | Step 1→10 | 部署报告已存在 | `openlogos deploy-done` | 不调用 build/push/ssh/npm publish 等外部部署命令，只写状态文件 |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S21-EX-2.1 | 项目未初始化 | EX-2.1 | 缺少 `logos/logos.config.json` | `openlogos deploy-done` | 输出项目未初始化错误 |
| ST-S21-EX-3.1 | 缺少活跃提案 | EX-3.1 | 缺少 guard | `openlogos deploy-done` | 输出无活跃提案错误 |
| ST-S21-EX-4.1 | verify 未通过 | EX-4.1 | 缺少 `VERIFY_PASS` 或存在 `VERIFY_FAIL` | `openlogos deploy-done` | 不写 `DEPLOY_DONE` |
| ST-S21-EX-5.1 | 部署决策冲突 | EX-5.1 | proposal/tasks 冲突 | `openlogos deploy-done` | 输出冲突原因，不写 marker |
| ST-S21-EX-5.2 | 提案无需部署 | EX-5.2 | `deployment_required=false` | `openlogos deploy-done` | 提示无需部署，不写 marker |
| ST-S21-EX-6.1 | 部署报告缺失 | EX-6.1 | 缺少 `deployment-report.md` | `openlogos deploy-done` | 提示先生成部署报告，不写 marker |

## S21 唯一 writer 与消费侧收口回归测试

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
