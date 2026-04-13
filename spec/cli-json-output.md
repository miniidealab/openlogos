# CLI JSON 结构化输出规格

> 版本: 1.0.0 | 创建日期: 2026-04-13

## 1. 概述

OpenLogos CLI 的 `status`、`verify`、`detect` 三个命令支持 `--format json` 参数，输出结构化 JSON 供外部工具（如 RunLogos）以编程方式消费。

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
  "command": "<command-name>",   // "status" | "verify" | "detect"
  "version": "<cli-version>",   // CLI 版本号，如 "0.5.9"
  "timestamp": "<ISO-8601>",    // 输出时间戳
  "data": { ... }               // 命令特定的数据负载
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
    "lifecycle": "active",        // "initial" | "active"
    "description": "项目描述"      // 项目描述
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
| `project.lifecycle` | string | 是 | 项目生命周期阶段 |
| `project.description` | string | 是 | 项目描述 |

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
      "files": ["01-requirements.md"]
    },
    {
      "key": "phase.2",
      "label": "Phase 2 · 产品设计 (WHAT)",
      "done": false,
      "files": []
    }
    // ... 所有 9 个 phase
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
  "lifecycle": "active"            // 项目生命周期
}
```

### 3.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `phases` | array | 是 | 所有阶段的状态列表（固定 9 个元素） |
| `phases[].key` | string | 是 | 阶段标识符（如 `phase.1`, `phase.3-2-api`） |
| `phases[].label` | string | 是 | 阶段的本地化标签 |
| `phases[].done` | boolean | 是 | 该阶段是否已完成（有文件 = true） |
| `phases[].files` | string[] | 是 | 该阶段目录下的文件列表 |
| `active_proposals` | array | 是 | 活跃变更提案列表 |
| `active_proposals[].name` | string | 是 | 提案目录名 |
| `active_proposals[].has_proposal` | boolean | 是 | 是否存在 proposal.md |
| `active_proposals[].has_tasks` | boolean | 是 | 是否存在 tasks.md |
| `active_proposals[].delta_count` | number | 是 | deltas 目录下的文件数 |
| `current_phase` | string \| null | 是 | 当前应推进的阶段 key；全部完成时为 null |
| `suggestion` | string | 是 | 建议的下一步操作（本地化文本） |
| `all_done` | boolean | 是 | 是否全部阶段已完成 |
| `lifecycle` | string | 是 | 项目生命周期（`initial` 或 `active`） |

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
    "defined_count": 10,          // 定义的测试用例总数
    "ut_count": 6,                // 单元测试用例数
    "st_count": 4,                // 场景测试用例数
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
| `report_path` | string | 是 | 生成的验收报告路径 |

### 4.4 gate.reason 取值

| 值 | 说明 |
|----|------|
| `null` | 门禁通过 |
| `"failed_cases"` | 存在失败的测试用例 |
| `"incomplete_coverage"` | 存在未覆盖的测试用例 |
| `"checklist_incomplete"` | 设计时覆盖度校验未完全确认 |
| `"ac_trace_incomplete"` | 验收条件追溯未完全通过 |

---

## 5. 错误处理

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

### 5.1 错误码

| 错误码 | 说明 |
|--------|------|
| `PROJECT_NOT_INITIALIZED` | 当前目录不是 OpenLogos 项目 |
| `NO_TEST_RESULTS` | 找不到测试结果文件 |
| `NO_TEST_CASES` | 找不到测试用例规格文件 |

---

## 6. 完整用法示例

```bash
# 获取项目状态（机器可读）
openlogos status --format json | jq '.data.current_phase'

# 获取 CLI 版本和项目探测信息
openlogos detect --format json | jq '.data.cli.version'

# 获取测试验收摘要
openlogos verify --format json | jq '.data.gate.result'

# 在脚本中检查门禁结果
if openlogos verify --format json 2>/dev/null | jq -e '.data.gate.result == "PASS"' > /dev/null; then
  echo "All tests passed!"
fi
```
