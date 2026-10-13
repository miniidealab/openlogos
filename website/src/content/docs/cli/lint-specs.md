---
title: "openlogos lint-specs"
description: Read-only structural check of the merged test specs — duplicate test IDs, table column counts, ID format, and unaddressable duplicate headings.
---

Scan the merged test specs under `logos/resources/test/` (including subdirectories such as `smoke/`) for structural problems that silently corrupt acceptance. A test ID defined twice, for example, lets one case's result overwrite another's without anyone noticing.

`lint-specs` is a **diagnostic you run yourself**. It does not take part in any gate: `merge`, `verify`, `archive` and `change-lint` never block on its result. It only reads files.

## Synopsis

```bash
openlogos lint-specs [--format json]
```

Must be run from the project root.

## Options

| Option | Description |
|--------|-------------|
| `--format json` | Print `{ "ok": …, "data": { "ok", "scanned_files", "findings": [ { "code", "path", "line", "message" } ] } }` |

## What it checks

| Code | Problem |
|------|---------|
| `duplicate_test_id` | The same test ID is defined in two or more places (within a file or across files) |
| `table_column_mismatch` | A Markdown table row has a different number of cells than its header |
| `invalid_test_id` | The first cell of an ID table row is not a valid test ID (a trailing manual marker is accepted) |
| `duplicate_heading` | Two headings with the same text **and** the same ancestor path — a delta anchor can only reach them with an ordinal suffix such as `Title [2]` |

ID tables are recognised by structure (a first column headed `ID` / `用例ID` / `编号`, or rows whose first cell is a test ID), so differently worded headers are not skipped. Test-ID syntax comes from the same definition the rest of the CLI uses.

## Exit codes

| Exit | Meaning |
|------|---------|
| `0` | No structural problems found |
| `1` | Findings were reported (each with file and line), or the project is not initialized |

## Example

```bash
openlogos lint-specs
```

```
🔍 lint-specs：扫描 6 个测试规格文件
  ✗ 1 项：
  - [duplicate_test_id] logos/resources/test/core-S02-test-cases.md:41：测试 ID 'UT-S02-07' 在 2 处定义：…

  ℹ️  本命令为只读诊断，不参与 merge / verify / archive / change-lint 的任何门。
```

Fix findings through a normal change proposal — the test specs are protected content.

## Related commands

- [`change-lint`](/cli/change-lint) — Delivery check for a proposal's deltas (catches duplicates the proposal itself would introduce)
- [`verify`](/cli/verify) — Acceptance against the test specs (Gate 3.6)
