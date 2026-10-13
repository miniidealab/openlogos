---
title: 项目结构
description: OpenLogos 项目的标准目录布局、文件命名约定与配置文件格式。
---

每个 OpenLogos 项目都在 `logos/` 目录下遵循标准的目录结构。这一约定让 AI 工具和团队成员能够快速定位资源。

## 标准目录布局

```
project-root/
├── AGENTS.md                   # AI assistant instructions (auto-generated, root)
├── CLAUDE.md                   # Claude Code instructions (auto-generated, root)
│
├── logos/                      # OpenLogos methodology assets (isolated namespace)
│   ├── logos.config.json       # Project configuration
│   ├── logos-project.yaml      # AI collaboration index
│   ├── .openlogos-guard        # 活跃变更锁（有活跃提案时存在）
│   ├── .openlogos-sync.json    # openlogos sync 成功后写入的版本戳
│   ├── .openlogos-runtime/     # guard 运行时状态（经 .gitignore 托管区块忽略）
│   │
│   ├── resources/              # Development resource documents (current "source of truth")
│   │   ├── prd/                # Product documents
│   │   │   ├── 1-product-requirements/    # Phase 1: Requirements
│   │   │   ├── 2-product-design/
│   │   │   │   ├── 1-feature-specs/       # Phase 2: Feature specs
│   │   │   │   └── 2-page-design/         # Phase 2: Page designs + HTML prototypes
│   │   │   └── 3-technical-plan/
│   │   │       ├── 1-architecture/        # Phase 3: Architecture & tech stack
│   │   │       ├── 2-scenario-implementation/  # Phase 3: Scenario docs (sequence diagrams)
│   │   │       └── 3-deployment/          # Phase 3: Deployment plan + smoke strategy
│   │   ├── api/                           # Phase 3: OpenAPI YAML
│   │   ├── database/                      # Phase 3: SQL DDL
│   │   ├── test/                          # Phase 3: Test case specs (Markdown)
│   │   │   └── smoke/                     # Smoke test cases (post-deployment)
│   │   ├── scenario/                      # Phase 3: API orchestration tests (JSON)
│   │   ├── implementation/                # Phase 3: Implementation manifest
│   │   ├── verify/                        # Phase 3: Test results + reports (JSONL + Markdown)
│   │   └── reference/                     # 参考资料：requirement/、todolist/、code/、image/、temp/、note/
│   │
│   ├── skills/                 # OpenLogos 方法论 Skills（Claude Code / OpenCode / Other 目标）
│   │   ├── prd-writer/
│   │   ├── product-designer/
│   │   ├── code-implementor/
│   │   └── ...
│   │
│   ├── spec/                   # Methodology specifications
│   │
│   └── changes/                # Change proposal workspace
│       ├── {change-name}/      # Active change proposal
│       │   ├── proposal.md
│       │   ├── tasks.md
│       │   ├── TEST_SLICE_MANIFEST.json   # 由 openlogos slice plan 写入
│       │   └── deltas/
│       └── archive/            # Completed change history
│
└── src/                        # Source code (structure determined by tech stack)
```

所有 OpenLogos 方法论资产都位于 `logos/` 之下，与项目自身的代码和配置完全分离。`AGENTS.md` 和 `CLAUDE.md` 保留在项目根目录，因为 AI 工具要求指令文件位于那里。

## 目录职责

### logos/

所有 OpenLogos 方法论资产的统一入口。包含配置文件、开发资源文档和变更管理。

### logos/resources/

存放所有开发资源文档——项目当前的「事实来源」。按 OpenLogos 三层推进模型组织：

| 子目录 | 阶段 | 内容 |
|-------------|-------|---------|
| `prd/1-product-requirements/` | Phase 1: WHY | 需求文档、用户故事、竞品分析 |
| `prd/2-product-design/1-feature-specs/` | Phase 2: WHAT | 功能规格、信息架构、设计规范 |
| `prd/2-product-design/2-page-design/` | Phase 2: WHAT | 页面设计文档 + HTML 原型 |
| `prd/3-technical-plan/1-architecture/` | Phase 3: HOW | 架构总览、技术选型决策 |
| `prd/3-technical-plan/2-scenario-implementation/` | Phase 3: HOW | 场景文档（时序图 + 步骤描述） |
| `prd/3-technical-plan/3-deployment/` | Phase 3: HOW | 部署方案、环境配置、回滚策略、smoke 范围 |
| `api/` | Phase 3: HOW | OpenAPI YAML 规格文件 |
| `database/` | Phase 3: HOW | SQL DDL 设计文件 |
| `test/` | Phase 3: HOW | 单元 + 场景测试用例规格（Markdown） |
| `test/smoke/` | Phase 3: HOW | 部署后 smoke 测试用例（Markdown） |
| `scenario/` | Phase 3: HOW | API 编排测试用例（JSON，仅 API 项目） |
| `implementation/` | Phase 3: HOW | 实现清单（代码交付追踪） |
| `verify/` | Phase 3: HOW | 测试结果（JSONL）、验收报告、smoke 报告、部署报告 |

### logos/changes/

变更提案工作区。每次功能迭代或缺陷修复都从这里的变更提案开始，经批准后合并回主文档。详见[变更管理](/zh/specs/change-management)。

### logos/skills/

由 `openlogos init` 或 `openlogos sync` 为 Claude Code、OpenCode 和 Other 部署的 AI Skill 文件。每个 skill 是一个子目录，包含一个 `SKILL.md` 文件。其他宿主的 Skills 放在各自的位置：Cursor 为 `.cursor/skills/<name>/SKILL.md`，Codex 为 `.agents/plugins/openlogos/skills/`，ZCode / Qoder / WorkBuddy 为 `.zcode/plugins/openlogos/`、`.qoder/plugins/openlogos/`、`.workbuddy/plugins/openlogos/` 插件内的 `skills/`。多文件 Skill 的附属资产（如 `ui-ux-pro-max`）始终放在这里。

### logos/spec/

由 `openlogos init` 部署的方法论规格文件。它们定义了 Skill 和工具遵循的规则（工作流、测试结果格式、目录约定等）。

## 配置文件

### logos.config.json

项目配置文件，定义文档模块路径和匹配模式：

```json
{
  "name": "my-project",
  "locale": "en",
  "aiTool": "claude-code",
  "description": "",
  "documents": {
    "prd": { "label": { "en": "Product Docs" }, "path": "./resources/prd", "pattern": "**/*.{md,html,htm,pdf}" },
    "api": { "label": { "en": "API Docs" }, "path": "./resources/api", "pattern": "**/*.{yaml,yml,json}" },
    "test": { "label": { "en": "Test Cases" }, "path": "./resources/test", "pattern": "**/*.md" },
    "scenario": { "label": { "en": "Scenarios" }, "path": "./resources/scenario", "pattern": "**/*.json" },
    "database": { "label": { "en": "Database" }, "path": "./resources/database", "pattern": "**/*.sql" },
    "verify": { "label": { "en": "Verify Reports" }, "path": "./resources/verify", "pattern": "**/*.{jsonl,md}" },
    "changes": { "label": { "en": "Change Proposals" }, "path": "./changes", "pattern": "**/*.{md,json}" }
  },
  "sourceRoots": { "src": ["src"], "test": ["test"] },
  "verify": {
    "result_path": "logos/resources/verify/test-results.jsonl"
  },
  "guard": {
    "unversioned": ["node_modules/", "dist/"]
  }
}
```

| 字段 | 类型 | 描述 |
|-------|------|-------------|
| `name` | string | 项目名称 |
| `locale` | `"en"` \| `"zh"` | 文档语言 |
| `aiTool` | string \| string[] | AI 工具：`claude-code`、`opencode`、`codex`、`cursor`、`zcode`、`qoder`、`workbuddy`、`other` 或 `all` |
| `lifecycle` | `"initial"` \| `"launched"` | 旧的项目级字段，已不再写入；lifecycle 现为 `logos-project.yaml` 中的模块级字段，`openlogos sync` 会迁移旧值 |
| `sourceRoots` | object | 源码与测试根目录（`src`、`test`） |
| `documents` | object | 文档模块定义（路径 + glob 模式） |
| `verify.result_path` | string | 测试结果 JSONL 的自定义路径 |
| `guard.unversioned` | string[] | 不进入版本控制的路径：渲染进 `.gitignore` 托管区块，不在 guard 保护范围内；用 [`openlogos ignore`](/zh/cli/ignore-exempt) 管理 |
| `guard.exempt` | string[] | 会入库、但写入不需要立案的路径；缺省时为 `logos/resources/reference/` 与 baseline-seed staging；用 [`openlogos exempt`](/zh/cli/ignore-exempt) 管理 |

### logos-project.yaml

AI 协作索引文件——完整细节见 [logos-project.yaml 规格](/zh/specs/logos-project)。

## 文件命名约定

### 模块前缀规则

所有设计文档遵循 `<module>-<number-or-name>.<ext>` 命名模式。模块前缀是命名空间，让多个模块能在同一目录中共存而不冲突。

- 单模块项目使用 `core-` 作为默认前缀（如 `core-01-requirements.md`）
- 多模块项目在已有文件旁追加带新模块前缀的文件——无需子目录

`openlogos status` 使用 `<moduleId>-` 前缀来判定每个模块的阶段完成情况。只有当阶段目录中至少存在一个带该模块前缀的文件时，该模块的此阶段才算完成。

### 文档文件

- 格式：`<module>-{number}-{english-name}.md`——如 `core-01-requirements.md`、`admin-01-requirements.md`
- 数字控制显示顺序
- HTML 原型：`<module>-{number}-{name}-prototype.html`

### 场景文件

- 场景实现：`<module>-SXX-{english-name}.md`——如 `core-S01-user-register.md`、`admin-S08-dashboard.md`
- 场景编号在所有模块间**全局唯一**，由 `logos-project.yaml` 中的 `scenario_counter.next_id` 维护
- 测试用例规格：`<module>-SXX-test-cases.md`——如 `core-S01-test-cases.md`

### API 文件

- 按领域拆分：`auth.yaml`、`payment.yaml`、`license.yaml`
- OpenAPI 3.0 YAML 格式
- API 文件通常在模块间共享（无需模块前缀）

### 数据库文件

- 完整 schema：`schema.sql`，或按领域拆分：`auth.sql`、`payment.sql`
- 数据库文件通常在模块间共享（无需模块前缀）

### 编排测试文件

- 按场景拆分：`S01-user-auth.json`、`S02-payment-flow.json`
- JSON 格式，定义 API 编排序列

### 验证文件

- 测试结果：`test-results.jsonl`（JSONL 格式，每行一个用例结果）
- 验收报告：`acceptance-report.md`（由 `openlogos verify` 自动生成）
- 切片清单：`logos/changes/<slug>/TEST_SLICE_MANIFEST.json`，由 `openlogos slice plan` 写入；见 [TEST_SLICE_MANIFEST](/zh/specs/test-slice-manifest)
- 详细格式规格见[测试结果格式](/zh/specs/test-results)

## 可选目录

| 目录 | 用途 |
|-----------|---------|
| `logos/resources/image/` | 产品图片资产（截图、图标） |
| `logos/resources/context/` | 额外的 AI 上下文文件 |
| `docs/` | 面向用户的文档（部署指南、用户手册） |
| `scripts/` | 开发脚本 |
