---
title: CLI JSON 输出
description: OpenLogos CLI 命令的结构化 JSON 输出规格（status、next、verify、smoke、detect、module list）。
---

OpenLogos CLI 在五个命令族——`status`、`next`、`verify`、`smoke`、`detect` 和 `module list`——上支持 `--format json`，产出结构化 JSON，供 RunLogos 等外部工具以编程方式消费。

## 通用约定

- **触发**：在任何受支持的命令后追加 `--format json`
- **输出目标**：JSON 输出到 **stdout**；错误输出到 **stderr**
- **格式**：紧凑的单行 JSON（无缩进），适合管道
- **退出码**：与人类可读模式相同
- **编码**：UTF-8
- **字段命名**：`snake_case`

## 信封结构

所有命令共享一个通用信封：

```json
{
  "command": "<command-name>",
  "version": "<cli-version>",
  "timestamp": "<ISO-8601>",
  "data": { ... }
}
```

其中 `command` 是以下之一：`"status"`、`"next"`、`"verify"`、`"smoke"`、`"detect"`、`"module list"`。

## detect

```bash
openlogos detect --format json
```

返回 CLI 版本、Node.js 版本和项目检测信息：

```json
{
  "cli": {
    "version": "0.10.3",
    "node_version": "v22.0.0"
  },
  "project": {
    "name": "my-project",
    "locale": "zh",
    "lifecycle": "launched",
    "modules": [
      { "id": "core", "name": "核心功能", "lifecycle": "launched" }
    ],
    "description": "项目描述",
    "source_roots": { "src": ["src"], "test": ["test"] }
  },
  "yaml_diagnostics": null
}
```

在 OpenLogos 项目之外运行时，`project` 为 `null`。

## status

```bash
openlogos status --format json
```

返回阶段进度、模块状态、活跃提案和建议：

| 关键字段 | 描述 |
|-----------|-------------|
| `phases[]` | 全部 13 个阶段，含 `key`、`label`、`done`、`skipped`、`files` |
| `modules[]` | 每模块的生命周期、当前阶段、阶段进度、活跃变更、建议 |
| `modules[].active_change` | 提案步骤、任务进度、部署决策、冲突检测 |
| `current_phase` | 第一个未完成的阶段 key（全部完成则为 `null`） |
| `lifecycle` | 由模块状态推导出的项目生命周期 |
| `yaml_diagnostics` | YAML 存在问题时的解析恢复状态 |

### 提案步骤

`proposal_step` 字段追踪变更提案生命周期：

| 步骤 | 含义 |
|------|---------|
| `writing` | 提案/任务仍有模板占位符 |
| `delta-writing` | 提案已填写；delta 任务未全部勾选 |
| `ready-to-merge` | 所有 delta 任务已勾选 |
| `merge-generated` | `openlogos merge` 已运行 |
| `coding` | 规格已合并；代码任务未全部勾选 |
| `ready-to-verify` | 所有代码任务已勾选 |
| `verify-passed` | `openlogos verify` 通过 |
| `verify-failed` | `openlogos verify` 失败 |
| `ready-to-deploy` | 验证通过，待部署 |
| `deploy-done` | 已执行部署 |
| `ready-to-smoke` | 部署完成，待 smoke |
| `smoke-passed` | `openlogos smoke` 通过 |
| `smoke-failed` | `openlogos smoke` 失败 |

## verify

```bash
openlogos verify --format json
```

返回带三层校验的测试验证结果：

| 关键字段 | 描述 |
|-----------|-------------|
| `summary` | 定义/执行/通过/失败/跳过/未覆盖的计数与百分比 |
| `gate` | `result`（"PASS"/"FAIL"）和 `reason` |
| `failed_cases[]` | 每个失败的 ID 和错误 |
| `checklist` | 设计期覆盖校验状态 |
| `ac_trace` | 验收标准追溯状态 |
| `pre_run` | 预运行执行模式、命令、结果路径、诊断 |
| `sandbox` | 沙箱隔离模式、状态、诊断 |

### 预运行模式

| 模式 | 描述 |
|------|-------------|
| `none` | 未配置预运行命令 |
| `pre_run_command` | 执行单个 `verify.pre_run_command` |
| `two_phase` | `regression_command` + `incremental_command`，按最后写入优先合并 |

### 关卡失败原因

| 原因 | 描述 |
|--------|-------------|
| `failed_cases` | 一个或多个测试用例失败 |
| `incomplete_coverage` | 部分已定义用例无结果 |
| `checklist_incomplete` | 设计期覆盖清单未完全勾选 |
| `ac_trace_incomplete` | 验收标准追溯未完全通过 |

## smoke

```bash
openlogos smoke --format json
openlogos smoke --env staging --format json
```

返回部署后 smoke 验证结果：

| 关键字段 | 描述 |
|-----------|-------------|
| `environment` | 目标环境（来自 `--env` 标志，或 `null`） |
| `summary` | 与 verify summary 结构相同 |
| `gate` | Gate 3.8 结果和原因 |
| `sandbox` | 沙箱执行状态 |
| `report_path` | 生成的 smoke 报告路径 |
| `result_path` | smoke 结果 JSONL 路径 |

## module list

```bash
openlogos module list --format json
```

返回模块注册表：

```json
{
  "modules": [
    { "id": "core", "name": "核心功能", "lifecycle": "launched" },
    { "id": "payment", "name": "支付模块", "lifecycle": "initial" }
  ]
}
```

## 错误信封

当命令失败时，JSON 模式向 **stderr** 输出错误信封：

```json
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

| 错误码 | 描述 |
|------------|-------------|
| `PROJECT_NOT_INITIALIZED` | 不在 OpenLogos 项目中 |
| `NO_TEST_RESULTS` | 未找到测试结果 JSONL 文件 |
| `NO_TEST_CASES` | 未找到测试用例规格文件 |
| `NO_SMOKE_RESULTS` | 未找到 smoke 结果 JSONL 文件 |
| `NO_SMOKE_CASES` | 未找到 smoke 用例规格文件 |

## 使用示例

```bash
# Check gate result in scripts
openlogos verify --format json | jq '.data.gate.result'

# Get current phase
openlogos status --format json | jq '.data.current_phase'

# List module lifecycles
openlogos module list --format json | jq '.data.modules[] | {id, lifecycle}'

# Conditional check
if openlogos verify --format json 2>/dev/null | jq -e '.data.gate.result == "PASS"' > /dev/null; then
  echo "All tests passed!"
fi
```
