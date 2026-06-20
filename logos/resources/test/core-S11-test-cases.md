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
| UT-S11-18 | proposal 部署字段模板值不解析为 true | deployment decision parser | `proposal.md` 的部署字段仍为 `是 / 否` | proposal content | deployment_required=null，smoke_required=null，不产生部署冲突 |
| UT-S11-19 | `DEPLOY_DONE` 与 `[deploy]` 全勾共同决定离开 ready-to-deploy | S21/status | `DEPLOY_DONE` 存在但 `[deploy]` 未全勾，或 `[deploy]` 全勾但缺少 `DEPLOY_DONE` | status step detection | 仍返回 `ready-to-deploy` |
| UT-S11-20 | `DEPLOY_DONE` 与 `[deploy]` 全勾且需要 smoke 时进入 ready-to-smoke | S21/status | `VERIFY_PASS`、`DEPLOY_DONE`、`[deploy]` 全勾、`smoke_required=true` | status step detection | 返回 `ready-to-smoke` |
| UT-S11-21 | `DEPLOY_DONE` 与 `[deploy]` 全勾且无需 smoke 时进入 deploy-done | S21/status | `VERIFY_PASS`、`DEPLOY_DONE`、`[deploy]` 全勾、`smoke_required=false` | status step detection | 返回 `deploy-done` |
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
| ST-S11-15 | 空提案模板不显示部署决策冲突 | Step 1→8 | `openlogos change` 刚创建空提案，proposal/tasks 均未填写 | status --format json | proposal_step=writing，deployment_decision_conflict=false，不提示缺少 `[deploy]` section |
| ST-S11-16 | status 展示 deploy-done 受控落标后的状态 | S11 Step 4→8 / S21 | 活跃提案已执行 `openlogos deploy-done` | `openlogos status --format json` | `deployment_progress.status=done`，`proposal_step=ready-to-smoke` 或 `deploy-done` |
| ST-S11-17 | deploy 进度完成但无 DEPLOY_DONE 不视为部署完成 | S11 Step 4→8 / S21 | `[deploy]` section 已全勾但缺少 `DEPLOY_DONE` | `openlogos status --format json` | `proposal_step=ready-to-deploy`，不进入 smoke 或 archive |
| ST-S11-bootstrap-01 | 存量项目接入状态面板正确显示已跳过 | Step 1→8（接入模式分支） | adopt 完成，无活跃提案 | 执行 status | Phase 1~3 显示「文档基线已跳过（存量项目接入）」 |
| ST-S11-bootstrap-02 | 历史 skipped 接入状态面板正确显示已跳过 | Step 1→8（接入模式分支） | bootstrap=skipped，且无活跃提案 | 执行 status | Phase 1~3 显示「文档基线已跳过（存量项目接入）」 |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S11-EX-6.1 | 历史提案缺少部署决策时回退兼容来源 | EX-6.1 | proposal 缺少结构化部署影响 | status --format json | 使用 `[deploy]` 或模块默认值，并标注 deployment_decision_source |
| ST-S11-EX-6.2 | 部署决策冲突时阻断流程 | EX-6.2 | proposal 与 tasks 冲突 | status / next | 输出冲突警告并阻止进入部署流程 |
| ST-S11-EX-6.3 | deploy section 缺失时进度应降级 | EX-6.3 | proposal 需要部署但 tasks 缺少 `[deploy]` | status --format json | deployment_progress.status=unavailable 且 conflict=true |

## 四、golden characterization 归属（status 既有 JSON 行为锚点）

`cli/test/golden-baseline.test.ts` 对 S11 `status --format json` 的既有输出做 characterization 快照（不新增 S11 用例，也不改既有用例语义），在 fixture 矩阵（initial-adopted / initial-fresh / launched 各 ProposalStep 态 / 无部署 / 纯代码）上录制当前真实输出作为基线。

归属说明：
- 该 golden 测试**表征**（characterize）S11 现状行为，而非定义新需求；本切片（flow-engine-foundation）应**全部通过**。
- 其作用是在后续 flow 派生切换切片（切片 B：用 `lib/flow.ts` 派生替换现有 `PHASE_KEYS` / `ProposalStep` 逻辑）时，作为"1:1 不改行为"的等价锚点——若派生切换导致 `status --format json` 输出漂移，golden 快照将立即失败。
- golden 测试不替代 S11 既有 UT/ST 用例，二者并存：S11 用例验证规格定义的具体字段与状态机；golden 快照锁定整段 JSON 的字节级等价。

## 五、flow-derive 引擎单元测试用例（initial 派生）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S11-22 | `when` 求值：bootstrap=adopted 跳过 prd/product-design/architecture | flow-derive when | builtin initial flow + 模块 bootstrap=adopted | deriveModulePhaseProgress | phase.1/phase.2/phase.3-0 标 skipped 且 skip_reason=bootstrap-adopted |
| UT-S11-23 | `when` 求值：`api`/`db`/`scenario` skip_phases 映射到对应节点跳过 | flow-derive when | skip_phases 含 api/database/scenario | derive | phase.3-2-api / phase.3-2-db / phase.3-4b 标 skipped |
| UT-S11-24 | `when` 求值：`deployment_required` 来源（skip_phases:[deployment] 或 deployment_required=false） | flow-derive when | 任一关闭部署的声明 | derive | phase.3-7-deploy 与 phase.3-8-smoke 均标 skipped |
| UT-S11-25 | `when` 求值：smoke_required 未声明视为 true（仅 deploy 节点活跃，smoke 不被跳） | flow-derive when | module.smoke_required 未声明、deployment_required=true | derive | phase.3-8-smoke 不被 skip |
| UT-S11-26 | `when` 求值：smoke_required=false 仅关闭 smoke、保留 deploy | flow-derive when | module.smoke_required=false、deployment_required=true | derive | phase.3-7-deploy 活跃、phase.3-8-smoke 标 skipped |
| UT-S11-27 | `done_when: dir_nonempty` 判定（目录非空即 done） | flow-derive done_when | 目标目录含文件 | derive | 对应 phase done=true |
| UT-S11-28 | `done_when: file:<path>` 判定（verify/deploy/smoke 报告文件存在） | flow-derive done_when | acceptance-report.md 存在 | derive | phase.3-6 done=true |
| UT-S11-29 | fan-out 覆盖数据：场景全覆盖产 covered/total/missing 且 done | flow-derive fan-out | 每个场景均有对应文件 | derive | scenario_coverage.missing=[]、done=true |
| UT-S11-30 | fan-out 覆盖数据：partial 覆盖时 missing 非空且 done=false | flow-derive fan-out | 仅部分场景有文件 | derive | scenario_coverage.missing 含未覆盖 id、done=false |
| UT-S11-31 | node-id → phase-key 映射 13 个 1:1 完整且无遗漏/冲突 | flow-derive 映射表 | builtin initial flow | 遍历映射表 | 13 个 node 精确映射到 PHASE_KEYS，覆盖且唯一 |
| UT-S11-32 | 顶层 phases[] 场景阶段 = any-present | flow-derive 顶层 | 场景目录有任意文件（未全覆盖） | 顶层 phases[] 派生 | 该场景 phase done=true（any-present） |
| UT-S11-33 | per-module 场景阶段 = all-present（与顶层 any-present 区分） | flow-derive per-module | 场景目录有文件但未全覆盖 | derive per-module | 该 phase done=false（all-present） |
| UT-S11-34 | 非场景阶段顶层 = 扫整个目录 any-present | flow-derive 顶层 | 目录含任意（含他模块前缀）文件 | 顶层 phases[] | done=true |
| UT-S11-35 | 非场景阶段 per-module 多模块按 `{module}-` 前缀过滤 | flow-derive per-module | 多模块项目，目录仅含他模块前缀文件 | derive per-module | 当前模块该 phase done=false |
| UT-S11-36 | 标准零填充 ID 相邻不串台（`S01` vs `S11`） | flow-derive fan-out | 仅存在 `core-S11-*.md`、目标场景为标准 `S01` | derive | `S01` 不因 `core-S11-*.md` 误判 covered（标准 SXX 方案下无串台） |
| UT-S11-37 | 多模块全局 skip 交集：仅全部 initial 模块都 skip 才置顶层 skipped | flow-derive 顶层交集 | 两模块仅其一 skip api | 顶层 phases[] | phase.3-2-api 不被标 skipped |
| UT-S11-38 | fallback-skip：无 skip_phases 老项目空 phase 在已完成 phase 前自动 skipped | flow-derive fallback | 无 skip_phases、靠后 phase 已 done | derive | 其前的空 phase 标 skipped（NON_FALLBACK_SKIP_PHASES 除外），current_phase 不漂移 |
| UT-S11-39 | 非标准/合成 ID 保留 legacy `includes()` 子串命中 | flow-derive fan-out | **合成 fixture**：目标场景 `S1`、仅存在 `core-S11-*.md`（非标准非零填充 ID） | derive | `S1` 因子串命中 `core-S11-*.md` 判 covered——**如实保留旧子串行为**（glob 精确匹配是未来有意修正，本切片不改）|

## 六、测试期「新派生 == 旧逻辑」并跑等价场景测试用例

> 以下 ST **仅存在于测试期**：对同一 fixture 同时跑新 `flow-derive` 与旧
> `deriveModulePhaseProgress` / 顶层 `phases[]`，断言两者结果相等。**不进入生产 CLI 路径。**
> 断言矩阵覆盖兼容性全集。

| ID | 描述 | 覆盖 fixture | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S11-18 | normal 模块新旧派生等价 | initial-fresh / 半成品 | 普通 initial 模块、无 skip | 并跑新旧派生 | phase_progress 与顶层 phases[] 逐字段相等 |
| ST-S11-19 | adopted 模块新旧派生等价 | initial-adopted | bootstrap=adopted | 并跑 | phase.1/2/3-0 skip_reason 一致，整体相等 |
| ST-S11-20 | skip_phases 含 api/db/scenario 时等价 | skipped | skip_phases=[api,database,scenario] | 并跑 | 对应 phase skipped 一致 |
| ST-S11-21 | 无 skip_phases 老项目（fallback-skip）等价 | legacy | 无 skip_phases、靠后 phase 已 done | 并跑 | 兜底 skipped 与 current_phase 一致 |
| ST-S11-22 | `skip_phases:[deployment]` 等价 | skip-deployment | skip_phases 含 deployment | 并跑 | phase.3-7-deploy / phase.3-8-smoke skipped 一致 |
| ST-S11-23 | `deployment_required=false` 等价 | no-deploy | module.deployment_required=false | 并跑 | deploy/smoke phase skipped 一致 |
| ST-S11-24 | `smoke_required=false` 等价（保留 deploy） | no-smoke | smoke_required=false、需部署 | 并跑 | 仅 smoke phase skipped 一致 |
| ST-S11-25 | `smoke_required` 未声明（默认 true）等价 | default-smoke | 未声明 smoke_required、需部署 | 并跑 | smoke phase 不 skip，一致 |
| ST-S11-26 | 单模块全局 skip 等价 | single-module-skip | 单 initial 模块带 skip | 并跑 | 顶层与 per-module 一致 |
| ST-S11-27 | 多模块全局 skip 交集等价 | multi-module-skip | 多 initial 模块、部分 skip | 并跑 | 顶层交集 skipped 一致 |
| ST-S11-28 | 非场景阶段多模块前缀过滤等价 | multi-module-prefix | 多模块、目录含混合前缀文件 | 并跑 | per-module 前缀过滤 done 一致 |
| ST-S11-29 | partial 场景覆盖等价 | partial-scenario | 部分场景缺文件 | 并跑 | scenario_coverage 与 done 一致 |
| ST-S11-30 | 场景文件名碰撞 / 相邻 ID 等价（legacy includes） | scenario-id-collision | 存在相邻 ID 场景文件 | 并跑 | includes 子串命中结果一致（保留旧行为） |
