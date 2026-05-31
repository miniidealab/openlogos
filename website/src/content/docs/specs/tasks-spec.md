---
title: "tasks.md Format"
description: Structured format specification for change proposal task files — section markers, status detection, and phase-based organization.
---

This specification defines the structured format for `tasks.md` in OpenLogos change proposals. The CLI depends on this format to accurately determine task status at each proposal stage.

## Format Overview

`tasks.md` uses marked sections to organize tasks, where each section corresponds to a stage in the proposal workflow:

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

## Section Markers

| Marker | Stage | Purpose |
|--------|-------|---------|
| `[delta]` | Spec changes | Delta file production tasks |
| `[code]` | Code implementation | Business code + test code tasks |
| `[deploy]` | Deployment | Deployment execution tasks (optional) |

Sections without markers are treated as general tasks and don't affect proposal step detection.

## Task Format

Each task is a Markdown checkbox:

```markdown
- [ ] Uncompleted task description
- [x] Completed task description
```

## How CLI Uses This Format

### Proposal Step Detection

`openlogos status` reads `tasks.md` to determine the current proposal step:

| Condition | Proposal Step |
|-----------|---------------|
| `[delta]` section has unchecked items | `delta-writing` |
| All `[delta]` items checked (or no `[delta]` section) | `ready-to-merge` |
| `SPEC_MERGED` exists + `[code]` has unchecked items | `coding` |
| All `[code]` items checked (or no `[code]` section) | `ready-to-verify` |
| `VERIFY_PASS` exists + `[deploy]` has unchecked items | `ready-to-deploy` |
| All `[deploy]` items checked | `deploy-done` / `ready-to-smoke` |

### Deployment Decision

The presence of a `[deploy]` section signals that the proposal requires deployment:

- **Has `[deploy]` section** → `deployment_required: true` (from tasks perspective)
- **No `[deploy]` section** → falls back to `proposal.md` deployment impact declaration

If `proposal.md` says "no deployment needed" but `tasks.md` has a `[deploy]` section, `openlogos status --format json` reports a `deployment_decision_conflict`.

## Writing Guidelines

1. Each task should be a single, actionable item
2. Tasks should be specific enough to verify completion
3. Delta tasks should reference the target directory
4. Code tasks should reference the source file or module
5. Deploy tasks should reference the target environment

## Example: Full Lifecycle

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

## Related

- [Change Management](/specs/change-management) — Full proposal lifecycle
- [`openlogos status`](/cli/status) — Reads tasks.md for proposal step detection
- [`openlogos change`](/cli/change) — Creates the initial tasks.md template
