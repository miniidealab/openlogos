-- TaskFlow v0.1 — SQLite DDL
-- 来源：logos/resources/api/openapi.yaml 与架构 01-architecture-overview.md
-- 方言：SQLite 3；运行连接须开启 PRAGMA foreign_keys = ON;
-- 生成日期：2026-04-06
--
-- 注意：users.updated_at / tasks.updated_at 须在应用层于每次 UPDATE 时刷新；
--       SQLite 未配置 ON UPDATE 触发器（保持 DDL 最小，便于 Drizzle 等迁移工具接管）。

-- ---------------------------------------------------------------------------
-- users：注册 / 登录 / 销户（POST /auth/register, /auth/login, DELETE /users/me）
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  -- @comment 用户唯一标识，UUID v4 字符串，与 OpenAPI format: uuid 一致
  id TEXT PRIMARY KEY NOT NULL,
  -- @comment 用户邮箱，已归一化为小写，与唯一约束配合防重复注册
  email TEXT NOT NULL UNIQUE,
  -- @comment 密码哈希，Argon2id 编码串，仅存哈希
  password_hash TEXT NOT NULL,
  -- @comment 创建时间，ISO 8601 格式
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- @comment 最后更新时间，须在应用层刷新
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- @table-comment users 用户表，存储注册用户的核心认证信息

CREATE INDEX idx_users_email ON users (email);

-- ---------------------------------------------------------------------------
-- sessions：不透明访问令牌（POST /auth/login, /auth/logout）
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  -- @comment 会话唯一标识
  id TEXT PRIMARY KEY NOT NULL,
  -- @comment 关联用户 ID
  user_id TEXT NOT NULL,
  -- @comment 令牌哈希，对客户端所持令牌做 SHA-256 得到的十六进制编码
  token_hash TEXT NOT NULL UNIQUE,
  -- @comment 会话过期时间
  expires_at TEXT NOT NULL,
  -- @comment 撤销时间，非空表示已登出
  revoked_at TEXT,
  -- @comment 会话创建时间
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
-- @table-comment sessions 会话表，存储不透明访问令牌，支持登录/登出

CREATE INDEX idx_sessions_user_id ON sessions (user_id);
CREATE INDEX idx_sessions_token_hash ON sessions (token_hash);

-- ---------------------------------------------------------------------------
-- tasks：任务（POST/GET/PATCH/DELETE /tasks, /tasks/{taskId}）
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  -- @comment 任务唯一标识
  id TEXT PRIMARY KEY NOT NULL,
  -- @comment 任务归属用户 ID，与 OpenAPI 中「当前用户」一致；他人访问返回 404
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

-- 列表：按用户 + 可选 status（S01/S02 GET /tasks）
CREATE INDEX idx_tasks_user_status ON tasks (user_id, status);
-- 列表默认排序：按 updated_at 降序
CREATE INDEX idx_tasks_user_updated ON tasks (user_id, updated_at);
