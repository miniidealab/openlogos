---
title: "openlogos change"
description: 为现有项目的迭代更新创建一份结构化的变更提案。
---

搭建一个新的变更提案目录，包含 `proposal.md`、`tasks.md` 和 `deltas/` 子目录。这是 Delta 工作流的入口。

## 命令格式

```bash
openlogos change <slug>
```

## 参数

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `slug` | **Yes** | 变更的 kebab-case 标识符（例如 `fix-redirect-bug`、`add-remember-me`） |

## 创建内容

```
logos/changes/<slug>/
├── proposal.md          # Change proposal template
├── tasks.md             # Implementation task checklist
├── deltas/
│   ├── prd/             # Delta files for requirements/design docs
│   ├── api/             # Delta files for API specs
│   ├── database/        # Delta files for DB schema
│   └── scenario/        # Delta files for orchestration tests
```

此外还会创建 `logos/.openlogos-guard` —— 一个记录当前活跃变更的 JSON 文件：

```json
{
  "activeChange": "fix-redirect-bug",
  "createdAt": "2026-04-10T12:00:00.000Z"
}
```

guard 文件被 AI 指令用来强制代码变更保持在提案范围内。

## 生成的模板

### proposal.md

```markdown
# Change Proposal: fix-redirect-bug

## Reason
[Why is this change needed? Which requirement/feedback/bug triggered it?]

## Change Type
[Requirements / Design / Interface / Code]

## Scope
- Affected requirements: [list]
- Affected feature specs: [list]
- Affected scenarios: [list]
- Affected APIs: [list]
- Affected DB tables: [list]
- Affected orchestration tests: [list]

## Summary
[Describe what will change in 1-3 paragraphs]
```

### tasks.md

```markdown
# Implementation Tasks

## [delta] Spec Changes
- [ ] Output delta file to deltas/prd/1-product-requirements/ — Update requirements
- [ ] Output delta file to deltas/api/ — Update API YAML

## [code] Code Implementation
- [ ] Implement business logic in src/xxx
- [ ] Write corresponding tests
```

`[delta]` 和 `[code]` 这两个分节标签是机器可读的。`openlogos status` 用它们来跟踪提案步骤：

- `[delta]` 分节全部勾选 → 提案推进到 `ready-to-merge`
- 没有 `[delta]` 分节（纯代码修复） → 直接跳到 `ready-to-merge`
- `[code]` 分节全部勾选 → 提案推进到 `ready-to-verify`

务必将 delta 任务和 code 任务严格分开 —— 切勿在同一分节中混用。

## 示例输出

```
Creating change proposal: fix-redirect-bug

  ✓ logos/changes/fix-redirect-bug/proposal.md
  ✓ logos/changes/fix-redirect-bug/tasks.md
  ✓ logos/changes/fix-redirect-bug/deltas/
  ✓ logos/.openlogos-guard

Change proposal created. Next steps:
  1. Tell AI: "Help me fill in change proposal fix-redirect-bug"
  2. AI will analyze impact and fill in proposal.md + tasks.md
  3. Then work through tasks.md, putting deltas in deltas/
  4. When done, run `openlogos merge fix-redirect-bug` to generate merge instructions
```

## Delta 工作流

```
openlogos change <slug>
       │
       ▼
  AI fills proposal.md + tasks.md (impact analysis)
       │
       ▼
  AI creates delta files in deltas/ (ADDED/MODIFIED/REMOVED markers)
       │
       ▼
openlogos merge <slug>  →  generates MERGE_PROMPT.md
       │
       ▼
  AI reads MERGE_PROMPT.md and applies changes to main documents
       │
       ▼
openlogos archive <slug>  →  moves to archive/
```

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `Missing change proposal name` | 未提供 slug | 提供一个 slug：`openlogos change add-remember-me` |
| `Change proposal 'X' already exists` | `logos/changes/` 中已存在同名 slug 的提案 | 换一个 slug，或先归档已有提案 |
| `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录 |

## 相关命令

- [`merge`](/zh/cli/merge) — 下一步：delta 文件就绪后生成 merge 指令
- [`archive`](/zh/cli/archive) — 最后一步：归档已完成的提案
- [`launch`](/zh/cli/launch) — 激活变更管理（必须在 `change` 被强制执行之前完成）
