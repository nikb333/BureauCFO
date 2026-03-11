# Bureau CFO Dashboard — CLAUDE.md

## Git Workflow
- Push all changes directly to `main`. Do NOT create branches or PRs.
- After making changes: `git add . && git commit -m "<descriptive message>" && git push origin main`
- Cloudflare auto-deploys from main within ~30 seconds.

## What This Is
A Cloudflare Worker-based CFO dashboard for Bureau (withbureau.com) — a soundproof office booth company operating across 4 entities (US, CA, UK, AU). Replaces a V12 Excel cashflow model with a live web app backed by D1 database, pulling data from HubSpot CRM and Syft accounting.
**Live URL:** https://bureau-cfo-worker.nik-d88.workers.dev/
**Owner:** Nik Balashov (nik@withbureau.com), CFO
---
## Architecture
```
Single Cloudflare Worker serves BOTH:
  - GET / → frontend.html (React SPA, no build step)
  - GET/PUT/POST /api/* → JSON API backed by D1
Data sources:
  HubSpot CRM (44093193) → ar_overrides (151 AR deals)
  Syft Accounting → syft_reconciliation (AR/AP totals), ap_overrides
  Bureau Ops Worker → stock_po_overrides (inventory POs)
  Manual (frontend) → all input_* tables, bank_accounts, scheduled_payments
```
## Tech Stack
- **Runtime:** Cloudflare Workers (ES modules)
- **Database:** Cloudflare D1 (SQLite) — `bureau-cfo` / `e9f1733a-d06b-45b5-806b-4f0cbb0c9f93`
- **KV:** `bureau-cfo-config` / `10a8094fe3f542ba8e4f08de02cfd241` (not actively used yet)
- **Frontend:** React 18 via CDN (no JSX, no build — uses `React.createElement` directly)
- **Font:** DM Sans from Google Fonts
- **Deploy:** GitHub → Cloudflare Workers Builds (auto-deploy on push)
## File Structure
```
src/
  worker.js      — API routes + live calculation engine (~400 lines)
  frontend.html  — Full React SPA (~800 lines, no build step)
wrangler.toml    — Worker config with D1 + KV bindings
schema/
  schema.sql     — Original table definitions (NOTE: DB has evolved beyond this)
  seed.sql       — Original seed data (NOTE: superseded by live data)
```
## How the Frontend Works
The frontend is a single HTML file with inline `<script>` using `React.createElement` (aliased as `h`). No JSX, no Babel, no bundler. React + ReactDOM loaded from CDN.

> **BRACKET SAFETY:** The Entity Cashflow tab has deeply nested `h()` calls. After ANY edit to this section, verify the JS parses clean by running:
> ```
> node -e "require('acorn').parse(require('fs').readFileSync('src/frontend.html','utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], {ecmaVersion:2020})"
> ```
Key patterns:
```javascript
const h = React.createElement;
const { useState: us, useEffect: ue, useMemo: um } = React;
// All components use h() instead of JSX
h("div", {className: "card"}, h("span", null, "Hello"))
```
**Currency formatting** is entity-aware:
```javascript
const CURR = {US:{s:'$',c:'USD',fx:1}, CA:{s:'C$',c:'CAD',fx:0.71}, UK:{s:'£',c:'GBP',fx:1.33}, AU:{s:'A$',c:'AUD',fx:0.68}};
```
**Custom input components:**
- `CInput` — click-to-edit number field with currency symbol prefix
- `PctInput` — click-to-edit percentage (stores as decimal, displays as %)
## Frontend Tabs
### 1. Overview
KPI cards (Cash, AR, AP, Lowest Week) + consolidated 13-week SVG chart with scenario comparison lines + entity cards (clickable → drills to Entity tab).
### 2. AR Chasing
5 sub-tabs mirroring the AR Excel report:
- **Summary** — KPIs, region breakdown (Direct vs Channel), owner leaderboard
- **Definite Chases** — Payment terms confirmed, grouped DIRECT → CHANNEL → by region
- **Proposed Chases** — Terms = "Other" or blank, shows custom terms detail
- **Missing Invoices** — No invoice raised in HubSpot
- **Just Closed** — Deals closed within last 3 days
Each deal links to HubSpot. Grouped by sales_channel (Direct: Inbound/Outbound/Return Customer/RFP. Channel: Dealers/Architect/Designer/Builder).
### 3. Entity Cashflow
Per-entity waterfall table showing every line item with AR/AP detail tables below. AP table has editable notes and status dropdown for team collaboration.
### 4. Stock Payments
Bureau Ops PO table + AU Trade Finance maturities. Links to Bureau Ops dashboard.
### 5. Inputs
All editable assumptions. Most auto-save on blur. Includes:
- Bank accounts (editable balances with correct currency symbols)
- Payroll & Operating Costs (auto-save)
- Marketing Budget (global monthly → entity % allocation)
- New Orders Revenue (with USD total row)
- AR Collection Rates (two modes: aggregate % or HubSpot dates, with reconciliation panel)
- AP Payment Spread (vertical grid with amounts)
- Amex Payoff Schedule
- Scheduled Payments (CRUD with date pickers)
### 6. Scenarios
View/edit named scenarios with parameter overrides.
## Brand Colors
```
Canary Yellow: #FFFD6D    Steel Blue: #213640    Mid Grey: #847D70
Warm Grey: #C4C3C1        Bright Blue: #3171F1   Red Orange: #FF603B
Off White: #F7F4E7
Entity colors: US=#3171F1, CA=#B8860B, UK=#7B6BB5, AU=#2D7F5E
```
---
## Calculation Engine
The waterfall is computed LIVE on every `/api/waterfall` request. No caching — reads all D1 tables and calculates. Core function: `calcEntityWaterfall(entityId, inputs, scenarioOverrides)`.
For each of 11 weeks:
**INFLOWS:**
- `overdueAR` = Syft AR total × `input_ar_collection` rate for that week. Scenario override: `ar_delay_pct` shifts X% forward by `ar_delay_weeks`.
- `newOrdersCash` = monthly_revenue × 12/52 × ramp_factor(week, delay, ramp). Zero until `delay_weeks`, then linearly ramps over `ramp_weeks`.
**OUTFLOWS:**
- `vendorAP` = Syft AP total × `input_ap_spread` rate
- `payroll` = amount + tax on schedule (bimonthly=every 2wks odd, monthly=every 4wks, fortnightly=every 2wks)
- `marketing` = global_monthly_usd × entity_marketing_pct / 4.33 / fx_rate
- `amexPayoff` = balance in specific week or spread over N weeks
- `stockPOs` = deposit + release amounts matched by date to week
- `tradeFinance` = settlement matched by maturity_date to week
- `scheduledPayments` = matched by day_of_month (monthly) or exact date (one-off)
- `rent` = rent_monthly / 4.33
- `installCosts` = newOrdersCash × install_cost_pct
- `stockReplacement` = newOrdersCash × stock_replacement_pct
**Closing** = Opening + Total Inflows − Total Outflows
**Consolidated** = sum of all entity closings × respective fx_rate to USD.
---
## D1 Database — Full Schema
### Entities & Static
```sql
entities (id TEXT PK, label, name, currency, fx_rate)
-- US/CA/UK/AU with fx rates: US:1, CA:0.71, UK:1.33, AU:0.68
bank_accounts (id INT PK, entity_id, account_name, balance, account_type, updated_at)
-- 9 accounts: US chequing $128K + amex $80K, CA chequing $300K + savings + chequingUSD $3K + amex $50K, UK chequing £5K, AU CBA $250K + amex $60K
settings (key TEXT PK, value, updated_at)
-- week_start_date=2026-03-07, marketing_monthly_usd=225000, hubspot_last_sync, syft_last_sync, ar_collection_mode, etc.
```
### Source Data (synced from external)
```sql
ar_overrides (id INT PK, hubspot_deal_id, entity_id, deal_name, owner, amount, paid, outstanding, currency, payment_terms, payment_terms_other, close_date, promised_date, install_date, status, overdue, sales_channel, deal_stage, invoice_status, hubspot_link, age_days, just_closed, ar_bucket, notes, updated_at)
-- 151 HubSpot deals. ar_bucket: definite/proposed/missing_invoice/paid
ap_overrides (id INT PK, entity_id, vendor_name, amount, due_date, source, notes, notes_updated_by, notes_updated_at, ap_status, updated_at)
-- 35 Syft vendors. ap_status: pending/hold/investigating/approved/paid
stock_po_overrides (id INT PK, entity_id, po_ref, supplier, deposit_amount, deposit_due, release_amount, release_due, source, updated_at)
-- 9 Bureau Ops POs
trade_loans (id INT PK, entity_id, reference, po_ref, outstanding, settlement, maturity_date, rate, updated_at)
-- 9 AU trade finance loans
syft_reconciliation (entity_id TEXT PK, ar_total, ap_total, as_of_date, updated_at)
-- US: AR $680K/AP $175K, CA: AR C$1.81M/AP C$168K, UK: AR £468K/AP £4K, AU: AR A$711K/AP A$210K
```
### Input Assumptions (user-editable)
```sql
input_ar_collection (entity_id, week_num, rate) PK(entity_id, week_num)
-- e.g. US: 10%/wk × 7 weeks, AU: 30/30/30/10 then 0
input_ar_hubspot_overflow (entity_id, week_num, overflow_pct) PK(entity_id, week_num)
-- For HubSpot-date AR mode: % of undated/overdue AR collected per week
input_ap_spread (entity_id, week_num, rate) PK(entity_id, week_num)
-- e.g. US: 30/30/30/10, CA: 25/25/25/25
input_new_orders (entity_id TEXT PK, monthly_revenue_local, delay_weeks, ramp_weeks, cogs_rate, replacement_rate)
-- US: $755K/4wk/2wk, CA: C$1.007M/5wk/2wk, UK: £378K/4wk/2wk, AU: A$629K/3wk/2wk
input_entity_config (entity_id TEXT PK, rent_weekly, misc_weekly, di_cogs_rate, marketing_weekly_local, payroll_amount, payroll_tax, payroll_frequency, marketing_pct, rent_monthly, install_cost_pct, stock_replacement_pct)
-- NOTE: rent_weekly and marketing_weekly_local are LEGACY columns. Engine now uses rent_monthly and marketing_pct.
input_amex_payoff (entity_id TEXT PK, balance, weeks_to_pay, start_week, payment_week)
-- US: $80K in wk4, CA: $50K over 3wks, AU: $60K in wk5
scheduled_payments (id INT PK, entity_id, description, amount_local, currency, frequency, day_of_month, start_date, end_date, updated_at)
-- HMRC VAT £18.6K/mo on 16th, ATO A$35K/mo on 13th, IRS $100K one-off, CA Taxes C$50K one-off
```
### Scenarios
```sql
scenarios (id INT PK, name, description, is_active, color, created_at)
-- 1: Base Case (#213640), 2: Conservative (#FF603B), 3: Optimistic (#2D7F5E inactive)
scenario_overrides (id INT PK, scenario_id FK, parameter, value)
-- Conservative: ar_delay_pct=0.30, ar_delay_weeks=2, revenue_reduction=0.15
-- Optimistic: ar_delay_pct=0, ar_delay_weeks=0, revenue_uplift=0.10
```
### Legacy (can remove)
```sql
waterfall_cache  — was static V12 numbers, superseded by live calculation
payroll          — superseded by input_entity_config
opex             — superseded by input_entity_config
```
---
## API Endpoints
### Data
```
GET  /api/health
GET  /api/entities              — entities + bank_accounts + payroll/opex config
PUT  /api/banks/:id             — {balance: number}
GET  /api/ar?entity=US          — AR deals
GET  /api/ap?entity=US          — AP vendors
PUT  /api/ap/:id                — {notes, ap_status, notes_updated_by, due_date, amount}
GET  /api/stock-pos?entity=US
GET  /api/trade-loans
```
### Inputs
```
GET  /api/inputs                — ALL input tables + settings in one call
PUT  /api/inputs/ar-collection  — {rates: [{entity_id, week_num, rate}]}
PUT  /api/inputs/ar-hubspot-overflow — {rates: [{entity_id, week_num, overflow_pct}]}
PUT  /api/inputs/ap-spread      — {rates: [{entity_id, week_num, rate}]}
PUT  /api/inputs/new-orders     — {entities: [{entity_id, monthly_revenue_local, delay_weeks, ramp_weeks, cogs_rate, replacement_rate}]}
PUT  /api/inputs/entity-config  — {entities: [{entity_id, payroll_amount, payroll_tax, payroll_frequency, marketing_pct, rent_monthly, misc_weekly, install_cost_pct, stock_replacement_pct}]}
PUT  /api/inputs/amex-payoff    — {entities: [{entity_id, balance, weeks_to_pay, start_week, payment_week}]}
PUT  /api/inputs/scheduled-payments — {replace_all: true, payments: [{entity_id, description, amount_local, currency, frequency, day_of_month, start_date, end_date}]}
PUT  /api/inputs/trade-loans    — {replace_all: bool, loans: [{entity_id, reference, po_ref, outstanding, settlement, maturity_date, rate}]}
```
### Calculation
```
GET  /api/waterfall                  — base case, all 4 entities
GET  /api/waterfall?entity=US        — single entity
GET  /api/waterfall?scenarios=1,2    — multi-scenario comparison
```
### Settings & Scenarios
```
GET/PUT  /api/settings           — {key: value, ...}
GET/POST /api/scenarios          — {name, description, is_active, color, overrides: {param: value}}
PUT      /api/scenarios/:id
PUT      /api/fx/:entityId       — {fx_rate: number}
```
---
## HubSpot Integration
**Account:** 44093193 | **Plan limitation:** No Private Apps (no API tokens)
**Current:** Claude manually pulls deals via MCP and writes to D1 (~30 sec).
**Planned:** Push to Google Sheet → Worker reads daily.
**Properties used:** dealname, amount, deal_currency_code, is_paidtotal, payment_terms, payment_terms_if_different_than_standard_payment_terms, expected_payment_date, current_promised_date__from_tickets_, closedate, hubspot_owner_id, is_invoice_status, sales_channel, dealstage, notes_last_updated
**Deal stages (Closed Won):** 1068897145, 1012019111, 1093196916
**Filter:** closedate ≥ 2025-06-01
**Entity mapping:** USD→US, CAD→CA, GBP→UK, AUD→AU
**HubSpot link template:** `https://app.hubspot.com/contacts/44093193/record/0-3/{dealId}`
**AR bucket rules:**
- definite: has payment_terms (not "Other", not blank), outstanding > 0
- proposed: payment_terms = "Other" OR blank, outstanding > 0
- missing_invoice: invoice_status blank/null, outstanding > 0
- paid: outstanding ≤ 0
**Direct vs Channel:**
- Direct: Inbound, Outbound, Return Customer, RFP/Tenders
- Channel: Dealers, Architect/Designer, Builder, Design & Build
---
## Syft Integration
**Sheet:** `15b6zDRzdyzRi9prePo6ACd82MJmeqeRdYjX3lahNkDc`
**Status:** Manual. Planned auto-sync via Google Service Account (copy creds from `bureau` worker).
**Current Syft totals:** US AR:$680K/AP:$175K, CA AR:C$1.81M/AP:C$168K, UK AR:£468K/AP:£4K, AU AR:A$711K/AP:A$210K
---
## Bureau Ops Integration
**URL:** https://bureau.withbureau.com (separate Worker)
**Endpoint:** `/api/orders`
**Status:** 9 POs loaded manually. Planned: daily cron sync.
---
## What's Built vs Pending
### Built
- Live calculation engine (all line items)
- 6-tab frontend with full Inputs tab
- AR Chasing with 5 sub-tabs, DIRECT/CHANNEL grouping, HubSpot links
- AP notes & status for team collaboration
- AR collection mode toggle (aggregate vs HubSpot dates)
- HubSpot vs Syft reconciliation panel with sync timestamps
- Scenario comparison on chart
- Currency-aware formatting, auto-save
### Pending
1. **Syft auto-sync** — read Google Sheet via service account, toggle checkbox
2. **HubSpot auto-sync** — push deals to Sheet or build direct API endpoint
3. **Bureau Ops auto-sync** — cron calls `/api/orders`
4. **AR HubSpot-date mode wiring** — needs to affect actual waterfall calculation
5. **Delivering within Week / Post-Install sub-tabs**
6. **Scenario create/edit UI**
7. **Week date labels** (2-8 Mar not Wk1)
8. **FX rate auto-refresh**
9. **Auth** (Cloudflare Access)
10. **Mobile responsiveness**
11. **Export to Excel/PDF**
12. **Clean up legacy tables** (waterfall_cache, payroll, opex)
---
## Development
```bash
npm install
npx wrangler dev              # local dev
npx wrangler deploy           # manual deploy
npx wrangler d1 execute bureau-cfo --command "SELECT ..."  # query D1
```
GitHub push → auto-deploys via Cloudflare Workers Builds.
