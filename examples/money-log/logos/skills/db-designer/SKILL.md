# Skill: DB Designer

> 从 API 规格推导数据库表结构，生成对应方言的 SQL DDL。数据库类型由 Phase 3 Step 0 技术选型确定，确保字段类型、约束、索引和安全策略与 API 端点完全对齐。

## 触发条件

- 用户要求设计数据库或编写 SQL
- 用户提到 "Phase 3 Step 2"、"DB 设计"、"表结构"
- 已有 API YAML 规格，需要推导数据库设计
- 用户提供了数据模型需要转化为 DDL

## 核心能力

1. 从 API 请求/响应结构推导表结构
2. 读取 `logos-project.yaml` 的 `tech_stack.database` 确定数据库类型
3. 生成对应数据库方言的 SQL DDL
4. 设计索引并说明设计理由
5. 设计安全策略（RLS / 应用层权限）
6. 为每张表、每个字段添加注释

## 前置依赖

- `logos/resources/api/` 中包含 API YAML 规格（api-designer 产出）
- `logos-project.yaml` 的 `tech_stack.database` 已填写

如果 API 目录为空，提示用户先完成 Phase 3 Step 2 的 API 设计（api-designer）。如果 `tech_stack.database` 未填写，提示用户先完成 Phase 3 Step 0（architecture-designer）。

## 执行步骤

### Step 1: 确认数据库类型

读取 `logos/logos-project.yaml` 的 `tech_stack` 字段，确定数据库类型和方言：

- PostgreSQL → 使用 UUID、TIMESTAMPTZ、RLS、JSONB 等特性
- MySQL → 使用 InnoDB、utf8mb4、TIMESTAMP 等特性
- SQLite → 使用 INTEGER PRIMARY KEY、TEXT 等简化类型
- 其他 → 与用户确认后选择最接近的方言

### Step 2: 提取数据实体

从 API YAML 中提取所有需要持久化的数据实体：

1. 扫描所有端点的 `requestBody` 和 `responses`，识别核心数据对象
2. 区分"需要持久化"与"仅传输用"的数据：
   - 有 CRUD 操作的对象 → 需要建表（如 `users`、`projects`）
   - 只出现在请求/响应中但不直接存储的 → 不建表（如 `loginRequest`）
3. 为每个对象标注来源 API 端点

输出实体清单供用户确认：

```markdown
从 API 规格中识别到 N 个需要持久化的数据实体：

| # | 实体 | 来源端点 | 核心字段 |
|---|------|---------|---------|
| 1 | users | auth.yaml → register, login | email, password, status |
| 2 | projects | projects.yaml → create, list, get | name, description, owner_id |
| 3 | subscriptions | billing.yaml → subscribe | plan, status, expires_at |
```

### Step 3: 设计表结构

为每个实体设计完整的表结构，遵循当前数据库方言：

**每张表必须包含**：
- 主键（UUID 或自增 ID，视方言决定）
- 业务字段（从 API schema 映射，类型转换为数据库类型）
- 审计字段：`created_at`、`updated_at`
- 软删除字段：`deleted_at`（按需）
- 字段约束：`NOT NULL`、`UNIQUE`、`CHECK`、`DEFAULT`

**类型映射原则**：
- API `string + format: email` → `TEXT NOT NULL`（配合 CHECK 约束或应用层校验）
- API `string + format: uuid` → `UUID`（PostgreSQL）/ `CHAR(36)`（MySQL）
- API `integer` → `INTEGER` / `BIGINT`
- API `boolean` → `BOOLEAN`（PostgreSQL）/ `TINYINT(1)`（MySQL）
- API `string + enum` → `TEXT + CHECK` 约束（列出枚举值）
- 金额字段 → `INTEGER`（存分值），**禁止 DECIMAL/FLOAT**

**示例（PostgreSQL）**：

```sql
-- 用户表（来源：auth.yaml → register, login）
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  password    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'disabled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**示例（SQLite — 使用 `@comment` 结构化注释）**：

```sql
-- 用户表（来源：auth.yaml → register, login）
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
```

> **SQLite 注释约定**：SQLite 不支持 `COMMENT ON` 语法，必须使用 `-- @comment` 前置注释（字段）和 `-- @table-comment <表名> <描述>` 后置注释（表）。规则详见 `logos/spec/sql-comment-convention.md`。

### Step 4: 设计表间关联

根据 API 中的实体关系设计外键：

1. 从 API 端点的嵌套路径和引用字段推导关联（如 `/api/projects/:projectId/members` → `project_members` 表关联 `projects` 和 `users`）
2. 确定关联类型（一对多、多对多）
3. 设计外键约束和级联策略：
   - `ON DELETE CASCADE`：父记录删除时子记录跟随删除（如用户删除 → 项目删除）
   - `ON DELETE SET NULL`：父记录删除时子记录保留但外键置空
   - `ON DELETE RESTRICT`：父记录有子记录时禁止删除

### Step 5: 设计安全策略

根据数据库类型设计对应的安全机制：

**PostgreSQL — 行级安全（RLS）**：

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_owner_policy ON projects
  USING (owner_id = auth.uid());
```

- 所有包含用户数据的表启用 RLS
- 为每张表设计至少一条 Policy（owner / admin / public）
- 注明 RLS 策略与 API 认证方案的对应关系

**MySQL — 应用层权限**：

- 在表注释中标注数据访问权限（owner-only / admin / public）
- 不在 DDL 中实现权限控制，交由应用层处理

### Step 6: 设计索引

为常见查询模式设计索引，每个索引附设计理由：

```sql
-- 用户按邮箱查找（登录场景，来源 S02）
CREATE UNIQUE INDEX idx_users_email ON users(email);

-- 项目按 owner 查找（项目列表，来源 S04 Step 1）
CREATE INDEX idx_projects_owner ON projects(owner_id);
```

索引设计原则：
- 外键列：必须建索引（避免 JOIN 全表扫描）
- 唯一约束列：自动创建唯一索引
- 高频查询列：根据 API 的查询参数判断
- 复合索引：多条件查询时考虑（最左前缀原则）
- 不过度索引：写多读少的表控制索引数量

### Step 7: 输出完整 DDL

按以下顺序组织 DDL 文件：

1. 文件头注释（来源、数据库类型、生成时间）
2. 基础表（无外键依赖的表先建）
3. 关联表（有外键依赖的表后建）
4. 索引
5. 安全策略（RLS / Policy）
6. 表和字段注释：
   - PostgreSQL：使用 `COMMENT ON TABLE` / `COMMENT ON COLUMN`
   - MySQL：使用内联 `COMMENT`
   - SQLite：使用 `-- @comment`（字段）+ `-- @table-comment`（表），详见下方 SQLite 注释规则

每段 DDL 上方用注释标注来源 API 端点。

**SQLite 注释规则（MUST Follow）**：

当 `tech_stack.database` 为 SQLite 时，必须使用以下结构化注释格式：

1. **字段注释**：在字段定义行的**紧邻上方**写 `-- @comment <描述>`
   - 与字段之间**不允许空行**（空行会断开关联）
   - 多行注释：连续多个 `-- @comment` 行自动拼接
2. **表注释**：在 `CREATE TABLE ... ();` 语句**紧邻下方**写 `-- @table-comment <表名> <描述>`
3. 约束行（`FOREIGN KEY`、独立 `CHECK`、`UNIQUE`）**不需要** `-- @comment`

## 输出规范

- 文件格式：SQL（方言由 `tech_stack.database` 决定）
- 存放位置：`logos/resources/database/`
- 单文件输出：`schema.sql`（简单项目）；或按领域分文件：`auth.sql`、`billing.sql`（复杂项目）
- 每张表必须有注释（PostgreSQL: `COMMENT ON TABLE`；MySQL: `COMMENT = '...'`；SQLite: `-- @table-comment`）
- 每个字段必须有注释（PostgreSQL: `COMMENT ON COLUMN`；MySQL: 字段定义后 `COMMENT '...'`；SQLite: `-- @comment`）
- 每段 DDL 上方用 SQL 注释标注来源 API 端点

## 数据库方言差异速查

| 特性 | PostgreSQL | MySQL | SQLite |
|------|-----------|-------|--------|
| UUID 主键 | `UUID DEFAULT gen_random_uuid()` | `CHAR(36) DEFAULT (UUID())` 或 `BINARY(16)` | `TEXT PRIMARY KEY NOT NULL`（应用层生成 UUID） |
| 时间类型 | `TIMESTAMPTZ` | `DATETIME` / `TIMESTAMP`（注意时区处理） | `TEXT`（ISO 8601 字符串） |
| JSON 支持 | `JSONB`（可索引） | `JSON`（功能受限） | `TEXT`（应用层 JSON 序列化） |
| 行级安全 | RLS (`ENABLE ROW LEVEL SECURITY`) | 不支持，需在应用层实现 | 不支持，需在应用层实现 |
| 表注释 | `COMMENT ON TABLE t IS '...'` | `CREATE TABLE t (...) COMMENT = '...'` | `-- @table-comment t 描述` |
| 字段注释 | `COMMENT ON COLUMN t.c IS '...'` | `col_name TYPE COMMENT '...'` | `-- @comment 描述`（紧邻字段上方） |

## 实践经验

### 通用（所有数据库）

- **金额一律 INTEGER 存分值**：禁止 DECIMAL/FLOAT，避免浮点精度问题
- **软删除**：优先使用 `deleted_at` 时间字段而非物理删除
- **审计字段**：每张表包含 `created_at` 和 `updated_at`
- **时间字段带时区**：避免时区陷阱
- **字段名与 API 一致**：DB 列名尽量与 API YAML 中的字段名对齐（如 API 用 `userId` → DB 用 `user_id`，映射规则明确即可），减少代码层的无谓转换
- **先出核心表再补辅助表**：不要试图一次设计所有表——先输出核心业务表让用户 review，再补充辅助表

### PostgreSQL 特有

- **主键**：`id UUID DEFAULT gen_random_uuid() PRIMARY KEY`
- **时间类型**：使用 `TIMESTAMPTZ`
- **RLS**：所有表启用 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
- **JSONB**：需要非结构化存储时优先使用 JSONB 并建 GIN 索引

### MySQL 特有

- **主键**：`id CHAR(36) DEFAULT (UUID()) PRIMARY KEY` 或自增 BIGINT
- **时间类型**：使用 `TIMESTAMP`（自动时区转换）或 `DATETIME`（原样存储）
- **字符集**：建表时指定 `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
- **引擎**：一律使用 `ENGINE=InnoDB`

### SQLite 特有

- **主键**：`TEXT PRIMARY KEY NOT NULL`（应用层生成 UUID v4）或 `INTEGER PRIMARY KEY AUTOINCREMENT`
- **时间类型**：使用 `TEXT` 存储 ISO 8601 字符串，默认值 `DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
- **外键**：须在连接时执行 `PRAGMA foreign_keys = ON;`
- **注释**：必须使用 `-- @comment` / `-- @table-comment` 结构化注释（见 `logos/spec/sql-comment-convention.md`）
- **无触发器**：`updated_at` 须在应用层刷新，不依赖 `ON UPDATE` 触发器

## 推荐提示词

以下提示词可以直接复制给 AI 使用：

- `帮我设计数据库`
- `基于 API 规格帮我推导数据库 DDL`
- `帮我设计 S01 涉及的数据库表`
- `帮我给现有表结构补充索引和 RLS 策略`
