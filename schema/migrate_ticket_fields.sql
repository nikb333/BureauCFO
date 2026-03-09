-- Add ticket-related columns to ar_overrides
-- Run: npx wrangler d1 execute bureau-cfo --file=schema/migrate_ticket_fields.sql

ALTER TABLE ar_overrides ADD COLUMN has_open_ticket INTEGER DEFAULT 0;
ALTER TABLE ar_overrides ADD COLUMN ticket_subject TEXT;
ALTER TABLE ar_overrides ADD COLUMN ticket_status TEXT;
ALTER TABLE ar_overrides ADD COLUMN ticket_priority TEXT;
ALTER TABLE ar_overrides ADD COLUMN ticket_category TEXT;
