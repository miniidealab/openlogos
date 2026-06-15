---
title: SQL 注释约定
description: SQLite DDL 的结构化注释格式——在缺乏原生 COMMENT 语法时实现元数据注解。
---

本规格定义 OpenLogos 项目中 SQLite DDL 的结构化注释格式。AI 在生成 SQLite `schema.sql` 文件时必须遵循此格式，使其能被 `parseSqlComments()` 等工具解析。

## 适用范围

此约定**仅在** `logos-project.yaml` → `tech_stack.database` 为 **SQLite** 时启用。PostgreSQL 和 MySQL 项目继续使用其原生注释语法（`COMMENT ON` / `COMMENT`）。

## 缘由

PostgreSQL 和 MySQL 提供原生的元数据注释语法，但 SQLite 不支持任何形式的元数据注解。OpenLogos 基于 SQL 行注释（`--`）定义了一种约定，赋予 SQLite DDL 等价的元数据表达能力：

- `-- @comment`：字段注释，置于字段定义紧邻的上一行
- `-- @table-comment`：表注释，置于 `CREATE TABLE` 紧邻的下一行

此约定对标准 SQL 工具完全透明（只是普通注释），不影响 SQLite 执行。

## 字段注释：`-- @comment`

置于字段定义紧邻的**上一行**：

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

## 表注释：`-- @table-comment`

置于 `CREATE TABLE ... (` 起始行紧邻的**下一行**：

```sql
CREATE TABLE sessions (
  -- @table-comment 用户会话表，记录登录态
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  -- @comment 会话过期时间
  expires_at TEXT NOT NULL
);
```

## 解析规则

1. `-- @comment <text>` 应用于**下一个**字段定义行
2. `-- @table-comment <text>` 应用于**所在的** `CREATE TABLE`
3. 多个连续的 `-- @comment` 行会被拼接（以换行分隔）
4. 注释必须独占一行（不能内联在字段定义之后）
5. `<text>` 的首尾空白会被去除

## 何时使用

- AI 通过 `db-designer` Skill 生成 SQLite DDL 时
- `sql-comments` 库解析这些注解用于生成文档时
- RunLogos 展示解析自注释的字段/表描述时

## 相关

- [`db-designer`](/zh/skills/db-designer)——按此约定生成 DDL
- [测试结果格式](/zh/specs/test-results)——另一份结构化格式规格
