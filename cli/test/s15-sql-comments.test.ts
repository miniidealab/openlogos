import { describe, it, expect } from 'vitest';
import { parseSqlComments } from '../src/lib/sql-comments.js';

describe('S15 Unit Tests — parseSqlComments', () => {
  it('UT-S15-01: parse basic column comments', () => {
    const sql = `
CREATE TABLE users (
  -- @comment User unique identifier
  id TEXT PRIMARY KEY NOT NULL,
  -- @comment User email
  email TEXT NOT NULL UNIQUE
);`;
    const result = parseSqlComments(sql);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].name).toBe('users');
    expect(result.tables[0].columns).toHaveLength(2);
    expect(result.tables[0].columns[0]).toEqual({ name: 'id', comment: 'User unique identifier' });
    expect(result.tables[0].columns[1]).toEqual({ name: 'email', comment: 'User email' });
  });

  it('UT-S15-02: parse multi-line @comment concatenation', () => {
    const sql = `
CREATE TABLE accounts (
  -- @comment Account balance in cents
  -- @comment DECIMAL/FLOAT is prohibited
  balance INTEGER NOT NULL DEFAULT 0
);`;
    const result = parseSqlComments(sql);
    expect(result.tables[0].columns[0].comment).toBe('Account balance in cents DECIMAL/FLOAT is prohibited');
  });

  it('UT-S15-03: parse table comments', () => {
    const sql = `
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL
);
-- @table-comment users Core user information table`;
    const result = parseSqlComments(sql);
    expect(result.tables[0].comment).toBe('Core user information table');
  });

  it('UT-S15-04: blank line breaks comment association', () => {
    const sql = `
CREATE TABLE items (
  -- @comment This should be lost

  id TEXT PRIMARY KEY NOT NULL,
  -- @comment Item name
  name TEXT NOT NULL
);`;
    const result = parseSqlComments(sql);
    expect(result.tables[0].columns[0].name).toBe('id');
    expect(result.tables[0].columns[0].comment).toBeUndefined();
    expect(result.tables[0].columns[1].comment).toBe('Item name');
  });

  it('UT-S15-05: FOREIGN KEY does not consume pending comment', () => {
    const sql = `
CREATE TABLE tasks (
  -- @comment Task ID
  id TEXT PRIMARY KEY NOT NULL,
  -- @comment Owner user
  user_id TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);`;
    const result = parseSqlComments(sql);
    expect(result.tables[0].columns).toHaveLength(2);
    expect(result.tables[0].columns[0]).toEqual({ name: 'id', comment: 'Task ID' });
    expect(result.tables[0].columns[1]).toEqual({ name: 'user_id', comment: 'Owner user' });
  });

  it('UT-S15-06: columns without comments return undefined', () => {
    const sql = `
CREATE TABLE simple (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);`;
    const result = parseSqlComments(sql);
    expect(result.tables[0].columns).toHaveLength(2);
    expect(result.tables[0].columns[0].comment).toBeUndefined();
    expect(result.tables[0].columns[1].comment).toBeUndefined();
  });

  it('UT-S15-07: mixed commented and uncommented columns', () => {
    const sql = `
CREATE TABLE mixed (
  -- @comment The primary key
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  -- @comment User email address
  email TEXT UNIQUE
);`;
    const result = parseSqlComments(sql);
    expect(result.tables[0].columns[0].comment).toBe('The primary key');
    expect(result.tables[0].columns[1].comment).toBeUndefined();
    expect(result.tables[0].columns[2].comment).toBe('User email address');
  });

  it('UT-S15-08: multiple tables parsed correctly', () => {
    const sql = `
CREATE TABLE users (
  -- @comment User ID
  id TEXT PRIMARY KEY NOT NULL
);
-- @table-comment users Users table

CREATE TABLE posts (
  -- @comment Post ID
  id TEXT PRIMARY KEY NOT NULL,
  -- @comment Author reference
  author_id TEXT NOT NULL,
  FOREIGN KEY (author_id) REFERENCES users (id)
);
-- @table-comment posts Blog posts table`;
    const result = parseSqlComments(sql);
    expect(result.tables).toHaveLength(2);
    expect(result.tables[0].name).toBe('users');
    expect(result.tables[0].comment).toBe('Users table');
    expect(result.tables[0].columns).toHaveLength(1);
    expect(result.tables[1].name).toBe('posts');
    expect(result.tables[1].comment).toBe('Blog posts table');
    expect(result.tables[1].columns).toHaveLength(2);
  });

  it('UT-S15-09: regular SQL comments do not interfere', () => {
    const sql = `
-- This is a regular header comment
-- Another regular comment
CREATE TABLE data (
  -- Regular comment before column (NOT @comment)
  id INTEGER PRIMARY KEY,
  -- @comment Actual structured comment
  value TEXT NOT NULL
);`;
    const result = parseSqlComments(sql);
    expect(result.tables[0].columns[0].name).toBe('id');
    expect(result.tables[0].columns[0].comment).toBeUndefined();
    expect(result.tables[0].columns[1].comment).toBe('Actual structured comment');
  });

  it('UT-S15-10: CREATE TABLE IF NOT EXISTS supported', () => {
    const sql = `
CREATE TABLE IF NOT EXISTS config (
  -- @comment Config key
  key TEXT PRIMARY KEY NOT NULL,
  -- @comment Config value
  value TEXT
);
-- @table-comment config Application configuration`;
    const result = parseSqlComments(sql);
    expect(result.tables[0].name).toBe('config');
    expect(result.tables[0].comment).toBe('Application configuration');
    expect(result.tables[0].columns).toHaveLength(2);
  });

  it('UT-S15-11: empty SQL returns empty tables', () => {
    expect(parseSqlComments('')).toEqual({ tables: [] });
    expect(parseSqlComments('-- just comments\n-- nothing here')).toEqual({ tables: [] });
  });

  it('UT-S15-12: CHECK constraint lines are skipped', () => {
    const sql = `
CREATE TABLE orders (
  -- @comment Order status
  status TEXT NOT NULL DEFAULT 'pending',
  CHECK (status IN ('pending', 'paid', 'shipped'))
);`;
    const result = parseSqlComments(sql);
    expect(result.tables[0].columns).toHaveLength(1);
    expect(result.tables[0].columns[0]).toEqual({ name: 'status', comment: 'Order status' });
  });

  it('UT-S15-13: indexes and other statements outside CREATE TABLE are ignored', () => {
    const sql = `
CREATE TABLE users (
  -- @comment User ID
  id TEXT PRIMARY KEY NOT NULL
);
-- @table-comment users Users

CREATE INDEX idx_users_email ON users (email);
CREATE UNIQUE INDEX idx_users_name ON users (name);`;
    const result = parseSqlComments(sql);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].columns).toHaveLength(1);
  });
});
