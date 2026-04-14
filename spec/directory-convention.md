# 目录结构约定

> 版本：0.3.0
>
> 本文档定义遵循 OpenLogos 方法论的项目应采用的标准目录结构。统一的目录结构让 AI 工具和团队成员都能快速定位资源。

## 标准项目结构

```
project-root/
├── AGENTS.md                   # AI 助手指令（自动生成，根目录）
│
├── logos/                      # OpenLogos 方法论资产（独立收纳）
│   ├── logos.config.json       # 项目配置（OpenLogos 规范）
│   ├── logos-project.yaml      # AI 协作索引（OpenLogos 规范）
│   │
│   ├── resources/              # 研发资源文档（当前已生效的"真相"）
│   │   ├── prd/                # 产品文档
│   │   │   ├── 1-product-requirements/    # Phase 1: 需求文档
│   │   │   ├── 2-product-design/
│   │   │   │   ├── 1-feature-specs/       # Phase 2: 功能规格
│   │   │   │   └── 2-page-design/         # Phase 2: 页面设计 + HTML 原型
│   │   │   └── 3-technical-plan/
│   │   │       ├── 1-architecture/        # Phase 3: 架构与技术选型
│   │   │       └── 2-scenario-implementation/  # Phase 3: 场景实现文档
│   │   ├── api/                           # Phase 3: OpenAPI YAML
│   │   ├── database/                      # Phase 3: SQL DDL
│   │   ├── test/                          # Phase 3: 测试用例规格（Markdown）
│   │   ├── scenario/                      # Phase 3: API 编排测试（JSON）
│   │   ├── implementation/                # Phase 3-4: 代码实现清单（Markdown）
│   │   └── verify/                        # Phase 3: 测试验收结果（JSONL + 报告）
│   │
│   └── changes/                # 变更提案工作区
│       ├── {change-name}/      # 进行中的变更提案
│       │   ├── proposal.md
│       │   ├── tasks.md
│       │   └── deltas/
│       └── archive/            # 已完成变更的历史归档
│
└── src/                        # 源代码（结构由项目技术栈决定）
```

OpenLogos 的所有方法论资产收纳在 `logos/` 目录下，与项目自身代码和配置彻底分离。`AGENTS.md`（及 `CLAUDE.md`）保留在项目根目录，因为 AI 工具要求指令文件位于根目录。

## 目录职责

### logos/

OpenLogos 方法论的统一入口。包含配置文件、研发资源文档和变更管理。

### logos/resources/

存放所有研发资源文档，是项目当前已生效的"真相源"。按 OpenLogos 三层推进模型组织：

| 子目录 | 对应阶段 | 内容 |
|--------|---------|------|
| `prd/1-product-requirements/` | Phase 1: WHY | 需求文档、用户故事、竞品分析 |
| `prd/2-product-design/1-feature-specs/` | Phase 2: WHAT | 功能规格、信息架构、设计规范 |
| `prd/2-product-design/2-page-design/` | Phase 2: WHAT | 页面设计文档 + HTML 原型 |
| `prd/3-technical-plan/1-architecture/` | Phase 3: HOW | 整体架构、技术选型 |
| `prd/3-technical-plan/2-scenario-implementation/` | Phase 3: HOW | 业务场景文档（时序图 + 步骤说明） |
| `api/` | Phase 3: HOW | OpenAPI YAML 规格文件 |
| `database/` | Phase 3: HOW | SQL DDL 设计文件 |
| `test/` | Phase 3: HOW | 单元测试 + 场景测试用例规格（Markdown） |
| `scenario/` | Phase 3: HOW | API 编排测试用例（JSON，仅 API 项目） |
| `implementation/` | Phase 3-4: HOW | 代码实现清单（Markdown），标记代码实现阶段完成 |
| `verify/` | Phase 3: HOW | 测试运行结果（JSONL）+ 验收报告（Markdown） |

### logos/changes/

变更提案工作区。每次功能迭代或 Bug 修复，先在这里创建变更提案，审核通过后再合并回主文档。详见 [change-management.md](./change-management.md)。

### logos.config.json 与 logos-project.yaml

- `logos/logos.config.json`：项目配置文件，定义文档模块的路径和匹配模式
- `logos/logos-project.yaml`：AI 协作索引，为 AI 助手提供项目全局上下文

两个文件都放在 `logos/` 目录下。

## 文件命名约定

### 文档文件

- 使用 `{序号}-{英文名}.md` 格式：`01-requirements.md`
- 序号用于控制显示顺序
- HTML 原型使用 `{序号}-{英文名}-prototype.html` 格式
- 设计文档与原型成对出现：`03-homepage-design.md` + `03-homepage-prototype.html`

### API 文件

- 按领域分文件：`auth.yaml`、`payment.yaml`、`license.yaml`
- 使用 OpenAPI 3.0 YAML 格式

### 数据库文件

- 完整 Schema：`{project-name}.sql`
- 或按领域分文件：`auth.sql`、`payment.sql`

### 测试用例规格文件

- 按场景分文件：`S01-test-cases.md`、`S02-test-cases.md`
- 使用 Markdown 格式，包含单元测试和场景测试的用例设计
- 每个文件对应一个场景编号，覆盖该场景的所有测试层级

### 场景文件

- 按场景分文件：`user-auth.json`、`payment-flow.json`
- 使用 JSON 格式定义 API 编排

### 验收文件

- 测试结果：`test-results.jsonl`（JSONL 格式，每行一个用例结果）
- 验收报告：`acceptance-report.md`（由 `openlogos verify` 自动生成）
- 详细格式定义见 [test-results.md](./test-results.md)

## 可选目录

根据项目需要，可以添加以下目录：

| 目录 | 用途 |
|------|------|
| `logos/resources/image/` | 产品图片资源（截图、图标等） |
| `logos/resources/context/` | 额外的 AI 上下文文件 |
| `docs/` | 面向用户的文档（部署文档、使用手册等） |
| `scripts/` | 开发脚本 |
