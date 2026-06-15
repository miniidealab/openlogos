---
title: db-designer
description: 从 API 规格推导数据库 DDL，生成方言特定的 SQL。
---

从 API 规格推导数据库表结构，并生成相应方言的 SQL DDL。数据库类型在架构设计阶段（Phase 3 Step 0）确定，确保字段类型、约束、索引与安全策略都与 API 端点完全对齐。

## Phase 与触发条件

- **Phase**：Phase 3 — HOW（实现），Step 2
- **触发条件**：
  - 用户请求数据库设计或 SQL DDL
  - 用户提到「Phase 3 Step 2」「DB 设计」「表结构」
  - API YAML 规格已存在

## 前置条件

- API 规格位于 `logos/resources/api/`（[`api-designer`](/zh/skills/api-designer) 的产出）
- `logos-project.yaml` 中已填写 `tech_stack.database`

## 它做了什么

1. 从 `logos-project.yaml` 读取 `tech_stack.database` 以确定方言
2. 从 API 请求/响应结构中提取需要持久化的数据实体
3. 设计带约束与审计字段的完整表结构
4. 设计表关系与外键策略
5. 设计安全策略（PostgreSQL 用 RLS，其他用应用层）
6. 设计索引，并为每个索引说明理由
7. 输出带完整注释的 DDL

## 数据库方言支持

| 特性 | PostgreSQL | MySQL | SQLite |
|---------|-----------|-------|--------|
| UUID 主键 | `UUID DEFAULT gen_random_uuid()` | `CHAR(36) DEFAULT (UUID())` | `TEXT PRIMARY KEY NOT NULL` |
| 时间戳 | `TIMESTAMPTZ` | `DATETIME` / `TIMESTAMP` | `TEXT`（ISO 8601） |
| JSON | `JSONB`（可索引） | `JSON`（受限） | `TEXT`（应用层） |
| 行级安全 | `ENABLE ROW LEVEL SECURITY` | 不支持 | 不支持 |
| 表注释 | `COMMENT ON TABLE` | `COMMENT = '...'` | `-- @table-comment` |
| 列注释 | `COMMENT ON COLUMN` | 内联 `COMMENT '...'` | `-- @comment`（上一行） |

## 表结构要求

每张表都必须包含：

- **主键**（UUID 或自增，取决于方言）
- **业务字段**：从 API schema 映射而来，类型转换为 DB 类型
- **审计字段**：`created_at`、`updated_at`
- **软删除字段**：`deleted_at`（按需）
- **约束**：`NOT NULL`、`UNIQUE`、`CHECK`、`DEFAULT`

### 类型映射

- API `string + format: email` → `TEXT NOT NULL`
- API `string + format: uuid` → `UUID`（PostgreSQL）/ `CHAR(36)`（MySQL）/ `TEXT`（SQLite）
- API `boolean` → `BOOLEAN`（PostgreSQL）/ `TINYINT(1)`（MySQL）
- API `string + enum` → `TEXT + CHECK` 约束
- 货币字段 → `INTEGER`（分），**禁止使用 DECIMAL/FLOAT**

## 索引设计原则

- 外键列：必须建索引
- 唯一约束列：自动创建唯一索引
- 高频查询列：基于 API 查询参数
- 复合索引：用于多条件查询（最左前缀规则）
- 在写密集型表上避免过度索引

## 产出

| 文件 | 位置 |
|------|----------|
| DDL 文件 | `logos/resources/database/` |
| 简单项目 | `schema.sql`（单文件） |
| 复杂项目 | 按领域拆分：`auth.sql`、`billing.sql` |

每张表与每一列都必须有注释。每个 DDL 块都包含一条 SQL 注释，标明来源 API 端点。

## 最佳实践

- **货币值以 INTEGER 按分存储** —— 避免浮点精度问题
- **用 `deleted_at` 时间戳做软删除** 而非物理删除
- **先核心表，后辅助表** —— 先输出核心表供审查，再添加辅助表
- **字段名与 API 对齐** —— 减少代码中不必要的转换
- **SQLite：使用 `-- @comment` 结构化注释**（见 `logos/spec/sql-comment-convention.md`）
- **SQLite：连接时必须执行 `PRAGMA foreign_keys = ON`**

## 相关 Skill

- 并行：[`api-designer`](/zh/skills/api-designer) —— 设计 API 规格
- 下一步：[`test-writer`](/zh/skills/test-writer) —— 设计测试用例
