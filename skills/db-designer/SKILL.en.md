# Skill: DB Designer

> Derive database table structures from API specifications and generate SQL DDL in the appropriate dialect. The database type is determined during Phase 3 Step 0 technology selection, ensuring that field types, constraints, indexes, and security policies are fully aligned with API endpoints.

## Trigger Conditions

- User requests database design or SQL writing
- User mentions "Phase 3 Step 2", "DB design", "table structure"
- API YAML specifications already exist and database design needs to be derived
- User provides a data model that needs to be converted to DDL

## Core Capabilities

1. Derive table structures from API request/response structures
2. Read `tech_stack.database` from `logos-project.yaml` to determine the database type
3. Generate SQL DDL in the corresponding database dialect
4. Design indexes with rationale for each
5. Design security policies (RLS / application-level permissions)
6. Add comments to every table and every field

## Prerequisites

- `logos/resources/api/` contains API YAML specifications (output from api-designer)
- `tech_stack.database` in `logos-project.yaml` is filled in

If the API directory is empty, prompt the user to complete the API design (api-designer) in Phase 3 Step 2 first. If `tech_stack.database` is not filled in, prompt the user to complete Phase 3 Step 0 (architecture-designer) first.

## Execution Steps

### Step 1: Determine Database Type

Read the `tech_stack` field from `logos/logos-project.yaml` to determine the database type and dialect:

- PostgreSQL → Use features like UUID, TIMESTAMPTZ, RLS, JSONB, etc.
- MySQL → Use features like InnoDB, utf8mb4, TIMESTAMP, etc.
- SQLite → Use simplified types like INTEGER PRIMARY KEY, TEXT, etc.
- Other → Confirm with the user and select the closest dialect

### Step 2: Extract Data Entities

Extract all data entities that need to be persisted from the API YAML:

1. Scan `requestBody` and `responses` across all endpoints to identify core data objects
2. Distinguish between "needs persistence" and "transfer-only" data:
   - Objects with CRUD operations → need a table (e.g., `users`, `projects`)
   - Objects that only appear in requests/responses but are not stored directly → no table needed (e.g., `loginRequest`)
3. Annotate each object with its source API endpoint

Output an entity checklist for user confirmation:

```markdown
Identified N data entities requiring persistence from API specifications:

| # | Entity | Source Endpoint | Core Fields |
|---|--------|----------------|-------------|
| 1 | users | auth.yaml → register, login | email, password, status |
| 2 | projects | projects.yaml → create, list, get | name, description, owner_id |
| 3 | subscriptions | billing.yaml → subscribe | plan, status, expires_at |
```

### Step 3: Design Table Structures

Design complete table structures for each entity, following the current database dialect:

**Every table must include**:
- Primary key (UUID or auto-increment ID, depending on dialect)
- Business fields (mapped from API schema, with types converted to database types)
- Audit fields: `created_at`, `updated_at`
- Soft delete field: `deleted_at` (as needed)
- Field constraints: `NOT NULL`, `UNIQUE`, `CHECK`, `DEFAULT`

**Type mapping principles**:
- API `string + format: email` → `TEXT NOT NULL` (with CHECK constraint or application-level validation)
- API `string + format: uuid` → `UUID` (PostgreSQL) / `CHAR(36)` (MySQL)
- API `integer` → `INTEGER` / `BIGINT`
- API `boolean` → `BOOLEAN` (PostgreSQL) / `TINYINT(1)` (MySQL)
- API `string + enum` → `TEXT + CHECK` constraint (listing enum values)
- Monetary fields → `INTEGER` (store in cents), **DECIMAL/FLOAT is prohibited**

**Example (PostgreSQL)**:

```sql
-- Users table (source: auth.yaml → register, login)
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

### Step 4: Design Table Relationships

Design foreign keys based on entity relationships in the API:

1. Derive relationships from nested paths and reference fields in API endpoints (e.g., `/api/projects/:projectId/members` → `project_members` table linking `projects` and `users`)
2. Determine relationship types (one-to-many, many-to-many)
3. Design foreign key constraints and cascade strategies:
   - `ON DELETE CASCADE`: child records are deleted when the parent record is deleted (e.g., user deleted → projects deleted)
   - `ON DELETE SET NULL`: child records are retained but the foreign key is set to null when the parent is deleted
   - `ON DELETE RESTRICT`: prevent deletion of the parent record if child records exist

### Step 5: Design Security Policies

Design corresponding security mechanisms based on the database type:

**PostgreSQL — Row-Level Security (RLS)**:

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_owner_policy ON projects
  USING (owner_id = auth.uid());
```

- Enable RLS on all tables containing user data
- Design at least one Policy per table (owner / admin / public)
- Document the correspondence between RLS policies and the API authentication scheme

**MySQL — Application-Level Permissions**:

- Annotate data access permissions in table comments (owner-only / admin / public)
- Do not implement permission control in DDL; delegate to the application layer

### Step 6: Design Indexes

Design indexes for common query patterns, with a rationale for each index:

```sql
-- User lookup by email (login scenario, source: S02)
CREATE UNIQUE INDEX idx_users_email ON users(email);

-- Project lookup by owner (project list, source: S04 Step 1)
CREATE INDEX idx_projects_owner ON projects(owner_id);
```

Index design principles:
- Foreign key columns: indexes are mandatory (to avoid full table scans on JOINs)
- Unique constraint columns: unique indexes are created automatically
- High-frequency query columns: determine based on API query parameters
- Composite indexes: consider for multi-condition queries (leftmost prefix rule)
- Avoid over-indexing: limit index count on write-heavy tables

### Step 7: Output Complete DDL

Organize the DDL file in the following order:

1. File header comment (source, database type, generation timestamp)
2. Base tables (tables without foreign key dependencies first)
3. Association tables (tables with foreign key dependencies after)
4. Indexes
5. Security policies (RLS / Policy)
6. Table and field comments (PostgreSQL uses `COMMENT ON`)

Add a comment above each DDL block noting the source API endpoint.

## Output Specification

- File format: SQL (dialect determined by `tech_stack.database`)
- Storage location: `logos/resources/database/`
- Single file output: `schema.sql` (simple projects); or split by domain: `auth.sql`, `billing.sql` (complex projects)
- Every table must have a comment (PostgreSQL: `COMMENT ON TABLE`; MySQL: `COMMENT = '...'`)
- Every field must have a comment (PostgreSQL: `COMMENT ON COLUMN`; MySQL: `COMMENT '...'` after field definition)
- Add a SQL comment above each DDL block noting the source API endpoint

## Database Dialect Quick Reference

| Feature | PostgreSQL | MySQL |
|---------|-----------|-------|
| UUID Primary Key | `UUID DEFAULT gen_random_uuid()` | `CHAR(36) DEFAULT (UUID())` or use `BINARY(16)` |
| Timestamp Type | `TIMESTAMPTZ` | `DATETIME` / `TIMESTAMP` (mind timezone handling) |
| JSON Support | `JSONB` (indexable) | `JSON` (limited functionality) |
| Row-Level Security | RLS (`ENABLE ROW LEVEL SECURITY`) | Not supported; must be implemented at the application layer |
| Table Comment | `COMMENT ON TABLE t IS '...'` | `CREATE TABLE t (...) COMMENT = '...'` |
| Column Comment | `COMMENT ON COLUMN t.c IS '...'` | `col_name TYPE COMMENT '...'` |

## Best Practices

### General (All Databases)

- **Store monetary values as INTEGER in cents**: DECIMAL/FLOAT is prohibited to avoid floating-point precision issues
- **Soft delete**: prefer a `deleted_at` timestamp field over physical deletion
- **Audit fields**: every table should include `created_at` and `updated_at`
- **Timestamp fields with timezone**: avoid timezone pitfalls
- **Field names aligned with API**: DB column names should match API YAML field names as closely as possible (e.g., API uses `userId` → DB uses `user_id`; as long as the mapping rule is clear), reducing unnecessary transformations in the code layer
- **Core tables first, auxiliary tables later**: don't try to design all tables at once — output core business tables for user review first, then add auxiliary tables

### PostgreSQL-Specific

- **Primary key**: `id UUID DEFAULT gen_random_uuid() PRIMARY KEY`
- **Timestamp type**: use `TIMESTAMPTZ`
- **RLS**: enable on all tables with `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
- **JSONB**: prefer JSONB for unstructured storage and create GIN indexes

### MySQL-Specific

- **Primary key**: `id CHAR(36) DEFAULT (UUID()) PRIMARY KEY` or auto-increment BIGINT
- **Timestamp type**: use `TIMESTAMP` (automatic timezone conversion) or `DATETIME` (stored as-is)
- **Character set**: specify `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` when creating tables
- **Engine**: always use `ENGINE=InnoDB`

## Recommended Prompts

The following prompts can be copied directly for use with AI:

- `Help me design the database`
- `Derive database DDL from the API specifications`
- `Help me design the database tables involved in S01`
- `Help me add indexes and RLS policies to the existing table structures`
