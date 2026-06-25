# CLI JSON 结构化输出规格

> 版本: 1.0.0 | 创建日期: 2026-04-13

## 1. 概述

OpenLogos CLI 的 `status`、`next`、`verify`、`smoke`、`detect`、`deploy-done`、`flow show`、`watch` 等命令支持 `--format json` 参数，输出结构化 JSON 供外部工具（如 RunLogos）以编程方式消费。

> `openlogos watch` 的 `--format json` 输出**每条一行的 JSON 流**（多条 envelope，逐行换行分隔），而非单条；其余命令仍为单条 envelope。详见「`openlogos watch --format json`」一节。

### 1.1 通用约定

- **触发方式**：在命令后追加 `--format json`
- **输出目标**：JSON 输出到 **stdout**；错误信息仍输出到 **stderr**
- **JSON 格式**：紧凑单行输出（无缩进），方便管道处理
- **退出码**：与人类可读模式保持一致
- **编码**：UTF-8
- **字段命名**：snake_case

### 1.2 通用信封结构

所有命令的 JSON 输出共享同一信封结构（`watch` 为该信封的流式多条输出）：

```jsonc
{
  "command": "<command-name>",   // "status" | "next" | "verify" | "smoke" | "detect" | "deploy-done" | "module list" | "flow show" | "watch"
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

### 3.6 overlay 派生字段（overlay_nodes / current_node）

派生引擎基于 **resolved flow（内置 + 项目 overlay 合并）**。overlay `op:add` 引入的节点
**无 phase key、无 proposal_step**，经以下 node 级字段承载（与 §3.3 既有 phase / proposal_step 维度并存）：

**`modules[].overlay_nodes[]`**（仅承载 overlay-ADDED 节点；省略规则见下）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `overlay_nodes[].id` | string | overlay-added 节点 id |
| `overlay_nodes[].name` | string | 节点展示名 |
| `overlay_nodes[].state` | string | `"done"` \| `"active"` \| `"skipped"` \| `"failed"` |
| `overlay_nodes[].subflow_id` | string | 所属 subflow id |
| `overlay_nodes[].node_index` | number | resolved 序列内 0 基序号（判 gate 前后关系） |
| `overlay_nodes[].overlay_op` | string | 恒为 `"add"` |

> **只输出已到达节点**：`overlay_nodes` 仅列出**已到达**的 overlay-added 节点——其态必为 `done`/`active`/`skipped`/`failed` 之一（`active` 恒为唯一当前节点）。**尚未到达（未轮到）的 overlay-added 节点不在 `overlay_nodes` 中**（其计划可经 `flow show --resolved` 查看）。`pending`（未到达/未求值）态本切片不引入，留 cmd: 切片（S26）。

**`modules[].current_node`**（object \| 省略；**仅当当前节点为 overlay-added 时输出**）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `current_node.id` | string | 当前 overlay-added 节点 id |
| `current_node.name` | string | 节点展示名 |
| `current_node.state` | string | `done` / `active` / `skipped` / `failed` |
| `current_node.subflow_id` | string | 所属 subflow id |
| `current_node.node_index` | number | resolved 序列 0 基序号 |
| `current_node.phase_key` | null | **恒为 null**（current_node 仅为 overlay-added 节点输出）|
| `current_node.overlay_op` | string | **恒为 `"add"`** |

> **收紧约束（避免破坏 golden）**：`current_node` **只在当前节点是 overlay-added 时输出**；builtin 当前节点**不输出** `current_node`（由既有 `current_phase` / `proposal_step` 表达）。实现**不得**为 builtin current 输出 `current_node`，否则无 overlay 项目会产生新字段、破坏零漂移。

**省略规则（可测，保 golden）**：
1. `overlay_nodes` 仅当该模块 resolved flow 含 **≥1 个已到达的** overlay-added 节点时输出，否则**省略字段**（不输出空数组）。故「存在 overlay `add` 但尚未到达」与「无 overlay」一样：`overlay_nodes` 省略（计划仍可经 `flow show --resolved` 查看）；
2. `current_node` 仅当当前节点为 overlay-added 时输出，否则省略；
3. 有效 overlay-only-builtin（无 add = initial 的 skip/modify/reorder + launched 的 modify）不新增任何字段。
据此**无 overlay 文件 → 三条均不触发 → §3.2/§3.3 输出逐字节不变**。

**legacy 回退**：`modules[]` 省略的无注册表项目（见 §3.3 `modules` 字段），`overlay_nodes` / `current_node` 回退到**顶层**同名字段；消费方先读 `modules[].*`、缺则读顶层。

### 3.7 launched proposal_step 与 overlay-added 当前节点

`modules[].active_change.proposal_step`（§3.3 既有枚举值集合不变）在 launched 当前节点落于 **overlay-added 节点**时，
取值 = resolved 序列中该节点**之前最近一个 builtin 节点**对应的 step（保持合法枚举、后向兼容，**不置 null**）；
**若无前序 builtin（`add ... before` 插到首个 builtin 之前），取 `"writing"`**（状态机首态）。精确位置由 §3.6 `current_node` 承载。

### 3.8 cmd: 谓词字段（M2 切片 1b）

`cmd:<command>` 谓词（仅 overlay-add 节点）点亮后，机器契约新增：

**(a) node 级 state 枚举追加 `pending`**：`overlay_nodes[].state` 与 `current_node.state` 取值集扩为
`"done" | "active" | "skipped" | "failed" | "pending"`。`pending` 表示该 `cmd:` 节点**在观察派生（status/watch）下未被求值**——status/watch 不执行命令。无 `cmd:` 节点时不会出现 `pending`。

**(b) `flow show --resolved` node 字段新增 `cmd_timeout_seconds`**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `flow.subflows[].nodes[].cmd_timeout_seconds` | integer ≥ 1 \| null | 节点级 cmd 超时秒数；缺省 null（回退项目级 `flow.cmd_timeout_seconds` / 内置 60s）。`< 1` 或非整数 → `FLOW_SCHEMA_INVALID` |

**(c) `next --format json` 的 cmd 结果字段**（success envelope `data` 顶层；**仅本次 next 执行了 cmd 时出现，否则整组省略**）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `cmd_node_id` | string | 被求值的 cmd 节点 id（即使 done 后 current 已续推，仍归属被求值节点）|
| `cmd_predicate_field` | string | `"done_when"` \| `"fail_when"` |
| `cmd_exit_code` | number \| null | 命令退出码；超时为 null |
| `cmd_timed_out` | boolean | 是否超时 |
| `cmd_satisfied` | boolean | 该 cmd 谓词是否满足（exit 0）；**非节点最终完成态**（看 `current_node.state`）|

出现条件矩阵：

| 触发 | `cmd_predicate_field` | `cmd_exit_code` | `cmd_timed_out` | `cmd_satisfied` | 结果 |
|---|---|---|---|---|---|
| done_when:cmd exit 0 | done_when | 0 | false | true | 节点 done、本次续推 |
| done_when:cmd 非 0 | done_when | N | false | false | active |
| done_when:cmd 超时 | done_when | null | true | false | active |
| fail_when:cmd exit 0 | fail_when | 0 | false | true | failed |
| fail_when:cmd 非 0/超时（未命中） | fail_when | N/null | false/true | false | 继续评该节点（非 cmd 的）done_when |
| 本次未执行 cmd | — | — | — | — | 字段整组省略 |

**(d) 执行输出隔离 / 容量边界**：`next` 执行 cmd 时 child stdout/stderr **必须捕获、绝不写父进程 stdout**（保 `next --format json` 单条合法 envelope）；
持续 drain 防阻塞、每路尾部 ≤64KiB 截断；**命令输出不进 envelope**。

**(e) 每次 next cmd budget = 1**：单次 `next` 至多执行 1 个 cmd；续推后若新 current 又是 cmd 节点，输出为 `current_node`（`state: "pending"`）但不执行第二个。

**(f) builtin gate 的 `cmd_gate` 字段（S30）**：S30 把 cmd: 放开到 launched `verify`/`deploy`/`smoke` gate。因 `current_node` **仅承载 overlay-add 节点**
（§3.6 收紧约束不变），builtin gate 的 observe-pending 另由 **`cmd_gate`** 字段承载：

| 字段 | 类型 | 说明 |
|---|---|---|
| `cmd_gate.node_id` | string | `"verify"` \| `"deploy"` \| `"smoke"` |
| `cmd_gate.field` | string | `"done_when"` \| `"fail_when"` |
| `cmd_gate.command` | string | cmd: 之后的命令串（已 trim） |
| `cmd_gate.timeout_seconds` | integer ≥ 1 | 生效超时（节点级 > 项目级 > 60s） |

- **出现条件**：当前前沿是 verify/deploy/smoke 且其 cmd 字段仍 pending（节点态 `pending`）时输出——含三路径：① `status`/`watch` 恒不求值；② `next` 中该 cmd 非 0/超时/未命中；③ `next` 中**因 `budget=1` 已被前序 cmd 耗尽而未求值**、停在该 cmd gate。**仅 cmd gate（overlay modify）时出现，否则整字段省略 → golden 零漂移**。
- **挂载位置（与 `loop_state` §3.9 同构）**：有 `modules[]` → **`modules[].cmd_gate`**（**与 `active_change` 平级**，**不**挂在 `active_change` 下——`next` 的 module item 里 `active_change` 是**字符串**而非对象，见 §3.7）；legacy 无 `modules[]` → 回退**顶层 `cmd_gate`**；`next` base data 同步挂 `next.modules[].cmd_gate`。消费方先读 `modules[].*`、缺则读顶层。
- builtin gate 由 **`cmd_gate` + `proposal_step`（停门前）**共同表达；`current_node` 维持只给 overlay-add。

**(g) `cmd_node_id` 支持 builtin 节点 id（S30）**：§3.8(c) 的 cmd 结果字段（`cmd_node_id`/`cmd_predicate_field`/`cmd_exit_code`/`cmd_timed_out`/`cmd_satisfied`）
按「被求值的 cmd 节点 id」定义，**天然支持 builtin gate id**（`cmd_node_id: "verify"|"deploy"|"smoke"`），`next` 求值 builtin gate cmd 时复用、无需新增字段。

**(h) next 瞬态 `proposal_step` 与 status 有意不一致（S30，落契约）**：cmd gate 下 `next` 据 cmd 求值合成本次 envelope 的 `proposal_step`：
`done_when:cmd` exit 0 → 显示**推进过门**（按部署决策落 `verify-passed` / `ready-to-deploy`）；`fail_when:cmd` exit 0 → 显示 `verify-failed`/`smoke-failed`。
但 **`next` 不写 marker** → **下一次 `status`/`watch` 回到停门前**（如 `ready-to-verify`）。这是**有意的 next/status 不一致**：`next` envelope 门后态 = 「本次响应据 cmd 求值合成」；`status`/`watch` 反映「持久化前沿（停门前）」。消费方**不得**把 `next` 的瞬态 `proposal_step` 当持久状态缓存。

### 3.9 loop_state 派生字段（M2 切片 2）

implement（code/verify）子流程经 overlay `set-loop` 激活 loop 真迭代（`max_iters > 1`）后，机器契约新增 `loop_state`。

**`modules[].loop_state`**（object \| 省略；**仅 loop 激活时输出**）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `loop_state.subflow_id` | string | 激活 loop 的 subflow id（如 `"implement"`）|
| `loop_state.until` | string | 收敛谓词，本切片恒为 `"tests_green"` |
| `loop_state.max_iters` | number | resolved loop 的迭代上限（整数 ≥ 1；> 1 才会出现本对象）|
| `loop_state.iteration` | number | 已完成的 verify 轮次（= `LOOP_ITERS` 按当前 module 过滤后的行数）|
| `loop_state.converged` | boolean | 末轮测试绿（账本末行 `result == "pass"`）|
| `loop_state.escalated` | boolean | `iteration >= max_iters && !converged`（达上限仍未绿）|
| `loop_state.exhausted_skippable` | boolean \| **省略** | 达上限退出 gate 是否可被 `next --auto` 放行 = resolved loop 的 `exhausted_gate.skippable`。**仅当 overlay `set-loop` 显式写了 `exhausted_gate` 时输出**；未写则**省略**，消费方按 `false` 处理 |

- **`exhausted_skippable`（S29）省略规则（保真零漂移）**：**只有** overlay `set-loop` 显式写了 `set.exhausted_gate`（如 `{skippable:true}`）时，
  才把 `exhausted_skippable` 加入 `loop_state`；**未写 `exhausted_gate` → 字段省略**（不输出 `exhausted_skippable:false`）。
  这样**既有 S27 激活-loop（仅 `max_iters>1`、无 `exhausted_gate`）的 `loop_state` JSON 逐字节不变**，不新增字段。
  它只在 `escalated == true` 时影响 `--auto` 放行（见 §11.1），其余态仅为声明。builtin / 未激活 loop → 整个 `loop_state` 省略。
  **零漂移口径**：未写任何 S29 字段（`exhausted_gate` / `coverage_threshold`）的项目——**无论 loop 是否激活**——`status`/`next`/`watch`/`flow show` 输出逐字节不变。

**挂载位置（与 §3.6 overlay 字段同构）**：
- 有 `modules[]` 的项目 → `modules[].loop_state`（按模块）；
- legacy 无 `modules[]` → 回退**顶层** `loop_state`；消费方先读 `modules[].*`、缺则读顶层；
- `openlogos next --format json` 的 base data **同步挂 `next.modules[].loop_state`**（顶层仅 legacy fallback）；
- `openlogos watch` 的 data 与 status 同构，**继承同一挂载与省略规则**（见 §10.5）。

**省略规则（可测，保 golden）**：`loop_state` **仅当** resolved 目标 subflow `loop.max_iters > 1` **且 loop 真正激活**时输出，
否则**省略字段**。据此 builtin（`max_iters:1`）、未用 `set-loop` 的项目、以及 **initial 多模块**（不支持、不激活）→ `loop_state`
一律省略，§3.2/§3.3/`next`/`watch` 输出**逐字节不变**（golden 零漂移）。

**与 `proposal_step` 的关系（JSON 兼容）**：`loop-exhausted` **不是新的 `proposal_step` 枚举值**——§3.3 的 `proposal_step`
集合保持不变（launched loop 未收敛时仍为 `ready-to-verify` / `verify-failed` 等既有值）。"是否达上限"**只由 `loop_state.escalated`
\+ `next --auto` 的 gate 字段表达**（见 §11.1），实现不得为表达本 gate 而新增 `proposal_step`。

**出环判定（消费方须知）**：loop 激活且 `converged == false` 时，implement 视为**未完成**——`current_phase`（initial）/
`proposal_step`（launched）**不得**前进到后续 subflow（deliver/deploy/launch），即便 verify 节点的 `done_when`
（如 initial 的 `file:acceptance-report.md`，FAIL 也会写报告）已满足。

---

## 3.10 change-flow-redesign 契约增量（proposal_step / slice_state / next_node.slice / plan 门）

本节定义 change-flow-redesign 对既有契约的增量；显式修订 §3.3（proposal_step 枚举）、§3.9（loop_state）、§9（flow show）相关字段与 `openlogos next` 的 `next_node`。

### (1) `proposal_step` 枚举新增 `ready-to-delta`（修订 §3.3）

`§3.3` 的 `modules[].active_change.proposal_step` 闭合枚举**新增取值 `"ready-to-delta"`**，置于 `"writing"` 与 `"delta-writing"` 之间。完整集合为：
`"writing"` | `"ready-to-delta"` | `"delta-writing"` | `"ready-to-merge"` | `"merge-generated"` | `"coding"` | `"ready-to-verify"` | `"verify-passed"` | `"verify-failed"` | `"ready-to-deploy"` | `"deploy-done"` | `"ready-to-smoke"` | `"smoke-passed"` | `"smoke-failed"`（`"implementing"` / `"in-progress"` 仍为旧版本兼容值）。

- 语义：`proposal.md` 与 `tasks.md` 均已脱模板、但尚未产出任何 delta 时的驻留态，对应 launched `plan` 出口「批准方案」门。
- `proposal_step_label`（本地化）：`zh` = `"方案待批准"`。
- 说明：本提案为开发态、主动扩展该闭合枚举（破"枚举不新增"不变量），消费方（含 RunLogos）须同步识别新值。

### (2) 新增 `slice_state`（代码切片循环；修订 §3.9 同构挂载）

切片循环激活（`implement` resolved `loop.until == code_slices_green` 且 `max_iters > 1`；builtin launched 默认满足）时，机器契约新增 `slice_state`。挂载与 `loop_state` 同构：有 `modules[]` → `modules[].slice_state`，legacy 无 `modules[]` → 顶层 `slice_state`；`openlogos next` 同步挂 `next.modules[].slice_state`；`watch.data` 继承。`status` / `watch` / `next` 携带，`flow show` 不带。

| 字段 | 类型 | 说明 |
|---|---|---|
| `slice_state.total` | number | `[code]` 切片总数 |
| `slice_state.done` | number | 已勾选切片数（= `section_complete:code` 的已完成计数）|
| `slice_state.current` | string \| 省略 | 当前待实现切片（第一个未勾 `[code]` 行标题）；全部完成时省略 |
| `slice_state.remaining` | number | `total - done` |

**省略规则（保 golden）**：`slice_state` **仅切片循环激活时输出**，否则整字段省略（不物化 `null`）。空 `[code]`（`total==0`）下 `code_slices_green` 退化为 `tests_green`，此时 `slice_state` 仍可输出 `{total:0, done:0, remaining:0}`（无 `current`）供展示，loop 收敛按 `tests_green` 判。**因 builtin launched `implement` 默认激活，launched 模块下 `slice_state` 与 `loop_state` 常驻输出**；initial 多模块不支持、省略。

### (3) `LOOP_ITERS` 账本新增可选 `slice` 字段（修订 §3.9 计数来源）

切片循环激活时，`openlogos verify` 追加的 `LOOP_ITERS` 账本行可带可选 `slice` 字段：
`{ "iter": 5, "node": "verify", "result": "pass", "slice": "切片3：API 编排", "module": "core", "timestamp": "…" }`。
`iteration` / `converged` 计数语义不变（`slice` 仅承载每片尝试历史，非权威完成依据——完成以 `[code]` 勾选为准）。未激活时省略 `slice`，账本逐字节兼容既有。

### (4) `next_node` 在切片循环下带 `slice` 子提示

`openlogos next` 的 `next_node`（见 next base data 节）在切片循环未收敛、未达上限时（`next_node` 按 R7 指向 `code` 工作节点），新增可选子字段 `next_node.slice`（string，= `slice_state.current`），供宿主注入"只做这一片"的上下文。非切片循环 / 收敛 / 达上限时省略。

### (5) plan 门与 deliver 门的 `--auto` 契约（修订 §11 auto gate）

- **`plan-exit`（新）**：`ready-to-delta` 下 `next --auto` 自动放行该可跳门，向活跃提案目录 `GATE_AUTO_PASSED` JSONL **追加一行** `{gate_id:"plan-exit", proposal_step:"ready-to-delta", timestamp}`。**仅审计、不推进状态**；状态在首个 delta 产出后自然前移到 `delta-writing`。
- **`deliver-entry`（改）**：该门 `skippable` 由 `false` 改为 `true`。`ready-to-deploy` 下 `next --auto` 自动放行，输出 `gate_id="deliver-entry"`、`skippable:true`、`gate_auto_passed:true`，并追加 `GATE_AUTO_PASSED` 审计行。
- **授权语义（钉死）**：部署放行依据 = **本次 `next --auto` 响应输出 `gate_auto_passed === true`**（live 决策）；`GATE_AUTO_PASSED` 为 append-only 审计轨迹，**历史审计行不构成对后续部署的授权**，默认 `next`（无 `--auto`）一律忽略之（与 S24 一致）。
- `ready-to-merge`（`spec` 出口）保持 `skippable:true`（语义不变，仅 gate 归属子流程由 `propose` 改为 `spec`）。

---

## 4. `openlogos deploy-done --format json`

### 4.1 用法

```bash
openlogos deploy-done
openlogos deploy-done --env staging
openlogos deploy-done --format json
```

### 4.2 JSON Schema（data 部分）

```jsonc
{
  "slug": "add-feature",
  "environment": "staging",
  "marker_path": "logos/changes/add-feature/DEPLOY_DONE",
  "deployment_report_path": "logos/resources/verify/deployment-report.md",
  "deploy_tasks_checked": 3,
  "deploy_tasks_total": 3,
  "cleared_smoke_markers": ["SMOKE_PASS", "SMOKE_FAIL"],
  "next_step": "ready-to-smoke"
}
```

### 4.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `slug` | string | 是 | 当前活跃提案 slug |
| `environment` | string \| null | 是 | `--env` 指定的部署环境标签；未指定时为 null |
| `marker_path` | string | 是 | 写入的 `DEPLOY_DONE` marker 路径 |
| `deployment_report_path` | string | 是 | 部署报告路径 |
| `deploy_tasks_checked` | number | 是 | `deploy-done` 后 `[deploy]` section 已勾选任务数 |
| `deploy_tasks_total` | number | 是 | `[deploy]` section 任务总数 |
| `cleared_smoke_markers` | string[] | 是 | 本次清理的旧 smoke marker 名称 |
| `next_step` | string | 是 | 下一步状态：`"ready-to-smoke"` 或 `"deploy-done"` |

### 4.4 错误语义

`deploy-done --format json` 的错误仍使用通用错误 envelope，错误码建议包括：

- `PROJECT_NOT_INITIALIZED`
- `NO_ACTIVE_CHANGE`
- `CHANGE_NOT_FOUND`
- `VERIFY_NOT_PASSED`
- `DEPLOYMENT_DECISION_CONFLICT`
- `DEPLOYMENT_NOT_REQUIRED`
- `DEPLOY_TASKS_MISSING`
- `DEPLOYMENT_REPORT_MISSING`

任何错误分支都不得写入 `DEPLOY_DONE`，不得勾选 `[deploy]` 任务，也不得清理 smoke marker。

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
| `FLOW_NOT_FOUND` | 内置 flow 模板缺失 / 无法定位 |
| `FLOW_SCHEMA_INVALID` | flow 或 overlay 校验失败（含 overlay-add 谓词不可求值、launched builtin skip/reorder、`op:modify` 覆盖 `id`、`cmd:` 用于 builtin、同节点双 cmd、`cmd_timeout_seconds` < 1 等）|
| `FLOW_CMD_SPAWN_FAILED` | `cmd:` 命令的 **shell 进程本身无法启动**（child_process `'error'` 事件，如 shell 缺失 / `EACCES`）；message 含节点 id + 命令名 + errno。**命令不存在（shell exit 127/9009）不属此类**，按非 0 走 success envelope |

> `openlogos watch` 的错误仍使用通用错误 envelope（`command: "watch"`）；项目未初始化时输出 `PROJECT_NOT_INITIALIZED` 并以非零退出码退出，不进入轮询循环。`openlogos next --auto` 的错误沿用 `next` 既有错误语义（如 `PROJECT_NOT_INITIALIZED` / `NO_ACTIVE_CHANGE`），不新增错误码。

### 6.2 overlay 派生错误信封

派生（`status` / `next` / `watch` 调 `collectStatusData`）抛 `FlowError` 时，命令以
**`makeErrorEnvelope(command, e.code, e.message)`** 输出到 stderr 并非零退出——**`code` 取 `e.code`、不硬编码**
（`FlowErrorCode` ∈ `PROJECT_NOT_INITIALIZED` / `FLOW_NOT_FOUND` / `FLOW_SCHEMA_INVALID`，见 §6.1）。
本切片新增的语义错误——**launched builtin `skip`/`reorder`**、**overlay-add 节点谓词组合不可求值**——`code` 为 `FLOW_SCHEMA_INVALID`。
`watch` 命中该错误时不进入 / 停止轮询。

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

---

## 9. `openlogos flow show --format json`

查看 OpenLogos 研发流程编排：默认输出内置 raw flow，`--resolved` 输出应用项目 overlay 合并后的生效流程。本命令为只读，不写文件、不接入 status / next 派生。

### 9.1 用法

```bash
openlogos flow show                                  # 内置 raw flow（人类可读）
openlogos flow show --format json                    # 内置 raw flow（JSON）
openlogos flow show --resolved --format json         # overlay 合并后的生效流程（JSON）
openlogos flow show --lifecycle launched --format json
```

### 9.2 JSON Schema（data 部分）

```jsonc
{
  "lifecycle": "initial",          // "initial" | "launched"，本次查看的 flow
  "resolved": false,               // 是否为 overlay 合并后的生效流程（--resolved 时为 true）
  "overlay_applied": false,        // 是否实际应用了项目 logos/flow/<lifecycle>.yaml overlay
  "builtin_version": "v1",         // 内置模板内容版本（对应 extends 的 @vN）
  "warnings": [                    // 解析告警；无告警时为空数组
    {
      "code": "FLOW_VERSION_MISMATCH",
      "message": "overlay 引用 builtin:initial@v1，内置模板当前为 v2，请复核 overlay 是否仍引用有效 node id"
    }
  ],
  "flow": {                        // flow 结构本体（subflows / nodes / gates）
    "flow": "initial",             // flow id（与文件名一致）
    "version": 1,                  // flow 文件 schema 版本（整数）
    "extends": null,               // resolved 时可保留来源；raw 内置为 null
    "subflows": [
      {
        "id": "why",
        "name": "WHY 需求",
        "when": null,              // subflow 级条件，可选
        "loop": null,              // 可选；M1 退化环
        "gate": {
          "type": "human",         // "none" | "human" |（"cmd" 为 M2 预留）
          "position": "exit",      // "entry" | "exit"
          "skippable": true
        },
        "nodes": [
          {
            "id": "prd",
            "name": "需求",
            "skill": "prd-writer",
            "when": "bootstrap != adopted",
            "for_each": null,
            "produces": "logos/resources/prd/1-product-requirements/",
            "done_when": "dir_nonempty",
            "fail_when": null,
            "skipped": false,        // resolved 输出：overlay skip 或 when=false 生效时为 true（节点保留不删除）
            "overlay_op": null       // resolved 输出：触及该节点的 overlay 操作 "skip"|"add"|"modify"|"reorder"|null
          }
          // ... 其余 nodes
        ]
      }
      // ... 其余 subflows
    ]
  }
}
```

### 9.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `lifecycle` | string | 是 | 本次查看的 flow：`"initial"` 或 `"launched"` |
| `resolved` | boolean | 是 | 是否为 overlay 合并后的生效流程；`--resolved` 时为 true |
| `overlay_applied` | boolean | 是 | 是否实际应用了项目 `logos/flow/<lifecycle>.yaml` overlay（无 overlay 文件时为 false，即便 `--resolved`）|
| `builtin_version` | string | 是 | 内置模板内容版本，对应 `extends` 的 `@vN`（如 `"v1"`）|
| `warnings` | array | 是 | 解析告警列表；无告警为 `[]` |
| `warnings[].code` | string | 是 | 告警码，如 `"FLOW_VERSION_MISMATCH"` |
| `warnings[].message` | string | 是 | 告警可读描述 |
| `flow` | object | 是 | flow 结构本体 |
| `flow.flow` | string | 是 | flow id（与文件名一致）|
| `flow.version` | number | 是 | flow 文件 schema 版本（整数）|
| `flow.extends` | string \| null | 否 | overlay 基线引用；raw 内置为 null |
| `flow.subflows` | array | 是 | 有序子流程列表 |
| `flow.subflows[].id` | string | 是 | subflow id |
| `flow.subflows[].name` | string | 是 | subflow 展示名 |
| `flow.subflows[].when` | string \| null | 否 | subflow 级条件 |
| `flow.subflows[].loop` | object \| null | 否 | loop 字段；M1 解析但按退化环处理 |
| `flow.subflows[].gate` | object | 是 | 门禁定义 |
| `flow.subflows[].gate.type` | string | 是 | `"none"` \| `"human"`（`"cmd"` 为 M2 预留）|
| `flow.subflows[].gate.position` | string | 是 | `"entry"` \| `"exit"`（默认 exit）|
| `flow.subflows[].gate.skippable` | boolean | 是 | auto 模式下该 human gate 是否允许自动跳过 |
| `flow.subflows[].nodes` | array | 是 | 有序 node 列表 |
| `flow.subflows[].nodes[].id` | string | 是 | node id，flow 内全局唯一 |
| `flow.subflows[].nodes[].name` | string | 是 | node 展示名 |
| `flow.subflows[].nodes[].skill` | string \| null | 否 | 绑定 skill |
| `flow.subflows[].nodes[].when` | string \| null | 否 | 条件谓词 |
| `flow.subflows[].nodes[].for_each` | string \| null | 否 | fan-out 维度 |
| `flow.subflows[].nodes[].produces` | string \| null | 否 | 产出位置/模板 |
| `flow.subflows[].nodes[].coverage_threshold` | number | 否 | fan-out 聚合阈值（`0 < x <= 1`）；**仅 `done_when: all_present` 的 fan-out 节点可设**。**仅在 overlay 显式设置了有效 number 时才作为键出现；未设置则该键完全省略**（**绝不输出 `null`**）。非法值（越界/非数）**或设在非 `all_present` 节点** → `FLOW_SCHEMA_INVALID`（fail loud） |
| `flow.subflows[].nodes[].done_when` | string \| null | 否 | 完成判定谓词 |
| `flow.subflows[].nodes[].fail_when` | string \| null | 否 | 失败/阻塞判定谓词 |
| `flow.subflows[].nodes[].skipped` | boolean | 否 | **resolved 输出专用**：节点是否被标记 skipped（overlay `skip` 或 `when=false` 生效；节点**保留不删除**）。raw 输出省略或为 false |
| `flow.subflows[].nodes[].overlay_op` | string \| null | 否 | **resolved 输出专用**：触及该节点的 overlay 操作 `"skip"`/`"add"`/`"modify"`/`"reorder"`/null；raw 输出为 null |

- **`coverage_threshold` 省略-非-null（保 flow show 零漂移，关键，S29）**：与 `skill`/`when`/`for_each` 等**恒为 `null`** 的兄弟字段**不同**——`coverage_threshold` **未显式设置时必须整键省略，不得物化为 `coverage_threshold: null`**；若 overlay YAML 写了 `coverage_threshold: null`，派生时**normalize 为 absent**（视同未设置、省略）。这样既有所有节点的 flow show 快照**不新增键** → builtin / 未设阈值项目 `flow show` 逐字节不变。
- **fan-out done 语义（S29）**：`done_when: all_present` 的节点，其 done 判定为 `covered / total >= coverage_threshold`（缺省阈值 = `1.0` → 等价「全部就绪」）；`total == 0` 维持 `all_present` 现状（视为未 done）。覆盖度对象 `{ total, covered, missing }` 不变；status/watch 的 `scenario_coverage` 结构不变，其 `done` 在设置阈值时按阈值判定。builtin 模板不写 `coverage_threshold` → 行为与 `all_present` 1:1 → golden 零漂移。

### 9.4 错误语义

`flow show --format json` 的错误仍使用通用错误 envelope（见「错误处理」一节），错误码建议包括：

- `PROJECT_NOT_INITIALIZED` — 当前目录不是 OpenLogos 项目
- `FLOW_NOT_FOUND` — 包内内置模板或指定 `--lifecycle` 对应的 flow 不存在
- `FLOW_SCHEMA_INVALID` — flow 文件或 overlay 基础 schema 校验失败（未知 op、缺必填字段、target node id 不存在等），message 应指出具体非法位置
- `FLOW_VERSION_MISMATCH` — 仅作为 `warnings[]` 中的**告警码**出现（不阻断解析）；不作为错误 envelope 的 `error.code`

错误分支不输出半成品 `flow`；schema 非法时必须以 `FLOW_SCHEMA_INVALID` 失败，而非静默返回部分合并结果。

---

## 10. `openlogos watch --format json`（实时派生状态流）

`openlogos watch` 是 `status` 的实时版：轮询 `collectStatusData`（与 `status` 同一派生数据源），把一次性快照变成实时流。本命令**只读**，不写文件、不推进状态、不接入 status / next 的写副作用。

### 10.1 用法

```bash
openlogos watch                          # 文本模式
openlogos watch --format json            # JSON 流
openlogos watch --interval 5             # 轮询间隔 5 秒（默认 2 秒）
openlogos watch --module core            # 继承 --module 过滤
openlogos watch --module core --format json
```

### 10.2 流契约（须严格遵守）

- **启动先输出一次初始快照**（`seq=0`，`event="snapshot"`），无需等到下一次变化。
- 之后**仅在派生状态变化时**输出一条（`event="change"`，`seq` 递增）。
- **变化判定** = 相邻两次 `collectStatusData` 的 `data` 深比较（深相等则不输出）。
- 每条输出携带递增 `seq` 与 `timestamp`。
- `data.status` 与 `openlogos status --format json` 的 `data` **同构**（同一派生结构）。
- **继承 `--module`**：派生与变化判定仅针对该模块，等价 `openlogos status --module <id>` 的派生数据。
- **退出**：Ctrl-C / SIGINT 优雅退出，全程无写副作用。
- **错误**：项目未初始化时输出 `PROJECT_NOT_INITIALIZED` 错误 envelope（到 stderr）并以非零退出码退出，不进入轮询循环。

### 10.3 JSON Schema（每条 envelope 的 data 部分）

```jsonc
{
  "seq": 0,                         // 事件序号，从 0（初始快照）起递增
  "event": "snapshot",             // "snapshot"（初始快照）| "change"（变化事件）
  "module": "core",                // 继承的 --module 过滤；未指定时为 null
  "status": { /* 与 openlogos status 的 data 同构 */ }
}
```

### 10.4 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `seq` | number | 是 | 事件序号；初始快照为 0，之后每条变化事件递增 |
| `event` | string | 是 | `"snapshot"`（启动初始快照）或 `"change"`（后续仅变化时输出） |
| `module` | string \| null | 是 | 继承的 `--module` 过滤值；未指定时为 null |
| `status` | object | 是 | 派生状态，结构与 `openlogos status --format json` 的 `data` 一致 |

> 注：顶层 envelope 的 `timestamp` 即该条事件的产生时间；每条 envelope 独立成行（行分隔的 JSON 流）。

### 10.5 watch 的 overlay 派生字段（继承 status data）

`openlogos watch` 的每条 envelope `data` **结构同构于 `status` data**（见 §10.3）。因此 §3.6 / §3.7 的
`overlay_nodes` / `current_node` 字段、§3.9 的 `loop_state` 字段及其省略规则**对 watch 同样适用**——
存在已到达 overlay-added 节点 / loop 激活时随流输出，无 overlay / 未激活时省略（流内容与未引入相应切片时一致）。
watch 为**观察派生**：遇 loop 只读账本展示 `loop_state`、**不执行测试、不写账本**。

---

## `openlogos next --format json`（base data）

`openlogos next --format json` 的 base `data` 新增 `modules[].current_node`（结构同 §3.6），
**仅当当前节点为 overlay-added 时输出**，否则省略；legacy 无 `modules[]` 时回退顶层 `current_node`。
默认（无 overlay）`next` **不新增 `current_node`**（此处仅就 `current_node` 而言）；**`next_node`（S28）另按下文规则输出**——即默认 builtin 当前节点也会带 `next_node`。`--auto` 的 gate 字段见下节 §11。

### next_node 编排提示字段（S28）

`openlogos next` 的 `data` 新增 **`next_node`** 对象——把「下一步该处理的真实 flow node 用哪个 skill/agent、要不要跑脚本」
以机器字段透出给宿主编排。**仅 `next` 暴露**（`status`/`watch` 不输出）；仍 **A 被动派生**：字段是不透明标签，OpenLogos 不解释、
不映射 agent、不执行 script，是否执行/以何权限执行由宿主决定。

**总定义**：`next_node` = 取自 **resolved flow（含 overlay）** 的「**本次 `next` 响应最终建议处理的真实 flow node**」的 hints。
**默认 = 当前前沿节点**；R3（cmd 续推）/ R4（auto 放行）/ R7（loop 阻塞）/ R5（命令级建议）是对默认的例外（见下）。

**字段与类型**（对象本身可省略；一旦出现，下列字段固定存在）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `next_node.id` | string | 节点 id（取自 resolved flow）|
| `next_node.name` | string | 节点展示名 |
| `next_node.subflow_id` | string | 所属 subflow id |
| `next_node.skill` | string \| null | 绑定的 skill；无绑定为 `null`（如 verify/deploy/smoke 由 CLI 驱动、`skill` 为 `null`）|
| `next_node.working_agent` | string \| null | working agent 标签；无绑定为 `null` |
| `next_node.review_agent` | string \| null | review agent 标签；无绑定为 `null` |
| `next_node.pre_script` | string \| null | 前置脚本；无为 `null` |
| `next_node.post_script` | string \| null | 后置脚本；无为 `null` |

- **`skill`/`working_agent`/`review_agent`/`pre_script`/`post_script` 这 5 个 hint 字段固定存在、用 `null` 表示无绑定**；
  消费方**不得**把 `skill` 当作必有 `string`。
- 取自 **resolved flow** → overlay `modify code set:{review_agent: my-reviewer}` 会如实反映为 `next_node.review_agent = "my-reviewer"`。

**挂载位置（与 `current_node`/`loop_state` 同构）**：有 `modules[]` → `modules[].next_node`；legacy 无 `modules[]` → 顶层 `next_node`。

**前沿节点解析（默认，无例外时）**：overlay `current_node` 存在 → 取该节点；否则 launched 用 `STEP_TO_CURRENT_BUILTIN[proposal_step]`、
initial 用 `current_phase → PHASE_KEY_TO_NODE_ID`（显式正向 map，**不**反查 `NODE_TO_PHASE_KEY`）定位 builtin 节点 id，再从 resolved flow 取 hints。

**例外**：
- **【R3】cmd 瞬态求值（overlay-add 节点 + builtin verify/deploy/smoke cmd gate，S30）**：`next_node` 取**本次响应 cmd 求值（cmdEval 回灌）后**的最终节点——`done_when:cmd` `exit 0` 续推 → 指向**续推后**节点（**不**指向已 done 的 cmd 节点/gate）；`fail_when:cmd` `exit 0` → 该节点/gate `failed` → 指向**该 cmd 节点/gate**；cmd 非 0/超时 → 指向**该 cmd 节点/gate**（求值后 `active`/停门前）；budget=1 遇第二个 cmd → 指向**第二个 pending cmd** 节点/gate。builtin gate id 取 `cmd_gate.node_id`。
- **【R4】`--auto` 放行**：`gate_auto_passed === true` 时**省略 `next_node`**（放行后宿主走 gate 的 command，下一节点待重新 `next` 派生）。
- **【R7】loop 阻塞**：未达上限 → `next_node` = loop subflow 的**工作节点**（overlay `current_node` 优先；否则 resolved flow 中 `id == "code"` 且未 `skipped` 的节点，**非 `verify`**，对齐 action「修代码」）；`code` 缺失/被 overlay `skip` → **省略**（仅 initial 等**合法 resolved flow**——launched 对 builtin `code` 的 `skip`/`reorder` 在派生入口已 `FLOW_SCHEMA_INVALID`、走不到此省略）；达上限（`escalated`）→ **省略**（宿主读 `loop_state.escalated`）。与 `loop_state` 互补：环状态看 `loop_state`，这一轮派哪个节点的 skill/agent 看 `next_node`。
- **【R5】命令级建议**：当前建议不指向某 flow node（`all_done` / launched 无 active proposal → `openlogos change <slug>` / 补 baseline → `openlogos change add-baseline-docs` / `openlogos launch` 等）→ **省略 `next_node`**。

**golden**：`next_node` 对有当前节点的项目新增 → `next --format json` 快照更新（本切片有意为 next 加字段、重新 baseline）；`status`/`watch`/`flow show` 输出不变。

---

## 11. `openlogos next --auto` 的 gate 字段

`openlogos next --auto`（skip-gate）在既有 `next` data 基础上附带 gate 决策字段，描述当前停顿点对应的 launched flow gate 及 auto 放行结果。**默认 `next`（无 `--auto`）不输出这些 gate/auto 字段；此处「`data` 1:1 不变」仅就 auto/gate 字段而言——默认 `next` 仍按 base data 契约输出，含 S28 的 `next_node`。**

```jsonc
{
  // ... 既有 next data 字段 ...
  "auto": true,                    // 是否启用 auto 模式（--auto）
  "gate_id": "deliver-entry",      // 当前停顿点对应的 launched gate id；无对应 gate 时为 null
  "skippable": true,               // 该 human gate 是否允许 auto 跳过
  "gate_auto_passed": true         // 本次 --auto 是否实际放行并追加了 GATE_AUTO_PASSED 审计行
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `auto` | boolean | 否 | 是否启用 `--auto`；默认 `next` 省略或为 false |
| `gate_id` | string \| null | 否 | 当前停顿点对应的 launched gate id；`ready-to-delta`→`plan-exit`、`ready-to-merge`→`spec-exit`、`ready-to-deploy`→`deliver-entry`；无对应 gate（如 `ready-to-smoke`）时为 null |
| `skippable` | boolean \| null | 否 | 该 human gate 是否允许 auto 跳过：`ready-to-delta` / `ready-to-merge` / `ready-to-deploy`→true；达上限 `loop-exhausted`→默认 false |
| `gate_auto_passed` | boolean | 否 | 本次 `--auto` 是否实际放行并向 `GATE_AUTO_PASSED` 追加审计行（`skippable:false` 或无 gate 时为 false）；放行依据为本次响应而非历史审计行 |

**`gate_id` 派生规则（契约闭合）**：`spec/flow/launched.yaml` 的 gate 挂在 subflow 上、无显式 id 字段，
故 `gate_id` 为**派生值** = `<subflow.id>-<gate.position>`（`gate.position` 缺省为 `exit`）。
据此：plan subflow 出口 gate → **`plan-exit`**；spec subflow 出口 gate → **`spec-exit`**；deliver subflow 的入口 gate → **`deliver-entry`**。
实现侧 gate 助手须按此规则生成 `gate_id`。

**范围边界**：`--auto` 作用于 launched 的 plan 出口（`ready-to-delta`，可跳）、spec 出口（`ready-to-merge`，可跳）与 deliver 入口（`ready-to-deploy`，可跳）三门。`gate:implement:loop-exhausted` 默认不可跳（见 §11.1）。`smoke` 无对应 gate，`ready-to-smoke` 不在范围内。initial 的 WHY/WHAT 建议门本轮不接入 `--auto`（仅 schema 预留）。

### 11.1 loop-exhausted gate（M2 切片 2 / S29 可放行）

当 implement loop 激活且 `loop_state.escalated == true`（达 `max_iters` 仍未收敛）时，`next` 派生为 implement 子流程的
**退出 human gate**。其 `--auto` 行为由 resolved loop 的 `exhausted_gate.skippable` 决定（机器字段 `loop_state.exhausted_skippable`，
**未写 `exhausted_gate` 时该字段省略、按 `false` 处理**）。

**默认（`exhausted_skippable` 省略或 `false`，S27 行为不变）** —— `--auto` 下 gate 字段（§11）取值：

| 字段 | 值 | 说明 |
|------|----|------|
| `gate_id` | `"gate:implement:loop-exhausted"` | loop 退出 gate 的确定性 id（`gate:<subflow>:loop-exhausted`）|
| `skippable` | `false` | 默认不可跳（未声明 `exhausted_gate.skippable`）|
| `gate_auto_passed` | `false` | 达上限 gate 即使 `--auto` 也**不放行、不追加 `GATE_AUTO_PASSED`** |

- 行为：达上限 gate 默认 `skippable:false` → `--auto` **照常阻塞**（不放行未收敛代码）。

**opt-in 放行（`exhausted_skippable == true`，S29 高危）** —— overlay `set-loop` 写了 `set.exhausted_gate.skippable: true` 时，
`--auto` 下：

| 字段 | 值 | 说明 |
|------|----|------|
| `gate_id` | `"gate:implement:loop-exhausted"` | 同上 |
| `skippable` | `true` | 用户显式声明达上限可跳 |
| `gate_auto_passed` | `true` | **本次 `--auto` 实际放行未收敛代码**，并向 `GATE_AUTO_PASSED` 追加审计行 |

- 放行语义同既有 skippable gate 的 `--auto`：写 `GATE_AUTO_PASSED`（§12 schema，`gate_id:"gate:implement:loop-exhausted"`）、action 转 proceed，
  implement 放行进入后续 subflow（**无人值守放行未通过测试的代码**——这是用户在 overlay 显式开启的高危行为，OpenLogos 据 overlay 被动派生）。
- **R2 安全优先**：以上放行的**前提是当前未卡在未完成的 overlay-added 节点**（`current_node` 为 active/failed）。若仍卡在未完成 overlay 节点，gate 尚未到达 →
  **不放行**：`gate_auto_passed:false`、`gate_id:null`、`skippable:null`、不写 `GATE_AUTO_PASSED`（即便 `escalated` + `exhausted_skippable:true`）。
- 默认 `next`（无 `--auto`）始终忽略 `GATE_AUTO_PASSED`、绝不因其越过 gate（§12 不变）。

- "继续迭代" = 人类用 overlay `set-loop` 调大 `max_iters`（`escalated` 自动解除）或修到收敛出环；**gate 不重置计数**。
- `proposal_step` 不因本 gate 改变（仍为既有枚举值）；达上限信息只在 `loop_state.escalated` / `exhausted_skippable` + 本节 gate 字段表达。

---

## 12. `GATE_AUTO_PASSED` JSONL 审计 schema

`GATE_AUTO_PASSED` 是活跃提案目录下的 **JSONL 审计日志**：`logos/changes/<slug>/GATE_AUTO_PASSED`。

- **每次 `--auto` 放行总是追加一行**（**不去重、不覆盖**），保留完整审计轨迹。
- **纯审计、不改变派生**：默认 `next`（无 `--auto`）与 `status` **忽略**该文件、绝不因其存在而让默认 `next` 自动越过 gate；此处「不改变」仅指**不因 `GATE_AUTO_PASSED` 越过 gate**——`next` 的 base data 仍按当前契约输出（S28 起可能含 `next_node`）。

每行 schema：

```jsonc
{ "gate_id": "propose-exit", "proposal_step": "ready-to-merge", "timestamp": "2026-06-20T08:01:12Z" }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `gate_id` | string | 是 | 被自动放行的 launched gate id |
| `proposal_step` | string | 是 | 放行时活跃提案所处的 `proposal_step`（如 `"ready-to-merge"`） |
| `timestamp` | string | 是 | 放行时间（ISO-8601） |

> **幂等说明**：重复 `--auto` 会追加多行；"幂等"仅指对默认 `next`/`status` 的**派生结论无影响、可安全重跑**，**并非**审计日志去重。

---

## 13. `LOOP_ITERS` JSONL 账本 schema

`LOOP_ITERS` 是 loop 真迭代的**迭代账本**（append-only JSONL），由 `openlogos verify` 在 **loop 激活时**追加。

- **路径**：launched = `logos/changes/<slug>/LOOP_ITERS`（提案级 episode）；initial = `logos/resources/verify/LOOP_ITERS`（项目级）。
- **写入责任与时机**：由 **CLI 主进程**在**算出 gate 结果（PASS/FAIL）之后、不依赖 guard 的共享路径**追加（**非 pre-run 命令写**，免 sandbox 白名单）；
  `result` 取**沙箱降级后的最终** gate 结果。**配置类早退**（`NO_TEST_RESULTS` / `NO_TEST_CASES` / `PROJECT_NOT_INITIALIZED`）
  **不计为一次迭代、不写**。未激活（builtin `max_iters:1`）时不写（零副作用）。
- **launched 额外写 `VERIFY_PASS`/`VERIFY_FAIL` marker + 写账本；initial 不进 guard 块、只写 `LOOP_ITERS`**。

每行 schema：

```jsonc
{ "iter": 2, "node": "verify", "result": "fail", "module": "core", "timestamp": "2026-06-20T20:31:07Z" }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `iter` | number | 是 | 本轮序号 = **同 `module` 已有行数 + 1**（按 module 过滤计数，**非整文件总行数**），与读取侧 `loop_state.iteration` 对齐 |
| `node` | string | 是 | 求值节点，本切片恒为 `"verify"` |
| `result` | string | 是 | `"pass"`（测试绿）\| `"fail"`（未绿/沙箱降级 FAIL）|
| `module` | string | 是 | 该轮归属模块；读取侧按 `module` 过滤（避免 initial 项目级账本多模块串号）|
| `timestamp` | string | 是 | ISO-8601 |

- **module 来源**：launched = `guard.module`；initial 单模块 = 该唯一模块；**initial 多模块** = verify 为项目级单次运行、无法归属 →
  **不写账本、loop 视为未激活**（本切片已知不支持）。launch 后 initial 账本仅历史产物，launched 派生只读提案目录账本。
- **状态回退**：verify 再次 FAIL 沿用现有行为清除 `VERIFY_PASS` 及下游 `DEPLOY_DONE`/`SMOKE_*` → implement loop 重新打开；账本续写、`converged` 反映最后一次。
