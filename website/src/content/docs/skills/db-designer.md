---
title: db-designer
description: Derive database DDL from API specifications with dialect-specific SQL.
---

Derive database table structures from API specifications and generate SQL DDL in the appropriate dialect. The database type is determined during architecture design (Phase 3 Step 0), ensuring that field types, constraints, indexes, and security policies are fully aligned with API endpoints.

## Phase & Trigger

- **Phase**: Phase 3 — HOW (Implementation), Step 2
- **Trigger conditions**:
  - User requests database design or SQL DDL
  - User mentions "Phase 3 Step 2", "DB design", "table structure"
  - API YAML specifications exist

## Prerequisites

- API specs in `logos/resources/api/` (output from [`api-designer`](/skills/api-designer))
- `tech_stack.database` filled in `logos-project.yaml`

## What It Does

1. Read `tech_stack.database` from `logos-project.yaml` to determine the dialect
2. Extract data entities that need persistence from API request/response structures
3. Design complete table structures with constraints and audit fields
4. Design table relationships and foreign key strategies
5. Design security policies (RLS for PostgreSQL, application-level for others)
6. Design indexes with rationale for each
7. Output complete DDL with comprehensive comments

## Database Dialect Support

| Feature | PostgreSQL | MySQL | SQLite |
|---------|-----------|-------|--------|
| UUID PK | `UUID DEFAULT gen_random_uuid()` | `CHAR(36) DEFAULT (UUID())` | `TEXT PRIMARY KEY NOT NULL` |
| Timestamp | `TIMESTAMPTZ` | `DATETIME` / `TIMESTAMP` | `TEXT` (ISO 8601) |
| JSON | `JSONB` (indexable) | `JSON` (limited) | `TEXT` (app-layer) |
| Row-Level Security | `ENABLE ROW LEVEL SECURITY` | Not supported | Not supported |
| Table comments | `COMMENT ON TABLE` | `COMMENT = '...'` | `-- @table-comment` |
| Column comments | `COMMENT ON COLUMN` | inline `COMMENT '...'` | `-- @comment` (preceding line) |

## Table Structure Requirements

Every table must include:

- **Primary key** (UUID or auto-increment, depending on dialect)
- **Business fields** mapped from API schema with types converted to DB types
- **Audit fields**: `created_at`, `updated_at`
- **Soft delete field**: `deleted_at` (as needed)
- **Constraints**: `NOT NULL`, `UNIQUE`, `CHECK`, `DEFAULT`

### Type Mapping

- API `string + format: email` → `TEXT NOT NULL`
- API `string + format: uuid` → `UUID` (PostgreSQL) / `CHAR(36)` (MySQL) / `TEXT` (SQLite)
- API `boolean` → `BOOLEAN` (PostgreSQL) / `TINYINT(1)` (MySQL)
- API `string + enum` → `TEXT + CHECK` constraint
- Monetary fields → `INTEGER` (cents), **DECIMAL/FLOAT prohibited**

## Index Design Principles

- Foreign key columns: indexes are mandatory
- Unique constraint columns: unique indexes auto-created
- High-frequency query columns: based on API query parameters
- Composite indexes: for multi-condition queries (leftmost prefix rule)
- Avoid over-indexing on write-heavy tables

## Outputs

| File | Location |
|------|----------|
| DDL files | `logos/resources/database/` |
| Simple projects | `schema.sql` (single file) |
| Complex projects | Split by domain: `auth.sql`, `billing.sql` |

Every table and every column must have a comment. Each DDL block includes a SQL comment noting the source API endpoint.

## Best Practices

- **Store monetary values as INTEGER in cents** — avoid floating-point precision issues
- **Soft delete with `deleted_at` timestamp** over physical deletion
- **Core tables first, auxiliary tables later** — output core tables for review before adding auxiliary ones
- **Field names aligned with API** — reduces unnecessary transformations in code
- **SQLite: use `-- @comment` structured annotations** (see `logos/spec/sql-comment-convention.md`)
- **SQLite: `PRAGMA foreign_keys = ON`** must be executed at connection time

## Related Skills

- Parallel: [`api-designer`](/skills/api-designer) — design API specifications
- Next: [`test-writer`](/skills/test-writer) — design test cases
