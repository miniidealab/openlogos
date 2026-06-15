---
title: "tasks.md 格式"
description: 变更提案任务文件的结构化格式规格——章节标记、状态检测与基于阶段的组织。
---

本规格定义 OpenLogos 变更提案中 `tasks.md` 的结构化格式。CLI 依赖此格式来准确判断提案各阶段的任务状态。

## 格式总览

`tasks.md` 使用带标记的章节来组织任务，每个章节对应提案工作流中的一个阶段：

```markdown
# 实现任务

## [delta] 规格变更
- [ ] Produce delta file to deltas/prd/1-product-requirements/ — update requirements
- [ ] Produce delta file to deltas/api/ — update API YAML

## [code] 代码实现
- [ ] Implement business logic in src/xxx
- [ ] Write corresponding tests

## [deploy] 部署执行
- [ ] Deploy to staging environment
- [ ] Verify deployment health
```

## 章节标记

| 标记 | 阶段 | 用途 |
|--------|-------|---------|
| `[delta]` | 规格变更 | delta 文件产出任务 |
| `[code]` | 代码实现 | 业务代码 + 测试代码任务 |
| `[deploy]` | 部署 | 部署执行任务（可选） |

无标记的章节被视为通用任务，不影响提案步骤检测。

## 任务格式

每个任务是一个 Markdown 复选框：

```markdown
- [ ] Uncompleted task description
- [x] Completed task description
```

## CLI 如何使用此格式

### 提案步骤检测

`openlogos status` 读取 `tasks.md` 来判断当前提案步骤：

| 条件 | 提案步骤 |
|-----------|---------------|
| `[delta]` 章节有未勾选项 | `delta-writing` |
| 所有 `[delta]` 项已勾选（或无 `[delta]` 章节） | `ready-to-merge` |
| `SPEC_MERGED` 存在 + `[code]` 有未勾选项 | `coding` |
| 所有 `[code]` 项已勾选（或无 `[code]` 章节） | `ready-to-verify` |
| `VERIFY_PASS` 存在 + `[deploy]` 有未勾选项 | `ready-to-deploy` |
| 所有 `[deploy]` 项已勾选 | `deploy-done` / `ready-to-smoke` |

### 部署决策

`[deploy]` 章节的存在意味着提案需要部署：

- **有 `[deploy]` 章节** → `deployment_required: true`（从任务视角看）
- **无 `[deploy]` 章节** → 回退到 `proposal.md` 的部署影响声明

如果 `proposal.md` 写「无需部署」但 `tasks.md` 有 `[deploy]` 章节，`openlogos status --format json` 会报告 `deployment_decision_conflict`。

## 编写指南

1. 每个任务应是一个单一、可执行的事项
2. 任务应足够具体以便验证完成
3. delta 任务应引用目标目录
4. 代码任务应引用源文件或模块
5. 部署任务应引用目标环境

## 示例：完整生命周期

```markdown
# 实现任务

## [delta] 规格变更
- [x] Produce delta to deltas/prd/1-product-requirements/ — add S05 acceptance criteria
- [x] Produce delta to deltas/api/ — add GET /suggestions endpoint
- [x] Produce delta to deltas/test/ — add S05 test cases

## [code] 代码实现
- [x] Implement suggestion engine in src/lib/suggestions.ts
- [x] Add GET /suggestions route handler
- [x] Write UT-S05-01 through UT-S05-06 test code
- [x] Write ST-S05-01 through ST-S05-03 scenario tests
- [x] Add OpenLogos reporter to test runner

## [deploy] 部署执行
- [ ] Deploy to staging
- [ ] Verify /suggestions endpoint responds
```

## 相关

- [变更管理](/zh/specs/change-management)——完整提案生命周期
- [`openlogos status`](/zh/cli/status)——读取 tasks.md 进行提案步骤检测
- [`openlogos change`](/zh/cli/change)——创建初始 tasks.md 模板
