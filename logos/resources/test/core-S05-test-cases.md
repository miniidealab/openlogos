# S05: 查看下一步建议 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S05-01 | 空项目应建议 Phase 1 | status/next 逻辑 | 无活动提案 | next | 输出 Phase 1 建议 |
| UT-S05-15 | 无需部署提案 VERIFY_PASS 后建议 archive | 提案级部署决策 | `proposal.md` 声明无需部署、无 `[deploy]` section、存在 `VERIFY_PASS` | next | `proposal_step=verify-passed`，建议 `openlogos archive <slug>` |
| UT-S05-16 | 需要部署提案 VERIFY_PASS 后建议部署授权 | 提案级部署决策 | `proposal.md` 声明需要部署、存在 `[deploy]` section、存在 `VERIFY_PASS` | next | `proposal_step=ready-to-deploy`，建议人类明确授权部署 |
| UT-S05-17 | 部署完成且无需 smoke 后建议 archive | 提案级 smoke 决策 | `DEPLOY_DONE` 存在、`smoke_required=false` | next | 建议 `openlogos archive <slug>` |
| UT-S05-18 | deploy-done 后需要 smoke 时建议运行 smoke | S21/S05 | `VERIFY_PASS`、`DEPLOY_DONE`、`[deploy]` 全勾、`smoke_required=true` | next | `proposal_step=ready-to-smoke`，建议明确授权执行 `openlogos smoke` |
| UT-S05-19 | deploy-done 后无需 smoke 时建议 archive | S21/S05 | `VERIFY_PASS`、`DEPLOY_DONE`、`[deploy]` 全勾、`smoke_required=false` | next | `proposal_step=deploy-done`，建议明确授权执行 `openlogos archive <slug>` |
| UT-S05-bootstrap-01 | bootstrap=adopted 且 baseline_seed_state:required 无提案时引导逆向建基线（brownfield-adopter，取代旧 add-baseline-docs） | next 逻辑 | 模块 bootstrap=adopted、`baseline_seed_state:required`、无 guard 文件 | next | 输出「逆向建立现状基线」引导（种子基线 / reverse-engineered / verified:false）；**不再**建议 `openlogos change add-baseline-docs` |
| UT-S05-bootstrap-02 | bootstrap=skipped 历史兼容且 required 无提案时同样引导逆向建基线 | next 逻辑 | 模块 bootstrap=skipped、`baseline_seed_state:required`、无 guard 文件 | next | 输出与 adopted 一致的「逆向建立现状基线」引导；不再建议 add-baseline-docs |
| UT-S05-bootstrap-03 | bootstrap=adopted 有活跃提案时走正常提案流程 | next 逻辑 | 模块 bootstrap=adopted，存在 guard 文件 | next | 正常读取提案状态，不输出建基线引导 |
| UT-S05-bootstrap-04 | bootstrap=skipped 历史兼容且有活跃提案时走正常提案流程 | next 逻辑 | 模块 bootstrap=skipped，存在 guard 文件 | next | 正常读取提案状态，不输出建基线引导 |
| UT-S05-B01 | baseline_seed_state:seeded 无提案时展示覆盖率 | next 分支 | bootstrap=adopted、`baseline_seed_state:seeded`、无提案 | next | 展示 `human-verified <分子> / 候选 <active∪tombstone>`，引导正常发起 `openlogos change` |
| UT-S05-B02 | 覆盖率 JSON baseline_coverage 字段 | next --format json | bootstrap=adopted、`seeded` | next --format json | 输出 `baseline_coverage`（`state`/`human_verified`/`denominator`/`tombstones`/`human_verified_delta`/`freshness`），`state` 映射 `baseline_seed_state` |
| UT-S05-B03 | 派生索引失效时覆盖率降级 | next 分支 | 索引 `source_hash` 与文档章节不符 | next / next --format json | `freshness=stale`（或 `unknown`），不输出精确百分比 |
| UT-S05-B04 | 零候选时覆盖率报 n/a | next 分支 | bootstrap=adopted、seeded 但 `active∪tombstone`=0 | next --format json | `baseline_coverage` 报 `n/a`（不报 100%/0%） |
| UT-S05-B05 | partial 时 next 指向恢复入口且标 incomplete | next 分支 | bootstrap=adopted、`baseline_seed_state:partial`、无提案 | next / next --format json | `baseline_coverage.state=partial`、`incomplete=true`；下一步指向 `openlogos baseline-seed`（commit/begin）；不算精确百分比；说明可先发 change（不强制） |
| UT-S05-B06 | partial + 索引 stale 双降级 | next 分支 | `partial` 且 `source_hash` 与文档不符 | next --format json | `state=partial`、`incomplete=true` 且 `freshness=stale`；不输出精确百分比 |
| UT-S05-B07 | partial + 活跃提案不改写 proposal_step | next 分支 | `baseline_seed_state:partial`、存在 guard（提案前沿） | next --format json | `proposal_step`/`next_node` 为提案真实前沿（不变）；`baseline_coverage.recovery` advisory 存在；不阻断 change |
| UT-S05-B08 | incomplete 字段稳定 shape | status/next --format json | required / seeded / partial 三态 | 各态 next/status --format json | `baseline_coverage.incomplete` 恒存在为布尔：partial→true、required/seeded→false（不省略） |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S05-01 | 输出单一下一步建议 | Step 1→6 | 已初始化 | 执行 next | 返回最佳建议 |
| ST-S05-03 | 文档类提案验收通过后不进入部署 | Step 1→6 | 活跃提案声明无需部署且 verify PASS | 执行 next | 输出 archive 建议，不展示部署或 smoke 为下一步 |
| ST-S05-04 | 代码发布类提案验收通过后进入部署授权 | Step 1→6 | 活跃提案声明需要部署且 verify PASS | 执行 next | 输出部署授权建议 |
| ST-S05-bootstrap-01 | 存量项目接入 required 无提案时引导逆向建基线（取代旧 add-baseline-docs） | Step 1→7（bootstrap 分支） | adopt 完成、`baseline_seed_state:required`、无活跃提案 | 执行 next | 输出「逆向建立现状基线」引导；不再建议 `openlogos change add-baseline-docs` |
| ST-S05-bootstrap-02 | 历史 skipped required 无提案时引导逆向建基线 | Step 1→7（bootstrap 分支） | 旧项目 bootstrap=skipped、`required`、无活跃提案 | 执行 next | 输出与 adopted 一致的建基线引导；不再建议 add-baseline-docs |
| ST-S05-bootstrap-03 | 存量项目接入有活跃提案时走正常提案流程 | Step 1→7（bootstrap 分支） | adopt 完成，存在活跃提案 | 执行 next | 正常读取提案状态，不输出建基线引导 |
| ST-S05-bootstrap-04 | 历史 skipped 有活跃提案时走正常提案流程 | Step 1→7（bootstrap 分支） | 旧项目 bootstrap=skipped，存在活跃提案 | 执行 next | 正常读取提案状态，不输出建基线引导 |
| ST-S05-B01 | adopted 覆盖率引导端到端（status/next 一致） | Step 1→7（bootstrap 分支） | adopt→seeded、含逆向候选、无提案 | 执行 next 与 status | 两命令 `baseline_coverage` 字段一致；删除候选不使百分比上升（tombstone 留分母）；不把未建立基线显示为已建立 |
| ST-S05-B02 | partial + 无活跃提案：主动作指向恢复 | Step 1→7（bootstrap 分支） | `baseline_seed_state:partial`、**无** guard | 执行 next 与 status | 两命令一致 `state=partial`/`incomplete=true`；主 `action`/`next_node` 指向 `openlogos baseline-seed` 恢复；不算精确百分比；重试成功回 seeded |
| ST-S05-B03 | partial + 活跃提案：proposal 前沿为主、恢复作 advisory | Step 1→7（bootstrap 分支） | `baseline_seed_state:partial`、**存在** guard（活跃提案某前沿） | 执行 next 与 status | 主 `action`/`next_node`/`proposal_step` **保持提案真实前沿**（不被恢复劫持、不改写）；partial 恢复以 `baseline_coverage.recovery` advisory 呈现；change 流程不阻断 |
| ST-S05-05 | 部署完成标记由 CLI 写入后进入 smoke 建议 | S05 Step 3→7 / S21 | 活跃提案需要部署和 smoke，`deploy-done` 已成功 | 执行 `openlogos next --format json` | 返回 `proposal_step=ready-to-smoke`，不再提示手写 `DEPLOY_DONE` |
| ST-S05-06 | 部署完成且无需 smoke 后进入归档建议 | S05 Step 3→7 / S21 | 活跃提案需要部署但无需 smoke，`deploy-done` 已成功 | 执行 `openlogos next --format json` | 返回 `proposal_step=deploy-done`，建议 archive |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S05-EX-4.1 | 部署决策冲突时阻止自动部署建议 | EX-4.1 | `proposal.md` 与 `[deploy]` section 冲突 | 执行 next | 输出冲突警告，并提示修正 proposal / tasks |

## 四、golden characterization 归属（next 既有 JSON 行为锚点）

`cli/test/golden-baseline.test.ts` 对 S05 `next --format json` 的既有输出做 characterization 快照，在 fixture 矩阵（initial-adopted / initial-fresh / launched 各 ProposalStep 态 / 无部署 / 纯代码）上录制真实输出作为基线。

归属与本次变更的关系：
- **本变更有意更新 adopted / skipped「无活跃提案」路径的 next 输出**（由旧「补文档引导 + `openlogos change add-baseline-docs`」改为「逆向建立现状基线」引导 / seeded 覆盖率），因此 **adopted-no-proposal fixture 的 golden 快照需随本变更重新 baseline**（这是有意的行为变更，不是漂移）；其余 fixture（fresh / launched 各态 / initial 派生等价）保持 1:1 不变、golden 零漂移。
- 复核 golden diff 时，adopted-no-proposal 分支的 `action`/`detail` 变化为**预期**；任何其它 fixture 出现 diff 均视为回归。
- golden 测试不替代 S05 既有 UT/ST 用例，二者并存。

## 五、next initial 路径 flow 派生等价单元测试用例

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S05-20 | fresh initial 模块下 next 建议来自 flow 派生 current_phase | next initial 派生 | 空 initial 模块、无活跃提案 | next --format json | `action` 对应 phase.1 建议，与旧 PHASE_KEYS 推断一致 |
| UT-S05-21 | adopted 模块下 next 跳过 prd/product-design/architecture 后建议正确阶段 | next initial 派生 | bootstrap=adopted、无活跃提案的 initial 派生场景 | next --format json | current_phase 指向首个未跳过未完成 phase，`action`/`detail` 与旧逻辑一致 |
| UT-S05-22 | skip_phases 影响 current_phase 后 next 建议一致 | next initial 派生 | skip_phases 含 api/database/scenario | next --format json | `action`/`detail` 与旧逻辑逐字节一致 |
| UT-S05-23 | 无 skip_phases 老项目（fallback-skip）next 建议一致 | next initial 派生 | 无 skip_phases、靠后 phase 已 done | next --format json | current_phase 不漂移，`action`/`detail` 与旧逻辑一致 |
| UT-S05-24 | no-deploy 跳过 deploy/smoke 后 next 建议一致 | next initial 派生（后段阶段） | `deployment_required=false` 或 `skip_phases:[deployment]`，前序阶段已 done | next --format json | deploy/smoke 阶段跳过后 current_phase 指向应推进项（或全完成），`action`/`detail` 与旧逻辑一致 |
| UT-S05-25 | no-smoke 保留 deploy 跳过 smoke 后 next 建议一致 | next initial 派生（后段阶段） | `smoke_required=false`、deploy 阶段保留，前序阶段已 done | next --format json | 仅 smoke 跳过，next 建议指向 deploy（或其后），`action`/`detail` 与旧逻辑一致 |

## 六、next initial 路径 flow 派生等价场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S05-07 | fresh 项目 next 下一步建议与旧逻辑等价 | Step 1→7（initial 派生分支） | 已初始化、空 initial 模块、无活跃提案 | 执行 `openlogos next --format json` | `action`/`detail` 与旧 PHASE_KEYS 派生逐字节一致 |
| ST-S05-08 | adopted 项目 next 下一步建议与旧逻辑等价 | Step 1→7（initial 派生分支） | bootstrap=adopted 的 initial 派生场景、无活跃提案 | 执行 `openlogos next --format json` | 跳过 prd/product-design/architecture 后建议一致 |
| ST-S05-09 | skip_phases 项目 next 下一步建议与旧逻辑等价 | Step 1→7（initial 派生分支） | skip_phases 含 api/database/scenario | 执行 `openlogos next --format json` | `action`/`detail` 与旧逻辑一致 |
| ST-S05-10 | fallback-skip 老项目 next 下一步建议与旧逻辑等价 | Step 1→7（initial 派生分支） | 无 skip_phases、靠后 phase 已 done | 执行 `openlogos next --format json` | current_phase 不漂移，建议与旧逻辑一致 |
| ST-S05-11 | no-deploy 项目 next 后段建议与旧逻辑等价 | Step 1→7（后段阶段） | `deployment_required=false`，前序阶段已 done | 执行 `openlogos next --format json` | deploy/smoke 跳过后 `action`/`detail` 与旧逻辑一致 |
| ST-S05-12 | no-smoke 项目 next 后段建议与旧逻辑等价 | Step 1→7（后段阶段） | `smoke_required=false`、deploy 保留，前序阶段已 done | 执行 `openlogos next --format json` | 仅 smoke 跳过后 `action`/`detail` 与旧逻辑一致 |

## 七、next 契约自描述字段测试用例（contract-self-description）

> 覆盖 D1（contract 版本握手）与 D6（next_node.dispatch / requires_reviewed）在 `next --format json` 上的生产者契约。本节用例编号顺延既有最大编号（UT-S05-25 / ST-S05-12）。按 D8 主动破例声明：`next_node` R8「8 字段逐字节不变」锚被新增 `dispatch` / `requires_reviewed` 子字段打破，next golden（用例 2/6）随本变更重拍属预期，不是漂移。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 7.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S05-26 | next JSON data 顶层 contract 在场且版本为 1.0.0 | D1 contract 握手 | 任意 fixture（initial-fresh / launched 有无活跃提案均取样） | `next --format json` | `data.contract` 恒在场且等于 `{"version":"1.0.0"}`（语义化契约版本，独立于 envelope 的 CLI 版本串） |
| UT-S05-27 | next_node.dispatch 恒为完整对象、无二义分支 | D6 派发契约 | launched 活跃提案，遍历多个前沿 fixture（如 write-delta / apply-merge / code 节点各取样） | `next --format json` | 每个 `next_node` 均携带完整 `dispatch: {idempotent, timeout_seconds, artifacts_hint}`：`idempotent` 为布尔、`timeout_seconds` 为整数、`artifacts_hint` 为字符串数组，三字段全在场，不存在部分缺失的输出 |
| UT-S05-28 | requires_reviewed 从 flow 节点声明透传 | D6 派发契约 | launched 活跃提案处于 **merge-generated** 前沿（`MERGE_PROMPT_GENERATED`/`MERGE_PROMPT.md` 已预置，前沿映射 `merge-generated → apply-merge`） | `next --format json` | `next_node.id=="apply-merge"` 且 `next_node.requires_reviewed == ["proposal","delta"]`（来自内置 flow 节点声明的透传，非 CLI 内推导）；对照组：`ready-to-merge` 前沿映射到 **generate-merge-prompt**（非 apply-merge），该节点未声明 → 输出中**不含** `requires_reviewed`（write-proposal 前沿同） |
| UT-S05-29 | no-delta 提案不得输出 delta 评审要求（幻影评审反向锚） | D6/D9；no-delta 幻影评审根治 | launched **纯代码 no-delta** 提案：tasks.md 无 `[delta]` 段、仅空 `## [code]` 标题（`facts.has_delta_tasks==false`），spec/merge 子流程被 `when: delta_required` 跳过，前沿 `spec-complete-required` | `next --format json` | 输出的任何 `next_node.requires_reviewed`（如存在）**不含 `"delta"`**；建议仍沿 no-delta `openlogos merge` / `spec-complete-required` 路径推进（不派 write-delta、不要求幻影 delta 评审）；后续 no-delta `SPEC_MERGED` 写入后至 slice-planner 路径照常可达 |

### 7.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S05-13 | next 契约自描述字段端到端一致 | Step 1→7 | 同一 launched 提案依次构造 writing → ready-to-merge → **merge-generated** → coding 四个前沿 | 每个前沿执行 `openlogos next --format json` | 四次输出均满足：`data.contract.version=="1.0.0"`；`next_node.dispatch` 恒为完整对象且取值与 flow 节点声明一致（apply-merge `idempotent:false`、内容产出类 `idempotent:true`）；`requires_reviewed` **仅在 merge-generated 前沿（next_node=apply-merge）出现**且 `==["proposal","delta"]`——ready-to-merge 前沿（next_node=generate-merge-prompt）与其余前沿均不含该字段（一正一反成对断言，与 UT-S05-29 的 no-delta 反向锚构成完整契约） |

### 7.3 覆盖度校验补充

- [ ] next data 顶层 contract 在场且 =1.0.0：UT-S05-26
- [ ] next_node.dispatch 恒为完整对象：UT-S05-27、ST-S05-13
- [ ] requires_reviewed 声明透传（merge-generated 前沿正向 + ready-to-merge/未声明节点反向）：UT-S05-28、ST-S05-13
- [ ] no-delta 提案不输出 delta 评审要求（幻影评审反向锚）：UT-S05-29
