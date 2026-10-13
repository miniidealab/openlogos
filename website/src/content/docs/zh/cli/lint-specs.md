---
title: "openlogos lint-specs"
description: 只读检查已合并测试规格的结构问题——重复测试 ID、表格列数、ID 格式，以及无法寻址的重复标题。
---

扫描 `logos/resources/test/` 下（含 `smoke/` 等子目录）的已合并测试规格，找出会悄悄污染验收的结构问题。例如同一个测试 ID 被定义两次，一个用例的结果就会无声覆盖另一个。

`lint-specs` 是**由你主动运行的诊断工具**，不参与任何门：`merge`、`verify`、`archive`、`change-lint` 都不会因它的结论而阻断。它只读文件。

## 命令格式

```bash
openlogos lint-specs [--format json]
```

必须在项目根目录下运行。

## 选项

| 选项 | 说明 |
|------|------|
| `--format json` | 输出 `{ "ok": …, "data": { "ok", "scanned_files", "findings": [ { "code", "path", "line", "message" } ] } }` |

## 检查内容

| 代码 | 问题 |
|------|------|
| `duplicate_test_id` | 同一个测试 ID 在两处及以上定义（同文件或跨文件） |
| `table_column_mismatch` | Markdown 表格某行的单元格数与表头不一致 |
| `invalid_test_id` | ID 表某行首格不是合法测试 ID（允许尾随 manual 标记） |
| `duplicate_heading` | 两个标题文本**和**祖先路径都相同——delta 锚只能用 `标题 [2]` 这样的序数后缀定位 |

ID 表按结构识别（首列表头为 `ID` / `用例ID` / `编号`，或行首格是测试 ID），措辞不同的表头不会被漏掉。测试 ID 语法与 CLI 其余部分使用同一份定义。

## 退出码

| 退出码 | 含义 |
|--------|------|
| `0` | 未发现结构问题 |
| `1` | 报告了问题（逐条给出文件与行号），或项目未初始化 |

## 示例

```bash
openlogos lint-specs
```

```
🔍 lint-specs：扫描 6 个测试规格文件
  ✗ 1 项：
  - [duplicate_test_id] logos/resources/test/core-S02-test-cases.md:41：测试 ID 'UT-S02-07' 在 2 处定义：…

  ℹ️  本命令为只读诊断，不参与 merge / verify / archive / change-lint 的任何门。
```

发现的问题请通过正常的变更提案修复——测试规格属于受保护内容。

## 相关命令

- [`change-lint`](/zh/cli/change-lint) — 提案 delta 的交付检查（会拦下提案自身引入的重复）
- [`verify`](/zh/cli/verify) — 基于测试规格的验收（Gate 3.6）
