## ADDED — ## 十八点一、S31 切片子任务 checkbox 派生架构

## 十八点一、S31 切片子任务 checkbox 派生架构

S31 的切片派生需要从“逐行 checkbox 计数”升级为“顶层切片 + 缩进子任务”的两层模型，仍保持 A 被动派生：OpenLogos 只读取 `tasks.md`、派生机器状态，不代勾 checkbox，不运行测试，不解释宿主执行结果。

### 解析规则

- 只解析活跃提案 `tasks.md` 的 `## [code]` section。
- 顶层 checkbox 行表示父切片。顶层识别以 Markdown 列表缩进层级为准，`- [ ]` / `- [x]` 等价支持。
- 父切片下的缩进 checkbox 行表示该父切片的子任务。子任务归属最近的上一个顶层父切片。
- 缩进普通 bullet 仍是说明文字，不计入完成判定。
- 缩进 checkbox 不得增加 `slice_state.total`，不得作为 `slice_state.current` 的候选切片。

### 完成规则

```text
parent_slice_done =
  parent_checkbox_checked
  ∧ every(child_checkbox.checked == true)

code_slices_green =
  every(parent_slice_done)
  ∧ tests_green
```

空 `[code]` 或顶层切片数为 0 时，继续退化为 `tests_green`。父切片已勾但子任务未全勾时，父切片仍未完成；`slice_state.done` 不增加，`slice_state.current` 仍指向该父切片。

### 机器字段

`deriveSliceState` 在既有 `{total, done, current, remaining}` 基础上增加可选字段：

- `current_children: Array<{ text: string; checked: boolean }>`：当前父切片下所有缩进 checkbox 子任务。
- `current_unchecked_children: string[]`：当前父切片下未勾选子任务文本。

`next.ts` 在 loop 阻塞且 `next_node.id == "code"` 时，除既有 `next_node.slice = slice_state.current` 外，若存在 `slice_state.current_children`，同步挂载：

```json
{
  "next_node": {
    "id": "code",
    "slice": "切片1：...",
    "slice_children": [
      {"text": "扩展 AgentAdapter 状态入口。", "checked": false}
    ]
  }
}
```

### 兼容性约束

- 无子任务 checkbox 的既有 S31 fixture、golden 与用户项目语义保持不变。
- initial 多模块仍不激活切片循环，不输出 `slice_state`。
- `LOOP_ITERS.slice` 仍记录父切片标题，不记录子任务列表。
- `section_complete:code` 在 `code_slices_green` 语境下采用父切片完成规则；其它 section 的完成语义不受影响。
