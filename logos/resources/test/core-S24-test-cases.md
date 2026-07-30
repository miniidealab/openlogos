# S24: next --auto 自动跳过可跳人类确认点（skip-gate） — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S24-01 | gate 助手取 ready-to-merge → spec 出口 gate skippable:true | flow-derive gate 助手 | launched flow（change-flow-redesign） | `gateFor("ready-to-merge")` | `{ gate_id: "spec-exit", skippable: true }` |
| UT-S24-02 | gate 助手取 ready-to-deploy → deliver 入口 gate skippable:true | flow-derive gate 助手 | launched flow | `gateFor("ready-to-deploy")` | `{ gate_id: "deliver-entry", skippable: true }` |
| UT-S24-03 | ready-to-smoke 无对应 flow gate | flow-derive gate 助手 | launched flow | `gateFor("ready-to-smoke")` | gate 为 null（无 flow gate；smoke 改由全自动 standing 授权自动执行，不经 `gate_id` 字段表达）|
| UT-S24-13 | gate 助手取 ready-to-delta → plan 出口 gate skippable:true | flow-derive gate 助手 | launched flow | `gateFor("ready-to-delta")` | `{ gate_id: "plan-exit", skippable: true }` |
| UT-S24-14 | 达上限退出门 loop-exhausted → skippable:false（默认） | flow-derive gate 助手 | launched implement loop 达上限、无 exhausted_gate 覆盖 | 取 loop-exhausted gate | `{ gate_id: "gate:implement:loop-exhausted", skippable: false }` |
| UT-S24-18 | gate 助手取 ready-to-implement → slice 出口 gate skippable:true | flow-derive gate 助手 | launched flow（split-slice-planner-stage：含 slice 子流程） | `gateFor("ready-to-implement")` | `{ gate_id: "slice-exit", skippable: true }` |
| UT-S24-04 | ready-to-merge + --auto 放行并输出下一动作 | next --auto | 活跃提案处于 ready-to-merge | `next --auto` | 视为已通过，输出 merge 下一步建议；追加 `GATE_AUTO_PASSED`；不写 `PLAN_APPROVED` |
| UT-S24-05 | 可跳 gate + --auto 追加 GATE_AUTO_PASSED 一行 | next --auto 审计 | 活跃提案处于 ready-to-merge / 首次 ready-to-delta / ready-to-deploy | `next --auto` | `GATE_AUTO_PASSED` JSONL 追加 `{gate_id, proposal_step, timestamp}` 一行 |
| UT-S24-15 | ready-to-delta + --auto 消费 plan gate 并进入 write-delta | next --auto | 活跃提案处于 ready-to-delta，`PLAN_APPROVED` 不存在 | `next --auto --format json` | 追加 `{gate_id:"plan-exit", proposal_step:"ready-to-delta", ...}`；写入 `PLAN_APPROVED`；响应派生为 `delta-writing`，`next_node.id=="write-delta"` |
| UT-S24-19 | ready-to-implement + --auto 消费 slice gate 并进入 coding | next --auto | 活跃提案处于 ready-to-implement（`[code]` 已脱模板），`SLICES_APPROVED` 不存在 | `next --auto --format json` | 追加 `{gate_id:"slice-exit", proposal_step:"ready-to-implement", ...}`；写入 `SLICES_APPROVED`；响应派生为 `coding`，`next_node.id=="code"` |
| UT-S24-16 | ready-to-deploy + --auto 放行（部署门可跳） | next --auto | 活跃提案处于 ready-to-deploy | `next --auto` | 视为已通过，输出部署下一步；`gate_auto_passed=true`；追加审计行；放行依据为本次响应而非历史审计行 |
| UT-S24-06 | loop-exhausted + --auto 保持停顿不写审计 | next --auto | implement loop 达上限未收敛（skippable:false）| `next --auto` | 输出"未收敛大功能需处理"，不放行、不写 `GATE_AUTO_PASSED`（除非 overlay 覆盖）|
| UT-S24-07 | 重复 plan-exit --auto 不重复追加审计 | next --auto 幂等 | 首次 `next --auto` 已写入 `PLAN_APPROVED` 且未产出 delta | 再次 `next --auto --format json` | 不再追加 `gate_id:"plan-exit"` 审计；仍派生 `delta-writing` / `next_node.id=="write-delta"` |
| UT-S24-20 | 重复 slice-exit --auto 不重复追加审计 | next --auto 幂等 | 首次 `next --auto` 已写入 `SLICES_APPROVED` 且 `[code]` 全勾前未进入 coding 实现 | 再次 `next --auto --format json` | 不再追加 `gate_id:"slice-exit"` 审计；仍派生 `coding` / `next_node.id=="code"` |
| UT-S24-08 | 默认 next 忽略 GATE_AUTO_PASSED 不越过 gate | next 默认 | 已存在 `GATE_AUTO_PASSED` 但无 `PLAN_APPROVED`，且仍处于可跳 gate | `next`（无 --auto）| 输出与未引入 --auto 时一致，不自动越过 gate |
| UT-S24-09 | PLAN_APPROVED 是 plan gate 状态源 | next 默认 / status | 已存在 `PLAN_APPROVED`，无 delta 文件、`[delta]` 未勾 | `next --format json` / `status --format json` | 派生为 `delta-writing`，`next_node.id=="write-delta"`（next），不是 `ready-to-delta` |
| UT-S24-21 | SLICES_APPROVED 是 slice gate 状态源 | next 默认 / status | 已存在 `SLICES_APPROVED`，`[code]` 已脱模板但未勾、测试未绿 | `next --format json` / `status --format json` | 派生为 `coding`，`next_node.id=="code"`（next），不是 `ready-to-implement` |
| UT-S24-10 | GATE_AUTO_PASSED 每行 schema 正确 | 审计 schema | 可跳 gate + --auto | 读取审计文件 | 每行含 `gate_id`/`proposal_step`/`timestamp` 三字段 |
| UT-S24-23 | ready-to-implement 但 `[code]` 未脱模板时 `--auto` 不放行 slice-exit | next --auto slice 前置 | 活跃提案有 `SPEC_MERGED`，`[code]` 仍为模板/占位，`SLICES_APPROVED` 不存在 | `next --auto --format json` | `proposal_step=="ready-to-implement"`；`next_node.id=="plan-slices"`；`gate_auto_passed` 为 false 或省略；`gate_id` 不为 `"slice-exit"`；不写 `SLICES_APPROVED`；不追加 `GATE_AUTO_PASSED{slice-exit}` |
| UT-S24-24 | ready-to-implement 已脱模板时 `--auto` 才消费 slice-exit | next --auto slice 前置对照 | 活跃提案有 `SPEC_MERGED`，`[code]` 已脱模板，`SLICES_APPROVED` 不存在 | `next --auto --format json` | 与 UT-S24-19 相同，证明修复只阻断未切片态，不破坏已切片态 |
| UT-S24-11 | ready-to-smoke + --auto 自动执行 smoke 并写合成审计 | next --auto 红线放行 | 活跃提案处于 ready-to-smoke（`DEPLOY_DONE` 存在、smoke_required）| `next --auto` | standing 授权自动运行 `openlogos smoke`；追加 `GATE_AUTO_PASSED` 合成行（步骤标识=`smoke`）；输出**不**与默认 next 一致（默认 next 仍提示人工授权 smoke）|
| UT-S24-12 | --auto 的 JSON 附带 gate 字段；默认 next 不附带 | next json | `--format json` | `next --auto --format json` vs `next --format json` | --auto 含 `auto`/`gate_id`/`skippable`/`gate_auto_passed`；默认 next 不含 |
| UT-S24-17 | 审计存在但 PLAN_APPROVED 缺失时 status 不前移 | status 默认 | 手工构造 `GATE_AUTO_PASSED` 含 `plan-exit`，但无 `PLAN_APPROVED` 且无 delta | `status --format json` | `proposal_step=="ready-to-delta"`；证明审计不是状态源 |
| UT-S24-22 | 审计存在但 SLICES_APPROVED 缺失时 status 不前移 | status 默认 | 手工构造 `GATE_AUTO_PASSED` 含 `slice-exit`，但无 `SLICES_APPROVED`，`[code]` 已脱模板未勾 | `status --format json` | `proposal_step=="ready-to-implement"`；证明审计不是状态源 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S24-01 | 可跳 gate 在 --auto 下放行并留痕 | Step 1→5 | 活跃提案 ready-to-merge / ready-to-delta / ready-to-deploy | `openlogos next --auto` | ready-to-delta：追加审计 + 写 `PLAN_APPROVED` + `next_node=write-delta`；ready-to-merge/deploy：放行输出下一步建议 + 追加审计 |
| ST-S24-08 | slice-exit 在 --auto 下放行并派生 coding | Step 1→5 | 活跃提案处于 ready-to-implement（`[code]` 已脱模板，`SLICES_APPROVED` 不存在） | `openlogos next --auto` | 追加 `{gate_id:"slice-exit", proposal_step:"ready-to-implement"}` 审计一行 + 写 `SLICES_APPROVED`；响应派生为 `coding`、`next_node.id=="code"` |
| ST-S24-02 | loop-exhausted 在 --auto 下仍卡住 | Step 1→4c | implement loop 达上限未收敛（skippable:false）| `openlogos next --auto` | 保持人类停顿，不写审计 |
| ST-S24-07 | deliver 入口门在 --auto 下放行（部署可全自动） | Step 1→4b | 活跃提案 ready-to-deploy | `openlogos next --auto` | 放行部署下一步、追加审计；放行依据为本次 `gate_auto_passed=true` |
| ST-S24-03 | 默认 next 忽略 GATE_AUTO_PASSED | 默认 next | 已存在审计且处于可跳 gate，但无 `PLAN_APPROVED` | `openlogos next` | 与未引入 --auto 时一致，不越过 gate |
| ST-S24-04 | 重复 plan-exit --auto 不刷审计且状态前移 | Step 4a + 默认 next | 同一 ready-to-delta 提案 | `next --auto` 连续两次 → `next` / `status` | `GATE_AUTO_PASSED` 中 `plan-exit` 仅一行；`PLAN_APPROVED` 存在；`next` / `status` 派生为 `delta-writing` / `write-delta` |
| ST-S24-09 | 重复 slice-exit --auto 不刷审计且状态前移 | Step 4a + 默认 next | 同一 ready-to-implement 提案 | `next --auto` 连续两次 → `next` / `status` | `GATE_AUTO_PASSED` 中 `slice-exit` 仅一行；`SLICES_APPROVED` 存在；`next` / `status` 派生为 `coding` / `code` |
| ST-S24-10 | slice-exit 只在 plan-slices 完成后可被 auto 放行 | Step 4e-0 / Step 4e | 同一提案先处于 `[code]` 模板态，后由 slice-planner 写出 `[code]` | `next --auto`（模板态）→ 写 `[code]` 切片 → `next --auto`（脱模板态） | 第一次不写 `SLICES_APPROVED` 且返回 `plan-slices`；第二次写 `SLICES_APPROVED`、追加 `slice-exit` 审计、派生 `code` |
| ST-S24-05 | 默认 next / status golden 基线对齐（重拍后） | golden | 同一 fixture | `openlogos next --format json` / `openlogos status --format json` | 与本提案重拍后的 golden-baseline 锚点等价 |
| ST-S24-06 | 审计 JSONL 内容可被消费 | 审计 | 可跳 gate + --auto | 读取 `GATE_AUTO_PASSED` | 行内容为合法 JSON，含 `gate_id`/`proposal_step`/`timestamp` |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S24-EX-2.1 | 无活跃提案 / 项目未初始化 | EX-2.1 | 无 guard 或无 `logos/logos.config.json` | `openlogos next --auto` | 沿用 next 既有错误/引导语义，不写 `GATE_AUTO_PASSED`，不写 `PLAN_APPROVED` |
| ST-S24-EX-4e.2 | 未到 slice-exit 门时误用 `--auto` | EX-4e.2 | `ready-to-implement` 但 `[code]` 未 `tasks_code_filled` | `openlogos next --auto` | 不写审计、不写 `SLICES_APPROVED`、不进入 `coding`，保持 `next_node=plan-slices` |

## 四、覆盖度校验清单
- [x] gate 助手映射（plan/spec/deliver/loop-exhausted/smoke）已覆盖：UT-S24-01、UT-S24-02、UT-S24-03、UT-S24-13、UT-S24-14
- [ ] slice 出口门映射（ready-to-implement→slice-exit, skippable:true）已覆盖：UT-S24-18
- [x] 可跳 gate 放行 + 追加审计已覆盖：UT-S24-04、UT-S24-05、ST-S24-01
- [x] plan 门 auto 放行消费状态已覆盖：UT-S24-15、UT-S24-07、UT-S24-09、ST-S24-04
- [ ] slice 门 auto 放行消费状态（写 SLICES_APPROVED → 派生 coding，幂等）已覆盖：UT-S24-19、UT-S24-20、UT-S24-21、ST-S24-08、ST-S24-09
- [ ] slice 门 auto 放行前置：未脱模板不可放行、已脱模板可放行：UT-S24-23、UT-S24-24、ST-S24-10、ST-S24-EX-4e.2
- [x] deliver 门 --auto 放行（部署可全自动）已覆盖：UT-S24-16、ST-S24-07
- [x] loop-exhausted skippable:false 保持停顿已覆盖：UT-S24-06、ST-S24-02
- [x] 默认 next 忽略 GATE_AUTO_PASSED 不越过 gate 已覆盖：UT-S24-08、UT-S24-17、ST-S24-03
- [ ] slice 门审计非状态源（缺 SLICES_APPROVED 时 status 不前移）已覆盖：UT-S24-22
- [x] 默认 next/status golden 对齐已覆盖：ST-S24-05
- [x] 审计 JSONL schema/内容已覆盖：UT-S24-10、ST-S24-06
- [x] smoke 全自动 standing 授权自动执行已覆盖：UT-S24-11（旧「smoke 不在 --auto 范围」语义已作废）
- [x] JSON gate 字段（--auto 有 / 默认无）已覆盖：UT-S24-12
- [x] 无活跃提案/未初始化异常已覆盖：ST-S24-EX-2.1

## 五、全自动两档授权（指令文本）与覆盖收口（auto-full-unattended）

> **实现阶段订正**：实测证伪「PreToolUse guard 会拦 git push」——`plugin/bin/guard-check` 的 `BASH_SAFE_PATTERNS` 本就含 `^git push`，guard 从不拦截。故原设想的 `AUTO_MODE` marker / guard 例外 / 红线步骤合成审计**整套多余、已废弃**。全自动下 `verify` / `smoke` / `archive` / `git push` 的「自动执行」= **宿主 AI driver 读指令文本（两档授权）后的行为**，不在 openlogos CLI 单测层，由下游 **runlogos** 验证。
>
> 故本节**不新增 openlogos CLI 用例**。本提案在 openlogos CLI 层真正可测的面，由以下既有用例覆盖：
>
> - **两档授权指令文本**（半自动=人类确认点不变 / 全自动 `--auto`=standing 授权自动跑 verify/smoke/archive/git push / 硬红线 `loop-exhausted` 绝不放行）由 `createAgentsMd` 生成 → 覆盖于 **UT-S01-46**（见 `core-S01-test-cases.md`）。
> - **`loop-exhausted` 在 `--auto` 下仍阻塞、不放行未收敛代码、不写 `GATE_AUTO_PASSED`** → 覆盖于既有 **UT-S24-06 / ST-S24-02**（本提案未触碰该派生逻辑，语义不变）。
> - **`git push` 不被 guard 拦截**（安全白名单 `^git push`）→ 属 `pretooluse-guard` 既有行为，非本提案新增逻辑。

## 六、`auto_execute` 非门动作步骤自动执行信号（auto-execute-redline-steps）

> `next --auto` 为 verify/smoke/archive 这类非门 CLI 命令步骤输出 `auto_execute:true` + 具体 `command`，供无人值守 driver 自动执行。默认 next 不输出；loop-exhausted 等硬红线不置。

### 6.1 单元测试用例补充
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S24-AE-01 | verify-passed + --auto → auto_execute:true + command=archive | next --auto 非门步骤 | 活跃提案 `proposal_step=verify-passed`（VERIFY_PASS 在场、无部署） | `next --auto --format json` | `auto_execute===true`；`command==="openlogos archive <slug>"`；action/detail 为自动执行措辞 |
| UT-S24-AE-02 | ready-to-verify + --auto → auto_execute:true + command=verify | next --auto 非门步骤 | 活跃提案 `proposal_step=ready-to-verify`、loop 未阻塞 | `next --auto --format json` | `auto_execute===true`；`command==="openlogos verify"` |
| UT-S24-AE-03 | 默认 next（无 --auto）不输出 auto_execute | next 默认 | 同 verify-passed 提案 | `next --format json` | 输出**不含** `auto_execute` 字段；action/command 与今天一致（提示人工授权） |
| UT-S24-AE-04 | loop-exhausted + --auto 不置 auto_execute（硬红线回归） | next --auto 硬红线 | implement loop 达上限未收敛（escalated、skippable:false） | `next --auto --format json` | **不**输出 `auto_execute`（或为 false）；停在 loop-exhausted gate；与 UT-S24-06 同向 |
| UT-S24-AE-05 | smoke-passed + --auto → auto_execute:true + command=archive | next --auto 非门步骤 | `proposal_step=smoke-passed`（SMOKE_PASS 在场） | `next --auto --format json` | `auto_execute===true`；`command==="openlogos archive <slug>"` |

### 6.2 场景测试用例补充
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S24-AE-01 | 全自动：verify 通过后 next --auto 直接给出可执行的归档信号 | Step 9→12 | 代码已绿、VERIFY_PASS、`--auto` | `openlogos next --auto --format json` | `auto_execute:true` + `command=openlogos archive <slug>`，driver 据此自动归档，无人工接入 |

### 6.3 覆盖度校验补充
- [ ] verify/smoke/archive 步骤 --auto 输出 auto_execute + command：UT-S24-AE-01、UT-S24-AE-02、UT-S24-AE-05、ST-S24-AE-01
- [ ] 默认 next 不输出 auto_execute：UT-S24-AE-03
- [ ] loop-exhausted 硬红线不置 auto_execute（回归）：UT-S24-AE-04

## 七、缺失 [code] section 时 slice-exit 不可自动放行

> 以下用例含 OpenLogos reporter。用例名必须带 `UT-S24-25` / `ST-S24-11` 等 ID，供 verify 抽取覆盖。

### 7.1 单元测试用例补充

| ID | 描述 | 覆盖 | 前置 | 输入 | 期望 |
|---|---|---|---|---|---|
| UT-S24-25 | 代码必需但缺失 `[code]` 时 `ready-to-implement` 不等于 slice-exit 到达 | next --auto gate 前置 | `SPEC_MERGED` 在场；proposal / delta 新增测试 ID 推导 `code_required==true`；`tasks.md` 缺失 `## [code]`；无 `SLICES_APPROVED` | `next --auto --format json` | `proposal_step=="ready-to-implement"`；`next_node.id=="plan-slices"`；顶层 `gate_id` 不为 `"slice-exit"`；`gate_auto_passed` 为 false 或省略 |
| UT-S24-26 | 缺失 `[code]` 时不写 slice 审计与 marker | 审计副作用 | 同 UT-S24-25 | `next --auto --format json` 后读提案目录 | 不存在 `SLICES_APPROVED`；`GATE_AUTO_PASSED` 不含 `gate_id:"slice-exit"` |
| UT-S24-27 | 缺失 `[code]` 与已脱模板 `[code]` 的 auto 行为区分 | 对照用例 | A: 缺失 `[code]`；B: `[code]` 已 `tasks_code_filled`；二者均 `code_required==true` | 分别执行 `next --auto --format json` | A 保持 `plan-slices` 不放行；B 消费 `slice-exit`，写 `SLICES_APPROVED` 并派生 `next_node.id=="code"` |

### 7.2 场景测试用例补充

| ID | 描述 | 覆盖 | 操作 | 期望 |
|---|---|---|---|---|
| ST-S24-11 | 全自动模式下缺失 `[code]` 不得空过切片门 | skip-gate 防越门 | 构造 `SPEC_MERGED + code_required=true + tasks.md 缺失 [code]`，连续执行两次 `next --auto --format json` | 两次均不得追加 `GATE_AUTO_PASSED{slice-exit}`，不得写 `SLICES_APPROVED`；前沿保持 `plan-slices`，直到 slice-planner 写出真实 `[code]` |

### 7.3 覆盖度校验补充

- [ ] 缺失 `[code]` 的代码必需态不输出 / 不消费 `slice-exit`：UT-S24-25、ST-S24-11
- [ ] 缺失 `[code]` 时不写 `SLICES_APPROVED` / `GATE_AUTO_PASSED{slice-exit}`：UT-S24-26、ST-S24-11
- [ ] 已脱模板 `[code]` 的既有 auto-pass 行为不回退：UT-S24-27

## 十二、next --auto 可恢复失败回归

| ID | 用例 | 前置条件 | 操作 | 期望 |
|---|---|---|---|---|
| UT-S24-28 | `next --auto` 遇到 global verify failed 不 hard block | 当前切片 artifacts 与 reporter 证据完整；全量 verify 有失败测试 | `next --auto --format json` | 输出 `automation_diagnostic.reason="global-verify-failed"`、`suggested_next_node="code"`、`human_action_required=false` |
| UT-S24-29 | 可恢复失败不写无关 gate 审计 | 同 UT-S24-28 | `next --auto` | 不追加无关 `GATE_AUTO_PASSED`；不写任何表示 verify 通过的 marker |
| ST-S24-12 | 无人值守全量红进入 repair 而非 retry exhausted | 模拟 driver 完成切片后全量 verify failed | 连续调用 `next --auto` / 自动诊断 | 不输出 `retry-exhausted`；输出 failed tests 与 repair/code 前沿 |

### 覆盖度校验

- [ ] `next --auto` 可恢复失败返回 repair/code：UT-S24-28、ST-S24-12
- [ ] 可恢复失败不误写 gate 审计：UT-S24-29

## 十三、plan-exit auto 后继续派发 write-delta 测试

> 覆盖 `next --auto` 消费 `plan-exit` 后的 driver 闭环，确保消费方不会停在 plan 门或把 `tasks.md 0/N` 折叠为任务规划失败。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

| ID | 用例 | 覆盖点 | 前置条件 | 操作 | 期望 |
|---|---|---|---|---|---|
| UT-S24-30 | plan-exit auto 响应带 write-delta 前沿 | next --auto JSON | 活跃提案 `proposal_step=ready-to-delta`，proposal/tasks 已脱模板，无 `PLAN_APPROVED` | `openlogos next --auto --format json` | `gate_id=="plan-exit"`；`gate_auto_passed==true`；同次响应 `proposal_step=="delta-writing"`；`next_node.id=="write-delta"` |
| UT-S24-31 | driver 不把 gate_auto_passed 统一当作无 next_node | 消费方规则 | UT-S24-30 的响应 | driver next 响应解析 | 对 `plan-exit` 例外读取 `next_node.id=="write-delta"` 并派发；不得省略下一工作单元 |
| UT-S24-32 | tasks 0/N 不阻断 plan-exit auto 后 write-delta | 执行进度分层 | `ready-to-delta` 且 `[delta]` checkbox 为 `0/N` | `next --auto --format json` 后 driver 消费 | 仍进入 `write-delta`；不输出 planning failed / blocked / retry-exhausted |
| UT-S24-33 | 已有 PLAN_APPROVED 时重复 auto 不追加 plan 审计 | 幂等 | 提案已有 `PLAN_APPROVED`，尚未产出 delta | 重复执行 `next --auto --format json` | 不再追加 `GATE_AUTO_PASSED{gate_id:"plan-exit"}`；前沿保持 `write-delta` |
| ST-S24-13 | 全自动 plan gate 到 delta-writing 端到端 | skip-gate 闭环 | 从 `ready-to-delta` 提案开始，driver 运行 `next --auto` | driver 根据 JSON 派发 change-writer | 产生 delta-writing dispatch；不需要人类再次确认 plan；无 blocked(no-progress) |
| ST-S24-14 | 半自动 ready-to-delta 仍停人工确认 | 兼容行为 | 同 ST-S24-13 但不带 `--auto` | `openlogos next --format json` | 展示方案待批准，不写 `PLAN_APPROVED`，不自动派发 write-delta；半自动确认点不回退 |

## 十四、ready-to-merge --auto 与 stale automation diagnostic 回归

> 以下用例含 OpenLogos reporter。用例名必须带 `UT-S24-34` / `ST-S24-15` 等 ID，供 verify 抽取覆盖。

### 14.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S24-34 | `ready-to-merge --auto` 在 stale global verify failed 存在时保留 merge command | next --auto JSON | 活跃提案 `ready-to-merge`；存在失败 `acceptance-report.md` 或 `test-results.jsonl` | `openlogos next --auto --format json` | `gate_id=="spec-exit"`；`gate_auto_passed===true`；`command=="openlogos merge <slug>"`；不输出 `suggested_next_node=="code"` |
| UT-S24-35 | 模块级 command 不被 stale diagnostic 清空 | 多模块 next JSON | 多模块项目中 core 模块有 `ready-to-merge` 活跃提案，历史 verify failed 存在 | `next --auto --format json` | `modules[].active_change.command=="openlogos merge <slug>"` 或等价模块级 command 保留 |
| UT-S24-36 | `ready-to-merge --auto` 不写 slice marker | 副作用 | 同 UT-S24-34 | 执行后读取提案目录 | 不存在 `SLICES_APPROVED`；`GATE_AUTO_PASSED` 不含 `slice-exit`；只允许 spec gate 审计 |

### 14.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S24-15 | 全自动 merge gate 不被历史失败诊断阻断 | Step 1→5 | 提案完成 delta 并处于 `ready-to-merge`，工作区保留上一轮 verify failed 证据 | `openlogos next --auto --format json` | driver 可读取 `command=openlogos merge <slug>` 并继续 merge；无 `auto-gate-no-progress` |

### 14.3 覆盖度校验补充

- [ ] `ready-to-merge --auto` 保留顶层 merge command：UT-S24-34、ST-S24-15
- [ ] `ready-to-merge --auto` 保留模块级 merge command：UT-S24-35
- [ ] stale diagnostic 不消费 slice-exit / 不写 SLICES_APPROVED：UT-S24-36
