---
title: "openlogos verify"
description: 对照已合并的测试用例规格验证测试结果，并生成验收报告（Gate 3.6）。
---

`openlogos verify` 读取测试结果账本（JSONL），与 `logos/resources/test/` 中定义的测试用例 ID 对比，并生成验收报告。这是 **Gate 3.6** 质量检查。

门禁判定只有三项：结果账本一致、零失败、零未覆盖。此外，配置了预跑命令时，预跑命令非零退出同样判 FAIL。

## 命令格式

```bash
openlogos verify
openlogos verify --format json
```

在项目根目录下运行。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--format json` | 输出机器可读的 JSON 信封，见下文 [JSON 输出](#json-输出)。 |

## Gate 3.6 通过标准

| 判定项 | 含义 |
|-----------|-------------|
| 结果账本一致 | 结果文件每行合法；每个结果 ID 都在已合并测试规格中定义；`[manual]` 用例没有结果行；各计数相互吻合（`passed + failed + skipped = executed` 等）。 |
| 零失败 | 没有任何有效结果的 `status` 为 `"fail"`。 |
| 零未覆盖 | 测试规格中定义的每个自动化 UT/ST ID 都有对应结果。 |

另外，配置了 `verify.pre_run_command`（或两阶段的 `regression_command` / `incremental_command`）时，**每一段都必须以退出码 0 结束**。任一段非零退出即门禁 FAIL（`pre_run_failed`），即使结果文件看起来完整且全绿也一样。这时的结果文件可能是运行器回滚出的旧账本，verify 不会沿用旧结果判定。

门禁 FAIL 时命令以退出码 `1` 退出。

`*-test-cases.md` 里的覆盖度自查清单和验收条件追溯表仍是有用的写作实践（见 [test-writer](/zh/skills/test-writer)），但 verify 不解析它们，它们不影响门禁、报告和 JSON 输出。

### FAIL 原因

JSON 输出中的 `gate.reason` 取第一个命中的值：

| 情形 | 原因优先级 |
|------|-----------|
| 预跑命令有一段非零退出 | 有失败用例时为 `failed_cases`，否则为 `pre_run_failed` |
| 预跑全部成功或未配置 | `result_ledger_inconsistent` → `failed_cases` → `incomplete_coverage` |

沙箱失败，或 smoke 覆盖预检命中阻断项（见下文），也会把结果变成 FAIL。

## 预跑命令与沙箱

在 `logos/logos.config.json` 中配置：

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

- **单阶段**：执行一次 `pre_run_command`。执行前 verify 会清空结果文件，避免旧结果混入本轮。
- **两阶段**：依次执行 `regression_command` 与 `incremental_command`，结果按「后写胜出」合并进 `result_path`。配置了两阶段时，`pre_run_command` 作为兼容配置保留，但不执行。
- **未配置**：直接读取 `result_path` 中已有的结果。覆盖不足时，verify 会建议配置预跑命令，因为常见原因是本地只跑了部分测试。

沙箱模式：

- `sandbox_mode: "off"`：不隔离（历史行为）。
- `sandbox_mode: "auto"`：能隔离就隔离；隔离不可用时降级并告警。
- `sandbox_mode: "always"`：强制隔离。以下任一情况 verify 都会失败：设置失败、沙箱副本含逃逸 symlink、运行期写保护不可用、检测到白名单之外的写入。

沙箱内的预跑命令只能写回结果文件（`verify.result_path`，以及已配置的 `regression_result_path` / `incremental_result_path`）和报告。白名单内的结果文件即使位于 `node_modules` 下也会照常回收。

规范化后存在完整路径段严格等于 `node_modules` 的路径（含 `packages/a/node_modules/**` 这类嵌套形态），视为沙箱副本内的一次性依赖目录：不参与写入审计，也不回收。`node_modules-cache` 等近似名称不豁免。豁免生效时会在 `sandbox.infos` 输出一条信息级说明（文本输出以 `ℹ️` 显示一次），`sandbox.status` 不变。

复制时 symlink 目标按字面量保留，并检查是否有逃逸出沙箱的链接。命令执行期间，由 OS 级写保护（macOS `sandbox-exec`、Linux bubblewrap）在写入发生前阻断对原 workspace 的写入。没有可用的写保护机制时，`always` 失败并说明原因；`auto` 继续执行，但告警说明残留风险。

## 切片增量 checkpoint 与最终全量验收

在 launched 变更中，如果 `[code]` 段由 [`openlogos slice plan`](/zh/cli/slice) 规划出两片及以上、且每片都标注了真实测试 ID，verify 会依据 `TEST_SLICE_MANIFEST.json`（见 [测试切片清单](/zh/specs/test-slice-manifest)）进入**切片感知**模式：

- **切片 checkpoint**（`verify_mode: "slice-checkpoint"`）：还有切片未确认时，verify 的验收范围是：基线回归测试 + 已通过切片拥有的测试 + 当前切片拥有的测试。后续切片拥有的测试是 **pending**：不参与本次门禁，也不计入未覆盖。运行器如果输出了 pending ID，账本判为不一致（`result_outside_eligible_scope`）。
  - PASS：向 `SLICE_CHECKPOINTS.jsonl` 追加一行，**不写** `VERIFY_PASS`。
  - FAIL：写 `VERIFY_FAIL`，并计入 implement 循环的修复预算。
- **最终验收**（`verify_mode: "final"`）：全部切片勾选并确认后，verify 对所有已定义测试做全量验收。只有 final PASS 才写 `VERIFY_PASS`。

单切片、纯文档提案，以及没有 manifest 的旧提案，照常走全量 verify。

manifest 缺失、非法或过期（stale）时，verify 在执行任何测试命令**之前**暂停：打印 `verify 暂停：<reason>` 并逐条列出违规；JSON 模式输出 `data.reason` 与 `data.slice_verification_state`。退出码为 `2`，`test-slice-manifest-unsupported` / `test-slice-assignment-ambiguous` 为 `1`。这种情况下不写任何 marker，也不写循环账本。恢复方法：用同一份输入重跑 `openlogos slice plan --file <slices.json>`（见 [`slice`](/zh/cli/slice)）。

## 提案生命周期集成

存在活跃变更提案（`logos/.openlogos-guard`）时，门禁结果确定后，verify 会向提案目录写入标记：

| 结果 | 标记 |
|------|------|
| PASS（全量或 final） | 写 `VERIFY_PASS`，删除 `VERIFY_FAIL` |
| PASS（切片 checkpoint） | 追加 checkpoint 行，删除 `VERIFY_FAIL`，不写 `VERIFY_PASS` |
| FAIL | 写 `VERIFY_FAIL`，删除 `VERIFY_PASS`、`DEPLOY_DONE`、`SMOKE_PASS`、`SMOKE_FAIL` |

`openlogos status` / `openlogos next` 读取这些标记来给出下一步。PASS 后如果提案有 `[deploy]` 任务，verify 会列出这些任务，并提醒部署是人类确认点。

### smoke 覆盖预检

活跃提案新增或修改了 `SMOKE-*` 用例时，verify 会顺带检查 smoke runner 与 reporter 是否已接好（`smoke_runner_missing`、`smoke_reporter_missing`）。缺 runner 时 verify 直接 FAIL，问题在部署前就会暴露，不必等到 `openlogos smoke`。切片 checkpoint 期间，属于后续切片的 smoke 用例不阻断本次预检。

## 测试结果格式（JSONL）

结果文件每行一个 JSON 对象：

```json
{"id":"UT-S01-01","status":"pass","duration_ms":12,"timestamp":"2026-04-10T10:00:00Z"}
{"id":"UT-S01-02","status":"fail","duration_ms":5,"error":"Expected 201, got 400"}
{"id":"ST-S02-01","status":"skip","scenario":"S02"}
```

| 字段 | 必填 | 取值 | 说明 |
|-------|----------|--------|-------------|
| `id` | 是 | UT/ST ID，如 `UT-S01-01` | 必须是测试规格中定义的 ID |
| `status` | 是 | `pass`、`fail`、`skip` | 其他取值会导致账本不一致 |
| `error` | `fail` 时必填 | string | `fail` 记录缺少非空 `error` 视为非法行 |
| `duration_ms` | 否 | number | 执行时长 |
| `timestamp` | 否 | ISO 8601 | 运行时间 |
| `scenario` | 否 | string | 场景标识 |

同一 `id` 出现多次时：如果该 ID 的所有记录时间戳都合法，取时间最新的一条；只要有一条缺失或非法，就退回取文件中最后一行。非法 JSON 行、缺 `id` / `status` 的行会记为非法行，账本判为不一致，不会被静默跳过。

## 测试用例 ID 识别

verify 扫描 `logos/resources/test/` 下所有 `*-test-cases.md`，只读取 **Markdown 表格行的首列**中的 UT/ST ID：

```
| UT-S01-01 | ... |        → 自动化用例
| ST-S02-03 | ... |        → 自动化用例
| ST-S02-04 [manual] | ... | → 人工用例（不计入 verify）
```

只在正文、其他列或代码块里出现的 ID 不算定义。`SMOKE-*` 用例由 [`smoke`](/zh/cli/smoke)（Gate 3.8）统计，不进入 verify。

## 输出示例（通过）

项目 `locale` 为 `zh` 时输出中文：

```
⚙️  Running verify.pre_run_command: npm test
...

🔍 OpenLogos 测试验收

读取测试结果：logos/resources/verify/test-results.jsonl
读取测试用例：logos/resources/test/

──────────────────────────────────────────────────
📊 结果摘要
──────────────────────────────────────────────────
  定义用例：  111 个（79 UT + 32 ST）
  执行用例：  111 个
  ✅ 通过：    86
  ❌ 失败：     0
  ⏭️  跳过：     25
──────────────────────────────────────────────────
  覆盖度：100%（111/111）
  通过率：100%（111/111）
──────────────────────────────────────────────────

✅ Gate 3.6：PASS

📄 报告：logos/resources/verify/acceptance-report.md

⚙️  verify 预跑模式：单阶段
  [pass] pre_run：npm test（exit=0，duration=8123ms）

🧪 verify sandbox
  verify 沙箱：mode=auto，status=pass，isolated=true，write_denied=true
```

通过率把跳过计为通过：`(passed + skipped) / executed`。

## 输出示例（失败）

```
🔍 OpenLogos 测试验收

读取测试结果：logos/resources/verify/test-results.jsonl
读取测试用例：logos/resources/test/

──────────────────────────────────────────────────
📊 结果摘要
──────────────────────────────────────────────────
  定义用例：  111 个（79 UT + 32 ST）
  执行用例：  109 个
  ✅ 通过：    84
  ❌ 失败：     2
  ⏭️  跳过：     23
──────────────────────────────────────────────────
  覆盖度：98%（109/111）
  通过率：98%（107/109）
──────────────────────────────────────────────────

❌ 失败用例：
  UT-S02-04  Expected HTTP 302, got 301
  UT-S04-12  Token verification returned false for valid token

⚠️  未覆盖用例（2）：
  ST-S03-05
  ST-S03-06

❌ Gate 3.6：FAIL

📄 报告：logos/resources/verify/acceptance-report.md
```

账本不一致时，verify 会打印 `verify result ledger is inconsistent`，列出原因（如 `unknown_test_result_id`、`invalid_test_result_json`、`result_count_mismatch`）、相关 ID 或行号；计数矛盾会点名相互矛盾的两个计数。

## 验收报告

verify 生成 `logos/resources/verify/acceptance-report.md`，包含：

- **汇总**：定义、人工（已排除）、执行、通过、失败、跳过、未覆盖、覆盖率、通过率与门禁结果
- **预跑命令失败**：只记失败阶段与退出码。报告会进 git，所以命令输出不写入报告。
- **切片验收**（仅切片感知模式）：模式、本次尝试的切片、已确认切片、可验收与 pending 测试数
- **失败用例**、**未覆盖用例**、**跳过用例**

## JSON 输出

使用 `--format json` 时，信封的 `data` 包含：

| 字段 | 说明 |
|------|------|
| `contract.version` | 机器契约版本（`1.0.0`；带切片感知字段时为 `1.1.0`） |
| `summary` | 定义 / 人工 / 执行 / 通过 / 失败 / 跳过 / 未覆盖计数、覆盖率与通过率 |
| `gate` | `result`（`PASS` / `FAIL`）与 `reason` |
| `failed_cases`、`uncovered_cases`、`skipped_cases` | 用例清单 |
| `consistency` | 账本一致性：`ok`、`reasons`、未知 / 人工 / 越界 ID、非法行、计数矛盾及明细 |
| `pre_run` | 模式（`none` / `pre_run_command` / `two_phase`）、每段 `status` 与 `exit_code`、结果路径、诊断与建议。每个实际执行的阶段还带 `stdout_tail` / `stderr_tail`：末尾最多 80 行、不超过 8 KiB、已去除 ANSI 控制序列。输出尾部只出现在 JSON 中，不落盘。 |
| `sandbox` | 沙箱模式、是否隔离、写入策略、`status`（`pass` / `warn` / `fail` / `skipped`）、诊断、建议、可选 `infos` |
| `smoke_precheck` | smoke 覆盖预检结果 |
| `verify_mode`、`attempted_slice_id`、`eligible_test_ids`、`pending_test_ids`、`manifest`、`checkpoint`、`test_change_set` | 仅切片感知模式出现 |
| `report_path` | 验收报告路径 |

契约细节见 [CLI JSON 输出](/zh/specs/cli-json-output)。

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `No test results found at ...`（`NO_TEST_RESULTS`） | 结果文件不存在，预跑也没有生成 | 先运行带 OpenLogos reporter 的测试，或配置 `verify.pre_run_command` |
| `No test case specs found`（`NO_TEST_CASES`） | `logos/resources/test/` 中没有定义 UT/ST ID | 先做测试设计（test-writer） |
| `logos/logos.config.json not found`（`PROJECT_NOT_INITIALIZED`） | 不在项目根目录 | `cd` 到项目根目录 |
| `verify 暂停：test-slice-manifest-*` | 切片 manifest 缺失、非法或过期 | 重跑 `openlogos slice plan --file <slices.json>` |
| 退出码 `1` | Gate 3.6 FAIL | 修复失败用例、补齐缺失结果、修正账本，或让预跑命令成功后重跑 verify |

## 相关

- [`slice`](/zh/cli/slice)：规划 `[code]` 切片并写出 `TEST_SLICE_MANIFEST.json`
- [`deploy-done`](/zh/cli/deploy-done)：verify 通过后记录部署完成（Gate 3.7）
- [`smoke`](/zh/cli/smoke)：部署后冒烟验收（Gate 3.8）
- [`status`](/zh/cli/status)：查看提案当前所处位置
- [`launch`](/zh/cli/launch)：通常在首轮 verify 通过后运行，以启用变更管理
