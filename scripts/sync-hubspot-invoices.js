// scripts/sync-hubspot-invoices.js
// Requires: HUBSPOT_TOKEN env var  OR  run from Claude Code session with HubSpot MCP
// Usage: HUBSPOT_TOKEN=pat-na1-xxxx node scripts/sync-hubspot-invoices.js

const { execSync } = require('child_process');
const token = process.env.HUBSPOT_TOKEN;
if (!token) { console.error('HUBSPOT_TOKEN required'); process.exit(1); }

const DB = 'bureau-cfo';
const CURRENCY_ENTITY = { USD: 'US', CAD: 'CA', GBP: 'UK', AUD: 'AU', EUR: 'UK' };

const hs = async (path) => {
  const r = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (!r.ok) throw new Error(`HubSpot ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
};

const hsPost = async (path, body) => {
  const r = await fetch(`https://api.hubapi.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`HubSpot POST ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
};

const d1 = (sql) => {
  try {
    execSync(`npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { stdio: 'pipe' });
  } catch(e) {
    console.error('D1 error:', e.stderr?.toString() || e.message, '\nSQL:', sql.slice(0, 100));
  }
};

const esc = v => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

async function run() {
  // 1. Fetch ALL open invoices with balance_due > 0
  let invoices = [], after;
  do {
    const page = await hsPost('/crm/v3/objects/invoices/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'hs_invoice_status', operator: 'EQ', value: 'open' },
          { propertyName: 'hs_balance_due', operator: 'GT', value: '0' }
        ]
      }],
      properties: ['hs_number','hs_invoice_status','hs_due_date','hs_amount_billed',
                   'hs_balance_due','hs_amount_paid','hs_currency','hs_createdate'],
      limit: 100,
      ...(after ? { after } : {})
    });
    invoices.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);

  console.log(`Fetched ${invoices.length} open invoices with balance > 0`);

  // 2. Enrich each invoice with company name + deal association (batches of 10)
  const enriched = [];
  for (let i = 0; i < invoices.length; i += 10) {
    const batch = invoices.slice(i, i + 10);
    await Promise.all(batch.map(async (inv) => {
      let companyName = null, dealId = null;

      // Company association
      try {
        const assoc = await hs(`/crm/v4/objects/invoices/${inv.id}/associations/companies`);
        const cId = assoc.results?.[0]?.toObjectId;
        if (cId) {
          const co = await hs(`/crm/v3/objects/companies/${cId}?properties=name`);
          companyName = co.properties?.name || null;
        }
      } catch {}

      // Deal association
      try {
        const assoc = await hs(`/crm/v4/objects/invoices/${inv.id}/associations/deals`);
        dealId = assoc.results?.[0]?.toObjectId?.toString() || null;
      } catch {}

      const currency = inv.properties.hs_currency;
      enriched.push({
        id: inv.id.toString(),
        hs_number: inv.properties.hs_number || '',
        hs_status: 'open',
        hs_due_date: inv.properties.hs_due_date?.slice(0, 10) || null,
        hs_amount_billed: parseFloat(inv.properties.hs_amount_billed) || 0,
        hs_balance_due: parseFloat(inv.properties.hs_balance_due) || 0,
        hs_amount_paid: parseFloat(inv.properties.hs_amount_paid) || 0,
        hs_currency: currency || null,
        hs_createdate: inv.properties.hs_createdate?.slice(0, 10) || null,
        company_name: companyName,
        deal_id: dealId,
        entity_id: CURRENCY_ENTITY[currency] || null,
        invoice_url: `https://app.hubspot.com/contacts/44093193/objects/0-53?filters=%5B%7B%22property%22%3A%22hs_object_id%22%2C%22operator%22%3A%22EQ%22%2C%22value%22%3A%22${inv.id}%22%7D%5D`
      });
    }));
    console.log(`Enriched ${Math.min(i + 10, invoices.length)}/${invoices.length}`);
  }

  // 3. Write to D1 — replace all rows
  d1('DELETE FROM hs_invoices');
  for (const inv of enriched) {
    d1(`INSERT INTO hs_invoices (id,hs_number,hs_status,hs_due_date,hs_amount_billed,hs_balance_due,hs_amount_paid,hs_currency,hs_createdate,company_name,deal_id,entity_id,invoice_url) VALUES (${esc(inv.id)},${esc(inv.hs_number)},${esc(inv.hs_status)},${esc(inv.hs_due_date)},${inv.hs_amount_billed},${inv.hs_balance_due},${inv.hs_amount_paid},${esc(inv.hs_currency)},${esc(inv.hs_createdate)},${esc(inv.company_name)},${esc(inv.deal_id)},${esc(inv.entity_id)},${esc(inv.invoice_url)})`);
  }

  // 4. Log
  const linked = enriched.filter(i => i.deal_id).length;
  const total = enriched.reduce((s, i) => s + i.hs_balance_due, 0);
  console.log(`Done. ${enriched.length} invoices with balance > 0`);
  console.log(`${linked} linked to deals, ${enriched.length - linked} unlinked`);
  console.log(`Total outstanding: ${total.toLocaleString()}`);
}

run().catch(e => { console.error(e); process.exit(1); });
