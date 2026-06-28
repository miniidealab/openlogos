## MODIFIED — ### S31: 代码切片循环（implement 默认逐片实现到全部切片完成且测试绿）

### S31: 代码切片循环（implement 默认逐片实现到全部切片完成且测试绿）
- **触发条件**：一个大功能在 implement 阶段无法一次写完，需要逐片实现、无人值守自愈，直到全部 `[code]` 切片完成且测试绿；当单个切片内部需要拆成可验收子项时，允许在父切片下使用缩进 checkbox 表达子任务。
- **用户价值**：一个提案设计一次、切片实现多次；implement loop 逐片闭环 code→verify，靠客观信号（父切片与切片子任务全部勾选 + 测试绿）保质量，靠 `next --auto` 保无人值守。缩进子任务让宿主与 Agent 能在同一个父切片内追踪 bridge、adapter、panel、UT/ST/reporter 等细项，不再被误计为新的顶层切片。
- **优先级**：P1
- **主路径**：内置 launched `implement` 默认激活切片循环（`until: code_slices_green`、`max_iters:30`）。切片清单 = `tasks.md` `[code]` section 的顶层切片 checkbox；缩进 checkbox 是其所属父切片的子任务，只参与该父切片完成判定，不参与 `slice_state.total/done/remaining` 的顶层切片计数。`next` 选第一个未完成切片为当前工作项、`next_node` 钉在 `code` 并带 `slice` 子提示；若当前切片存在缩进子任务 checkbox，同步带 `slice_children` 子提示。`verify` 跑全量回归、追加 `LOOP_ITERS`（可带 `slice`）；全部父切片与所有子任务勾选且末轮测试绿才出环；达 `max_iters` 仍未达成升级 `gate:implement:loop-exhausted`（`skippable:false`）。

#### 验收条件
##### 正常：逐片推进的当前切片提示
- **GIVEN** launched 提案处于 implement，`[code]` 有未完成切片，loop 未收敛、未达上限
- **WHEN** 用户执行 `openlogos next`
- **THEN** `next_node` 指向 `code` 节点并带 `slice` 子提示（第一个未完成顶层 `[code]` 切片标题）；`slice_state` 输出 `{total, done, current, remaining}`。若当前切片下存在缩进子任务 checkbox，`slice_state.current_children` / `slice_state.current_unchecked_children` 与 `next_node.slice_children` 必须包含这些子任务及其勾选状态。

##### 正常：缩进子任务不参与顶层切片计数
- **GIVEN** `[code]` 中存在 2 个顶层切片，每个切片下各有若干缩进 checkbox 子任务
- **WHEN** 用户执行 `openlogos status` 或 `openlogos next --format json`
- **THEN** `slice_state.total == 2`，缩进子任务不得增加顶层切片总数；`remaining` 只按父切片完成状态计算。

##### 正常：全部切片完成且测试绿才出环（FAIL-safe）
- **GIVEN** loop 激活、`until: code_slices_green`
- **WHEN** 派生判定 implement 是否完成
- **THEN** 仅当 `section_complete:code`（所有顶层切片 checkbox 已勾选，且每个父切片下的缩进子任务 checkbox 全部勾选）**且** 末轮测试绿时 `converged=true` 出环；任一不满足则 `converged=false`、不得推进到 deliver/close。

##### 异常：父切片已勾选但子任务未全勾
- **GIVEN** 当前父切片 checkbox 已勾选，但该切片下仍有未勾选缩进子任务 checkbox
- **WHEN** 派生 `slice_state` 或 `code_slices_green`
- **THEN** 该父切片不得计入 `done`，`current` 仍指向该父切片，`current_unchecked_children` 列出未完成子任务，`code_slices_green` 不得收敛。

##### 正常：空 [code] 退化为 tests_green
- **GIVEN** 提案无 `[code]` section 或切片数为 0
- **WHEN** loop 激活（launched 默认）
- **THEN** `code_slices_green` 退化为 `tests_green`（仅末轮绿即收敛），不因无切片把小提案卡死。

##### 正常：达上限升级退出门
- **GIVEN** loop 迭代达 `max_iters` 仍未全部切片绿
- **WHEN** 用户执行 `openlogos next` / `next --auto`
- **THEN** 升级 `gate:implement:loop-exhausted`（`skippable:false`）；`next --auto` 默认仍阻塞、不放行未完成的大功能。

##### 正常：切片提示为"建哪片"非"修哪片"
- **GIVEN** 后做切片打断先做切片、全量 verify 飘红
- **WHEN** 用户执行 `openlogos next`
- **THEN** `slice` 提示仍指向第一个未完成切片（待建或待补子任务）；具体修哪里由全量 verify 失败输出决定、归宿主判（A 被动派生，引擎不代判）。

##### 异常：initial 多模块不支持
- **触发条件**：initial 多模块项目。
- **期望响应**：切片循环不激活（verify 项目级单次、无法归属切片），派生退化为旧行为、不输出 `slice_state`。
