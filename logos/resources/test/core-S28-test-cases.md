# S28: next 暴露 next_node 编排提示 — 测试用例

> 复用 S22 临时项目 overlay 模式（`makeTempRoot` + `scaffoldProject` + 写 `root/logos/flow/<lifecycle>.yaml`），通过 overlay `add`/`modify`/`skip`/`set-loop` 构造各节点形变；通过预写 marker / `LOOP_ITERS` / `GATE_AUTO_PASSED` / `PLAN_APPROVED` 构造 launched step、loop、auto 状态。
> 不改 `spec/flow/*.yaml`、真实 `logos/flow/`。**golden 用例例外**：本切片**有意**重新 baseline `golden-baseline.test.ts` 的 `next --json` 快照（diff 仅 next_node），`status`/`watch`/`flow show` 快照不变。含 OpenLogos reporter（用例名须带 `UT-S28-*` / `ST-S28-*` 供抽取）。

## 一、单元测试用例
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S28-01 | initial 当前 phase→builtin 节点 → 输出 skill | initial、`current_phase`=phase.3-5（PHASE_KEY_TO_NODE_ID→code） | `next --format json` | `next_node.id:"code"`、`subflow_id:"implement"`、`skill:"code-implementor"`；5 hint 字段固定存在 |
| UT-S28-02 | launched step→builtin 节点 → 输出 skill | launched、`proposal_step`=`writing`（STEP_TO_CURRENT_BUILTIN→write-proposal） | `next --format json` | `next_node.id:"write-proposal"`；hint 取 resolved flow 该节点；step→node 复用唯一一份 STEP_TO_CURRENT_BUILTIN |
| UT-S28-03 | overlay-add 当前节点 → 输出其 hints | overlay add 节点（skill/working_agent 自定）、为当前节点 | `next --format json` | `next_node` = 该 add 节点；`skill`/`working_agent` 如 overlay 声明 |
| UT-S28-04 | 【overlay modify】重绑 review_agent → 如实反映 | overlay `modify code set:{review_agent:"my-reviewer"}`；current=code | `next --format json` | `next_node.review_agent:"my-reviewer"`（resolved flow 重绑生效） |
| UT-S28-05 | 【overlay modify】重绑 working_agent → 如实反映 | overlay `modify code set:{working_agent:"my-coder"}`；current=code | `next --format json` | `next_node.working_agent:"my-coder"` |
| UT-S28-06 | pre/post_script 透出 | overlay `modify code set:{pre_script:"./pre.sh", post_script:"./post.sh"}`；current=code | `next --format json` | `next_node.pre_script:"./pre.sh"`、`post_script:"./post.sh"`（不解释、不执行） |
| UT-S28-07 | 字段类型：id/name/subflow_id 为 string | 同 UT-S28-01 | `next --format json` | `id`/`name`/`subflow_id` 均为非空 string |
| UT-S28-08 | 空值规则：verify 节点 skill=null（5 字段固定存在） | current=verify（CLI 驱动节点） | `next --format json` | `next_node.skill:null`；`working_agent`/`review_agent`/`pre_script`/`post_script` 均 key 存在（值 null 或 string） |
| UT-S28-09 | 挂载同构：有 modules[] → modules[].next_node | 多模块项目、某模块有当前节点 | `next --format json` | `next.modules[].next_node` 存在；与 `current_node`/`loop_state` 同位挂载 |
| UT-S28-10 | 挂载同构：legacy 无 modules → 顶层 next_node | legacy 单模块（无 modules[]） | `next --format json` | 顶层 `next_node`；无 `modules[].next_node` |
| UT-S28-11 | 【R3】cmd done 续推 → 指向续推后节点（非已 done cmd） | overlay add cmd:"true" 为当前节点、其后有真实节点 | `next --format json` | `next_node` = 续推后落到的节点；**不**等于已 done 的 cmd 节点 |
| UT-S28-12 | 【R3】cmd 失败 → 指向该 cmd 节点 | overlay add cmd:"exit 3" 为当前节点 | `next --format json` | `next_node` = 该 cmd 节点（求值后 active）；与 `cmd_satisfied:false` 并存 |
| UT-S28-13 | 【R3】cmd 超时 → 指向该 cmd 节点 | cmd:"sleep 5" + cmd_timeout_seconds:1 | `next --format json` | `next_node` = 该 cmd 节点；与 `cmd_timed_out:true` 并存 |
| UT-S28-14 | 【R3】budget=1 → 指向第二个 pending cmd | 两相邻 cmd 节点（第一 exit0、第二 pending） | `next --format json` | `next_node` = 第二个 pending cmd 节点（续推后落点） |
| UT-S28-15 | 【R4】--auto gate 放行 next_node 分流 | A: ready-to-merge/deploy 可跳；B: ready-to-delta 且无 `PLAN_APPROVED` | `next --auto --format json` | A 输出**不含** `next_node` key；B 写入 `PLAN_APPROVED` 后输出 `next_node.id=="write-delta"` |
| UT-S28-16 | 【R7】loop 阻塞未达上限 → next_node=code 工作节点 | overlay set-loop max_iters:3；账本 1 行 fail（current 钉 verify） | `next --format json` | `next_node.id:"code"`（非 verify）；与 `loop_state{converged:false,escalated:false}` 并存 |
| UT-S28-17 | 【R7】loop 阻塞 + overlay 重绑 → next_node 取 code 的重绑 hints | set-loop max_iters:3 + `modify code set:{working_agent:"fixer"}`；账本 1 行 fail | `next --format json` | `next_node.id:"code"`、`working_agent:"fixer"` |
| UT-S28-18 | 【R7】loop 阻塞 + overlay current_node 优先 | set-loop 激活 + overlay-add `current_node` 存在；账本 1 行 fail | `next --format json` | `next_node` = overlay current_node（不被「取 code」覆盖） |
| UT-S28-19 | 【R7】code 被 overlay skip → 省略（用例放 initial） | **initial** set-loop max_iters:3 + overlay `skip code`；账本 1 行 fail | `next --format json` | 输出**不含** `next_node`；`loop_state` 仍在（宿主读 loop_state） |
| UT-S28-20 | 【R7】达上限 escalated → 省略 next_node（普通 next 无 gate 字段） | set-loop max_iters:2；账本 2 行均 fail | `next --format json` | 输出**不含** `next_node`；`loop_state.escalated:true`；**不含** `gate_id`（gate 字段属 `--auto` 字段组，普通 next 不输出） |
| UT-S28-20b | 【R7】达上限 escalated → `--auto` 输出 loop-exhausted gate | 同 UT-S28-20 | `next --auto --format json` | `gate_id:"gate:implement:loop-exhausted"`、`skippable:false`、`gate_auto_passed:false`；仍省略 `next_node` |
| UT-S28-21 | 【R7】launched builtin code skip → S25 FLOW_SCHEMA_INVALID（非省略） | **launched** overlay `skip code`（builtin） | 派生 / `next` | `FLOW_SCHEMA_INVALID`（S25 派生入口 fail loud）；根本不进 S28 next_node 省略逻辑 |
| UT-S28-22 | 【R5】all_done → 省略 next_node | 流程走完（all_done） | `next --format json` | 输出**不含** `next_node`（命令级建议非真实 flow node） |
| UT-S28-23 | 【R5】launched 无 active proposal → 省略 | launched、无 active proposal（建议 `change <slug>`） | `next --format json` | 输出**不含** `next_node` |
| UT-S28-24 | 【R5】adopted 补 baseline → 省略 | adopted、建议 `change add-baseline-docs` | `next --format json` | 输出**不含** `next_node` |
| UT-S28-25 | 【R6】initial 解析用 PHASE_KEY_TO_NODE_ID 正向 map | initial 各 phase | `next --format json` | 各 phase 正确映射到 builtin node id（与正向表 NODE_TO_PHASE_KEY 1:1 但**不**反查实现） |
| UT-S28-26 | 范围边界：status/watch 不输出 next_node | 同有当前节点项目 | `status` / `watch --format json` | 输出**不含** `next_node` key（仅 next 暴露） |

## 二、场景测试用例
| ID | 描述 | 覆盖 Steps | 操作 | 预期 |
|----|------|-----------|------|------|
| ST-S28-01 | builtin 当前节点输出编排提示端到端 | Step 5→9 | initial current=code → `next` | `next_node{id:code, skill:code-implementor, ...}`；hint 字段齐全 |
| ST-S28-02 | overlay 重绑 agent → 宿主拿到重绑值 | Step 8（overlay modify） | `modify code set:{working_agent,review_agent}` → `next` | `next_node` 反映重绑的 working/review_agent |
| ST-S28-03 | 挂载同构端到端 | Step 9 | 多模块 vs legacy 各一例 → `next` | modules[].next_node / 顶层 next_node 同构 |
| ST-S28-04 | 【R3】cmd 续推与失败两路 | Step 6 | cmd:"true"（续推）/ cmd:"exit 3"（失败）→ `next` | 续推→续推后节点；失败→cmd 节点 |
| ST-S28-05 | 【R4】--auto 放行分流 | Step 2→3 | ready-to-merge/deploy 可跳 + ready-to-delta 可跳各一例 | 非 plan gate：省略 next_node、action proceed；plan-exit：写 `PLAN_APPROVED` 并输出 `next_node.id=="write-delta"` |
| ST-S28-06 | 【R7】loop 阻塞派工作节点端到端 | Step 4 | set-loop 激活、verify FAIL → `next` | `next_node.id:code`（非 verify）；与 loop_state 并存 |
| ST-S28-07 | 【R7】loop escalated 省略端到端 | Step 4 | 迭代至达上限均 fail → `next` | 省略 next_node；`escalated:true` |
| ST-S28-08 | 【R5】命令级建议省略端到端 | Step 7 | all_done / 无 active proposal / 补 baseline | 各省略 next_node |
| ST-S28-09 | golden：干净基线重新 baseline、diff 仅 next_node | 安全红线 | 重跑 `next --json` 快照 + 逐项复核 diff | `next` 快照唯一新增 / 调整 `next_node`，无其它字段漂移；`status`/`watch`/`flow show` 快照逐字节不变 |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 操作 | 预期 |
|----|------|----------|------|------|
| ST-S28-EX-1 | launched builtin code skip → 报错（非省略） | EX-1 | launched overlay `skip code` → 派生 | `FLOW_SCHEMA_INVALID`（S25 入口），不进 S28 省略逻辑 |
| ST-S28-EX-2 | 命令级建议省略（非报错） | EX-2 | all_done / change / baseline / launch | 各正常省略 `next_node`、无报错 |
| ST-S28-EX-3 | initial loop 阻塞 + code 缺失/被 skip → 省略 | EX-3 | initial set-loop + skip code、verify FAIL | 省略 next_node、loop_state 仍在；不报错 |
| ST-S28-EX-4 | 已存在 PLAN_APPROVED 后重复 next --auto | EX-4 | ready-to-delta 已被消费，尚未产出 delta | `next --auto --format json` | 不再走 auto 放行省略；输出 `next_node.id=="write-delta"` |

## 四、覆盖度校验清单
- [ ] builtin 当前节点输出 skill（initial phase→node / launched step→node）：UT-S28-01、UT-S28-02、ST-S28-01
- [ ] overlay-add 当前节点输出其 hints：UT-S28-03
- [ ] overlay modify 重绑 working/review_agent 如实反映：UT-S28-04、UT-S28-05、ST-S28-02
- [ ] pre/post_script 透出：UT-S28-06
- [ ] 字段类型/空值（id/name/subflow_id=string；5 hint=string|null 固定存在；verify skill=null）：UT-S28-07、UT-S28-08
- [ ] 挂载同构（modules[] / legacy 顶层）：UT-S28-09、UT-S28-10、ST-S28-03
- [ ] 【R3】cmd done 续推→续推后节点 / 失败 / 超时→cmd 节点 / budget=1→第二个 pending cmd：UT-S28-11~14、ST-S28-04
- [ ] 【R4】--auto 放行分流：UT-S28-15、ST-S28-05、ST-S28-EX-4
- [ ] 【R7】loop 阻塞未达上限→code（overlay current_node 优先 / 重绑 hints）：UT-S28-16、UT-S28-17、UT-S28-18、ST-S28-06
- [ ] 【R7】code 被 overlay skip→省略（initial）/ launched builtin skip→FLOW_SCHEMA_INVALID / 达上限→省略（普通 next 省略 + escalated；`--auto` 才输出 loop-exhausted gate 字段）：UT-S28-19、UT-S28-20、UT-S28-20b、UT-S28-21、ST-S28-07、ST-S28-EX-1、ST-S28-EX-3
- [ ] 【R5】all_done / 无 active proposal（建议 change）/ 补 baseline→省略：UT-S28-22、UT-S28-23、UT-S28-24、ST-S28-08、ST-S28-EX-2
- [ ] 【R6】initial 用 PHASE_KEY_TO_NODE_ID 正向 map（非反查）：UT-S28-25
- [ ] 范围边界（status/watch 不输出 next_node）：UT-S28-26
- [ ] golden：干净基线重新 baseline、diff 仅 next_node（其它快照不变）：ST-S28-09

## 十、stale diagnostic 不覆盖 next_node / command 测试

> 以下用例含 OpenLogos reporter。用例名必须带 `UT-S28-27` / `ST-S28-10` 等 ID，供 verify 抽取覆盖。

### 10.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S28-27 | `delta-writing` 的 `next_node` 不被 stale diagnostic 改为 code | next_node | `proposal_step=delta-writing`，历史全量失败诊断存在 | `next --format json` | `next_node.id=="write-delta"`；不输出 `next_node.id=="code"` |
| UT-S28-28 | `ready-to-merge --auto` 的 command 优先于 stale repair | command | `proposal_step=ready-to-merge`，历史 `global-verify-failed` 存在 | `next --auto --format json` | `command=="openlogos merge <slug>"`；`next_node` 不被改成 `code` |
| UT-S28-29 | 未规划切片时 `plan-slices` 优先于 stale repair | next_node | `ready-to-implement`、`code_required=true`、`[code]` 模板态、历史 verify failed | `next --auto --format json` | `next_node.id=="plan-slices"`；无 `next_node.gate_id`；不输出 code/verify repair |
| UT-S28-30 | `coding` 前沿仍可派 repair/code | next_node | `proposal_step=coding`，当前全量失败且未达上限 | `next --auto --format json` | 可输出 `automation_diagnostic.reason=="global-verify-failed"`，并建议 `code` / repair |

### 10.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S28-10 | next_node / command 按当前前沿派生而非按历史诊断抢占 | R4 / R7 | 同一历史失败证据下分别构造 `delta-writing`、`ready-to-merge`、未规划切片 `ready-to-implement`、`coding` | 分别执行 `next --format json` / `next --auto --format json` | 前三者保留 write-delta / merge command / plan-slices；`coding` 才可进入 repair/code |

### 10.3 覆盖度校验补充

- [ ] stale diagnostic 不覆盖 `write-delta`：UT-S28-27
- [ ] stale diagnostic 不清空 merge command：UT-S28-28、ST-S28-10
- [ ] stale diagnostic 不覆盖 `plan-slices`：UT-S28-29
- [ ] 当前 `coding` repair 行为保留：UT-S28-30

## 十一、next_node.dispatch 派发契约（contract-self-description，D6）

> 验证 C4/D6：`next_node` 恒带完整 `dispatch:{idempotent, timeout_seconds, artifacts_hint}`；
> 权威数据源 = flow 节点定义（内置模板逐节点人工声明，**不从 produces/done_when 推导**）；
> 节点可另声明 `requires_reviewed: string[]`；schema 校验按打包 `spec/schema/next.schema.json` 执行。

### 单元测试用例补充
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S28-31 | builtin 节点 dispatch 来自 flow 节点定义（数据源） | launched、current=write-proposal（内容产出节点） | `next --format json` 对照 `loadBuiltinFlow("launched")` 该节点声明 | `next_node.dispatch` 与 flow 节点定义声明逐字段一致（`idempotent:true`、`timeout_seconds:900`、`artifacts_hint` 含 `"proposal.md"`）；无输出层改写 |
| UT-S28-32 | 一次性落盘节点 idempotent:false + requires_reviewed 透传 | launched、current=apply-merge 类节点（flow 声明 `idempotent:false`、`requires_reviewed:["proposal","delta"]`） | `next --format json` | `next_node.dispatch.idempotent:false`；`next_node.requires_reviewed==["proposal","delta"]`（原样透传，供 driver 替代本地 priorReviewNode 映射表） |
| UT-S28-33 | timeout_seconds 分级物化（唯一默认值源（fallback） = flow） | 分别构造 current=code（3600）、deploy 类（1800）、其余默认（defaults.dispatch.timeout_seconds=900） | `next --format json` 三例 | 各节点 `dispatch.timeout_seconds` 分别为 3600 / 1800 / 900；均来自 resolved flow 物化值，输出层不存在第二处默认 |
| UT-S28-34 | dispatch 恒为完整对象 + schema 校验 | 遍历各 current 形态（builtin 节点、overlay-add 显式声明、overlay-add 未声明走保守默认） | `next --format json` + `spec/schema/next.schema.json` 校验 | 每例 `next_node.dispatch` 三字段齐备（`idempotent`:bool、`timeout_seconds`:int、`artifacts_hint`:string[]）、无缺失分支；每例解析 envelope 后以 **`output.data`** 为实例通过 schema 校验（schema 校验对象 = data 对象，含 step_meta/dispatch 必填） |
| UT-S28-35 | 更新后 R8 锚回归：既有 8 字段不漂移、仅新增 dispatch/requires_reviewed | 与重拍前 golden 同一 fixture | `next --format json` 对照重拍后 golden | `next_node` 既有 8 字段（id/name/subflow_id + 5 hint 字段）取值与重拍前完全一致；相对旧锚**仅**新增 `dispatch`（恒在）与 `requires_reviewed`（节点声明时才出现）两个 key，无其它字段增删改 |
| UT-S28-36 | next schema 反面用例：固定 hint 字段缺失必须校验失败 | C7/F10；八字段锚的可执行化 | 以一份合法 next data 为基底，构造 9 个变体：逐个删除 `next_node` 的 `id`/`name`/`subflow_id`/`skill`/`working_agent`/`review_agent`/`pre_script`/`post_script`/`dispatch` 之一；另构造正例：五个 hint 字段显式为 `null` | 逐一以 `spec/schema/next.schema.json` 校验 data 实例 | 9 个删除变体**全部校验失败**（required 集含 id/name/subflow_id + 5 hint + dispatch）；hint 显式 `null` 的正例通过（`string \| null` 类型）；`modules[].next_node` 与 legacy 顶层 `next_node` 复用同一 `$defs.nextNode`，两挂载位置行为一致 |

### 场景测试用例补充
| ID | 描述 | 覆盖 | 操作 | 预期 |
|----|------|------|------|------|
| ST-S28-11 | dispatch 契约端到端 + golden 重拍 diff 收敛（提案级差异白名单） | C4/D6、R8 锚更新、D8 | 重跑全部 golden 快照（status/next/watch/flow show）并逐项复核 diff；再以消费方视角读取 `dispatch`/`requires_reviewed` | diff 必须**完整落在本提案级差异白名单内、且白名单内的必然差异必须出现**：全部 9 个用例 `data.contract` 新增；有活跃提案用例 `active_change.step_meta`/`facts` 新增；**launched 活跃提案用例 5/6/8/9 的 pre-implement `loop_state` 缺席（必须出现的差异，C2 收紧）**；next 用例 `next_node` 新增 `dispatch`（恒在）/`requires_reviewed`（声明节点）；`flow show` 新增顶层 `defaults` 与逐节点 `dispatch`/`requires_reviewed`。白名单之外逐字节零漂移；driver 可直接消费 `dispatch.idempotent` 判断重投安全、不再需要本地 allowlist |

### 覆盖度校验补充
- [ ] dispatch 数据源 = flow 节点定义（内容产出节点 idempotent:true / 落盘节点 idempotent:false）：UT-S28-31、UT-S28-32
- [ ] requires_reviewed 节点声明透传：UT-S28-32、ST-S28-11
- [ ] timeout_seconds 分级物化、唯一默认值源（fallback）：UT-S28-33
- [ ] dispatch 恒完整对象 + schema 校验通过：UT-S28-34
- [ ] 更新后 R8 锚回归（既有 8 字段不漂移、仅增两 key）：UT-S28-35、ST-S28-11
- [ ] next schema 反面用例（固定字段缺失必失败、null 正例通过）：UT-S28-36
