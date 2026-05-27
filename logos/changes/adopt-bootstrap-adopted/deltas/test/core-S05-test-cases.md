## MODIFIED — # S05: 查看下一步建议 — 测试用例
# S05: 查看下一步建议 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S05-01 | 空项目应建议 Phase 1 | status/next 逻辑 | 无活动提案 | next | 输出 Phase 1 建议 |
| UT-S05-15 | 无需部署提案 VERIFY_PASS 后建议 archive | 提案级部署决策 | `proposal.md` 声明无需部署、无 `[deploy]` section、存在 `VERIFY_PASS` | next | `proposal_step=verify-passed`，建议 `openlogos archive <slug>` |
| UT-S05-16 | 需要部署提案 VERIFY_PASS 后建议部署授权 | 提案级部署决策 | `proposal.md` 声明需要部署、存在 `[deploy]` section、存在 `VERIFY_PASS` | next | `proposal_step=ready-to-deploy`，建议人类明确授权部署 |
| UT-S05-17 | 部署完成且无需 smoke 后建议 archive | 提案级 smoke 决策 | `DEPLOY_DONE` 存在、`smoke_required=false` | next | 建议 `openlogos archive <slug>` |
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

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S05-EX-4.1 | 部署决策冲突时阻止自动部署建议 | EX-4.1 | `proposal.md` 与 `[deploy]` section 冲突 | 执行 next | 输出冲突警告，并提示修正 proposal / tasks |
