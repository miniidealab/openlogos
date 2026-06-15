---
title: 目录约定
description: OpenLogos 项目的标准目录布局与文件组织规则。
---

本规格定义所有 OpenLogos 项目遵循的标准目录结构。统一的布局让 AI 工具和团队成员能够快速定位资源。

## 标准项目结构

```
project-root/
├── AGENTS.md                   # AI assistant instructions (auto-generated)
├── CLAUDE.md                   # Claude Code instructions (auto-generated)
│
├── logos/                      # OpenLogos methodology assets
│   ├── logos.config.json       # Project configuration
│   ├── logos-project.yaml      # AI collaboration index
│   │
│   ├── resources/              # Development resource documents (source of truth)
│   │   ├── prd/                # Product documents
│   │   │   ├── 1-product-requirements/    # Phase 1: Requirements
│   │   │   ├── 2-product-design/
│   │   │   │   ├── 1-feature-specs/       # Phase 2: Feature specs
│   │   │   │   └── 2-page-design/         # Phase 2: Page designs + HTML prototypes
│   │   │   └── 3-technical-plan/
│   │   │       ├── 1-architecture/        # Phase 3-0: Architecture & tech stack
│   │   │       ├── 2-scenario-implementation/  # Phase 3-1: Scenario docs
│   │   │       └── 3-deployment/          # Phase 3-3: Deployment plan + smoke strategy
│   │   ├── api/                           # Phase 3-2: OpenAPI YAML
│   │   ├── database/                      # Phase 3-2: SQL DDL
│   │   ├── test/                          # Phase 3-4a: Test case specs (Markdown)
│   │   │   └── smoke/                     # Smoke test cases (post-deployment)
│   │   ├── scenario/                      # Phase 3-4b: API orchestration tests (JSON)
│   │   ├── implementation/                # Phase 3-5: Implementation manifest
│   │   ├── verify/                        # Phase 3-6: Test results + reports
│   │   └── reference/                     # Reference materials (images, context)
│   │
│   ├── skills/                 # AI Skills (SKILL.md per skill, 16 built-in)
│   │   ├── prd-writer/
│   │   ├── deployment-designer/
│   │   ├── ui-ux-pro-max/
│   │   └── ...
│   │
│   ├── spec/                   # Methodology specifications (13 files)
│   │
│   └── changes/                # Change proposal workspace
│       ├── {change-name}/      # Active change proposal
│       │   ├── proposal.md
│       │   ├── tasks.md
│       │   └── deltas/
│       └── archive/            # Completed change history
│
└── src/                        # Source code (structure determined by tech stack)
```

## 目录职责

### logos/resources/prd/3-technical-plan/3-deployment/

部署方案文档。包含部署拓扑、环境配置、发布命令、回滚策略和 smoke 测试范围定义。

- 文件命名：`<module>-01-deployment-plan.md`
- 编写者：`deployment-designer` Skill（Phase 3 Step 3）

### logos/resources/test/smoke/

部署后 smoke 测试用例规格。包含 `openlogos smoke` 用于比对的 `SMOKE-*` 用例 ID。

- 文件命名：`<module>-smoke-test-cases.md`
- 编写者：`test-writer` Skill（消费 deployment-designer 的产出）

### logos/resources/implementation/

追踪代码交付状态的实现清单。

- 文件命名：`implementation-manifest.md`
- 编写者：`code-implementor` Skill（Phase 3 Step 5）

### logos/resources/reference/

参考资料——截图、架构图、上下文文件，AI 读取但不生成。

### logos/resources/verify/

验证产物：

| 文件 | 描述 |
|------|-------------|
| `test-results.jsonl` | 运行时测试结果（UT/ST） |
| `acceptance-report.md` | 由 `openlogos verify` 生成 |
| `smoke-results.jsonl` | 运行时 smoke 结果 |
| `smoke-report.md` | 由 `openlogos smoke` 生成 |
| `deployment-report.md` | 由部署执行器生成 |

## 文件命名约定

### 模块前缀规则

所有设计文档遵循：`<module>-<number-or-name>.<ext>`

- 单模块项目使用 `core-` 作为默认前缀
- 多模块项目在已有文件旁追加带新模块前缀的文件

### 文档文件

`<module>-{number}-{english-name}.md`——如 `core-01-requirements.md`

### 场景文件

`<module>-SXX-{english-name}.md`——如 `core-S01-user-register.md`

场景编号在所有模块间**全局唯一**。

### 测试用例文件

`<module>-SXX-test-cases.md`——如 `core-S01-test-cases.md`

### 部署文件

`<module>-01-deployment-plan.md`——如 `core-01-deployment-plan.md`

### Smoke 测试文件

`<module>-smoke-test-cases.md`——如 `core-smoke-test-cases.md`

存放于 `logos/resources/test/smoke/`。

## 相关

- [项目结构](/zh/specs/project-structure)——配置文件格式与字段定义
- [模块命名约定](/zh/specs/module-naming-convention)——详细的模块前缀规则
- [logos-project.yaml](/zh/specs/logos-project)——AI 协作索引 schema
