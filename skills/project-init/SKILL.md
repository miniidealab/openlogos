# Skill: Project Init

> 初始化一个遵循 OpenLogos 方法论的项目结构，生成配置文件、AI 指令文件和标准目录。

## 触发条件

- 用户要求创建新项目或初始化项目结构
- 用户提到 "openlogos init" 或 "初始化项目"
- 当前目录下没有 `logos.config.json`

## 核心能力

1. 创建 OpenLogos 标准目录结构
2. 生成 `logos.config.json` 配置文件
3. 生成 `logos-project.yaml` AI 协作索引
4. 生成 `AGENTS.md` / `CLAUDE.md` AI 指令文件
5. 创建 `changes/` 变更管理目录

## 执行步骤

### Step 1: 收集项目信息

向用户确认以下信息：

- **项目名称**：用于 `logos.config.json` 的 `name` 字段
- **项目描述**：一句话描述
- **技术栈**：主框架、语言、数据库、部署平台
- **文档模块**：除默认的 prd/api/scenario/database 外，是否需要额外模块

如果用户没有提供，使用合理的默认值。

### Step 2: 创建目录结构

```
project-root/
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

### Step 3: 生成 logos.config.json

```json
{
  "name": "{项目名称}",
  "description": "{项目描述}",
  "documents": {
    "prd": {
      "label": { "en": "Product Docs", "zh": "产品文档" },
      "path": "./resources/prd",
      "pattern": "**/*.{md,html,htm,pdf}"
    },
    "api": {
      "label": { "en": "API Docs", "zh": "API 文档" },
      "path": "./resources/api",
      "pattern": "**/*.{yaml,yml,json}"
    },
    "scenario": {
      "label": { "en": "Scenarios", "zh": "业务场景" },
      "path": "./resources/scenario",
      "pattern": "**/*.json"
    },
    "database": {
      "label": { "en": "Database", "zh": "数据库" },
      "path": "./resources/database",
      "pattern": "**/*.sql"
    }
  }
}
```

### Step 4: 生成 logos-project.yaml

```yaml
project:
  name: "{项目名称}"
  description: "{项目描述}"
  methodology: "OpenLogos"

tech_stack:
  framework: "{用户提供的框架}"
  language: "{用户提供的语言}"
  # ... 根据用户提供的信息填充

resource_index: []
  # 初始为空，随着文档产出逐步添加

conventions:
  - "遵循 OpenLogos 三层推进模型（Why → What → How）"
  - "每次变更必须先创建 changes/ 变更提案"
```

### Step 5: 生成 AGENTS.md

根据 Step 3 和 Step 4 的内容生成 AGENTS.md：

```markdown
# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos.config.json`
- Resource Index: `logos-project.yaml`
- Tech Stack: {从 logos-project.yaml 提取}

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see changes/ directory)

## Conventions
{从 logos-project.yaml 的 conventions 提取}
```

同时生成 `CLAUDE.md`，内容与 AGENTS.md 一致。

### Step 6: 输出初始化报告

向用户报告创建了哪些文件和目录，并给出下一步建议：

1. 编辑 `logos.config.json` 完善项目配置
2. 从 Phase 1 开始：编写需求文档
3. 使用 `prd-writer` Skill 辅助撰写

## 输出规范

- `logos.config.json`：有效的 JSON，符合 `spec/logos.config.schema.json`
- `logos-project.yaml`：有效的 YAML
- `AGENTS.md` / `CLAUDE.md`：Markdown 格式
- 所有目录已创建，空目录包含 `.gitkeep`

## 实践经验

- **不要过度配置**：初始化时保持最少配置，让用户在使用过程中逐步完善
- **resource_index 初始为空**：随着文档产出再添加条目，避免生成无意义的占位内容
- **AGENTS.md 保持简洁**：只包含项目特有的信息，通用的方法论规则使用固定模板
- **优先创建目录结构**：目录结构是方法论落地的第一步，比任何文档都重要
