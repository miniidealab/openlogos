---
title: CLI JSON 输出
description: OpenLogos CLI 命令的结构化 JSON 输出规格（status、next、verify、smoke、merge、slice plan、detect、module list），含契约版本握手。
---

OpenLogos CLI 在面向机器的命令上支持 `--format json`——包括 `status`、`next`、`watch`、`verify`、`smoke`、`deploy-done`、`merge`、`slice plan`、`detect`、`flow show`、`change-lint` 与 `module list`——产出结构化 JSON，供 RunLogos 等外部工具以编程方式消费。

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

`command` 为命令名，如 `"status"`、`"next"`、`"verify"`、`"smoke"`、`"merge"`、`"slice plan"`、`"detect"`、`"module list"`。顶层 `version` 是 **CLI 版本**，不是契约版本（见下文）。

## 契约版本（`data.contract.version`）

`status`、`next`、`verify` 在 `data` 中携带机器契约版本：

```json
{ "command": "verify", "version": "0.16.0", "timestamp": "…", "data": { "contract": { "version": "1.1.0" }, … } }
```

- `data.contract.version` 遵循 SemVer，独立于 CLI 版本演进。**major**：删除必填字段或改变其含义、闭合枚举移除取值；**minor**：新增可选字段或枚举取值；**patch**：不改形态的澄清。
- 当前发射的取值：`status` / `next` 为 `1.0.0`、`1.1.0`（含 feature 分组或切片验收字段）或 `1.3.0`（含 plan-package 字段）；`verify` 为 `1.0.0`，含切片感知字段时为 `1.1.0`。
- npm 包在 `spec/schema/` 下随包发布对应的 JSON Schema：`status.schema.json`、`next.schema.json`、`verify.schema.json`。每份 schema 内嵌版本号（`x-contract-version`），校验对象是 `envelope.data`。这些 schema 是向后兼容的超集，旧响应仍能通过校验。
- **消费方**：按随包 schema 校验 `data`。缺少 `contract`，或 major 版本未知时，进入保守模式（只跟随 `next` 推进，启发式判断降级为仅观察）；遇到未知枚举值走保守分支；未知字段忽略。

### 0.15.0 起已移除的投影

0.15.0 的流程减法移除了若干投影，读取 `--format json` 的工具不应再依赖它们：

| 命令 | 已移除 | 说明 |
|------|--------|------|
| `verify` | `checklist`、`ac_trace` | verify 门禁只剩三项判定：结果账本一致、零失败、零未覆盖。`gate.reason` 不再产生 `checklist_incomplete` / `ac_trace_incomplete`；旧响应中出现时按 FAIL 处理即可。 |
| `status` / `next` | `plan_state.clarification` | 决策澄清不再是硬门，不再发射契约 `1.2.0`。 |
| `status` / `next` | merge 事务与切片事务的投影 | 合并改为一次调用 `openlogos merge <slug>`，切片由 `openlogos slice plan` 写入；不再发射契约 `1.4.0`。 |

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
| `merge-generated` | 0.15 之前两步式 merge 的遗留取值；一次调用的 `openlogos merge` 直接进入 spec-complete 之后的步骤。 |
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

返回 Gate 3.6 结果。门禁只有三项判定：结果账本一致、零失败、零未覆盖；预跑命令失败同样判 FAIL。

| 关键字段 | 描述 |
|-----------|-------------|
| `contract.version` | `1.0.0`；含切片感知字段时为 `1.1.0` |
| `summary` | 定义 / 人工 / 执行 / 通过 / 失败 / 跳过 / 未覆盖计数，覆盖率与通过率 |
| `gate` | `result`（`"PASS"` / `"FAIL"`）和 `reason` |
| `failed_cases[]`、`uncovered_cases[]`、`skipped_cases[]` | 用例清单 |
| `consistency` | `ok`、`reasons`、`unknown_result_ids`、`manual_result_ids`、`outside_eligible_result_ids`、`invalid_results`、`count_mismatches`、`count_mismatch_details` |
| `pre_run` | 模式、每段的 `status` / `exit_code` / `duration_ms`、结果路径、诊断与建议 |
| `sandbox` | 沙箱模式、是否隔离、状态、诊断、可选 `infos` |
| `smoke_precheck` | 针对活跃提案变更的 `SMOKE-*` 用例的 smoke 覆盖预检 |
| `report_path` | 验收报告路径 |
| `verify_mode`、`attempted_slice_id`、`eligible_test_ids`、`pending_test_ids`、`manifest`、`checkpoint`、`test_change_set` | 仅切片感知运行时出现（`verify_mode`：`slice-checkpoint` 或 `final`） |

### 预运行模式

| 模式 | 描述 |
|------|-------------|
| `none` | 未配置预运行命令 |
| `pre_run_command` | 执行单个 `verify.pre_run_command` |
| `two_phase` | `regression_command` + `incremental_command`，按最后写入优先合并 |

`pre_run.commands[]` 中每个实际执行的条目带 `stdout_tail` 与 `stderr_tail`：该段命令输出的末尾最多 80 行、不超过 8 KiB（截断落在完整 UTF-8 字符边界），已去除 ANSI 控制序列。这两个字段只出现在 JSON 输出中，不写入 `acceptance-report.md`，命令输出全文也不落盘。`skipped` 条目没有这两个字段。

### 关卡失败原因

| 原因 | 描述 |
|--------|-------------|
| `pre_run_failed` | 预跑命令（`pre_run`、`regression` 或 `incremental` 任一段）非零退出，且账本中没有失败用例；不会用旧结果文件放行 |
| `result_ledger_inconsistent` | 结果账本不一致（见 `consistency`） |
| `failed_cases` | 一个或多个测试用例失败 |
| `incomplete_coverage` | 部分已定义用例无结果 |
| `smoke_runner_missing` / `smoke_reporter_missing` | smoke 覆盖预检阻断：提案改动了 `SMOKE-*` 用例，但没有接好 runner 或 reporter |

优先级：预跑有一段失败时，有失败用例取 `failed_cases`，否则取 `pre_run_failed`；预跑全部成功或未配置时，依次为 `result_ledger_inconsistent` → `failed_cases` → `incomplete_coverage`。

### 切片 manifest 暂停

多切片 launched 变更中，`TEST_SLICE_MANIFEST.json` 缺失、非法或过期时，verify 不执行任何测试，输出 `data` 含 `reason`（如 `test-slice-manifest-missing`）与 `slice_verification_state` 的信封，并以退出码 `2` 退出；`test-slice-manifest-unsupported` 与 `test-slice-assignment-ambiguous` 的退出码为 `1`。恢复方法是重跑 `openlogos slice plan --file <slices.json>`，见 [测试切片清单](/zh/specs/test-slice-manifest)。

`status` 与 `next` 暴露同源的 `slice_verification_state`（`manifest_status`、`verify_mode`、`attempted_slice_id`、`confirmed_slice_ids`、`eligible_test_ids`、`pending_test_ids`）。可恢复时，`next` 返回 `next_node.id: "plan-slices"`、`skill: "slice-planner"`、`dispatch.idempotent: true`。

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
| `changed_cases`、`diagnostics`、`runners` | 活跃提案变更的 `SMOKE-*` ID、预检诊断、已发现的 runner |
| `required_skipped_cases` | 仅非空时出现。`[{id, detail}]`：本提案变更用例中阻断门禁的 skip（`required_cases_skipped`） |
| `platform_skipped_cases` | 仅非空时出现。`[{id, detail}]`：因结果带 `reason_code: "platform-unavailable"` 且 `detail` 非空而放行的 skip |
| `sandbox` | 沙箱执行状态 |
| `report_path` | 生成的 smoke 报告路径 |
| `result_path` | smoke 结果 JSONL 路径 |

`gate.reason` 优先级：`failed_cases` → 预检诊断码（`smoke_runner_missing` / `smoke_reporter_missing` / `smoke_cases_uncovered`）→ `required_cases_skipped` → `incomplete_coverage`。

## merge

```bash
openlogos merge <slug> --format json
```

`openlogos merge` 一次调用应用全部 delta，原子落盘（全有或全无）。成功时 `data` 包含：

| 字段 | 描述 |
|------|------|
| `slug` | 提案 slug |
| `result` | `"merged"`（首次合并，含 no-delta 的 spec-complete）、`"already-merged"`（自上次合并后没有变化）或 `"amended"`（已合并提案的 delta 有改动，按记录的合并基线增量修正） |
| `delta_digest` | 本次应用的 delta 摘要 |
| `target_count`、`targets` | 写入的规格文件 |
| `spec_merged_path` | `SPEC_MERGED` 路径 |
| `test_change_set` | 本提案新增 / 修改 / 删除的测试 ID |
| `invalidated_markers` | `amended` 时，因规格变化而清除的验收标记（在场的 `VERIFY_PASS`、`VERIFY_FAIL`、`DEPLOY_DONE`、`SMOKE_PASS`、`SMOKE_FAIL`） |
| `amend` | `null`；`amended` 时为 `{targets_recomposed, targets_added, targets_restored}` |

`status` 在 `modules[].active_change.spec_amend` 投影待应用的修正：`merged_delta_digest`、`current_delta_digest`、`pending`（无基线时为 `null`，表示无法判定）、`blocked_reason`（`baseline-missing`、`baseline-unreadable`、`drift`、`create-withdraw`、`prototype-changed`）与 `amend_count`。合并目标在合并后被手工改动（`drift`）时，`merge` 拒绝修正（`MERGE_AMEND_DRIFT`）并给出核对指引。错误使用下文的错误信封。

## slice plan

```bash
openlogos slice plan --file <slices.json> --format json
```

成功时 `command` 为 `"slice plan"`，`data` 包含 `slug`、`slice_count`、`slice_ids`、`task_fingerprint`、`spec_fingerprint`、`manifest_path`。失败时错误信封输出到 stderr，`error.code` 为 `SLICE_PLAN_*`；校验器拒绝时，顶层 `violations` 数组逐条带出 `code`、`path`、`message`、`fix_hint`。见 [`openlogos slice`](/zh/cli/slice)。

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
