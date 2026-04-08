PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id         INTEGER  PRIMARY KEY AUTOINCREMENT,
    username   TEXT     NOT NULL UNIQUE,
    password   TEXT     NOT NULL,
    created_at TEXT     NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT     NOT NULL CHECK (length(name) >= 1 AND length(name) <= 20),
    created_at TEXT     NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);

CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER  REFERENCES categories(id) ON DELETE SET NULL,
    name        TEXT     NOT NULL CHECK (length(name) >= 1 AND length(name) <= 100),
    note        TEXT     CHECK (note IS NULL OR length(note) <= 500),
    done        INTEGER  NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    created_at  TEXT     NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_done ON tasks(user_id, done);
