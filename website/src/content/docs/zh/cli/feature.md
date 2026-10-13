---
title: "openlogos feature"
description: 列出每个模块的功能分组，并为尚未归组的场景生成 AI 回填提示词。
---

功能（feature）把一个模块的场景归并为面向用户的能力（`F01`、`F02`……）。它保存在 `logos/logos-project.yaml` 中——`features[]` 条目 `{id, name, module, spec?}`，以及每个场景上的 `feature` 键——由 AI 维护，CLI 只读取。

与功能相关的命令有两个：

- `openlogos feature list`——只读的分组视图
- `openlogos feature-backfill`——生成一份让 AI 为未归组场景分组的提示词

## 命令格式

```bash
openlogos feature list [--module <id>] [--format json]
openlogos feature-backfill [--module <id>] [--format json]
```

必须在项目根目录下运行。

## 选项

| 选项 | 说明 |
|------|------|
| `--module <id>` | 只处理一个模块。模块未注册时报 `MODULE_NOT_FOUND`。 |
| `--format json` | 输出 JSON envelope |

## `openlogos feature list`

对每个模块列出全部已注册功能及其场景（若已关联功能规格文档也一并显示）。不属于任何已注册功能的场景归入末尾的 `__ungrouped__` 分组。既无功能也无场景的模块显示为空列表。

```bash
openlogos feature list --module core
```

```
🗂  Feature Groups

  core  Core
    F01  项目初始化  → core-01  (2)
      - S01  CLI init
      - S02  Status
    __ungrouped__  …  (1)
      - S07  Watch
```

本命令不写任何东西。

## `openlogos feature-backfill`

生成 `logos/feature-backfill-prompt.md`，指导 AI 助手把未归组场景——在 adopted（存量接入）项目中还包括逆向得到的场景候选——聚类成功能、分配编号，并回写 `logos/logos-project.yaml`。

命令本身**不修改** `logos-project.yaml`。重复运行是安全的：已登记的场景不会再被当作新候选。

```
  ✓ Generated: logos/feature-backfill-prompt.md
    scenarios=12  ungrouped=4  features=3  baseline_candidates=0

Next step:
  Tell your AI assistant: "Read logos/feature-backfill-prompt.md and execute the instructions"
```

JSON 输出包含 `prompt_path`、`scenarios_total`、`ungrouped_total`、`features_existing` 与 `baseline_candidates_total`。

## 错误

| 错误 | 原因 | 解决方法 |
|------|------|----------|
| `PROJECT_NOT_INITIALIZED` / `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录 |
| `MODULE_NOT_FOUND` | `--module` 未注册 | 运行 `openlogos module list` |
| `BASELINE_COMMIT_IN_PROGRESS` | 现状基线种子提交仍在进行（feature-backfill） | 稍后重试 |
| `BASELINE_PROVENANCE_INVALID` | 逆向基线来源章节无法解析（feature-backfill），错误中列出相关文件 | 修复点名文件后重跑 |

## 相关命令

- [`module`](/zh/cli/module) — 管理功能所属的模块
- [`status`](/zh/cli/status) — 存在功能分组时，JSON 输出按模块包含分组
- [`index`](/zh/cli/index-command) — 重建 `logos-project.yaml` 的资源索引
