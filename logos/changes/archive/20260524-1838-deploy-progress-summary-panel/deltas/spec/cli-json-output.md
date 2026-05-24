## MODIFIED — `openlogos status --format json`
## 3. `openlogos status --format json`

### 3.1 用法

```bash
openlogos status                # 人类可读格式
openlogos status --format json  # JSON 格式
```

### 3.2 JSON Schema（data 部分）

```jsonc
{
  "phases": [
    {
      "key": "phase.1",
      "label": "Phase 1 · 需求文档 (WHY)",
      "done": true,
      "skipped": false,
      "files": ["core-01-requirements.md"]
    }
  ],
  "modules": [
    {
      "id": "core",
      "name": "核心功能",
      "lifecycle": "launched",
      "current_phase": null,
      "current_phase_label": null,
      "phase_progress": null,
      "active_change": {
        "slug": "add-feature",
        "proposal_step": "verify-passed",
        "proposal_step_label": "验收通过",
        "has_proposal": true,
        "has_tasks": true,
        "tasks_checked": 5,
        "tasks_total": 5,
        "delta_count": 3,
        "deployment_required": false,
        "smoke_required": false,
        "deployment_reason": "文档-only 提案，不需要发布运行产物",
        "deployment_decision_source": "proposal",
        "deployment_decision_conflict": false,
        "deployment_decision_conflict_reason": null,
        "deployment_progress": {
          "checked": 0,
          "total": 0,
          "percent": 0,
          "status": "empty",
          "label": "0/0"
        },
        "deployment_document": {
          "path": "logos/changes/add-feature/tasks.md",
          "name": "tasks.md",
          "exists": true
        }
      },
      "suggestion": "验收通过，明确授权执行 openlogos archive add-feature"
    }
  ],
  "active_proposals": [
    {
      "name": "add-feature",
      "has_proposal": true,
      "has_tasks": true,
      "delta_count": 3
    }
  ],
  "current_phase": null,
  "suggestion": "验收通过，明确授权执行 openlogos archive add-feature",
  "all_done": true,
  "lifecycle": "launched",
  "source_roots": null
}
```

### 3.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `phases` | array | 是 | 所有阶段的状态列表 |
| `modules` | array | 否 | 模块注册表；`logos-project.yaml` 无 `modules[]` 时省略此字段（向下兼容） |
| `modules[].active_change.deployment_required` | boolean \| null | 是 | 活跃提案是否需要部署；无法判断时为 null |
| `modules[].active_change.smoke_required` | boolean \| null | 是 | 活跃提案是否需要部署后 smoke；无法判断时为 null |
| `modules[].active_change.deployment_reason` | string \| null | 是 | 来自 `proposal.md` 的部署原因或兼容推断说明 |
| `modules[].active_change.deployment_decision_source` | string | 是 | `"proposal"` \| `"tasks"` \| `"module-default"` \| `"legacy-fallback"`，表示部署决策来源 |
| `modules[].active_change.deployment_decision_conflict` | boolean | 是 | `proposal.md` 与 `[deploy]` section 是否冲突 |
| `modules[].active_change.deployment_decision_conflict_reason` | string \| null | 否 | 冲突原因摘要；无冲突时为 null |
| `modules[].active_change.deployment_progress` | object \| null | 是 | 部署进度摘要；只统计当前提案 `tasks.md` 的 `[deploy]` section |
| `modules[].active_change.deployment_progress.checked` | number | 是 | `[deploy]` section 中已勾选的任务数 |
| `modules[].active_change.deployment_progress.total` | number | 是 | `[deploy]` section 中全部任务数 |
| `modules[].active_change.deployment_progress.percent` | number | 是 | 完成百分比，按 `round(checked / total * 100)` 计算 |
| `modules[].active_change.deployment_progress.status` | string | 是 | `pending` / `done` / `empty` / `unavailable` |
| `modules[].active_change.deployment_progress.label` | string | 是 | 进度标签，例如 `1/4` |
| `modules[].active_change.deployment_document` | object \| null | 是 | 部署任务文档入口；必须指向当前提案 `tasks.md` |
| `modules[].active_change.deployment_document.path` | string | 是 | `tasks.md` 的相对路径 |
| `modules[].active_change.deployment_document.name` | string | 是 | 文档名，固定为 `tasks.md` |
| `modules[].active_change.deployment_document.exists` | boolean | 是 | 文件是否存在 |
| `modules[].suggestion` | string | 是 | 针对该模块的下一步建议（本地化文本） |
| `active_proposals` | array | 是 | 活跃变更提案列表 |
| `current_phase` | string \| null | 是 | 当前应推进的阶段 key；全部完成时为 null |
| `suggestion` | string | 是 | 建议的下一步操作（本地化文本） |
| `all_done` | boolean | 是 | 是否全部阶段已完成（skipped 阶段不阻塞） |
| `lifecycle` | string | 是 | 项目生命周期（`initial` 或 `launched`，由模块状态派生） |
| `source_roots` | object \| null | 是 | 源代码根目录配置；未配置时为 null |

