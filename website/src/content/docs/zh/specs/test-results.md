---
title: 测试结果格式
description: openlogos verify 使用的跨框架测试结果上报 JSONL 格式规格。
---

OpenLogos 定义了一种标准的 JSONL（JSON Lines）测试结果格式，适用于任何编程语言和测试框架。AI 在生成的测试代码中嵌入一个小型 reporter；`openlogos verify` 读取其输出来执行自动化验收。

## 设计理念

OpenLogos 不绑定任何测试框架。相反，**AI 在生成的测试代码中嵌入一个轻量级 reporter（约 20 行）**，将每个用例结果写入统一格式的文件。`openlogos verify` 只需解析这一种格式。

主要优势：

| 特性 | 收益 |
|----------|---------|
| 零框架依赖 | vitest、jest、pytest、go test、cargo test 都产出相同格式 |
| 零适配成本 | `openlogos verify` 只解析一种格式 |
| AI 原生 | reporter 代码不到 20 行——AI 在写测试代码时顺手写出 |
| 原生用例 ID | 无需从测试名正则提取——ID 是一等的数据字段 |

## 文件路径

默认路径：

```
logos/resources/verify/test-results.jsonl
```

可通过 `logos.config.json` → `verify.result_path` 自定义。

## 格式：JSONL

文件采用 **JSONL**（JSON Lines）——每行一个独立的 JSON 对象，以换行符分隔。

为何选择 JSONL 而非 JSON 数组：

| 特性 | JSONL | JSON 数组 |
|----------|-------|------------|
| 追加写入 | 直接追加一行 | 必须维护闭合括号 |
| 流式读取 | 逐行解析 | 必须读取整个文件 |
| 局部损坏 | 一行损坏不影响其他行 | 括号不匹配会破坏整个文件 |
| 跨语言写入 | `JSON.stringify(obj) + "\n"` | 必须手动管理逗号和括号 |

## 字段定义

每行是一个包含以下字段的 JSON 对象：

| 字段 | 类型 | 必填 | 描述 |
|-------|------|----------|-------------|
| `id` | string | 是 | 用例 ID，须与 `test-cases.md` 中的 `UT-xx` / `ST-xx` 完全一致 |
| `status` | `"pass"` \| `"fail"` \| `"skip"` | 是 | 执行结果 |
| `duration_ms` | number | 否 | 执行时间（毫秒） |
| `timestamp` | string (ISO 8601) | 否 | 执行时间，如 `2026-04-03T15:30:01Z` |
| `error` | string | `status=fail` 时必填 | 失败原因（断言错误信息） |
| `scenario` | string | 否 | 场景 ID（如 `S01`），用于 ID 前缀一致性校验 |

### 示例

```jsonl
{"id":"UT-S01-01","status":"pass","duration_ms":12,"timestamp":"2026-04-03T15:30:01Z"}
{"id":"UT-S01-02","status":"fail","duration_ms":45,"timestamp":"2026-04-03T15:30:01Z","error":"Expected exit code 0, got 1"}
{"id":"UT-S01-03","status":"skip","timestamp":"2026-04-03T15:30:01Z"}
{"id":"ST-S01-01","status":"pass","duration_ms":230,"timestamp":"2026-04-03T15:30:02Z","scenario":"S01"}
```

### 字段约束

- `id` 必须匹配正则 `^(UT|ST)-S\d{2}-\d{2,3}$`
- `status` 只允许三种取值：`pass`、`fail`、`skip`
- `error` 在 `status=fail` 时必填，其他情况可选
- 如果同一个 `id` 出现多次（如重试），`openlogos verify` 取**最后一次出现**

## 运行时约定

### 截断策略

每次完整测试运行之前，reporter 应当**截断**结果文件，以确保它只包含最近一次运行的结果。推荐做法：

- 在测试套件的 `globalSetup` 或等效钩子中截断
- 或在 reporter 初始化阶段截断

### 目录创建

reporter 在写入之前必须确保 `logos/resources/verify/` 存在（等效于 `mkdir -p`）。

### 分批执行约定（大任务）

当 Phase 3 Step 4 采用「分批生成」时，reporter 仍按每次运行为单位输出结果，遵循以下约束：

1. **用例 ID 对齐**——每批之前，声明本批覆盖的 `UT-xx` / `ST-xx` ID；写入测试代码的 ID 必须与 `logos/resources/test/*.md` 完全一致
2. **一致截断**——无论是否分批，运行本批完整测试套件前都要截断结果文件，避免陈旧数据
3. **重复 ID 处理**——若同一 `id` 在一次运行中出现多次（重试），`openlogos verify` 取最后一条记录
4. **逐批验证**——每批运行测试并校验 JSONL，以尽早发现「只有业务代码、没有测试」或 ID 不匹配

## Reporter 代码模板

以下是各语言的参考实现。AI 在 Phase 3 Step 4（[`code-implementor`](/zh/skills/code-implementor) Skill）期间根据项目的 `tech_stack` 选择合适的模板并嵌入测试代码。

### 推荐：共享 Reporter 文件模式

**不要在每个测试文件中内联 reporter 代码。** 多文件项目应创建一个共享工具文件，到处从中导入：

```
<test-root>/
└── helpers/
    └── reporter.ts    ← all test files import from here
```

收益：
- 路径配置集中一处——避免嵌套测试文件中相对路径出错
- 新测试文件只需 `import`——reporter 绝不会被意外遗漏
- 截断逻辑集中维护一处

### TypeScript（vitest / jest）

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

### Python（pytest）

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

Python 测试函数命名约定——用下划线代替连字符：

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

## 相关规格

| 规格 | 关系 |
|---------------|-------------|
| [`test-writer`](/zh/skills/test-writer) Skill | 定义用例 ID（`UT-xx` / `ST-xx`）——JSONL 中 `id` 字段的来源 |
| [`code-implementor`](/zh/skills/code-implementor) Skill | 在 Step 4 代码生成期间驱动 reporter 嵌入 |
| [`test-orchestrator`](/zh/skills/test-orchestrator) Skill | API 编排测试也可产出此格式的 JSONL |
| [项目结构](/zh/specs/project-structure) | 定义 `logos/resources/verify/` 目录位置 |
| `logos.config.json` | `verify.result_path` 可覆盖默认路径 |
| [`openlogos verify`](/zh/cli/verify) | 读取此格式并生成验收报告 |
