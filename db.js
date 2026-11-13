const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'stockflow.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  default_low_stock INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  cost_price REAL,
  selling_price REAL,
  low_stock_threshold INTEGER,
  last_updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (org_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_products_org ON products(org_id);
`);
module.exports = db;
