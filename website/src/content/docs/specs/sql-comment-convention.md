---
title: SQL Comment Convention
description: Structured comment format for SQLite DDL — enabling metadata annotations where native COMMENT syntax is unavailable.
---

This specification defines the structured comment format for SQLite DDL in OpenLogos projects. AI must follow this format when generating SQLite `schema.sql` files, making them parseable by tools like `parseSqlComments()`.

## Scope

This convention is **only activated** when `logos-project.yaml` → `tech_stack.database` is **SQLite**. PostgreSQL and MySQL projects continue using their native comment syntax (`COMMENT ON` / `COMMENT`).

## Why

PostgreSQL and MySQL provide native metadata comment syntax, but SQLite does not support any form of metadata annotations. OpenLogos defines a convention based on SQL line comments (`--`) that gives SQLite DDL equivalent metadata expressiveness:

- `-- @comment`: Field comment, placed on the line immediately above the field definition
- `-- @table-comment`: Table comment, placed on the line immediately below `CREATE TABLE`

This convention is completely transparent to standard SQL tools (just regular comments) and does not affect SQLite execution.

## Field Comments: `-- @comment`

Place on the line immediately **above** the field definition:

```sql
CREATE TABLE users (
  -- @table-comment 用户主表，存储注册用户基本信息
  -- @comment 用户唯一标识，自增主键
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- @comment 用户邮箱，用于登录和通知，全局唯一
  email TEXT NOT NULL UNIQUE,
  -- @comment 显示名称，允许为空
  display_name TEXT,
  -- @comment 账户创建时间，ISO 8601 格式
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Table Comments: `-- @table-comment`

Place on the line immediately **below** the opening `CREATE TABLE ... (`:

```sql
CREATE TABLE sessions (
  -- @table-comment 用户会话表，记录登录态
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  -- @comment 会话过期时间
  expires_at TEXT NOT NULL
);
```

## Parsing Rules

1. `-- @comment <text>` applies to the **next** field definition line
2. `-- @table-comment <text>` applies to the **enclosing** `CREATE TABLE`
3. Multiple consecutive `-- @comment` lines are concatenated (newline-separated)
4. Comments must be on their own line (not inline after a field definition)
5. Leading/trailing whitespace in `<text>` is trimmed

## When to Use

- AI generates SQLite DDL via the `db-designer` Skill
- The `sql-comments` library parses these annotations for documentation generation
- RunLogos displays field/table descriptions from parsed comments

## Related

- [`db-designer`](/skills/db-designer) — Generates DDL following this convention
- [Test Results Format](/specs/test-results) — Another structured format specification
