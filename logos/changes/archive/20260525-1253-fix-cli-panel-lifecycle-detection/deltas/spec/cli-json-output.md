## MODIFIED — `openlogos detect --format json`
## 2. `openlogos detect --format json`

### 2.1 用法

```bash
openlogos detect                # 人类可读格式
openlogos detect --format json  # JSON 格式
```

### 2.2 JSON Schema（data 部分）

```jsonc
{
  "cli": {
    "version": "0.5.9",
    "node_version": "v22.0.0"
  },
  "project": null | {
    "name": "my-project",
    "locale": "zh",
    "lifecycle": "launched",
    "modules": [
      {
        "id": "core",
        "name": "核心功能",
        "lifecycle": "launched"
      }
    ],
    "description": "项目描述",
    "source_roots": null | {
      "src": ["src"],
      "test": ["test"]
    }
  },
  "yaml_diagnostics": null | {
    "parse_status": "recovered",
    "messages": ["logos-project.yaml 存在可恢复的解析错误"]
  }
}
```

### 2.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cli.version` | string | 是 | CLI 包版本号 |
| `cli.node_version` | string | 是 | 当前 Node.js 版本（`process.version`）|
| `project` | object \| null | 是 | 若当前目录含 `logos/logos.config.json` 则返回项目信息，否则 null |
| `project.name` | string | 是 | 项目名（来自 config） |
| `project.locale` | string | 是 | 项目语言设置 |
| `project.lifecycle` | string | 是 | 项目生命周期阶段；由 `project.modules` 派生，任一模块为 `launched` 时项目也必须为 `launched` |
| `project.modules` | array | 否 | 模块注册表；存在 `logos-project.yaml` 的 `modules[]` 时返回。即使 YAML 存在可恢复解析错误，也不得省略此字段 |
| `project.modules[].id` | string | 是 | 模块标识符 |
| `project.modules[].name` | string | 是 | 模块名称 |
| `project.modules[].lifecycle` | string | 是 | 模块生命周期：`"initial"` 或 `["launched"]` |
| `project.description` | string | 是 | 项目描述 |
| `project.source_roots` | object \| null | 是 | 源代码根目录配置；未配置时为 null |
| `project.source_roots.src` | string[] | 是 | 业务代码根目录列表 |
| `project.source_roots.test` | string[] | 是 | 测试代码根目录列表 |
| `yaml_diagnostics` | object \| null | 否 | `logos-project.yaml` 的解析诊断；存在可恢复/不可恢复错误时返回 |
| `yaml_diagnostics.parse_status` | string | 是 | `"recovered"` 或 `"error"`；`recovered` 表示已从 AST 恢复可用的 `modules` 等数据 |
| `yaml_diagnostics.messages` | string[] | 是 | 诊断消息摘要 |

### 2.4 解析语义

- 当 `yaml_diagnostics.parse_status = "recovered"` 时，`project.modules` 必须保留，`project.lifecycle` 必须按恢复后的模块状态派生。
- 当 `yaml_diagnostics.parse_status = "error"` 时，CLI 必须返回明确诊断消息，不得静默伪装成正常的 `initial` 项目。

---

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
      "active_change": null,
      "suggestion": "运行 openlogos change <slug> 创建新提案"
    }
  ],
  "active_proposals": [],
  "current_phase": null,
  "suggestion": "→ 或运行 `openlogos launch` 开始迭代开发",
  "all_done": true,
  "lifecycle": "launched",
  "source_roots": null,
  "yaml_diagnostics": null | {
    "parse_status": "recovered",
    "messages": ["logos-project.yaml 存在可恢复的解析错误"]
  }
}
```

### 3.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `phases` | array | 是 | 所有阶段的状态列表 |
| `modules` | array | 否 | 模块注册表；`logos-project.yaml` 无 `modules[]` 时省略此字段（向下兼容）。当 YAML 存在可恢复解析错误时，仍必须返回此字段 |
| `modules[].id` | string | 是 | 模块标识符 |
| `modules[].name` | string | 是 | 模块名称 |
| `modules[].lifecycle` | string | 是 | 模块生命周期：`"initial"` 或 `"launched"` |
| `modules[].current_phase` | string \| null | 是 | 当前推进阶段 key；`launched` 模块为 null |
| `modules[].current_phase_label` | string \| null | 是 | 当前阶段本地化标签；`launched` 模块为 null |
| `modules[].phase_progress` | object \| null | 是 | 各阶段进度 map（key = phase key）；`launched` 模块为 null |
| `modules[].active_change` | object \| null | 是 | 当前活跃变更提案；`initial` 模块或无活跃提案时为 null |
| `modules[].suggestion` | string | 是 | 针对该模块的下一步建议（本地化文本） |
| `active_proposals` | array | 是 | 活跃变更提案列表 |
| `current_phase` | string \| null | 是 | 当前应推进的阶段 key；全部完成时为 null |
| `suggestion` | string | 是 | 建议的下一步操作（本地化文本） |
| `all_done` | boolean | 是 | 是否全部阶段已完成（skipped 阶段不阻塞） |
| `lifecycle` | string | 是 | 项目生命周期（`initial` 或 `launched`，由模块状态派生；可恢复解析错误不得改变派生规则） |
| `source_roots` | object \| null | 是 | 源代码根目录配置；未配置时为 null |
| `yaml_diagnostics` | object \| null | 否 | `logos-project.yaml` 的解析诊断；存在可恢复/不可恢复错误时返回 |
| `yaml_diagnostics.parse_status` | string | 是 | `"recovered"` 或 `"error"`；`recovered` 表示已从 AST 恢复可用的 `modules` 等数据 |
| `yaml_diagnostics.messages` | string[] | 是 | 诊断消息摘要 |

### 3.4 解析语义

`yaml_diagnostics.parse_status = "recovered"` 时，`modules` 必须保留，`lifecycle` 必须按恢复后的模块状态派生，不得因为 YAML 局部损坏而退回 `initial`。若无法恢复任何模块信息，则 CLI 必须返回明确的 `yaml_diagnostics`，而不是静默吞错。

