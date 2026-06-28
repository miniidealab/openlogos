## ADDED — ### 2.13.1 S31 切片子任务 checkbox 的 JSON 输出

### 2.13.1 S31 切片子任务 checkbox 的 JSON 输出

当 launched `implement` 切片循环激活，且当前 `[code]` 顶层切片下存在缩进 checkbox 子任务时，`openlogos status --format json`、`openlogos next --format json` 与 `watch.data` 中的 `slice_state` 需要在既有字段之外暴露当前切片子任务：

```json
{
  "slice_state": {
    "total": 2,
    "done": 0,
    "remaining": 2,
    "current": "切片1：Agent idle 状态读取契约。",
    "current_children": [
      {"text": "扩展 open-agent bridge 状态 IPC。", "checked": true},
      {"text": "扩展 AgentAdapter 状态入口。", "checked": false},
      {"text": "补 AgentPanel idle/background/pending/streaming 读取。", "checked": false}
    ],
    "current_unchecked_children": [
      "扩展 AgentAdapter 状态入口。",
      "补 AgentPanel idle/background/pending/streaming 读取。"
    ]
  },
  "next_node": {
    "id": "code",
    "slice": "切片1：Agent idle 状态读取契约。",
    "slice_children": [
      {"text": "扩展 open-agent bridge 状态 IPC。", "checked": true},
      {"text": "扩展 AgentAdapter 状态入口。", "checked": false},
      {"text": "补 AgentPanel idle/background/pending/streaming 读取。", "checked": false}
    ]
  }
}
```

输出规则：

- `slice_state.total` 只统计 `[code]` 下顶层切片 checkbox，不统计缩进 checkbox。
- `slice_state.done` 只统计已完成父切片。父切片完成必须满足父切片 checkbox 已勾选，且该父切片下所有缩进子任务 checkbox 已勾选。
- `slice_state.current` 指向第一个未完成父切片；父切片已勾但仍有未勾子任务时，`current` 仍指向该父切片。
- `slice_state.current_children` 仅描述当前切片下的缩进 checkbox 子任务；若当前切片没有子任务 checkbox，可省略或输出空数组。
- `slice_state.current_unchecked_children` 只列出当前切片下未勾选子任务文本；若无未勾选子任务，可省略或输出空数组。
- `next_node.slice_children` 与 `slice_state.current_children` 同步，用于宿主构造“只做这一片 + 当前子任务”的派发提示。
- 无缩进子任务 checkbox 的既有输出保持兼容；普通缩进 bullet 不进入这些字段。
