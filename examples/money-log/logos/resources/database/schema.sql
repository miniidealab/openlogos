-- =====================================================
-- 轻记账 SQLite 数据库 Schema
-- 来源：local-api.yaml
-- 数据库：SQLite 3
-- 生成时间：2026-04-09
-- =====================================================

PRAGMA foreign_keys = ON;

-- -------------------------------------------------------
-- 分类表（来源：categories API）
-- -------------------------------------------------------
-- @table-comment categories 支出分类表，预设分类不可删除，自定义分类可增删改
CREATE TABLE IF NOT EXISTS categories (
    -- @comment 分类唯一标识，自增主键
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- @comment 分类名称，唯一约束
    name TEXT NOT NULL UNIQUE,
    -- @comment 分类图标emoji（可选）
    icon TEXT,
    -- @comment 是否为预设分类（0-自定义，1-预设）
    is_default INTEGER NOT NULL DEFAULT 0,
    -- @comment 创建时间，ISO 8601 格式
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 预设分类数据
INSERT OR IGNORE INTO categories (id, name, icon, is_default) VALUES
    (1, '餐饮', '🍜', 1),
    (2, '交通', '🚗', 1),
    (3, '购物', '🛒', 1),
    (4, '娱乐', '🎮', 1),
    (5, '居住', '🏠', 1),
    (6, '医疗', '💊', 1),
    (7, '通讯', '📱', 1),
    (8, '其他', '📦', 1);

-- -------------------------------------------------------
-- 记账记录表（来源：records API）
-- -------------------------------------------------------
-- @table-comment records 记账记录表，存储用户每笔支出
CREATE TABLE IF NOT EXISTS records (
    -- @comment 记录唯一标识，自增主键
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- @comment 金额（单位：元，存分值避免浮点精度问题）
    amount INTEGER NOT NULL,
    -- @comment 分类 ID，外键关联 categories
    category_id INTEGER NOT NULL,
    -- @comment 创建时间，ISO 8601 格式
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- @comment 备注（可选，最长200字符）
    remark TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- 索引：按时间范围查询
CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at);
-- 索引：按分类查询
CREATE INDEX IF NOT EXISTS idx_records_category_id ON records(category_id);

-- -------------------------------------------------------
-- 设置表（来源：settings API）
-- -------------------------------------------------------
-- @table-comment settings 用户配置表，存储密码锁等设置
CREATE TABLE IF NOT EXISTS settings (
    -- @comment 设置键名，主键
    key TEXT PRIMARY KEY,
    -- @comment 设置值（密码相关存哈希后的值）
    value TEXT NOT NULL
);

-- 初始化默认设置
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('password_enabled', '0'),
    ('default_category_id', '1');

-- -------------------------------------------------------
-- 密码相关辅助表（可选，用于存储密码历史等）
-- -------------------------------------------------------
-- @table-comment password_salt 密码盐值表，存储每个密码的盐
CREATE TABLE IF NOT EXISTS password_salt (
    -- @comment 盐值标识符，目前只支持单密码
    id INTEGER PRIMARY KEY CHECK (id = 1),
    -- @comment 随机盐值，base64编码
    salt TEXT NOT NULL
);

-- =====================================================
-- 视图（简化查询）
-- =====================================================

-- 视图：带分类名的记录列表
CREATE VIEW IF NOT EXISTS v_records_with_category AS
SELECT 
    r.id,
    r.amount,
    r.category_id,
    c.name AS category_name,
    c.icon AS category_icon,
    r.created_at,
    r.remark
FROM records r
JOIN categories c ON r.category_id = c.id;

-- =====================================================
-- 初始化 SQL（首次运行执行）
-- =====================================================

-- 首次初始化预设分类（如果不存在）
INSERT OR IGNORE INTO categories (id, name, icon, is_default) VALUES
    (1, '餐饮', '🍜', 1),
    (2, '交通', '🚗', 1),
    (3, '购物', '🛒', 1),
    (4, '娱乐', '🎮', 1),
    (5, '居住', '🏠', 1),
    (6, '医疗', '💊', 1),
    (7, '通讯', '📱', 1),
    (8, '其他', '📦', 1);
