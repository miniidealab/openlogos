---
title: "openlogos module"
description: 管理项目模块 —— 在 logos-project.yaml 中列出、添加、重命名或移除模块。
---

管理 `logos-project.yaml` 中的模块注册表。模块用于组织多模块项目，并跟踪每个模块各自的 lifecycle 状态。

## 命令格式

```bash
openlogos module list [--format json]
openlogos module add <name>
openlogos module rename <old> <new>
openlogos module remove <name>
```

## 子命令

### `module list`

列出所有已注册的模块及其 lifecycle 状态。

```bash
openlogos module list
openlogos module list --format json
```

输出示例：
```
🧩 Registered Modules

  🔄  core  核心功能  [initial]
  ✅  payment  支付模块  [launched]
```

### `module add <name>`

向 `logos-project.yaml` 添加新模块。模块创建时的 lifecycle 为 `initial`。

```bash
openlogos module add payment
```

- `name` 必须匹配 `^[a-z][a-z0-9-]*$`（小写字母、数字、连字符）
- 可在任何时候运行 —— 无需活跃的变更提案
- 不会影响现有文件

### `module rename <old> <new>`

重命名模块：更新 `logos-project.yaml` 中的 id，重命名 `logos/resources/` 中所有匹配的文件（以 `<old>-` 为前缀的文件），并更新 `logos/` 和 `spec/` 文本文件中的交叉引用。

```bash
openlogos module rename core foundation
```

- 如果存在活跃的变更提案，会打印警告但操作继续进行
- 若提案处于活跃状态，重命名后请检查 `logos/changes/<slug>/tasks.md`

### `module remove <name>`

从 `logos-project.yaml` 中移除模块。会列出受影响的文件，但**不会**自动删除它们。

```bash
openlogos module remove payment
```

- `core` 模块受保护，无法被移除
- 移除前会提示确认
- 如果存在活跃的变更提案，会打印警告但操作继续进行

## 说明

- 模块名称在整个项目中用作文件前缀（例如 `core-S01-cli-init.md`）
- 场景编号在所有模块间全局唯一 —— 参见 `logos-project.yaml` → `scenario_counter.next_id`
- `module add` 和 `module rename/remove` 属于项目结构操作，不受变更提案的限制
