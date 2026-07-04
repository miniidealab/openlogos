---
title: 变更管理
description: Delta 变更管理机制——变更提案、影响分析、delta 合并与归档。
---

Delta 变更管理规格定义了 OpenLogos 项目在首轮开发周期之后如何处理功能迭代和缺陷修复。每次变更都从提案开始，经过评审，再合并回主文档——确保可追溯、可审计、可回滚。

## 核心原则

1. **绝不直接修改主文档**——每次变更都从 `logos/changes/` 中的提案开始
2. **影响分析先行**——`proposal.md` 必须清晰界定变更的影响范围
3. **按需传播**——并非每次变更都需要全链路更新；只更新受影响的层级
4. **归档留痕**——已完成的变更会被归档，保留完整的审计轨迹

## 生命周期状态

当项目从 `initial` 生命周期转入 `launched`（通过 `openlogos launch`）时，变更管理被激活。在初始开发阶段，变更直接随 Phase 推进流动，无需提案。

| 生命周期 | 行为 |
|-----------|----------|
| `initial` | 自由遵循 Phase 1 → 2 → 3 推进，无需提案 |
| `launched` | 所有变更都需先通过 `openlogos change <slug>` 创建提案，再修改代码 |

## 目录结构

```
logos/
├── resources/                    # Main documents (current "source of truth")
│
└── changes/                      # Change proposal workspace
    ├── add-remember-me/          # An active change proposal
    │   ├── proposal.md           # Change description + impact analysis
    │   ├── tasks.md              # Implementation task checklist
    │   └── deltas/               # Delta files (incremental modifications)
    │       ├── prd/
    │       ├── api/
    │       ├── database/
    │       └── scenario/
    │
    └── archive/                  # Completed change history
        └── add-remember-me/
```

## 守卫机制

当有活跃的变更提案时，OpenLogos 会写入一个 `logos/.openlogos-guard` 锁文件来追踪当前活跃的变更。该文件：

- **存在** → AI 可以修改代码，但只能在提案范围内
- **不存在** → 禁止修改源代码；先运行 `openlogos change <slug>`

守卫文件由 `openlogos change` 创建，由 `openlogos archive` 移除。

## 文件规格

### proposal.md

变更描述文档。必须包含：

```markdown
# Change Proposal: [Change Name]

## Reason for Change
[Why is this change needed? What requirement/feedback/bug triggered it?]

## Change Scope
- Affected requirements documents: [list]
- Affected feature specs: [list]
- Affected scenarios: [list]
- Affected APIs: [list]
- Affected DB tables: [list]

## Change Summary
[1-3 paragraphs describing what specifically changes]
```

### tasks.md

使用结构化章节标签的实现任务清单：

```markdown
# Implementation Tasks

## [delta] Spec Changes
- [ ] Output delta file to deltas/prd/1-product-requirements/ — Update requirements
- [ ] Output delta file to deltas/api/ — Update API YAML

## [code] Code Implementation
- [ ] Implement business logic in src/xxx
- [ ] Write corresponding tests
```

章节标签规则：
- `## [delta]`——仅 delta 文档输出任务。全部勾选 → `ready-to-merge`
- `## [code]`——仅代码实现任务。全部勾选 → `ready-to-verify`
- 两个章节都是可选的：纯代码提案只有 `[code]`，纯规格提案只有 `[delta]`
- 没有 `[delta]` 章节 → 提案直接跳到 `ready-to-merge`
- 旧格式（无章节标签）→ 回退到全局全部勾选逻辑以保持向后兼容

> **注意**：`openlogos verify` 是一个独立的 CLI 步骤。不要在 `tasks.md` 中添加 verify/验收任务。

### deltas/ 目录

delta 文件使用带标签的格式来描述增量修改：

```markdown
## ADDED — [New Content Title]
[Complete new content]

## MODIFIED — [Modified Content Title]
[Complete modified content, replaces the same-named section in the main document]

## REMOVED — [Removed Content Title]
[Reason for removal]
```

delta 目录结构与主文档目录一致。`openlogos merge` 会递归扫描子目录，并保留嵌套路径：

| Delta 路径 | 对应于 |
|-----------|----------------|
| `deltas/prd/` | `logos/resources/prd/` |
| `deltas/api/` | `logos/resources/api/` |
| `deltas/database/` | `logos/resources/database/` |
| `deltas/scenario/` | `logos/resources/scenario/` |
| `deltas/test/` | `logos/resources/test/` |

`prd/` 子目录直接映射：

| Delta 路径 | 对应于 |
|-----------|----------------|
| `deltas/prd/1-product-requirements/` | `logos/resources/prd/1-product-requirements/` |
| `deltas/prd/2-product-design/1-feature-specs/` | `logos/resources/prd/2-product-design/1-feature-specs/` |
| `deltas/prd/3-technical-plan/1-architecture/` | `logos/resources/prd/3-technical-plan/1-architecture/` |
| `deltas/prd/3-technical-plan/2-scenario-implementation/` | `logos/resources/prd/3-technical-plan/2-scenario-implementation/` |

## 变更工作流

```
1. Create change proposal (CLI)
   └── openlogos change {slug}
   └── Generates logos/changes/{slug}/proposal.md + tasks.md + deltas/
   └── Writes logos/.openlogos-guard

2. AI-assisted proposal writing (change-writer Skill)
   └── AI analyzes impact scope, fills in proposal.md and tasks.md
   └── [delta] section: delta output tasks | [code] section: code tasks

3. Produce delta files per [delta] task
   └── For each completed task, write incremental changes to deltas/ subdirectories
   └── Check off each [delta] task when done → proposal_step: ready-to-merge

4. Generate merge instructions (CLI) [human confirmation point]
   └── openlogos merge {slug}
   └── Recursively scans deltas/, generates MERGE_PROMPT.md
   └── Writes MERGE_PROMPT_GENERATED marker → proposal_step: merge-generated

5. AI executes merge (merge-executor Skill)
   └── AI reads MERGE_PROMPT.md, merges each delta into logos/resources/
   └── Commits spec documents, then writes SPEC_MERGED marker
   └── proposal_step: coding

6. Implement code per [code] tasks
   └── Check off each [code] task when done → proposal_step: ready-to-verify

7. Run verification (CLI) [human confirmation point]
   └── openlogos verify
   └── Writes VERIFY_PASS or VERIFY_FAIL to proposal directory
   └── proposal_step: verify-passed or verify-failed

8. Archive change (CLI) [human confirmation point]
   └── openlogos archive {slug}
   └── Moves logos/changes/{slug}/ to logos/changes/archive/
```

**人类确认点**：`openlogos merge`、`openlogos verify`、`openlogos archive` 和 `git push`。未经用户明确授权，AI 不得执行这些操作。

## launched 变更流程（重构后）

上面的八步大纲是历史上单段 `propose` 的视角。在当前的 launched 流程下（见 [Flow 规范](/zh/specs/flow-spec)），变更生命周期是一条七子流程流水线：

```
plan → spec → merge → slice → implement → deliver → close
```

旧的 `propose` 段拆成三段，各自以自己的门收尾：

| 子流程 | 节点 | 出口门 | 变化 |
|--------|------|--------|------|
| **plan** | `write-proposal`、`write-tasks` | `plan-exit`（human，可跳） | 新增「批准方案」门。`write-tasks` 仅产 `[delta]`/`[deploy]`——**不产 `[code]`** |
| **spec** | `write-delta` | `spec-exit`（human，可跳） | `when: delta_required`；审 delta + 授权合并 |
| **merge** | `generate-merge-prompt`、`apply-merge` | — | `when: delta_required`；纯代码提案整段跳过 |
| **slice** | `plan-slices`（slice-planner） | `slice-exit`（human，可跳） | 新增段；`when: code_required`；对**已合并**规格 + 真实测试 ID 划分 `[code]` 切片（见 [切片规划](/zh/specs/slice-planner)） |
| **implement** | `code`、`verify` | — | 默认激活切片循环（`until: code_slices_green`） |
| **deliver** | `deploy`、`smoke` | `deliver-entry`（human，可跳） | 部署在**提案级**决策 |
| **close** | `archive` | — | — |

两点结构性后果：

- **`[code]` 切片划分从 plan 段挪到 slice 段。** 不再在写任务时进行（对草案猜），而是在 merge 后、对真实已合并规格 + 已定测试 ID 进行。`write-tasks` 以 `tasks_delta_filled` 完成；`plan-slices` 以 `tasks_code_filled` 完成。
- **部署是提案级决策，不再取模块默认。** launched 流程从提案声明的部署影响 + `[deploy]` section 解析 `deployment_required` / `smoke_required`（`resolveProposalDeploymentDecision()`），绝不回退模块默认——故声明「无需部署」的提案不会错误进入 deploy。`deliver-entry` 门 `skippable: true`，无人值守 `--auto` 可放行，手动模式仍停下等确认。

新增的 `proposal_step` 驻留态 `ready-to-delta`（在 `plan-exit`）与 `ready-to-implement`（在 `slice-exit`）表达这两个新门；见 [CLI JSON 输出](/zh/specs/cli-json-output)。

## 变更传播规则

并非每次变更都需要全链路更新。受影响的范围取决于变更类型：

| 变更类型 | 最小更新范围 | 描述 |
|------------|---------------------|-------------|
| 需求级 | 全链路 | 需求变了——所有下游都可能受影响 |
| 设计级 | 原型 + 场景 + API/DB + 编排 + 代码 | 需求不变，实现方式调整 |
| 接口级 | API/DB + 编排 + 代码 | 设计不变，接口细节调整 |
| 代码级修复 | 代码 + 重新验证 | 缺陷修复，不涉及设计变更 |

## MERGE_PROMPT.md 格式

由 `openlogos merge` 自动生成，这份指令文件告诉 AI 如何应用 delta：

```markdown
# Merge Instruction

## Change Proposal
- Name: {slug}
- Directory: logos/changes/{slug}/

## Proposal Content
[Full content from proposal.md]

## Delta Files to Merge

### 1. {delta-relative-path}
- Delta file: `logos/changes/{slug}/deltas/{category}/{file}`
- Target directory: `logos/resources/{category}/`
- Action: Read ADDED / MODIFIED / REMOVED tags, merge into target main documents

## Execution Requirements
1. Process each delta file sequentially, report summary after each
2. For ADDED tags: Insert new content at the specified location
3. For MODIFIED tags: Replace the same-named section's content
4. For REMOVED tags: Delete the corresponding section
5. Maintain original formatting and style of main documents
6. Update "last updated" timestamps if present
7. After all changes, list the modification summary
8. Remind user to run `openlogos archive {slug}`
```

## Git 集成

- 每个变更提案对应一个 Git 分支：`change/{change-name}`
- 分支合并时，`logos/changes/{change-name}/` 被移动到 `logos/changes/archive/`
- 重大变更会记录在文档头部的「最后更新」时间戳中
- `logos/changes/archive/` 提供完整的变更历史

## CLI 命令

```bash
openlogos change add-remember-me   # Create change proposal
openlogos merge add-remember-me    # Generate merge instructions
openlogos archive add-remember-me  # Archive completed change
```

## 相关 Skill

| Skill | 角色 |
|-------|------|
| [`change-writer`](/zh/skills/change-writer) | 在 `openlogos change` 之后使用，填写 proposal.md 和 tasks.md |
| [`merge-executor`](/zh/skills/merge-executor) | 在 `openlogos merge` 之后使用，读取 MERGE_PROMPT.md 并执行合并 |
