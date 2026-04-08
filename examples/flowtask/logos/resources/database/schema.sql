-- ============================================================
-- FlowTask — SQLite 数据库 Schema
-- 数据库类型：SQLite（via tauri-plugin-sql）
-- 更新时间：2026/04/07
-- 来源：logos/resources/api/ 命令规格推导
-- ============================================================

PRAGMA journal_mode = WAL;   -- 提升并发读写性能
PRAGMA foreign_keys = ON;    -- 启用外键约束（SQLite 默认关闭）

-- ============================================================
-- @table-comment users 用户基础信息表，存储本地账号数据，密码以 bcrypt 哈希形式存储
-- 来源：auth.yaml → register, login, change_password
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    -- @comment 用户主键，自增整数
    id         INTEGER  PRIMARY KEY AUTOINCREMENT,
    -- @comment 用户名，2-20 字符，全局唯一，用于登录身份识别
    username   TEXT     NOT NULL UNIQUE,
    -- @comment 密码哈希值，使用 bcrypt 算法（cost=12）
    -- @comment 禁止存储明文密码
    password   TEXT     NOT NULL,
    -- @comment 账号创建时间，TEXT 存储 ISO 8601 格式，如 '2026-04-07T10:30:00'
    created_at TEXT     NOT NULL DEFAULT (datetime('now')),
    -- @comment 账号最后更新时间，TEXT 存储 ISO 8601 格式
    -- @comment 每次 UPDATE 须在 SQL 中手动设置为 datetime('now')
    updated_at TEXT     NOT NULL DEFAULT (datetime('now'))
);

-- 用户名唯一索引（S02.1 Step 9：按 username 查询用户，已由 UNIQUE 约束自动创建）

-- ============================================================
-- @table-comment categories 任务分类表，存储用户自定义分类，同一用户下名称唯一
-- 来源：categories.yaml → create_category, delete_category
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
    -- @comment 分类主键，自增整数
    id         INTEGER  PRIMARY KEY AUTOINCREMENT,
    -- @comment 所属用户 ID，外键关联 users.id
    -- @comment ON DELETE CASCADE：用户删除时其下所有分类跟随删除
    user_id    INTEGER  NOT NULL
                        REFERENCES users(id) ON DELETE CASCADE,
    -- @comment 分类名称，1-20 字符，同一用户下不可重复
    name       TEXT     NOT NULL
                        CHECK (length(name) >= 1 AND length(name) <= 20),
    -- @comment 分类创建时间，TEXT 存储 ISO 8601 格式
    created_at TEXT     NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
);

-- 分类按用户查询索引（auth.yaml → login：登录后加载分类列表）
CREATE INDEX IF NOT EXISTS idx_categories_user_id
    ON categories(user_id);

-- ============================================================
-- @table-comment tasks 任务表，存储用户任务，支持完成状态切换和分类关联
-- 来源：tasks.yaml → create_task, update_task, update_task_status, delete_task
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
    -- @comment 任务主键，自增整数
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    -- @comment 所属用户 ID，外键关联 users.id
    -- @comment ON DELETE CASCADE：用户删除时其下所有任务跟随删除
    user_id     INTEGER  NOT NULL
                         REFERENCES users(id) ON DELETE CASCADE,
    -- @comment 所属分类 ID，可为 NULL 表示"无分类"，外键关联 categories.id
    -- @comment ON DELETE SET NULL：分类删除时任务保留，该字段自动置为 NULL
    category_id INTEGER
                         REFERENCES categories(id) ON DELETE SET NULL,
    -- @comment 任务名称，1-100 字符，必填
    name        TEXT     NOT NULL
                         CHECK (length(name) >= 1 AND length(name) <= 100),
    -- @comment 任务备注，可为 NULL，最多 500 字符
    note        TEXT     CHECK (note IS NULL OR length(note) <= 500),
    -- @comment 任务完成状态：0 = 未完成，1 = 已完成
    -- @comment 使用 INTEGER(0/1) 表示布尔值，SQLite 无原生 BOOLEAN 类型
    done        INTEGER  NOT NULL DEFAULT 0
                         CHECK (done IN (0, 1)),
    -- @comment 任务创建时间，TEXT 存储 ISO 8601 格式
    created_at  TEXT     NOT NULL DEFAULT (datetime('now')),
    -- @comment 任务最后更新时间，TEXT 存储 ISO 8601 格式
    -- @comment 每次 UPDATE 须在 SQL 中手动设置为 datetime('now')
    updated_at  TEXT     NOT NULL DEFAULT (datetime('now'))
);

-- 任务按用户查询索引（S02.1 Step 12：登录后加载全量任务列表）
CREATE INDEX IF NOT EXISTS idx_tasks_user_id
    ON tasks(user_id);

-- 任务按用户+完成状态复合索引（高频查询：筛选未完成任务）
CREATE INDEX IF NOT EXISTS idx_tasks_user_done
    ON tasks(user_id, done);

-- ============================================================
-- 数据说明
-- ============================================================
-- 1. 时间字段统一使用 TEXT 存储 ISO 8601 格式（SQLite 无原生 DATETIME 类型）
--    示例：'2026-04-07T10:30:00'，由 datetime('now') 自动填充
-- 2. 布尔值使用 INTEGER (0/1) 存储（SQLite 无原生 BOOLEAN 类型）
-- 3. 外键级联策略：
--    users → categories : CASCADE  （用户删除，分类一并删除）
--    users → tasks       : CASCADE  （用户删除，任务一并删除）
--    categories → tasks  : SET NULL （分类删除，任务保留，category_id 置 NULL）
-- 4. 安全策略：本项目为单机桌面应用，无多用户并发场景。
--    应用层在所有命令中通过 user_id 参数确保数据隔离，
--    所有涉及用户数据的 SQL WHERE 条件均包含 user_id 校验。
