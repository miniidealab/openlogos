---
title: merge-executor
description: 将变更提案中的 delta 文件合并进主文档。
---

读取由 `openlogos merge <slug>` 生成的 `MERGE_PROMPT.md` 指令文件，并将变更提案中的每个 delta 文件逐一合并进主文档，确保变更被准确应用。

## Phase 与触发条件

- **Phase**：跨阶段（Delta 工作流）
- **触发条件**：
  - 用户已运行 `openlogos merge <slug>` 并希望由 AI 执行合并
  - 用户提到「执行合并」「合并 delta」
  - 用户提到「读取 MERGE_PROMPT.md 并执行」

## 前置条件

1. `logos/changes/<slug>/MERGE_PROMPT.md` 存在（由 `openlogos merge` 生成）
2. MERGE_PROMPT.md 中引用的 delta 文件与目标主文档均存在

如果 MERGE_PROMPT.md 不存在，提示用户先运行 `openlogos merge <slug>`。

## 它做了什么

1. 从 MERGE_PROMPT.md 解析合并指令
2. 读取每个 delta 文件并解读 ADDED / MODIFIED / REMOVED 标记
3. 在主文档中精确定位对应区段
4. 执行合并操作
5. 逐文件输出变更摘要

## Delta 标记

| 标记 | 操作 |
|--------|-----------|
| `ADDED` | 在指定位置插入新内容 |
| `MODIFIED` | 替换主文档中的同名区段 |
| `REMOVED` | 从主文档中删除对应区段 |

## 执行步骤

### Step 1：读取合并指令

解析 MERGE_PROMPT.md，提取：变更提案名称、每个 delta 文件的路径、目标文档路径与操作类型。

### Step 2：逐个处理 Delta

按顺序处理每个 delta 文件：

1. 读取 delta 文件 —— 理解标记与内容
2. 读取目标主文档 —— 定位待修改区段
3. 执行合并（ADDED / MODIFIED / REMOVED）
4. 显示修改摘要并等待用户确认

### Step 3：输出变更报告并写入 SPEC_MERGED

```
Merge complete:
- [file path 1]: added x sections, modified y sections, deleted z sections
- [file path 2]: ...
```

所有 delta 合并完成且规格提交完成后，写入 `SPEC_MERGED` 标记：

```bash
touch logos/changes/<slug>/SPEC_MERGED
```

`SPEC_MERGED` 表示 delta 已应用到主规格。`openlogos status` 读取此标记，将提案步骤从 `merge-generated` 推进到 `coding`。没有此标记，提案将一直停留在 `merge-generated`。

写入 `SPEC_MERGED` 后，提醒用户按 `tasks.md` 中的 `[code]` 区段实现代码。

## 合并原则

1. **保持格式一致** —— 合并后的内容与现有格式、缩进与标题层级一致
2. **不改动无关内容** —— 仅修改 delta 指定的部分
3. **冲突时询问** —— 若找不到引用的区段，暂停并询问用户
4. **每文件后确认** —— 显示摘要，等待确认再继续

## 产出

- 直接修改 `logos/resources/` 中的主文档（原地编辑）
- 不修改 `logos/changes/` 中的任何文件
- 除非某个 delta 指定新增一份全新文档，否则不创建新文件

## 最佳实践

- **先读全再动手** —— 合并前理解全局
- **MODIFIED 最易出错** —— 区段标题可能有细微差异，需要模糊匹配
- **保留变更痕迹** —— 在适用处更新「最后更新」时间戳
- **Delta 顺序很重要** —— 需求文档先于 API 文档，以保持上下游一致

## 相关 Skill

- 上一步：[`change-writer`](/zh/skills/change-writer) —— 编写变更提案
- 合并后：运行 `openlogos archive <slug>` 归档
