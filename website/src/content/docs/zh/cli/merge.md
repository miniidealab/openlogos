---
title: "openlogos merge"
description: 生成一份 MERGE_PROMPT.md 文件，指导 AI 将 delta 变更应用到主文档。
---

扫描变更提案中的 delta 文件，将它们映射到对应的目标资源目录，并生成一份可供 AI 读取并执行的 `MERGE_PROMPT.md`。

## 命令格式

```bash
openlogos merge <slug>
```

## 参数

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `slug` | **Yes** | 变更提案的 slug（必须存在于 `logos/changes/` 中） |

## 功能说明

1. 递归扫描 `logos/changes/<slug>/deltas/` 中按类别组织的文件
2. 将每个类别映射到目标资源目录（保留嵌套子目录路径）：

| Delta 类别 | 目标目录 |
|---------------|-----------------|
| `deltas/prd/` | `logos/resources/prd/` |
| `deltas/api/` | `logos/resources/api/` |
| `deltas/database/` | `logos/resources/database/` |
| `deltas/scenario/` | `logos/resources/scenario/` |
| `deltas/test/` | `logos/resources/test/` |

嵌套路径会被保留。例如，`deltas/prd/3-technical-plan/1-architecture/core-arch.md` 映射到 `logos/resources/prd/3-technical-plan/1-architecture/core-arch.md`。

3. 读取 `proposal.md` 内容作为上下文
4. 生成带结构化 merge 指令的 `logos/changes/<slug>/MERGE_PROMPT.md`
5. 写入 `MERGE_PROMPT_GENERATED` 标记文件，将提案步骤推进到 `merge-generated`

## 输出示例

```
📋 Merge Summary:
  - Change proposal: fix-redirect-bug
  - Delta files: 3
    deltas/prd/01-requirements-delta.md → logos/resources/prd/
    deltas/api/openapi-delta.yaml → logos/resources/api/
    deltas/scenario/S02-redirect-delta.json → logos/resources/scenario/

  ✓ logos/changes/fix-redirect-bug/MERGE_PROMPT.md

💡 Tell AI: "Read logos/changes/fix-redirect-bug/MERGE_PROMPT.md and execute merge"

After merge, run `openlogos archive fix-redirect-bug` to archive the proposal.
```

## 生成的 MERGE_PROMPT.md

这份提示词包含：

1. **提案上下文** —— `proposal.md` 的完整内容
2. **Delta 文件列表** —— 每个 delta 及其源路径、目标目录和操作
3. **给 AI 的执行要求**：
   - 逐个处理每个 delta 文件
   - 处理 `ADDED` / `MODIFIED` / `REMOVED` 标记
   - 保留原有的格式和风格
   - 更新时间戳
   - 每处理完一个文件后报告摘要
   - 提醒用户运行 `openlogos archive`

## Delta 文件格式

Delta 文件使用标记来指示目标文档中应当发生的变更：

```markdown
## ADDED: Section Name
[New content to insert]

## MODIFIED: Section Name
[Replacement content for an existing section]

## REMOVED: Section Name
[This section should be deleted from the main document]
```

## 空 delta 的处理

如果 `deltas/` 为空或不包含任何可识别的文件，命令会写入一个 `SPEC_MERGED` 标记文件并干净地退出：

```
✓ No delta files in logos/changes/<slug>/deltas/ — nothing to merge.
```

这不是错误。纯代码变更（重构、不涉及规格的 bug 修复）是合法的提案，可以跳过 merge 步骤。`SPEC_MERGED` 标记会将提案步骤推进到 `coding`，使工作流得以继续。

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `Missing change proposal name` | 未提供 slug | 提供一个 slug：`openlogos merge fix-redirect-bug` |
| `Change proposal 'X' not found` | `logos/changes/<slug>/` 下没有对应目录 | 检查拼写，或先用 `openlogos change` 创建 |
| `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录 |

## 相关命令

- [`change`](/zh/cli/change) — 上一步：创建提案和 delta 结构
- [`archive`](/zh/cli/archive) — 下一步：在 AI 执行完 merge 后归档提案
