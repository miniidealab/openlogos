# CLI JSON 结构化输出规格

> 版本: 1.0.0 | 创建日期: 2026-04-13

## 1. 概述

OpenLogos CLI 的 `status`、`next`、`verify`、`smoke`、`detect` 五类命令支持 `--format json` 参数，输出结构化 JSON 供外部工具（如 RunLogos）以编程方式消费。

### 1.1 通用约定

- **触发方式**：在命令后追加 `--format json`
- **输出目标**：JSON 输出到 **stdout**；错误信息仍输出到 **stderr**
- **JSON 格式**：紧凑单行输出（无缩进），方便管道处理
- **退出码**：与人类可读模式保持一致
- **编码**：UTF-8
- **字段命名**：snake_case

### 1.2 通用信封结构

所有命令的 JSON 输出共享同一信封结构：

```jsonc
{
  "command": "<command-name>",   // "status" | "next" | "verify" | "smoke" | "detect" | "module list"
  "version": "<cli-version>",
  "timestamp": "<ISO-8601>",
  "data": { ... }
}
```

---

## 2. `openlogos detect --format json`

探测 CLI 版本和当前目录的项目信息。合并了 `--version` 的功能并扩展了项目探测能力。

### 2.1 用法

```bash
openlogos detect                # 人类可读格式
openlogos detect --format json  # JSON 格式
```

### 2.2 JSON Schema（data 部分）

```jsonc
{
  "cli": {
    "version": "0.5.9",           // CLI 版本号
    "node_version": "v22.0.0"     // Node.js 运行时版本
  },
  "project": null | {             // null 表示当前目录不是 OpenLogos 项目
    "name": "my-project",         // 项目名
    "locale": "zh",               // 语言设置
    "lifecycle": "launched",        // "initial" | "launched"
    "modules": [
      {
        "id": "core",
        "name": "核心功能",
        "lifecycle": "launched"
      }
    ],
    "description": "项目描述",     // 项目描述
    "source_roots": null | {      // 源代码根目录，null 表示未配置
      "src": ["src"],             // 业务代码根目录列表
      "test": ["test"]            // 测试代码根目录列表
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
| `project.modules[].lifecycle` | string | 是 | 模块生命周期：`"initial"` 或 `"launched"` |
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
    },
    {
      "key": "phase.2",
      "label": "Phase 2 · 产品设计 (WHAT)",
      "done": false,
      "skipped": false,
      "files": []
    },
    {
      "key": "phase.3-3-deployment",
      "label": "Phase 3-3 · 部署方案",
      "done": true,
      "skipped": false,
      "files": ["core-01-deployment-plan.md"]
    },
    {
      "key": "phase.3-7-deploy",
      "label": "Phase 3-7 · 部署执行",
      "done": false,
      "skipped": false,
      "files": []
    },
    {
      "key": "phase.3-8-smoke",
      "label": "Phase 3-8 · 部署冒烟测试（smoke）",
      "done": false,
      "skipped": false,
      "files": []
    }
    // ... 所有 phase
  ],
  "modules": [                      // 模块注册表（来自 logos-project.yaml）
    {
      "id": "core",
      "name": "核心功能",
      "lifecycle": "initial",       // "initial" | "launched"
      "current_phase": "phase.3-2-api",  // 当前推进阶段 key；launched 模块为 null
      "current_phase_label": "Phase 3.2 · API 设计",
      "phase_progress": {           // 各阶段进度；launched 模块为 null
        "phase.1": { "done": true, "skipped": false },
        "phase.3-1": {
          "done": false, "skipped": false,
          "scenario_coverage": { "total": 3, "covered": 2, "missing": ["S03"] }
        }
      },
      "active_change": null,        // 仅 launched 模块有值
      "suggestion": "对 AI 说：「设计 API」"
    },
    {
      "id": "payment",
      "name": "支付模块",
      "lifecycle": "launched",
      "current_phase": null,
      "current_phase_label": null,
      "phase_progress": null,
      "active_change": {            // 当前活跃变更提案
        "slug": "add-refund",
        "proposal_step": "delta-writing",  // 见 proposal_step 枚举
        "proposal_step_label": "撰写 Delta",
        "has_proposal": true,
        "has_tasks": true,
        "tasks_checked": 2,
        "tasks_total": 5,
        "delta_count": 1,
        "deployment_required": false,
        "smoke_required": false,
        "deployment_reason": "文档-only 提案，不需要发布运行产物",
        "deployment_decision_source": "proposal",
        "deployment_decision_conflict": false,
        "deployment_decision_conflict_reason": null
      },
      "suggestion": "继续为 add-refund 产出 delta 文件，完成后明确授权执行 openlogos merge add-refund"
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
  "current_phase": "phase.2",      // 第一个未完成 phase 的 key，若全部完成则为 null
  "suggestion": "对 AI 说：「基于需求文档做产品设计」",  // 建议的下一步操作
  "all_done": false,               // 是否所有 phase 都已完成
  "lifecycle": "launched",          // 项目生命周期，派生值："initial" | "launched"
  "source_roots": null | {         // 源代码根目录，null 表示未配置
    "src": ["src"],
    "test": ["test"]
  },
  "yaml_diagnostics": null | {
    "parse_status": "recovered",
    "messages": ["logos-project.yaml 存在可恢复的解析错误"]
  }
}
```

### 3.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `phases` | array | 是 | 所有阶段的状态列表（固定 10 个元素） |
| `phases[].key` | string | 是 | 阶段标识符（如 `phase.1`, `phase.3-2-api`） |
| `phases[].label` | string | 是 | 阶段的本地化标签 |
| `phases[].done` | boolean | 是 | 该阶段是否已完成（有文件 = true） |
| `phases[].skipped` | boolean | 是 | 该阶段是否被跳过（空但后续阶段已完成） |
| `phases[].files` | string[] | 是 | 该阶段目录下的文件列表 |
| `modules` | array | 否 | 模块注册表；`logos-project.yaml` 无 `modules[]` 时省略此字段（向下兼容） |
| `modules[].id` | string | 是 | 模块标识符 |
| `modules[].name` | string | 是 | 模块名称 |
| `modules[].lifecycle` | string | 是 | 模块生命周期：`"initial"` 或 `"launched"` |
| `modules[].current_phase` | string \| null | 是 | 当前推进阶段 key；`launched` 模块为 null |
| `modules[].current_phase_label` | string \| null | 是 | 当前阶段本地化标签；`launched` 模块为 null |
| `modules[].phase_progress` | object \| null | 是 | 各阶段进度 map（key = phase key）；`launched` 模块为 null |
| `modules[].phase_progress[key].done` | boolean | 是 | 该阶段是否已完成 |
| `modules[].phase_progress[key].skipped` | boolean | 是 | 该阶段是否被跳过 |
| `modules[].phase_progress[key].scenario_coverage` | object \| undefined | 否 | 仅场景类阶段（`phase.3-1`、`phase.3-4a`）存在 |
| `modules[].active_change` | object \| null | 是 | 当前活跃变更提案；`initial` 模块或无活跃提案时为 null |
| `modules[].active_change.slug` | string | 是 | 提案 slug |
| `modules[].active_change.proposal_step` | string | 是 | 提案阶段：`"writing"` \| `"delta-writing"` \| `"ready-to-merge"` \| `"merge-generated"` \| `"coding"` \| `"ready-to-verify"` \| `"verify-passed"` \| `"verify-failed"` \| `"ready-to-deploy"` \| `"deploy-done"` \| `"ready-to-smoke"` \| `"smoke-passed"` \| `"smoke-failed"`；`"implementing"` / `"in-progress"` 为旧版本兼容值 |
| `modules[].active_change.proposal_step_label` | string | 是 | 提案阶段本地化标签 |
| `modules[].active_change.has_proposal` | boolean | 是 | 是否存在 proposal.md |
| `modules[].active_change.has_tasks` | boolean | 是 | 是否存在 tasks.md |
| `modules[].active_change.tasks_checked` | number | 是 | 已勾选任务数 |
| `modules[].active_change.tasks_total` | number | 是 | 总任务数 |
| `modules[].active_change.delta_count` | number | 是 | deltas 目录下的文件数 |
| `modules[].active_change.deployment_required` | boolean \| null | 是 | 活跃提案是否需要部署；无法判断时为 null |
| `modules[].active_change.smoke_required` | boolean \| null | 是 | 活跃提案是否需要部署后 smoke；无法判断时为 null |
| `modules[].active_change.deployment_reason` | string \| null | 是 | 来自 `proposal.md` 的部署原因或兼容推断说明 |
| `modules[].active_change.deployment_decision_source` | string | 是 | `"proposal"` \| `"tasks"` \| `"module-default"` \| `"legacy-fallback"`，表示部署决策来源 |
| `modules[].active_change.deployment_decision_conflict` | boolean | 是 | `proposal.md` 与 `[deploy]` section 是否冲突 |
| `modules[].active_change.deployment_decision_conflict_reason` | string \| null | 否 | 冲突原因摘要；无冲突时为 null |
| `modules[].suggestion` | string | 是 | 针对该模块的下一步建议（本地化文本） |
| `active_proposals` | array | 是 | 活跃变更提案列表 |
| `active_proposals[].name` | string | 是 | 提案目录名 |
| `active_proposals[].has_proposal` | boolean | 是 | 是否存在 proposal.md |
| `active_proposals[].has_tasks` | boolean | 是 | 是否存在 tasks.md |
| `active_proposals[].delta_count` | number | 是 | deltas 目录下的文件数 |
| `current_phase` | string \| null | 是 | 当前应推进的阶段 key；全部完成时为 null |
| `suggestion` | string | 是 | 建议的下一步操作（本地化文本） |
| `all_done` | boolean | 是 | 是否全部阶段已完成（skipped 阶段不阻塞） |
| `lifecycle` | string | 是 | 项目生命周期（`initial` 或 `launched`，由模块状态派生） |
| `source_roots` | object \| null | 是 | 源代码根目录配置；未配置时为 null |
| `yaml_diagnostics` | object \| null | 否 | `logos-project.yaml` 的解析诊断；存在可恢复/不可恢复错误时返回 |
| `yaml_diagnostics.parse_status` | string | 是 | `"recovered"` 或 `"error"`；`recovered` 表示已从 AST 恢复可用的 `modules` 等数据 |
| `yaml_diagnostics.messages` | string[] | 是 | 诊断消息摘要 |

### 3.4 解析语义

`yaml_diagnostics.parse_status = "recovered"` 时，`modules` 必须保留，`lifecycle` 必须按恢复后的模块状态派生，不得因为 YAML 局部损坏而退回 `initial`。若无法恢复任何模块信息，则 CLI 必须返回明确的 `yaml_diagnostics`，而不是静默吞错。

### 3.5 冲突语义

`deployment_decision_conflict=true` 表示 CLI 检测到活跃提案的 `proposal.md` 部署影响声明与 `tasks.md` 的 `[deploy]` section 不一致。客户端必须将其视为阻塞态，提示用户修正提案或任务清单，不得继续展示部署、smoke 或归档主动作。

---

## 4. `openlogos verify --format json`

### 4.1 用法

```bash
openlogos verify                # 人类可读格式
openlogos verify --format json  # JSON 格式
```

### 4.2 JSON Schema（data 部分）

```jsonc
{
  "summary": {
    "defined_count": 10,          // 定义的测试用例总数（不含 [manual] 用例）
    "ut_count": 6,                // 单元测试用例数
    "st_count": 4,                // 场景测试用例数
    "manual_count": 2,            // 标记为 [manual] 的用例数（已从 defined_count 中排除）
    "executed_count": 10,         // 已执行的测试用例数
    "passed_count": 8,            // 通过数
    "failed_count": 1,            // 失败数
    "skipped_count": 1,           // 跳过数
    "uncovered_count": 0,         // 未覆盖数
    "coverage_pct": 100,          // 覆盖率百分比（整数）
    "pass_rate_pct": 80           // 通过率百分比（整数）
  },
  "gate": {
    "result": "FAIL",             // "PASS" | "FAIL"
    "reason": "failed_cases"      // 失败原因分类，见下表
  },
  "failed_cases": [
    {
      "id": "UT-S01-03",
      "error": "Expected 200, got 500"
    }
  ],
  "uncovered_cases": ["ST-S02-01"],
  "skipped_cases": ["UT-S01-05"],
  "checklist": {
    "total": 5,
    "checked": 5,
    "unchecked_items": []         // 未确认的覆盖度校验项
  },
  "ac_trace": {
    "total": 4,
    "passed": 3,
    "failed_criteria": [
      {
        "ac_id": "S01-AC-02",
        "description": "异常处理",
        "linked_case_ids": ["ST-S01-02"],
        "status": "FAIL"
      }
    ]
  },
  "pre_run": {
    "mode": "two_phase",          // "none" | "pre_run_command" | "two_phase"
    "commands": [
      {
        "stage": "regression",    // "pre_run" | "regression" | "incremental"
        "command": "npm test",
        "status": "pass",         // "pass" | "fail" | "skipped"
        "exit_code": 0,
        "duration_ms": 1200
      },
      {
        "stage": "incremental",
        "command": "npm run test:changed",
        "status": "pass",
        "exit_code": 0,
        "duration_ms": 600
      }
    ],
    "result_paths": {
      "final": "logos/resources/verify/test-results.jsonl",
      "regression": "logos/resources/verify/test-results.regression.jsonl",
      "incremental": "logos/resources/verify/test-results.incremental.jsonl"
    },
    "merge_strategy": "last-write-wins",
    "diagnostics": [],
    "suggestions": []
  },
  "sandbox": {
    "mode": "auto",               // "off" | "auto" | "always"
    "root": "/private/tmp",
    "isolated": true,
    "workspace_write_denied": true,
    "status": "pass",             // "pass" | "warn" | "fail" | "skipped"
    "diagnostics": [],
    "suggestions": []
  },
  "report_path": "logos/resources/verify/acceptance-report.md"
}
```

### 4.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `summary.defined_count` | number | 是 | 规格中定义的测试用例总数 |
| `summary.ut_count` | number | 是 | 其中的 UT 数量 |
| `summary.st_count` | number | 是 | 其中的 ST 数量 |
| `summary.executed_count` | number | 是 | 实际执行的用例数 |
| `summary.passed_count` | number | 是 | 通过的用例数 |
| `summary.failed_count` | number | 是 | 失败的用例数 |
| `summary.skipped_count` | number | 是 | 跳过的用例数 |
| `summary.uncovered_count` | number | 是 | 未覆盖的用例数 |
| `summary.coverage_pct` | number | 是 | 覆盖率（0-100 整数） |
| `summary.pass_rate_pct` | number | 是 | 通过率（0-100 整数） |
| `gate.result` | string | 是 | 门禁结果：`"PASS"` 或 `"FAIL"` |
| `gate.reason` | string \| null | 是 | FAIL 时的原因分类，PASS 时为 null |
| `failed_cases` | array | 是 | 失败的测试用例列表 |
| `uncovered_cases` | string[] | 是 | 未覆盖的用例 ID 列表 |
| `skipped_cases` | string[] | 是 | 跳过的用例 ID 列表 |
| `checklist.total` | number | 是 | 覆盖度校验项总数 |
| `checklist.checked` | number | 是 | 已确认的项数 |
| `checklist.unchecked_items` | array | 是 | 未确认项列表（含 text 和 file） |
| `ac_trace.total` | number | 是 | 验收条件总数 |
| `ac_trace.passed` | number | 是 | 通过的验收条件数 |
| `ac_trace.failed_criteria` | array | 是 | 未通过的验收条件列表 |
| `pre_run.mode` | string | 是 | verify 预跑模式：`"none"`、`"pre_run_command"` 或 `"two_phase"` |
| `pre_run.commands` | array | 是 | 实际执行或跳过的命令阶段 |
| `pre_run.commands[].stage` | string | 是 | `pre_run`、`regression` 或 `incremental` |
| `pre_run.commands[].command` | string | 是 | 实际执行的命令文本 |
| `pre_run.commands[].status` | string | 是 | `pass`、`fail` 或 `skipped` |
| `pre_run.commands[].exit_code` | number | 否 | 命令退出码 |
| `pre_run.commands[].duration_ms` | number | 否 | 命令执行时长 |
| `pre_run.result_paths.final` | string | 是 | 最终验收读取的 JSONL 路径 |
| `pre_run.result_paths.regression` | string \| null | 否 | 回归阶段结果路径 |
| `pre_run.result_paths.incremental` | string \| null | 否 | 增量阶段结果路径 |
| `pre_run.merge_strategy` | string \| null | 否 | 两阶段合并策略，当前为 `last-write-wins` |
| `pre_run.diagnostics` | string[] | 是 | 可展示给用户的问题诊断 |
| `pre_run.suggestions` | string[] | 是 | 可展示给用户的修复建议 |
| `sandbox.mode` | string | 是 | verify 沙箱模式：`"off"`、`"auto"` 或 `"always"` |
| `sandbox.root` | string | 是 | 沙箱根目录 |
| `sandbox.isolated` | boolean | 是 | 本次执行是否实际隔离 |
| `sandbox.workspace_write_denied` | boolean | 是 | 是否拒绝写入仓库工作区 |
| `sandbox.status` | string | 是 | 沙箱执行结果 |
| `sandbox.diagnostics` | string[] | 是 | 沙箱诊断信息 |
| `sandbox.suggestions` | string[] | 是 | 沙箱修复建议 |
| `report_path` | string | 是 | 生成的验收报告路径 |

### 4.4 gate.reason 取值

| 值 | 说明 |
|----|------|
| `null` | 门禁通过 |
| `"failed_cases"` | 存在失败的测试用例 |
| `"incomplete_coverage"` | 存在未覆盖的测试用例 |
| `"checklist_incomplete"` | 设计时覆盖度校验未完全确认 |
| `"ac_trace_incomplete"` | 验收条件追溯未完全通过 |

### 4.5 预跑状态兼容规则

- 旧项目只配置 `verify.pre_run_command` 时，`pre_run.mode="pre_run_command"`。
- 配置 `verify.regression_command` 或 `verify.incremental_command` 时，`pre_run.mode="two_phase"`。
- 没有任何预跑命令时，`pre_run.mode="none"`。
- `sandbox_mode="off"` 时，`sandbox.status="skipped"`，并保持历史兼容行为。
- `sandbox_mode="auto"` 时，环境支持隔离则 `sandbox.status="pass"`，不支持则 `sandbox.status="warn"` 并给出降级原因。
- `sandbox_mode="always"` 时，若无法隔离则必须失败。
- 覆盖不足且 `pre_run.mode="none"` 时，必须输出局部测试诊断和配置建议。

---

## 5. `openlogos smoke --format json`

冒烟测试用于验收部署后的目标环境是否可用，不并入 `openlogos verify`。

### 5.1 用法

```bash
openlogos smoke                # 人类可读格式
openlogos smoke --format json  # JSON 格式
openlogos smoke --env staging
openlogos smoke --env production --format json
```

### 5.2 JSON Schema（data 部分）

```jsonc
{
  "environment": "staging",             // smoke 目标环境；未指定时为 null
  "summary": {
    "defined_count": 5,                 // 定义的 smoke 用例数
    "executed_count": 5,                // 已执行 smoke 用例数
    "passed_count": 5,
    "failed_count": 0,
    "skipped_count": 0,
    "uncovered_count": 0,
    "coverage_pct": 100,
    "pass_rate_pct": 100
  },
  "gate": {
    "result": "PASS",                  // "PASS" | "FAIL"
    "reason": null                     // 失败原因分类
  },
  "failed_cases": [],
  "uncovered_cases": [],
  "skipped_cases": [],
  "sandbox": {
    "mode": "auto",               // "off" | "auto" | "always"
    "root": "/private/tmp",
    "isolated": true,
    "workspace_write_denied": true,
    "status": "pass",             // "pass" | "warn" | "fail" | "skipped"
    "diagnostics": [],
    "suggestions": []
  },
  "report_path": "logos/resources/verify/smoke-report.md",
  "result_path": "logos/resources/verify/smoke-results.jsonl"
}
```

### 5.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `environment` | string \| null | 是 | 目标环境，由 `--env` 指定 |
| `summary.defined_count` | number | 是 | smoke 用例规格中定义的用例数 |
| `summary.executed_count` | number | 是 | smoke 结果中实际执行的用例数 |
| `gate.result` | string | 是 | `PASS` 或 `FAIL` |
| `gate.reason` | string \| null | 是 | 失败原因，如 `failed_cases` / `incomplete_coverage` |
| `failed_cases` | array | 是 | 失败 smoke 用例 |
| `uncovered_cases` | array | 是 | 未覆盖 smoke 用例 ID |
| `sandbox.mode` | string | 是 | smoke 沙箱模式：`"off"`、`"auto"` 或 `"always"` |
| `sandbox.root` | string | 是 | 沙箱根目录 |
| `sandbox.isolated` | boolean | 是 | 本次执行是否实际隔离 |
| `sandbox.workspace_write_denied` | boolean | 是 | 是否拒绝写入仓库工作区 |
| `sandbox.status` | string | 是 | 沙箱执行结果 |
| `sandbox.diagnostics` | string[] | 是 | 沙箱诊断信息 |
| `sandbox.suggestions` | string[] | 是 | 沙箱修复建议 |
| `report_path` | string | 是 | smoke 报告路径 |
| `result_path` | string | 是 | smoke 结果路径 |

`openlogos smoke` 与 `openlogos verify` 共享 JSONL 结果思想，但读取的是 `smoke.result_path`，默认 `logos/resources/verify/smoke-results.jsonl`。冒烟测试用例建议存放在 `logos/resources/test/smoke/`。

### 5.4 兼容规则

- `smoke.command` 仍按既有语义执行。
- `sandbox_mode` / `sandbox_root` / `sandbox_deny_workspace_write` 仅影响执行环境，不改变 smoke 门禁定义。
- 当沙箱失败时，`smoke` 仍应写入结果报告，但 JSON 输出必须明确失败原因。

---

## 6. 错误处理

当命令因错误退出时（如项目未初始化、找不到文件等），JSON 模式下输出错误 JSON 到 **stderr** 并以非零退出码退出：

```jsonc
{
  "command": "<command-name>",
  "version": "<cli-version>",
  "timestamp": "<ISO-8601>",
  "error": {
    "code": "PROJECT_NOT_INITIALIZED",
    "message": "logos/logos.config.json not found."
  }
}
```

### 6.1 错误码

| 错误码 | 说明 |
|--------|------|
| `PROJECT_NOT_INITIALIZED` | 当前目录不是 OpenLogos 项目 |
| `NO_TEST_RESULTS` | 找不到测试结果文件 |
| `NO_TEST_CASES` | 找不到测试用例规格文件 |

---

## 7. `openlogos module list --format json`

列出项目中注册的所有模块及其生命周期状态。

### 7.1 用法

```bash
openlogos module list                # 人类可读格式
openlogos module list --format json  # JSON 格式
```

### 7.2 JSON Schema（data 部分）

```jsonc
{
  "modules": [
    {
      "id": "core",
      "name": "核心功能",
      "lifecycle": "initial"    // "initial" | "launched"
    },
    {
      "id": "payment",
      "name": "支付模块",
      "lifecycle": "launched"
    }
  ]
}
```

### 7.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `modules` | array | 是 | 模块列表（与 `logos-project.yaml` 中的顺序一致） |
| `modules[].id` | string | 是 | 模块标识符（小写字母/数字/连字符） |
| `modules[].name` | string | 是 | 模块名称 |
| `modules[].lifecycle` | string | 是 | 模块生命周期：`"initial"` 或 `"launched"` |

> 若项目未注册任何模块，`modules` 为空数组 `[]`，不报错。

---

## 8. 完整用法示例

```bash
# 获取项目状态（机器可读）
openlogos status --format json | jq '.data.current_phase'

# 获取 CLI 版本和项目探测信息
openlogos detect --format json | jq '.data.cli.version'

# 获取测试验收摘要
openlogos verify --format json | jq '.data.gate.result'

# 列出所有模块的生命周期
openlogos module list --format json | jq '.data.modules[] | {id, lifecycle}'

# 在脚本中检查是否有 launched 模块
openlogos module list --format json | jq -e '.data.modules | any(.lifecycle == "launched")'

# 在脚本中检查门禁结果
if openlogos verify --format json 2>/dev/null | jq -e '.data.gate.result == "PASS"' > /dev/null; then
  echo "All tests passed!"
fi
```
