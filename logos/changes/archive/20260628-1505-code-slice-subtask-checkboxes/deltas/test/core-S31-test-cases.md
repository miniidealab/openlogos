## ADDED — ## 七、切片子任务 checkbox 测试

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
