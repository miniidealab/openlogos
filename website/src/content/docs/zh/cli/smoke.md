---
title: "openlogos smoke"
description: 针对 smoke 测试用例规格运行部署后的冒烟验证（Gate 3.8）。
---

`openlogos smoke` 用来验证部署后的健康状况：从 JSONL 文件读取 smoke 结果，与 `logos/resources/test/smoke/` 中定义的 smoke 用例 ID 对比，并生成 smoke 报告。这是 **Gate 3.8** 质量检查。应在部署执行完成、并用 [`openlogos deploy-done`](/zh/cli/deploy-done)（Gate 3.7）记录之后运行。

## 命令格式

```bash
openlogos smoke [--env <name>] [--format json]
```

在项目根目录下运行。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--env <name>` | 为本次运行和报告打上环境标签，例如 `staging`、`production`。 |
| `--format json` | 输出机器可读的 JSON 信封（包含 `sandbox` 诊断信息）。 |

## 前置检查

存在活跃变更提案时，smoke 会先检查提案的生命周期状态。检查按顺序进行，命中第一个即停止，并且发生在读取配置、执行 `smoke.command`、改动结果文件**之前**：

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `SMOKE_NOT_REQUIRED` | 当前提案不需要 smoke | verify 通过后直接归档 |
| `SMOKE_DEPLOY_DECISION_CONFLICT` | `proposal.md` 与 `tasks.md` 的部署决策不一致 | 先修正部署决策 |
| `SMOKE_DEPLOY_NOT_DONE` | 缺少 `DEPLOY_DONE` | 完成部署后运行 `openlogos deploy-done` |
| `SMOKE_DEPLOY_TASKS_INCOMPLETE` | `[deploy]` 仍有未勾选条目 | 补齐 `[deploy]` 任务后运行 `openlogos deploy-done` |

## 功能说明

1. 读取 `logos/logos.config.json` 中的 smoke 配置（`smoke.command`、`smoke.result_path`、`smoke.report_path`）。未配置 `smoke.command` 但存在 `scripts/run-smoke.js` 时，使用 `node scripts/run-smoke.js`。
2. 有 smoke 命令时，先**清空结果文件**再执行命令（可选沙箱）。因此上一次部署留下的结果不会被当成本次的证据。命令非零退出时，smoke 给出告警，并按命令实际写出的结果继续判定。
3. 从 `logos/resources/verify/smoke-results.jsonl`（或配置的路径）读取 smoke 结果。
4. 扫描 `logos/resources/test/smoke/*.md`，从表格行首列读取已定义的 smoke 用例 ID（如 `SMOKE-releases-01`）。
5. 活跃提案新增或修改了 `SMOKE-*` 用例时，执行 smoke 覆盖预检：runner 是否可达（`smoke_runner_missing`）、是否写出了结果（`smoke_reporter_missing`）、每个变更 ID 是否都有结果（`smoke_cases_uncovered`）。
6. 计算 Gate 3.8、生成报告，并向活跃提案写入 `SMOKE_PASS` / `SMOKE_FAIL`。

## smoke 配置

```json
{
  "smoke": {
    "command": "node scripts/run-smoke.js",
    "result_path": "logos/resources/verify/smoke-results.jsonl",
    "report_path": "logos/resources/verify/smoke-report.md",
    "sandbox_mode": "auto",
    "sandbox_root": "/private/tmp",
    "sandbox_deny_workspace_write": true
  }
}
```

| 字段 | 默认值 | 说明 |
|-------|---------|-------------|
| `command` | 存在 `scripts/run-smoke.js` 时为 `node scripts/run-smoke.js`，否则无 | 运行 smoke 测试并把结果写入 `result_path` 的 shell 命令 |
| `result_path` | `logos/resources/verify/smoke-results.jsonl` | smoke 结果 JSONL 路径 |
| `report_path` | `logos/resources/verify/smoke-report.md` | 生成的报告路径 |
| `sandbox_mode` | `auto` | 沙箱隔离模式（`off` / `auto` / `always`） |

沙箱执行器与 [`openlogos verify`](/zh/cli/verify) 共享：完整路径段严格等于 `node_modules` 的写入不参与写入审计，通过 `sandbox.infos` 输出说明，不影响 `sandbox.status`；白名单结果文件即使位于 `node_modules` 下也照常回收；symlink 隔离与 OS 级运行期写保护同样适用。写保护不可用时，`always` 失败，`auto` 告警。

## Gate 3.8 通过标准

以下各项必须全部满足：

| 条件 | 说明 |
|-----------|-------------|
| 零失败用例 | 没有任何 smoke 结果的 `status` 为 `"fail"` |
| 100% 覆盖率 | 每个已定义的 smoke ID 都有结果 |
| 预检无诊断 | 本提案变更用例的 smoke 覆盖预检没有诊断项 |
| 必要用例未被 skip | 本提案新增或修改的 smoke 用例没有以 `skip` 结束（平台不可执行例外见下文） |

沙箱失败同样判 FAIL。任一条件不满足时，命令以退出码 `1` 退出。

### 必要用例的 skip

本提案新增或修改的 smoke 用例，是这次部署的必要证据。`skip` 只说明没有取得证据，因此这类 skip **默认拦截**（`gate.reason: "required_cases_skipped"`），报告中列在「Required Cases Without Evidence」一节。

例外只有一种：用例在当前平台上确实无法执行。这时 runner 以 `reason_code: "platform-unavailable"` 写 skip，并在 `detail` 中写明原因（不能为空），这类 skip 会被放行。它在报告中单独列为「Platform-Unavailable Skips」，在 JSON 中列入 `platform_skipped_cases`，以便审计。缺原因码、使用其他原因码或 `detail` 为空的 skip，仍按缺少必要证据处理。

不属于本提案变更范围的 smoke 用例，其 skip 口径不变（计入已执行，不计入失败或未覆盖），单独不会导致 FAIL。

## smoke 结果格式（JSONL）

```json
{"id":"SMOKE-releases-01","status":"pass","duration_ms":1200,"timestamp":"2026-05-28T10:00:00Z"}
{"id":"SMOKE-releases-02","status":"fail","error":"Expected 200, got 404","duration_ms":500}
{"id":"SMOKE-cli-install-03","status":"skip","reason_code":"platform-unavailable","detail":"Windows-only installer check; current runner is Linux"}
```

| 字段 | 必填 | 取值 | 说明 |
|-------|----------|--------|-------------|
| `id` | 是 | `SMOKE-<领域>-<序号>` | 与规格中定义一致的 smoke 用例 ID |
| `status` | 是 | `pass`、`fail`、`skip` | 结果 |
| `error` | 否 | string | 失败时的错误信息 |
| `detail` | `skip` 时必填 | string | 跳过的原因 |
| `reason_code` | 否 | `platform-unavailable` | 门禁唯一识别的原因码 |
| `duration_ms` | 否 | number | 执行时长 |
| `timestamp` | 否 | ISO 8601 | 运行时间 |

## 提案生命周期集成

存在活跃变更提案时，smoke 会写入标记：

| 门禁结果 | 标记 |
|-------------|---------------|
| PASS | 写 `logos/changes/<slug>/SMOKE_PASS`，删除 `SMOKE_FAIL` |
| FAIL | 写 `logos/changes/<slug>/SMOKE_FAIL`，删除 `SMOKE_PASS` |

`SMOKE_PASS` 后提案可以归档；`SMOKE_FAIL` 后修复部署问题再重跑 smoke。

## 输出示例（通过）

```
⚙️  Running smoke.command: node scripts/run-smoke.js

🔎 OpenLogos Smoke Verification

  Environment: staging
  Defined:  5
  Executed: 5
  Passed:   4
  Failed:   0
  Skipped:  1
  Coverage: 100%
  Pass rate: 100%
  smoke 沙箱：mode=auto，status=pass，isolated=true，write_denied=true

Platform-unavailable smoke cases (skip accepted):
  SMOKE-cli-install-03: Windows-only installer check; current runner is Linux

✅ Gate 3.8: PASS

📄 报告：logos/resources/verify/smoke-report.md
```

## 输出示例（失败）

```
🔎 OpenLogos Smoke Verification

  Defined:  5
  Executed: 4
  Passed:   2
  Failed:   1
  Skipped:  1
  Coverage: 80%
  Pass rate: 75%

Failed smoke cases:
  SMOKE-releases-03  Expected 200, got 404

Uncovered smoke cases:
  SMOKE-cli-install-02

Required smoke cases without evidence (skip):
  SMOKE-releases-04: staging token not configured

❌ Gate 3.8: FAIL

📄 报告：logos/resources/verify/smoke-report.md
```

## JSON 输出

使用 `--format json` 时，`data` 包含 `environment`、`summary`、`gate`（`result`、`reason`）、`failed_cases`、`uncovered_cases`、`skipped_cases`、`changed_cases`、`diagnostics`、`runners`、`sandbox`、`report_path`、`result_path`。以下两个列表仅在非空时出现：

- `required_skipped_cases`：`[{id, detail}]`，阻断门禁的必要用例 skip
- `platform_skipped_cases`：`[{id, detail}]`，已放行的平台不可执行 skip

`gate.reason` 优先级：`failed_cases` → 预检诊断码 → `required_cases_skipped` → `incomplete_coverage`。详见 [CLI JSON 输出](/zh/specs/cli-json-output)。

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录 |
| `SMOKE_*` 前置错误码 | 见 [前置检查](#前置检查) | 按该表处理 |
| `No smoke results found at ...`（`NO_SMOKE_RESULTS`） | 结果文件不存在 | 配置 `smoke.command`，或先运行 smoke runner |
| `No smoke case specs found`（`NO_SMOKE_CASES`） | `logos/resources/test/smoke/` 中没有 smoke ID | 先编写 smoke 用例规格（deployment-designer / test-writer） |

## 相关

- [`verify`](/zh/cli/verify)：测试验收（Gate 3.6，部署前运行）
- [`deploy-done`](/zh/cli/deploy-done)：记录部署完成（Gate 3.7）
- [`status`](/zh/cli/status)：在提案生命周期中显示 smoke 门状态
- [`archive`](/zh/cli/archive)：smoke 通过后归档提案
