-- Syft AR individual customer balances (for reconciliation with HubSpot deals)
CREATE TABLE IF NOT EXISTS syft_ar_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  total_due REAL NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_syft_ar_entity ON syft_ar_customers(entity_id);
