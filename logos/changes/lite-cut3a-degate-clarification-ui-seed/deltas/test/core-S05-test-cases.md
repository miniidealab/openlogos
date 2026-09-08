# Delta: core-S05-test-cases.md

> change: lite-cut3a-degate-clarification-ui-seed
> 目标：`logos/resources/test/core-S05-test-cases.md`

seed 恢复门由「不可恢复即硬阻塞」改为「隔离损坏 journal 后继续」（§2.74.3）。**只改损坏分支**：可前滚/可回滚路径与读锁竞争语义逐字不变，故本文件中断言锁竞争的用例一律不动。

## MODIFIED — 一、单元测试用例


| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S05-01 | 空项目应建议 Phase 1 | status/next 逻辑 | 无活动提案 | next | 输出 Phase 1 建议 |
| UT-S05-15 | 无需部署提案 VERIFY_PASS 后建议 archive | 提案级部署决策 | `proposal.md` 声明无需部署、无 `[deploy]` section、存在 `VERIFY_PASS` | next | `proposal_step=verify-passed`，建议 `openlogos archive <slug>` |
| UT-S05-16 | 需要部署提案 VERIFY_PASS 后建议部署授权 | 提案级部署决策 | `proposal.md` 声明需要部署、存在 `[deploy]` section、存在 `VERIFY_PASS` | next | `proposal_step=ready-to-deploy`，建议人类明确授权部署 |
| UT-S05-17 | 部署完成且无需 smoke 后建议 archive | 提案级 smoke 决策 | `DEPLOY_DONE` 存在、`smoke_required=false` | next | 建议 `openlogos archive <slug>` |
| UT-S05-18 | deploy-done 后需要 smoke 时建议运行 smoke | S21/S05 | `VERIFY_PASS`、`DEPLOY_DONE`、`[deploy]` 全勾、`smoke_required=true` | next | `proposal_step=ready-to-smoke`，建议明确授权执行 `openlogos smoke` |
| UT-S05-19 | deploy-done 后无需 smoke 时建议 archive | S21/S05 | `VERIFY_PASS`、`DEPLOY_DONE`、`[deploy]` 全勾、`smoke_required=false` | next | `proposal_step=deploy-done`，建议明确授权执行 `openlogos archive <slug>` |
| UT-S05-bootstrap-01 | bootstrap=adopted 且 baseline_seed_state:required 无提案时直接引导 change | next 逻辑 | 模块 bootstrap=adopted、`baseline_seed_state:required`、无 guard、无未终结 journal | next | 主 `action`/`next_node` 指向创建 `openlogos change <slug>`；seed 仅显式可选，不建议 `add-baseline-docs` 或强制 baseline-seed |
| UT-S05-bootstrap-02 | bootstrap=skipped 历史兼容且 required 无提案时同样引导 change | next 逻辑 | 模块 bootstrap=skipped、`baseline_seed_state:required`、无 guard、无未终结 journal | next | 与 adopted 一致指向创建 change；不建议 add-baseline-docs 或强制 baseline-seed |
| UT-S05-bootstrap-03 | bootstrap=adopted 有活跃提案时走正常提案流程 | next 逻辑 | 模块 bootstrap=adopted，存在 guard 文件 | next | 正常读取提案状态，不输出建基线引导 |
| UT-S05-bootstrap-04 | bootstrap=skipped 历史兼容且有活跃提案时走正常提案流程 | next 逻辑 | 模块 bootstrap=skipped，存在 guard 文件 | next | 正常读取提案状态，不输出建基线引导 |
| UT-S05-B01 | baseline_seed_state:seeded 无提案时引导发起 change（不展示覆盖率人读行） | next 分支 | bootstrap=adopted、`baseline_seed_state:seeded`、无提案 | next | 主动作指向 `openlogos change <slug>`，说明 seed 只作扫描加速；不含覆盖率人读行；`baseline_coverage` JSON 字段照常输出 |
| UT-S05-B02 | 覆盖率 JSON baseline_coverage 字段 | next --format json | bootstrap=adopted、`seeded` | next --format json | 输出 `baseline_coverage`（`state`/`incomplete`/`denominator`/`tombstones`/`source`/`freshness`），`state` 映射 `baseline_seed_state` |
| UT-S05-B03 | 派生索引失效时覆盖率降级 | next 分支 | 索引 `source_hash` 与文档章节不符 | next / next --format json | `freshness=stale`（或 `unknown`），不输出精确百分比；主动作仍为 change |
| UT-S05-B04 | 零候选时覆盖率报 n/a | next 分支 | bootstrap=adopted、seeded 但 `active∪tombstone`=0 | next --format json | `baseline_coverage` 报 `n/a`（不报 100%/0%） |
| UT-S05-B05 | 安全 partial 时 next 仍指向 change 且标 incomplete | next 分支 | bootstrap=adopted、`baseline_seed_state:partial`、无提案、仅 open run/未提交 staging、无未终结 journal | next / next --format json | `baseline_coverage.state=partial`、`incomplete=true`；主动作指向 `openlogos change <slug>`；seed 恢复仅为非阻断诊断；不算精确百分比 |
| UT-S05-B06 | partial + 索引 stale 双降级 | next 分支 | 安全 `partial` 且 `source_hash` 与文档不符 | next --format json | `state=partial`、`incomplete=true` 且 `freshness=stale`；不输出精确百分比；主动作仍为 change |
| UT-S05-B07 | partial + 活跃提案不改写 proposal_step | next 分支 | `baseline_seed_state:partial`、存在 guard、无未终结 journal | next --format json | `proposal_step`/`next_node` 为提案真实前沿；安全 open run 的 recovery 诊断存在；不阻断 change |
| UT-S05-B08 | incomplete 字段稳定 shape | status/next --format json | required / seeded / partial 三态 | 各态 next/status --format json | `baseline_coverage.incomplete` 恒存在为布尔：partial→true、required/seeded→false（不省略） |
| UT-S05-B09 | 未终结 seed journal 无法恢复时隔离并继续 | next 读取门 | journal=`prepared|committing`、故障注入使前滚/回滚均失败 | next / next --format json | 非零返回 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留；在读取 resources/index/coverage 前停止；不输出 change 或 baseline-seed 主动作 |


## MODIFIED — 二、场景测试用例


### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S05-01 | 输出单一下一步建议 | Step 1→7 | 已初始化 | 执行 next | 返回最佳建议 |
| ST-S05-03 | 文档类提案验收通过后不进入部署 | Step 1→7 | 活跃提案声明无需部署且 verify PASS | 执行 next | 输出 archive 建议，不展示部署或 smoke 为下一步 |
| ST-S05-04 | 代码发布类提案验收通过后进入部署授权 | Step 1→7 | 活跃提案声明需要部署且 verify PASS | 执行 next | 输出部署授权建议 |
| ST-S05-bootstrap-01 | 存量项目接入 required 无提案时直接引导 change | Step 1→7（bootstrap 分支） | adopt 完成、`baseline_seed_state:required`、无活跃提案、无未终结 journal | 执行 next | 主动作指向创建 `openlogos change <slug>`；seed 仅显式可选；不建议 `add-baseline-docs` 或强制 baseline-seed |
| ST-S05-bootstrap-02 | 历史 skipped required 无提案时直接引导 change | Step 1→7（bootstrap 分支） | 旧项目 bootstrap=skipped、`required`、无活跃提案、无未终结 journal | 执行 next | 与 adopted 一致指向 change；不建议 add-baseline-docs 或强制 baseline-seed |
| ST-S05-bootstrap-03 | 存量项目接入有活跃提案时走正常提案流程 | Step 1→7（bootstrap 分支） | adopt 完成，存在活跃提案 | 执行 next | 正常读取提案状态，不输出建基线引导 |
| ST-S05-bootstrap-04 | 历史 skipped 有活跃提案时走正常提案流程 | Step 1→7（bootstrap 分支） | 旧项目 bootstrap=skipped，存在活跃提案 | 执行 next | 正常读取提案状态，不输出建基线引导 |
| ST-S05-B01 | adopted seeded 引导端到端（status/next 一致、不含覆盖率人读行） | Step 1→7（bootstrap 分支） | adopt→seeded、含逆向候选、无提案 | 执行 next 与 status | next 主动作指向 change；两命令 seed 状态/coverage JSON 一致且不含覆盖率人读行；不把 seed 当闭包已完成 |
| ST-S05-B02 | 安全 partial + 无活跃提案：主动作指向 change | Step 1→7（bootstrap 分支） | `baseline_seed_state:partial`、无 guard、仅 open run/未提交 staging、无未终结 journal | 执行 next 与 status | 两命令一致 `state=partial`/`incomplete=true`；next 主动作指向 `openlogos change <slug>`；seed 恢复仅为非阻断诊断；staging 不进入闭包 |
| ST-S05-B03 | 安全 partial + 活跃提案：proposal 前沿为主 | Step 1→7（bootstrap 分支） | `baseline_seed_state:partial`、存在 guard、无未终结 journal | 执行 next 与 status | 主 `action`/`next_node`/`proposal_step` 保持提案真实前沿；seed 恢复为旁路诊断；change 不阻断 |
| ST-S05-B04 | 未终结 journal 恢复失败即隔离 journal 后继续 | Step 2→2a（恢复门） | 故障注入在多文件 rename 中断，journal 未终结且 staging/backup 不足以安全恢复 | 执行 next 与 status，并对 resources/index 读取点设哨兵 | 两命令非零返回 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留；哨兵证明未读取半新 resources/index/coverage；不输出业务主动作；修复后重试可恢复 |
| ST-S05-05 | 部署完成标记由 CLI 写入后进入 smoke 建议 | S05 Step 3→7 / S21 | 活跃提案需要部署和 smoke，`deploy-done` 已成功 | 执行 `openlogos next --format json` | 返回 `proposal_step=ready-to-smoke`，不再提示手写 `DEPLOY_DONE` |
| ST-S05-06 | 部署完成且无需 smoke 后进入归档建议 | S05 Step 3→7 / S21 | 活跃提案需要部署但无需 smoke，`deploy-done` 已成功 | 执行 `openlogos next --format json` | 返回 `proposal_step=deploy-done`，建议 archive |

