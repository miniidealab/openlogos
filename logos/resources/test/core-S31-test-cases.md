# S31: 代码切片循环（implement 默认逐片实现到全部切片完成且测试绿） — 测试用例

> 复用 S27 临时项目模式（`makeTempRoot` + `scaffoldProject`）。切片清单 = `tasks.md` `[code]`；`LOOP_ITERS` 可预写到 `logos/changes/<slug>/LOOP_ITERS` 构造各轮次。含 OpenLogos reporter（用例名带 `UT-S31-*` / `ST-S31-*`）。

## 一、单元测试用例
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S31-01 | builtin launched implement 默认 until=code_slices_green、max_iters=30 | 无 overlay 的 launched flow | `loadBuiltinFlow("launched")` | implement subflow `loop:{until:"code_slices_green", max_iters:30}` |
| UT-S31-02 | slice_state 计数（部分勾选） | `[code]` 7 行、勾 3 | `status --format json` | `slice_state{total:7, done:3, current:<第4行标题>, remaining:4}` |
| UT-S31-03 | slice_state 全勾 → 省略 current | `[code]` 全勾 | `status --format json` | `slice_state{total,done==total,remaining:0}`，无 `current` |
| UT-S31-04 | code_slices_green 收敛 = section_complete:code ∧ tests_green | `[code]` 全勾、账本末行 pass | `next --format json` | `loop_state.converged:true`；implement 出环续推 |
| UT-S31-05 | [code] 未全勾即便末轮绿也不收敛（FAIL-safe） | `[code]` 未全勾、账本末行 pass | `next --format json` | `converged:false`；不推进到 deliver/close；next_node 钉 code |
| UT-S31-06 | 末轮 fail 即便 [code] 全勾也不收敛 | `[code]` 全勾、账本末行 fail | `next --format json` | `converged:false`；继续迭代措辞 |
| UT-S31-07 | 空 [code] 退化为 tests_green | 无 `[code]` 或切片数 0、账本末行 pass | `next --format json` | `converged:true`（按 tests_green）；不因无切片卡死；`slice_state{total:0,...}` |
| UT-S31-08 | next 选第一个未勾切片 + slice 子提示 | `[code]` 勾 2、未收敛未达上限 | `next --format json` | `next_node.id=="code"`、`next_node.slice==<第3行标题>` |
| UT-S31-09 | slice 提示指"未建"切片（非"修哪片"） | 后片打断先片、全量 verify fail | `next --format json` | `next_node.slice` 仍指第一个未勾行；不指向已勾的回归源 |
| UT-S31-10 | LOOP_ITERS 可带 slice 字段 | 激活切片循环、verify 一次 | `verify` | 账本新增行含可选 `slice` 字段（激活时写、未激活省略）|
| UT-S31-11 | 达 max_iters 未达成 → escalated + loop-exhausted（skippable:false） | `[code]` 未全勾、账本 30 行未收敛 | `next --format json` | `escalated:true`、`gate_id:"gate:implement:loop-exhausted"`、`skippable:false` |
| UT-S31-12 | escalated + --auto 默认仍阻塞不写审计 | 同 UT-S31-11 | `next --auto --format json` | 阻塞、不 auto-pass、磁盘无新增 GATE_AUTO_PASSED（除非 overlay 覆盖 exhausted_gate.skippable）|
| UT-S31-13 | initial 多模块不激活切片循环 | initial 多模块 | `status`/`next --format json` | 不输出 `slice_state`/`loop_state`、退化旧行为 |
| UT-S31-14 | slice_state 仅激活时输出（省略规则） | 未激活项目（initial / 非默认） | `status --format json` | 输出**不含** `slice_state` key |

## 二、场景测试用例
| ID | 描述 | 覆盖 | 操作 | 预期 |
|----|------|------|------|------|
| ST-S31-01 | 逐片推进端到端 | 选片→code→verify→勾片→下一片 | `[code]` 3 片，逐片 verify(PASS) + 勾选 | 每轮 `next` 指向下一未勾片；全部勾选且末轮绿后出环续推 |
| ST-S31-02 | 中途某片不绿 → 同片继续迭代 | 未收敛未达上限 | 第 2 片 verify(FAIL) | `next` 提示继续迭代、`slice_state.current` 仍指该片、不推进 |
| ST-S31-03 | 全部完成且测试绿出环 | converged | 全部片勾选 + 末轮 verify(PASS) | `converged:true`、出环到 deliver/close |
| ST-S31-04 | 达上限升级退出门 | escalated | 迭代至 max_iters 仍有未勾/未绿 | `gate:implement:loop-exhausted`、`skippable:false`、`--auto` 仍卡 |
| ST-S31-05 | 空 [code] 提案不被卡死 | 退化 tests_green | 纯 delta 提案（无 [code]）走 implement | 按 tests_green 收敛出环 |
| ST-S31-06 | 全量回归把关（局部绿全局红不出环） | verify 全量 | 第 3 片实现破坏第 1 片、全量 verify(FAIL) | `tests_green:false` → `converged:false` → 不出环（即便 [code] 全勾）|

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 操作 | 预期 |
|----|------|----------|------|------|
| ST-S31-EX-1 | initial 多模块 set-loop/默认均不激活 | EX-3.2 | initial 多模块 | 不写账本/不输出 slice_state、退化旧行为 |
| ST-S31-EX-2 | 配置类早退不计迭代 | 复用 S27 EX-1 | 激活但 NO_TEST_RESULTS | `process.exit(1)`、账本无新增行 |

## 四、覆盖度校验清单
- [x] builtin launched 默认激活（until/max_iters）：UT-S31-01、UT-S31-02
- [x] slice_state 计数 / 全勾省略 current / 省略规则：UT-S31-02、UT-S31-03、UT-S31-14
- [x] code_slices_green 复合收敛 + FAIL-safe（未全勾/末轮 fail 不收敛）：UT-S31-04、UT-S31-05、UT-S31-06、ST-S31-03
- [x] 空 [code] 退化 tests_green：UT-S31-07、ST-S31-05
- [x] 切片选取 + slice 子提示（建哪片非修哪片）：UT-S31-08、UT-S31-09、ST-S31-01、ST-S31-02
- [x] LOOP_ITERS slice 维度：UT-S31-10
- [x] 达上限升级 + --auto 阻塞：UT-S31-11、UT-S31-12、ST-S31-04
- [x] 全量回归把关：ST-S31-06
- [x] initial 多模块不支持：UT-S31-13、ST-S31-EX-1

## 五、本提案影响说明：ready-to-delta 与切片循环

本提案不改变 S31 的切片循环收敛模型：`[code]` section 的每个未勾行仍是一个代码切片，`slice_state.total/done/current/remaining` 的派生规则不变，`code_slices_green = section_complete:code ∧ tests_green` 不变。

本提案只修复 `ready-to-delta` 的 `plan-exit` auto 放行固定点：`next --auto` 写入 `PLAN_APPROVED` 后，提案前沿进入 `delta-writing` / `write-delta`。这发生在 `spec.write-delta` 之前，不进入 S31 的 `implement` loop，因此不需要新增 S31 默认 next 行为测试。

对“切片评分机制”的回归要求落在 Skill 生成规则与本提案任务清单：小修复应保持单个 `[code]` 条目，从而 `slice_state.total==1`。若后续为 Skill 规则新增自动化测试，应放在 change-writer / code-implementor 的生成规则测试中，而不是修改 S31 的 loop 收敛契约。

## 补充：未规划切片不得进入 implement loop

本提案不改变 S31 的 implement loop 收敛模型：`code_slices_green = section_complete:code ∧ tests_green`、`slice_state` 计数、逐片 `next_node.slice`、达上限 `loop-exhausted` 等语义全部保持不变。

本提案只在 S31 之前补强 slice 阶段门禁：当 launched 提案处于 `ready-to-implement` 且 `[code]` 未 `tasks_code_filled` 时，`next --auto` 不得写入 `SLICES_APPROVED`，不得派生 `coding`，因此不应进入 implement loop。若实现或下游 driver 在空 `[code]` / 模板 `[code]` 状态下进入 `code` / verify-repair 循环，应视为 S24/S32 前置门禁失败，而不是 S31 收敛模型的合法退化路径。

S31 既有 “空 `[code]` 退化为 `tests_green`” 仅适用于无代码产出需求或 `[code]` section 缺失的纯文档/退化 implement 场景，不适用于 `code_required==true` 且等待 slice-planner 写切片的模板态 `[code]`。

## 六、smoke 用例变更下的切片闭环测试

### 一、单元测试用例补充
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S31-SMOKE-01 | `[code]` 切片描述必须携带新增 SMOKE ID | tasks.md `[code]` 行对应 smoke delta | change-writer output | 切片文本列出 `SMOKE-*`，并包含 runner/reporter/dispatcher 交付要求 |
| UT-S31-SMOKE-02 | smoke 覆盖预检未过时切片不得勾选 | 新增 smoke ID，runner/reporter 缺失 | code completion check | 该 `[code]` 行保持 `[ ]`，返回 smoke 覆盖诊断 |

### 二、场景测试用例补充
| ID | 描述 | 覆盖 | 操作 | 预期 |
|----|------|------|------|------|
| ST-S31-SMOKE-01 | 含 smoke 用例的切片完整闭环后才进入下一片 | 选片→code→verify→smoke precheck→勾片 | 第 1 片新增 `SMOKE-DRV-SMOKE-01`，实现业务代码、UT/ST、verify reporter、smoke runner/reporter/dispatcher 后执行预检 | 预检通过后才勾选第 1 片；下一次 `next` 指向第 2 个未勾切片 |

### 三、覆盖度校验补充
- [x] smoke 切片任务描述完整：UT-S31-SMOKE-01
- [x] smoke 覆盖预检阻止误勾切片：UT-S31-SMOKE-02
- [x] smoke 切片端到端闭环：ST-S31-SMOKE-01

## 七、切片子任务 checkbox 测试

### 一、单元测试用例补充
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S31-15 | 缩进子任务 checkbox 不参与顶层切片计数 | `[code]` 2 个顶层切片；第 1 片下有 3 个缩进 checkbox | `deriveSliceState` / `status --format json` | `slice_state.total==2`；缩进 checkbox 不增加 total；`current` 指向第一个未完成父切片 |
| UT-S31-16 | 父切片已勾但子任务未全勾时不计 done | 第 1 个父切片 `[x]`，其下仍有一个缩进子任务 `[ ]` | `deriveSliceState` / `next --format json` | `done` 不包含该父切片；`current` 仍为该父切片；`current_unchecked_children` 包含未勾子任务 |
| UT-S31-17 | next_node 输出当前切片子任务 | loop 激活、未收敛、当前父切片下有缩进 checkbox | `next --format json` | `next_node.id=="code"`、`next_node.slice==slice_state.current`、`next_node.slice_children==slice_state.current_children` |
| UT-S31-18 | 无缩进 checkbox 时保持既有输出兼容 | `[code]` 仅顶层切片，无缩进 checkbox | `status` / `next --format json` | `slice_state.total/done/current/remaining` 与既有行为一致；可省略 `current_children` / `next_node.slice_children` |

### 二、场景测试用例补充
| ID | 描述 | 覆盖 | 操作 | 预期 |
|----|------|------|------|------|
| ST-S31-07 | 父切片与子任务全部完成后才推进下一片 | 选片→子任务勾选→verify→父切片勾选→下一片 | `[code]` 2 个父切片，第 1 片下有 3 个子任务；先只勾父切片不勾完子任务，再补齐子任务并 verify(PASS) | 子任务未全勾时仍停在第 1 片；补齐子任务和父切片且全量 verify 绿后，下一次 `next` 指向第 2 个父切片 |

### 三、覆盖度校验补充
- [x] 缩进子任务不参与顶层切片计数：UT-S31-15
- [x] 父切片已勾但子任务未全勾不计 done：UT-S31-16、ST-S31-07
- [x] `slice_state.current_children` / `current_unchecked_children` / `next_node.slice_children` 输出：UT-S31-17
- [x] 既有无子任务切片兼容：UT-S31-18

## 八、空 [code] 退化边界测试（代码必需态不得进入 loop）

> 以下用例含 OpenLogos reporter。用例名必须带 `UT-S31-19` / `ST-S31-08` 等 ID，供 verify 抽取覆盖。

### 8.1 单元测试用例补充

| ID | 描述 | 前置 | 输入 | 预期 |
|---|---|---|---|---|
| UT-S31-19 | 空 `[code]` 退化仅适用于 `code_required=false` | 两组提案：A 明确纯文档、无实现相关测试 delta；B proposal/delta 推导 `code_required=true` 但缺失 `[code]` | `next --format json` / slice_state 派生 | A 可按 tests_green 退化；B 不进入 S31 loop，前沿必须停 `plan-slices` |
| UT-S31-20 | 需要代码但切片缺失时不输出 verify repair 前沿 | `SPEC_MERGED` 在场、`code_required=true`、`tasks.md` 缺失 `[code]`、末轮测试账本不存在或失败 | `next --format json` | 不返回 `next_node.id=="verify"`；不返回 `next_node.id=="code"`；不输出可驱动 `_loopRepair()` 的前沿 |

### 8.2 场景测试用例补充

| ID | 描述 | 覆盖 | 操作 | 期望 |
|---|---|---|---|---|
| ST-S31-08 | 新增测试规格但未规划切片时不得按空 `[code]` 收敛 | S31 与 S32 边界 | 构造已 merge 的代码级提案，测试 delta 新增 UT/ST，`tasks.md` 缺失 `[code]`，账本末轮 pass | 派生仍停 `ready-to-implement` / `plan-slices`；不得因 tests_green pass 把空 `[code]` 视为收敛并进入 verify/deliver |

### 8.3 覆盖度校验补充

- [ ] 空 `[code]` 退化只适用于明确无需代码：UT-S31-19
- [ ] 代码必需但切片缺失时不输出 code/verify repair 前沿：UT-S31-20、ST-S31-08

## 五、slice-local done 与 global verify failed 分离

| ID | 用例 | 前置条件 | 操作 | 期望 |
|---|---|---|---|---|
| UT-S31-21 | slice-local done 不被全量 verify failed 否定 | 当前切片 artifacts、UT/ST、reporter 完整且 focused pass；全量 verify failed | 派生切片完成诊断 | `completion_state="slice_done_global_verify_failed"`；不输出 `claimed-done-but-unverified` |
| UT-S31-22 | focused tests 缺失时才判切片未完成 | 当前切片缺 reporter 或 required test ID | 派生切片完成诊断 | `completion_state="slice_incomplete"`，reason 为 `reporter-missing` 或 `focused-tests-missing` |
| ST-S31-09 | 全量失败驱动 repair，保留本片完成证据 | 切片完成后全量失败，failed tests 非空 | `next --auto --format json` | `suggested_next_node="code"`；`validated_artifacts` 保留；`missing_artifacts` 为空 |

### 覆盖度校验

- [ ] slice-local done 与 global verify failed 同时成立：UT-S31-21
- [ ] 切片未完成只由本片缺证据触发：UT-S31-22
- [ ] 全量失败进入 repair 且保留完成证据：ST-S31-09

## 十、global verify failed repair 前沿边界测试

> 以下用例含 OpenLogos reporter。用例名必须带 `UT-S31-23` / `ST-S31-10` 等 ID，供 verify 抽取覆盖。

### 10.1 单元测试用例补充

| ID | 描述 | 前置 | 输入 | 预期 |
|---|---|---|---|---|
| UT-S31-23 | `ready-to-merge` 不消费 S31 全量失败 repair | `[delta]` 全勾、处于 `ready-to-merge`；历史全量 verify failed 且 failed tests 非空 | `next --auto --format json` | 不进入 S31 repair；保留 merge command |
| UT-S31-24 | `ready-to-implement` 未规划切片不进入 S31 repair | `SPEC_MERGED` 在场、`code_required=true`、`[code]` 缺失或模板态；历史全量 verify failed | `next --auto --format json` | 前沿保持 `plan-slices`；不输出 `suggested_next_node=="code"` |
| UT-S31-25 | `coding` / `verify-failed` 保留全量失败 repair | `[code]` 已规划并经 `SLICES_APPROVED` 放行；当前全量 verify failed | `next --auto --format json` | 输出 `completion_state=="slice_done_global_verify_failed"` 或等价诊断；`suggested_next_node=="code"`；保留 `failed_tests` |

### 10.2 场景测试用例补充

| ID | 描述 | 覆盖 | 操作 | 期望 |
|---|---|---|---|---|
| ST-S31-10 | 全量失败只在 implement loop 中驱动 repair | S31 与 S24/S28 边界 | 用同一失败证据分别构造 `ready-to-merge`、未规划切片 `ready-to-implement`、`coding` | 分别执行 `next --auto --format json` | 前两者不进入 repair；`coding` 输出 repair/code 前沿 |

### 10.3 覆盖度校验补充

- [ ] `ready-to-merge` 不消费全量失败 repair：UT-S31-23
- [ ] 未规划切片不消费全量失败 repair：UT-S31-24
- [ ] `coding` / `verify-failed` 仍可触发 repair：UT-S31-25、ST-S31-10

## 十一、slice-exit 批准与 loop_state 激活边界回归（contract-self-description，D4）

> 验证 C2/D4 在 S31 侧的边界：slice-exit 门未批准（`SLICES_APPROVED` 不在场）时**不进入
> implement loop**、不挂 `loop_state`；`SLICES_APPROVED` 写入后才挂出并进入逐片循环。
> 这是 loop 劫持 bug（driver 在 pre-implement 驻留态读到 `loop_state` 而假 blocked）的直接回归锚。

### 单元测试用例补充
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S31-26 | slice-exit 未批准不进 implement loop | launched、`SPEC_MERGED` 在场、`[code]` 已脱模板（未勾）、`code_required=true`、**无** `SLICES_APPROVED` | `status`/`next --format json` | 输出**不含** `loop_state`；`proposal_step=="ready-to-implement"`；`next_node.gate_id=="slice-exit"`；不派生 `coding`、不进入逐片循环；`slice_state` 照常输出（常驻口径不变） |
| UT-S31-27 | SLICES_APPROVED 写入后才挂 loop_state 并进入逐片循环 | 同 UT-S31-26 的磁盘状态 + 写入结构化 `SLICES_APPROVED`（含 `approved_at`） | `status`/`next --format json` | `loop_state{iteration:0, converged:false}` 出现、`activated_at`==marker 的 `approved_at`；`proposal_step=="coding"`、`next_node.id=="code"`、`next_node.slice` 指第一个未勾片（S31 既有选片语义不变） |

### 场景测试用例补充
| ID | 描述 | 覆盖 | 操作 | 预期 |
|----|------|------|------|------|
| ST-S31-11 | slice-exit 放行前后 loop_state 边界端到端 | S31 与 S32/D4 边界 | `SPEC_MERGED` 就绪 → slice-planner 写 `[code]` 脱模板 → `status`（停门）→ `next --auto`（消费 slice-exit）→ `status` → 逐片推进一轮 | 放行前：停 `slice-exit`、无 `loop_state`；放行后：`SLICES_APPROVED` 在场、`loop_state` 挂出、进入 S31 逐片循环（选片 / verify / 勾片语义与既有用例一致）；全程 `loop_state` 出现时刻严格等于 marker 写入之后 |

### 覆盖度校验补充
- [ ] slice-exit 未批准不进 implement loop / 不挂 loop_state：UT-S31-26、ST-S31-11
- [ ] SLICES_APPROVED 写入后才挂 loop_state 并进入逐片循环：UT-S31-27、ST-S31-11
