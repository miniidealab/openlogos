---
title: "openlogos verify"
description: 针对测试用例规格验证测试结果并生成验收报告（Gate 3.5）。
---

从 JSONL 文件读取测试结果，与 `logos/resources/test/` 中定义的测试用例 ID 对比，验证三层覆盖度，并生成验收报告。这是 **Gate 3.5** 质量检查。

## 命令格式

```bash
openlogos verify
openlogos verify --format json
```

必须在项目根目录下运行。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--format json` | 输出机器可读的 JSON 信封（包含 `pre_run` 和 `sandbox` 诊断信息）。 |

## 沙箱执行（verify / smoke 标准化）

`openlogos verify` 支持通过 `logos/logos.config.json` 进行沙箱化的 pre-run 执行：

```json
{
  "verify": {
    "result_path": "logos/resources/verify/test-results.jsonl",
    "pre_run_command": "npm test",
    "sandbox_mode": "auto",
    "sandbox_root": "/private/tmp",
    "sandbox_deny_workspace_write": true
  }
}
```

行为：

- `sandbox_mode: "off"`：保持历史行为，无隔离。
- `sandbox_mode: "auto"`：优先隔离；如果隔离不可用，则降级并发出警告，保持命令兼容性。
- `sandbox_mode: "always"`：强制隔离；如果设置失败或检测到非白名单写入，verify 失败。

启用沙箱后，pre-run 命令仅允许结果文件的写回（`verify.result_path`、可选的 `regression_result_path`、`incremental_result_path`）以及报告输出。

## 检查内容

验证会运行三层校验：

### 第 1 层：运行时测试结果

读取 `logos/resources/verify/test-results.jsonl`（或来自 `logos.config.json` 的自定义路径），并统计 pass/fail/skip/uncovered。

### 第 2 层：设计阶段覆盖度 checklist

解析 `*-test-cases.md` 文件中的 "覆盖度校验" checklist。这些是 AI 在测试设计阶段做出的断言 —— 例如 "All S02 exception cases are covered."

### 第 3 层：验收条件追溯

解析测试用例文件中的 "验收条件追溯" 表格。每条验收条件（例如 `S01-AC-01`）都关联到具体的测试用例 ID，并检查运行结果以确认它们通过。

## Gate 3.5 通过标准

四个条件必须全部满足：

| 条件 | 说明 |
|-----------|-------------|
| 零失败测试 | 没有任何测试结果的 `status` 为 `"fail"` |
| 100% 覆盖率 | 测试规格中定义的每个 ID 都有对应的结果 |
| Checklist 完整 | 设计阶段 checklist 中所有 `- [x]` 项都已勾选 |
| AC 可追溯 | 所有验收条件都有关联且通过的测试用例 |

如果任一条件失败，命令以退出码 `1` 退出。

## 提案生命周期集成

当存在活跃的变更提案（`.openlogos-guard` 存在）时，`openlogos verify` 会在门禁结果确定后自动向提案目录写入一个标记文件：

| 门禁结果 | 写入的标记 |
|-------------|---------------|
| PASS | `logos/changes/<slug>/VERIFY_PASS` |
| FAIL | `logos/changes/<slug>/VERIFY_FAIL` |

这些标记会推进提案步骤：
- `VERIFY_PASS` → 提案步骤变为 `verify-passed`（可以归档）
- `VERIFY_FAIL` → 提案步骤变为 `verify-failed`（修复后重新运行 verify）

`openlogos status` 会读取这些标记以显示正确的下一步操作。

## 测试结果格式（JSONL）

`test-results.jsonl` 中的每一行都是一个 JSON 对象：

```json
{"id":"UT-S01-01","status":"pass","duration_ms":12,"timestamp":"2026-04-10T10:00:00Z"}
{"id":"UT-S01-02","status":"fail","duration_ms":5,"error":"Expected 201, got 400"}
{"id":"ST-S02-01","status":"skip","scenario":"S02"}
```

| 字段 | 必填 | 取值 | 说明 |
|-------|----------|--------|-------------|
| `id` | Yes | `UT-SXX-XX` 或 `ST-SXX-XX` | 与测试规格匹配的测试用例 ID |
| `status` | Yes | `pass`, `fail`, `skip` | 测试结果 |
| `duration_ms` | No | number | 执行时间 |
| `timestamp` | No | ISO 8601 | 测试运行的时间 |
| `error` | No | string | 错误信息（用于失败的测试） |
| `scenario` | No | string | 场景标识符 |

如果同一个 `id` 出现多次（例如来自重跑），以**最后一次出现**为准。

## 测试用例 ID 检测

命令会扫描 `logos/resources/test/` 中所有 `*-test-cases.md` 文件，查找匹配以下模式的 ID：

```
UT-S01-01    (Unit Test, Scenario 01, Case 01)
ST-S02-03    (Scenario Test, Scenario 02, Case 03)
```

正则表达式：`/\b(UT|ST)-S\d{2}-\d{2,3}\b/`

## 输出示例（通过）

```
🔍 OpenLogos Test Verification

Reading test results: logos/resources/verify/test-results.jsonl
Reading test cases: logos/resources/test/

──────────────────────────────────────────────────
📊 Results Summary
──────────────────────────────────────────────────
  Total defined:  111 cases (79 UT + 32 ST)
  Total executed: 111 cases
  ✅ Passed:      86
  ❌ Failed:       0
  ⏭️  Skipped:     25
──────────────────────────────────────────────────
  Coverage:  100%  (111/111)
  Pass rate: 77%  (86/111)
──────────────────────────────────────────────────

📋 Design-time Coverage (Layer 1)
  Checklist: 8/8 assertions confirmed

🔗 Acceptance Criteria Traceability (Layer 3)
  AC traceability: 16/16 criteria passed

✅ Gate 3.5: PASS

📄 Report: logos/resources/verify/acceptance-report.md
```

## 输出示例（失败）

```
🔍 OpenLogos Test Verification

Reading test results: logos/resources/verify/test-results.jsonl
Reading test cases: logos/resources/test/

──────────────────────────────────────────────────
📊 Results Summary
──────────────────────────────────────────────────
  Total defined:  111 cases (79 UT + 32 ST)
  Total executed: 109 cases
  ✅ Passed:      84
  ❌ Failed:       2
  ⏭️  Skipped:     23
──────────────────────────────────────────────────
  Coverage:  98%  (109/111)
  Pass rate: 77%  (84/109)
──────────────────────────────────────────────────

❌ Failed cases:
  UT-S02-04  Expected HTTP 302, got 301
  UT-S04-12  Token verification returned false for valid token

⚠️  Uncovered cases (2):
  ST-S03-05
  ST-S03-06

❌ Gate 3.5: FAIL

📄 Report: logos/resources/verify/acceptance-report.md
```

## 验收报告

命令会生成 `logos/resources/verify/acceptance-report.md`，包含：

- **汇总表** —— 定义/执行/通过/失败/跳过/未覆盖/覆盖率/通过率/门禁结果
- **失败用例** —— 每个用例的 ID 和错误信息
- **未覆盖用例** —— 在测试结果中找不到的 ID
- **跳过用例** —— `status` 为 `"skip"` 的 ID
- **设计阶段覆盖度** —— 带 ✅/❌ 的 checklist 断言表
- **AC 可追溯性** —— 验收条件 → 关联测试用例 → 运行状态

## JSON 输出要点

使用 `--format json` 时，`data` 包含：

- `pre_run`：执行模式（`none` / `pre_run_command` / `two_phase`）、命令状态、结果路径、诊断信息和建议。
- `sandbox`：沙箱模式、是否进行了隔离执行、工作区写入策略、状态（`pass` / `warn` / `fail` / `skipped`）、诊断信息和建议。

## 自定义结果路径

在 `logos.config.json` 中覆盖默认的 JSONL 路径：

```json
{
  "verify": {
    "result_path": "test-output/results.jsonl"
  }
}
```

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `No test results found at ...` | JSONL 文件不存在 | 先运行你的测试（它们应当输出到 `test-results.jsonl`） |
| `No test case specs found` | `logos/resources/test/` 为空 | 先进行测试设计（Phase 3-3a） |
| `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录 |
| 退出码 `1` | Gate 3.5 FAIL | 修复失败的测试、补齐缺失的覆盖，或完成 checklist |

## 相关命令

- [`status`](/zh/cli/status) — 检查 Phase 3-5（验证）是否完成
- [`launch`](/zh/cli/launch) — 通常在 `verify` 通过后运行，以激活变更管理
