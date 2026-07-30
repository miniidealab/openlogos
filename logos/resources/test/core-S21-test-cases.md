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
