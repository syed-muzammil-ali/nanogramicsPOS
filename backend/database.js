/**
 * DATABASE SERVICE — SQLite3
 * Updated: Added online_returns table for simple online return entries
 */

const sqlite3 = require('sqlite3').verbose();
const bcrypt  = require('bcryptjs');
const path    = require('path');
const os      = require('os');
const fs      = require('fs');
const { app } = require('electron');
const posUpgradeMigration = require('./pos-upgrade-migration');
const { randomUUID } = require('crypto');

class DatabaseService {

  constructor() {
    const userDataDir = app && app.isReady() ? app.getPath('userData') : (app && app.isPackaged ? app.getPath('userData') : path.join(os.homedir(), '.lajpal-pos'));
    const appDir = path.join(userDataDir, app && app.isPackaged ? 'data' : '');
    if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
    this.dbPath = path.join(appDir, 'pos_system.db');
    this.db = null;
    this._queue = Promise.resolve();
    this._inTransaction = false;
  }

  _enqueue(operation) {
    const run = this._queue.then(() => operation());
    this._queue = run.catch(() => {});
    return run;
  }

  // ── INITIALIZE ─────────────────────────────────────────────
  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, async (err) => {
        if (err) { reject(err); return; }
        console.log('SQLite connected:', this.dbPath);
        try {
          // Enable WAL mode for better concurrency and crash recovery
          await this.execRaw('PRAGMA journal_mode = WAL');
          // Enable foreign key constraints
          await this.execRaw('PRAGMA foreign_keys = ON');
          // Set synchronous mode to NORMAL for better performance with safety
          await this.execRaw('PRAGMA synchronous = NORMAL');
          // Set busy timeout to handle concurrent access
          await this.execRaw('PRAGMA busy_timeout = 5000');
          
          await this.createSchema();
          await this.applyPosUpgradeMigration();
          await this.seedInitialData();
          console.log('Database ready (WAL mode enabled)');
          resolve(true);
        } catch (e) { reject(e); }
      });
    });
  }

  // ── SCHEMA ─────────────────────────────────────────────────
  async createSchema() {
    const tables = [

      // UPDATED: Added designation, description, permissions, status
      `CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'cashier',
        designation   TEXT DEFAULT '',
        description   TEXT DEFAULT '',
        permissions   TEXT DEFAULT '[]',
        status        TEXT DEFAULT 'active',
        created_at    TEXT NOT NULL,
        updated_at    TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS products (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        code       TEXT UNIQUE NOT NULL,
        name       TEXT NOT NULL,
        brand      TEXT DEFAULT '',
        type       TEXT DEFAULT '',
        price      REAL NOT NULL DEFAULT 0,
        qty        INTEGER NOT NULL DEFAULT 999,
        desc       TEXT DEFAULT '',
        category   TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS sales (
        id             TEXT PRIMARY KEY,
        user_id        INTEGER,
        subtotal       REAL NOT NULL,
        discount       REAL DEFAULT 0,
        cashback       REAL DEFAULT 0,
        delivery       REAL DEFAULT 0,
        tax            REAL DEFAULT 0,
        total          REAL NOT NULL,
        payment_method TEXT,
        payment_status TEXT,
        notes          TEXT,
        return_status  TEXT DEFAULT 'none',
        returned_items TEXT DEFAULT '[]',
        exchange_status TEXT DEFAULT 'none',
        created_at     TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS sale_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id      TEXT NOT NULL,
        product_code TEXT NOT NULL,
        product_name TEXT NOT NULL,
        brand        TEXT DEFAULT '',
        type         TEXT DEFAULT '',
        qty          INTEGER NOT NULL,
        price        REAL NOT NULL,
        subtotal     REAL NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS online_orders (
        id                TEXT PRIMARY KEY,
        customer_name     TEXT NOT NULL,
        customer_phone    TEXT NOT NULL,
        customer_address  TEXT DEFAULT '',
        city              TEXT DEFAULT '',
        items_json        TEXT DEFAULT '[]',
        subtotal          REAL DEFAULT 0,
        delivery          REAL DEFAULT 0,
        discount          REAL DEFAULT 0,
        total             REAL DEFAULT 0,
        payment_status    TEXT DEFAULT 'cod',
        order_status      TEXT DEFAULT 'pending',
        notes             TEXT DEFAULT '',
        weight            REAL DEFAULT 0,
        qty_of_goods      INTEGER DEFAULT 0,
        goods_description TEXT DEFAULT '',
        return_status     TEXT DEFAULT 'none',
        returned_items    TEXT DEFAULT '[]',
        exchange_status   TEXT DEFAULT 'none',
        created_at        TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS user_performance_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        username   TEXT NOT NULL,
        order_id   TEXT NOT NULL,
        order_type TEXT NOT NULL DEFAULT 'online',
        pieces     INTEGER NOT NULL DEFAULT 0,
        amount     REAL NOT NULL DEFAULT 0,
        is_return  INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS commission_rates (
        user_id              INTEGER PRIMARY KEY,
        commission_per_piece REAL DEFAULT 0,
        updated_at           TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS returns (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id     TEXT NOT NULL,
        invoice_type   TEXT NOT NULL,
        return_type    TEXT NOT NULL,
        return_reason  TEXT DEFAULT '',
        return_qty     INTEGER NOT NULL DEFAULT 0,
        items_json     TEXT DEFAULT '[]',
        original_items TEXT DEFAULT '[]',
        customer_name  TEXT DEFAULT '',
        customer_phone TEXT DEFAULT '',
        total_amount   REAL DEFAULT 0,
        refund_amount  REAL DEFAULT 0,
        user_id        INTEGER DEFAULT 0,
        username       TEXT DEFAULT '',
        created_at     TEXT NOT NULL
      )`,

      // NEW TABLE: Simple online returns (not linked to any order)
      `CREATE TABLE IF NOT EXISTS online_returns (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        return_amount   REAL NOT NULL,
        return_pieces   INTEGER NOT NULL,
        description     TEXT DEFAULT '',
        user_id         INTEGER DEFAULT 0,
        username        TEXT DEFAULT '',
        created_at      TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS exchanges (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        exchange_number       TEXT,
        original_invoice_id   TEXT NOT NULL,
        invoice_type          TEXT NOT NULL,
        original_items        TEXT DEFAULT '[]',
        new_items             TEXT DEFAULT '[]',
        new_qty_of_goods      INTEGER DEFAULT 0,
        new_goods_description TEXT DEFAULT '',
        new_address           TEXT DEFAULT '',
        original_amount       REAL DEFAULT 0,
        new_amount            REAL DEFAULT 0,
        additional_amount     REAL DEFAULT 0,
        refund_amount         REAL DEFAULT 0,
        reason                TEXT DEFAULT '',
        customer_name         TEXT DEFAULT '',
        customer_phone        TEXT DEFAULT '',
        user_id               INTEGER DEFAULT 0,
        username              TEXT DEFAULT '',
        created_at            TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS audit_log (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp      TEXT NOT NULL,
        user_id        INTEGER,
        username       TEXT NOT NULL,
        user_role      TEXT NOT NULL,
        system_type    TEXT NOT NULL,
        action         TEXT NOT NULL,
        invoice_number TEXT,
        customer_name  TEXT,
        details        TEXT,
        created_at     TEXT NOT NULL
      )`
    ];

    for (const sql of tables) {
      await this.execRaw(sql);
    }

    // ── MIGRATIONS — ignore "column already exists" errors ────
    const migrations = [
      // Existing migrations
      `ALTER TABLE online_orders ADD COLUMN weight           REAL    DEFAULT 0`,
      `ALTER TABLE online_orders ADD COLUMN notes            TEXT    DEFAULT ''`,
      `ALTER TABLE online_orders ADD COLUMN discount         REAL    DEFAULT 0`,
      `ALTER TABLE online_orders ADD COLUMN delivery         REAL    DEFAULT 0`,
      `ALTER TABLE online_orders ADD COLUMN subtotal         REAL    DEFAULT 0`,
      `ALTER TABLE online_orders ADD COLUMN city             TEXT    DEFAULT ''`,
      `ALTER TABLE products      ADD COLUMN category         TEXT    DEFAULT ''`,
      `ALTER TABLE online_orders ADD COLUMN order_status     TEXT    DEFAULT 'pending'`,
      `ALTER TABLE sales         ADD COLUMN created_by_username TEXT  DEFAULT ''`,
      `ALTER TABLE sales         ADD COLUMN cashback         REAL    DEFAULT 0`,
      `ALTER TABLE online_orders ADD COLUMN qty_of_goods     INTEGER DEFAULT 0`,
      `ALTER TABLE online_orders ADD COLUMN goods_description TEXT   DEFAULT ''`,
      `ALTER TABLE online_orders ADD COLUMN return_status    TEXT    DEFAULT 'none'`,
      `ALTER TABLE online_orders ADD COLUMN returned_items   TEXT    DEFAULT '[]'`,
      `ALTER TABLE sales         ADD COLUMN return_status    TEXT    DEFAULT 'none'`,
      `ALTER TABLE sales         ADD COLUMN returned_items   TEXT    DEFAULT '[]'`,
      `ALTER TABLE online_orders ADD COLUMN exchange_status  TEXT    DEFAULT 'none'`,
      `ALTER TABLE sales         ADD COLUMN exchange_status  TEXT    DEFAULT 'none'`,
      `ALTER TABLE exchanges     ADD COLUMN reason           TEXT    DEFAULT ''`,

      // NEW MIGRATIONS — user management extensions
      `ALTER TABLE users ADD COLUMN designation  TEXT DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN description  TEXT DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN permissions  TEXT DEFAULT '[]'`,
      `ALTER TABLE users ADD COLUMN status       TEXT DEFAULT 'active'`,
    ];

    for (const m of migrations) {
      try { await this.execRaw(m); } catch(e) { /* column already exists — ok */ }
    }

    console.log('Schema ready');
  }

  async applyPosUpgradeMigration() {
    return posUpgradeMigration.apply(this, () => this.createMigrationBackup());
  }

  async createMigrationBackup() {
    // VACUUM INTO includes committed WAL data and uses the actual open database.
    // Do not use main.js's independently computed DB_PATH or move existing files.
    const backupDir = path.join(path.dirname(this.dbPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `before_pos_upgrade_v1_${randomUUID()}.db`);
    await this._enqueue(() => this._execDirect('VACUUM INTO ?', [backupPath]));
    await new Promise((resolve, reject) => {
      const snapshot = new sqlite3.Database(backupPath, sqlite3.OPEN_READONLY, error => {
        if (error) { reject(error); return; }
        snapshot.all('PRAGMA quick_check', (checkError, rows) => {
          snapshot.close(closeError => {
            if (checkError || closeError) { reject(checkError || closeError); return; }
            if (rows.length !== 1 || rows[0].quick_check !== 'ok') {
              reject(new Error('Migration backup verification failed'));
            } else resolve();
          });
        });
      });
    });
    return backupPath;
  }

  // ── SEED ───────────────────────────────────────────────────
  async seedInitialData() {
    const adminRows = await this.queryRows('SELECT id FROM users WHERE username = ?', ['admin']);

    if (adminRows.length === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      await this.exec(
        `INSERT INTO users (username, password_hash, role, designation, description, permissions, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['admin', hash, 'admin', 'System Administrator', 'Full system access', '[]', 'active', new Date().toISOString()]
      );
      console.log('Default admin created on first install');
    } else {
      console.log('Admin verified; existing account preserved');
    }

    console.log('Seed complete');
  }

  // ── QUERY ──────────────────────────────────────────────────
  _queryRowsDirect(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) { console.error('Query error:', err.message, sql); reject(err); }
        else resolve(rows || []);
      });
    });
  }

  queryRows(sql, params = []) {
    return this._enqueue(() => this._queryRowsDirect(sql, params));
  }

  // ── EXEC ───────────────────────────────────────────────────
  _execDirect(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) { console.error('Exec error:', err.message, sql); reject(err); }
        else resolve({ success: true, changes: this.changes, lastID: this.lastID });
      });
    });
  }

  exec(sql, params = []) {
    return this._enqueue(() => this._execDirect(sql, params));
  }

  /**
   * Run work inside a single serialized BEGIN IMMEDIATE … COMMIT block.
   * Callback receives { queryRows, exec } that operate on the same connection
   * without re-entering the outer queue (prevents nested-transaction deadlocks).
   */
  runTransaction(work) {
    return this._enqueue(async () => {
      if (this._inTransaction) {
        throw new Error('Nested transactions are not supported');
      }
      this._inTransaction = true;
      const tx = {
        queryRows: (sql, params) => this._queryRowsDirect(sql, params),
        exec:      (sql, params) => this._execDirect(sql, params),
      };
      try {
        await this._execDirect('BEGIN IMMEDIATE');
        const result = await work(tx);
        await this._execDirect('COMMIT');
        return result;
      } catch (err) {
        try { await this._execDirect('ROLLBACK'); } catch (_) {}
        throw err;
      } finally {
        this._inTransaction = false;
      }
    });
  }

  // ── RAW ────────────────────────────────────────────────────
  execRaw(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  }

  // ── CLOSE ──────────────────────────────────────────────────
  close() {
    if (this.db) {
      this.db.close(err => {
        if (err) console.error('Close error:', err);
        else console.log('Database closed');
      });
    }
  }

  // ── DUPLICATE CHECK ────────────────────────────────────────
  async checkDuplicateOrder(orderId) {
    const existing = await this.queryRows('SELECT id FROM online_orders WHERE id = ?', [orderId]);
    return existing.length > 0;
  }

  // ── DATA INTEGRITY CHECK ───────────────────────────────────
  async verifyDataIntegrity() {
    try {
      // Check for orphaned sale_items
      const orphanedItems = await this.queryRows(
        'SELECT COUNT(*) as count FROM sale_items WHERE sale_id NOT IN (SELECT id FROM sales)'
      );
      
      // Check for orphaned returns
      const orphanedReturns = await this.queryRows(
        'SELECT COUNT(*) as count FROM returns WHERE invoice_id NOT IN (SELECT id FROM sales UNION SELECT id FROM online_orders)'
      );
      
      // Check for orphaned performance logs
      const orphanedPerf = await this.queryRows(
        'SELECT COUNT(*) as count FROM user_performance_log WHERE order_id NOT IN (SELECT id FROM online_orders)'
      );
      
      return {
        orphanedItems: orphanedItems[0]?.count || 0,
        orphanedReturns: orphanedReturns[0]?.count || 0,
        orphanedPerf: orphanedPerf[0]?.count || 0,
        status: 'ok'
      };
    } catch (err) {
      console.error('Integrity check failed:', err);
      return { status: 'error', error: err.message };
    }
  }

  // ── AUDIT LOG HELPERS ─────────────────────────────────────
  async logAuditEntry(entry) {
    const now = new Date().toISOString();
    return await this.exec(
      `INSERT INTO audit_log
       (timestamp, user_id, username, user_role, system_type, action, invoice_number, customer_name, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.timestamp || now,
        entry.user_id   || 0,
        entry.username  || 'System',
        entry.user_role || 'system',
        entry.system_type || 'Offline',
        entry.action    || 'Unknown Action',
        entry.invoice_number || '',
        entry.customer_name  || '',
        entry.details   || '',
        now
      ]
    );
  }

  async getAuditLogs(filters = {}) {
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];
    if (filters.startDate) { sql += ' AND date(created_at) >= ?'; params.push(filters.startDate); }
    if (filters.endDate)   { sql += ' AND date(created_at) <= ?'; params.push(filters.endDate);   }
    if (filters.userId)    { sql += ' AND user_id = ?';           params.push(filters.userId);     }
    if (filters.action)    { sql += ' AND action LIKE ?';         params.push(`%${filters.action}%`); }
    if (filters.username)  { sql += ' AND username LIKE ?';       params.push(`%${filters.username}%`); }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    return await this.queryRows(sql, params);
  }

  async clearOldAuditLogs(days = 90) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return await this.exec('DELETE FROM audit_log WHERE created_at < ?', [cutoff.toISOString()]);
  }
}

module.exports = DatabaseService;
