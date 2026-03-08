-- Seed data for Bureau CFO Dashboard

INSERT OR REPLACE INTO entities (id, label, name, currency, fx_rate) VALUES
  ('US', 'United States', 'Inbox US', 'USD', 1.0),
  ('CA', 'Canada', 'Inbox CA', 'CAD', 0.7013),
  ('UK', 'United Kingdom', 'Bureau UK', 'GBP', 1.2732),
  ('AU', 'Australia', 'Urban Rooms AU', 'AUD', 0.6318);

INSERT OR REPLACE INTO bank_accounts (entity_id, account_name, balance, account_type) VALUES
  ('US', 'Chequing', 483000, 'chequing'),
  ('US', 'Amex', 91000, 'credit'),
  ('CA', 'Chequing', 18000, 'chequing'),
  ('CA', 'Savings', 0, 'savings'),
  ('CA', 'Chequing USD', 3000, 'chequing_usd'),
  ('CA', 'Amex', 95000, 'credit'),
  ('UK', 'Chequing', 27000, 'chequing'),
  ('AU', 'CBA', 50000, 'chequing'),
  ('AU', 'Amex', 115000, 'credit');

INSERT OR REPLACE INTO payroll (entity_id, amount, tax, frequency) VALUES
  ('US', 90000, 2000, 'bimonthly'),
  ('CA', 100000, 60000, 'bimonthly'),
  ('UK', 45000, 10000, 'monthly'),
  ('AU', 45000, 0, 'fortnightly');

INSERT OR REPLACE INTO opex (entity_id, marketing, rent, misc) VALUES
  ('US', 20769, 0, 2000),
  ('CA', 6600, 0, 0),
  ('UK', 0, 0, 0),
  ('AU', 0, 0, 0);

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('scenario', '2'),
  ('fx_last_updated', '2026-03-07'),
  ('hubspot_sync_interval', '6h');
