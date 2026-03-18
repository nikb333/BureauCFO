-- QBO AR Invoices: individual invoice-level data from QuickBooks Online
-- Run: npx wrangler d1 execute bureau-cfo --file=schema/migrate_qbo_ar_invoices.sql

CREATE TABLE IF NOT EXISTS qbo_ar_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL,
  qbo_invoice_id TEXT NOT NULL,
  doc_number TEXT,
  customer_name TEXT,
  amount_total REAL DEFAULT 0,
  balance_due REAL DEFAULT 0,
  txn_date TEXT,
  due_date TEXT,
  currency TEXT,
  linked_deal_id TEXT,
  match_status TEXT DEFAULT 'unmatched',
  -- match_status: 'matched' | 'unmatched' | 'no_deal'
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(entity_id, qbo_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_qbo_ar_entity ON qbo_ar_invoices(entity_id);
CREATE INDEX IF NOT EXISTS idx_qbo_ar_customer ON qbo_ar_invoices(customer_name);
