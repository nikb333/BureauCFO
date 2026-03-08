# Bureau CFO Dashboard

13-week consolidated cash flow forecast dashboard connecting HubSpot CRM (AR), Bureau Ops Worker (inventory/AP), and Syft accounting data.

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌────────────────┐
│  React Frontend  │───▶│  bureau-cfo       │───▶│  HubSpot CRM   │
│  (Cloudflare     │    │  Cloudflare Worker │    │  (Closed Won    │
│   Pages)         │    │                    │    │   deals / AR)   │
└─────────────────┘    │  D1: bureau-cfo    │    └────────────────┘
                       │  KV: config        │
                       │                    │───▶┌────────────────┐
                       │  Cron: 6hr sync    │    │  Bureau Ops    │
                       └──────────────────┘    │  Worker (POs)  │
                                                └────────────────┘
```

## Data Sources

| Source | What it provides | Sync |
|--------|-----------------|------|
| HubSpot CRM | Closed Won deals → AR by entity, payment terms, promised dates | Every 6 hours (cron) |
| Bureau Ops Worker | Purchase orders, deposit/release schedules | Every 6 hours (cron) |
| D1 Database | Settings overrides, bank balances, payroll, opex assumptions | Manual (via dashboard) |
| Syft (via D1) | Vendor AP balances imported from accounting | Manual seed |

## Infrastructure (already provisioned)

- **D1 Database**: `bureau-cfo` (ID: `e9f1733a-d06b-45b5-806b-4f0cbb0c9f93`)
- **KV Namespace**: `bureau-cfo-config` (ID: `10a8094fe3f542ba8e4f08de02cfd241`)
- **Worker**: `bureau-cfo`

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set HubSpot token in KV

```bash
# Store your HubSpot Private App token in KV
wrangler kv:key put --binding CONFIG HUBSPOT_TOKEN "pat-na1-your-token-here"
```

### 3. Initialize database (if starting fresh)

```bash
npm run db:init:remote
npm run db:seed:remote
```

### 4. Deploy

```bash
npm run deploy
```

### 5. Trigger initial sync

```bash
curl -X POST https://bureau-cfo.<your-subdomain>.workers.dev/api/sync/hubspot
curl -X POST https://bureau-cfo.<your-subdomain>.workers.dev/api/sync/bureau-ops
```

## API Endpoints

### Config & Entities
- `GET /api/entities` — All entities with bank accounts, payroll, opex
- `PUT /api/banks/:id` — Update bank account balance
- `PUT /api/fx/:entity` — Update FX rate
- `PUT /api/payroll/:entity` — Update payroll config
- `PUT /api/opex/:entity` — Update operating expenses

### Accounts Receivable
- `GET /api/ar?entity=US` — AR deals (from HubSpot sync + overrides)
- `PUT /api/ar/:id/override` — Override promised date, notes, status

### Accounts Payable
- `GET /api/ap?entity=US` — AP vendors
- `PUT /api/ap/:id` — Update AP due date

### Stock & Trade Finance
- `GET /api/stock-pos?entity=US` — Inventory POs
- `PUT /api/stock-pos/:id` — Update PO dates
- `GET /api/trade-loans` — Trade finance (AU)
- `PUT /api/trade-loans/:id` — Update maturity date

### Waterfall
- `GET /api/waterfall?entity=US` — Entity waterfall
- `GET /api/waterfall` — Consolidated waterfall (all entities)

### Sync
- `POST /api/sync/hubspot` — Sync HubSpot → D1
- `POST /api/sync/bureau-ops` — Sync Bureau Ops → D1

### Settings
- `GET /api/settings` — All settings
- `PUT /api/settings` — Update settings

## D1 Schema

See `schema/schema.sql` for full schema. Key tables:
- `entities` — US, CA, UK, AU with FX rates
- `bank_accounts` — Per-entity bank balances (manual update)
- `ar_overrides` — Synced from HubSpot, with date override capability
- `ap_overrides` — Vendor AP with editable due dates
- `stock_po_overrides` — From Bureau Ops worker
- `trade_loans` — AU trade finance maturities
- `payroll` / `opex` / `settings` — Configuration

## Frontend

The React dashboard (`frontend/`) connects to this Worker API. Deploy separately via Cloudflare Pages or serve from the Worker.

## Cron Schedule

Every 6 hours: `0 */6 * * *`
- Syncs HubSpot Closed Won deals → `ar_overrides`
- Syncs Bureau Ops orders → `stock_po_overrides`
