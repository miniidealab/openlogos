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
| UT-S05-bootstrap-01 | bootstrap=adopted 且无活跃提案时输出补文档引导 | next 逻辑 | 模块 bootstrap=adopted，无 guard 文件 | next | 输出补文档引导，包含 change add-baseline-docs 建议 |
| UT-S05-bootstrap-02 | bootstrap=skipped 历史兼容时无活跃提案也输出补文档引导 | next 逻辑 | 模块 bootstrap=skipped，无 guard 文件 | next | 输出补文档引导，包含 change add-baseline-docs 建议 |
| UT-S05-bootstrap-03 | bootstrap=adopted 有活跃提案时走正常提案流程 | next 逻辑 | 模块 bootstrap=adopted，存在 guard 文件 | next | 正常读取提案状态，不输出补文档引导 |
| UT-S05-bootstrap-04 | bootstrap=skipped 历史兼容且有活跃提案时走正常提案流程 | next 逻辑 | 模块 bootstrap=skipped，存在 guard 文件 | next | 正常读取提案状态，不输出补文档引导 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S05-01 | 输出单一下一步建议 | Step 1→6 | 已初始化 | 执行 next | 返回最佳建议 |
| ST-S05-03 | 文档类提案验收通过后不进入部署 | Step 1→6 | 活跃提案声明无需部署且 verify PASS | 执行 next | 输出 archive 建议，不展示部署或 smoke 为下一步 |
| ST-S05-04 | 代码发布类提案验收通过后进入部署授权 | Step 1→6 | 活跃提案声明需要部署且 verify PASS | 执行 next | 输出部署授权建议 |
| ST-S05-bootstrap-01 | 存量项目接入无提案时输出补文档引导 | Step 1→7（bootstrap 分支） | adopt 完成，无活跃提案 | 执行 next | 输出引导文案，建议 openlogos change add-baseline-docs |
| ST-S05-bootstrap-02 | 历史 skipped 无提案时输出补文档引导 | Step 1→7（bootstrap 分支） | 旧项目 bootstrap=skipped，无活跃提案 | 执行 next | 输出引导文案，建议 openlogos change add-baseline-docs |
| ST-S05-bootstrap-03 | 存量项目接入有活跃提案时走正常提案流程 | Step 1→7（bootstrap 分支） | adopt 完成，存在活跃提案 | 执行 next | 正常读取提案状态，不输出补文档引导 |
| ST-S05-bootstrap-04 | 历史 skipped 有活跃提案时走正常提案流程 | Step 1→7（bootstrap 分支） | 旧项目 bootstrap=skipped，存在活跃提案 | 执行 next | 正常读取提案状态，不输出补文档引导 |
| ST-S05-05 | 部署完成标记由 CLI 写入后进入 smoke 建议 | S05 Step 3→7 / S21 | 活跃提案需要部署和 smoke，`deploy-done` 已成功 | 执行 `openlogos next --format json` | 返回 `proposal_step=ready-to-smoke`，不再提示手写 `DEPLOY_DONE` |
| ST-S05-06 | 部署完成且无需 smoke 后进入归档建议 | S05 Step 3→7 / S21 | 活跃提案需要部署但无需 smoke，`deploy-done` 已成功 | 执行 `openlogos next --format json` | 返回 `proposal_step=deploy-done`，建议 archive |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S05-EX-4.1 | 部署决策冲突时阻止自动部署建议 | EX-4.1 | `proposal.md` 与 `[deploy]` section 冲突 | 执行 next | 输出冲突警告，并提示修正 proposal / tasks |

## 四、golden characterization 归属（next 既有 JSON 行为锚点）

`cli/test/golden-baseline.test.ts` 对 S05 `next --format json` 的既有输出做 characterization 快照（不新增 S05 用例，也不改既有用例语义），在 fixture 矩阵（initial-adopted / initial-fresh / launched 各 ProposalStep 态 / 无部署 / 纯代码）上录制当前真实输出作为基线。

归属说明：
- 该 golden 测试**表征**（characterize）S05 现状行为，而非定义新需求；本切片（flow-engine-foundation）应**全部通过**。
- 其作用是在后续 flow 派生切换切片（切片 B：用 `lib/flow.ts` 派生替换现有 `next` 判定逻辑）时，作为"1:1 不改行为"的等价锚点——若派生切换导致 `next --format json` 的下一步建议或 `proposal_step` 漂移，golden 快照将立即失败。
- golden 测试不替代 S05 既有 UT/ST 用例，二者并存：S05 用例验证规格定义的具体建议文案与提案级部署决策；golden 快照锁定整段 JSON 的字节级等价。

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
