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
