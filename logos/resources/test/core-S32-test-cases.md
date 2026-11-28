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

## S32 切片规划单条受控写入口测试

> 覆盖 `openlogos slice plan --file <slices.json>` 的一次性落盘、结构化校验的零副作用、幂等重规划，以及「结构化事实源不得由散文解析替代」这一不变量。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S32-90 | 一次调用完成落盘且指纹自算 | 结构化 `slices.json`（2 个切片）→ `openlogos slice plan --file` 一次调用后：`tasks.md` 的 `[code]` 段按切片顺序写入、`TEST_SLICE_MANIFEST.json` 在场且 `slices` 与输入逐字段一致、`task_fingerprint` 等于依**刚写出的** `tasks.md` 重算之值、`spec_fingerprint` 依 `spec_targets` 计算；`[delta]` / `[deploy]` 段与其勾选状态**字节恒等**；全程无 slot / staging / seal / receipt 文件产生 |
| UT-S32-91 | 结构化校验失败零副作用 | 分别构造：非法 JSON、空数组、缺 `owned_test_ids`、`slice_id` 重复、`owned_test_ids` 含未定义 ID → 各自非零退出并报对应稳定错误码（`SLICE_PLAN_INPUT_INVALID` / `SLICE_PLAN_DUPLICATE_SLICE_ID` / `SLICE_PLAN_UNKNOWN_TEST_ID`）；每种情形下 `tasks.md` 与 `TEST_SLICE_MANIFEST.json` 的字节与 mtime **均不变** |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S32-40 | 规划 → 增量验收 → 重规划幂等的端到端 | 真实 CLI：① `slice plan` 写入 2 切片 → ② `openlogos verify` 以 `slice-checkpoint` 模式运行，`eligible` 仅含基线与切片 1 的 `owned_test_ids`（**证明增量验收能力零回归**）→ ③ 修改 `slices.json` 后重跑 `slice plan`，`[code]` 与 manifest 幂等覆盖、无终态相位、无需重开通道 → ④ 手工改动 `[code]` 造成指纹 stale，`status` / `next` / `verify` 输出 stale **告警但不阻断**（审计产物不参与流程分支判定） |

### 追溯与覆盖

- AC-SLICE-PLAN-01 一次调用完成落盘与指纹自算：UT-S32-90、ST-S32-40 步骤①。
- AC-SLICE-PLAN-02 校验失败零副作用：UT-S32-91。
- AC-SLICE-PLAN-03 增量验收能力零回归：ST-S32-40 步骤②。
- AC-SLICE-PLAN-04 重规划幂等、无终态相位：ST-S32-40 步骤③。
- AC-SLICE-PLAN-05 指纹 stale 告警不阻断：ST-S32-40 步骤④。
- 场景：`core-S32-slice-planning.md`「S32 切片规划单条受控写入口时序」；功能规格：§2.68；JSON 契约：`spec/cli-json-output.md`「openlogos slice plan 输出合同」。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S32"`；失败不得写 pass。

## 二次合并后切片归属消费回归

> 覆盖 change set 提案级语义在二次合并（回滚重来）后对切片归属的影响，判据与 ID 逐条沿用。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S32-69 | 多轮 ID 并存的 change set 下 owned 校验放行 | SPEC_MERGED.test_change_set 的 changed 同时含 ID A/B 与 C：多切片 manifest 分别 own A/B 与 C 均通过 owned⊆changed；reader 不读 deltas/test |
| UT-S32-70 | removed 后写胜出的消费行为 | removed 含被本提案删除的 ID X：own X 触发 `test-slice-test-id-unknown` 并指出 owned 字段路径；changed 不含 X |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S32-23 | 二次合并后多切片规划全链 | 真实命令链：首次 `merge` → 回滚主文档并删除 `SPEC_MERGED` → 修正测试 delta 后二次 `merge`（无 reopen 通道）→ 进入切片规划：多切片 manifest 校验通过、slice-aware verify 按归属豁免未完成切片 ID、删后续证伪门成立；全程消费者只读当前 marker |

### 自动化与证据要求

- 三条用例均只读当前 `SPEC_MERGED`，不得读取任何历史或归档来源补齐 changed/removed。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S32"`；失败不得写 pass。

## S32 slice plan 恢复重跑与 checkbox 保留测试

> 覆盖 `openlogos slice plan` 作为**恢复与重划唯一入口**时的 checkbox 保留判据（功能规格 §2.68.5；根规范 `spec/test-slice-manifest.md` §2.3、§2.4；JSON 契约 `spec/cli-json-output.md`「重跑时的 checkbox 保留」）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S32-92 | 初次规划零回归 | 提案 `[code]` 为占位（无既有切片条目）且无在盘 `TEST_SLICE_MANIFEST.json` 时执行 `slice plan`：写出的每条 `[code]` 条目均为 `- [ ] <task_text>`，`[code]` 文本、条目顺序与 manifest 内容**与本变更前逐字一致**；`slice_count` / `slice_ids` / `manifest_path` 取值不变。证明恢复语义对初次调用无副作用、既有 `slices.json` 输入零改动即得旧行为 |
| UT-S32-93 | `task_text` 未变则保留勾选、变更则重置 | 前置：`[code]` 含两条且第一条为 `- [x]`，在盘旧 manifest 的 `slice_id → task_text` 与之对应。① 用**逐字相同**的 `slices.json` 重跑 → 第一条仍为 `- [x]`、第二条仍为 `- [ ]`；② 仅把第一条切片的 `task_text` 改一个字符后重跑 → 该条重置为 `- [ ]`。两次重跑的 `[delta]` / `[deploy]` 段与其勾选状态**字节恒等** |
| UT-S32-94 | 混合场景逐条目独立判定 | 四片场景：`slice-01` 已勾且 `task_text` 未变、`slice-02` 已勾但 `task_text` 被改写、`slice-03` 未勾且未变、`slice-04` 为新增 `slice_id` → 重跑后依次为 `- [x]` / `- [ ]` / `- [ ]` / `- [ ]`。判定逐条目独立，不因同批中存在被改写的切片而牵连未改写的切片 |
| UT-S32-95 | 旧 manifest 缺失时按 `[code]` 文本回退匹配 | 前置：`[code]` 含两条且第一条为 `- [x]`，**删除** `TEST_SLICE_MANIFEST.json`（manifest missing 的恢复形态）→ 以相同 `slices.json` 重跑：第一条勾选状态仍保留（判据退化为在旧 `[code]` 段中查找同文本条目，仍是「文本逐字相等才保留」），manifest 被重建且 `task_fingerprint` 等于依**刚写出的** `tasks.md` 重算之值 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S32-41 | manifest 失效 → 恢复重跑 → 进度不丢的端到端 | 真实 CLI：① `slice plan` 写入 2 切片并在 `slice-exit` 写 `SLICES_APPROVED`；② 完成切片 1 后 `openlogos verify` 以 `slice-checkpoint` 模式写入一条 checkpoint，`[code]` 第一条为 `- [x]`；③ 删除 `TEST_SLICE_MANIFEST.json`，`openlogos next` 输出 `next_node.id=plan-slices`、`skill=slice-planner`；④ 以**相同** `slices.json` 重跑 `openlogos slice plan --file` → 第一条仍为 `- [x]`、manifest 重建、`slice_ids` 与重建前一致；⑤ `SLICES_APPROVED` 与 `SLICE_CHECKPOINTS.jsonl` 的**字节均未变**（`slice plan` 不触碰这两个产物）；⑥ 恢复后 `deriveSliceVerificationState` 判 `valid` 且 `verify_mode=slice-checkpoint`，**`confirmed_slice_ids` 仍含切片 1**、`attempted_slice_id` 前移到切片 2——账本身份绑定判定实质（根规范 §6.1），恢复重建 manifest 不改变身份，故已完成切片不重跑；⑦ 首次规划与恢复后两份 manifest 的 `task_fingerprint`、`spec_fingerprint` 与判定实质身份**分别逐字相等**——步骤②已把切片 1 勾选，故本条同时锁住「勾选不参与 `task_fingerprint`」（根规范 §4.1），它是⑥能成立的前提 |

### 追溯与覆盖

- AC-SLICE-RECOVER-01 初次规划零回归、无需区分初次/恢复形态：UT-S32-92。
- AC-SLICE-RECOVER-02 `task_text` 逐字相等才保留勾选，变更即重置：UT-S32-93。
- AC-SLICE-RECOVER-03 逐条目独立判定（混合场景与新增切片）：UT-S32-94。
- AC-SLICE-RECOVER-04 旧 manifest 缺失时的回退判据仍保留进度：UT-S32-95、ST-S32-41 步骤④。
- AC-SLICE-RECOVER-05 `SLICES_APPROVED` 与 checkpoint 不被 `slice plan` 触碰：ST-S32-41 步骤⑤。
- AC-SLICE-RECOVER-06 恢复后增量验收从未完成切片继续、已完成切片不重跑：ST-S32-41 步骤⑥、ST-S32-42。
- 功能规格：§2.68.5、§2.77；根规范：`spec/test-slice-manifest.md` §2.3、§2.3.1、§2.4、§6.1、§9；JSON 契约：`spec/cli-json-output.md`「openlogos slice plan 输出合同」。
- **AC-SLICE-RECOVER-06 的实现前提**：checkpoint 身份必须绑定判定实质而非 manifest 文件字节，否则 `generated_at` 每次重建都不同、账本必然作废（见「S32 checkpoint 身份绑定测试」与 §2.77.0 的实证）。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S32"`；失败不得写 pass。
- 保留判据是**构造保证**，因此断言必须直接读回磁盘上的 `tasks.md` 字节比对勾选状态，不得以命令 stdout 的自述作为通过依据。

## S32 checkpoint 身份绑定测试

> 覆盖 checkpoint 账本的身份绑定：绑定对象为 manifest 的**判定实质**（`schema` / `change` / `module` / `slices` / `task_fingerprint` / `spec_fingerprint` 的规范化 JSON SHA-256，排除 `generated_at`），以及 `openlogos/slice-checkpoint@1` / `@2` 的按行兼容读（功能规格 §2.77；根规范 `spec/test-slice-manifest.md` §6.1～§6.3、§8、§11）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S32-96 | `generated_at` 不参与身份 | 构造两份 manifest：仅 `generated_at` 不同（其余含 `slices` 顺序、两个 fingerprint 全部逐字相同）→ 身份哈希**相等**；同时两份的**文件字节哈希不相等**（证明旧绑定确会作废账本，本用例即 §2.77.0 实证的回归化） |
| UT-S32-97 | 判定实质变化即身份变化 | 分别改动：① 某片 `slice_id`；② 某片 `task_text`；③ 某片 `owned_test_ids`；④ 两片顺序对调；⑤ `task_fingerprint`；⑥ `spec_fingerprint` → 六种情形身份**均变化**。顺序对调必须变化——顺序是划分的一部分 |
| UT-S32-98 | 混合账本按行 schema 分派 | 账本同时含 `@1` 行（`manifest_sha256` = 旧的 manifest 文件字节哈希）与 `@2` 行（= 新身份）→ 两者**各按其 schema 匹配**、同时进入确认集合；把 `@1` 行的值换成新身份则该行不匹配（证明未按行分派会误判） |
| UT-S32-99 | 未知 checkpoint 主版本保守处置 | 账本含 `openlogos/slice-checkpoint@9` 行 → 该行不进入 `confirmed_slice_ids`、**不产生 violation、不中断 validator**，同账本内 `@1` / `@2` 行照常被采信；与 manifest 自身 `test-slice-manifest-unsupported` 的阻断语义互不牵连 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S32-42 | 恢复保住账本、重划作废账本的互为反例端到端 | 真实 CLI：① `slice plan` 写入 2 切片，切片 1 写入 PASS checkpoint 并勾选；② 删除 `TEST_SLICE_MANIFEST.json` 后以**相同** `slices.json` 重跑 → 重建前后的 `task_fingerprint`、`spec_fingerprint` 与身份**分别相等**（尽管①已勾选切片 1），`confirmed_slice_ids` 仍含切片 1、`attempted_slice_id` 为切片 2、`verify_mode=slice-checkpoint`；③ 改动 `slices.json`（改写某片 `task_text` 或调整划分）后重跑 → `confirmed_slice_ids` **变空**、`attempted_slice_id` 回到第一片；④ 全程 `SLICE_CHECKPOINTS.jsonl` 只增不改，②③ 两步均未删除或重写历史行 |

### 追溯与覆盖

- AC-SLICE-ID-01 `generated_at` 排除在身份之外：UT-S32-96。
- AC-SLICE-ID-02 判定实质（含 `slices` 顺序、两个 fingerprint）变化即身份变化：UT-S32-97。
- AC-SLICE-ID-07 勾选变化不改变 `task_fingerprint`，故不改变身份（恢复保账本的前提）：ST-S32-41 步骤⑦、ST-S32-42 步骤②。
- AC-SLICE-ID-03 `@1` / `@2` 混合账本按行分派：UT-S32-98。
- AC-SLICE-ID-04 未知主版本保守不采信且不中断：UT-S32-99。
- AC-SLICE-ID-05 恢复保住账本 / 重划作废账本互为反例：ST-S32-42 步骤②③。
- AC-SLICE-ID-06 账本 append-only、历史行不改写：ST-S32-42 步骤④。
- 功能规格：§2.77；根规范：`spec/test-slice-manifest.md` §2.3、§2.4、§6.1～§6.3、§8、§11；JSON 契约：`spec/cli-json-output.md`「指纹语义（降级为观察）」。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S32"`；失败不得写 pass。
- UT-S32-96 必须**同时**断言「身份相等」与「文件字节哈希不等」。只断言前者的话，把身份函数错写成常量也能通过——两条一起断言才锁住「换了绑定对象」这件事本身。
- ST-S32-41 步骤⑦ 与 ST-S32-42 步骤② 的指纹相等断言**必须在切片已勾选之后**求值。若在勾选前比较，「勾选不参与 `task_fingerprint`」这一前提根本没被检验，而它一旦不成立，即使排除了 `generated_at`，恢复后的身份仍会变化、AC-SLICE-RECOVER-06 与 AC-SLICE-ID-05 一并落空。

## S32 slice plan 写入侧 fail-closed 测试

> 覆盖写入侧判据单点化与 fail-closed 落盘（功能规格 §2.78；根规范 `spec/test-slice-manifest.md` §2.2、§2.2.1、§10；场景 S32「切片规划单条受控写入口时序」EX-32.23～EX-32.25）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S32-100 | 非法 `spec_targets` 被写入口拒绝 | 构造合法度其余各项均满足、仅某片 `spec_targets` 含不在 `logos/resources/test/` 下路径的 `slices.json`（复刻 2026-09-10 事故输入：把全部 7 个 merge 目标填入）→ `slice plan` **非零退出**且退出码为 2；stdout 逐条列出 validator violations，每条含 `code` / `path` / `message` / `fix_hint` 且 `path` 精确指向出问题的切片与字段。**修复前该输入被写入口放行、两产物照常落盘，直到下游 `next` 才判 `test-slice-manifest-invalid`** |
| UT-S32-101 | 拒绝时两产物零改写（原子性） | 前置：`tasks.md` 与 `TEST_SLICE_MANIFEST.json` 已有有效内容，记录二者字节与 mtime。以 UT-S32-100 的非法输入执行 → 两文件的**字节与 mtime 均不变**；提案目录下不残留任何临时文件。特别地，`tasks.md` 不得出现「已被新 `[code]` 段覆盖」的中间态——**修复前的实现先以普通 `writeFileSync` 提交 `tasks.md` 再写 manifest，该断言必失败** |
| UT-S32-102 | 判据取自读取侧单点，写入口无副本 | 参数化构造读取侧 `deriveSliceVerificationState` 判为 `invalid` 的各类输入（`spec_targets` 越界、`owned_test_ids` 未归属 / 不存在、`slice_id` 重复、`task_text` 空、数组字段为空）→ 每一类均被 `slice plan` 拒绝，且其输出的 violation `code` 与直接调用读取侧 validator 对同一产物所得**逐条相等**（集合、顺序、`fix_hint` 全同）。断言写入侧不产生读取侧没有的码、也不遗漏读取侧有的码 |
| UT-S32-103 | 合法输入零行为变化 | 以既有合法 `slices.json`（≥2 切片）执行 → exit 0；`[code]` 段文本与条目顺序、五个 `data` 字段与本变更前**逐字节一致**；`TEST_SLICE_MANIFEST.json` 除新增的 `verify_scope` 字段外逐字节一致，`data` 除新增的 `verify_scope` / `verify_scope_source` 外不变，人读摘要除新增的「验收范围」行外逐字节一致（slice-verify-efficient-mode 修订比较基准，新增部分由 UT-S32-116 断言）；`task_fingerprint` 仍等于依刚落盘的 `tasks.md` 重算之值。证明校验前置只增加一次判定，不改变任何合法产出 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S32-43 | 非法输入当轮自愈的端到端 | 真实 CLI，临时项目：① 以含非法 `spec_targets` 的 `slices.json` 执行 `openlogos slice plan --file` → exit 2，两产物字节未变，输出含可定位的 `fix_hint`；② `openlogos next` 此时**不出现** `test-slice-manifest-invalid` 阻塞（因为非法产物根本没有落盘），前沿仍停在 `plan-slices`；③ 依 ① 的 `fix_hint` 把 `spec_targets` 改为 `logos/resources/test/` 下的真实测试规格路径后重跑 → exit 0，两产物落盘且互相一致；④ `openlogos verify` 进入 `slice-checkpoint` 模式，增量验收能力零回归。全程未产生 `blocked(no-progress)` 形态的停点 |

### 追溯与覆盖

- AC-SLICE-FAILCLOSED-01 非法 `spec_targets` 在写入口即被拒绝并给出可定位违规：UT-S32-100、ST-S32-43 步骤①。
- AC-SLICE-FAILCLOSED-02 拒绝时 `tasks.md` 与 manifest 均零改写、无临时文件残留：UT-S32-101、ST-S32-43 步骤①。
- AC-SLICE-FAILCLOSED-03 写入侧与读取侧判据逐条同源（无手抄副本）：UT-S32-102。
- AC-SLICE-FAILCLOSED-04 违规明细原样输出、退出码 2、操作错误仍为 1：UT-S32-100、UT-S32-102。
- AC-SLICE-FAILCLOSED-05 合法路径零行为变化：UT-S32-103、ST-S32-43 步骤③④。
- 功能规格：§2.68、§2.78；根规范：`spec/test-slice-manifest.md` §2.2、§2.2.1、§8、§10；场景：S32 EX-32.23～EX-32.25。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S32"`；失败不得写 pass。
- 「零改写」必须直接读回磁盘字节（含 mtime）比对，不得以命令 stdout 的自述作为通过依据——本次缺陷的形态正是「命令自称成功而产物不合法」。
- UT-S32-102 的两侧对照必须调用**同一个** validator 入口取基准值，禁止在测试内复述一份期望违规清单——那会把判据副本从实现搬进测试。

## S32 切片规划冻结验收范围测试

> 覆盖场景 `core-S32-slice-planning.md`「S32 切片规划冻结验收范围时序」（Step 1～8、EX-32.26～EX-32.32），功能规格 §2.101.2～§2.101.6，根规范 `spec/test-slice-manifest.md` §2.3.2、§2.4、§3、§6.1，`spec/cli-json-output.md`「status/next slice_verification_state」「openlogos slice plan 输出合同」，决策 C02、proposal-r1 F1。既有 UT-S32-90～UT-S32-103、ST-S32-40～ST-S32-43（受控写入口、checkbox 保留、身份绑定、fail-closed）作为回归守护。测试实现必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`），测试名包含对应 ID，`scenario_id="S32"`。
>
> **夹具 FZ**：`mktemp -d` 一次性 git 项目，单模块 `core`（launched），活跃提案已 spec-complete。已合并测试规格共定义 N 个非 manual UT/ST 用例（各用例按需在三个变更用例之外增减基线用例来构造 N，故恒有 N≥3），另含 1 个 `[manual]` 用例；C = {UT-S90-01, UT-S90-02, UT-S90-03}。`slices.json` 两片：`slice-a` 拥有 UT-S90-01、UT-S90-02，`slice-b` 拥有 UT-S90-03。**`slices-v2.json`**：把 UT-S90-02 从 `slice-a` 移到 `slice-b`（划分改变）。「切片一已通过」指账本中有一行身份匹配当前 manifest 的 `openlogos/slice-checkpoint@2` `slice-a` PASS。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S32-104 | `auto` 阈值两侧的判定 | 配置缺省（`auto` / 1000）：N=999 → 首次 `slice plan` 写 `verify_scope: "baseline"`；N=1000 → 写 `"owned"`；`[manual]` 用例不计入 N（N=999 加 1 个 manual 仍为 `baseline`）。配置 `slice_scope_threshold: 4`：N=3（夹具 FZ 仅含三个变更用例）→ `baseline`、N=4（另加一个基线用例）→ `owned`。两种情形 `verify_scope_source` 均为 `decided`。启用模块范围的多模块夹具中 N 按全部已定义用例计，不与模块范围求交 |
| UT-S32-105 | `baseline` / `owned` 强制 | N=5000 且 `slice_scope: "baseline"` → 写 `baseline`；N=3（夹具 FZ 仅含三个变更用例，远低于缺省阈值）且 `slice_scope: "owned"` → 写 `owned`；均为 `decided` |
| UT-S32-106 | 配置非法只在判定路径拒绝 | `slice_scope: "full"` 或 `slice_scope_threshold` 为 0 / -1 / 1.5 / `"1000"`：① 首次规划（需判定）→ exit 1、错误码 `SLICE_PLAN_VERIFY_SCOPE_CONFIG_INVALID` 且点名配置项与取值，`tasks.md` 与 manifest 字节和 mtime 不变；② 在盘已有冻结 `owned` 的有效 manifest、以相同 `slices.json` 重跑（`retained` 路径）→ exit 0，照常沿用 `owned` |
| UT-S32-107 | 身份：`owned` 进哈希，`baseline` / 缺省与现行公式相同 | 对同一判定实质：缺 `verify_scope` 的 manifest、`verify_scope: "baseline"` 的 manifest 与以引入前公式计算的身份**三者相等**（与固化的引入前 golden 值逐字节相同）；`verify_scope: "owned"` 的身份与之**不同**，且等于在规范化 JSON 中加入 `"verify_scope":"owned"` 后的 SHA-256 |
| UT-S32-108 | 用例数跨阈值后同一划分重跑沿用 | N=999 首次规划得 `baseline`；把 N 增至 1500 后以相同 `slices.json` 重跑 → 仍为 `baseline`、`verify_scope_source="retained"`、身份不变；反向（首次 `owned` 后 N 降至 10）同样沿用 `owned` |
| UT-S32-109 | 反例 a：配置变化后的同一划分恢复保留范围、身份与已确认切片 | N=1200、配置缺省，首次规划冻结 `owned`，切片一已通过；把 `slice_scope_threshold` 改为 2000（按当前用例数应判 `baseline`）；分别从两种入口以相同 `slices.json` 重跑：① manifest 被破坏为 invalid（删除顶层必填字段 `module`），`next` 输出 `plan-slices` 后按指引重跑；② manifest 有效时的幂等重跑 → 写 `owned`、`verify_scope_source="retained"`；新 manifest 身份与重跑前相等；`deriveSliceVerificationState()` 的 `confirmed_slice_ids=["slice-a"]`、`attempted_slice_id="slice-b"` |
| UT-S32-110 | 反例 b：同样配置变化下真正重划重新判定并使旧身份失效 | 同 UT-S32-109 的前置与配置变化，改用 `slices-v2.json` 重跑 → 写 `baseline`、`verify_scope_source="decided"`；新身份与旧身份不同；`confirmed_slice_ids=[]`、`attempted_slice_id="slice-a"`；`SLICE_CHECKPOINTS.jsonl` 字节不变（旧行保留审计） |
| UT-S32-111 | 旧 manifest 缺 `verify_scope` 时恢复保留 baseline 与身份 | 以引入前格式写出的 manifest（无该字段）且切片一已通过；N=5000、配置缺省（按当前配置应判 `owned`）；以相同 `slices.json` 重跑 → 写出显式 `verify_scope: "baseline"`、`verify_scope_source="retained"`；身份与重跑前相等；`slice-a` 仍被采信 |
| UT-S32-112 | manifest 缺失：账本单命中恢复 | 两个变体：① 冻结 `owned` 且切片一已通过；② 冻结 `baseline` 且切片一已通过。删除 `TEST_SLICE_MANIFEST.json`，把配置改为与原值相反的强制取值，以相同 `slices.json` 重跑 → ① 写 `owned`、② 写 `baseline`，`verify_scope_source="recovered"`；身份等于删除前；`slice-a` 仍被采信；账本字节不变 |
| UT-S32-113 | manifest 缺失：账本双命中拒绝 | 账本中同一划分既有 `baseline` 候选身份的 `slice-a` PASS，又有 `owned` 候选身份的 `slice-a` PASS；manifest 缺失；重跑 → exit 1、错误码 `SLICE_PLAN_VERIFY_SCOPE_AMBIGUOUS`，错误 envelope 点名两个候选身份与命中的 `slice_id`；`tasks.md` 字节与 mtime 不变、manifest 仍不存在、无临时文件残留 |
| UT-S32-114 | manifest 缺失：账本无命中按当前配置判定 | manifest 缺失，账本分别为：① 不存在；② 只有 `@1` 行（其 `manifest_sha256` 为旧文件字节哈希）；③ 只有身份匹配的 FAIL 行；④ 只有属于另一划分身份的 PASS 行 → 四种均按当前配置判定，`verify_scope_source="decided"`；② 中的 `@1` 行不参与比对 |
| UT-S32-115 | manifest `verify_scope` 非法值 | 在盘 manifest 写 `verify_scope: "full"`（其余合法）→ `deriveSliceVerificationState()` 为 `invalid`，violation `code=test-slice-manifest-invalid`、`path` 指向 `verify_scope`、带 `fix_hint`；`next` 输出 `next_node.id=plan-slices`；verify 不启动 runner、不写 `VERIFY_FAIL` / `LOOP_ITERS`；随后以相同 `slices.json` 重跑 `slice plan` 时不沿用该值，走账本恢复（有匹配 PASS 时为 `recovered`） |
| UT-S32-116 | `slice plan` 输出带出范围与来源 | 成功执行 `slice plan --format json` → `data.verify_scope` 与 `data.verify_scope_source` 存在且取值与写入 manifest 的一致，既有五个字段不变；文本模式在 `task_fingerprint` 行之后恰有一行「验收范围：<verify_scope>（<verify_scope_source>）」；拒绝路径不输出这两个字段 |
| UT-S32-117 | `status` / `next` 的 `slice_verification_state.verify_scope` | manifest 有效且为 `owned` → 两命令均为 `"owned"`；旧 manifest 无该字段 → `"baseline"`；manifest 缺失或 invalid → `null`；同一磁盘状态下 status 与 next 逐字段同义；两命令输出通过打包的 status / next JSON Schema 校验；修改配置后不重新 `slice plan` 时该字段不变 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S32-44 | 配置变化后恢复保进度、重划才重判的端到端 | 真实 CLI，临时项目（N=1200、配置缺省）：① `slice plan` → `owned`；② `verify` 通过切片一并勾选；③ 把 `slice_scope_threshold` 改为 2000，破坏 manifest 使 `next` 输出 `plan-slices`，按 `next` 指引以相同 `slices.json` 重跑 `slice plan` → `owned`、`retained`；④ `next --format json` 的 `confirmed_slice_ids=["slice-a"]`、`attempted_slice_id="slice-b"`，`verify` 只验收 3 个 owned 用例；⑤ 改用 `slices-v2.json` 重跑 → `baseline`、`decided`，`next` 的 `confirmed_slice_ids=[]` 且 eligible 含基线用例。全程未手工编辑 `[code]` 或删除 OpenLogos 产物 |
| ST-S32-45 | manifest 缺失时由账本恢复冻结范围的端到端 | 真实 CLI：① `slice plan`（`slice_scope: "owned"`）并通过切片一；② 删除 `TEST_SLICE_MANIFEST.json`、把配置改为 `slice_scope: "baseline"`；③ `next` 输出 `test-slice-manifest-missing` 与 `plan-slices`；④ 以相同 `slices.json` 重跑 → `owned`、`recovered`；⑤ `verify` 继续从切片二开始、eligible 不含基线用例，切片一不被重跑验收 |

### 追溯与覆盖

- AC 用例数阈值与强制配置的判定：UT-S32-104、UT-S32-105、UT-S32-106。
- AC 范围计入身份且 baseline / 缺省身份与升级前相同：UT-S32-107、UT-S32-111。
- AC 冻结：用例数或配置变化不改变已冻结范围：UT-S32-108、UT-S32-109、ST-S32-44 步骤③④。
- AC 真正重划重新判定并使旧身份失效：UT-S32-110、ST-S32-44 步骤⑤。
- AC manifest 缺失时从账本恢复、双命中拒绝、无命中按配置判定：UT-S32-112、UT-S32-113、UT-S32-114、ST-S32-45。
- AC 非法 `verify_scope` 走既有恢复：UT-S32-115。
- AC 机器输出：UT-S32-116、UT-S32-117；UT-S32-103 修订后的比较基准。
- 功能规格：§2.101；根规范：`spec/test-slice-manifest.md` §2.3.2、§2.4、§3、§6.1；场景：S32 EX-32.26～EX-32.32。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S32"`；失败不得写 pass。
- 身份相等 / 不等必须调用生产代码的同一身份函数取值；UT-S32-107 的引入前 golden 值以固化常量断言，不得在测试内复写一份公式。
- 「零改写」「账本不变」直接读回磁盘字节与 mtime 比对，不以命令 stdout 自述为依据。

## S32 分层开启时切片 checkpoint 基线部分测试（layered-verification）

> 覆盖场景 `core-S32-slice-planning.md`「S32 分层开启时切片 checkpoint 的基线部分」（Step 1～5、EX-32.33～EX-32.37），以及 `core-S13-verify-results.md` 的 EX-13.54，功能规格 §2.109.6、§2.109.8、§2.109.9；需求 AC-VERIFY-TIER-13。
>
> **夹具 LS**：一次性 git 项目，单模块 `core`（launched）。已合并测试规格 `core-S01`（UT-S01-01～03）、`core-S02`（UT-S02-01、02）、`core-S03`（UT-S03-01、02，主链路小节列 UT-S03-01）、`core-S90`（本提案新增 UT-S90-01～03）。活跃提案有有效的切片清单：slice-a 拥有 UT-S90-01、02，slice-b 拥有 UT-S90-03；当前尝试 slice-a。提案声明 `scenarios: [S02]`；delta 触及 S90。记录型入口同 S13 夹具 LV。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S32-118 | baseline 范围的基线部分为受影响 ∪ 主链路 | §2.109.9、Step 1～5 | 夹具 LS；切片清单 `verify_scope: baseline`；`verify.layered.enabled: true` | `verify --format json` | `eligible_test_ids` = S02 的全部用例 ∪ {UT-S03-01} ∪ {UT-S90-01、02}；不含 S01 的用例与 UT-S03-02；`pending_test_ids=["UT-S90-03"]`；入口收到的清单等于 eligible（不是提案集合），`SLICE_SCOPE="baseline"`；`layers.execution.ids` 等于 eligible，`layers.total.ids` 为提案集合（含 UT-S90-03）；`summary.defined_count` 等于 eligible 的条数；入口没有上报 UT-S90-03，`uncovered_cases` 为空，checkpoint PASS |
| UT-S32-119 | owned 范围与分层无关，越界规则不变 | §2.109.8、EX-32.33 | 夹具 LS；`verify_scope: owned`；分层开启。① 入口按清单执行；② 入口零退出、UT-S90-01、02 都 pass，另外上报一条提案集合之外的基线用例 UT-S01-01（pass） | `verify --format json`，读取 `SLICE_CHECKPOINTS.jsonl` | ① `eligible_test_ids=["UT-S90-01","UT-S90-02"]`，入口收到的清单与之相同，与分层未开启时一致，checkpoint PASS；② `consistency.outside_eligible_result_ids` 含 UT-S01-01，原因含 `result_outside_eligible_scope`，`gate.result="FAIL"`，checkpoint 记为 FAIL；`layers.outside_result_count=0`，没有 `layered_runner_not_narrowed` |
| UT-S32-120 | 分层未开启时与引入前一致 | EX-32.34 | 夹具 LS；`verify_scope: baseline`；`enabled: false` | `verify --format json` | 基线部分为全部非本提案用例；输出与引入前 golden 一致（`level` 除外） |
| UT-S32-121 | 扩大时 checkpoint 随之扩大 | EX-32.35 | 夹具 LS；`verify_scope: baseline`；分层开启；声明改为 `shared_change: true` | `verify --format json` | 基线部分为全部非本提案用例；`layers.expansion.level="full"`，原因 `shared_change_declared` |
| UT-S32-122 | 受影响场景中的 pending 用例不提前进入 | EX-32.36 | 夹具 LS；`verify_scope: baseline`；分层开启；声明追加 S90 | `verify --format json` | UT-S90-03 仍在 `pending_test_ids`，不在 eligible 中 |
| UT-S32-124 | pending 被提前上报仍按 checkpoint 规则判越界 | §2.109.8、EX-32.36、EX-13.54 | 夹具 LS；`verify_scope: baseline`；分层开启；入口改为忽略清单。① 只额外上报 pending 的 UT-S90-03；② 只额外上报提案集合之外的 UT-S01-01 | `verify --format json` | ① `consistency.outside_eligible_result_ids` 含 UT-S90-03，原因含 `result_outside_eligible_scope`，checkpoint FAIL；`layers.outside_result_count=0`；② 不判越界，`outside_result_count=1`，警告 `layered_runner_not_narrowed`，checkpoint 按 eligible 判定为 PASS |
| UT-S32-125 | 按模块扩大的 baseline checkpoint 保留模块外已识别场景 | §2.109.7、§2.109.9、EX-32.35 | 多模块夹具（同 S13 的 LV-mod：`core`、`backend`、`web` 各有命令组，主链路在 `core-S03`），活跃提案有切片清单、`verify_scope: baseline`、当前切片拥有 `backend` 的一条本提案用例；代码只改动 `backend/**`；声明 `scenarios: [S07, S99]`（S07 属 `web`，S99 不存在）；分层开启 | `verify --format json`；读取各入口的调用记录 | `layers.expansion.level="module"`、原因 `scenario_unknown`；`web-S07` 的普通基线用例同时出现在 `web` 入口收到的清单与 `layers.execution.ids` 中；`backend` 模块的基线用例、主链路用例与本片 owned 也在其中；pending 的本提案用例不在；`web`、`backend`、`core` 三个命令组都被执行 |
| UT-S32-123 | checkpoint 同样受主链路约束 | EX-32.37 | 夹具 LS；分层开启；① `main_path_max: 1`、主链路共 2 条；② UT-S03-01 首跑 fail、复跑 pass | `verify --format json`，读取 `SLICE_CHECKPOINTS.jsonl` | ① 入口未被调用，`gate.reason="main_path_over_limit"`；② `gate.reason="main_path_flaky"`；两种情形 checkpoint 记为 FAIL，切片不计入已确认 |

### 自动化与证据要求

- 由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。不需要人参与，无平台限定。

## S32 切片规划的目标提案与模块测试（verify-scope-fields-and-slice-module）

> 覆盖场景 `core-S32-slice-planning.md`「S32 切片规划的目标提案与模块」（Step 1～10、EX-32.38～EX-32.42），功能规格 §2.110、§2.78.3（修改），`spec/test-slice-manifest.md`「写入前置条件：目标提案与模块」，`spec/cli-json-output.md` 中 `SLICE_PLAN_NO_ACTIVE_CHANGE` 的说明；需求 AC-VERIFY-FIELD-08～10。
>
> **夹具 SM**：`mktemp -d` 一次性 git 项目，模块 `core` 与 `backend`（均 launched，各自声明非空 `paths`，`verify.modules` 各有命令组）。已合并测试规格 `core-S01`（UT-S01-01、02）、`backend-S05`（UT-S05-01、02，以及本提案新增的 UT-S05-03、04、05）。活跃提案 `sm-demo` 登记在 `backend`：guard 的 `activeChange` 为 `sm-demo`、`module` 为 `backend`、带 `baseRef`；`proposal.md` 头为 `> module: backend`；经正常 `merge` 写入 `SPEC_MERGED`，其 `test_change_set.module` 为 `backend`、变更用例为 UT-S05-03、04、05。切片输入 `slices.json`：slice-a 拥有 UT-S05-03，slice-b 拥有 UT-S05-04、05。
>
> 夹具不得把提案改登记到 `core` 来绕开模块比对（layered-verification 的多模块夹具曾这样做，随本变更改回）。「不变」类断言比较文件字节的哈希。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S32-126 | 非 core 模块提案的清单模块等于提案模块 | §2.110.2、Step 1～10、EX-32.39、AC-VERIFY-FIELD-08 | 夹具 SM | `slice plan --file slices.json --format json`，读取 `TEST_SLICE_MANIFEST.json` | 退出码 0；清单 `change=="sm-demo"`、`module=="backend"`；`tasks.md` 的 `[code]` 段含两个切片 |
| UT-S32-127 | 规划后的验收不再判清单无效 | §2.110.2、EX-32.39、AC-VERIFY-FIELD-08 | 夹具 SM，已执行 UT-S32-126 的规划；入口对当前切片的用例写 pass | `verify --format json` | 没有 `test-slice-manifest-invalid`；`verify_mode=="slice-checkpoint"`，`attempted_slice_id` 为第一个切片，`eligible_test_ids` 含该切片的用例；checkpoint PASS |
| UT-S32-128 | 读取测试变更集与校验使用同一个模块（delta-r2 F4） | §2.110.2、§2.78.3 | 夹具 SM（变更用例三条）；每次调用前写入对应的切片输入：① `slices-missing.json` 有两个合法切片——slice-a 拥有 UT-S05-03、slice-b 只拥有 UT-S05-04，第三条变更用例 UT-S05-05 无人认领（两个切片且每个都带用例 ID，切片验证因此启用、写入者会读取测试变更集并做归属对账）；② `slices.json` 为完整输入（slice-b 拥有 UT-S05-04、05） | ① `slice plan --file slices-missing.json --format json`；② `slice plan --file slices.json --format json` | ① 按既有输出合同拒绝：退出码 1，stderr 错误信封 `error.code=="SLICE_PLAN_UNKNOWN_TEST_ID"`，信封顶层 `violations` 含一条 `code=="test-slice-test-id-missing"` 且 message 点名 UT-S05-05（说明以 `backend` 读取的测试变更集有效并参与了归属对账；若仍以 `core` 读取，变更集无效、对账被跳过，本次调用会成功）；`tasks.md` 不变、没有生成清单；② 退出码 0，没有 `$.module` 相关违规 |
| UT-S32-129 | `--slug` 指向另一个提案时拒绝且不改文件（proposal-r1 F2） | §2.110.1、EX-32.38、AC-VERIFY-FIELD-09 | 夹具 SM 增加第二个提案 `other-demo`（登记在 `backend`、已合并、有 `tasks.md`，并预置一份旧的切片清单）；guard 仍指向 `sm-demo`；记录 `other-demo` 的 `tasks.md` 与清单的字节哈希 | `slice plan --slug other-demo --file slices.json --format json` | 退出码 1；stderr 错误信封 `error.code=="SLICE_PLAN_NO_ACTIVE_CHANGE"`，message 含 `other-demo` 与当前活跃提案 `sm-demo`；`other-demo` 的 `tasks.md` 与清单哈希不变；提案目录中没有残留的临时文件；`sm-demo` 的产物同样不变 |
| UT-S32-130 | 没有 guard 或 guard 无法解析时带 `--slug` 同样拒绝 | §2.110.1、EX-32.38 | 夹具 SM；① 删除 `logos/.openlogos-guard`；② 把 guard 写成损坏的 JSON；③ guard 是合法 JSON 但没有 `activeChange` | 每臂 `slice plan --slug sm-demo --file slices.json --format json` | 每臂退出码 1、`SLICE_PLAN_NO_ACTIVE_CHANGE`，message 写明没有活跃提案；`sm-demo` 的 `tasks.md` 不变，没有生成清单 |
| UT-S32-131 | `--slug` 等于活跃提案时与不传相同 | §2.110.1 | 夹具 SM | ① `slice plan --file slices.json`；还原后 ② `slice plan --slug sm-demo --file slices.json` | 两次写出的 `tasks.md` 相同；清单除 `generated_at` 外相同，`module=="backend"` |
| UT-S32-132 | guard 缺 `module` 字段时取 core | §2.110.2、EX-32.40、AC-VERIFY-FIELD-10 | 单模块夹具（`core`），guard 指向活跃提案但没有 `module` 字段，`SPEC_MERGED.test_change_set` 的 `module` 为 `core` | `slice plan --file slices.json --format json` | 退出码 0，清单 `module=="core"` |
| UT-S32-133 | core 模块提案的产物与引入前一致 | §2.110.3、EX-32.41、AC-VERIFY-FIELD-10 | 单模块夹具，提案登记在 `core` | `slice plan --file slices.json --format json` | `tasks.md` 与引入前实现生成的 golden 逐字节相同；清单除 `generated_at` 外与 golden 相同；stdout 的 `data` 字段与 golden 相同 |
| UT-S32-134 | guard 的 `module` 带首尾空白时写入与读取一致（delta-r1 F2、delta-r2 F2） | §2.110.2、EX-32.42 | 夹具 SM，guard 的 `module` 写成 `" backend "`；入口对当前切片的用例写 pass | ① `slice plan --file slices.json --format json`，读取清单；② `verify --format json`，读取 `SLICE_CHECKPOINTS.jsonl` | ① 退出码 0，清单 `module=="backend"`；② 输出中没有 `test-slice-manifest-invalid`；`verify_mode=="slice-checkpoint"`、`attempted_slice_id=="slice-a"`、`eligible_test_ids` 含 UT-S05-03；`pending_test_ids` 含 UT-S05-04、UT-S05-05（范围计算读出了测试变更集）；`gate.result=="PASS"`、`gate.reason` 不是 `test_change_set_invalid`（门禁的严格跳过集合读取同样接受该变更集）；checkpoint 账本新增一条 slice-a 的 PASS 行 |

### 覆盖度校验

- 模块来源三处共用：UT-S32-126～UT-S32-128、UT-S32-134。
- 目标必须是活跃提案：UT-S32-129～UT-S32-131。
- 兼容：UT-S32-132、UT-S32-133。
- 异常 EX-32.38～EX-32.42 各至少一条：38（129、130）、39（126、127）、40（132）、41（133）、42（134）。
- 需求 AC-VERIFY-FIELD-08（126、127）、09（129、130）、10（132、133）。

### 自动化与证据要求

- 由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。不需要人参与，无平台限定，不需要额外的环境要求。
- `slice plan` 拒绝时的读取位置按既有输出合同（`spec/cli-json-output.md`「openlogos slice plan 输出合同」）：归属类违规（`test-slice-test-id-missing` 等）的顶层错误码为 `SLICE_PLAN_UNKNOWN_TEST_ID`、退出码 1，明细在 stderr 错误信封根的 `violations`；只有顶层码为 `SLICE_PLAN_ARTIFACT_INVALID` 时退出码才是 2（功能规格 §2.78.3 的表已按此改正）。本提案不改 CLI 的这一行为。
- 命令一律以构建后的 CLI 在夹具项目根执行；「与引入前一致」以同一夹具在引入前实现上生成的 golden 比对。
