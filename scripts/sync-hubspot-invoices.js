// scripts/sync-hubspot-invoices.js
// Run: HUBSPOT_TOKEN=pat-na1-xxxx node scripts/sync-hubspot-invoices.js
// OR: Run from a Claude Code session that has HubSpot MCP (no token needed — uses MCP)

const { execSync } = require('child_process');
const token = process.env.HUBSPOT_TOKEN;
const DB = 'bureau-cfo';

const hs = async (path) => {
  const r = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (!r.ok) throw new Error(`HubSpot ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
};

const d1 = (sql) => execSync(
  `npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"')}"`,
  { stdio: 'pipe' }
);

async function run() {
  // 1. Fetch all open invoices (paginate)
  let invoices = [], after = undefined;
  do {
    const body = {
      limit: 100,
      properties: ['hs_number', 'hs_invoice_status', 'hs_due_date', 'hs_amount_billed', 'hs_currency', 'hs_createdate'],
      filterGroups: [{ filters: [{ propertyName: 'hs_invoice_status', operator: 'EQ', value: 'open' }] }],
    };
    if (after) body.after = after;
    const page = await hs('/crm/v3/objects/invoices/search', body);
    invoices.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);

  console.log(`Fetched ${invoices.length} open invoices`);

  // 2. For each invoice, get company + deal associations in parallel (batches of 10)
  const enriched = [];
  for (let i = 0; i < invoices.length; i += 10) {
    const batch = invoices.slice(i, i + 10);
    await Promise.all(batch.map(async (inv) => {
      let companyName = null, dealId = null, invoiceUrl = null;

      // Company association
      try {
        const assoc = await hs(`/crm/v4/objects/invoices/${inv.id}/associations/companies`);
        const companyId = assoc.results?.[0]?.toObjectId;
        if (companyId) {
          const company = await hs(`/crm/v3/objects/companies/${companyId}?properties=name`);
          companyName = company.properties?.name || null;
        }
      } catch(e) { /* no company associated */ }

      // Deal association
      try {
        const assoc = await hs(`/crm/v4/objects/invoices/${inv.id}/associations/deals`);
        dealId = assoc.results?.[0]?.toObjectId?.toString() || null;
      } catch(e) { /* no deal associated */ }

      // Build HubSpot invoice URL
      invoiceUrl = `https://app.hubspot.com/contacts/44093193/objects/0-53?filters=%5B%7B%22property%22%3A%22hs_object_id%22%2C%22operator%22%3A%22EQ%22%2C%22value%22%3A%22${inv.id}%22%7D%5D`;

      // Determine entity from currency
      const CURRENCY_ENTITY = { USD: 'US', CAD: 'CA', GBP: 'UK', AUD: 'AU', EUR: 'UK' };
      const entityId = CURRENCY_ENTITY[inv.properties.hs_currency] || null;

      enriched.push({
        id: inv.id.toString(),
        hs_number: inv.properties.hs_number || '',
        hs_status: inv.properties.hs_invoice_status || 'open',
        hs_due_date: inv.properties.hs_due_date?.slice(0, 10) || null,
        hs_amount_billed: parseFloat(inv.properties.hs_amount_billed) || 0,
        hs_currency: inv.properties.hs_currency || null,
        hs_createdate: inv.properties.hs_createdate?.slice(0, 10) || null,
        company_name: companyName,
        deal_id: dealId,
        entity_id: entityId,
        invoice_url: invoiceUrl,
      });
    }));
    console.log(`Enriched ${Math.min(i + 10, invoices.length)}/${invoices.length}`);
  }

  // 3. Write to D1
  d1(`DELETE FROM hs_invoices`);
  for (const inv of enriched) {
    const esc = v => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
    d1(`INSERT INTO hs_invoices (id, hs_number, hs_status, hs_due_date, hs_amount_billed, hs_currency, hs_createdate, company_name, deal_id, entity_id, invoice_url)
        VALUES (${esc(inv.id)}, ${esc(inv.hs_number)}, ${esc(inv.hs_status)}, ${esc(inv.hs_due_date)}, ${inv.hs_amount_billed}, ${esc(inv.hs_currency)}, ${esc(inv.hs_createdate)}, ${esc(inv.company_name)}, ${esc(inv.deal_id)}, ${esc(inv.entity_id)}, ${esc(inv.invoice_url)})`);
  }

  // 4. Log sync
  const linked = enriched.filter(i => i.deal_id).length;
  d1(`INSERT INTO hs_invoice_sync_log (total_invoices, linked, unlinked, notes) VALUES (${enriched.length}, ${linked}, ${enriched.length - linked}, 'sync complete')`);

  console.log(`Done. ${linked} linked to deals, ${enriched.length - linked} unlinked.`);
}

run().catch(e => { console.error(e); process.exit(1); });
