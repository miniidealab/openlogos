## MODIFIED — ## 场景目标

## 场景目标
让 launched `implement` 子流程默认以**切片循环**推进：逐片实现 code→verify，全部 `[code]` 顶层切片勾选、每个切片下的缩进子任务 checkbox 全部勾选，且末轮全量测试绿才出环。严格 **A 被动派生**——OpenLogos 只派生「当前该建哪片 / 当前片有哪些子任务 / 第几轮 / 是否收敛 / 是否升级 gate」，**不自驱动跑测试、不代勾切片或子任务**。构建在 S27 loop 机制（`LOOP_ITERS` / `loop_state` / escalation）之上，新增 `code_slices_green` 收敛与 `slice_state`。

**激活**：builtin launched `implement` 默认 `loop.until: code_slices_green` + `max_iters:30`（无需 overlay）。`initial.yaml` implement 不默认激活；initial 多模块不支持（verify 项目级单次、无法归属切片）。

**收敛复合判定**：`code_slices_green = section_complete:code ∧ tests_green`——`tasks.md` `[code]` 顶层切片全勾、每个切片下的缩进子任务 checkbox 全勾 **且** 末轮全量 verify 绿。**空 `[code]`（切片数 0）退化为 `tests_green`**，避免常驻激活把纯 docs/delta 小提案卡死。FAIL-safe：未达成一律不推进到 deliver/close。

## MODIFIED — ## 参与者

## 参与者
- **User / RunLogos driver**：逐轮驱动——读 `slice_state.current` + `slice_state.current_children` + `next_node.slice` / `next_node.slice_children` 给编码 agent 注入"只做这一片及其未完成子任务"上下文，跑 verify，绿后勾 `[code]` 当前父切片及其已完成子任务。
- **next**：`cli/src/commands/next.ts`——选第一个未完成切片为工作项，`next_node` 钉 `code` 并带 `slice` / `slice_children` 子提示。
- **verify**：`cli/src/commands/verify.ts`——跑全量回归，追加 `LOOP_ITERS`（可带父切片 `slice`）。
- **切片派生**：`cli/src/lib/flow-loop-derive.ts`——`code_slices_green` 收敛、`slice_state`、父切片与子任务选取。
- **切片清单**：`tasks.md` `[code]` section（顶层 checkbox = 父切片；缩进 checkbox = 该父切片内部子任务）。

## MODIFIED — ## 步骤说明

## 步骤说明
1. **User/driver** 执行 `openlogos next`。
2. **next** 经切片派生求 implement loop 状态（loop 激活且 `until:code_slices_green`）。
3. **切片派生**读 `tasks.md` `[code]` 勾选，算 `slice_state {total, done, current, remaining, current_children?, current_unchecked_children?}`；`total` 只统计顶层父切片，`done` 只统计父切片与其缩进子任务均完成的切片；`converged = section_complete:code ∧ tests_green`（空 `[code]` 退化 `tests_green`）。
4. 分支：
   - **4a 收敛**：全部父切片勾选、全部缩进子任务 checkbox 勾选且末轮 `LOOP_ITERS` 末行 `result==pass` → implement 出环、续推下一节点。
   - **4b 未收敛未达上限**：`next_node` 指向 `code`（同 S27 R7），带 `slice` 子提示 = 第一个未完成父切片标题（"建哪片"，非"修哪片"）；若该父切片下存在缩进 checkbox，`next_node.slice_children` 同步带子任务列表。措辞「实现切片 N/M：…，完成后重跑 `openlogos verify`」。
   - **4c 达上限**（`iteration >= max_iters && !converged`）→ 升级 `gate:implement:loop-exhausted`（`skippable:false`，默认不自动放行未完成大功能）。
5. **User/driver** 实现当前父切片及其子任务后运行 `openlogos verify`（**全量回归**）。
6. **verify** 算出 gate 结果后追加 `LOOP_ITERS` 一行，激活时可带父切片 `slice` 字段（每片尝试历史；完成仍以 `[code]` checkbox 勾选为权威）。
7. **User/driver**（host）在该片相关信号满足后勾上 `[code]` 当前父切片及其已完成缩进子任务——OpenLogos 只派生、不代勾。回到 Step 1。

## ADDED — ### EX-3.4: 父切片已勾但子任务未全勾

### EX-3.4: 父切片已勾但子任务未全勾
- **触发条件**：顶层父切片 checkbox 已勾选，但其下仍有一个或多个缩进子任务 checkbox 未勾选。
- **期望响应**：该父切片仍视为未完成；`slice_state.done` 不增加，`slice_state.current` 指向该父切片，`current_unchecked_children` 列出未完成子任务；`code_slices_green` 不收敛。
- **副作用**：`next_node.slice_children` 必须暴露这些子任务，方便宿主重新派发时带上内部未完成项。
