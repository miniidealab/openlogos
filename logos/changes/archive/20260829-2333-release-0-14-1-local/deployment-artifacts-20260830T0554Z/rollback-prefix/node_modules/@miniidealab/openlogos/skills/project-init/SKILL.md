# Skill: Project Init

> 初始化一个遵循 OpenLogos 方法论的项目结构，生成配置文件、AI 指令文件和标准目录。

## 触发条件

- 用户要求创建新项目或初始化项目结构
- 用户提到 "openlogos init" 或 "初始化项目"
- 当前目录下没有 `logos/logos.config.json`

## 核心能力

1. 创建 `logos/` 目录及其标准子结构
2. 生成 `logos/logos.config.json` 配置文件
3. 生成 `logos/logos-project.yaml` AI 协作索引
4. 生成 `AGENTS.md` / `CLAUDE.md` AI 指令文件（根目录）
5. 创建 `logos/changes/` 变更管理目录
6. 创建部署方案与 smoke 测试所需目录

## 执行步骤

### Step 1: 收集项目信息

向用户确认以下信息：

- **项目名称**：用于 `logos/logos.config.json` 的 `name` 字段
- **项目描述**：一句话描述
- **技术栈**：主框架、语言、数据库、部署平台
- **文档模块**：除默认的 prd/api/scenario/database 外，是否需要额外模块

如果用户没有提供，使用合理的默认值。

### Step 2: 创建目录结构

```
project-root/
└── logos/
    ├── resources/
    │   ├── prd/
    │   │   ├── 1-product-requirements/
    │   │   ├── 2-product-design/
    │   │   │   ├── 1-feature-specs/
    │   │   │   └── 2-page-design/
    │   │   └── 3-technical-plan/
    │   │       ├── 1-architecture/
    │   │       ├── 2-scenario-implementation/
    │   │       └── 3-deployment/
    │   ├── api/
    │   ├── database/
    │   ├── test/
    │   │   └── smoke/
    │   ├── scenario/
    │   ├── implementation/
    │   └── verify/
    └── changes/
```

### Step 3: 生成 logos/logos.config.json

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
    "test": {
      "label": { "en": "Test Cases", "zh": "测试用例" },
      "path": "./resources/test",
      "pattern": "**/*.md"
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
    },
    "implementation": {
      "label": { "en": "Implementation", "zh": "实现清单" },
      "path": "./resources/implementation",
      "pattern": "**/*.md"
    },
    "verify": {
      "label": { "en": "Verify Reports", "zh": "验收报告" },
      "path": "./resources/verify",
      "pattern": "**/*.{jsonl,md}"
    }
  },
  "verify": {
    "result_path": "logos/resources/verify/test-results.jsonl"
  },
  "smoke": {
    "result_path": "logos/resources/verify/smoke-results.jsonl",
    "report_path": "logos/resources/verify/smoke-report.md"
  }
}
```

> `path` 字段相对于 `logos.config.json` 自身所在目录（即 `logos/`），因此 `./resources/prd` 指向 `logos/resources/prd`。

### Step 4: 生成 logos/logos-project.yaml

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
  - "每次变更必须先创建 logos/changes/ 变更提案"
```

### Step 5: 生成 AGENTS.md（根目录）

根据 Step 3 和 Step 4 的内容生成 AGENTS.md，放在**项目根目录**：

```markdown
# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`
- Tech Stack: {从 logos-project.yaml 提取}

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see logos/changes/ directory)
6. Deployment is a human confirmation point; AI must not deploy without explicit authorization
7. If deployment is required, smoke tests must be designed and run via `openlogos smoke` after deployment

## Conventions
{从 logos-project.yaml 的 conventions 提取}
```

同时生成 `CLAUDE.md`，内容与 AGENTS.md 一致。

Phase 检测逻辑必须包含：

- API/DB 完成但 `3-technical-plan/3-deployment/` 为空 → Phase 3 Step 3（deployment-designer）
- 部署方案存在但 `logos/resources/test/` 为空 → Phase 3 Step 4a（test-writer）
- verify 通过但部署未完成 → Phase 3 Step 7（deployment-executor，人类确认点）
- 部署完成但 smoke 未通过 → Phase 3 Step 8（openlogos smoke，人类确认点）

### Step 6: 输出初始化报告

向用户报告创建了哪些文件和目录，并给出下一步建议：

1. 编辑 `logos/logos.config.json` 完善项目配置
2. 从 Phase 1 开始：编写需求文档
3. 使用 `prd-writer` Skill 辅助撰写

## 输出规范

- `logos/logos.config.json`：有效的 JSON，符合 `logos/spec/logos.config.schema.json`
- `logos/logos-project.yaml`：有效的 YAML
- `AGENTS.md` / `CLAUDE.md`：Markdown 格式，位于项目根目录
- `logos/` 下所有目录已创建，空目录包含 `.gitkeep`
- 必须创建 `logos/resources/prd/3-technical-plan/3-deployment/`
- 必须创建 `logos/resources/test/smoke/`
- 必须创建 `logos/resources/verify/`

## verify 预跑配置初始化规则

项目初始化或已有项目接入时，必须为后续 `openlogos verify` 准备完整测试结果生成路径。

执行规则：

1. 创建 `logos.config.json` 时始终写入 `verify.result_path`。
2. 检测常见测试栈：
   - `package.json` 且存在 `scripts.test` → 写入 `verify.pre_run_command: "npm test"`
   - Vitest → 可写入 `npx vitest run`
   - Jest → 可写入 `npx jest`
   - pytest → 可写入 `pytest`
   - Go → 可写入 `go test ./...`
   - Cargo → 可写入 `cargo test`
3. 已有用户配置时不得覆盖。
4. 无法推断时，必须在输出中生成 TODO，提示用户补充 `verify.pre_run_command` 或 `verify.regression_command`。
5. 如果项目明确使用“回归 + 增量”模型，可写入 `verify.regression_command` 与 `verify.incremental_command`，并说明阶段结果合并策略。

原因说明：

`openlogos verify` 以 `logos/resources/test/*.md` 的全量用例作为覆盖分母。如果 reporter 只写入局部测试结果，verify 会正确报告覆盖不足，但用户容易误以为业务测试失败。初始化阶段尽早补齐预跑配置，可以让验收默认生成完整 JSONL。

## 实践经验

- **不要过度配置**：初始化时保持最少配置，让用户在使用过程中逐步完善
- **resource_index 初始为空**：随着文档产出再添加条目，避免生成无意义的占位内容
- **AGENTS.md 保持简洁**：只包含项目特有的信息，通用的方法论规则使用固定模板
- **优先创建目录结构**：`logos/` 目录结构是方法论落地的第一步，比任何文档都重要
- **低侵入**：所有方法论资产收纳在 `logos/` 内，不污染项目自身结构

## 推荐提示词

以下提示词可以直接复制给 AI 使用：

- `帮我初始化 OpenLogos 项目`
- `用 OpenLogos 初始化这个项目，项目名叫 xxx`
- `帮我给现有项目接入 OpenLogos`
