---
title: "openlogos status"
description: 显示当前项目阶段、交付物、活跃的变更提案以及建议的下一步操作。
---

展示每个阶段完成状态的仪表盘，列出活跃的变更提案，并建议下一步操作。在多模块项目中，还会显示每个模块各自的阶段进度。

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
🔲  Phase 3-3 · Deployment Plan
🔲  Phase 3-4a · Test Case Design (Unit + Scenario)
🔲  Phase 3-4b · API Orchestration Tests
🔲  Phase 3-5 · Code Implementation
🔲  Phase 3-6 · Test Acceptance (verify)
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
✅  Phase 3-3 · Deployment Plan
     └─ ...
✅  Phase 3-4a · Test Case Design (Unit + Scenario)
     └─ ...
✅  Phase 3-4b · API Orchestration Tests
     └─ ...
✅  Phase 3-5 · Code Implementation
     └─ (validated via Phase 3-6)
✅  Phase 3-6 · Test Acceptance (verify)
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
| `writing` | `proposal.md` 或 `tasks.md` 缺失，或尚未通过计划包检查（模板占位、缺章节） |
| `ready-to-delta` | 方案已完成，停在 `plan-exit` 门（批准方案后再写 delta） |
| `delta-writing` | 方案已批准；`[delta]` 分节任务尚未全部勾选 |
| `ready-to-merge` | `[delta]` 任务已全部勾选，停在 `spec-exit` 门——明确授权执行 `openlogos merge <slug>` |
| `spec-complete-required` | 没有 `[delta]` 但需要代码——先执行 no-delta `openlogos merge <slug>` 写入 `SPEC_MERGED` |
| `test-id-required` | 规格已合并，但还没有可供切片的真实 `UT-*` / `ST-*` / `SMOKE-*` ID |
| `ready-to-implement` | 规格已合并；`[code]` 切片尚未规划，或已规划、停在 `slice-exit` 门等待批准 |
| `coding` | 切片已批准（`SLICES_APPROVED`）；`[code]` 任务尚未全部勾选 |
| `ready-to-verify` | `[code]` 任务已全部勾选（或没有 `[code]` 分节）——明确授权执行 `openlogos verify` |
| `verify-passed` | `openlogos verify` 通过（`VERIFY_PASS`），且无需部署 |
| `verify-failed` | `openlogos verify` 失败（`VERIFY_FAIL`） |
| `ready-to-deploy` | 验收通过且提案需要部署——部署须由人类明确授权 |
| `deploy-done` | 已用 `openlogos deploy-done` 记录部署完成，且无需 smoke |
| `ready-to-smoke` | 已部署；明确授权执行 `openlogos smoke` |
| `smoke-passed` / `smoke-failed` | `openlogos smoke` 的结果（`SMOKE_PASS` / `SMOKE_FAIL`） |
| `merge-generated` | 仅历史遗留：提案目录中仍带有 0.15 之前的合并标记且 `SPEC_MERGED` 不存在时出现。现行 `openlogos merge` 不会产生该步骤；直接运行 `openlogos merge <slug>` 完成合并即可 |

`merge` 是一次原子调用，因此没有「合并进行中」的中间步骤：`SPEC_MERGED` 写入后，提案直接从 `ready-to-merge`（或 `spec-complete-required`）进入 `test-id-required` / `ready-to-implement`。

### 增量修正投影（`spec_amend`）

提案写入 `SPEC_MERGED` 后，`openlogos status --format json` 会增加只读对象 `modules[].active_change.spec_amend`（合并之前不出现）：

| 字段 | 含义 |
|------|------|
| `merged_delta_digest` / `current_delta_digest` | 上次合并时与当前的 delta 摘要 |
| `pending` | delta 自上次合并后有变化时为 `true`——重跑 `openlogos merge <slug>` 即做增量修正（`result:"amended"`）。没有合并基线时为 `null`，表示「无法判断」，不能当作 `false` |
| `blocked_reason` | 修正会被拒绝的原因：`drift`、`baseline-missing`、`baseline-unreadable`、`create-withdraw`、`prototype-changed`；否则为 `null` |
| `amend_count` | 已应用的修正次数 |

该投影不写任何文件，也不改变 `proposal_step`。详见 [`openlogos merge`](/zh/cli/merge)。

## 环境视图

项目存在 `logos/environments.yaml` 登记表时（见[环境登记表](/zh/specs/environments)），`openlogos status --format json` 新增三个顶层字段；没有登记表时都不出现。

| 字段 | 含义 |
|------|------|
| `environments` | 每个已登记环境一个视图，与 [`openlogos env list`](/zh/cli/env) 的对象相同：`id`、`name`、`tier`、`current_ref`（最近一次成功部署且已确认的版本）、`last_deploy`、`last_smoke`（含 `verified`）。部署执行已启用时另有 `previous_ref`（回滚目标）、`deploy_mode`、`deploy_in_progress`；配置了晋级或审批门禁的环境另有 `promote_from`、`require_approval`、`open_approvals`、`promotion` |
| `environment_ledger` | `{ "path": "logos/.openlogos-runtime/deployments.jsonl", "corrupt_lines": 0 }`——本机部署账本路径与跳过的坏行数 |
| `environment_registry_error` | 仅在登记表存在但不合法时出现：`{ "code": "ENV_REGISTRY_INVALID", "message": "…" }`；此时 `environments` 为 `[]`，退出码不变 |

```jsonc
"environments": [
  {
    "id": "test", "name": "测试环境", "tier": "test",
    "current_ref": "0235570…", "previous_ref": null,
    "deploy_mode": "script", "deploy_in_progress": null,
    "last_deploy": { "deploy_id": "7652a96b…", "result": "done", "channel": "proposal", "mode": "script", "ref": "0235570…", … },
    "last_smoke": { "result": "pass", "env_evidence": "declared", "verified": true, … }
  }
]
```

`status` 只读取登记表与账本，不发起任何网络请求。

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录，或先运行 `openlogos init` |
| `Module 'admin' not found in logos-project.yaml` | `--module` 的值与任何已注册模块都不匹配 | 运行 `openlogos module list` 查看有效的模块 ID |

## 相关命令

- [`init`](/zh/cli/init) — 创建 `status` 所检查的项目结构
- [`module`](/zh/cli/module) — 管理模块（list / add / rename / remove）
- [`launch`](/zh/cli/launch) — 激活变更管理（所有阶段完成时建议）
- [`verify`](/zh/cli/verify) — 运行 Gate 3.6 验收（Phase 3-6）
