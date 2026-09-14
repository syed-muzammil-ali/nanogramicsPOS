// Additive POS schema v1. Keep existing business rows and column layouts intact.
const MIGRATION_KEY = 'schema:pos_upgrades';
const VERSION = '1';

function normalizeSQL(sql) {
  return sql.replace(/\bIF NOT EXISTS\s+/gi, '').replace(/;\s*$/, '')
    .replace(/\s+/g, ' ').trim();
}

async function inspect(tx) {
  const version = await tx.queryRows('SELECT value FROM settings WHERE key = ?', [MIGRATION_KEY]);
  if (version.length && version[0].value !== VERSION) {
    throw new Error('Unsupported POS upgrade schema version; database was not migrated');
  }
  for (const sql of statements) {
    const [, type, name] = sql.match(/^CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER)\s+IF NOT EXISTS\s+(\w+)/i);
    const objects = await tx.queryRows('SELECT type, sql FROM sqlite_master WHERE name = ?', [name]);
    if (objects.length && (objects[0].type !== type.toLowerCase() ||
        normalizeSQL(objects[0].sql || '') !== normalizeSQL(sql))) {
      throw new Error(`Conflicting database object: ${name}; database was not migrated`);
    }
    if (version.length && !objects.length) {
      throw new Error(`Incomplete POS upgrade schema: ${name}`);
    }
  }
  return version.length > 0;
}

async function apply(db, beforeMigration) {
  if (await inspect(db)) return { applied: false };
  // The caller must create a verified snapshot of the actual connection first.
  if (typeof beforeMigration !== 'function') throw new Error('Migration backup is required');
  const backupPath = await beforeMigration();
  return db.runTransaction(async tx => {
    if (await inspect(tx)) return { applied: false, backupPath };
    for (const sql of statements) await tx.exec(sql);
    const now = new Date().toISOString();
    const existing = await tx.queryRows("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND length(category) > 0");
    const names = new Set(['Suits', 'Accessories', 'Single Pcs', ...existing.map(row => row.category)]);
    for (const name of names) {
      await tx.exec('INSERT INTO categories (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING', [name, now]);
    }
    const warehouses = await tx.queryRows("SELECT id FROM stock_locations WHERE kind = 'warehouse'");
    if (!warehouses.length) {
      await tx.exec("INSERT INTO stock_locations (name, kind, created_at) VALUES (?, 'warehouse', ?)", ['Warehouse', now]);
    }
    for (const table of ['stock_transfers', 'stock_transfer_items', 'bill_pdf_records']) {
      const violations = await tx.queryRows(`PRAGMA foreign_key_check(${table})`);
      if (violations.length) throw new Error(`Foreign key violations in ${table}`);
    }
    await tx.exec('INSERT INTO settings (key, value) VALUES (?, ?)', [MIGRATION_KEY, VERSION]);
    return { applied: true, backupPath };
  });
}

module.exports = { apply, MIGRATION_KEY, VERSION };

const statements = [
  `CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT
);`,

  `CREATE TRIGGER IF NOT EXISTS categories_prevent_used_delete
BEFORE DELETE ON categories
WHEN EXISTS (
  SELECT 1 FROM products
  WHERE lower(trim(category)) = lower(trim(OLD.name))
)
BEGIN
  SELECT RAISE(ABORT, 'Category is in use by products');
END;`,

  `CREATE TRIGGER IF NOT EXISTS categories_prevent_used_rename
BEFORE UPDATE OF name ON categories
WHEN NEW.name <> OLD.name AND EXISTS (
  SELECT 1 FROM products
  WHERE lower(trim(category)) = lower(trim(OLD.name))
)
BEGIN
  SELECT RAISE(ABORT, 'Category is in use by products');
END;`,

  `CREATE TABLE IF NOT EXISTS stock_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('warehouse', 'shop')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT
);`,

  `CREATE UNIQUE INDEX IF NOT EXISTS stock_locations_one_warehouse
ON stock_locations(kind) WHERE kind = 'warehouse';`,

  `CREATE TABLE IF NOT EXISTS stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_number TEXT NOT NULL UNIQUE,
  person_name TEXT NOT NULL CHECK (length(trim(person_name)) > 0),
  source_location_id INTEGER NOT NULL
    REFERENCES stock_locations(id) ON DELETE RESTRICT,
  destination_location_id INTEGER NOT NULL
    REFERENCES stock_locations(id) ON DELETE RESTRICT,
  transferred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'cancelled')),
  original_transfer_id INTEGER
    REFERENCES stock_transfers(id) ON DELETE RESTRICT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_username TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT,
  posted_at TEXT,
  CHECK (source_location_id <> destination_location_id),
  CHECK (original_transfer_id IS NULL OR original_transfer_id <> id),
  CHECK ((status = 'posted' AND posted_at IS NOT NULL)
      OR (status <> 'posted' AND posted_at IS NULL))
);`,

  `CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL
    REFERENCES stock_transfers(id) ON DELETE RESTRICT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
  reference_price REAL NOT NULL DEFAULT 0 CHECK (reference_price >= 0),
  original_transfer_item_id INTEGER
    REFERENCES stock_transfer_items(id) ON DELETE RESTRICT,
  UNIQUE (transfer_id, product_code),
  CHECK (original_transfer_item_id IS NULL OR original_transfer_item_id <> id)
);`,

  `CREATE INDEX IF NOT EXISTS stock_transfers_source_status_date
ON stock_transfers(source_location_id, status, transferred_at);`,

  `CREATE INDEX IF NOT EXISTS stock_transfers_destination_status_date
ON stock_transfers(destination_location_id, status, transferred_at);`,

  `CREATE INDEX IF NOT EXISTS stock_transfers_original
ON stock_transfers(original_transfer_id);`,

  `CREATE INDEX IF NOT EXISTS stock_transfers_creator
ON stock_transfers(created_by_user_id);`,

  `CREATE INDEX IF NOT EXISTS stock_transfer_items_product
ON stock_transfer_items(product_id);`,

  `CREATE INDEX IF NOT EXISTS stock_transfer_items_original
ON stock_transfer_items(original_transfer_item_id);`,

  `CREATE TABLE IF NOT EXISTS bill_pdf_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('sale', 'online')),
  invoice_reference TEXT NOT NULL,
  sale_id TEXT REFERENCES sales(id) ON DELETE SET NULL,
  online_order_id TEXT REFERENCES online_orders(id) ON DELETE SET NULL,
  pdf_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'available', 'missing', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  last_checked_at TEXT,
  UNIQUE (invoice_type, invoice_reference),
  CHECK (
    (invoice_type = 'sale' AND online_order_id IS NULL
      AND (sale_id IS NULL OR sale_id = invoice_reference))
    OR
    (invoice_type = 'online' AND sale_id IS NULL
      AND (online_order_id IS NULL OR online_order_id = invoice_reference))
  ),
  CHECK (status <> 'available' OR
    (pdf_path IS NOT NULL AND length(trim(pdf_path)) > 0))
);`,

  `CREATE INDEX IF NOT EXISTS bill_pdf_records_sale
ON bill_pdf_records(sale_id);`,

  `CREATE INDEX IF NOT EXISTS bill_pdf_records_online_order
ON bill_pdf_records(online_order_id);`
];
