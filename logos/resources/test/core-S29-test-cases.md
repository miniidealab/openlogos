# S29: M2 预留收尾（loop 退出 gate 可放行 / fan-out 阈值 / loop 内整组收敛） — 测试用例

> 复用 S22/S27 临时项目 overlay 模式（`makeTempRoot` + `scaffoldProject` + 写 `root/logos/flow/<lifecycle>.yaml`）。
> A 用预写 `LOOP_ITERS` 账本构造 `escalated`、`GATE_AUTO_PASSED` 验证放行审计；B 用预写场景文件构造 `covered/total`；C 断言 loop 收敛仍以测试绿为裁判。
> 不改 `spec/flow/*.yaml`、真实 `logos/flow/`。含 OpenLogos reporter（用例名须带 `UT-S29-*` / `ST-S29-*` 供抽取）。
> **golden 零漂移**：三项全部 opt-in，builtin 不写 → `golden-baseline.test.ts` 的 status/next/watch/flow show 快照**必须不变**。

## 一、单元测试用例

| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S29-01 | set-loop 接受 exhausted_gate.skippable | overlay `set-loop implement set:{max_iters:3, exhausted_gate:{skippable:true}}` | 加载 resolved flow | 解析通过；resolved loop 含 `exhausted_gate.skippable:true` |
| UT-S29-02 | 未写 exhausted_gate → resolved 不物化、loop_state 省略字段（"默认 false" 仅消费方语义） | overlay `set-loop implement set:{max_iters:3}`（不写 exhausted_gate） | 加载 resolved flow + 派生 loop_state | resolved loop **不含** `exhausted_gate` 键（**不得**物化 `exhausted_gate:{skippable:false}`）；`loop_state` **不含** `exhausted_skippable` 键；消费方对「缺失」按 `false` 解读（"默认 false" 是消费语义，非 resolved/输出里的物化值） |
| UT-S29-03 | exhausted_gate 含未知 key → 报错 | overlay `set-loop ... set:{exhausted_gate:{skippable:true, foo:1}}` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`，message 指出非法 key |
| UT-S29-04 | exhausted_gate.skippable 非布尔 → 报错 | `set:{exhausted_gate:{skippable:"yes"}}` | 加载 resolved flow | `FLOW_SCHEMA_INVALID` |
| UT-S29-05 | set 顶层未知 key 仍报错（回归） | `set:{max_iters:3, bar:1}` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`（白名单仅 max_iters/until/exhausted_gate） |
| UT-S29-22 | exhausted_gate:{}（缺 skippable）→ 报错（skippable 必填） | `set:{max_iters:3, exhausted_gate:{}}` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`，message 指出 skippable 必填且须为 boolean |
| UT-S29-23 | exhausted_gate:null → 报错（显式 null 也 fail loud） | `set:{max_iters:3, exhausted_gate:null}` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`，message 指出 exhausted_gate 须为 { skippable:boolean } |
| UT-S29-06 | loop_state 派生 exhausted_skippable=true（仅写了 exhausted_gate 时输出） | 激活 loop（max_iters:3）+ exhausted_gate.skippable:true | 派生 loop_state | `loop_state.exhausted_skippable:true` |
| UT-S29-07 | 激活 loop 但不写 exhausted_gate → **字段省略**（不输出 false，保真零漂移） | 激活 loop（max_iters:3），不写 exhausted_gate | 派生 loop_state | `loop_state` **不含** `exhausted_skippable` 键；其余 loop_state 字段与 S27 激活-loop 逐字节一致 |
| UT-S29-08 | 未激活 loop → loop_state 整体省略 | builtin（max_iters:1） | 派生 loop_state | 整个 `loop_state` 省略；输出逐字节不变 |
| UT-S29-09 | coverage_threshold 合法解析 | fan-out 节点 `coverage_threshold:0.9` | 加载 resolved flow | 节点带 `coverage_threshold:0.9` |
| UT-S29-10 | coverage_threshold 越界 → 报错 | `coverage_threshold:1.5`（或 0、负数） | 加载 resolved flow | `FLOW_SCHEMA_INVALID` |
| UT-S29-11 | coverage_threshold 非数 → 报错 | `coverage_threshold:"high"` | 加载 resolved flow | `FLOW_SCHEMA_INVALID` |
| UT-S29-12 | 阈值达标 → fan-out 节点 done | total=10, covered=9, `coverage_threshold:0.9` | 派生 fan-out done | covered/total=0.9 ≥ 0.9 → done=true |
| UT-S29-13 | 阈值未达 → 未 done | total=10, covered=8, `coverage_threshold:0.9` | 派生 fan-out done | 0.8 < 0.9 → done=false |
| UT-S29-14 | 缺省等价 all_present | total=3, covered=2, 不写 coverage_threshold | 派生 fan-out done | 等价阈值 1.0 → done=false（与现状 all_present 一致） |
| UT-S29-15 | total==0 维持现状 | total=0，写 coverage_threshold:0.5 | 派生 fan-out done | 视为未 done（与 all_present 现状一致） |
| UT-S29-16 | 覆盖度对象结构不变 | 任意 fan-out | 派生 | `{total,covered,missing}` 字段不变；coverage_threshold 仅出现在 flow show 节点字段，status/watch/next 不新增字段 |
| UT-S29-19 | coverage_threshold 设在「合法非 all_present 谓词」节点 → 报错（fail loud） | 节点 `done_when: "marker:VERIFY_PASS"`（合法谓词、非 all_present）却写 `coverage_threshold:0.9` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`，message 指出 coverage_threshold 仅 `all_present` 适用（**不**因谓词非法而报错） |
| UT-S29-20 | coverage_threshold 设在「无 for_each 非 fan-out」节点 → 报错（fail loud） | 节点无 `for_each`、`done_when: "marker:VERIFY_PASS"`，却写 `coverage_threshold:0.9` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`，message 指出 coverage_threshold 仅 `all_present` fan-out 节点适用 |
| UT-S29-21 | coverage_threshold 设在 all_present+for_each 但 produces 为空 → 报错（fail loud） | modify 把 fan-out 节点 `produces` 改空 + `coverage_threshold:0.9` | 加载 resolved flow | `FLOW_SCHEMA_INVALID`，message 指出须 done_when:all_present + for_each + 非空 produces（防派生扫描空路径误判覆盖率） |
| UT-S29-24 | overlay-add fan-out 节点阈值达标（1/2=50% ≥ 0.5）→ done（阈值在 overlay-add 路径生效，非仅 builtin phase） | overlay add fan-out 节点 `coverage_threshold:0.5` + 写 1/2 场景文件 | `status --format json` | overlay-add 节点 `state:"done"`（复用共享 fanoutDone，与 initial phase 一致） |
| UT-S29-25 | overlay-add fan-out 节点未达阈值（0/2 < 0.5）→ 未 done（active） | 同上但 0 场景文件 | `status --format json` | overlay-add 节点 `state:"active"`（current_node 停在该节点） |
| UT-S29-17 | C·loop 收敛裁判仍是测试绿 | loop 内含 fan-out 节点 + max_iters:3 | 末轮 verify pass | `loop_state.converged` 由测试绿决定，与 fan-out 覆盖无关（整组收敛） |
| UT-S29-18 | C·不为单实例计 iteration | loop 内 fan-out，部分实例缺产出 | 派生 loop_state | 仅整组 `iteration`（=账本行数），无 per-instance 迭代字段 |

## 二、场景测试用例（ST，端到端 next --auto / status）

| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| ST-S29-01 | A·skippable:true + escalated → auto 放行 | overlay set-loop max_iters:3 + exhausted_gate.skippable:true；预写 LOOP_ITERS 3 行末行 fail（escalated） | `next --auto --format json` | `gate_id:"gate:implement:loop-exhausted"`、`skippable:true`、`gate_auto_passed:true`、`loop_state.exhausted_skippable:true`；GATE_AUTO_PASSED 追加一行；action 为 proceed |
| ST-S29-02 | A·默认（未写 exhausted_gate）→ 仍阻塞 | 同上但不写 exhausted_gate | `next --auto --format json` | `skippable:false`、`gate_auto_passed:false`、不写 GATE_AUTO_PASSED；`loop_state` **无 exhausted_skippable 键**；action 阻塞（与 S27 一致） |
| ST-S29-03 | A·skippable:true 但未达上限 → 不放行 | exhausted_gate.skippable:true；LOOP_ITERS 1 行（iteration<max_iters，未 escalated） | `next --auto --format json` | 不放行（escalated=false）；继续迭代措辞；不写 GATE_AUTO_PASSED |
| ST-S29-04 | A·默认 next（无 --auto）忽略 GATE_AUTO_PASSED | 同 ST-S29-01 已写 GATE_AUTO_PASSED | `next --format json`（无 --auto） | 不因 GATE_AUTO_PASSED 越过 gate；仍展示达上限阻塞 |
| ST-S29-08 | A·R2 安全：卡在未完成 overlay 节点（before verify, active）+ escalated + exhausted_gate.skippable:true + --auto → **不放行、不写审计** | launched + set-loop(max_iters:3, exhausted_gate.skippable:true) + add before:verify 一个 active 节点 + 预写 LOOP_ITERS 3 行 fail | `next --auto --format json` | `current_node.id=该 overlay 节点`、`state:"active"`；`gate_auto_passed:false`、`gate_id:null`；**不写 GATE_AUTO_PASSED**（gate 未到达，overlay 节点优先于 loop 达上限分支） |
| ST-S29-05 | B·阈值达标 → status 该阶段 done | **initial/adopted 单模块 fixture**（phase_progress 非 null），目标 fan-out 对应 `phase.3-1`（场景时序），overlay 设 `coverage_threshold:0.9`，预写场景文件使覆盖率 9/10=90% | `status --format json` | `modules[].phase_progress["phase.3-1"].scenario_coverage` 结构不变（`{total:10,covered:9,missing:[…]}`）；该阶段 `done:true` |
| ST-S29-06 | B·阈值未达 → 未 done | 同上 fixture，覆盖率 8/10=80%、阈值 0.9 | `status --format json` | `phase.3-1` `done:false`、`scenario_coverage.missing` 列出缺口 |
| ST-S29-07 | golden 零漂移 | 无任何 overlay（builtin） | `status`/`next`/`watch`/`flow show --resolved --format json` | 全部快照与基线逐字节一致（三项均 opt-in，builtin 不变） |
