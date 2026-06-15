---
title: "openlogos archive"
description: 将已完成的变更提案移动到归档目录。
---

将一个已完成的变更提案从 `logos/changes/<slug>/` 移动到 `logos/changes/archive/YYYYMMDD-HHmm-<slug>/`，并在 guard 文件匹配时清理它。

## 命令格式

```bash
openlogos archive <slug>
```

## 参数

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `slug` | **Yes** | 要归档的变更提案 slug |

## 功能说明

1. 生成一个带时间戳的目录名：`YYYYMMDD-HHmm-<slug>`（例如 `20260509-1430-fix-redirect-bug`）
2. 将 `logos/changes/<slug>/` 移动到 `logos/changes/archive/YYYYMMDD-HHmm-<slug>/`
3. 如果 `logos/.openlogos-guard` 存在且其 `activeChange` 与该 slug 匹配，则删除 guard 文件
4. 归档后的提案保留所有文件（proposal.md、tasks.md、deltas/、MERGE_PROMPT.md）

时间戳前缀让你在归档变多时也能轻松找到特定提案 —— 条目默认按时间顺序排序。

## 输出示例

```
  ✓ logos/.openlogos-guard removed

✓ Change proposal 'fix-redirect-bug' archived.
  logos/changes/fix-redirect-bug/ → logos/changes/archive/20260509-1430-fix-redirect-bug/
```

## 归档结构

归档完成后，完整的提案历史会被保留：

```
logos/changes/archive/
└── 20260509-1430-fix-redirect-bug/
    ├── proposal.md
    ├── tasks.md
    ├── MERGE_PROMPT.md
    └── deltas/
        ├── prd/
        ├── api/
        ├── database/
        └── scenario/
```

这为项目的所有变更提供了完整的审计轨迹，并按时间顺序排序。

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `Missing change proposal name` | 未提供 slug | 提供一个 slug：`openlogos archive fix-redirect-bug` |
| `Change proposal 'X' not found` | `logos/changes/<slug>/` 下没有对应目录 | 检查拼写 —— 也许已经归档过了？ |
| `Archive 'X' already exists` | 该 slug 已存在于 `logos/changes/archive/` 中 | 该提案已经被归档过 |
| `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录 |

## 相关命令

- [`change`](/zh/cli/change) — 创建新的变更提案
- [`merge`](/zh/cli/merge) — 上一步：在归档前生成 merge 指令
