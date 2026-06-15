---
title: "openlogos status"
description: 显示当前项目阶段、交付物、活跃的变更提案以及建议的下一步操作。
---

展示全部 9 个阶段的完成状态仪表盘，列出活跃的变更提案，并建议下一步操作。在多模块项目中，还会显示每个模块各自的阶段进度。

## 命令格式

```bash
openlogos status [--module <id>] [--format json]
```

必须在项目根目录下运行。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--module <id>` | 将输出过滤到单个模块。仅显示该模块的阶段进度和建议。 |
| `--format json` | 输出结构化 JSON，而非人类可读文本。 |

## 检查内容

命令会扫描 `logos/resources/` 中的 11 个目录来判断阶段完成情况。

**单模块项目** —— 当某个阶段的目录包含至少一个非 `.gitkeep` 文件时，该阶段即为**完成**。

**多模块项目** —— 阶段完成情况是模块感知的：
- **场景阶段**（`phase.3-1`、`phase.3-4a`）：当属于该模块的每个场景都有匹配的 `<moduleId>-SXX-*.md` 文件时为完成。
- **所有其他阶段**：当目录包含至少一个带 `<moduleId>-` 前缀的文件（例如 `admin-01-requirements.md`）时为完成。属于其他模块的文件会被忽略。

| 阶段 | 扫描的目录 |
|-------|-------------------|
| Phase 1 · Requirements | `logos/resources/prd/1-product-requirements/` |
| Phase 2 · Product Design | `logos/resources/prd/2-product-design/` |
| Phase 3-0 · Architecture | `logos/resources/prd/3-technical-plan/1-architecture/` |
| Phase 3-1 · Scenario Modeling | `logos/resources/prd/3-technical-plan/2-scenario-implementation/` |
| Phase 3-2 · API Design | `logos/resources/api/` |
| Phase 3-2 · DB Design | `logos/resources/database/` |
| Phase 3-3 · Deployment Plan | `logos/resources/prd/3-technical-plan/3-deployment/` |
| Phase 3-4a · Test Cases | `logos/resources/test/` |
| Phase 3-4b · Orchestration | `logos/resources/scenario/` |
| Phase 3-6 · Verification | `logos/resources/verify/` |
| Phase 3-8 · Smoke Test | `logos/resources/verify/smoke-report.md` |

**注意：** Phase 3-5（代码实现 + 测试代码）不作为独立目录跟踪，因为代码输出进入项目源码树。它的完成情况通过 Phase 3-6 间接验证 —— 当测试通过且 `openlogos verify` 报告 Gate 3.6 PASS 时，Phase 3-5 即被隐式确认。Phase 3-7（部署执行）通过部署报告跟踪。

它还会扫描 `logos/changes/` 中的活跃变更提案（排除 `archive/`）。

## 输出示例（进行中）

```
📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · Requirements (WHY)
     └─ core-01-requirements.md
✅  Phase 2 · Product Design (WHAT)
     └─ 1-feature-specs/core-01-feature-specs.md
🔲  Phase 3-0 · Architecture
🔲  Phase 3-1 · Scenario Modeling
🔲  Phase 3-2 · API Design
🔲  Phase 3-2 · Database Design
🔲  Phase 3-3a · Test Case Design (Unit + Scenario)
🔲  Phase 3-3b · API Orchestration Tests
🔲  Phase 3-4 · Code Implementation + Test Code
🔲  Phase 3-5 · Test Acceptance (verify)
──────────────────────────────────────────────────

🧩 Modules

  🔄  core (Core)  [initial → Phase 3-0 · Architecture]
       💡 Tell AI: "Help me design the technical architecture"

💡 Suggested next step: Phase 3-0 · Architecture
   → Tell AI: "Help me design the technical architecture"
```

## 输出示例（多模块）

当注册了多个模块时，每个模块的阶段进度会独立展示：

```
📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · Requirements (WHY)
✅  Phase 2 · Product Design (WHAT)
✅  Phase 3-0 · Architecture
...
──────────────────────────────────────────────────

🧩 Modules

  ✅  core (Core)  [launched]
       💡 Run openlogos change <slug> to create a new change proposal
  🔄  admin (Admin)  [initial → Phase 1 · Requirements (WHY)]
       💡 Tell AI: "Help me write requirements"
```

使用 `--module admin` 聚焦到单个模块：

```bash
openlogos status --module admin
```

```
🧩 Modules

  🔄  admin (Admin)  [initial → Phase 1 · Requirements (WHY)]
       💡 Tell AI: "Help me write requirements"
```

## 输出示例（全部完成）

```
📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · Requirements (WHY)
     └─ 01-requirements.md
✅  Phase 2 · Product Design (WHAT)
     └─ ...
✅  Phase 3-0 · Architecture
     └─ 01-architecture-overview.md
✅  Phase 3-1 · Scenario Modeling
     └─ ...
✅  Phase 3-2 · API Design
     └─ openapi.yaml
✅  Phase 3-2 · Database Design
     └─ schema.sql
✅  Phase 3-3a · Test Case Design
     └─ ...
✅  Phase 3-3b · API Orchestration Tests
     └─ ...
✅  Phase 3-4 · Code Implementation + Test Code
     └─ (validated via Phase 3-5)
✅  Phase 3-5 · Test Acceptance (verify)
     └─ acceptance-report.md
──────────────────────────────────────────────────

🎉 All phases complete! Run `openlogos verify` to check test acceptance.
   → Run `openlogos launch` to activate change management for future iterations.
```

## 活跃的变更提案

当 lifecycle 为 `launched` 且 `logos/changes/` 中有未关闭的提案时，会显示提案步骤：

```
📝 Active Change Proposals
     └─ fix-redirect-bug (proposal.md ✓ | tasks.md ✓ | deltas: 3 files)
──────────────────────────────────────────────────
```

### 提案步骤

提案步骤跟踪一个变更提案处于其生命周期中的哪个位置：

| 步骤 | 含义 |
|------|---------|
| `writing` | `proposal.md` 或 `tasks.md` 仍包含模板占位符 |
| `delta-writing` | 提案已填写；`[delta]` 分节任务尚未全部勾选 |
| `ready-to-merge` | 所有 `[delta]` 分节任务已勾选（或没有 `[delta]` 分节） |
| `merge-generated` | `openlogos merge` 已运行；`MERGE_PROMPT.md` 已生成 |
| `coding` | specs 已合并（`SPEC_MERGED` 存在）；`[code]` 分节任务尚未全部勾选 |
| `ready-to-verify` | 所有 `[code]` 分节任务已勾选（或没有 `[code]` 分节） |
| `verify-passed` | `openlogos verify` 通过；已写入 `VERIFY_PASS` 标记 |
| `verify-failed` | `openlogos verify` 失败；已写入 `VERIFY_FAIL` 标记 |

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录，或先运行 `openlogos init` |
| `Module 'admin' not found in logos-project.yaml` | `--module` 的值与任何已注册模块都不匹配 | 运行 `openlogos module list` 查看有效的模块 ID |

## 相关命令

- [`init`](/zh/cli/init) — 创建 `status` 所检查的项目结构
- [`module`](/zh/cli/module) — 管理模块（list / add / rename / remove）
- [`launch`](/zh/cli/launch) — 激活变更管理（所有阶段完成时建议）
- [`verify`](/zh/cli/verify) — 运行 Phase 3-5 验证检查
