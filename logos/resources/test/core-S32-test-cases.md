# S32: 切片规划环节（merge 后 slice-planner 划分 [code] 切片到 slice-exit 确认） — 测试用例

> 复用 S27/S31 临时项目模式（`makeTempRoot` + `scaffoldProject`）。提案处于 launched 生命周期；merge 态用预写 `SPEC_MERGED`（或 `MERGED`）marker 构造，切片态用 `tasks.md` `[code]` 是否脱模板构造，切片确认用 `SLICES_APPROVED` marker + `GATE_AUTO_PASSED` 审计行构造。
> `code_required` 由提案是否含 `[code]` 产出决定（纯 `[delta]` 提案 → `code_required=false`，slice 子流程整段跳过）。含 OpenLogos reporter（用例名须带 `UT-S32-*` / `ST-S32-*` 供抽取）。
> **golden 零漂移**：新增步骤/门仅在 launched 含 slice 子流程时透出；initial / 非 launched 项目 status/next/flow show 快照**必须逐字节不变**、**不输出 `ready-to-implement` / `slice-exit`**。

## 一、单元测试用例

| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S32-01 | builtin launched 含 slice 子流程定义 | 无 overlay 的 launched flow | `loadBuiltinFlow("launched")` | 存在 `id:"slice"` 子流程：节点 `plan-slices`（`skill:"slice-planner"`、`done_when:"tasks_code_filled"`、`produces:"tasks.md"`）、`when:"code_required"`、出口 `gate:{type:human, skippable:true}`；位于 spec-complete 与 implement 之间 |
| UT-S32-02 | plan 段 write-tasks done_when 改为 tasks_delta_filled | 同上 | 读 plan 子流程 `write-tasks` 节点 | `done_when=="tasks_delta_filled"`（不再 `section_complete:code`）；不再要求 `[code]` |
| UT-S32-03 | write-tasks 完成判定只看 [delta]/[deploy] 脱模板 | `tasks.md` 的 `[delta]`/`[deploy]` 已脱模板、`[code]` 仍为模板 | `next --format json`（plan 段） | plan 段 `write-tasks` 判定完成、派生越过 plan；不因 `[code]` 缺失卡在 plan |
| UT-S32-04 | merge 后 code_required 为真 → 派生进入 slice 子流程 | `SPEC_MERGED` 在场、`[code]` 仍为模板、提案含代码产出（`code_required=true`）、测试 ID 可解析 | `next --format json` / `status --format json` | `proposal_step=="ready-to-implement"`；`next_node.id=="plan-slices"`；不直接进入 `code` |
| UT-S32-05 | plan-slices 完成判定 = [code] 脱模板 → 停在 slice-exit 门 | `SPEC_MERGED` 在场、`[code]` 已脱模板（未勾）、`SLICES_APPROVED` 不存在 | `next --format json` | `proposal_step=="ready-to-implement"`；`next_node.gate_id=="slice-exit"`、`skippable:true`；停门等批准，不进入 `coding` |
| UT-S32-10 | 纯代码提案（无 `[delta]`）无 `SPEC_MERGED` 不得进入 slice 子流程 | 无 `[delta]`、含空 `## [code]` 标题、无 `SPEC_MERGED`、无 `SLICES_APPROVED` | `next --format json` / `status --format json` | `proposal_step=="spec-complete-required"`；`reason=="no_delta_spec_marker_missing"`；`next_node.id` 不为 `plan-slices` / `write-delta` |
| UT-S32-11 | 纯代码提案 no-delta `SPEC_MERGED` 后进入 plan-slices | 无 `[delta]`、`SPEC_MERGED` 内容含 `type:no_delta_spec_complete`、`[code]` 未脱模板、测试 ID 可解析 | `next --format json` | `proposal_step=="ready-to-implement"`；`next_node.id=="plan-slices"` |
| UT-S32-12 | 纯代码提案 no-delta `SPEC_MERGED` + `[code]` 脱模板后停 slice-exit 门 | 无 `[delta]`、`SPEC_MERGED`、`[code]` 已 `tasks_code_filled`（未勾）、无 `SLICES_APPROVED` | `next --format json` | `proposal_step=="ready-to-implement"`；`next_node.gate_id=="slice-exit"`、`skippable:true` |
| UT-S32-13 | `next --auto` 在 `[code]` 未脱模板时不得空过 plan-slices | `SPEC_MERGED` 在场、`[code]` 仍为模板或占位项、`SLICES_APPROVED` 不存在 | `next --auto --format json` | `proposal_step=="ready-to-implement"`；`next_node.id=="plan-slices"`；`gate_auto_passed` 为 false 或省略；不写 `SLICES_APPROVED` |
| UT-S32-14 | 纯代码提案缺 `SPEC_MERGED` 时 `next --auto` 不得派 plan-slices | 无 `[delta]`、无 `SPEC_MERGED`、`[code]` 仍为空/模板、`SLICES_APPROVED` 不存在 | `next --auto --format json` | `spec-complete-required`；不写 `SLICES_APPROVED`；不进入 `coding` |
| UT-S32-26 | 缺真实测试 ID 时不得派 plan-slices | `SPEC_MERGED` 在场、`code_required==true`、无可解析 UT/ST/SMOKE ID | `next --format json` / `status --format json` | `proposal_step=="test-id-required"`；`reason=="code_change_requires_real_test_ids"`；`next_node.id` 不为 `plan-slices` |

## 二、场景测试用例
| ID | 描述 | 覆盖 | 操作 | 预期 |
|----|------|------|------|------|
| ST-S32-01 | merge 后切片规划端到端至 slice-exit 放行进 coding | merge→plan-slices→[code] 脱模板→slice-exit→coding | `SPEC_MERGED` 就绪 → `next`（指 plan-slices）→ 写 `[code]` 脱模板 → `next`（停 slice-exit）→ `next --auto` | 每步前沿：先 `ready-to-implement`/`next_node=plan-slices`；填 `[code]` 后停 `slice-exit` 门；`--auto` 写 `SLICES_APPROVED`+审计 → 派生 `coding`、`next_node=code` 进入 S31 切片循环 |
| ST-S32-02 | 纯文档提案整段跳过 slice 子流程 | when:code_required 假 | 纯 `[delta]` 提案 merge 完成后走 `next` | 不进入 slice、不要求 `[code]`、不出现 `ready-to-implement`/`slice-exit`；按退化路径推进（不被卡死）|
| ST-S32-03 | plan 段不再产 [code]（write-tasks 只需 [delta]/[deploy]） | tasks_delta_filled | plan 段填 `[delta]`/`[deploy]` 脱模板、`[code]` 留模板 → `next` | plan-exit 门正常放行进入 spec/merge；`[code]` 缺失不阻塞 plan 完成 |
| ST-S32-04 | 重复 slice-exit --auto 幂等且默认派生稳定 | slice-exit 幂等 | 同一 ready-to-implement 提案连续两次 `next --auto` → `next` / `status` | `GATE_AUTO_PASSED` 中 `slice-exit` 仅一行、`SLICES_APPROVED` 一份；默认 `next`/`status` 派生 `coding` / `code` 不变 |
| ST-S32-05 | merge 后自动模式也必须先规划切片 | merge→ready-to-implement 模板态→auto 不放行→slice-planner→auto 放行 | `SPEC_MERGED` 就绪且 `[code]` 模板 → `next --auto` → 写出 `[code]` 脱模板 → `next --auto` | 第一次 `next --auto` 返回 `plan-slices` 且不写 `SLICES_APPROVED`；第二次在 `[code]` 脱模板后才写 `SLICES_APPROVED` 并派生 `coding` / `code` |

## 三、异常测试用例

| ID | 描述 | 覆盖异常 | 操作 | 预期 |
|----|------|----------|------|------|
| ST-S32-EX-1 | 未完成 spec-complete 不应到切片时机 | 切片前置 | 有 `[delta]` 提案无 `SPEC_MERGED`，或纯代码提案无 no-delta `SPEC_MERGED` | `next`/`status` 不派生 `plan-slices`；有 delta 停在 spec/merge 前沿，纯代码停在 `spec-complete-required` |
| ST-S32-EX-3 | 纯代码提案（无 `[delta]`）需 no-delta merge 后进入切片 | 纯代码 spec-complete | 纯代码修复提案经 plan 门后 `next`，提案目录无 `SPEC_MERGED` → 执行 no-delta merge → 再 `next` | merge 前 `spec-complete-required`；merge 后 `ready-to-implement`/`next_node=plan-slices` |
| ST-S32-EX-6 | 缺真实 UT/ST ID 阻塞切片 | 测试 ID 门禁 | 构造 `SPEC_MERGED + code_required`，但测试资源无真实 ID 且无复用声明 | `next/status` 返回 `test-id-required`；不派 `slice-planner`；不写 `[code]` |

## 四、覆盖度校验清单

- [ ] slice 子流程定义（plan-slices/slice-planner/skippable:true/when:code_required）：UT-S32-01
- [ ] merge 后 code_required 真 + spec-complete + 测试 ID 稳定 → 派生 slice 子流程：UT-S32-04、ST-S32-01
- [ ] 纯代码提案无 `SPEC_MERGED` 先停 `spec-complete-required`：UT-S32-10、UT-S32-14、ST-S32-EX-3
- [ ] no-delta `SPEC_MERGED` 后才进入 `plan-slices`：UT-S32-11、UT-S32-12、ST-S32-EX-3
- [ ] 缺真实测试 ID 时不得派 `plan-slices`：UT-S32-26、ST-S32-EX-6
- [ ] `[code]` 未脱模板时 `next --auto` 不得空过 `plan-slices` / 不写 `SLICES_APPROVED`：UT-S32-13、ST-S32-05、ST-S32-EX-4

## 五、enforce-slice-stage-ordering 增量（提前填充 [code] auto-reset）

### 单元测试用例

| ID | 描述 | 前置 / 输入 | 操作 | 期望 |
|---|---|---|---|---|
| UT-S32-15 | 有 `[delta]` 提案 `merge` 时 auto-reset 提前填充的 `[code]` | 有 `[delta]`、`[code]` 已 `tasks_code_filled`（提前填、未勾）、**无 `SPEC_MERGED`** | `openlogos merge` | 生成 `MERGE_PROMPT` / 写 `SPEC_MERGED` 前，`[code]` 被重置为占位（`## [code]` 标题保留、`isTasksCodeFilled==false`）；`CODE_AUTORESET` 追加一行含 `ts` / `trigger:"merge"` / 旧 `[code]` 原文；随后 `next` 派生 `ready-to-implement`、`next_node.id=="plan-slices"` |
| UT-S32-16 | 纯代码提案 no-delta `merge` 时 auto-reset 提前填充的 `[code]` | 无 `[delta]`、`[code]` 已 `tasks_code_filled`（提前填、未勾）、**无 `SPEC_MERGED`** | `openlogos merge` | 写 no-delta `SPEC_MERGED` 前，`[code]` 被重置为占位；`CODE_AUTORESET` 追加一行含 `ts` / `trigger:"merge"` / 旧 `[code]` 原文；随后 `next` 派生 `ready-to-implement`、`next_node.id=="plan-slices"` |
| UT-S32-17 | auto-reset 幂等（`[code]` 已占位不重复清理/备份） | `[code]` 为占位（未 `tasks_code_filled`） | 重复 `openlogos merge` | 不清理、不追加 `CODE_AUTORESET`（备份文件无新行）；`tasks.md` 不变 |
| UT-S32-18 | 派生路径只读、不触发 auto-reset（A 被动派生不变） | `[code]` 提前填 `tasks_code_filled`、无 `SPEC_MERGED` / 无 `PLAN_APPROVED` | `status --format json`（纯派生，无 --auto） | `tasks.md` 的 `[code]` **不被修改**、`CODE_AUTORESET` **不产生**；派生结论与今日一致（只读） |

### 场景测试用例

| ID | 描述 | 覆盖 | 操作序列 | 期望 |
|---|---|---|---|---|
| ST-S32-06 | 有 `[delta]` 提案：提前填 `[code]` → merge auto-reset → slice-planner 重划 | 提前填充端到端被作废重划 | `write-tasks` 提前填 `[code]` → `openlogos merge`（auto-reset+备份）→ `next`（派 `plan-slices`）→ slice-planner 写真实 `[code]` → `slice-exit` → `next --auto` | merge 后 `[code]` 为空占位；`CODE_AUTORESET` 存旧内容可追溯；最终 `[code]` 切片来自 slice-planner（对已合并规格 + 真实 UT/ST ID），**非提前填的内容**；流程不阻断 |
| ST-S32-EX-5 | 纯代码提案：提前填 `[code]` → no-delta merge reset → plan-slices → 填 → 放行 | 纯代码提案兜底（统一由 no-delta merge 进入 spec-complete） | 提前填 `[code]`、无 `SPEC_MERGED` → `openlogos merge`（reset+备份+写 no-delta `SPEC_MERGED`）→ `next` 派 `plan-slices` → slice-planner 填真实切片 → `next --auto` 放行 | merge 后 `[code]` 空占位、`CODE_AUTORESET` 有 `trigger:"merge"`、`SPEC_MERGED` 在场；slice-planner 填真实切片后，`next --auto` 输出 `gate_id=slice-exit`、写入 `SLICES_APPROVED` 并派生 `coding` |

### 覆盖度校验清单（enforce-slice-stage-ordering 增量）

- [ ] 提前填充 auto-reset：有 `[delta]` 提案 `merge` 时清理 + 备份：UT-S32-15、ST-S32-06
- [ ] 提前填充 auto-reset：纯代码提案 no-delta `merge` 时清理 + 备份：UT-S32-16、ST-S32-EX-5
- [ ] auto-reset 幂等（`[code]` 已占位不重复清理/备份）：UT-S32-17
- [ ] 派生路径只读、不触发 auto-reset（A 被动派生边界）：UT-S32-18

## 六、缺失 [code] section 的代码必需态回归

> 以下用例含 OpenLogos reporter。用例名必须带 `UT-S32-19` / `ST-S32-07` 等 ID，供 verify 抽取覆盖。

### 单元测试用例补充

| ID | 描述 | 前置 / 输入 | 操作 | 期望 |
|---|---|---|---|---|
| UT-S32-19 | `SPEC_MERGED + 测试 delta + 缺失 [code]` 仍进入 plan-slices | 有 `[delta]` 提案，`SPEC_MERGED` 在场；`tasks.md` 只有 `[delta]` 且已完成，完全缺失 `## [code]`；delta 或已合并测试文档新增 `UT-Sxx-*` / `ST-Sxx-*`；proposal 为代码级修复 | `next --format json` / `status --format json` | `code_required==true`；`proposal_step=="ready-to-implement"`；`next_node.id=="plan-slices"`；诊断 reason 可为 `tasks-code-section-missing`；不返回 `verify` / `code` |
| UT-S32-20 | 缺失 `[code]` 的代码必需态 `next --auto` 不消费 slice-exit | 同 UT-S32-19，`SLICES_APPROVED` 不存在 | `next --auto --format json` | `next_node.id=="plan-slices"`；`gate_id` 不为 `"slice-exit"`；`gate_auto_passed` 为 false 或省略；不写 `SLICES_APPROVED`；`GATE_AUTO_PASSED` 不含 `slice-exit` |
| UT-S32-21 | 明确纯文档提案缺失 `[code]` 不被误伤 | 有 `[delta]` 提案，`SPEC_MERGED` 在场；proposal 明确无需代码；delta 不新增实现相关测试 ID；`tasks.md` 缺失 `[code]` | `next --format json` | `code_required==false`；slice 子流程跳过；不出现 `ready-to-implement` / `plan-slices` |
| UT-S32-22 | slice-planner 可创建缺失 `[code]` section | 承接 UT-S32-19 的 `plan-slices` 前沿；`tasks.md` 缺失 `[code]` | slice-planner 写入 `## [code]` 与真实切片后再执行 `next --format json` | `[code]` 满足 `tasks_code_filled`；前沿移动到 `slice-exit`，`next_node.id=="plan-slices"` 且 `next_node.gate_id=="slice-exit"` |

### 场景测试用例补充

| ID | 描述 | 覆盖 | 操作序列 | 期望 |
|---|---|---|---|---|
| ST-S32-07 | 复现 RunLogos 缺失 `[code]` 事故：merge 后必须先派 slice-planner | 有 delta、新增 UT/ST、`tasks.md` 无 `[code]` | 构造代码级提案 → `[delta]` 新增测试 ID → 写 `SPEC_MERGED` → `next --auto` → slice-planner 创建 `[code]` → `next --auto` | 第一次 `next --auto` 只返回 `plan-slices`，不写 `SLICES_APPROVED`、不运行 verify；slice-planner 写真实切片后，第二次 `next --auto` 才消费 `slice-exit` 并进入 `coding` |

### 覆盖度校验补充

- [ ] 缺失 `[code]` 但测试 delta 表明需要代码 → `plan-slices`：UT-S32-19、ST-S32-07
- [ ] 缺失 `[code]` 的代码必需态不得 auto-pass slice-exit：UT-S32-20、ST-S32-07
- [ ] 明确纯文档提案不被误伤：UT-S32-21
- [ ] slice-planner 可创建缺失 `[code]` section 并推进到 slice-exit：UT-S32-22

## 九、artifact 声明更正与完成回报诊断

| ID | 用例 | 前置条件 | 操作 | 期望 |
|---|---|---|---|---|
| UT-S32-23 | artifact 声明遗漏但磁盘产物存在可诊断 | 当前切片要求源码与测试；agent done 漏报测试 artifact，但磁盘存在 | 校验完成回报 | 输出 `artifact-missing` 或可更正诊断，允许重新校验；不直接 hard block |
| UT-S32-24 | artifact 越界必须阻断并要求人工或重派 | done 声明包含当前工作单元外路径 | 校验完成回报 | 输出 `artifact-out-of-scope`、`human_action_required=true` 或重派当前切片 |
| UT-S32-25 | 更正 artifacts 后重新验证通过局部完成 | 首次 artifacts 漏报，随后同 dispatch 或短窗口更正 | 重新校验 | 输出 `slice_done` 或 `slice_done_global_verify_failed`，audit 保留原始与更正记录 |
| ST-S32-08 | slice-planner 产物驱动后续 artifact 校验 | `plan-slices` 已写真实 `[code]` 切片并经 `slice-exit` 放行 | code dispatch 完成回报 | 按切片 test ID 和 artifacts 校验，输出 `required_test_ids`、`validated_artifacts`、`missing_artifacts` |

### 覆盖度校验

- [ ] artifact 漏报可诊断/可更正：UT-S32-23、UT-S32-25
- [ ] artifact 越界阻断：UT-S32-24
- [ ] slice-planner 切片合同驱动 artifact 校验：ST-S32-08

## 十、facts 单一事实源与 SLICES_APPROVED 结构化 marker（contract-self-description）

> 验证 C3/D3（`facts.slices_planned`/`slices_approved` 由 CLI 权威计算、单一事实源）、
> C2/D4（「已规划、待批准」驻留态不挂 `loop_state`）与 D5（`SLICES_APPROVED` 结构化 marker：
> JSON 单行 `{"schema":"openlogos/slices-approved@1","approved_at":"<ISO 8601>"}`，写一次、
> 已存在不重写、兼容读旧空文件）。

### 单元测试用例补充
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S32-27 | facts.slices_planned 单一事实源、与派生结论同源 | 同一提案两态：A `[code]` 模板/占位态；B `[code]` 已脱模板（真实条目、未勾） | 两态各执行 `status`/`next --format json` | A：`facts.slices_planned:false` 且 `next_node.id=="plan-slices"`；B：`facts.slices_planned:true` 且停 `slice-exit` 门；两态下 facts 值与 `proposal_step`/`next_node` 派生结论恒一致（同一份 `isTasksCodeFilled` 计算，不允许两处实现） |
| UT-S32-28 | facts.slices_approved 单一事实源 +「已规划待批准」驻留态不挂 loop_state | `SPEC_MERGED` 在场、`[code]` 脱模板、`code_required=true`、**无** `SLICES_APPROVED` | `status --format json` | `facts=={..., spec_complete:true, slices_planned:true, slices_approved:false, code_required:true}`；`proposal_step=="ready-to-implement"`；输出**不含** `loop_state`（合法驻留态，消费方走普通推进不得判死） |
| UT-S32-29 | 消费 slice-exit 时原子写入结构化 SLICES_APPROVED（D5） | 同 UT-S32-28 前置 | `next --auto --format json` 后读 marker 文件 | `SLICES_APPROVED` 内容为 JSON 单行 `{"schema":"openlogos/slices-approved@1","approved_at":"<ISO 8601>"}`；`approved_at` 可严格解析为 ISO 8601；写入后 `facts.slices_approved:true`、派生 `coding` |
| UT-S32-30 | SLICES_APPROVED 已存在不重写（幂等，重复 next --auto 不刷新） | 承接 UT-S32-29：marker 已在场 | 间隔后再次 `next --auto`，前后读 marker 字节内容 | marker 文件字节不变、`approved_at` 不刷新；`GATE_AUTO_PASSED` 中 `slice-exit` 仅一行；派生结论稳定（`coding` / `next_node.id=="code"`） |
| UT-S32-31 | 兼容读旧格式空 SLICES_APPROVED | 四事实其余齐备、`SLICES_APPROVED` 为旧格式空文件 | `status --format json` | 旧空 marker 视为已批准：`facts.slices_approved:true`、派生 `coding`、`loop_state` 挂出但**省略** `activated_at`；CLI 不主动改写旧 marker 内容 |

### 场景测试用例补充
| ID | 描述 | 覆盖 | 操作 | 预期 |
|----|------|------|------|------|
| ST-S32-09 | facts 随磁盘事实翻转端到端、与 loop_state 挂出一致 | C3/D3 + C2/D4 + D5 | 同一提案依次：merge 前（无 `SPEC_MERGED`）→ 写 `SPEC_MERGED` → slice-planner 填 `[code]` → `next --auto` 消费 slice-exit；每步 `status --format json` | 各步 `facts.{spec_complete, slices_planned, slices_approved}` 依次翻转为 `(f,f,f)→(t,f,f)→(t,t,f)→(t,t,t)`，每步与 `proposal_step` 派生一致；仅末态挂出 `loop_state` 且 `activated_at` == marker 的 `approved_at`；全程同一磁盘状态重复派生逐字节一致 |

### 覆盖度校验补充
- [ ] facts.slices_planned 单一事实源（与 plan-slices/slice-exit 派生同源）：UT-S32-27、ST-S32-09
- [ ] facts.slices_approved 单一事实源 + 已规划待批准驻留态不挂 loop_state：UT-S32-28、ST-S32-09
- [ ] SLICES_APPROVED 结构化 marker 写入（schema/approved_at）：UT-S32-29、ST-S32-09
- [ ] marker 幂等（已存在不重写、approved_at 不刷新）：UT-S32-30
- [ ] 旧空 marker 兼容读（视为已批准、省略 activated_at）：UT-S32-31

## 十一、manifest 生成、唯一归属与漂移预检测试

> 以下用例实现必须包含精确 ID，并由 OpenLogos reporter 写入结果。

### 11.1 单元测试用例补充

| ID | 描述 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|
| UT-S32-32 | 合法 v1 manifest | 2 个顶层 slice、真实测试 ID 与 selector | validator | valid；切片顺序、tasks 映射、归属与路径全部通过 |
| UT-S32-33 | slice_id 唯一与格式 | 重复 ID、非法字符、超长三 fixture | validator | 分别返回稳定字段路径与 invalid/duplicate code |
| UT-S32-34 | 测试 ID 漏配 | 变更测试集合 C 有一个 ID 不在 owned | validator | `test-slice-test-id-missing`，runner 不启动 |
| UT-S32-35 | 测试 ID 重复归属 | 同 ID 在两片 owned | validator | `test-slice-test-id-duplicate`/ambiguous，不自动选择 |
| UT-S32-36 | 未知测试 ID | owned 含未在已合并规格定义的 ID | validator | `test-slice-test-id-unknown`，给 spec target 诊断 |
| UT-S32-37 | runner selector 必填可执行 | selector 空、重复或不能覆盖 owned | validator | invalid；精确指出 slice 与 selector |
| UT-S32-38 | task fingerprint 规范化 | 仅勾选/尾空白变化，再改 task 语义 | 重算 fingerprint | 前两者哈希不变；语义变化哈希改变并 stale |
| UT-S32-39 | spec fingerprint 漂移 | 测试文档换行规范化、再改 ID/期望 | 重算 fingerprint | CRLF/LF 规范化后稳定；语义改动触发 stale |
| UT-S32-40 | 稳定 slice ID 重建 | manifest 缺失，既有 tasks 不变 | 恢复两次 | 两次 ID、顺序、owned、selector 逐字节一致 |
| UT-S32-41 | 恢复保留进度 | tasks 部分勾选、checkpoint 已有 | 运行恢复模式 | 只替换 manifest；tasks/SLICES_APPROVED/checkpoint 字节不变 |
| UT-S32-42 | 原子写崩溃安全 | 旧有效 manifest + 临时文件写/校验/rename 各故障点 | 故障注入后重读 | 只见旧完整或新完整文件；无半 JSON 被采信 |

### 11.2 场景测试用例补充

| ID | 描述 | 覆盖步骤 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S32-10 | 初次规划 tasks+manifest 共同收敛 | S32 初次模式 | 基于已合并规格规划三片→写 tasks/manifest→validator | 顶层顺序一致，所有变更测试唯一归属，fingerprint 可重算，slice-exit 可达 |
| ST-S32-11 | 缺 manifest 确定性恢复 | S32 恢复 | 部分实现后删除 manifest→恢复两次 | 切片边界/checkbox/checkpoint 保留；manifest 两次逐字节稳定（除 generated_at 按幂等规则保持） |
| ST-S32-12 | 测试规格变化触发 stale 后重建 | S32 漂移 | 合并新增测试 ID→next 报 stale→恢复 | 新 ID 唯一归属、spec fingerprint 更新，旧 checkpoint 仅按哈希隔离不误确认 |
| ST-S32-13 | 歧义 fail-closed | S32 异常 | 构造一个 ID 同时匹配两个无优先级切片 | Agent/validator 报 ambiguous，tasks 与旧 manifest 不改写，流程不进入 code |

### 11.3 覆盖度校验

- [ ] schema/slice ID/selector：UT-S32-32、UT-S32-33、UT-S32-37
- [ ] 漏配/重复/未知/歧义：UT-S32-34～UT-S32-36、ST-S32-13
- [ ] fingerprints 与 stale：UT-S32-38、UT-S32-39、ST-S32-12
- [ ] 稳定恢复与原子性：UT-S32-40～UT-S32-42、ST-S32-10、ST-S32-11

## 十二、Canonical change set 与切片归属分层回归

> 以下用例实现必须包含精确 ID，并通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。测试不得以 Delta 出现集合、手写 changed IDs 或 Git diff 代替 `SPEC_MERGED.test_change_set`。

### 12.1 单元测试用例补充

| ID | 描述 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|
| UT-S32-43 | 有效 change set 是 C/R 唯一来源 | 构造精确 v1 marker：C 含一新增与一语义修改，R 含一删除；当前 targets 与 after hashes 匹配 | 通过共享 TestChangeSetReader 调用 slice state/validator | reader valid；C/R 精确等于 marker；不读取 `deltas/test`，所有消费者得到同一 provenance |
| UT-S32-44 | 原样基线 ID 不可 owned | change set 的 C 不含原样携带 ID，D 含该 ID；slice manifest 把该 ID 放入 owned | validator | 返回 `test-slice-test-id-unknown` 并指出 owned 字段路径；runner 不启动，不把 ID 补入 C |
| UT-S32-45 | 新增或真实修改 ID 漏配 | C 含新增与语义修改 ID，manifest 分别遗漏一个 | validator 参数化执行 | 每个漏项返回 `test-slice-test-id-missing`；`O != C`；不得写 checkpoint/loop/marker |
| UT-S32-46 | changed ID 多片归属仍 fail-closed | 同一个 C 中 ID 同时位于两片 owned | validator | 返回 `test-slice-test-id-duplicate` 或 assignment ambiguous，列出两片；不自动选 owner、不重写 manifest |
| UT-S32-47 | removed ID 与 owned 解耦 | R 含 final 已不存在的 ID，C/O 不含它；再构造 manifest owned 含该 removed ID | reader + validator | 正例不要求 R 在 D 中存在或 owned；反例返回 unknown；R 不进入 eligible、pending、uncovered |
| UT-S32-48 | 不可信 change set 阻断且不误恢复 | 参数化：字段缺失、未知 schema、payload hash 错、target identity/hash 漂移；slice manifest 同时 missing/invalid | deriveSliceVerificationState / next action | `manifest_status=invalid`、reason=`test-slice-manifest-invalid`，含精确 `test-slice-change-set-*` violation 与 `human_action_required=true`；`next_node` 不为 `plan-slices`，零 Gate/loop/checkpoint/runner 副作用 |
| UT-S32-49 | 跨仓事故的 C 精确为六 ID | before 含 UT-S10-121～129 与 ST-S10-36～39；final 原样携带其中 12 个，修改 UT-S10-129，新增 UT-S10-137～140 与 ST-S10-44 | 结构化差异后交给 reader/validator | C 精确按 ASCII 排序为 ST-S10-44、UT-S10-129、UT-S10-137、UT-S10-138、UT-S10-139、UT-S10-140；12 个原样 ID 留在 B 且不得 owned；无 18-ID 假阳性 |

### 12.2 场景测试用例补充

| ID | 描述 | 覆盖步骤 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S32-14 | 五个消费者对同一 C/R 同源一致 | S32 读取与校验主路径 | 准备一个有效 marker/targets 快照，依次执行 `status`、`next`、`change-lint`、manifest validator 与 `verify` | 五者报告的 C/R、provenance、validity 与 violation 排序一致；无命令扫描 Delta 或产生影子集合 |
| ST-S32-15 | change set 有效时保留 slice manifest 恢复 | S32 manifest 恢复分支 | 有效 change set + 依次构造 slice manifest missing/invalid/stale，调用 `next`，由 slice-planner 重建后复检 | 三态均派 `plan-slices`；只替换 manifest并保持 tasks、SLICES_APPROVED、checkpoint；复检后按 C 唯一归属继续 |
| ST-S32-16 | change set 不可信时保持人工边界 | S32 change-set 失败分支 | 有效 slice manifest + 篡改 change-set schema/hash/target，跨进程调用 `status`、`next` 与 `verify` | 每次稳定返回 human action required；不派 slice-planner，不启动 runner，不写/推进 Gate、loop、checkpoint、tasks 或 VERIFY marker |

### 12.3 测试数据与断言

- 事故 fixture 必须逐 ID 断言六个 C 和十二个 B，不得只断言数组长度。
- UT-S32-48/ST-S32-16 必须对命令前后文件清单与逐文件 SHA-256 做快照，证明恢复和验收副作用为零。
- 测试 double 必须对 Delta scanner、Git 命令和 runner 入口设调用哨兵；不允许以“输出看似正确”替代单一入口证明。
- 所有数组、violations 和 JSON 输出需重复执行两次，证明 ASCII 顺序及跨进程派生稳定。

### 12.4 覆盖度校验

- [ ] change set reader 与 C/R authority：UT-S32-43、ST-S32-14
- [ ] 原样、漏配、重复归属与删除：UT-S32-44～UT-S32-47
- [ ] 不可信 change set 分层阻断：UT-S32-48、ST-S32-16
- [ ] 跨仓事故精确六 ID：UT-S32-49
- [ ] 有效 change set 下的 manifest recovery：ST-S32-15

## S32 此前不可见的测试 ID 进入切片归属测试

### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S32-50 | changed 集合接纳 JSON 系 ID | Step 1→4 | 本次 test delta 中含 `UT-JSON-09` 形态的表格首列 ID | 求 `test_change_set` 的变更 ID 集合 | 该 ID 被捕获。**修复前它在筛选阶段即被丢弃、下游完全看不到** |
| UT-S32-51 | 未归属的 JSON 系 ID 判 manifest invalid | Step 5→7a | changed 集合含 JSON 系 ID；manifest 的任一切片 `owned_test_ids` 都不含它 | 求 `deriveSliceVerificationState` | 判 `test-slice-test-id-missing`、manifest 为 invalid，诊断点名该 ID。**修复前该情形被判 valid（假阴性）**——改动这些用例可以不规划任何切片 |

### 场景测试

| ID | 描述 | covered Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S32-17 | 真实 CLI 下归属校验闭环 | Step 1→7 | 真实 CLI；提案 test delta 含 JSON 系 ID | ① 不为其规划切片，求 manifest 状态；② 把该 ID 加入某切片 `owned_test_ids` 后重求 | ① invalid 并点名未归属 ID；② valid 且进入 slice-checkpoint 模式。证明归属判据本身未放宽，只是被校验的集合变大 |

### 追溯与覆盖

- AC-MERGEGATE-08 语法与数据一致（切片一侧）：UT-S32-50。
- AC-MERGEGATE-09 归属校验覆盖扩大且判据不放宽：UT-S32-51、ST-S32-17。
- 场景：S32 此前不可见的测试 ID 进入切片归属；功能规格：§2.51.7；架构：§四十一.6.1。

## S32 切片事务产物原子落盘测试

### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S32-52 | 两 slot 收齐后原子写出两产物 | Step 1→13b | spec-complete 提案；两 slot 内容合法 | 创建事务 → 提交两 slot → seal → apply | `[code]` 段与 `TEST_SLICE_MANIFEST.json` 同时存在；manifest 的 `task_fingerprint` 与实际 `[code]` 段一致；phase=completed 且 receipt 非空 |
| UT-S32-53 | apply 中途失败整体回滚，无半写态 | Step 12a→13a | 同上；在写第二个产物前注入失败 | apply | 两产物**同时不存在**；phase=failed 且诊断点名失败环节。**这是不变量 H 唯一的直接证据**——只验证成功路径无法区分「构造保证」与「纪律维持」 |
| UT-S32-54 | task_fingerprint 由 OpenLogos 自算 | Step 10 | slot 内容中携带一个伪造的 `task_fingerprint` | apply 后读 manifest | 落盘的指纹等于对**实际写出的** `tasks.md` 计算所得，与 slot 中提供的伪造值不同；事务不采信外部指纹 |
| UT-S32-55 | 整节替换守恒 | Step 9 | `tasks.md` 含 `[delta]`（部分 checkbox 已勾选）与 `[deploy]` 段 | apply | `[code]` 段被替换；`[delta]` / `[deploy]` 段及其 checkbox 状态**字节恒等** |
| UT-S32-56 | 恢复事务 slot 收窄且 [code] 冻结 | 恢复差异表 | manifest 处于 invalid 态的提案 | 创建 `origin=manifest-recovery` 事务 → 提交 `slot_slices` → apply | `content_slots.required` 为 1；提交 `slot_codesection` 被拒；apply 后 `[code]` 段字节恒等，仅 manifest 被重写 |
| UT-S32-57 | Agent 直接写产物的路径不存在 | 不变量 1 | 已加载 `cli/src/**` | 扫描 `writeTestSliceManifestAtomic` 与 `[code]` 段写入器的调用方 | 调用方**只在**切片事务的 apply 路径内；不存在命令或导出让外部直接写这两个产物。修复前该函数调用方为 0 处、实际写入者是 Agent——本用例锁的正是写入权归位 |
| UT-S32-58 | 单活跃事务与 apply 幂等 | 不变量 6、异常边界 | 已有活跃切片事务的提案 | ① 再次创建事务；② completed 后重复 apply | ① 拒绝或返回既有事务，不产生第二个活跃事务；② 幂等，返回既有 receipt，产物字节不变 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S32-18 | 真实 CLI 下 initial-plan 全链 | Step 1→13b | 真实 CLI；spec-complete 的 launched 夹具提案 | `slice transaction status` → 两次 `submit-content` → `seal` → `apply` → `status` | 各阶段 phase 依次为 collecting/ready/sealed/completed；apply 后两产物落盘且一致；envelope 公开 `schema_sha256` 与 `contract_sha256`；全程 Agent 只用了 `submit-content` |
| ST-S32-19 | 真实 CLI 下恢复全链与写动作白名单 | 恢复差异表、异常边界 | 真实 CLI；manifest 已失效的提案 | ① `next --format json` 取事务投影；② 提交 `slot_slices` 后 `seal`、`apply`；③ 对已 sealed 事务再次 `submit-content` | ① 投影 `origin=manifest-recovery` 且 `required=1`；② apply 后 `[code]` 字节恒等、manifest 恢复合法；③ 动作不在 `allowed_actions` 中被拒且无副作用 |

### 追溯与覆盖

- AC-SLICETX-03 slot 收齐进 ready：UT-S32-52、ST-S32-18。
- AC-SLICETX-04 原子写与整体回滚：UT-S32-52、UT-S32-53。
- AC-SLICETX-05 整节守恒：UT-S32-55。
- AC-SLICETX-06 指纹自算：UT-S32-54。
- AC-SLICETX-07 恢复 slot 收窄与 `[code]` 冻结：UT-S32-56、ST-S32-19。
- AC-SLICETX-10 旧路径不存在：UT-S32-57。
- 场景：S32 切片产物经事务原子落盘；功能规格：§2.53.3～§2.53.6、§2.53.8；架构：§四十三.1、§四十三.2；安装态：SMOKE-core-175。

## S32 apply 终态自校验测试


### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S32-59 | 业务非法 slot 触发整体回滚，无半写态 | Step 12b→13c | spec-complete 提案；slot 结构合法但业务非法：`spec_targets` 指向非测试规格文档、`task_text` 与 `[code]` 行不一致 | 创建事务 → 提交两 slot → seal → apply | apply 失败；`tasks.md` 与 `TEST_SLICE_MANIFEST.json` **同时**恢复到 apply 前字节（manifest 原不存在则仍不存在）；`phase=failed`、`classification=recovery_required`。**证伪门**：把 apply 的自校验分支去掉后本用例必须变红——若去掉后仍绿，说明断言实际锁的是别的东西 |
| UT-S32-60 | 修正 slot 后重新提交可正常抵达 completed | Step 12b→13b | 承接 UT-S32-59 的 failed 事务 | 修正 `spec_targets` 与 `task_text` → 重新 submit-content → seal → apply | 事务抵达 `completed` 且出具 receipt；`deriveSliceVerificationState()` 判 manifest 为 `valid`；不需要删除任何 OpenLogos 拥有的文件即可完成修复 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S32-20 | 真实 CLI 下 violations 保真且可定位到字段 | Step 12c→13c | 真实 CLI；业务非法 slot 的 launched 夹具提案 | `submit-content` ×2 → `seal` → `apply` → `status --format json` | apply 以非零退出；失败投影中 violations **原样保留** `code` / `path` / `message` / `fix_hint`，可据此定位到具体的 `spec_targets` 值与具体的 `task_text` 行；不得压缩为单条摘要 |

### 追溯与覆盖

- AC-SLICEFIX-01 apply 写盘后置 completed 前调用既有判定器复核：UT-S32-59。
- AC-SLICEFIX-02 业务非法 slot 整体回滚且无半写态：UT-S32-59。
- AC-SLICEFIX-03 violations 保真可定位：ST-S32-20。
- AC-SLICEFIX-04 修正后可正常 completed：UT-S32-60。
- 场景：S32 切片产物经事务原子落盘（Step 12b～13c）；功能规格：§2.53.5.1；架构：§四十三.2.1；安装态：SMOKE-core-176。

**用例设计约束**：UT-S32-59 的 slot 内容必须**结构合法**（JSON 合法、四个必填字段齐备），非法只体现在业务层面。若用缺字段或非 JSON 构造，命中的是 `parseSlicesSlot` 的既有结构校验，与本缺陷无关——报告 §七 已明确「只断言结构非法不覆盖本缺陷」。

## S32 终态判定三分支与单切片解阻断测试（fix-apply-verdict-not-applicable-vs-invalid）

> 本节补充 apply 终态守门的三分支回归；实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。

### 单元测试

| ID | 描述 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|
| UT-S32-61 | 单切片计划 apply 达 completed | spec-complete 提案，`[code]` 计划为一条标注真实测试 ID 的切片；两 slot 经 submit-content 收齐并 seal | `apply` | `phase=completed`、receipt 出具；`tasks.md` 的 `[code]` 段正确写出且 `[delta]`/`[deploy]` 字节恒等；manifest 落盘（惰性）；无任何回滚 |
| UT-S32-62 | 三种判定结果去向矩阵 | 参数化构造三形态：① 单切片（判定器不适用→null）；② 两切片全部合法（valid）；③ 两切片但 slot 业务非法（`spec_targets` 指向非测试规格文档→invalid） | 各自走完整 seal→apply | ① ② 均 `completed`；③ 复用与写盘异常同一条回滚路径整体回滚，`phase=failed`、`classification=recovery_required`、两产物同时恢复到 apply 前字节、violations 原样保真（含 `code`/`path`/`message`/`fix_hint`） |
| UT-S32-63 | 失败文案不出现 unknown、失败必伴随非零违规 | 沿用 UT-S32-62 的 ③ 夹具 | 检查 apply 失败输出与事务投影 | 错误文案不含字符串 `unknown`；`violations.length > 0`；放行路径（①②）不产生任何失败文案。**证伪门**：把守门判据改回 `status !== 'valid'` 后，① 必然回滚且复现「unknown + 0 条违规」组合，本用例与 UT-S32-61 必须同时变红 |
| UT-S32-64 | 恢复语义按适用性分流 | ① 多切片计划抵达 completed 后删除 manifest（保留事务文件）；② 单切片计划抵达 completed 后删除 manifest（保留事务文件） | 各自经 canonical 判定取投影并尝试恢复 | ① 仍可创建 `origin=manifest-recovery` 事务、`required=1`、`[code]` 段字节恒等——0.14.12 终态不堵恢复能力不回退；② 判定器按设计不适用（derive 恒 `null`）→ **不产生恢复事务**——manifest 为惰性产物、删除后无恢复需求，这是「无需恢复」的正确形态而非堵塞 |

### 场景测试

| ID | 描述 | 前置/故障注入 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S32-21 | 真实 CLI 单切片全链与多切片零回归 | 临时 launched 项目 ×3：A=单切片计划，B=两切片健康计划，C=两切片业务非法 slot | A：submit-content ×2 → seal → apply；B：健康全链 apply；C：业务非法 slot 全链 apply | A 全链经公开 `openlogos slice transaction` 命令抵达 completed、`[code]` 正确写出、manifest 落盘、输出不含 `unknown`；B 健康路径 completed；C 整体回滚且 violations 保真、守门文案不含 `unknown`、无半写态；三项目相互无干扰 |

### 追溯与覆盖

- AC-VERDICT-01 单切片可写出 `[code]`：UT-S32-61、ST-S32-21。
- AC-VERDICT-02 三分支去向矩阵：UT-S32-62。
- AC-VERDICT-03 多切片与业务非法不回归：UT-S32-62、ST-S32-21（回归锚：UT-S32-59～UT-S32-60、ST-S32-20）。
- AC-VERDICT-04 终态不堵恢复（多切片形态不回退；单切片按设计无恢复语义）：UT-S32-64。
- AC-VERDICT-05 文案如实：UT-S32-63。
- 场景：S32 切片产物经事务原子落盘（三分支主时序）；功能规格：§2.55；架构：§四十三.2.1；根规范：`spec/test-slice-manifest.md` §2.2.1。

## S32 已完成规划的受控重划测试（support-slice-replan-on-completed-plan）

> 本节补充 reopen 回边的准入、留痕、产物替换与 fail-closed 回归；实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。

### 单元测试

| ID | 描述 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|
| UT-S32-65 | 重开准入矩阵（批准分流） | 参数化三态：① completed + 无 `SLICES_APPROVED`；② completed + marker 在场、未附确认；③ completed + marker 在场、附确认 | 各自执行 `reopen --reason "规划证伪"` | ① 重开成功进入 `collecting`（`origin=initial-plan`、`required=2`）；② 拒绝且文案给出附 `--confirm-approved` 的可执行指引、零副作用（无留痕/归档/marker 变化）；③ 重开成功且 `SLICES_APPROVED` 被作废；`--reason` 缺失或空白一律拒绝 |
| UT-S32-66 | 留痕字段与 append-only | 连续两次重划（首次规划→reopen→新 apply→再 reopen） | 读取 `SLICE_REPLANS.jsonl` | 两行记录各含 `schema=openlogos/slice-replan@1`、正确的旧 `transaction_id`、时刻、非空原因、`slices_approved_present`/`confirmed` 标记；首行在第二次重开后字节不变（append-only） |
| UT-S32-67 | 产物整体替换与旧证据作废 | completed（划分 A，含一条与旧 manifest 匹配的 PASS checkpoint）→ reopen → 提交不同划分 B → seal/apply | 对比重开前后与 apply 前后的两产物及 checkpoint 采信 | 重开后、apply 前 `[code]`/manifest 仍为划分 A（无半新半旧窗口）；apply 后两产物完全为划分 B、无 A 残留、`manifest_sha256` 变化；旧 checkpoint 因失配不被 verify 状态采信；旧事务归档于 `slice-transactions/` 且 receipt 可读 |
| UT-S32-68 | fail-closed 与零回归 | ① 事务文件不可读（权限/损坏夹具）；② 非 completed phase（collecting/failed）执行 reopen；③ completed 不执行 reopen | ①② 执行 `reopen`；③ 执行既有动作集 | ①② 拒绝且无任何写副作用（无留痕/归档/marker 变化）；② 报 `action_not_allowed` 且既有出路不变；③ submit-content/abort 仍被拒、投影与 0.14.14 逐项一致（`reopen` 为唯一新增动作） |

### 场景测试

| ID | 描述 | 前置/故障注入 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S32-22 | 真实 CLI 重划全链 | 临时 launched 项目，spec-complete 提案 | 首次单切片规划 apply 达 completed → `reopen --reason` → 提交**两切片**新划分 → seal → apply → completed；全程经公开 `openlogos slice transaction` 命令 | 重开后投影 `phase=collecting`、`required=2`；新 apply 后 `[code]` 为两切片、manifest 两条 slice、无旧划分残留；留痕含旧 `transaction_id`；旧事务归档；`manifest-recovery` 的既有路径（另夹具删 manifest）不受影响 |

### 追溯与覆盖

- AC-REPLAN-01/04 准入矩阵与批准分流：UT-S32-65、ST-S32-22。
- AC-REPLAN-02 整体替换：UT-S32-67、ST-S32-22。
- AC-REPLAN-03 留痕：UT-S32-66。
- AC-REPLAN-05/07 fail-closed 与零回归：UT-S32-68。
- AC-REPLAN-06 旧证据作废与归档：UT-S32-67。
- AC-REPLAN-08 两回边互不顶替：ST-S32-22（回归锚：UT-S32-59～64、ST-S32-20～21）。
- 场景：S32 已完成规划的受控重划；功能规格：§2.56；架构：§四十四；根规范：`spec/test-slice-manifest.md` §2.4。

## reopen 后切片归属消费回归

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S32-69 | 前滚 change set 下 owned 校验放行 | SPEC_MERGED.test_change_set 为前滚结果（changed 含首轮 ID A/B 与本轮 ID C）：多切片 manifest 分别 own A/B 与 C 均通过 owned⊆changed；reader 不读 deltas/test、不读归档 |
| UT-S32-70 | removed 后写胜出的消费行为 | 前滚结果 removed 含被本轮删除的首轮 ID X：own X 触发 `test-slice-test-id-unknown` 并指出 owned 字段路径；changed 不含 X |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S32-23 | reopen 后多切片规划全链 | 真实命令链驱动 reopen 重合并（测试目标幂等）后进入切片规划：多切片 manifest 校验通过、slice-aware verify 按归属豁免未完成切片 ID、删后续证伪门成立；全程消费者只读当前 marker |

### 自动化与证据要求

- 消费侧断言必须经共享 TestChangeSetReader / validateTestSliceManifest 公开路径，禁止绕过 reader 直读 marker 字段断言。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S32"`；失败不得写 pass。

## 事务创建时机前移消费回归

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S32-71 | next 已建后 submit-content 幂等续用 | `next` 问即建创建事务 X 后执行 `submit-content --slot slot_codesection`：不重建（`transaction_id` 仍为 X）、slot 正常受理、phase 推进语义与懒创建路径逐项一致；后续 seal/apply 合同零变化 |
| UT-S32-72 | 懒创建路径零回归 | 无 `next` 前置（事务文件不存在）直接 `submit-content`：用即建照旧创建 initial-plan 事务并受理内容——行为与 0.14.22 逐项一致；终态事务在场时新一轮 `submit-content` 的归档让位语义不变 |

### 追溯与覆盖

- 前移后续用：UT-S32-71；懒创建兜底零回归：UT-S32-72。
- 场景：S32 initial-plan 事务创建时机前移；功能规格：§2.65.2 / §2.65.3；根规范：`spec/test-slice-manifest.md`（创建时机合同）。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S32"`；失败不得写 pass。
