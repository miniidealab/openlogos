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

### 示例

```jsonl
{"id":"UT-S01-01","status":"pass","duration_ms":12,"timestamp":"2026-04-03T15:30:01Z"}
{"id":"UT-S01-02","status":"fail","duration_ms":45,"timestamp":"2026-04-03T15:30:01Z","error":"Expected exit code 0, got 1"}
{"id":"UT-S01-03","status":"skip","timestamp":"2026-04-03T15:30:01Z"}
{"id":"ST-S01-01","status":"pass","duration_ms":230,"timestamp":"2026-04-03T15:30:02Z","scenario":"S01"}
```

### 字段约束

- `id` 必须匹配正则 `^(UT|ST)-S\d{2}-\d{2,3}$`
- `status` 仅允许三个值：`pass`、`fail`、`skip`
- `error` 在 `status=fail` 时必须提供，其他状态可省略
- 同一个 `id` 如果出现多次（如重试），`openlogos verify` 取**最后一次**的结果

## 运行约定

### 清空策略

每次完整测试运行前，reporter 应**清空**（truncate）结果文件，确保文件只包含最近一次运行的结果。推荐方式：

- 在测试套件的 `globalSetup` 或等效钩子中清空文件
- 或者 reporter 的初始化阶段写入空文件

### 目录创建

reporter 在写入前应确保 `logos/resources/verify/` 目录存在（`mkdir -p` 等效操作）。

### 分批闭环执行约定（大任务）

当 Phase 3 Step 4 采用“分批生成”时，reporter 仍按一次完整测试运行的口径输出结果，并遵循以下约束：

1. **用例 ID 对齐**：每一批开始前先声明本批覆盖的 `UT-xx` / `ST-xx`，测试代码中写入的 `id` 必须与 `logos/resources/test/*.md` 完全一致
2. **清空策略一致**：无论是否分批，执行“本批完整测试”前都必须先清空结果文件，避免混入旧批次数据
3. **重复 ID 判定**：同一 `id` 在同次运行中出现多条记录（如重试）时，`openlogos verify` 仍以最后一条为准
4. **批次可独立验收**：建议每一批产出后立即运行测试并校验 JSONL，可在批次内尽早发现“只写业务未写测试”或 ID 不匹配问题

## AI 生成 reporter 代码模板

以下是各语言的 reporter 参考实现。AI 在 Phase 3 Step 4（代码生成）时，应根据项目的 `tech_stack` 选择对应语言的模板，嵌入到测试代码中。

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

## 与其他规范的关系

| 规范 | 关系 |
|------|------|
| `test-writer` Skill | 定义用例 ID（`UT-xx` / `ST-xx`），是 JSONL 中 `id` 字段的来源 |
| `test-orchestrator` Skill | API 编排测试也可产出同格式 JSONL |
| `directory-convention.md` | 定义 `logos/resources/verify/` 目录位置 |
| `logos.config.json` | `verify.result_path` 可覆盖默认路径 |
| `openlogos verify` 命令 | 读取此格式文件，生成验收报告 |
