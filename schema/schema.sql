-- Bureau CFO Dashboard — D1 Schema
-- Database: bureau-cfo (e9f1733a-d06b-45b5-806b-4f0cbb0c9f93)

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  fx_rate REAL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  account_name TEXT NOT NULL,
  balance REAL DEFAULT 0,
  account_type TEXT DEFAULT 'chequing',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id),
  amount REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  frequency TEXT DEFAULT 'monthly',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opex (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id),
  marketing REAL DEFAULT 0,
  rent REAL DEFAULT 0,
  misc REAL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ar_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hubspot_deal_id TEXT,
  entity_id TEXT NOT NULL,
  deal_name TEXT,
  owner TEXT,
  amount REAL,
  paid REAL DEFAULT 0,
  outstanding REAL,
  currency TEXT,
  payment_terms TEXT,
  close_date TEXT,
  promised_date TEXT,
  install_date TEXT,
  status TEXT DEFAULT 'current',
  overdue INTEGER DEFAULT 0,
  collect_override_date TEXT,
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ap_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL,
  vendor_name TEXT,
  amount REAL,
  due_date TEXT,
  source TEXT DEFAULT 'syft',
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_po_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL,
  po_ref TEXT,
  supplier TEXT,
  deposit_amount REAL DEFAULT 0,
  deposit_due TEXT,
  release_amount REAL DEFAULT 0,
  release_due TEXT,
  source TEXT DEFAULT 'bureau_ops',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trade_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL DEFAULT 'AU',
  reference TEXT,
  po_ref TEXT,
  outstanding REAL DEFAULT 0,
  settlement REAL DEFAULT 0,
  maturity_date TEXT,
  rate REAL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
