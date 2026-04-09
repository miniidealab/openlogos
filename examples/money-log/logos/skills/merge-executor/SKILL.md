# Skill: Merge Executor

> 读取 CLI 生成的 MERGE_PROMPT.md 指令文件，将变更提案中的 delta 文件逐个合并到主文档，确保变更准确落地。

## 触发条件

- 用户运行完 `openlogos merge <slug>` 后要求 AI 执行合并
- 用户提到"执行合并"、"merge"、"把 delta 合进主文档"
- 用户提到"读取 MERGE_PROMPT.md 并执行"

## 前置依赖

1. `logos/changes/<slug>/MERGE_PROMPT.md` 存在（由 `openlogos merge` 命令生成）
2. MERGE_PROMPT.md 中引用的 delta 文件和目标主文档均存在

如果 MERGE_PROMPT.md 不存在，提示用户先运行 `openlogos merge <slug>`。

## 核心能力

1. 解析 MERGE_PROMPT.md 中的合并指令
2. 逐个读取 delta 文件，理解 ADDED / MODIFIED / REMOVED 标记
3. 精准定位主文档中的对应章节并执行合并
4. 保持主文档的格式和风格一致性
5. 输出变更摘要

## 执行步骤

### Step 1: 读取合并指令

读取 `logos/changes/<slug>/MERGE_PROMPT.md`，解析出：
- 变更提案名称和概述
- 每个 delta 文件的路径、对应的目标主文档路径、操作类型

### Step 2: 逐个 Delta 文件执行合并

按 MERGE_PROMPT.md 中列出的顺序，逐个处理 delta 文件：

1. **读取 delta 文件**：理解 ADDED / MODIFIED / REMOVED 标记及内容
2. **读取目标主文档**：定位需要修改的章节
3. **执行合并**：
   - `ADDED`：在主文档的指定位置插入新内容
   - `MODIFIED`：替换主文档中同名章节的内容
   - `REMOVED`：从主文档中删除对应章节
4. **输出摘要**：列出对该文件做了哪些修改

### Step 3: 输出总体变更报告

所有 delta 处理完毕后，输出：

```
合并完成：
- [文件路径 1]：新增 x 节，修改 y 节，删除 z 节
- [文件路径 2]：...

请确认修改无误后，运行 `openlogos archive <slug>` 归档提案。
```

## 合并原则

1. **保持格式一致**：合并后的内容必须与主文档的现有格式、缩进、标题层级保持一致
2. **不改动无关内容**：只修改 delta 指定的部分，不重新格式化整个文档
3. **冲突时询问**：如果主文档中找不到 delta 引用的章节（可能已被其他变更修改），暂停并询问用户如何处理
4. **逐文件确认**：处理完每个 delta 文件后展示修改摘要，等待用户确认后再处理下一个

## 输出规范

- 直接修改 `logos/resources/` 中的主文档（就地编辑）
- 不修改 `logos/changes/` 中的任何文件
- 合并过程中不创建新文件（除非 delta 指定新增一个全新的文档）

## 实践经验

- **先全部读完再动手**：先通读所有 delta 文件和目标文档，理解全貌后再逐个合并
- **MODIFIED 是最容易出错的**：章节标题可能有微小差异（大小写、空格），需要模糊匹配
- **保留变更痕迹**：如果主文档有"最后更新"时间戳，记得同步更新
- **delta 的顺序有意义**：需求文档的变更应在 API 文档之前处理，确保上下游一致

## 推荐提示词

以下提示词可以直接复制给 AI 使用：

- `读取 logos/changes/<slug>/MERGE_PROMPT.md 并执行合并`
- `帮我把 add-remember-me 的变更合并到主文档`
- `执行变更合并`
