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

## 七、SessionStart 消费 status 结构化状态测试

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S11-40 | SessionStart 优先读取顶层 active_change / proposal_step | status JSON consumer | `status --format json` 顶层包含 `active_change=feat`、`proposal_step=delta-writing` | 执行 SessionStart 解析逻辑 | 解析结果使用顶层 slug 和 step，生成 delta-writing 范围文案 |
| UT-S11-41 | SessionStart 顶层缺失时回退 modules[].active_change | status JSON consumer | 顶层 `active_change=null`，`modules[0].active_change.slug=feat`、`proposal_step=delta-writing` | 执行 SessionStart 解析逻辑 | 解析结果使用模块级 active_change，并生成 delta-writing 范围文案 |
| UT-S11-42 | SessionStart 不把 suggestion 当作唯一事实源 | status JSON consumer | `status --format json` 同时含 `proposal_step=ready-to-merge` 和中文 suggestion | 执行 SessionStart 解析逻辑 | 按 `proposal_step` 输出 merge 确认点文案，不通过自然语言 suggestion 推断文件范围 |

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S11-31 | status 的 delta-writing 状态驱动 SessionStart 工作重心文案 | S11 Step 3→8 | launched 项目有 active guard，`openlogos status --format json` 输出 `proposal_step=delta-writing` | SessionStart 调用 status 并生成上下文 | 上下文与 status/next 一致：说明本阶段典型工作是产出 `deltas/**` 并勾选 `tasks.md` 的 `[delta]`，规格变更经 delta + `openlogos merge` 进入 `logos/resources/**`；**不含** `Allowed files:` 与 `do not modify` 等排他措辞（make-phase-banner-informational 起，横幅不声明可写范围，写入约束由 PreToolUse 层承担） |

## 八、ready-to-delta 状态分层与 plan_state 测试

> 覆盖 `status --format json` / SessionStart / UI 消费 `plan_state` 的分层语义，确保 `tasks.md` 执行进度不再被误读为任务规划失败。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

| ID | 用例 | 覆盖点 | 前置条件 | 操作 | 期望 |
|---|---|---|---|---|---|
| UT-S11-43 | ready-to-delta 输出 plan_state pending | JSON 契约 | 活跃提案 proposal/tasks 已脱模板，`proposal_step=ready-to-delta`，无 `PLAN_APPROVED` | `openlogos status --format json` 或 collectStatusData | `plan_state.plan_ready==true`；`plan_gate_pending==true`；`plan_approved==false`；`tasks_template_filled==true` |
| UT-S11-44 | tasks 执行进度与 plan_ready 解耦 | checkbox 分层 | 同 UT-S11-43，`[delta]` checkbox 为 `0/N` | 读取 `plan_state` | `tasks_execution_done==0`、`tasks_execution_total==N`，且 `plan_ready` 仍为 true |
| UT-S11-45 | proposal/tasks 冲突优先于 plan gate pending | 冲突诊断 | `proposal.md` 声明无需部署但 `tasks.md` 存在 `[deploy]` section | `status --format json` | `deployment_decision_conflict==true`；`plan_state.plan_ready==false`；诊断说明冲突，不输出 plan gate pending 成功态 |
| UT-S11-46 | PLAN_APPROVED 后 plan_gate_pending 关闭 | gate 消费状态源 | 活跃提案存在 `PLAN_APPROVED`，delta 尚未写完 | `status --format json` | `plan_state.plan_gate_pending==false`；`plan_state.plan_approved==true`；`proposal_step` 为 `delta-writing` 或后续 |
| ST-S11-32 | RunLogos 面板可区分规划完成与执行 0/N | 消费方分层 | 构造 `ready-to-delta + tasks_execution_done=0` 的 JSON | 面板/driver 诊断适配层消费 | 展示“方案已完成，等待批准/auto 消费”；不展示“任务规划失败” |
| ST-S11-33 | SessionStart 使用 plan_state 而非 suggestion 猜测 | SessionStart 消费 | `status --format json` 含 `plan_state.plan_gate_pending=true`，suggestion 文案可本地化变化 | 执行 SessionStart 解析逻辑 | 输出 plan gate 等待态文案；不因中文 suggestion 或 checkbox 比例改变写入范围 |

## 九、status 中 automation_diagnostic 前沿边界测试

> 以下用例含 OpenLogos reporter。用例名必须带 `UT-S11-47` / `ST-S11-34` 等 ID，供 verify 抽取覆盖。

### 9.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S11-47 | `ready-to-delta` 不挂载可驱动 repair 的 diagnostic | status JSON | 活跃提案 `proposal_step=ready-to-delta`，存在历史 verify 失败证据 | `status --format json` | 保留 `proposal_step=="ready-to-delta"`；不输出 `automation_diagnostic.suggested_next_node=="code"` |
| UT-S11-48 | `delta-writing` 不被 global verify failed 改写 | status JSON | `PLAN_APPROVED` 存在、`[delta]` 未完成，同时存在失败 acceptance report | `status --format json` | 保留 `proposal_step=="delta-writing"`；delta 进度照常输出；不输出 repair/code 前沿 |
| UT-S11-49 | `ready-to-merge` status 保留 merge 前沿 | status JSON | `[delta]` 全勾且存在 delta 文件，历史 `test-results.jsonl` 有失败 | `status --format json` | `proposal_step=="ready-to-merge"`；不因 stale diagnostic 回退到 `verify-failed` 或 `coding` |
| UT-S11-50 | 未规划切片的 `ready-to-implement` 保留 plan-slices | status JSON | `SPEC_MERGED` 在场、`code_required=true`、`[code]` 缺失或模板态、历史 verify failed | `status --format json` | `proposal_step=="ready-to-implement"`；诊断不得建议 `code` / `verify` repair |

### 9.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S11-34 | status 不让 stale verify diagnostic 污染 plan/spec/slice 前沿 | S11 Step 3→8 | 构造同一提案依次处于 `ready-to-delta`、`delta-writing`、`ready-to-merge`、未规划切片的 `ready-to-implement`，并放入历史失败证据 | 分别执行 `openlogos status --format json` | 每个状态均保留自身 `proposal_step`；不输出可驱动 repair/code 的 `automation_diagnostic` |

### 9.3 覆盖度校验补充

- [ ] status 非 code/verify 前沿不挂载可驱动 repair 诊断：UT-S11-47、UT-S11-48、UT-S11-49、UT-S11-50、ST-S11-34

## 十、契约自描述字段与步骤注册表测试（contract-self-description）

> 覆盖 D1（contract 握手）、D2（step_meta 与步骤注册表 + CI lint）、D3（facts 权威事实块）在 `status --format json` 上的生产者契约，以及 D9 的生产者一致性漂移注入验收（含「pre-implement 步骤不输出 loop_state」反面锚）。本节用例编号顺延既有最大编号（UT-S11-50 / ST-S11-34）。`active_change` 新增 `step_meta` / `facts` 走既有可控扩展口径：仅有活跃提案的 golden 同步更新，无活跃提案项目零漂移（D8）。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 10.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S11-51 | status JSON data 顶层 contract 在场且版本为 1.0.0 | D1 contract 握手 | 任意 fixture（有无活跃提案均取样） | `status --format json` | `data.contract` 恒在场且等于 `{"version":"1.0.0"}` |
| UT-S11-52 | active_change.step_meta 在场且取值经注册表映射 | D2 步骤注册表 | launched 活跃提案，抽样多个步骤 fixture | `status --format json` | `modules[].active_change.step_meta = {phase, kind}` 恒在场；抽样断言与注册表一致：writing→`{pre-implement, produce}`、ready-to-merge→`{pre-implement, gate}`、coding→`{implement, produce}`、verify-passed→`{post-implement, residency}`；phase ∈ pre-implement\|implement\|post-implement、kind ∈ produce\|gate\|command-required\|residency |
| UT-S11-53 | active_change.facts 六布尔字段在场且与磁盘权威事实一致 | D3 facts 事实块 | launched 活跃提案：SPEC_MERGED 在场、`[code]` 含真实脱占位条目、无 SLICES_APPROVED、无 VERIFY_PASS | `status --format json` | `facts = {spec_complete, slices_planned, slices_approved, code_required, has_delta_tasks, verify_pass}` 六字段全在场且均为布尔；该 fixture 下 `spec_complete==true`、`slices_planned==true`、`slices_approved==false`、`verify_pass==false`；取值与 CLI 权威判定（`hasSpecCompleteMarker` / `isTasksCodeFilled` / marker 在场性）同一份计算 |
| UT-S11-54 | 无活跃提案时不输出 step_meta/facts，contract 仍在场 | D1/D3 零漂移边界 | launched 无活跃提案（或 initial 模块） | `status --format json` | `modules[].active_change==null`，输出不含 `step_meta` / `facts`；`data.contract` 仍在场（无活跃提案项目除 contract 外零额外漂移） |
| UT-S11-55 | 注册表 lint：字面量 proposal_step 不经注册表即失败 | D2 CI lint | cli/src 全量源码 | 全仓静态扫描 lint 测试 | 任何「字面量赋给 proposal_step 却不经 `step-registry.ts` 注册表」的代码路径 → 测试失败并指出文件位置；现有全部铸造点（原 `detectProposalStep` / `detectProposalStepViaFlow` 双镜像及 status/next 覆盖点）收敛后 lint 通过 |
| UT-S11-56 | 生产者一致性漂移注入：新注册步骤三方同步 | D9 漂移注入 | 测试内注册全新步骤 `x-future-step`（phase=pre-implement, kind=produce） | 注册后跑生产者一致性测试 | 注册表 / `step_meta` 输出 / 打包 schema 三方同步，schema 校验通过（含 step_meta 必填）；任一方遗漏 → 测试失败 |
| UT-S11-57 | 漂移注入反面锚：pre-implement 步骤不输出 loop_state | D9 反面锚（D4 激活判据） | 承接 UT-S11-56：活跃提案当前步骤为 `x-future-step`（phase=pre-implement） | `status --format json` | 输出**不含** `loop_state`（`pre-implement + loop_state` 是非法组合，测试断言其不存在，而非将其固化为合法夹具）；`slice_state` 常驻口径不受影响 |

### 10.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S11-35 | status 契约自描述字段端到端互相一致 | Step 1→8 | 同一 launched 提案依次构造 ready-to-merge → ready-to-implement（未批准切片）→ coding 三个状态 | 每个状态执行 `openlogos status --format json` | 三次输出均满足：`data.contract.version=="1.0.0"`；`step_meta` 与 `proposal_step` 经同一注册表映射（ready-to-implement→`{pre-implement, residency}`、coding→`{implement, produce}`）；`facts` 与 `loop_state` 挂出判据同源——前两个状态 `facts.slices_approved==false` 且无 `loop_state`，coding 状态四事实全真且 `loop_state` 挂出 |

### 10.3 覆盖度校验补充

- [ ] status data 顶层 contract 在场且 =1.0.0：UT-S11-51
- [ ] step_meta 在场与注册表取值正确：UT-S11-52、ST-S11-35
- [ ] facts 在场与权威取值正确：UT-S11-53、ST-S11-35
- [ ] 无活跃提案零漂移边界：UT-S11-54
- [ ] 注册表 lint（字面量不经注册表 → 失败）：UT-S11-55
- [ ] 漂移注入三方同步 + pre-implement 不输出 loop_state 反面锚：UT-S11-56、UT-S11-57

## baseline-on-touch：status journal 恢复门测试

> 本节补充 S11 status 的事务一致性回归；实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。

### 单元测试

| ID | 描述 | 前置条件 | 操作 | 预期输出 |
|---|---|---|---|---|
| UT-S11-B01 | 安全 partial 仍输出正常 status | adopted、仅 open run/未提交 staging、无未终结 journal | `status` / `status --format json` | staging 被排除；成功 envelope 的 `baseline_seed_state=partial`；正常阶段/提案前沿可读取 |
| UT-S11-B02 | 未终结 journal 恢复失败即隔离并继续 | journal=`prepared|committing`，staging/backup 损坏使前滚与回滚均失败；对 resources/index/coverage 读取点设哨兵 | `status --format json` | 非零 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留 error envelope；读取哨兵均为 0；不输出伪成功 modules/coverage/action |
| UT-S11-B03 | journal 可恢复后只读一致集合 | 分别准备可前滚全新与可回滚全旧夹具 | `status --format json` | 恢复与读取位于同一锁序；输出只匹配完整全新或全旧 fixture，不出现混合 hash/index/state |

### 场景测试

| ID | 描述 | 前置/故障注入 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S11-B01 | status/next 对安全 partial 与未终结事务分流 | 先构造仅 staging 的 partial，再在多文件 rename/index/state 各崩溃点构造可恢复/不可恢复 journal | 分别执行 status 与 next，并记录标准资源读取哨兵 | 安全 partial 两入口成功且 staging 不采信；可恢复夹具只读全旧/全新；不可恢复夹具（隔离后继续）两入口均硬报 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留、读取计数为 0 |

### golden 边界

- 无 journal、已成功恢复及安全 partial 的既有 status golden 只按本案明确改变的 seed/action 字段重拍。
- 不可恢复 journal 是操作错误夹具，不得录成正常 status golden，也不得以“始终输出 baseline_seed_state”覆盖错误 envelope。

## S11 YAML 降级告警可见性测试

> 覆盖 `logos-project.yaml` 解析降级时人类可读通道的告警出口。机器通道既有的 `yaml_diagnostics` 语义与结构不变（既有 `ST-JSON-23` 已约定「不得静默回退为看起来正常」），本节把同一约定补齐到 `status` / `next` 的文本输出。
>
> 降级态样本必须在一次性 fixture 中构造，**不得改写本仓或用户其它项目的正式文档**。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S11-75 | `recovered` 态文本输出打印告警并点名未恢复字段 | Step 4b→6b | fixture 的 `logos-project.yaml` 前段 `modules` 完整、后段语法错误（可恢复），且原含 `resource_index` | 采集 `status` 人类可读输出 | 常规状态照常渲染；输出**含**可见告警，文本包含解析状态 `recovered`、未恢复字段名 `resource_index` 与重建入口 `openlogos index` |
| UT-S11-76 | `error` 态同样可见，不呈现为正常 | Step 4b→6b | fixture 整体损坏、无任何字段可恢复 | 采集 `status` 人类可读输出 | 输出含明确降级告警并标明 `error`；不得输出与健康项目无法区分的结果 |
| UT-S11-77 | 健康项目零新增输出（golden 零漂移） | Step 4a→5a | fixture 的 `logos-project.yaml` 可正常解析 | 采集 `status` 与 `next` 人类可读输出 | 两条命令输出与本变更前**逐字节一致**；不因本功能新增任何常态行 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S11-44 | 降级态下 status 与 next 同源告警且只读 | Step 1→6b、EX-S11-YD-1～3 | 一次性 fixture 项目，`logos-project.yaml` 处于 `recovered` 态 | 记录文件 SHA-256 → `openlogos status` → `openlogos next` → 再次记录 SHA-256 | 两条命令均输出可见告警且点名 `resource_index`（两通道对同一状态判断一致）；命令结束后 `logos-project.yaml` **字节不变**，CLI 未代用户改写、未自动重建索引 |

### 追溯与覆盖

- AC-YAMLW-04 降级可见：UT-S11-75、UT-S11-76、ST-S11-44。
- AC-YAMLW-05 处置权归人、只读不改写：ST-S11-44。
- golden 零漂移边界：UT-S11-77。
- 场景：S11 YAML 降级在人类可读通道的告警出口；功能规格：§2.47.3；架构：§三十八.3；既有机器通道锚：`ST-JSON-23`；安装态：SMOKE-core-169。

## S11 并发只读读取门有界重试测试（fix-baseline-readlock-reader-contention）

> 本节补充 S11 status 读取门的读锁重试回归；实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。

### 单元测试

| ID | 描述 | 前置条件 | 操作 | 预期输出 |
|---|---|---|---|---|
| UT-S11-78 | status 读锁区间在锁被占时走有界重试 | 注入可控时钟与预算；在 status 某读锁区间进入前由测试夹具持有模块锁，并在预算内（如 300ms 时点）释放 | `status --format json` | 命令成功且输出与无竞争基线逐字段一致；重试退避序列符合 25/50/100/200/400ms 封顶语义；读取哨兵证明恢复门四步在取到锁后才执行 |
| UT-S11-79 | writer 真持锁超预算仍如实报错 | 夹具全程持有模块锁且注入时钟推进超过总预算 2000ms | `status --format json` | 非零 `baseline_commit_in_progress` error envelope，字段与既有合同逐字一致；不输出任何从半新集合派生的 modules/coverage/action；不干扰持锁方 |

### 场景测试

| ID | 描述 | 前置/故障注入 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S11-45 | 并发 N 路只读 status 全零退出且投影一致 | 临时项目无 writer、无未终结 journal；不注入时钟（真实并发） | 8 路并发 `status --format json`，收集退出码与输出；随后串行执行一次作为基线 | 8 路全部零退出；各输出的 modules/phase/active_change 投影与串行基线一致；无 `baseline_commit_in_progress`；结束后无残留锁文件 |

### golden 边界

- 既有无竞争路径的 status golden 不重拍——重试语义在锁空闲时零开销、零行为差异。
- 超预算失败是操作错误夹具，复用既有 `baseline_commit_in_progress` error envelope golden，不得新增第二种错误形态。

> 测试实现必须写 OpenLogos reporter；并发用例须记录各路退出码与错误码计数作为 evidence。

### 追溯与覆盖

- AC-READLOCK-01 并发全零退出：ST-S11-45。
- AC-READLOCK-03 预算内取锁成功：UT-S11-78。
- AC-READLOCK-04 真持锁如实报错：UT-S11-79。
- 场景：S11 并发只读读取门有界重试（EX-RL-1、EX-RL-2）；功能规格：§2.54；架构：§四.B。

## S11 state_inconsistency 只读对账投影测试

> 覆盖 `status --format json` 在矛盾事实下输出 `state_inconsistency` 投影的挂载位置、字段完整性、证据顺序稳定性，以及一致状态零漂移与投影的只读性质。
>
> 背景：20260907 事故中 `DEPLOY_DONE` 缺失使派生停在 `ready-to-deploy`，下游强证据永不被评估，宿主面板长期显示「请执行部署任务」而无任何对账线索。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S11-80 | 矛盾事实下投影挂载与字段完整 | EX-11.5 | 活跃提案：`deployment_required=true`、`DEPLOY_DONE` **缺失**、`SMOKE_PASS` **在场**、`[deploy]` 已全勾 | 执行 `openlogos status --format json` | `modules[].active_change.state_inconsistency` 在场且三字段齐备：`kind==="deploy_done_missing_with_downstream_evidence"`、`evidence===["smoke_pass_marker_present","deploy_tasks_all_checked"]`（**按固定顺序去重**，稳定可 golden）、`remediation==="openlogos deploy-done"`；`proposal_step` 仍为 `ready-to-deploy`（投影不改派生）；legacy 单模块输出可回退顶层同名字段 |
| UT-S11-81 | 一致状态零漂移且投影只读 | EX-11.6 | 场景 A：`DEPLOY_DONE` 缺失且无任何矛盾证据；场景 B：`DEPLOY_DONE` 已在场 | 分别执行 `openlogos status --format json`，并比对调用前后磁盘 | 两种场景输出均**不含** `state_inconsistency` 键（不是 `null`）；其余字段与修复前逐字一致（既有 status golden 不受影响）；调用前后提案目录文件清单与 mtime 不变——**无写盘、无缓存、无 marker 变化** |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S11-46 | 三类证据分别触发且 `watch` 自动继承 | S11 主时序 + EX-11.5/11.6 | 真实 CLI；分别构造三种矛盾状态：仅 `SMOKE_PASS`、仅 `SMOKE_FAIL`、仅 `[deploy]` 全勾（三者均 `DEPLOY_DONE` 缺失） | 逐个状态执行 `openlogos status --format json`；再对其中一个状态启动 `openlogos watch` 读一帧；最后执行 `openlogos deploy-done` 后复跑 status | 三种状态各自输出投影，`evidence` 分别为 `["smoke_pass_marker_present"]` / `["smoke_fail_marker_present"]` / `["deploy_tasks_all_checked"]`；`watch` 因复用 `collectStatusData` 自动携带同一投影且保持只读；补标后投影字段消失、`proposal_step` 推进；与 `plan_state` / `automation_diagnostic` / `merge_transaction` 等既有只读投影并列挂载、互不覆盖 |

### 追溯与覆盖

- AC-RECON-STATUS-01 矛盾事实输出投影且字段齐备：UT-S11-80。
- AC-RECON-STATUS-02 证据枚举顺序稳定可 golden：UT-S11-80、ST-S11-46。
- AC-RECON-STATUS-03 一致状态零漂移：UT-S11-81。
- AC-RECON-STATUS-04 投影只读、不改派生、不写盘：UT-S11-81、ST-S11-46。
- AC-RECON-STATUS-05 `watch` 自动继承：ST-S11-46。
- 场景：S11「deploy-done 对 status 的影响」§state_inconsistency 只读对账投影；功能规格：§2.67.3；JSON 契约：`spec/cli-json-output.md` `state_inconsistency`。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S11"`；失败不得写 pass。
- 只读断言以调用前后提案目录文件清单与 mtime 比对取证；字段缺席断言必须校验**键不存在**，不得以值为 `null` 通过。

## S11 plan 状态统一观测测试用例

> 测试实现必须写 OpenLogos reporter；只读性用临时项目全量文件清单与逐文件 SHA-256 前后比较证明。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S11-58 | plan_state 挂载完整 evaluation | S11 Step 2→6 | 活跃 writing plan | collect status | plan_package、version、issues 与投影字段一致 |
| UT-S11-59 | ready 投影与 evaluator 同义 | S11 Step 3 | ready true/false 参数化 | status mapper | plan_ready 精确等于 evaluation.ready，不可被 checkbox 覆盖 |
| UT-S11-60 | issue 稳定排序与字段保真 | S11 Step 3 | 多文件多行问题 | 两次 collect | code/path/section/line/actual/expected/fix_hint 顺序逐字节一致 |
| UT-S11-61 | evaluator 操作错误不吞成成功态 | EX-3.1 | proposal 不可读/解析器抛错 | status | error envelope、非零；无 plan_ready 成功对象 |
| UT-S11-62 | 历史旁路维持真实前沿 | EX-6.1 | marker + 旧模板 | status derive | proposal_step 不回退，warning 不改变 plan_state |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S11-36 | status/lint/next/flow 四方同源 | Step 1→6 | 合法与多类非法 fixture | 连续运行四消费者 | ready、三态、issues 完全一致；schema 1.3.0 通过 |
| ST-S11-37 | status 所有路径只读 | EX-3.1、EX-6.1 | ready/invalid/operation-error/history fixture | 前后全量快照并运行 status | 文件集合与 hash 完全不变，无 marker/cache/stamp 写入 |

### 追溯与覆盖

- S11-AC-Plan-01 统一观测：UT-S11-58～UT-S11-60、ST-S11-36。
- S11-AC-Plan-02 操作错误：UT-S11-61、ST-S11-37。
- S11-AC-Plan-03 历史与只读：UT-S11-62、ST-S11-37。

## S11 phase 探测模块前缀命名兼容测试

> 覆盖 `plugin/bin/openlogos-phase` 的 `check_scenarios_complete()` 两项叠加修复：
> ① **模式必须以字面量到达 `find`**（分词循环期间关闭 pathname expansion，`set -f` / `set +f`
> 或等价手段）；② 匹配条件由 `-name "${sid}-${pat}"` 改为兼容形态
> `-name "${sid}-${pat}" -o -name "*-${sid}-${pat}"`。两项缺一不可：**不做 ① 时 `*.md` 会先被展开成
> 项目根的 `README.md` / `AGENTS.md`，再正确的前缀 glob 也不会被执行到**。断言口径见场景 S11
> 「per-scenario 覆盖判定的权威口径与 SessionStart 同口径约束」EX-11.7～EX-11.10、INV-SC1～SC4，
> 命名规范见 `spec/module-naming-convention.md`；来源变更
> fix-merge-prototype-commit-and-phase-module-prefix（决策 D1）。
>
> **跨实现断言的适用域（重要）**：D1 选定「同口径的独立实现」，故 shell 与 CLI 只在
> **恒等域**上对账——目标目录内文件全部为 `<module>-SXX-*` 规范命名、且不含其它模块同号文件，
> 且仅限 CLI 侧确有 per-scenario 判定的 `phase.3-1` / `phase.3-4a` 两个调用点。无前缀历史命名、
> 其它模块同号文件、`-test-cases` 后缀宽严差异、API 调用点（CLI 侧 `SCENARIO_PHASES` 不含）
> 均为场景 delta「已知差异清单」中的具名差异，**只作 shell 自身断言、不纳入恒等对账**。
>
> 夹具用一次性隔离项目构造，直接以 `bash`/`sh` 子进程运行**源模板** `plugin/bin/openlogos-phase`
> （不测 `.claude/openlogos/bin/` 的 sync 部署副本）；`openlogos status --format json` 对照臂以真实
> CLI 子进程取 `scenario_coverage`。只读性用运行前后全量文件清单与逐文件 SHA-256 比对证明。
> 测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S11-82 | 模块前缀命名项目三个调用点均零 missing（含真实项目根噪声，修复前必红） | EX-11.7 | 隔离项目 `logos-project.yaml` 声明 4 个场景；场景目录、API 目录、测试目录分别有 `core-SXX-<slug>.md` / `core-SXX-*.yaml` / `core-SXX-test-cases.md` 全覆盖；**项目根同时存在 `README.md`、`AGENTS.md`、`CLAUDE.md` 与一个根级 `*.yaml`**（真实项目常态） | 以项目根为 cwd 运行 `openlogos-phase`，分别取场景时序、API、测试用例三个调用点的 `check_scenarios_complete` 结果 | 三处均返回 0 且 missing 为空；phase 文本不含 `missing`。**修复前必红**：`*.md` / `*.yaml *.yml` 被 cwd 文件名展开后拼出 `S0X-README.md` 等，且即便字面量到达也漏模块前缀，三处全报 missing |
| UT-S11-83 | 模式字面量到达 `find`，结果不随 cwd 文件集合变化 | EX-11.8、INV-SC4 | 目标目录仅有 `core-S03-demo.md`；对照两态：项目根**无**任何 `.md` / `.yaml` 文件 vs 仅新增一个 `README.md`（API 臂对应新增一个根级 `.yaml`） | 两态下分别运行探测，并捕获实际执行的 `find` 参数（`set -x` 跟踪或等价手段） | 两态 missing 集合**均为空且相等**；捕获到的 `find` 参数中 `-name` 值恒为 `*.md`（API 臂为 `*.yaml` / `*.yml`）字面量，**不出现** `S03-README.md` / `*-S03-README.md` 形态。修复前后一态即红 |
| UT-S11-84 | 无前缀历史命名向后兼容仍命中（shell 自身断言，不与 CLI 对账） | EX-11.9、约束 3 | 同一夹具改为历史命名 `SXX-<slug>.md` / `SXX-test-cases.md`（无模块前缀） | 同上三个调用点 | shell 侧仍判为全覆盖、missing 为空；放宽匹配不得使历史项目的 missing 集合增大。**明确不断言与 CLI 相等**——CLI 按权威口径 `core-SXX` 子串判 missing，属场景 delta 已知差异清单第 1 行 |
| UT-S11-85 | 真实缺失仍如实报 missing（不漏报） | EX-11.10、INV-SC3 | 声明 4 个场景，其中 2 个在目标目录下既无 `core-SXX-*` 也无 `SXX-*` 文件；目录内另有 `core-00-scenario-overview.md` 作为干扰 | 同上三个调用点 | missing 恰为那 2 个场景 ID、顺序稳定；`core-00-*` 不被当作任一场景的覆盖。另设**已知差异见证臂**：目录内放入 `web-S03-demo.md` 时 shell 判 S03 已覆盖——该行为按已知差异清单第 2 行**如实记录为预期**，不判红（收紧需另立提案） |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S11-47 | 恒等域上 SessionStart 探测与 `status` 权威口径 missing 集合逐项相等 | EX-11.7、EX-11.8、EX-11.10 | 两个**恒等域** fixture（全部 `<module>-SXX-*` 规范命名、单模块、项目根含 `README.md` / `AGENTS.md` 噪声）：① 全覆盖；② 部分缺失 | 对每个 fixture 依次跑真实 `openlogos status --format json` 与 `bash plugin/bin/openlogos-phase`，解析两侧 missing 集合，**仅比对 `phase.3-1`（场景时序）与 `phase.3-4a`（测试用例）两个调用点** | 两 fixture 上两侧 missing 集合**逐项相等**（① 均为空、② 相同且非空）。另断言：**修复前 fixture ① 两侧相反**（JSON 空、shell 非空），即本次误导源的回归锁；`openlogos-phase` 全路径**只读**——运行前后文件清单与逐文件 SHA-256 完全不变，无 marker / cache / stamp 写入；探测**不调用 CLI**（断言子进程树中无 node/openlogos 进程，锁定 D1 的零依赖约束）。API 调用点**不参与对账**（CLI 侧 `SCENARIO_PHASES` 无对应判定），仅断言 shell 自身结果与 UT-S11-82 一致 |

### 追溯与覆盖

- 主修·模式字面量到达 `find`、结果不随 cwd 变化（delta-r1 F1 必红臂）：UT-S11-83、UT-S11-82 的根噪声夹具、ST-S11-47 的根噪声 fixture。
- 主修·模块前缀命名命中、三个调用点同时生效（修复前必红）：UT-S11-82、ST-S11-47 fixture ①。
- 不变式·无前缀历史命名向后兼容（INV-SC2、约束 3）：UT-S11-84（shell 自身断言）。
- 不变式·不漏报（INV-SC3）：UT-S11-85、ST-S11-47 fixture ②。
- 不变式·两条实现在恒等域同口径、域外差异具名（INV-SC1，delta-r1 F2 的适用域收敛）：ST-S11-47 的恒等域限定断言 + UT-S11-85 的已知差异见证臂。
- 不变式·探测只读且零 CLI 依赖（D1、约束 6）：ST-S11-47 的只读与进程树断言。
- 方法论规范：`spec/module-naming-convention.md`；场景：S11「per-scenario 覆盖判定的权威口径与 SessionStart 同口径约束」（EX-11.7～EX-11.10、INV-SC1～SC4）；来源变更：fix-merge-prototype-commit-and-phase-module-prefix。

## S11 SessionStart 阶段横幅去排他措辞测试

> 覆盖场景 S11「SessionStart 阶段横幅的措辞约束（情境信息而非写入授权）」及 EX-11.11～EX-11.15；来源变更 make-phase-banner-informational。
>
> 夹具用一次性隔离 launched 项目构造（含 `logos/.openlogos-guard`、提案目录与所需 marker），直接以 `bash` 子进程运行**源模板** `plugin/bin/openlogos-phase`（不测 `.claude/openlogos/bin/` 的 sync 部署副本）。为隔离 step 派生，单元用例通过桩 `openlogos` 可执行文件（置于 `PATH` 首位）返回指定 `proposal_step` 的 `status --format json`；场景用例使用真实 CLI。
>
> **排他措辞判定口径**：对横幅中 `Change Management:` 一行做匹配，四类模式为 `\bonly\b`、`Allowed files:`、`\bStop\b`、`do not modify`（均大小写不敏感）。**适用分支**为 plan-exit 之后的全部分支与未知 step 兜底分支；plan 阶段分支（`writing` / `ready-to-delta`）、无 guard 分支与状态行 `GUARD_STATUS` 不在射程内，只作「逐字不变」断言。
>
> 测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S11-86 | 三处原排他分支去排他后仍含提案 slug 与当前 step（修复前必红） | EX-11.11、EX-11.12 | 隔离项目活跃提案 `feat-x`；桩 status 依次返回 `proposal_step` ∈ {`coding`, `ready-to-verify`, `verify-failed`, `delta-writing`, `implementing`, `in-progress`, `ready-to-merge`} | 对每个 step 运行 `openlogos-phase`，取 `Change Management:` 行 | 七个 step 的该行均含 `'feat-x'` 与当前 step 名（`implementing` / `in-progress` 归一显示为 `delta-writing`，与现状一致）；均**不含**四类排他模式。**修复前必红**：`coding` 系命中 `only`，`delta-writing` 系命中 `Allowed files:` 与 `do not modify`，`ready-to-merge` 命中 `Stop` |
| UT-S11-87 | 四类排他措辞在 plan-exit 之后全部分支零出现 | EX-11.11、措辞约束 2 | 同上夹具；step 枚举取 plan-exit 之后全部已知值：`delta-writing`、`implementing`、`in-progress`、`ready-to-merge`、`merge-generated`、`coding`、`ready-to-verify`、`verify-failed`、`verify-passed`、`deploy-done`、`smoke-passed`、`ready-to-deploy`、`ready-to-smoke`、`smoke-failed` | 逐 step 运行并对 `Change Management:` 行做四类模式匹配 | 全部 step 零命中；断言按 step 逐条报告，任一命中即红并给出 step 与命中片段 |
| UT-S11-88 | 未知 step 兜底分支同样非排他 | EX-11.14 | 桩 status 分别返回 `proposal_step=""` 与 `proposal_step="some-future-step"` | 运行 `openlogos-phase` | 两臂均进入兜底分支：该行说明 step 未知并建议运行 `openlogos status` / `openlogos next`；四类排他模式零命中；不含 `within … scope` 之类范围限定措辞；仍含提案 slug 与人类确认点语句 |
| UT-S11-89 | 人工会话所需信息项逐项在场 | EX-11.12、措辞约束 1、5 | 同 UT-S11-86 夹具 | 对 `delta-writing`、`ready-to-merge`、`coding` 三个 step 分别运行 | 三者均含：提案 slug、当前 step、人类确认点语句（`openlogos merge, openlogos verify, openlogos smoke, openlogos archive, deployment, and git push are human confirmation points` 与改动前**逐字相同**）。另逐 step 断言工作重心：`delta-writing` 含 `logos/changes/feat-x/deltas/` 与 `[delta]`；`ready-to-merge` 含 `openlogos merge feat-x` 且表达需用户明确授权；`coding` 含 `logos/changes/feat-x/tasks.md` 与 `[code]`，并提示完成后更新 `tasks.md` |
| UT-S11-90 | 射程外分支与状态行逐字不变 | EX-11.15、射程之外 | 同一夹具；改动前版本的 `openlogos-phase` 留存为对照副本 | 分别以 `writing`、`ready-to-delta`（含与不含 GUI `write-ui-prototype` overlay）、无 guard 三种状态运行新旧两版 | 新旧两版在这三种状态下的 `Change Management:` 行与 `📊 OpenLogos:` 状态行**逐字相同**（含 `GUARD_STATUS` 的 `… this proposal only.`，其属已知残留，不在本变更射程内） |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S11-48 | 会话启动于提案 X 的 coding 阶段、随后被派去评审提案 Y 时横幅不再声称排他 | EX-11.13 端到端 | 真实 CLI；隔离 launched 项目中提案 X 处于 `coding`（`PLAN_APPROVED`、`SPEC_MERGED` 在场，`[code]` 有未勾切片）；另建提案 Y 的目录与 `deltas/` | ① 运行 `openlogos-phase` 取 SessionStart 横幅；② 以 PreToolUse 输入格式向 `plugin/bin/guard-check` 喂一条 `Write` 到 `logos/changes/Y/reviews/candidates/delta-r1-demo.md` | ① 横幅含 `'X'` 与 `coding`，**不含** `only` 及其余三类排他模式，不含任何「只能写 X 的 `[code]` 范围」的表述；② `guard-check` 退出码 0（放行）——证明「允许写 Y 的评审文件」与横幅之间不再存在自然语言冲突，实际约束由 PreToolUse 层给出 |
| ST-S11-49 | `guard-check` 判定与 `status --format json` 输出在改动前后逐字不变 | EX-11.15 | 真实 CLI；同一组隔离夹具覆盖 `delta-writing`、`coding`、`ready-to-merge`、plan 阶段（无 `PLAN_APPROVED`）与无 guard 五种状态；`plugin/bin/guard-check` 与改动前版本逐字节比对 | ① 对每种状态运行 `openlogos status --format json` 并落盘；② 对每种状态向 `guard-check` 喂同一组输入（源码 `Write`、`logos/resources/**` `Write`、`logos/changes/<slug>/deltas/**` `Write`、plan 阶段非 page-design delta `Write`、`echo x > src/a.ts` 形态的 `Bash`）；③ 与改动前基线逐项对比 | `plugin/bin/guard-check` 文件 SHA-256 与改动前相同；每种状态下 status JSON 与基线**逐字相同**（剔除时间戳类易变字段须在测试中具名列出，不得泛化忽略）；`guard-check` 每条输入的退出码与拦截文案与基线逐项相同 |

### 追溯与覆盖

- 主修·三处排他分支同批去排他（EX-11.11，修复前必红）：UT-S11-86、UT-S11-87。
- 不变式·人工会话信息项不减（EX-11.12）：UT-S11-86、UT-S11-89。
- 端到端·复用会话跨提案评审不再被横幅劝退（EX-11.13）：ST-S11-48。
- 边界·未知 step 兜底非排他（EX-11.14）：UT-S11-88。
- 不变式·命令契约与射程外文案零回归（EX-11.15）：UT-S11-90、ST-S11-49；既有 ST-S11-31 预期结果同步改为非排他口径。
