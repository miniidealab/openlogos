const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

class DatabaseManager {
  constructor() {
    this.db = null;
    this.dbPath = null;
  }

  async init() {
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'money-log.db');

    const SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }

    this.createTables();
    this.save();
  }

  createTables() {
    // Categories table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        icon TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);

    // Records table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        remark TEXT,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )
    `);

    // Settings table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Password salt table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS password_salt (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        salt TEXT NOT NULL
      )
    `);

    // Initialize default categories
    const defaultCategories = [
      { name: '餐饮', icon: '🍜' },
      { name: '交通', icon: '🚗' },
      { name: '购物', icon: '🛒' },
      { name: '娱乐', icon: '🎮' },
      { name: '居住', icon: '🏠' },
      { name: '医疗', icon: '💊' },
      { name: '通讯', icon: '📱' },
      { name: '其他', icon: '📦' },
    ];

    for (const cat of defaultCategories) {
      try {
        this.db.run(
          `INSERT OR IGNORE INTO categories (name, icon, is_default) VALUES (?, ?, 1)`,
          [cat.name, cat.icon]
        );
      } catch (e) {
        // Ignore duplicate
      }
    }

    // Initialize default settings
    try {
      this.db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('password_enabled', '0')`);
      this.db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('default_category_id', '1')`);
    } catch (e) {
      // Ignore
    }
  }

  save() {
    if (this.db && this.dbPath) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    }
  }

  // Records
  saveRecord(amount, category_id, remark = null, created_at = null) {
    const amountInCents = Math.round(amount * 100);
    const timestamp = created_at || new Date().toISOString();
    this.db.run(
      `INSERT INTO records (amount, category_id, remark, created_at) VALUES (?, ?, ?, ?)`,
      [amountInCents, category_id, remark, timestamp]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    this.save();
    return result[0].values[0][0];
  }

  getRecords(filters = {}) {
    let sql = `
      SELECT r.id, r.amount, r.category_id, c.name as category_name, 
             c.icon as category_icon, r.created_at, r.remark
      FROM records r
      JOIN categories c ON r.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.start_date) {
      sql += ' AND r.created_at >= ?';
      params.push(filters.start_date);
    }
    if (filters.end_date) {
      sql += ' AND r.created_at <= ?';
      params.push(filters.end_date);
    }
    if (filters.category_id) {
      sql += ' AND r.category_id = ?';
      params.push(filters.category_id);
    }

    sql += ' ORDER BY r.created_at DESC';

    const stmt = this.db.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }

    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        ...row,
        amount: row.amount / 100,
      });
    }
    stmt.free();
    return rows;
  }

  // Statistics
  getStatistics(params) {
    const { time_range, month, start_date, end_date, category_id } = params;

    let dateFilter = '';
    const dateParams = [];

    if (time_range === 'week') {
      dateFilter = "AND r.created_at >= strftime('%Y-%m-%d', 'now', '-7 days')";
    } else if (time_range === 'month' && month) {
      dateFilter = "AND strftime('%Y-%m', r.created_at) = ?";
      dateParams.push(month);
    } else if (time_range === 'custom' && start_date && end_date) {
      dateFilter = 'AND r.created_at >= ? AND r.created_at <= ?';
      dateParams.push(start_date, end_date);
    }

    let categoryFilter = '';
    if (category_id) {
      categoryFilter = 'AND r.category_id = ?';
      dateParams.push(category_id);
    }

    // Total
    const totalSql = `
      SELECT COALESCE(SUM(amount), 0) as total
      FROM records r
      WHERE 1=1 ${dateFilter} ${categoryFilter}
    `;
    const totalStmt = this.db.prepare(totalSql);
    if (dateParams.length > 0) {
      totalStmt.bind(dateParams);
    }
    totalStmt.step();
    const totalResult = totalStmt.getAsObject();
    const total = (totalResult.total || 0) / 100;
    totalStmt.free();

    // Daily data
    const dailySql = `
      SELECT strftime('%Y-%m-%d', created_at) as date, SUM(amount) as amount
      FROM records r
      WHERE 1=1 ${dateFilter} ${categoryFilter}
      GROUP BY strftime('%Y-%m-%d', created_at)
      ORDER BY date
    `;
    const dailyStmt = this.db.prepare(dailySql);
    if (dateParams.length > 0) {
      dailyStmt.bind(dateParams);
    }
    const dailyRows = [];
    while (dailyStmt.step()) {
      const row = dailyStmt.getAsObject();
      dailyRows.push({
        date: row.date,
        amount: row.amount / 100,
      });
    }
    dailyStmt.free();

    // By category
    const byCategorySql = `
      SELECT r.category_id, c.name as category_name, SUM(amount) as amount
      FROM records r
      JOIN categories c ON r.category_id = c.id
      WHERE 1=1 ${dateFilter} ${categoryFilter}
      GROUP BY r.category_id
      ORDER BY amount DESC
    `;
    const categoryStmt = this.db.prepare(byCategorySql);
    if (dateParams.length > 0) {
      categoryStmt.bind(dateParams);
    }
    const categoryRows = [];
    while (categoryStmt.step()) {
      const row = categoryStmt.getAsObject();
      const amount = row.amount / 100;
      categoryRows.push({
        category_id: row.category_id,
        category_name: row.category_name,
        amount,
        percent: total > 0 ? Math.round((amount / total) * 100) : 0,
      });
    }
    categoryStmt.free();

    return {
      total,
      daily: dailyRows,
      by_category: categoryRows,
    };
  }

  // Categories
  getCategories() {
    const stmt = this.db.prepare(`
      SELECT id, name, icon, is_default, created_at
      FROM categories
      ORDER BY is_default DESC, id
    `);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  addCategory(name) {
    this.db.run(`INSERT INTO categories (name, is_default) VALUES (?, 0)`, [name]);
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    this.save();
    return result[0].values[0][0];
  }

  updateCategory(id, name) {
    this.db.run(`UPDATE categories SET name = ? WHERE id = ? AND is_default = 0`, [name, id]);
    this.save();
  }

  deleteCategory(id) {
    // Get the default category id (other)
    const defaultStmt = this.db.prepare(`SELECT id FROM categories WHERE name = '其他' AND is_default = 1`);
    defaultStmt.step();
    const defaultCat = defaultStmt.getAsObject();
    defaultStmt.free();

    // Update records to use default category
    this.db.run(`UPDATE records SET category_id = ? WHERE category_id = ?`, [defaultCat.id, id]);

    // Delete the category
    this.db.run(`DELETE FROM categories WHERE id = ? AND is_default = 0`, [id]);
    this.save();
  }

  // Settings
  getSetting(key) {
    const stmt = this.db.prepare(`SELECT value FROM settings WHERE key = ?`);
    stmt.bind([key]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return row.value || null;
  }

  setSetting(key, value) {
    this.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
    this.save();
  }

  // Password
  setPassword(password) {
    const salt = crypto.randomBytes(32).toString('base64');
    const hash = crypto.createHash('sha256').update(password + salt).digest('hex');

    this.db.run(`DELETE FROM password_salt WHERE id = 1`);
    this.db.run(`INSERT INTO password_salt (id, salt) VALUES (1, ?)`, [salt]);
    this.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('password_hash', ?)`, [hash]);
    this.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('password_enabled', '1')`);
    this.save();
  }

  verifyPassword(password) {
    const saltStmt = this.db.prepare(`SELECT salt FROM password_salt WHERE id = 1`);
    saltStmt.step();
    const saltRow = saltStmt.getAsObject();
    saltStmt.free();

    const hashStmt = this.db.prepare(`SELECT value FROM settings WHERE key = 'password_hash'`);
    hashStmt.step();
    const hashRow = hashStmt.getAsObject();
    hashStmt.free();

    if (!saltRow.salt || !hashRow.value) {
      return false;
    }

    const hash = crypto.createHash('sha256').update(password + saltRow.salt).digest('hex');
    return hash === hashRow.value;
  }

  // App reset
  resetApp() {
    this.db.run(`DELETE FROM records`);
    this.db.run(`DELETE FROM categories WHERE is_default = 0`);
    this.db.run(`DELETE FROM password_salt`);
    this.db.run(`UPDATE settings SET value = '0' WHERE key = 'password_enabled'`);
    this.db.run(`DELETE FROM settings WHERE key = 'password_hash'`);
    this.save();
  }
}

module.exports = DatabaseManager;
