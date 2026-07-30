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
