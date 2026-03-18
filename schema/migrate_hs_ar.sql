-- Migration: HubSpot invoice-centric AR tables
-- Run once against bureau-cfo D1 database

-- Stores every open HubSpot invoice
CREATE TABLE IF NOT EXISTS hs_invoices (
  id TEXT PRIMARY KEY,
  hs_number TEXT,
  hs_title TEXT,
  hs_status TEXT,
  hs_due_date TEXT,
  hs_amount_billed REAL DEFAULT 0,
  hs_currency TEXT,
  deal_id TEXT,        -- NULL = unlinked (reconciliation queue)
  entity_id TEXT,      -- derived from currency: USD→US, CAD→CA, GBP→UK, AUD→AU
  synced_at TEXT DEFAULT (datetime('now'))
);

-- Stores deal-level AR summary (one row per deal that has open invoices)
CREATE TABLE IF NOT EXISTS hs_ar_deals (
  deal_id TEXT PRIMARY KEY,
  deal_name TEXT,
  owner_id TEXT,
  owner_name TEXT,
  entity_id TEXT,
  currency TEXT,
  close_date TEXT,
  payment_terms TEXT,
  payment_terms_other TEXT,
  install_date TEXT,
  deal_amount REAL DEFAULT 0,
  invoiced_total REAL DEFAULT 0,    -- sum of open invoice amounts for this deal
  invoice_numbers TEXT,             -- comma-separated
  has_open_ticket INTEGER DEFAULT 0,
  ticket_subject TEXT,
  ticket_status TEXT,
  ticket_category TEXT,
  hubspot_deal_url TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
);

-- Owner lookup cache
CREATE TABLE IF NOT EXISTS hs_owners (
  owner_id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
);
