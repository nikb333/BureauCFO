-- Add invoice_coverage_flag to hs_ar_deals for 50/50 partial invoicing detection
-- Run: npx wrangler d1 execute bureau-cfo --remote --file=schema/migrate_invoice_coverage.sql

ALTER TABLE hs_ar_deals ADD COLUMN invoice_coverage_flag TEXT DEFAULT NULL;
-- Values:
-- NULL              = no issue / not applicable
-- 'partial'         = only first invoice raised (second not yet created)
-- 'discrepancy'     = invoice total is significantly different from deal amount
-- 'over_invoiced'   = invoiced more than deal amount (possible error)

-- Patch Loblaw immediately (first invoice only, 47.5% invoiced)
UPDATE hs_ar_deals SET
  invoice_coverage_flag = 'partial',
  deal_amount = 160040.65
WHERE deal_id = '55927648370';
