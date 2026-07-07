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
    "version": "0.12.9",
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
| `modules[].active_change.code_required` | 「本提案是否需要代码」的单一事实源（见下） |
| `current_phase` | 第一个未完成的阶段 key（全部完成则为 `null`） |
| `lifecycle` | 由模块状态推导出的项目生命周期 |
| `yaml_diagnostics` | YAML 存在问题时的解析恢复状态 |

### 提案步骤

`proposal_step` 字段追踪变更提案生命周期：

| 步骤 | 含义 |
|------|---------|
| `writing` | 提案/任务仍有模板占位符 |
| `ready-to-delta` | 提案 + 任务已填、尚无 delta、`PLAN_APPROVED` 不在场——`plan-exit`「批准方案」门 |
| `delta-writing` | 提案已填写；delta 任务未全部勾选 |
| `ready-to-merge` | 所有 delta 任务已勾选（`spec-exit` 门） |
| `merge-generated` | `openlogos merge` 已运行 |
| `spec-complete-required` | 代码提案缺少 spec-complete marker；需先执行 no-delta `openlogos merge <slug>` 或完成 merge，再规划切片 |
| `test-id-required` | spec-complete 已完成，但缺真实 `UT-*` / `ST-*` / `SMOKE-*` ID，不能规划切片 |
| `ready-to-implement` | 规格已合并、`code_required`、`[code]` 切片尚未由 slice-planner 写定——`slice-exit`「切片待批准」门 |
| `coding` | 切片已批准；代码任务未全部勾选 |
| `ready-to-verify` | 所有代码任务已勾选 |
| `verify-passed` | `openlogos verify` 通过 |
| `verify-failed` | `openlogos verify` 失败 |
| `ready-to-deploy` | 验证通过，待部署（`deliver-entry` 门） |
| `deploy-done` | 已执行部署 |
| `ready-to-smoke` | 部署完成，待 smoke |
| `smoke-passed` | `openlogos smoke` 通过 |
| `smoke-failed` | `openlogos smoke` 失败 |

`ready-to-delta` 与 `ready-to-implement` 分别由变更流程重构和切片规划剥离新增；消费方（含 RunLogos）须同步识别。`implementing` / `in-progress` 仍为旧版本兼容值。

`spec-complete-required` 与 `test-id-required` 是代码提案进入 `plan-slices` 前的阻断诊断，不是 human gate，`--auto` 不得跳过。两种状态下 `next_node.id` 都不得为 `plan-slices`；JSON 会带 `reason`（`no_delta_spec_marker_missing` 或 `code_change_requires_real_test_ids`），供 driver 把工作派回 merge/spec-complete 或测试 ID 补齐，而不是误派 `slice-planner`。

### code_required

`modules[].active_change.code_required`（boolean）是「提案是否需要代码实现」的**单一事实源**，等于内部谓词 `isCodeRequiredForProposal`——`true` 表示提案含 `## [code]` 产出需求（有 `[code]` 段 / `[delta]` 新增 `UT-*`/`ST-*`/`SMOKE-*` / proposal 声明代码级），`false` 表示纯文档 / 纯规格提案。消费方应直接读本字段，替代自行用关键词正则重判。

- **仅在 `active_change` 非 null 时出现**；无活跃提案时整个对象（含本字段）不出现，故无活跃提案的项目不新增字段（golden 零漂移）。
- 一致性约束：`code_required==false` ⟹ `next_node.id` 绝不为 `code`/`plan-slices`，`slice` 子流程（`when: code_required`）整段跳过。`code_required==true` 且 `[code]` 未脱模板 ⟹ `proposal_step=="ready-to-implement"`、`next_node.id=="plan-slices"`。
- 对 no-delta 代码提案，`code_required==true` 仍要求先存在 `SPEC_MERGED`/`MERGED`。缺 spec-complete marker 返回 `spec-complete-required`；spec-complete 后缺真实测试 ID 返回 `test-id-required`。

### 编排机器字段

以下字段驱动外部编排器。它们遵循相同的**挂载 + 省略**规则：有 `modules[]` 时挂在 `modules[].*`，legacy 项目回退到顶层；消费方先读 `modules[].*`、缺则读顶层。未激活时**整字段省略**，保 golden 零漂移。

**`loop_state`**——仅 implement loop 激活时输出（`max_iters > 1`；builtin launched 默认满足）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `subflow_id` | string | 激活 loop 的 subflow id（如 `implement`） |
| `until` | string | 收敛谓词（`tests_green` \| `code_slices_green`） |
| `max_iters` | number | resolved 迭代上限 |
| `iteration` | number | 已完成的 verify 轮次（当前 module 的 `LOOP_ITERS` 行数） |
| `converged` | boolean | 末轮测试绿 |
| `escalated` | boolean | `iteration >= max_iters && !converged`（达上限仍未绿） |
| `exhausted_skippable` | boolean \| 省略 | loop-exhausted 门是否可被 `--auto` 放行；仅当 overlay `set-loop` 写了 `exhausted_gate` 时输出 |

**`slice_state`**——仅切片循环激活时输出（`until == code_slices_green` 且 `max_iters > 1`；launched 下常驻）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `total` | number | `[code]` 切片总数 |
| `done` | number | 已勾选切片数（`section_complete:code` 计数） |
| `current` | string \| 省略 | 第一个未勾 `[code]` 行标题；全部完成时省略 |
| `remaining` | number | `total - done` |

**`plan_state`**——launched 诊断对象，避免消费方把 `tasks.md` checkbox 进度误判为规划失败：

| 字段 | 类型 | 说明 |
|------|------|------|
| `plan_ready` | boolean | proposal/tasks 已脱模板、无 plan 层阻断 |
| `plan_gate_pending` | boolean | 停在 `plan-exit`：`ready-to-delta` 且 `PLAN_APPROVED` 不在场 |
| `plan_approved` | boolean | `PLAN_APPROVED` 在场，或已离开 `ready-to-delta` |
| `tasks_template_filled` | boolean | `tasks.md` 已脱模板且含有效 section 结构 |
| `tasks_execution_done` / `tasks_execution_total` | number | 当前 section checkbox 进度——**不得**用于反推 plan 是否 ready |
| `tasks_execution_scope` | string | `delta` \| `deploy` \| `code` \| `none` |
| `diagnostic` | string | 面向人/driver 的等待或阻断态短诊断 |

**`next_node`**（仅 `openlogos next`）——本轮该处理节点的编排提示，携带 resolved flow 的 `skill` / `working_agent` / `review_agent` / `pre_script` / `post_script`。默认 = 当前前沿节点，例外：

- 切片循环内（未收敛、未达上限）指向 `code` 工作节点，并带 `next_node.slice`（= `slice_state.current`，「只做这一片」）。
- 在 slice/plan 门处，`id` 之外附加 **`next_node.gate_id`**——如 `ready-to-implement` 且 `plan-slices` 已完成时输出 `id: "plan-slices"` + `gate_id: "slice-exit"`，提示宿主**不要**重派 skill，改按人类门处理。gate_id 映射：`ready-to-delta → plan-exit`、`ready-to-merge → spec-exit`、`ready-to-implement → slice-exit`、`ready-to-deploy → deliver-entry`。
- 命令级建议（`all_done`、`openlogos change <slug>`、`openlogos launch`）及 gate 被自动放行后省略。

**`GATE_AUTO_PASSED`**——活跃提案目录下的 **append-only 审计账本**（JSONL）。`next --auto` 每次自动放行 `skippable:true` 门时追加 `{gate_id, proposal_step, timestamp}`。它是**审计、非状态源**——历史行绝不授权后续部署或 gate；默认 `next`（无 `--auto`）一律忽略之。状态推进只认真实 marker（plan 认 `PLAN_APPROVED`、slice 认 `SLICES_APPROVED`）或实际 delta/切片产出。部署放行依据本次 `next --auto` 响应的 **live** `gate_auto_passed === true`。

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
