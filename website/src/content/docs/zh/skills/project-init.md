---
title: project-init
description: 遵循 OpenLogos 方法论初始化项目结构。
---

遵循 OpenLogos 方法论初始化项目结构，生成配置文件、AI 指令文件以及标准目录。

## Phase 与触发条件

- **Phase**：Phase 1 — WHY（需求）
- **触发条件**：
  - 用户请求创建或初始化项目
  - 用户提到 `openlogos init`
  - 当前目录下不存在 `logos/logos.config.json`

## 它做了什么

1. 收集项目信息（名称、描述、技术栈、文档模块）
2. 创建 `logos/` 目录及其标准子结构
3. 生成 `logos/logos.config.json` 配置
4. 生成 `logos/logos-project.yaml` AI 协作索引
5. 在项目根目录生成 `AGENTS.md` / `CLAUDE.md` AI 指令文件
6. 创建 `logos/changes/` 变更管理目录
7. 输出带后续步骤指引的初始化报告

## 创建的目录结构

```
project-root/
├── AGENTS.md
├── CLAUDE.md
└── logos/
    ├── logos.config.json
    ├── logos-project.yaml
    ├── resources/
    │   ├── prd/
    │   │   ├── 1-product-requirements/
    │   │   ├── 2-product-design/
    │   │   │   ├── 1-feature-specs/
    │   │   │   └── 2-page-design/
    │   │   └── 3-technical-plan/
    │   │       ├── 1-architecture/
    │   │       └── 2-scenario-implementation/
    │   ├── api/
    │   ├── database/
    │   └── scenario/
    └── changes/
```

## 关键配置文件

### logos.config.json

定义项目元数据与文档模块路径。`path` 字段相对于 `logos/` 目录：

```json
{
  "name": "{project name}",
  "description": "{project description}",
  "documents": {
    "prd": { "path": "./resources/prd", "pattern": "**/*.{md,html,htm,pdf}" },
    "api": { "path": "./resources/api", "pattern": "**/*.{yaml,yml,json}" },
    "scenario": { "path": "./resources/scenario", "pattern": "**/*.json" },
    "database": { "path": "./resources/database", "pattern": "**/*.sql" }
  }
}
```

### logos-project.yaml

包含技术栈与项目约定的 AI 协作索引。`resource_index` 初始为空，随着文档的产出逐步填充。

### AGENTS.md / CLAUDE.md

根级别的 AI 指令文件，包含方法论规则、项目上下文以及阶段检测逻辑。两个文件内容完全一致。

## 最佳实践

- 初始化时**保持配置精简**，在使用过程中逐步完善
- **`resource_index` 初始为空** —— 随文档产出逐条添加
- **低侵入性** —— 所有方法论资产都包含在 `logos/` 内，保持项目自身结构整洁
- 空目录包含 `.gitkeep` 以便纳入版本控制

## 产出

| 文件 | 位置 |
|------|----------|
| `logos.config.json` | `logos/logos.config.json` |
| `logos-project.yaml` | `logos/logos-project.yaml` |
| `AGENTS.md` | 项目根目录 |
| `CLAUDE.md` | 项目根目录 |
| 目录结构 | `logos/resources/`、`logos/changes/` |

## 相关 Skill

- 下一步：[`prd-writer`](/zh/skills/prd-writer) —— 编写需求文档
