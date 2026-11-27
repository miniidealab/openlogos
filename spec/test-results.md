# 测试结果格式规范

> 版本：0.1.0
>
> 本文档定义 OpenLogos 的标准化测试结果输出格式。AI 在生成测试代码时必须内嵌 reporter，按此格式输出每个用例的运行结果，供 `openlogos verify` 读取和验收。

## 概述

OpenLogos 不绑定任何测试框架。取而代之的做法是：**AI 在生成测试代码时内嵌一个小型 reporter**，测试运行后自动将每个用例的结果追加写入统一格式的文件。`openlogos verify` 命令只需读取该文件即可完成验收判定。

这套机制的核心优势：

- **零框架依赖**：vitest、jest、pytest、go test、cargo test 均可产出同一格式
- **零适配成本**：`openlogos verify` 只解析一种格式
- **AI 天然能做**：reporter 代码不超过 20 行，AI 在生成测试代码时顺手写入
- **用例 ID 是原生的**：不需要从测试名称里正则提取，ID 直接是数据字段

## 文件路径

测试结果文件的默认路径为：

```
logos/resources/verify/test-results.jsonl
```

可通过 `logos.config.json` 的 `verify.result_path` 字段自定义路径。

## 格式：JSONL

文件格式为 **JSONL**（JSON Lines）——每行一个独立的 JSON 对象，以换行符分隔。

选择 JSONL 而非完整 JSON 数组的理由：

| 特性 | JSONL | JSON 数组 |
|------|-------|----------|
| 追加写入 | 直接 append 一行 | 需维护数组闭合括号 |
| 流式读取 | 逐行解析 | 需读完整个文件 |
| 部分损坏 | 一行损坏不影响其他行 | 括号不匹配则整个文件不可解析 |
| 跨语言写入 | `JSON.stringify(obj) + "\n"` | 需手动管理逗号和括号 |

## 字段定义

每行是一个 JSON 对象，包含以下字段：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 用例 ID，与 `test-cases.md` 中的 `UT-xx` / `ST-xx` 完全一致 |
| `status` | `"pass"` \| `"fail"` \| `"skip"` | 是 | 运行结果 |
| `duration_ms` | number | 否 | 执行耗时（毫秒） |
| `timestamp` | string (ISO 8601) | 否 | 执行时间，如 `2026-04-03T15:30:01Z` |
| `error` | string | `status=fail` 时必需 | 失败原因（断言错误信息） |
| `scenario` | string | 否 | 场景编号（如 `S01`），用于验证 ID 前缀一致性 |
| `reason_code` | string | 否 | 机器可读的跳过原因（verify-self-sufficient-cases）；平台跳过固定为 `"platform-unavailable"`，见「verify 跳过分类」 |
| `detail` | string | 否 | 跳过原因说明；平台跳过时必须为非空字符串，写明需要的平台或执行条件（如 `requires win32`） |

### 示例

```jsonl
{"id":"UT-S01-01","status":"pass","duration_ms":12,"timestamp":"2026-04-03T15:30:01Z"}
{"id":"UT-S01-02","status":"fail","duration_ms":45,"timestamp":"2026-04-03T15:30:01Z","error":"Expected exit code 0, got 1"}
{"id":"UT-S01-03","status":"skip","timestamp":"2026-04-03T15:30:01Z"}
{"id":"ST-S01-01","status":"pass","duration_ms":230,"timestamp":"2026-04-03T15:30:02Z","scenario":"S01"}
{"id":"ST-S01-30","status":"skip","timestamp":"2026-04-03T15:30:02Z","reason_code":"platform-unavailable","detail":"requires win32"}
```

### 字段约束

- `id` 必须匹配正则 `^(UT|ST)-S\d{2}-\d{2,3}$`
- `status` 仅允许三个值：`pass`、`fail`、`skip`
- `error` 在 `status=fail` 时必须提供，其他状态可省略
- `reason_code` / `detail` 可选，旧记录不写时原样有效；它们不改变 `status` 的语义，只供「verify 跳过分类」判定
- 同一个 `id` 如果出现多次（如重试），`openlogos verify` 按「同 ID timestamp 去重全序规则」取最新一次的结果（完整算法见「JSONL 结果账本一致性与 Gate 判据 → 归一化规则」；该 ID 存在任一缺失/非法 `timestamp` 时整组退回文件行序 last-wins，等价旧行为——旧 reporter 不写 `timestamp`，产物零行为变化）

### `[manual]` 标记用例

`[manual]` 表示**需要人参与**的 UT / ST / SMOKE 用例（verify-self-sufficient-cases，功能规格 §2.106.2；SMOKE 来源变更 smoke-manual-acceptance，功能规格 §2.107.2）。在 `test-cases.md` 中，于首格 ID 后追加标记：

```markdown
| ST-S01-05 [manual] | 需要人在真实终端里观察颜色与光标 | ... |
| UT-S01-77 [manual/windows] | 需要人在 Windows 上确认系统弹窗 | ... |
| SMOKE-core-12 [manual] | 需要人在实机上安装签名包并确认首启界面 | ... |
```

**判据**：保留预装的机器环境，换一个待验版本（新的提交或制品），移除上一版本的结果与人工证据后，verify 命令能自行产生适用于新版本的证据——不需要人参与，不标 `[manual]`；否则需要人参与，必须标 `[manual]`。

- 机器自动签发、采集或获取的证据可用于自动验收；每个版本都要人重新准备的证据（例如带制品摘要的外部证据索引、人工截图）归入需要人参与。
- 一次性准备机器（安装 Docker、JDK、编译器等）不算人参与，但必须在 `verify.requirements` 中声明，见「verify 环境要求声明、对账与预检」。
- 典型的需要人参与情形：人工观察真实 TTY/PTY 渲染或界面效果、点击系统确认框、插拔设备、在实机上安装签名包、输入验证码、每个版本提供新的凭据或证据文件。
- `[manual/<平台>]` 表示「需要人参与，且在该平台上执行」。
- 判据对 UT、ST、SMOKE 相同。人工用例在部署后的冒烟阶段按环境开关由人执行并记录（`openlogos accept`），待验收清单、记录与门禁规则见本文件「Smoke 人工用例与冒烟阶段人工验收」与 `spec/environments.md` §15。

`[manual]` 用例的行为规则：

- **不写入 JSONL**：`[manual]` 用例不由自动化测试执行，不产出 JSONL 记录；UT/ST 结果出现即 `manual_test_result_id`，SMOKE 结果出现即 `manual_smoke_result_id`
- **不计入 `defined_count`**：`openlogos verify` 扫描 test-cases.md 时跳过这类用例，不计入覆盖率分母
- **不出现在 `uncovered_cases`**：不会因为缺少运行结果而报告为未覆盖
- **单独计入 `manual_count`**：在 summary 中以独立字段展示，方便感知人工用例数量
- **AC trace 中标记为 `MANUAL_PENDING`**：若某个验收条件（AC）关联的用例全部为 `[manual]`，该 AC 标记为 `🔵 MANUAL`（人工待验），不触发 Gate 3.5 失败；人工结果在冒烟阶段记录，不回写 verify 的 AC trace

#### 人工用例不得被测试入口启动

verify 只在统计时排除人工 ID，预跑命令整条执行，reporter 在测试结束后才处理结果——这些都挡不住人工用例被启动。因此：

- 项目的 verify 预跑命令（`pre_run_command` / `regression_command` / `incremental_command`，含 `verify.modules.<id>` 命令组）必须在**调度前**排除 `[manual]` 用例的测试代码，沿用项目已有的测试分组、独立文件命名或独立入口（例如 vitest 的 `exclude` 匹配 `*.manual.test.ts`、pytest 以 marker 反选 `-m "not manual"`）。
- 人工用例的测试代码可以保留，供人工验收时用独立入口启动。
- 验收方式：已标人工的用例一旦被启动就写哨兵文件；普通最终 verify 完成后，自动用例有结果、哨兵文件不存在。

## 运行约定

### `verify.pre_run_command`（兼容配置）

`verify.pre_run_command` 保持兼容，用于单阶段全量测试。配置后，`openlogos verify` 在读取 `verify.result_path` 前执行该命令：

```json
{
  "verify": {
    "result_path": "logos/resources/verify/test-results.jsonl",
    "pre_run_command": "npx vitest run"
  }
}
```

此字段适用于只需要一条命令生成完整 `test-results.jsonl` 的项目。若同时配置两阶段字段，`openlogos verify` 优先执行两阶段模型，并在输出中标记 `pre_run_command` 作为兼容配置保留。

**为什么需要预跑配置**：reporter 每次运行测试时会清空 `test-results.jsonl`，若只跑部分场景的测试（如变更提案只涉及 S03），JSONL 将缺少其他场景（S01、S02）的结果，导致 `openlogos verify` 覆盖率不足而失败。配置预跑命令后，verify 会先跑完整测试再读取结果，覆盖率始终完整。

常见框架对应命令：

| 测试框架 | pre_run_command |
|---------|----------------|
| vitest | `npx vitest run` |
| jest | `npx jest` |
| pytest | `pytest` |
| go test | `go test ./...` |
| cargo test | `cargo test` |

> `code-implementor` Skill 在生成测试代码后会自动检查并写入此字段，无需手动配置。

### `verify.regression_command` 与 `verify.incremental_command`

两阶段模型用于先运行回归测试，再运行增量测试：

```json
{
  "verify": {
    "result_path": "logos/resources/verify/test-results.jsonl",
    "regression_command": "npm test",
    "incremental_command": "npm run test:changed",
    "regression_result_path": "logos/resources/verify/test-results.regression.jsonl",
    "incremental_result_path": "logos/resources/verify/test-results.incremental.jsonl",
    "merge_results": "last-write-wins"
  }
}
```

执行语义：
1. 若配置 `regression_command`，先执行回归测试。
2. 若配置 `incremental_command`，再执行增量测试。
3. CLI 合并阶段结果，写入 `result_path`。
4. 同一个用例 ID 多次出现时（含跨阶段重复），按**「同 ID timestamp 去重全序规则」**取一条生效记录（contract-self-description 统一算法，见「归一化规则」第 5 条）：该 ID 全部 `timestamp` 合法 → 绝对时刻最新优先、同刻按合并后文件行序后者优先；存在任一缺失/非法 → 该 ID 整组退回合并后文件行序 last-wins。**两阶段合并与单文件去重不得各自实现两套语义**。
5. 若未配置阶段结果路径，CLI 必须用临时快照或等价机制避免第二阶段 reporter 清空第一阶段结果。

**`merge_results: "last-write-wins"` 配置值语义升级（contract-self-description）**：枚举值名称保留（**兼容名称，不新增枚举、不要求迁移**），其规范语义即上述统一全序算法——对不写 `timestamp` 的旧 reporter 产物，算法必然命中「整组退回行序 last-wins」分支，行为与旧名字面含义逐字节一致（零行为变化）；写 `timestamp` 的新 reporter 则取真正最新的执行证据。该配置语义以 S13 测试用例为验收锚（两阶段合并路径的 timestamp 去重回归）。

### `verify.sandbox_mode` / `smoke.sandbox_mode`

OpenLogos 的 JSONL reporter 仍然负责写入测试结果，但当 `verify` 或 `smoke` 开启沙箱模式时，reporter 和命令执行器的职责必须分离：

- reporter 只写配置声明的结果文件；
- CLI 负责在沙箱中执行测试命令；
- CLI 负责回收结果文件并阻断仓库工作区的额外写入。

### 新增约束
- `verify.sandbox_mode="always"` 时，测试命令不得直接写入仓库根目录中的非白名单路径。
- `smoke.sandbox_mode="always"` 时，`smoke.command` 不得直接写入仓库根目录中的非白名单路径。
- 若测试脚本在沙箱内失败，CLI 必须保留失败输出，并在 JSON / 文本结果中暴露 `sandbox` 诊断。
- 阶段化结果路径（`regression_result_path` / `incremental_result_path`）与沙箱隔离可以同时存在，二者不冲突。

### 覆盖不足诊断

当项目没有配置 `pre_run_command`、`regression_command` 或 `incremental_command`，且 verify 发现覆盖不足时，CLI 必须诊断这可能是只运行了局部测试导致，并建议配置 verify 预跑命令。

该诊断不改变 Gate 判定：覆盖不足仍为 FAIL。

### 清空策略

每次完整测试运行前，reporter 应**清空**（truncate）对应阶段的结果文件，确保文件只包含最近一次运行的结果。推荐方式：

- 在测试套件的 `globalSetup` 或等效钩子中清空文件
- 或者 reporter 的初始化阶段写入空文件

两阶段模型下，回归阶段和增量阶段可以写入不同结果文件；如果两个阶段都写入默认 `result_path`，CLI 必须在阶段之间保留快照，确保最终合并结果不会丢失第一阶段覆盖。

### reporter 输出建议
```json
{"id":"UT-S13-01","status":"pass","duration_ms":12,"timestamp":"2026-04-10T10:00:00Z"}
```

当启用沙箱时，reporter 不需要知道沙箱实现细节，但可在错误消息中保留命令上下文，便于 CLI 汇总诊断。

### 兼容性
- 现有 reporter 仍然按原格式工作，不需要新增字段。
- CLI 新增的沙箱执行器不得改变 `test-results.jsonl` 的基本 schema。

### 目录创建

reporter 在写入前应确保 `logos/resources/verify/` 目录存在（`mkdir -p` 等效操作）。

### 分批闭环执行约定（大任务）

当 Phase 3 Step 5 采用“分批生成”时，reporter 仍按一次完整测试运行的口径输出结果，并遵循以下约束：

1. **用例 ID 对齐**：每一批开始前先声明本批覆盖的 `UT-xx` / `ST-xx`，测试代码中写入的 `id` 必须与 `logos/resources/test/*.md` 完全一致
2. **清空策略一致**：无论是否分批，执行“本批完整测试”前都必须先清空结果文件，避免混入旧批次数据
3. **重复 ID 判定**：同一 `id` 在同次运行中出现多条记录（如重试）时，`openlogos verify` 仍以最后一条为准
4. **批次可独立验收**：建议每一批产出后立即运行测试并校验 JSONL，可在批次内尽早发现“只写业务未写测试”或 ID 不匹配问题

## AI 生成 reporter 代码模板

以下是各语言的 reporter 参考实现。AI 在 Phase 3 Step 5（代码生成，由 `code-implementor` Skill 驱动）时，应根据项目的 `tech_stack` 选择对应语言的模板，嵌入到测试代码中。

### 推荐：共享 reporter 文件模式

**不要在每个测试文件里内联 reporter 代码**。多文件项目应创建一个共享工具文件，统一 import：

```
<test-root>/
└── helpers/
    └── reporter.ts    ← 所有测试文件从这里 import
```

这样做的好处：
- 路径配置只有一处，不会因为文件位置不同导致写入路径错误
- 新增测试文件时只需 import，不会遗漏 reporter
- 清空策略（truncate）只在一处维护

### TypeScript (vitest / jest)

````typescript
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const RESULT_PATH = 'logos/resources/verify/test-results.jsonl';
let initialized = false;

function reportResult(
  id: string,
  status: 'pass' | 'fail' | 'skip',
  error?: string,
  durationMs?: number,
) {
  if (!initialized) {
    mkdirSync(dirname(RESULT_PATH), { recursive: true });
    writeFileSync(RESULT_PATH, '');
    initialized = true;
  }
  const record: Record<string, unknown> = {
    id,
    status,
    timestamp: new Date().toISOString(),
  };
  if (durationMs !== undefined) record.duration_ms = durationMs;
  if (error) record.error = error;
  appendFileSync(RESULT_PATH, JSON.stringify(record) + '\n');
}
````

在测试用例中使用：

````typescript
import { describe, it, expect } from 'vitest';

describe('S01: CLI Init', () => {
  it('UT-S01-01: should detect project name from package.json', () => {
    const start = Date.now();
    try {
      const result = detectProjectName('/path/to/project');
      expect(result.name).toBe('my-project');
      reportResult('UT-S01-01', 'pass', undefined, Date.now() - start);
    } catch (e) {
      reportResult('UT-S01-01', 'fail', String(e), Date.now() - start);
      throw e;
    }
  });
});
````

### Python (pytest)

````python
# conftest.py
import json
import os
import time
import re
import pytest

RESULT_PATH = "logos/resources/verify/test-results.jsonl"
_initialized = False


def _ensure_file():
    global _initialized
    if not _initialized:
        os.makedirs(os.path.dirname(RESULT_PATH), exist_ok=True)
        open(RESULT_PATH, "w").close()
        _initialized = True


def _extract_test_id(nodeid: str) -> str | None:
    """Extract UT-S01-01 or ST-S01-01 from test function name."""
    match = re.search(r"(UT|ST)_S\d{2}_\d{2,3}", nodeid)
    if match:
        return match.group().replace("_", "-")
    return None


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when == "call":
        _ensure_file()
        test_id = _extract_test_id(item.nodeid)
        if not test_id:
            return
        record = {
            "id": test_id,
            "status": "pass" if report.passed else "fail",
            "duration_ms": round(report.duration * 1000),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        if report.failed:
            record["error"] = str(report.longrepr)[:500]
        with open(RESULT_PATH, "a") as f:
            f.write(json.dumps(record) + "\n")
````

Python 测试函数命名约定——用下划线替代连字符：

````python
def test_UT_S01_01_detect_project_name():
    result = detect_project_name("/path/to/project")
    assert result["name"] == "my-project"
````

### Go

````go
package testutil

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const ResultPath = "logos/resources/verify/test-results.jsonl"

var (
	once sync.Once
	mu   sync.Mutex
)

type TestResult struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	DurationMs int64  `json:"duration_ms,omitempty"`
	Timestamp  string `json:"timestamp"`
	Error      string `json:"error,omitempty"`
}

func ReportResult(id, status string, durationMs int64, err string) {
	once.Do(func() {
		os.MkdirAll(filepath.Dir(ResultPath), 0o755)
		os.WriteFile(ResultPath, nil, 0o644)
	})
	r := TestResult{
		ID:         id,
		Status:     status,
		DurationMs: durationMs,
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		Error:      err,
	}
	b, _ := json.Marshal(r)
	mu.Lock()
	defer mu.Unlock()
	f, _ := os.OpenFile(ResultPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o644)
	defer f.Close()
	fmt.Fprintf(f, "%s\n", b)
}
````

## Smoke 结果与覆盖预检

部署后 smoke 用例使用同一类 JSONL 结果格式，但默认写入：

```text
logos/resources/verify/smoke-results.jsonl
```

可通过 `logos.config.json.smoke.result_path` 覆盖该路径。每行仍为一个 JSON 对象：

```json
{ "id": "SMOKE-core-01", "status": "pass", "timestamp": "2026-06-28T00:00:00.000Z", "scenario": "cli version" }
```

当提案新增或修改 `logos/resources/test/smoke/*.md`，code 阶段必须同步实现可执行 smoke 闭环：

- `scripts/smoke-*.sh`、`scripts/smoke-*.js` 或等效 smoke runner 必须覆盖新增或修改的 `SMOKE-*` ID。
- runner 必须写入 `smoke-results.jsonl` 或 `smoke.result_path` 指定路径。
- `smoke.command` 必须能执行新增 runner；推荐配置为 `node scripts/run-smoke.js` 统一 dispatcher，由 dispatcher 自动发现并运行 `scripts/smoke-*`。
- `openlogos verify` / code completion gate 可执行 smoke 覆盖预检：若本提案新增 smoke ID 但缺少 runner、reporter 或执行结果，应输出 `smoke_runner_missing`、`smoke_reporter_missing` 或 `smoke_cases_uncovered`，并阻断 code 完成。

推荐项目在根目录提供：

```json
{
  "smoke": {
    "command": "node scripts/run-smoke.js",
    "result_path": "logos/resources/verify/smoke-results.jsonl"
  }
}
```

`scripts/run-smoke.js` 负责发现并顺序运行 `scripts/smoke-*.sh` / `scripts/smoke-*.js`。runner 可通过 `OPENLOGOS_SMOKE_RESULT_PATH` 读取目标结果路径，避免硬编码。

### 目标环境注入与 `target_environment`（environment-registry）

- 项目存在 `logos/environments.yaml` 且执行 `openlogos smoke --env <id|alias>` 时，CLI 以环境变量 `OPENLOGOS_SMOKE_ENV=<解析后的 id>` 运行 `smoke.command`（含沙箱内执行）。登记表不存在时不注入。
- smoke 结果行新增**可选**字段 `target_environment`（string）：runner 写入其**实际验证的**环境 id，通常取自 `OPENLOGOS_SMOKE_ENV`，但必须是 runner 真正访问的目标，不得在访问了其他环境时照抄注入值。

```json
{ "id": "SMOKE-core-01", "status": "pass", "timestamp": "2026-10-14T08:00:00.000Z", "target_environment": "prod" }
```

- 既有字段 `environment`（若 runner 写入）是 runner 自定义的执行环境标签，语义不变，不参与环境证据判定。
- CLI 只就计入门禁的结果行判定环境证据：任一行声明与本次环境不一致 → 登记表存在时门禁 FAIL，原因 `SMOKE_ENV_EVIDENCE_MISMATCH`；全部声明一致 → 记为已声明；存在缺少声明的行 → 门禁按既有判据计算（兼容旧 runner），但本次结果不算「已在该环境验证」。判定细节与账本记录见 `spec/environments.md` §5、§6。
- 本字段不改变 `id` / `status` / `reason_code` / `detail` 的既有语义，也不改变覆盖预检与 skip 统计口径。

## JSONL 结果账本一致性与 Gate 判据

`openlogos verify` 读取 `test-results.jsonl` 时，必须把“结果格式合法”和“统计自洽”作为 Gate PASS 的前置条件。

### skip 结果的有效通过语义

`status:"skip"` 表示用例已被当前测试运行明确处理，但因本机环境、外部依赖、部署目标或平台能力限制未实际执行断言。它不同于未覆盖：

- skip 结果必须由 reporter 显式写入 JSONL；
- skip 计入 `executed_count`，并使对应定义用例计入 covered；
- skip 计入 `skipped_count`，并继续暴露在 `skipped_cases` / 报告的跳过列表中；
- skip 不计入 `failed_count`，也不作为 Gate 失败原因；
- 在计算通过率时，skip 视为有效通过，使用 `(passed_count + skipped_count) / executed_count`。

该语义只适用于合法、已定义、非 `[manual]` 的自动化结果。非法 JSON、未知 ID、manual ID、缺失 `fail.error` 等账本一致性错误仍必须使 Gate FAIL。

### 归一化规则

1. 每行必须是 JSON 对象。
2. 每条记录必须包含字符串 `id` 和 `status`。
3. `status` 只能为 `pass`、`fail` 或 `skip`。
4. `status="fail"` 时必须提供非空 `error`。
5. 同一 `id` 多次出现时，在**合法记录**之间按「同 ID timestamp 去重全序规则」取一条生效记录（contract-self-description，替代旧「最后一条合法记录生效」行序规则）：
   1. 先对该 ID 的每条记录严格解析 `timestamp`（ISO 8601，含时区偏移归一为绝对时刻）；非法格式一律按「缺失」处理；
   2. **该 ID 全部记录时间戳均合法** → 按绝对时刻比较取最新；同一时刻（含不同时区表示的同刻）→ 文件行序后者优先；
   3. **该 ID 存在任一缺失/非法时间戳** → 该 ID 整组退回文件行序 last-wins（等价旧行为——不对不完整证据做时间猜测，对齐宁慢勿错杀原则，也保证旧 reporter 产物零行为变化）。

   去重按 ID 分组独立进行；一个 ID 退回行序不影响其他 ID 按时间戳去重。旧 reporter（完全不写 `timestamp`）的账本对每个 ID 均命中第 3 条 → 与旧版结论逐字节一致，**零行为变化**。实现测试必须覆盖混合情况：乱序追加、缺失+合法混排、非法格式、异时区同刻。
6. 非法记录必须进入诊断集合，不得被静默丢弃后继续 PASS（去重只在合法记录之间进行，不吞非法行）。

### ID 对齐规则

1. 自动化结果 ID 必须与 `logos/resources/test/**/*.md` 中定义的非 `[manual]` `UT-*` / `ST-*` 用例完全一致。
2. 未定义 ID 必须被报告为 `unknown_test_result_id`。
3. `[manual]` 用例不得写入 JSONL；若出现，应报告为 `manual_test_result_id`。

### 统计不变量

去重（按上文「同 ID timestamp 去重全序规则」）并过滤为合法自动化结果后，verify 汇总必须满足：

```text
passed_count + failed_count + skipped_count == executed_count
executed_count <= defined_count
covered_count + uncovered_count == defined_count
```

通过率必须按有效通过数计算：

```text
effective_passed_count = passed_count + skipped_count
pass_rate_pct = executed_count > 0 ? round(effective_passed_count / executed_count * 100) : 0
```

若 `failed_count == 0`，还必须满足：

```text
passed_count + skipped_count == executed_count
pass_rate_pct == 100
```

任一不变量失败时，`gate.result` 必须为 `FAIL`，`gate.reason` 必须非空，推荐使用 `result_ledger_inconsistent` 或具体错误码。

**与去重规则的关系（contract-self-description）**：上述守恒不变量与「JSON 输出建议」的 `consistency` 契约均在**去重后**的结果集上计算；去重规则的变更只影响「同一 ID 多条记录取哪一条」，**不改变 `consistency` 既有契约**（字段形态、`ok` 判据、FAIL 语义均不变）。极端场景（乱序追加的 jsonl）下 verify 结论可能与旧版不同——这正是改造目的：取真正最新的执行证据，而非文件末尾的陈旧证据。

### JSON 输出建议

`openlogos verify --format json` 应输出可选 `consistency` 字段，供自动化消费方展示诊断：

```json
{
  "consistency": {
    "ok": false,
    "reasons": ["unknown_test_result_id", "result_count_mismatch"],
    "unknown_result_ids": ["UT-S13-GHOST"],
    "manual_result_ids": [],
    "invalid_results": [
      {"line": 3, "id": "UT-S13-X", "reason": "invalid_status"}
    ],
    "count_mismatches": ["passed_failed_skipped_ne_executed"]
  }
}
```

当 `consistency.ok === false` 时，任何客户端都必须把 verify 视为未通过；不得仅因 `failed_count == 0` 和 `uncovered_count == 0` 继续推进 archive、deploy 或 release。

## 与其他规范的关系

| 规范 | 关系 |
|------|------|
| `test-writer` Skill | 定义用例 ID（`UT-xx` / `ST-xx`），是 JSONL 中 `id` 字段的来源 |
| `test-orchestrator` Skill | API 编排测试也可产出同格式 JSONL |
| `directory-convention.md` | 定义 `logos/resources/verify/` 目录位置 |
| `logos.config.json` | `verify.result_path` 可覆盖默认路径 |
| `openlogos verify` 命令 | 读取此格式文件，生成验收报告 |

## 切片 checkpoint 的结果集合与 pending 语义

### 三个集合

切片感知 verify 必须在读取 reporter JSONL 前确定以下互斥/包含关系：

- `eligible_test_ids`：本轮必须有合法最终结果、参与覆盖率与 Gate 的测试。
- `pending_test_ids`：属于未来未确认切片，尚不要求结果且不进入分母。
- `defined_test_ids`：已合并测试规格中全部非 manual ID，满足 `eligible ∪ pending ⊆ defined`。

checkpoint 下 eligible 按 manifest 冻结的验收范围 `verify_scope`（`spec/test-slice-manifest.md` §3、§7）分支：

- `baseline`（含旧 manifest 缺该字段）：eligible 为基线回归、已确认切片与 attempted slice 的并集；
- `owned`：eligible 只为已确认切片与 attempted slice 的 owned tests 并集，基线回归不在 eligible，既不计入分母也不计 uncovered，由 final 统一回归。

两种范围下 pending 都为其余 owned tests。final 下 eligible 等于全部 defined，pending 为空，与范围无关。

checkpoint 执行预跑命令前，verify 除注入 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`（本轮 eligible）外，再注入 `OPENLOGOS_VERIFY_SLICE_SCOPE=baseline|owned`；final 不注入后者。runner 可据此只运行覆盖 eligible 的测试，测试 ID 到测试文件的映射由各项目 runner 自行决定。**runner 只能输出 eligible 内的结果**这条规则对两种范围相同：`owned` 范围下输出的基线 ID 与 pending ID 一样按 `result_outside_eligible_scope` 处置。

### reporter 处理

1. reporter 格式、合法 `status`、timestamp 去重与手工用例排除沿用既有规则。
2. 覆盖率只按 eligible 计算：

```text
covered = eligible ∩ latest_result_ids
uncovered = eligible − covered
coverage = |covered| / |eligible|
```

3. pending 没有结果是合法状态，不生成 pass/skip 行，不进入 uncovered。
4. reporter 若意外输出 pending ID，保留该行供诊断但不得使未来切片提前确认；严格模式以 `result_outside_eligible_scope` 失败。
5. 未在 defined 中的结果仍按既有 unknown ID 硬门失败。

### 基线回归集合

`baseline_test_ids = defined_test_ids − manifest_owned_test_ids`。验收范围为 `baseline` 时，它在每个 checkpoint 都属于 eligible，用于阻止当前切片破坏未触达能力；为 `owned` 时，它不属于任何 checkpoint 的 eligible，只在 final 中被验收——用例规模达到阈值的项目以此换取每片验收的提速，回归在 final 一次发现。manifest owned 集合必须只包含本提案新增或修改的测试 ID；不得把全项目测试都分配到切片以逃避基线定义。

### checkpoint/final 报告

验收报告新增 mode、attempted slice、验收范围（`baseline` / `owned`；`owned` 时注明「基线回归由 final 承担」）、eligible/pending 数量和 ID 清单、manifest fingerprint、confirmed slices。checkpoint PASS 明确标注“切片检查点通过，非最终验收”，不得产生最终 `VERIFY_PASS`。final 报告继续给出全量覆盖率与 Gate 结论。多模块项目中，验收范围为 `owned` 的 checkpoint 不写、不改各 initial 模块的模块验收报告（模块报告按完整用例子集统计，只验收 owned 时会把基线误报为未覆盖，见「多模块项目的模块验收报告与模块冒烟报告」）；`baseline` 范围的 checkpoint 与 final 照旧写。

### checkpoint 账本

`SLICE_CHECKPOINTS.jsonl` 每行至少包含：`schema`、`slice_id`、`manifest_sha256`、`result`、`eligible_test_ids_sha256`、`timestamp`。有效完成只采信当前 manifest 哈希的最新 PASS；相同 identity 的重复 PASS 幂等。FAIL 可留作审计，但 attempted identity 由“缺少有效 PASS 的首片”恢复。

### 安全边界

- pending 不是 reporter status，允许的结果状态枚举不新增 `pending`。
- checkpoint 不降低非法状态、unknown ID、重复结果和 100% eligible coverage 硬门。
- final 不允许 pending，不接受部分结果。
- manifest 恢复态不读取旧 JSONL 计算 Gate，不生成验收报告假失败。

## 沙箱复用配置

> 归属「`verify.sandbox_mode` / `smoke.sandbox_mode`」；来源变更 verify-sandbox-reuse-0-16-1（决策 C01、C02），功能规格 §2.91。本节为 `verify` / `smoke` 两个新增可选配置字段的权威定义；`spec/logos.config.schema.json` 的 `verify` / `smoke` 节点未限制额外属性，新字段不会被拒绝，schema 补录另案处理。

### 字段

| 字段 | 所在节点 | 类型 | 默认 | 说明 |
|---|---|---|---|---|
| `sandbox_reuse` | `verify`、`smoke` | boolean | `true` | 仅在 `sandbox_mode` 为 `auto` / `always` 时生效。`true`：每项目一份持久沙箱，跨运行留存并增量同步；`false`：一次性临时沙箱（引入复用前的行为） |
| `sandbox_cache_paths` | `verify`、`smoke` | string[] | `[]` | 工作区相对路径。命中的路径归沙箱所有：同步时不从工作区复制、不删除，跨运行留存（如 Rust 的 `target`、`src-tauri/target`） |

```json
{
  "verify": {
    "pre_run_command": "cargo test && node scripts/report.js",
    "sandbox_mode": "auto",
    "sandbox_root": "/Volumes/BuildWork/openlogos-sandbox",
    "sandbox_reuse": true,
    "sandbox_cache_paths": ["src-tauri/target"]
  }
}
```

### 约束

- 默认值在读取时补齐；`openlogos init` / `sync` 不向配置写入这两个字段。
- `sandbox_cache_paths` 的非法项（绝对路径、规范化后含 `..`、为空或项目根、与任一白名单结果路径相同 / 为其祖先 / 为其后代）被忽略并在 `sandbox.diagnostics` 中给出诊断，按普通镜像路径处理。**结果文件不得放在缓存路径内**——reporter 写入的结果文件必须随每次同步被工作区状态覆盖，才能保证回收的是本次结果。
- 缓存路径**不豁免**写入审计：`sandbox_deny_workspace_write=true` 时，命令对缓存路径的写入与其他非白名单写入同口径（`auto` 告警、`always` 失败）。需要在 `always` 下使用缓存路径的项目，应让构建产物写到工作区之外（如 cargo 的 `CARGO_TARGET_DIR`）。
- reporter 不需要感知复用：清空策略不变，每次完整测试运行前仍应清空对应阶段的结果文件。verify 在执行预跑命令前清空结果文件，清空后的状态经同步进入沙箱。
- 复用不改变 `test-results.jsonl` 的 schema 与门禁判据。

## 按模块限定 verify 范围的运行约定（module-scoped-verify）

本节约定多模块项目按模块限定 verify 范围时，CLI 执行哪些命令、怎样收集结果、核对哪些用例。范围 M 的计算与回落规则见功能规格 §2.96；`modules[].paths` 见 `spec/logos-project.md`「paths 模块字段」；`verify.modules.<模块 id>` 见 `spec/logos.config.schema.json`。

### 启用条件

按顺序取第一条成立的：

1. 传入 `openlogos verify --all` → `scope.mode = "all"`，按全部已登记模块执行与核对。
2. 项目只有一个模块，或没有任何模块声明非空 `modules[].paths` → **未启用**：本节以下规则全部不适用。verify 走前文「运行约定」的现有流程，命令只用项目级，不注入 `OPENLOGOS_VERIFY_MODULES`，不过滤用例与结果，与引入前逐字节一致。
3. 其余情况 → 计算范围 M，结果为 `scope.mode = "module"` 或 `"fallback-full"`。回落全量时按全部已登记模块执行与核对，仍适用本节的命令选择规则（与「未启用」不同）。

### 执行哪些命令

1. 按 `logos-project.yaml` 中的模块顺序遍历范围内的模块。某模块配置了 `verify.modules.<id>`，就用它的命令组；否则用项目级命令组（`verify.pre_run_command`，或 `verify.regression_command` / `verify.incremental_command`）。`verify.modules.<id>` 的三个字段都缺省，视为未配置模块级命令。
2. 三个字段取值完全相同的命令组视为同一组，服务多个模块时只执行一次，按首次出现的顺序执行。
3. 每个命令组内部沿用前文的两阶段优先规则（与项目级相同，review F4）：命令组中 `regression_command`、`incremental_command` 任一存在，就按 regression → incremental 执行已配置的阶段，同组的 `pre_run_command` 作为兼容配置保留、记为跳过（`pre_run.commands[]` 中 `stage:"pre_run"`、`status:"skipped"`，并给出兼容跳过诊断）；只有两阶段命令都不存在时才单阶段执行 `pre_run_command`。
4. 全部命令组都执行完才判定。任一命令非零退出 → 既有的 `pre_run_failed` 门禁原因；JSON 的 `pre_run.commands[]` 每条带 `modules`（该命令组服务的模块 id 数组），诊断点名失败命令所服务的模块。
5. `verify.modules` 中出现未在 `logos-project.yaml` 登记的模块 id 时，产生警告诊断 `verify_module_unknown`，忽略该项，不影响门禁。

### 注入的环境变量

- `OPENLOGOS_VERIFY_MODULES`：本条命令所属命令组服务的模块 id，以逗号分隔。runner 可据此只执行这些模块的测试。
- `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`：照旧注入（切片感知 verify），取值为与范围内用例求交后的集合。
- 未启用模块范围时不注入 `OPENLOGOS_VERIFY_MODULES`。

### 结果收集与合并

每个阶段执行前清空其结果文件，执行后收集内容。全部命令组、全部阶段收集到的内容，按「归一化规则」第 5 条的同 ID 去重全序规则合并，写入 `result_path`。这与两阶段模型使用同一套机制，不另立第二套合并语义。多个命令组都写默认 `result_path` 时，CLI 必须在命令组之间保留快照，与两阶段模型对默认路径的要求相同。

### 核对哪些用例

- **用例归属**：测试规格文件按文件名 `<module>-` 前缀归属模块，前缀按已登记模块 id 最长匹配。前缀属于范围 M 的文件计入；文件名不带已登记模块前缀的视为全局用例，始终计入。verify 的用例提取与切片 manifest 的用例提取使用同一口径。
- **范围外结果**：结果行的 `id` 属于范围外模块的用例时忽略：不判为未定义（unknown）、不判为 `outside_eligible`、不计入任何统计；被忽略的行数写入 `scope.out_of_scope_result_count`。
- **范围内**的定义、覆盖、失败与 skip 判据与「JSONL 结果账本一致性与 Gate 判据」完全相同，只是计算对象换成范围内用例集。
- `scope.mode` 为 `"all"` 或 `"fallback-full"` 时，范围内用例即全部用例，`out_of_scope_result_count` 为 0。

### 与 reporter 的关系

reporter 不需要感知模块范围：照常写全部执行过的用例结果，范围裁剪由 CLI 完成。reporter 写出了范围外模块的结果行也不会造成失败，只计入 `out_of_scope_result_count`。

## 按模块限定 smoke 范围的运行约定（module-scoped-env-smoke）

> 来源变更 module-scoped-env-smoke（决策 C01），功能规格 §2.98；启用条件、目标模块与部署上下文的权威定义见 `spec/environments.md` §14。本节约定 smoke runner 与结果文件在按模块区分启用时的行为，对未启用的项目（单模块；多模块但没有任何模块声明 `deployment_gates.<module>.environments` 且没有 `smoke.modules`）不产生任何变化。

### 应覆盖用例

- **独立 smoke 模块**（smoke-scope-isolated-modules，决策 C01；proposal-r1 F1）：已登记模块在 `smoke.modules.<m>` 中显式配置了有效的非空 `command`，即本次实际执行该模块自己的命令（`scope.command_source="module"`）。只写 `result_path` / `report_path`、空对象或缺省 `command` 的模块仍执行项目级 runner，不是独立模块。
- 目标模块为 m 时，规格文件按文件名前缀归属模块（已登记模块 id 最长匹配），最终应覆盖集合 S：
  - m 是独立 smoke 模块：S = `m-` 前缀规格中的 `SMOKE-*` ∪ C；
  - m 不是独立 smoke 模块：S = 全部 smoke 规格中的 `SMOKE-*` − 前缀属于其他独立 smoke 模块的规格中的 `SMOKE-*` ∪ C。
  - 不带任何已登记模块前缀的规格只计入非独立模块；独立模块自己的 smoke 规格必须带模块前缀。没有任何独立模块时，每个模块的 S 都是全部规格加 C。
  - C 为**提案上下文**下本提案新增或修改的 smoke 用例（可能属于其他模块前缀或不带前缀的规格）；**版本上下文**下 C 为空——不从无关的活跃提案读取变更用例，也不回退读取全局 guard。覆盖预检与门禁只用 S 这一个集合。
- 独立模块的 runner 只需产出本模块前缀用例与 C 的结果；非独立模块所用 runner（通常为项目级）须覆盖不带前缀的规格，其中用例的 fail 照常阻断门禁，不会被当作范围外结果忽略。
- 不限定模块（`scope.mode=project`）时用全部 smoke 规格（现状）。
- 覆盖预检（`smoke_runner_missing` / `smoke_reporter_missing` / `smoke_cases_uncovered`）只按本次实际所用命令与本次应覆盖用例判定。

### 执行哪条命令

- `logos.config.json` 的 `smoke.modules.<m>` 存在时用其 `command`、`result_path`、`report_path`，未写的字段回落项目级 `smoke.*`；不存在时用项目级配置。沙箱字段（`sandbox_mode` 等）一律沿用项目级。
- 同一次 `openlogos smoke` 只执行一条命令（目标模块的或项目级的），不跨模块串行执行。

### 注入的环境变量

- 目标模块确定时注入 `OPENLOGOS_SMOKE_MODULE=<m>`，不限定模块时不注入。runner 可据此只运行本模块的用例，但 CLI 的判定不依赖 runner 是否读取该变量。
- `OPENLOGOS_SMOKE_ENV`（目标环境注入，见上节）与 `OPENLOGOS_SMOKE_RESULT_PATH` 的规则不变；结果路径取本次所用配置。

### 结果收集

- 运行命令前清空本次所用的结果文件（既有行为），因此计入门禁的行都来自本次运行。
- 结果行的 ID 在 smoke 规格中已定义、但不在 S 中时忽略不计，计数进 `scope.out_of_scope_result_count`；在 S 中的结果（含属于其他模块前缀的变更用例）一律保留，参与覆盖与失败判定；未定义 ID 照旧按既有规则判定。
- 结果行格式、`target_environment` 与环境证据判定（`spec/environments.md` §6）不变。

## 多模块项目的模块验收报告与模块冒烟报告（module-scoped-phase-reports）

> 来源变更：module-scoped-phase-reports（决策 C01；proposal-r1 F3 处置）。功能规格 §2.99；完成判据的消费方见 `spec/flow-spec.md` §9；模块部署报告见 `spec/environments.md` §14.9。

### 适用范围

只在 `logos-project.yaml` 登记了两个及以上模块的项目中、只为 `lifecycle: initial` 的模块写入。单模块项目与 launched 模块不写；共用的 `acceptance-report.md`、`smoke-report.md` 照旧写入，内容与 Gate 判定不因模块报告而变化；共用报告的写入时机自 verification-history 起统一为最终门禁之后（见「验收历史留存（verification-history）」），模块报告仍在共用报告最后一次写入之后写出。

### 文件与格式

- 模块验收报告：`logos/resources/verify/<m>-acceptance-report.md`；模块冒烟报告：`logos/resources/verify/<m>-smoke-report.md`。每次写入整份覆盖。
- 格式与对应共用报告相同（标题、Summary 表、失败 / 跳过 / 未覆盖清单），统计只按该模块的用例子集。Summary 表新增一行「模块 / Module」（紧接表头分隔行，作为第一行数据），值为模块 id。
- Gate 行固定为 `| **Gate 3.5** | **PASS** |` / `| **Gate 3.8** | **FAIL** |` 形式，与语言无关。消费方只读「模块」行与 Gate 行判定完成：模块报告须是普通文件、「模块」行的值等于目标模块、Gate 行为 PASS；文件缺失或不是普通文件、无 Summary 表、缺「模块」行或值不匹配、缺 Gate 行、Gate 为 FAIL 均为未完成，不做全文匹配（delta-r1 F1）。
- **保留路径**（delta-r1 F1）：多模块项目中，`logos/resources/verify/<id>-acceptance-report.md`、`<id>-deployment-report.md`、`<id>-smoke-report.md`（`<id>` 为任一已登记模块）只由模块报告 writer 写入。共用冒烟报告的配置路径（`smoke.report_path`，或目标模块的 `smoke.modules.<id>.report_path` 覆盖 / 回落后的取值）解析为任一保留路径时，共用报告改写到默认路径 `logos/resources/verify/smoke-report.md`，`diagnostics` 给出警告 `smoke_report_path_reserved`，JSON `report_path` 为实际写入路径，门禁不受影响。单模块项目不设保留路径。
- **原子发布**（delta-r1 F2）：模块报告先在同目录写完整临时文件，再重命名替换正式路径；写入失败时正式路径保持写入前的状态。

### 模块验收报告

- **写入对象**：本次 verify 覆盖的 initial 模块——范围未启用、`--all`、`fallback-full` 时为全部已登记模块中的 initial 模块；`module` 模式时为范围 M 中的 initial 模块。未覆盖模块的已有报告保持不动。
- **用例子集 U(m)**：m 前缀测试规格中的用例 ∪ 不带已登记模块前缀的测试规格中的用例，文件判据与「按模块限定 verify 范围的运行约定」中范围 M={m} 时相同。本提案的变更用例只在属于这些规格时计入。U(m) 为空时不写。手工用例的排除规则与共用报告相同。
- **模块 Gate**：以下全部成立才为 PASS：
  1. U(m) 内零失败、零未覆盖；
  2. 带 `modules` 的预跑命令组非零退出时，只计入该组 `modules` 中的模块；不带 `modules` 的预跑命令（范围未启用时的项目级命令）非零退出，计入每个被覆盖模块；
  3. 无法按用例或命令组归属的拒绝——结果账本不自洽、未定义结果 ID、沙箱判定失败、切片核验失败——计入每个被覆盖模块；
  4. **verify 环境预检类原因**（verify-self-sufficient-cases，功能规格 §2.106.7A）——`verify_requirements_invalid`、`acceptance_requirement_undeclared`、`verify_env_not_ready` 任一命中时，本次没有执行测试，计入每个被覆盖模块；诊断中只属于某些模块的 check 失败，在这些模块的报告里点名，其余被覆盖模块的报告写明「本次未执行测试」；
  5. **用例分层错误**（verify-self-sufficient-cases）——`tier_mismatch_cases` 中属于 U(m) 的 ID 计入 m，不属于的模块不受影响；
  6. **测试变更集无效**（`test_change_set_invalid`，verify-self-sufficient-cases）——计入每个被覆盖模块。
- **预检失败时的写法**：不读取任何结果文件，不计算子集统计；每个被覆盖模块的报告整份覆盖为 FAIL：Summary 表「模块」行照常，计数显示「未执行」，Gate 行为 FAIL，正文写明原因与缺失项。旧的 PASS 报告因此被撤销。
- **写入时机**：全部门禁（含沙箱改判）裁决之后、verify 输出最终结果之前；预检类原因判 FAIL 属于已算出 Gate，照常写入；在算出 Gate 之前就中止时不写。切片 checkpoint 下的写入边界不变。
- runner 无需为模块报告做任何改动：子集统计与归属只使用既有结果行、`pre_run.commands[].modules` 与预检诊断中的归属模块。

### 模块冒烟报告

- **写入对象**：
  - 按模块区分未启用（`spec/environments.md` §14.1）：每个 initial 模块各写一份，用例子集即全部 smoke 规格（内容即项目级结果）；
  - 已启用且目标模块确定（`scope.mode=module`）为 initial 模块 t：写 t 的报告，用例子集为本次应覆盖集合 S(t)（「按模块限定 smoke 范围的运行约定」）；
  - 已启用但不限定模块（`scope.mode=project`），或目标模块为 launched 模块：不写。
- **Gate**：与本次 Gate 3.8 相同；PASS 与 FAIL 都写。smoke 在算出 Gate 之前就以错误退出时不写。
- **写入次序**：在共用报告的最后一次写入（含环境证据收尾按最终结论重写）之后写入，Gate 取最终结论。
- `SMOKE_PASS` / `SMOKE_FAIL`、账本 smoke 行与 smoke JSON 不变。

### 写入白名单

verify 与 smoke 的沙箱允许写入路径分别扩展到本次要写的 `<m>-acceptance-report.md`、`<m>-smoke-report.md`，其余规则不变。

## 验收历史留存（verification-history）

> 来源变更：verification-history（决策 C01～C04；proposal-r1 F1～F5、proposal-r2 F1/F2/F4、proposal-r3 F2 处置）。功能规格 §2.104；目录约定见 `spec/directory-convention.md`「验收历史目录（verification-history）」；JSON 契约见 `spec/cli-json-output.md`「`openlogos history` 命令组与 verify / smoke 的 history 字段（verification-history）」。

### 与最新结果文件的关系

- 最新结果文件（`verify.result_path`、两阶段的 `regression_result_path` / `incremental_result_path`、smoke 的有效 `result_path`）与共用报告照旧每次覆盖写入，供门禁判定、流程派生与宿主读取；本节不改变它们的路径、格式与 reporter 写法。
- 历史另行写入，每次运行一条、写入后不再改写；runner 与 reporter 不感知历史，也无权写历史目录。

### 一次运行的起止

- 起点：命令通过用法、配置与前置拒绝检查后，在执行第一个预跑 / 两阶段命令、运行 smoke 命令或开始读取结果文件之前。
- 终点：同一次调用的最终门禁处（verify 在 smoke 覆盖预检与沙箱裁决之后；smoke 在沙箱失败改判与环境证据改判之后），或进入执行后的既有错误早退处（`NO_TEST_RESULTS`、`NO_TEST_CASES`、`NO_SMOKE_RESULTS`、`NO_SMOKE_CASES`；`outcome: "aborted"`，沿用既有错误信封、错误码与退出码，报告字段缺省）。结果文件存在但为空不属于早退，照常判定。
- 进入执行前的拒绝（用法错误、配置缺失、guard 拒绝、结果路径运行锁冲突 `RESULT_PATH_BUSY`）不记录。
- 共用 `acceptance-report.md` 与共用 smoke 报告在最终门禁之后由同一份最终数据渲染一次，字节保留在进程内存中，分别写入共用报告路径与报告快照；不得从共用报告路径回读快照（该路径不在运行锁集合内，可能已被另一次运行覆盖）。

### 三层数据与字段边界

| 层 | 位置 | 内容 |
|---|---|---|
| 中央索引 | `logos/resources/verify/history/<run_id>.json` | 只含结构化白名单字段（功能规格 §2.104.3）：`schema`、`run_id`、`kind`、`started_at`、`finished_at`、`outcome`、`gate`、`error_code`、`proposal`、`module_scope`、`verify_mode`、`attempted_slice_id`、`environment`、`deploy_id`、`counts`、`failed_ids`、`skipped_ids`、`uncovered_ids`、`result_source`、`commit`、`cli_version`、`raw_location`；不含任何自由文本 |
| 提案完整记录 | `logos/changes/<slug>/verify-runs/<run_id>/` | `record.json`、`results.jsonl`、`report.md`；只在有活跃提案时写 |
| 本机原文 | `logos/.openlogos-runtime/verify-runs/<run_id>/` | `report.md`、`results-raw.jsonl`；只在有活跃提案且 `verify.history.raw_in_proposal: false` 时写 |

- 自由文本字段：结果行中 `id`、`status`、`scenario`、`timestamp`、`duration_ms`、`environment`、`target_environment` 以外的全部字段（典型为 `error`、`detail`、`evidence`、`not_applicable_reason`、`missing_requirements`），以及报告正文。
- `verify.history.raw_in_proposal` 缺省 `true`：提案完整记录的 `results.jsonl` 为本次实际采集的完整结果、`report.md` 为报告快照；为 `false` 时提案完整记录只保留结构化字段，自由文本字段（按用例 ID 对应）与报告快照写到本机原文层。
- 没有活跃提案时只写中央索引（`proposal: null`、`raw_location: "none"`）。

### 结果来源

- `result_source: "executed"`：本次调用执行了预跑 / 两阶段命令或 smoke 命令。
- `result_source: "reused"`：本次调用只读取了既有结果文件。
- `result_source: "none"`（verify-self-sufficient-cases，功能规格 §2.104.3、§2.106.5）：verify 因环境预检类原因（`verify_requirements_invalid`、`acceptance_requirement_undeclared`、`verify_env_not_ready`）判 FAIL，本次既未执行任何命令，也未读取任何结果文件。此时记录为 `outcome: "completed"`、`gate.result: "FAIL"`、`gate.reason` 为该原因；`counts` 各项为 null；`failed_ids` / `skipped_ids` / `uncovered_ids` 为空数组。报告快照沿用「三层数据与字段边界」的留存策略：无活跃提案时只写中央索引；有活跃提案且 `verify.history.raw_in_proposal` 为 `true` 时，提案完整记录写 `record.json` 与 `report.md`；为 `false` 时，提案完整记录只写 `record.json`，`report.md` 写本机原文目录。任何情况下都不写本轮 `results.jsonl` / `results-raw.jsonl`，上次留下的结果文件不被复制或引用。
- 读取兼容：0.16.24 起的读取方接受三个取值；更早版本的读取方把含 `"none"` 的记录当作损坏记录跳过并提示，不影响其他记录。

### 结果路径运行锁

- 锁集合为一次运行实际会截断或读取的全部有效结果路径，统一解析为真实路径；首个截断或读取之前按路径排序一次性获取，全有或全无；任一路径被占用即以 `RESULT_PATH_BUSY`（退出码 2）拒绝，不截断任何结果文件。只读取既有结果的运行同样参加。锁文件位于 `logos/.openlogos-runtime/result-locks/`，持有进程不存在时视为过期并回收。

### 写入失败、入库与合并

- 历史任一层写入失败只在 history 元数据中置 `write_status: "failed"` 与 `write_error`（`verification_history_write_failed`），不改变门禁、退出码与标记。
- CLI 不执行 git 操作；按运行各写一个文件，不同分支的记录互不重名，普通合并即保留两边。历史路径被忽略规则命中时，由流程提交或用户以 `git add -f` 纳入。
- 本约定之前的运行不回填。

## verify 环境要求声明、对账与预检（verify-self-sufficient-cases）

不需要人参与的用例可以对机器提要求，但要求必须声明在 `logos/logos.config.json`，并在执行任何预跑命令前由 verify 检查（功能规格 §2.106.4、§2.106.5）。

### 声明

```json
{
  "verify": {
    "requirements": {
      "env": ["DB_URL"],
      "commands": ["docker"],
      "checks": [{ "name": "db-ready", "command": "node scripts/check-db.mjs" }]
    },
    "modules": {
      "backend": { "requirements": { "commands": ["mvn"] } }
    }
  }
}
```

- `env`：变量名数组，要求变量存在且值非空。
- `commands`：命令名数组（不含路径与参数），要求能在 `PATH` 上解析到可执行文件。
- `checks`：`{name, command}` 数组，`name` 唯一且匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`；以 shell 执行 `command`，限时 60 秒内退出码为 0。检查命令应跨平台可执行（推荐用 `node` 脚本）。
- 生效集合：
  - 未启用模块范围时，生效集合即项目级 `verify.requirements`。
  - 启用时，先沿用既有命令组选择得到本次实际执行的命令组，只对这些命令组服务的模块 m 求 E(m)（被选择器跳过、没有任何命令的模块不检查）：项目级加上 `verify.modules.<m>.requirements`，m 的同名 check 只替换 m 自己的那一项。
  - 再合并：`env`、`commands` 取并集；名称与命令都相同的 check 合并为一项；名称相同、命令不同的 check 分别执行，诊断带归属模块（功能规格 §2.106.4）。
- 「实际执行的命令组」只用于选择模块级要求：本次没有任何预跑命令执行时，模块级要求不检查，显式声明的项目级要求仍照常预检，缺项即在读取任何结果文件前判 `verify_env_not_ready`（结构校验与对账照常）。
- 不过滤未声明的环境变量：预跑命令照旧继承调用时的全部环境。
- 执行环境：
  - `env` 与 `commands` 按预跑命令将继承的环境与 `PATH` 判定。
  - `checks` 经与预跑命令同一个沙箱执行器执行：同一 `sandbox_mode` 与复用配置，工作目录为（沙箱工作副本中的）项目根，写回白名单为空，注入 `OPENLOGOS_VERIFY_MODULES` 为归属模块。
  - 隔离失败按既有沙箱模式规则处理（`always` 判 FAIL 且不执行预跑；`auto` 按既有规则降级）。
  - 无隔离（`sandbox_mode: off` 或 `auto` 降级）时，检查命令与预跑命令一样在源工作区的项目根执行，不承诺源工作区保护；因此**检查命令必须只读**，不创建、不修改文件。verify 以 `data.requirements.isolation`（`"sandboxed"` / `"unisolated"`）与验收报告标注本次检查是否隔离。
- 平台限定用例的前置工具写成 `checks`，触发条件必须与用例完整适用条件同源（同一判定）：适用条件任一不成立时直接退出 0，用例写平台跳过。

### 写入责任

proposal「验收标准」的「自动验收环境要求」以 `env:<名>` / `command:<名>` / `check:<名>` 条目记录预期配置差异；merge 后的 `[code]` 实现任务在活跃提案内把它们写入 `verify.requirements`。`.gitignore`、`.git/info/exclude` 与 `logos.config.json` 的 `guard` 字段不在此列，仍只能经 `openlogos ignore|exempt` 修改。

### 执行顺序

在任何预跑命令之前依次执行，前一步失败不再执行后一步：

1. 结构校验：类型不符、`name` 重复或非法 → `verify_requirements_invalid`。
2. 对账（仅当有活跃提案且「自动验收环境要求」列出条目）：每个条目都必须出现在生效集合对应字段 → 否则 `acceptance_requirement_undeclared`。
3. 预检：逐项检查生效集合 → 缺任一项 `verify_env_not_ready`，诊断逐项列出 `{kind, name, detail}`；**只写变量名，不写变量值**；check 的 `detail` 只写退出码或「超时」，不写命令输出。

任一步失败时：

- 门禁 FAIL，不执行任何预跑命令，不截断、也不读取任何结果文件，上次留下的账本不成为本轮证据；
- 本次覆盖的 initial 模块验收报告改写为 FAIL（见「多模块项目的模块验收报告与模块冒烟报告」→「模块验收报告」）；
- 验收历史记 `result_source: "none"`（见「验收历史留存」→「结果来源」）。

## verify 跳过分类（verify-self-sufficient-cases）

本节补充「skip 结果的有效通过语义」：对**严格判定集合**中的 UT/ST 收紧 skip，其余口径不变（功能规格 §2.106.6）。

严格判定集合取自活跃提案 `SPEC_MERGED.test_change_set.changed_test_ids`，必须经正式读取器校验（与 `spec/test-slice-manifest.md` §13.3 的同一读取器）。按读取状态分三种：

- 尚未 merge（无活跃提案或没有 `SPEC_MERGED`）：严格集合为空，只出警告；
- 读取器判有效：取其集合，读取器认可的合法空集即为空集；
- 已有 `SPEC_MERGED` 但读取器判无效：拒绝采信、不推导为空集，报 `test_change_set_invalid`，门禁 FAIL、不得产生最终 PASS。

切片 checkpoint 模式下与可计入集合求交，pending 用例没有结果仍合法。

| 情形 | 判定 | 输出 |
|---|---|---|
| 严格集合内，`reason_code === "platform-unavailable"` 且 `detail` 非空 | 平台跳过，放行 | `platform_skipped_cases: [{id, detail}]`，报告单独列出 |
| 严格集合内，其余 skip（无 `reason_code`、取其他值、`detail` 缺失或为空） | 用例分层错误，门禁 FAIL | `tier_mismatch_cases`，`gate.reason = "case_tier_mismatch"`（优先级见功能规格 §2.106.7） |
| 严格集合外（存量）或无活跃提案，非平台 skip | 口径不变（有效通过） | 警告 `unclassified_skipped_cases`，不改门禁与退出码 |

- 三个子集都是 `skipped_cases` 的子集；统计不变量不变。
- 用例分层错误的修复方式只有两种：准备好环境并声明到 `verify.requirements`，或把用例改标 `[manual]`。
- 本节不适用于 SMOKE；smoke 的跳过规则见功能规格 §2.48，不变。

## 平台跳过原因的 reporter 写法（verify-self-sufficient-cases）

reporter 写平台跳过时，按用例**实际的**不适用条件写 `reason_code` 与 `detail`，不能把环境缺失写成平台跳过：

- 用例声明自己的适用条件（平台、执行身份、平台能力），条件不成立时 reporter 写 `{"status":"skip","reason_code":"platform-unavailable","detail":"<需要的条件>"}`。
- 适用条件全部成立、但缺少前置工具时，不得跳过：该工具应在 `verify.requirements.checks` 中声明（触发条件与用例同源），由预检报 `verify_env_not_ready`。
- TypeScript（vitest / jest）：共享 reporter 提供登记平台跳过原因的入口（例如测试文件以 `platformSkip(id, detail)` 登记、reporter 在写 skip 行时读取），避免用框架的通用 `skipIf` 丢失原因；Python（pytest）可用 `pytest.mark.skipif(..., reason=...)` 并约定 `platform-unavailable:` 前缀映射为 `reason_code`；Go 在 `t.Skip` 消息中使用同一前缀。具体写法以各语言模板为准，判据以本节与「verify 跳过分类」为准。

## Smoke 人工用例与冒烟阶段人工验收（smoke-manual-acceptance）

> 来源变更：smoke-manual-acceptance（功能规格 §2.107）。环境开关、账本记录、待验收清单与门禁的权威定义见 `spec/environments.md` §15；本节只约束测试规格与 smoke 结果文件。

### 首格读法

- smoke 规格的首格读法与 UT/ST 同源：`| SMOKE-<…> |` 为自动用例，`| SMOKE-<…> [manual] |` 或 `| SMOKE-<…> [manual/<平台>] |` 为人工用例。
- 两种行都计为「表格用例行」；一份文件只要有任一表格用例行，就不退回全文扫描。
- 人工 SMOKE 不计入自动 defined 集合与覆盖率，不出现在 `uncovered_cases`，不要求 runner，不进入本提案变更用例的必要证据判定（「smoke skip 统计口径」）。

### 结果文件

- runner 不得为人工 SMOKE 写结果行；出现即门禁 FAIL，诊断 `manual_smoke_result_id`。
- 人工结果不写进 `smoke-results.jsonl`，由 `openlogos accept` 写进本机部署账本（`kind=manual`）。

### 全人工项目

- 自动 SMOKE 用例为零、存在人工用例（任意 UT / ST / SMOKE）时，smoke 的自动阶段视为空通过：不要求 runner 与结果文件，不报 `NO_SMOKE_RESULTS` / `NO_SMOKE_CASES`。
- 这类 smoke 没有结果行，`env_evidence=missing`、`verified=false`，不能作为晋级依据；需要晋级的项目须至少有一条自动 smoke 用例。

### runner 窗口

人工用例的测试代码（如有）不得被 `smoke.command` 的默认 dispatcher 启动，沿用「人工用例不得被测试入口启动」的做法：独立文件命名或独立入口。
