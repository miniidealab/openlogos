## MODIFIED — ### 2.22 implement loop 默认激活切片循环（change-flow-redesign）

### 2.22 implement loop 默认激活切片循环（change-flow-redesign）

本节在 2.17（implement loop 真迭代派生）基础上扩展：**内置 launched `implement` 子流程默认激活切片循环**（`loop.until: code_slices_green`、`max_iters: 30`），不再依赖 overlay；2.17 中"builtin 保持 `max_iters:1`、`loop_state` 仅激活时输出、golden 零漂移"对 launched implement 的约束据此修订——launched 下 `loop_state` / `slice_state` 常驻输出，golden 基线主动重拍。其它 builtin（`initial.yaml` implement）仍 `max_iters:1`、initial 多模块不激活（沿用 2.17）。

- **切片清单**：`tasks.md` `[code]` section 的顶层切片 checkbox = 顶层切片。缩进 checkbox = 所属父切片内部子任务；它不是新的顶层切片，不参与 `slice_state.total` 的计数。
- **完成判定**：父切片完成必须同时满足父切片 checkbox 已勾选，且该父切片下所有缩进子任务 checkbox 均已勾选。父切片已勾但子任务未全勾时，该父切片仍视为未完成。
- **收敛**：`code_slices_green` = `section_complete:code ∧ tests_green`——`[code]` 顶层切片与全部缩进子任务 checkbox 全勾 且 末轮全量 verify 绿才出环（重新主张被 loop 覆盖的 `code` 节点 `done_when`）；**空 `[code]` 退化为 `tests_green`**。FAIL-safe 落每个判定入口。
- **派生**：`next` 选第一个未完成切片，`next_node` 钉 `code` 并带 `slice` 子提示（"建哪片"，非"修哪片"）；机器字段 `slice_state {total, done, current, remaining}`。若当前切片存在缩进子任务 checkbox，额外输出 `slice_state.current_children`、`slice_state.current_unchecked_children`，并在 `next_node.slice_children` 中同步暴露，供宿主提示词携带当前切片内部子任务清单。`LOOP_ITERS` 可带 `slice` 维度。
- **兼容性**：无缩进子任务 checkbox 的既有 `[code]` 切片行为不变；缩进普通 bullet 仍只是说明文字，不进入子任务完成判定；initial 多模块仍不输出 `slice_state`。
- **边界**：OpenLogos 只派生状态与机器字段，不自动勾选父切片或子任务 checkbox，不替代宿主/Agent 的代码实现、测试执行和任务勾选动作。

## MODIFIED — ### S31

### S31
launched `implement` 默认以切片循环推进：切片来自 `tasks.md` `[code]` 的顶层 checkbox，缩进 checkbox 是所属切片的内部子任务。收敛 = 全部父切片勾选 ∧ 全部子任务 checkbox 勾选 ∧ 末轮测试绿（`code_slices_green`），空 `[code]` 退化 `tests_green`。`next` 透出当前未完成切片（`next_node.slice` + `slice_state`），并在存在子任务时同步透出 `slice_state.current_children`、`slice_state.current_unchecked_children` 与 `next_node.slice_children`；`verify` 全量回归并追加可带 `slice` 的 `LOOP_ITERS`；达 `max_iters:30` 未达成升级 `gate:implement:loop-exhausted`（`skippable:false`）。切片提示语义为"下一个未完成切片"，回归修复目标由全量 verify 输出决定、归宿主判。initial 多模块不支持。若切片对应的规格变更新增或修改 smoke 用例，该切片必须同步完成 smoke runner/reporter/dispatcher 接入后才能勾选。
