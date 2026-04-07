# SQLite 结构化注释规范

> 版本：0.1.0
>
> 本文档定义 OpenLogos 项目中 SQLite DDL 的结构化注释格式。AI 在生成 SQLite `schema.sql` 时必须遵循此格式输出表注释和字段注释，使其可被 `parseSqlComments()` 等工具链解析。

## 概述

PostgreSQL 和 MySQL 提供原生的注释语法（`COMMENT ON` / `COMMENT`），但 SQLite 不支持任何形式的元数据注释。OpenLogos 定义了一套基于 SQL 行注释（`--`）的结构化约定，让 SQLite DDL 具备等价的元数据表达能力：

- **`-- @comment`**：字段注释，放在字段定义行的紧邻上方
- **`-- @table-comment`**：表注释，放在 `CREATE TABLE` 语句的紧邻下方

这套约定对标准 SQL 工具完全透明（只是普通注释），不影响 SQLite 执行。

## 适用范围

仅当 `logos-project.yaml` 的 `tech_stack.database` 为 **SQLite** 时激活此约定。PostgreSQL 和 MySQL 项目继续使用各自的原生注释语法。

## 字段注释：`-- @comment`

### 语法

```sql
-- @comment <描述文本>
<字段定义行>
```

### 规则

1. `-- @comment` 行必须**紧邻**目标字段定义行的上方
2. `-- @comment` 与字段定义之间**不允许空行**（空行会断开关联）
3. 多行注释：连续多个 `-- @comment` 行会自动拼接为一条注释（以空格连接）
4. 约束行（`FOREIGN KEY`、独立 `CHECK`、独立 `UNIQUE`）**不需要也不消费** `-- @comment`

### 示例

单行注释：

```sql
-- @comment 用户唯一标识，UUID v4 字符串
id TEXT PRIMARY KEY NOT NULL,
```

多行注释（自动拼接）：

```sql
-- @comment 账户余额，单位：分 [USD cents]
-- @comment 禁止使用 DECIMAL/FLOAT 存储金额
balance INTEGER NOT NULL DEFAULT 0,
```

解析结果：`"账户余额，单位：分 [USD cents] 禁止使用 DECIMAL/FLOAT 存储金额"`

### 不需要注释的行

以下行不应添加 `-- @comment`，解析器也不会将 `-- @comment` 关联到它们：

```sql
FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
```

## 表注释：`-- @table-comment`

### 语法

```sql
);
-- @table-comment <表名> <描述文本>
```

### 规则

1. `-- @table-comment` 放在 `CREATE TABLE ... ();` 语句的**紧邻下方**
2. `<表名>` 必须与 `CREATE TABLE` 中的表名完全一致
3. `<表名>` 与 `<描述文本>` 之间用空格分隔，第一个空格之后的所有内容为描述

### 示例

```sql
CREATE TABLE users (
  -- @comment 用户唯一标识
  id TEXT PRIMARY KEY NOT NULL,
  -- @comment 用户邮箱
  email TEXT NOT NULL UNIQUE
);
-- @table-comment users 用户基础信息表，存储核心用户数据
```

## 完整示例

```sql
-- TaskFlow v0.1 — SQLite DDL
-- 方言：SQLite 3；连接须开启 PRAGMA foreign_keys = ON;
-- 生成日期：2026-04-07

-- ---------------------------------------------------------------------------
-- users（来源：auth.yaml → register, login）
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  -- @comment 用户唯一标识，UUID v4 字符串
  id TEXT PRIMARY KEY NOT NULL,
  -- @comment 用户邮箱，已归一化为小写
  email TEXT NOT NULL UNIQUE,
  -- @comment Argon2id 密码哈希，仅存哈希
  password_hash TEXT NOT NULL,
  -- @comment 创建时间，ISO 8601 格式
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- @comment 最后更新时间
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- @table-comment users 用户表，存储注册用户的核心信息

CREATE INDEX idx_users_email ON users (email);

-- ---------------------------------------------------------------------------
-- tasks（来源：tasks.yaml → create, list, get, update, delete）
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  -- @comment 任务唯一标识
  id TEXT PRIMARY KEY NOT NULL,
  -- @comment 任务归属用户 ID
  user_id TEXT NOT NULL,
  -- @comment 任务标题
  title TEXT NOT NULL,
  -- @comment 任务详细描述，可为空
  description TEXT,
  -- @comment 任务状态：todo / in_progress / done
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  -- @comment 任务优先级：low / medium / high
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  -- @comment 创建时间
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- @comment 最后更新时间
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
-- @table-comment tasks 任务表，存储用户创建的所有任务

CREATE INDEX idx_tasks_user_status ON tasks (user_id, status);
CREATE INDEX idx_tasks_user_updated ON tasks (user_id, updated_at);
```

## 解析算法

解析器逐行扫描 SQL 文件，维护以下状态：

- `currentTable: string | null` — 当前所在的 `CREATE TABLE` 上下文
- `pendingComment: string[]` — 待关联的注释缓冲区

### 伪代码

```
for each line in file:
  trimmed = line.trim()

  if trimmed starts with "-- @table-comment ":
    extract tableName and description
    associate description with tableName
    continue

  if trimmed starts with "-- @comment ":
    extract text after "-- @comment "
    append to pendingComment
    continue

  if trimmed is empty:
    clear pendingComment
    continue

  if trimmed matches /^CREATE TABLE\s+(\w+)/i:
    set currentTable to captured name
    clear pendingComment (table-level comment uses @table-comment)
    continue

  if currentTable is set AND trimmed is a column definition:
    extract columnName (first word-like token)
    if pendingComment is not empty:
      associate joined pendingComment with currentTable.columnName
      clear pendingComment
    add column to currentTable's column list

  if trimmed starts with ")":
    clear currentTable
    clear pendingComment
```

### 列定义识别

一行被视为列定义，当且仅当：
1. 当前在 `CREATE TABLE` 块内（`currentTable` 不为 `null`）
2. 该行**不是**以 `FOREIGN KEY`、`CHECK`、`UNIQUE`、`PRIMARY KEY`（独立约束）、`CONSTRAINT` 开头（不区分大小写）
3. 该行**不是** `)`（表结束行）
4. 该行**不是** `--` 开头的注释行

列名提取：取该行第一个匹配 `/^\s*["']?(\w+)["']?/` 的标识符。

## 输出数据结构

```typescript
interface SchemaMetadata {
  tables: TableMeta[];
}

interface TableMeta {
  name: string;
  comment?: string;
  columns: ColumnMeta[];
}

interface ColumnMeta {
  name: string;
  comment?: string;
}
```

## 与其他方言的关系

| 数据库 | 表注释 | 字段注释 |
|--------|--------|---------|
| PostgreSQL | `COMMENT ON TABLE t IS '...'` | `COMMENT ON COLUMN t.c IS '...'` |
| MySQL | `CREATE TABLE t (...) COMMENT = '...'` | `col TYPE COMMENT '...'` |
| **SQLite** | **`-- @table-comment t 描述`** | **`-- @comment 描述`** |

OpenLogos 的 `db-designer` Skill 会根据 `tech_stack.database` 自动选择正确的注释方式。工具链中的 `parseSqlComments()` 函数专门解析 SQLite 的 `@comment` / `@table-comment` 标记。
