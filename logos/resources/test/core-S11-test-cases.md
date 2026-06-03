# S11: 查看阶段进度与活跃变更 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S11-01 | 计算阶段完成度 | status phase logic | 有资源文件 | status | 返回正确完成度 |
| UT-S11-11 | 解析 proposal.md 的部署影响 | deployment decision parser | `proposal.md` 含部署影响 | proposal content | 返回 deployment_required、smoke_required、reason |
| UT-S11-12 | `[deploy]` section 与部署决策一致性校验 | tasks parser | proposal/tasks 已存在 | proposal + tasks | 返回一致或冲突状态 |
| UT-S11-13 | 提案级部署决策优先于模块级默认值 | status proposal logic | 模块 deployment_required=true，提案声明无需部署 | status | active_change 使用提案级决策 |
| UT-S11-14 | 统计 deployment_progress 仅使用 `[deploy]` section | tasks deploy parser | proposal/workspace 已存在 | tasks.md | 返回 checked、total、percent、status、label |
| UT-S11-15 | deployment_document 必须指向 tasks.md | status document resolver | 活跃提案存在 | proposal workspace | 返回 path/name/exists，且 name 固定为 tasks.md |
| UT-S11-16 | proposal 正文引用 ``是 / 否`` 不应影响模板完成判定 | status proposal logic | proposal 部署字段已明确、正文包含 ``是 / 否``、delta 任务已完成 | status | proposal_step=ready-to-merge |
| UT-S11-17 | proposal 部署字段值仍为 `是 / 否` 时保持 writing | status proposal logic | proposal 的部署影响字段仍保留模板占位符 | status | proposal_step=writing |
| UT-S11-bootstrap-01 | bootstrap=adopted 时 Phase 1~3 不报错 | status 逻辑 | 模块 bootstrap=adopted，Phase 1~3 目录为空 | status | Phase 1~3 输出「已跳过」，不输出错误或未完成 |
| UT-S11-bootstrap-02 | bootstrap=adopted JSON 输出含 bootstrap 字段 | status --format json | 模块 bootstrap=adopted | status --format json | JSON 中 modules[].bootstrap = adopted |
| UT-S11-bootstrap-03 | bootstrap=skipped 历史兼容时 JSON 输出仍按接入模式处理 | status --format json | 模块 bootstrap=skipped | status --format json | JSON 中 modules[].bootstrap 至少按接入模式读取，不回退为 initial |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S11-01 | 显示阶段面板 | Step 1→8 | 已初始化 | status | 输出阶段与建议 |
| ST-S11-08 | 无需部署提案 verify PASS 后显示可归档 | Step 1→8 | 活跃提案声明无需部署、无 `[deploy]` section、VERIFY_PASS 存在 | status | proposal_step 为 verify-passed，建议 archive |
| ST-S11-09 | 需要部署提案 verify PASS 后显示部署任务 | Step 1→8 | 活跃提案声明需要部署、存在 `[deploy]` section、VERIFY_PASS 存在 | status | proposal_step 为 ready-to-deploy，展示 deploy_tasks |
| ST-S11-10 | status JSON 暴露提案级部署决策 | Step 1→8 | 存在活跃提案 | status --format json | active_change 包含 deployment_required、smoke_required、deployment_reason、deployment_decision_source |
| ST-S11-12 | status JSON 暴露部署进度摘要和任务文档入口 | Step 1→8 | 存在活跃提案且 `[deploy]` section 已填写 | status --format json | active_change 包含 deployment_progress、deployment_document，且进度只统计 deploy section |
| ST-S11-13 | deploy 进度不受 `[code]` 任务影响 | Step 1→8 | `[code]` 与 `[deploy]` section 同时存在 | status --format json | deployment_progress 不统计 `[code]` 任务 |
| ST-S11-14 | proposal 正文引用 ``是 / 否`` 时仍可进入 ready-to-merge | Step 1→8 | 活跃提案部署字段已明确、正文包含 ``是 / 否``、`[delta]` 已全勾且存在 delta 文件 | status --format json | active_change.proposal_step=ready-to-merge，且无部署决策冲突 |
| ST-S11-bootstrap-01 | 存量项目接入状态面板正确显示已跳过 | Step 1→8（接入模式分支） | adopt 完成，无活跃提案 | 执行 status | Phase 1~3 显示「文档基线已跳过（存量项目接入）」 |
| ST-S11-bootstrap-02 | 历史 skipped 接入状态面板正确显示已跳过 | Step 1→8（接入模式分支） | bootstrap=skipped，且无活跃提案 | 执行 status | Phase 1~3 显示「文档基线已跳过（存量项目接入）」 |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S11-EX-6.1 | 历史提案缺少部署决策时回退兼容来源 | EX-6.1 | proposal 缺少结构化部署影响 | status --format json | 使用 `[deploy]` 或模块默认值，并标注 deployment_decision_source |
| ST-S11-EX-6.2 | 部署决策冲突时阻断流程 | EX-6.2 | proposal 与 tasks 冲突 | status / next | 输出冲突警告并阻止进入部署流程 |
| ST-S11-EX-6.3 | deploy section 缺失时进度应降级 | EX-6.3 | proposal 需要部署但 tasks 缺少 `[deploy]` | status --format json | deployment_progress.status=unavailable 且 conflict=true |
