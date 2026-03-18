-- Add install_status and has_draft_only columns to hs_ar_deals
-- Run: npx wrangler d1 execute bureau-cfo --remote --file=schema/migrate_install_status.sql
-- Safe to run even if columns already exist (SQLite will error silently)

ALTER TABLE hs_ar_deals ADD COLUMN install_status TEXT DEFAULT NULL;
ALTER TABLE hs_ar_deals ADD COLUMN has_draft_only INTEGER DEFAULT 0;
