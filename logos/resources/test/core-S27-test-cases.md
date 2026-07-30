# S27: implement(code/verify) loop 真迭代派生 — 测试用例

> 复用 S22 临时项目 overlay 模式（`makeTempRoot` + `scaffoldProject` + 写 `root/logos/flow/<lifecycle>.yaml`），通过 overlay `set-loop`(`max_iters>1`) 激活 loop。
> 不改 `spec/flow/*.yaml`、真实 `logos/flow/`、`golden-baseline.test.ts` fixture。含 OpenLogos reporter（用例名须带 `UT-S27-*` / `ST-S27-*` 供抽取）。
> `LOOP_ITERS` 账本可直接预写到 launched 提案目录（`logos/changes/<slug>/LOOP_ITERS`）或 initial `logos/resources/verify/LOOP_ITERS` 构造各轮次状态；verify 写账本用例真实跑 `openlogos verify` 后断言账本行。

## 一、单元测试用例
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S27-01 | 未绿 & iteration<max → 续迭代措辞 + loop_state 正确 | overlay set-loop max_iters:3；账本 1 行 result:fail | `next --format json` | `loop_state{iteration:1,max_iters:3,converged:false,escalated:false}`；detail 含「第 1/3 轮未绿 → 修复后重跑 verify」；current 钉在 implement verify、未推进 |
| UT-S27-02 | 达上限 → escalated:true + 升级 gate | max_iters:2；账本 2 行均 fail | `next --format json` | `loop_state{iteration:2,converged:false,escalated:true}`；`gate_id:"gate:implement:loop-exhausted"`、`skippable:false`；升级人类确认点 |
| UT-S27-03 | escalated + `--auto` 仍阻塞、不写 GATE_AUTO_PASSED | 同 UT-S27-02 | `next --auto --format json` | 照常阻塞、输出 `gate_id`/`skippable:false`、不 auto-pass；磁盘无新增 `GATE_AUTO_PASSED` 行 |
| UT-S27-04 | 末轮 pass → converged:true 出环续推 | max_iters:3；账本末行 result:pass | `next --format json` | `loop_state{converged:true}`；出环、current 续推到下一节点（deliver/archive） |
| UT-S27-05 | 【R2】initial 激活 verify FAIL（report 已写）仍不推进 | initial overlay set-loop max_iters:2；`acceptance-report.md` 存在；账本 1 行 fail | `status --format json` | converged 覆盖 done_when：implement/verify 视为未完成、不推进到 deploy/launch；`modules[].loop_state.converged:false` |
| UT-S27-06 | 【R3】verify 激活 + 算出 gate 结果 → 写 LOOP_ITERS、result 取最终 gate.result | overlay set-loop max_iters:3；测试结果 FAIL | `verify` | 账本新增 1 行 `{iter,node:"verify",result:"fail",module,timestamp}`；`result` == 最终 `data.gate.result` |
| UT-S27-07 | 【R3】未激活（builtin max_iters:1）→ verify 不写账本 | 无 set-loop overlay | `verify` | 无 `LOOP_ITERS` 文件 / 无新增行（零副作用，保旧行为） |
| UT-S27-08 | 【R3】配置类早退（NO_TEST_RESULTS）→ 不计迭代、不写账本 | overlay set-loop max_iters:3；无 test-results | `verify` | `process.exit(1)`、`NO_TEST_RESULTS`；账本无新增行 |
| UT-S27-09 | 【R11】iter = 同 module 已有行数+1（按 module 过滤计数） | initial 账本含其他 module 行 + 本 module 1 行；激活本 module | `verify`（本 module FAIL） | 新行 `iter` = 本 module 已有行数+1（非整文件总行数），不串号 |
| UT-S27-10 | 【R4】收敛后再 FAIL → marker 被清、implement 重开、converged 转 false | 账本末行 pass（converged）→ 修改后 verify FAIL | `verify` 再 `next --format json` | `VERIFY_PASS`/`DEPLOY_DONE`/`SMOKE_PASS`/`SMOKE_FAIL` 被清；账本续写 fail 行；`loop_state.converged:false`；implement loop 重新打开 |
| UT-S27-11 | 【R5】initial 账本带 module、派生按 module 过滤 | initial `logos/resources/verify/LOOP_ITERS` 含 modA/modB 混合行 | `status --format json`（modA 上下文） | modA 的 `iteration` 仅计 modA 行；modB 行不混算 |
| UT-S27-12 | 【R7】initial 多模块 set-loop(max_iters>1) → 不激活 | initial 多模块；overlay set-loop max_iters:3 | `verify` + `next --format json` | verify 不写 `LOOP_ITERS`；输出**不含** `loop_state`；派生退化为旧行为 |
| UT-S27-13 | 【R10】escalated 时 proposal_step 仍既有枚举、不新增 loop-exhausted | launched；账本达上限均 fail | `next --format json` | `proposal_step` ∈ 既有 13 值（如 `ready-to-verify`/`verify-failed`）；**无** `loop-exhausted` step；达上限仅由 `loop_state.escalated`+`gate_id` 表达 |
| UT-S27-14 | 【R9】set 含未知 key → FLOW_SCHEMA_INVALID | overlay set-loop set:{max_iters:3, exhausted_gate:{...}} | 派生 | `FLOW_SCHEMA_INVALID`；未知 key 不静默保留、不进 resolved flow |
| UT-S27-15 | 【R9】max_iters<1 / 非整数 → FLOW_SCHEMA_INVALID | set-loop max_iters:0（及 0.5） | 派生 | `FLOW_SCHEMA_INVALID` |
| UT-S27-16 | 【R9】until 非 tests_green → FLOW_SCHEMA_INVALID | set-loop set:{until:"review_ok"} | 派生 | `FLOW_SCHEMA_INVALID` |
| UT-S27-17 | set-loop 非法 subflow / 缺 set → FLOW_SCHEMA_INVALID | set-loop subflow:"nope" 或缺 set | 派生 | `FLOW_SCHEMA_INVALID` |
| UT-S27-18 | 【R6】loop_state 挂载位置同构 | 有 modules[] 项目（激活） | `next --format json` | `loop_state` 挂 `modules[].loop_state`（next 同步 `next.modules[].loop_state`）；legacy 无 modules 才顶层 fallback |
| UT-S27-19 | status/watch 读账本展示 loop_state、只读不执行 | 激活；账本若干行 | `status` / `watch`（初次 tick） | 如实输出 `loop_state`、不写文件、不跑测试、无副作用；watch 显示环进度 |
| UT-S27-20 | 未激活项目 status/next/watch loop_state 省略 | 无 set-loop overlay（builtin max_iters:1） | `status`/`next`/`watch --format json` | 输出**不含** `loop_state` key（golden 零漂移前置） |

## 二、场景测试用例
| ID | 描述 | 覆盖 Steps | 操作 | 预期 |
|----|------|-----------|------|------|
| ST-S27-01 | 未绿续迭代端到端 | 写入侧 + 求值侧（!converged & iteration<max） | set-loop max_iters:3 → verify(FAIL) → `next` | 账本+1 行 fail；next 提示「第 N/3 轮未绿 → 修复后重跑 verify」；未推进 |
| ST-S27-02 | 达上限升级 gate 端到端 | escalated + --auto 阻塞 | 迭代至 iteration>=max 仍 fail → `next` / `next --auto` | `escalated:true`；`gate:implement:loop-exhausted`、`skippable:false`；`--auto` 仍卡、不写 `GATE_AUTO_PASSED` |
| ST-S27-03 | 收敛出环续推端到端 | converged 出环 | 末轮 verify(PASS) → `next` | `converged:true`；出环续推到下一节点 |
| ST-S27-04 | 【R2】initial 激活 FAIL 不被 report 误判 | converged 覆盖 done_when | initial set-loop；verify FAIL（report 已写）→ `status`/`next` | 不推进到 deploy/launch；钉在 implement verify |
| ST-S27-05 | 【R4】收敛后再 FAIL 状态回退 | 回退契约 | converged → 改代码 → verify(FAIL) → `next` | marker 被清；converged 转 false；implement loop 重开；账本续写 |
| ST-S27-06 | 【Q3】统一引擎 — initial implement 激活一例 | 统一引擎 initial | initial set-loop max_iters:3 走未绿/收敛 | initial 账本写 `logos/resources/verify/LOOP_ITERS`（带 module）、派生 `loop_state` 正确 |
| ST-S27-07 | 【Q3】统一引擎 — launched implement 激活一例 | 统一引擎 launched | launched set-loop max_iters:3 走未绿/收敛 | launched 账本写 `logos/changes/<slug>/LOOP_ITERS`、派生 `loop_state` 正确；不读 initial 账本 |
| ST-S27-08 | 无激活项目 golden 零漂移 | 安全红线 | 同 golden fixture 无 set-loop | `status`/`next --format json`/`watch` 与 golden 锚点逐字节一致；`golden-baseline.test.ts` 全绿 |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 操作 | 预期 |
|----|------|----------|------|------|
| ST-S27-EX-1 | 配置类早退不计迭代 | EX-1 | 激活但 NO_TEST_RESULTS/NO_TEST_CASES | `process.exit(1)`；账本无新增行 |
| ST-S27-EX-2 | set-loop 各非法 schema | EX-2 | 未知 set key / max_iters<1/非整数 / until 非法 / 非法 subflow / 缺 set | 各 `FLOW_SCHEMA_INVALID`、不进 resolved flow |
| ST-S27-EX-3 | initial 多模块 set-loop 不激活 | EX-3 | initial 多模块 set-loop max_iters>1 | 不写账本、不输出 `loop_state`、退化旧行为 |

## 四、覆盖度校验清单
- [x] 未绿续迭代措辞 + loop_state：UT-S27-01、ST-S27-01
- [x] 达上限 escalated + 升级 gate（gate_id / skippable:false）：UT-S27-02、ST-S27-02
- [x] escalated --auto 仍卡、不写 GATE_AUTO_PASSED：UT-S27-03、ST-S27-02
- [x] 末轮 pass converged 出环续推：UT-S27-04、ST-S27-03
- [x] 【R2】initial 激活 FAIL（report 已写）仍不推进（converged 覆盖 done_when）：UT-S27-05、ST-S27-04
- [x] 【R3】verify 仅激活+算出 gate 结果写账本、result 取最终 gate.result；未激活/配置早退不写：UT-S27-06、UT-S27-07、UT-S27-08、ST-S27-EX-1
- [x] 【R11】iter=同 module 已有行数+1（不串号）：UT-S27-09
- [x] 【R4】收敛后再 FAIL → marker 清、implement 重开、converged 转 false：UT-S27-10、ST-S27-05
- [x] 【R5】initial 账本带 module、按 module 过滤：UT-S27-11
- [x] 【R7】initial 多模块 set-loop 不激活：UT-S27-12、ST-S27-EX-3
- [x] 【R10】escalated 时 proposal_step 仍既有枚举、不新增 loop-exhausted：UT-S27-13
- [x] 【R9】set 未知 key / max_iters<1/非整数 / until 非法 / 非法 subflow/缺 set → FLOW_SCHEMA_INVALID：UT-S27-14~17、ST-S27-EX-2
- [x] 【R6】loop_state 挂载同构（modules[] / legacy 顶层 fallback）：UT-S27-18
- [x] status/watch 只读展示 loop_state、不执行：UT-S27-19
- [x] 【Q3】统一引擎 initial + launched 各一例：ST-S27-06、ST-S27-07
- [x] golden 零漂移（无激活逐字节不变）：UT-S27-20、ST-S27-08

## 五、change-flow-redesign 增量（激活源 / until 枚举 / golden 订正）

change-flow-redesign 让内置 launched `implement` 携带默认 loop 定义（`max_iters:30` + `until:code_slices_green`）；contract-self-description（C2/D4）进一步收紧激活时机：`loop_state` 挂出 **iff** `code_required ∧ spec_complete ∧ slices_planned ∧ slices_approved`（与 `facts` 同一份计算），launched flow 含 loop 定义**不再等于常驻输出**。对本场景既有用例做如下订正与补充（切片专属用例见 S31 测试）：

**订正既有用例（语义随激活时机收紧再次变化）**：
- **UT-S27-07 / UT-S27-20 / ST-S27-08（"builtin `max_iters:1` 不激活 / golden 零漂移"）**：其"未激活 → 不写账本 / 不输出 `loop_state`"的断言对 `initial.yaml` implement 与未激活项目成立；launched 项目**不再断言 `loop_state` 常驻输出**——仅当四事实（`code_required ∧ spec_complete ∧ slices_planned ∧ slices_approved`）齐备时输出，其余驻留态（writing / spec / ready-to-implement 等）省略该字段（见新增 UT-S27-26~31）。`slice_state` 常驻口径**不变**（其激活判据与 `loop_state` 在 spec 中分别写明）。launched 活跃提案 golden 基线随 contract-self-description 重拍。
- **既有 loop 激活类用例（UT-S27-01~06、UT-S27-09~11、UT-S27-13、UT-S27-18~19、ST-S27-01~05、ST-S27-07 等）**：断言本身不变，但其 launched fixture 前置须补齐四事实（预写 `SPEC_MERGED`、脱模板 `[code]`、`SLICES_APPROVED` marker），否则新语义下 `loop_state` 不挂出。
- **UT-S27-16（"until 非 `tests_green` → `FLOW_SCHEMA_INVALID`"）**：`until` 合法枚举扩为 `tests_green | code_slices_green`；非法例改用其它值（如 `until:"review_ok"`）。新增合法性断言见下。

**新增用例**：
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S27-21 | until=code_slices_green 合法、loader 接受 | set-loop set:{until:"code_slices_green", max_iters:3} 或 builtin launched 默认 | resolved flow 加载 | 不报错；resolved loop.until == "code_slices_green" |
| UT-S27-22 | builtin launched implement 四事实齐备时挂 loop_state（无需 set-loop） | launched 提案、无 overlay；`SPEC_MERGED` + `[code]` 脱模板 + `SLICES_APPROVED` 在场、`code_required=true` | `status --format json` | `modules[].loop_state` 存在（`until:"code_slices_green"`、`max_iters:30`）；**全新提案（writing 驻留态）不挂**（见 UT-S27-26） |
| UT-S27-23 | initial.yaml implement 仍 max_iters:1、不默认激活 | initial 单/多模块、无 overlay | `status`/`next --format json` | 不输出 `loop_state`，行为与重拍前一致 |

**覆盖度补充**：
- [x] until 枚举放开 code_slices_green（合法）+ 非法仍报错：UT-S27-21、UT-S27-16
- [x] launched 四事实齐备才激活、initial 不默认激活：UT-S27-22、UT-S27-23、UT-S27-26~31
- [x] launched golden 重拍、initial 仍零漂移：UT-S27-20（订正）、UT-S27-23

## 四、retry / loop exhausted 边界回归

| ID | 用例 | 前置条件 | 操作 | 期望 |
|---|---|---|---|---|
| UT-S27-24 | 有产物但全量回归失败不计为 no progress | dispatch 写入合法 artifact 与 reporter pass；全量 verify failed | 派生 loop / retry 诊断 | 输出 `slice_done_global_verify_failed`，不输出 `no-progress` |
| UT-S27-25 | 真正无产物才消耗 retry exhausted 路径 | 连续 dispatch 无 artifacts、无 reporter、无状态变化 | 派生 retry 诊断 | 输出 `no-progress`，达到上限后才 `retry-exhausted` |
| ST-S27-09 | repair 后失败列表变化视为有进展 | 第一轮 verify failed A；repair 后 verify failed B，失败列表变化 | 派生 loop_state | 不升级 hard block；继续 repair/code |

### 覆盖度校验

- [ ] 有产物全量红不是 no progress：UT-S27-24
- [ ] 无产物无进展才 retry exhausted：UT-S27-25
- [ ] repair 失败列表变化算进展：ST-S27-09

## 六、loop_state 激活时机边界用例（contract-self-description，D4）

> 验证 C2/D4：`loop_state` 出现 iff `code_required ∧ spec_complete ∧ slices_planned ∧ slices_approved`；
> `activated_at` 读自结构化 `SLICES_APPROVED` marker（D5）；旧空 marker 兼容省略；docs-only 永不挂。
> 拍板原则（D10）：宁慢勿错杀——驻留态缺席 `loop_state` 时消费方走普通推进，不得据此判死。

### 单元测试用例补充
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S27-26 | writing 驻留态不挂 loop_state | launched 提案刚创建（proposal_step=writing）、无 `SPEC_MERGED` | `status`/`next --format json` | 输出**不含** `loop_state` key；`facts.spec_complete:false` |
| UT-S27-27 | spec 阶段（delta 已写、未 merge）不挂 loop_state | `[delta]` 全勾、无 `SPEC_MERGED`（ready-to-merge / delta-writing 各一构造） | `status --format json` | 两驻留态均不含 `loop_state`；`step_meta`/`facts` 照常输出 |
| UT-S27-28 | ready-to-implement（已规划、待 slice-exit 批准）不挂 loop_state | `SPEC_MERGED` + `[code]` 脱模板、无 `SLICES_APPROVED` | `status`/`next --format json` | 不含 `loop_state`；`facts.slices_planned:true`、`facts.slices_approved:false`；`slice_state` 照常输出（常驻口径不变） |
| UT-S27-29 | 四事实齐备后挂出、activated_at 读自结构化 marker | `code_required=true` + `SPEC_MERGED` + `[code]` 脱模板 + 结构化 `SLICES_APPROVED`（JSON 单行、含 `approved_at`） | `status --format json` | `loop_state` 存在；`loop_state.activated_at` == marker 的 `approved_at`（ISO 8601）；同一磁盘状态重复派生结果逐字节一致（确定性） |
| UT-S27-30 | 旧空 SLICES_APPROVED marker → loop_state 挂出但省略 activated_at | 四事实齐备、`SLICES_APPROVED` 为旧格式空文件 | `status --format json` | `loop_state` 存在（旧空 marker 兼容视为已批准）；输出**不含** `activated_at` 字段 |
| UT-S27-31 | docs-only 提案永不挂 loop_state | 纯 `[delta]` 提案（`code_required=false`）、`SPEC_MERGED` 在场；launched flow 恒含 loop 定义 | 全流程各步 `status`/`next --format json` | 任一步骤均不含 `loop_state`；不因 launched flow 含 loop 定义而挂出 |
| UT-S27-32 | until 闭合双值与 converged 分支求值（code_slices_green 不提前出环） | 四事实齐备（loop_state 已挂出） | 构造两例：(a) `[code]` 尚有未勾切片、末轮 verify 绿；(b) `[code]` 全勾、末轮绿。另以 schema 校验 until 值域 | `status --format json` + `spec/schema/status.schema.json` | (a) `converged:false`（`code_slices_green` = `section_complete:code ∧ tests_green`，切片未全勾时即便末轮绿也不出环，S31 FAIL-safe）；(b) `converged:true`；schema 锁定 `until ∈ {"tests_green","code_slices_green"}` 闭合双值，builtin launched 输出 `"code_slices_green"` 合法过校验 |

### 场景测试用例补充
| ID | 描述 | 覆盖 | 操作 | 预期 |
|----|------|------|------|------|
| ST-S27-10 | 激活时机端到端：驻留态一路不挂、slice-exit 消费后才挂 | C2/D4 边界 | 同一 launched 提案依次走 writing → delta 全勾 → merge（写 `SPEC_MERGED`）→ 填 `[code]` 脱模板 → `next --auto` 消费 slice-exit；每步执行 `status --format json` | `SLICES_APPROVED` 写入前所有步骤均无 `loop_state`；写入后 `loop_state{iteration:0, converged:false}` 出现且 `activated_at` == marker 时间戳；再次 `next --auto` 不刷新 `activated_at`（marker 已存在不重写） |

### 覆盖度校验补充
- [ ] writing / spec / ready-to-implement 各驻留态不挂：UT-S27-26、UT-S27-27、UT-S27-28、ST-S27-10
- [ ] 四事实齐备后挂 + activated_at 读自结构化 marker：UT-S27-29、ST-S27-10
- [ ] 旧空 marker 兼容（挂出但省略 activated_at）：UT-S27-30
- [ ] docs-only（code_required=false）永不挂：UT-S27-31
- [ ] slice_state 常驻口径不变：UT-S27-28
