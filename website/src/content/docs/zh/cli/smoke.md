---
title: "openlogos smoke"
description: 针对 smoke 测试用例规格运行部署后的冒烟验证（Gate 3.8）。
---

通过从 JSONL 文件读取 smoke 测试结果、与 `logos/resources/test/smoke/` 中定义的 smoke 用例 ID 对比，并生成 smoke 报告，来验证部署的健康状况。这是 **Gate 3.8** 质量检查 —— 在部署执行（Phase 3-7）之后运行。

## 命令格式

```bash
openlogos smoke [--format json] [--environment <name>]
```

必须在项目根目录下运行。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--format json` | 输出机器可读的 JSON 信封（包含 `sandbox` 诊断信息）。 |
| `--environment <name>` | 为 smoke 报告打上环境标签（例如 `staging`、`production`）。 |

## 功能说明

1. 从 `logos.config.json` 读取 smoke 配置（`smoke.command`、`smoke.result_path`、`smoke.report_path`）
2. 如果配置了 `smoke.command`，则执行它（可选地在沙箱中运行）
3. 从 `logos/resources/verify/smoke-results.jsonl`（或自定义路径）读取 smoke 结果
4. 扫描 `logos/resources/test/smoke/*.md` 中定义的 smoke 用例 ID（模式：`SMOKE-<name>-<number>`）
5. 将结果与定义的用例对比 —— 计算覆盖率、通过率
6. 生成 `logos/resources/verify/smoke-report.md`
7. 如果存在活跃的变更提案，写入提案标记（`SMOKE_PASS` / `SMOKE_FAIL`）

## Smoke 配置

在 `logos/logos.config.json` 中配置：

```json
{
  "smoke": {
    "command": "cd website && npm run build && node scripts/smoke-releases.mjs",
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
| `command` | *(none)* | 运行 smoke 测试的 shell 命令（将结果写入 `result_path`） |
| `result_path` | `logos/resources/verify/smoke-results.jsonl` | smoke 结果 JSONL 的路径 |
| `report_path` | `logos/resources/verify/smoke-report.md` | 生成的报告路径 |
| `sandbox_mode` | `auto` | 沙箱隔离模式（`off` / `auto` / `always`） |

## Gate 3.8 通过标准

两个条件都必须满足：

| 条件 | 说明 |
|-----------|-------------|
| 零失败用例 | 没有任何 smoke 结果的 `status` 为 `"fail"` |
| 100% 覆盖率 | smoke 规格中定义的每个 ID 都有对应的结果 |

如果任一条件失败，命令以退出码 `1` 退出。

## Smoke 用例 ID 格式

命令会扫描 `logos/resources/test/smoke/*.md` 中匹配以下模式的 ID：

```
SMOKE-releases-01    (Smoke test, releases domain, case 01)
SMOKE-cli-install-02 (Smoke test, cli-install domain, case 02)
```

正则表达式：`/\bSMOKE-[A-Za-z0-9-]+-\d{2,3}\b/`

## Smoke 结果格式（JSONL）

`smoke-results.jsonl` 中的每一行都是一个 JSON 对象：

```json
{"id":"SMOKE-releases-01","status":"pass","duration_ms":1200,"timestamp":"2026-05-28T10:00:00Z"}
{"id":"SMOKE-releases-02","status":"fail","error":"Expected 200, got 404","duration_ms":500}
```

| 字段 | 必填 | 取值 | 说明 |
|-------|----------|--------|-------------|
| `id` | Yes | `SMOKE-*-XX` | 与规格匹配的 smoke 用例 ID |
| `status` | Yes | `pass`, `fail`, `skip` | 测试结果 |
| `duration_ms` | No | number | 执行时间 |
| `timestamp` | No | ISO 8601 | 测试运行的时间 |
| `error` | No | string | 错误信息（用于失败的用例） |

## 提案生命周期集成

当存在活跃的变更提案（`.openlogos-guard`）时，`openlogos smoke` 会写入标记：

| 门禁结果 | 写入的标记 |
|-------------|---------------|
| PASS | `logos/changes/<slug>/SMOKE_PASS` |
| FAIL | `logos/changes/<slug>/SMOKE_FAIL` |

这些标记会推进提案步骤：
- `SMOKE_PASS` → 提案可以归档了
- `SMOKE_FAIL` → 修复部署问题并重新运行 smoke

## 输出示例（通过）

```
🔎 OpenLogos Smoke Verification

  Environment: staging
  Defined:  5
  Executed: 5
  Passed:   5
  Failed:   0
  Skipped:  0
  Coverage: 100%
  Pass rate: 100%

✅ Gate 3.8: PASS

📄 Report: logos/resources/verify/smoke-report.md
```

## 输出示例（失败）

```
🔎 OpenLogos Smoke Verification

  Defined:  5
  Executed: 4
  Passed:   3
  Failed:   1
  Skipped:  0
  Coverage: 80%
  Pass rate: 75%

Failed smoke cases:
  SMOKE-releases-03  Expected 200, got 404

Uncovered smoke cases:
  SMOKE-cli-install-02

❌ Gate 3.8: FAIL

📄 Report: logos/resources/verify/smoke-report.md
```

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录 |
| `No smoke results found at ...` | JSONL 文件不存在 | 先运行 smoke 测试（或配置 `smoke.command`） |
| `No smoke case specs found` | `logos/resources/test/smoke/` 为空 | 先编写 smoke 测试用例规格（deployment-designer Skill） |

## 相关命令

- [`verify`](/zh/cli/verify) — 测试验收验证（Gate 3.5，在部署前运行）
- [`status`](/zh/cli/status) — 在提案生命周期中展示 smoke 门禁状态
- [`archive`](/zh/cli/archive) — smoke 通过后归档提案
