# 变更提案：SQLite 结构化注释约定

## 变更背景

SQLite 不支持标准的 `COMMENT ON TABLE/COLUMN` 语法（PostgreSQL）和内联 `COMMENT` 语法（MySQL）。当前 `db-designer` Skill 在 SQLite 方言下没有任何注释输出约定，导致：

1. AI 输出的 SQLite DDL 注释格式不统一，不可机器解析
2. 下游工具（CLI、代码生成器）无法从 `schema.sql` 中提取表/字段元数据
3. 三种数据库方言的注释能力不对等

## 变更目标

定义一套基于 `-- @comment` / `-- @table-comment` 的结构化注释约定，让 SQLite DDL 具备与 PostgreSQL/MySQL 等价的元数据表达能力，并可被工具链解析。

## 注释格式规范

### 字段注释：`-- @comment`

- 紧接在字段定义行的**上一行**
- 与目标字段之间**不允许空行**
- 连续多个 `-- @comment` 行自动拼接为一条注释

```sql
CREATE TABLE users (
    -- @comment 用户唯一标识，UUID v4 字符串
    id TEXT PRIMARY KEY NOT NULL,

    -- @comment 用户名，不超过 50 字符
    username TEXT NOT NULL,

    -- @comment 账户余额，单位：分 [USD cents]
    -- @comment 禁止使用 DECIMAL/FLOAT
    balance INTEGER NOT NULL DEFAULT 0
);
```

### 表注释：`-- @table-comment`

- 放在 `CREATE TABLE ... ();` 语句**之后**
- 格式：`-- @table-comment <表名> <描述文本>`
- 表名必须与 CREATE TABLE 中的表名一致

```sql
CREATE TABLE users (
    ...
);
-- @table-comment users 用户基础信息表，存储核心用户数据
```

### 完整示例

```sql
-- TaskFlow v0.1 — SQLite DDL
-- 方言：SQLite 3

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
```

## 解析规则

解析器逐行扫描 SQL 文件，维护一个 `pendingComment` 缓冲区：

1. 遇到 `-- @comment <text>` → 追加到 `pendingComment`
2. 遇到非空非注释行（即字段定义行）→ 将 `pendingComment` 关联到该字段，清空缓冲区
3. 遇到空行 → 清空 `pendingComment`（断开关联）
4. 遇到 `-- @table-comment <table> <text>` → 关联到指定表
5. 遇到 `CREATE TABLE <name>` → 记录当前表上下文
6. 忽略 `FOREIGN KEY`、`CHECK`、`UNIQUE` 等约束行（不消费 `pendingComment`）

输出数据结构：

```typescript
interface SchemaMetadata {
  tables: {
    name: string;
    comment?: string;
    columns: {
      name: string;
      comment?: string;
    }[];
  }[];
}
```

## 影响范围

| 组件 | 变更内容 |
|------|---------|
| `skills/db-designer/SKILL.md` | 添加 SQLite 注释约定到 Step 7 输出规范 + 方言差异速查表 |
| `skills/db-designer/SKILL.en.md` | 同上（英文版） |
| `spec/` | 新增 `sql-comment-convention.md` 规范文档（可选，首期可跳过） |
| `cli/` | 新增 `parseSqlComments()` 工具函数供下游消费 |
| `plugin/` | 无需变更（Skill 通过构建脚本同步） |

## 兼容性

- 对标准 SQL 工具完全透明（`-- @comment` 就是普通注释）
- 不影响 SQLite 执行（注释被忽略）
- 不影响 PostgreSQL/MySQL 方言（它们继续使用原生 `COMMENT ON` / `COMMENT` 语法）
- 仅在 `tech_stack.database` 为 SQLite 时激活此约定
