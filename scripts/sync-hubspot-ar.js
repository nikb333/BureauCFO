// scripts/sync-hubspot-ar.js
// Run via: node scripts/sync-hubspot-ar.js
// Requires: wrangler installed and authenticated, HubSpot API access
// Set HUBSPOT_TOKEN env var or run within Claude Code (which has HubSpot MCP access)

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

const DB_NAME = 'bureau-cfo';
const ACCOUNT_ID = '44093193';
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const CURRENCY_ENTITY = { USD: 'US', CAD: 'CA', GBP: 'UK', AUD: 'AU' };

async function hsGet(path) {
  const headers = { 'Content-Type': 'application/json' };
  if (HUBSPOT_TOKEN) headers['Authorization'] = `Bearer ${HUBSPOT_TOKEN}`;
  const resp = await fetch(`https://api.hubapi.com${path}`, { headers });
  if (!resp.ok) throw new Error(`HubSpot GET ${path} -> ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function hsPost(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (HUBSPOT_TOKEN) headers['Authorization'] = `Bearer ${HUBSPOT_TOKEN}`;
  const resp = await fetch(`https://api.hubapi.com${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`HubSpot POST ${path} -> ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

function d1Execute(sql) {
  const tmpFile = `/tmp/d1_sync_${Date.now()}.sql`;
  writeFileSync(tmpFile, sql);
  execSync(`wrangler d1 execute ${DB_NAME} --remote --file=${tmpFile}`, { stdio: 'inherit' });
  unlinkSync(tmpFile);
}

async function main() {
  console.log('Starting HubSpot AR sync...');

  // 1. Fetch all open invoices (paginate)
  const allInvoices = [];
  let after = null;
  while (true) {
    const url = `/crm/v3/objects/invoices?limit=100&properties=hs_number,hs_invoice_status,hs_due_date,hs_amount_billed,hs_currency,hs_title&associations=deals${after ? `&after=${after}` : ''}`;
    const data = await hsGet(url);
    for (const inv of data.results || []) {
      if (inv.properties.hs_invoice_status !== 'open') continue;
      allInvoices.push(inv);
    }
    if (!data.paging?.next?.after) break;
    after = data.paging.next.after;
  }
  console.log(`Fetched ${allInvoices.length} open invoices`);

  // 2. Map invoice -> deal
  const dealIds = new Set();
  const invoiceRows = allInvoices.map(inv => {
    const dealAssoc = inv.associations?.deals?.results?.[0];
    const dealId = dealAssoc ? String(dealAssoc.id) : null;
    if (dealId) dealIds.add(dealId);
    const currency = (inv.properties.hs_currency || 'USD').toUpperCase();
    return {
      id: String(inv.id),
      hs_number: (inv.properties.hs_number || '').replace(/'/g, "''"),
      hs_title: (inv.properties.hs_title || '').replace(/'/g, "''"),
      hs_status: inv.properties.hs_invoice_status || 'open',
      hs_due_date: inv.properties.hs_due_date ? inv.properties.hs_due_date.slice(0, 10) : null,
      hs_amount_billed: parseFloat(inv.properties.hs_amount_billed || 0),
      hs_currency: currency,
      deal_id: dealId,
      entity_id: CURRENCY_ENTITY[currency] || 'US',
    };
  });

  // 3. Fetch deal details in batches of 100
  const dealProps = [
    'dealname', 'hubspot_owner_id', 'closedate', 'amount',
    'payment_terms', 'payment_terms_if_different_than_standard_payment_terms',
    'booths_installed_date', 'scheduled_installation_date__dean_input_',
  ];
  const dealIdList = [...dealIds];
  const dealMap = {};

  for (let i = 0; i < dealIdList.length; i += 100) {
    const batch = dealIdList.slice(i, i + 100);
    const batchResp = await hsPost('/crm/v3/objects/deals/batch/read', {
      inputs: batch.map(id => ({ id })),
      properties: dealProps,
    });
    for (const deal of batchResp.results || []) {
      dealMap[String(deal.id)] = deal.properties;
    }
  }
  console.log(`Fetched ${Object.keys(dealMap).length} deals`);

  // 4. Fetch ticket associations
  const ticketMap = {};
  for (let i = 0; i < dealIdList.length; i += 100) {
    const batch = dealIdList.slice(i, i + 100);
    try {
      const assocResp = await hsPost('/crm/v4/associations/deals/tickets/batch/read', {
        inputs: batch.map(id => ({ id })),
      });
      for (const result of assocResp.results || []) {
        const tickets = (result.to || []);
        if (tickets.length > 0) ticketMap[String(result.from.id)] = tickets.map(t => t.id);
      }
    } catch (e) {
      console.warn('Ticket assoc fetch failed:', e.message);
    }
  }

  // Fetch ticket details
  const allTicketIds = [...new Set(Object.values(ticketMap).flat())];
  const ticketDetails = {};
  for (let i = 0; i < allTicketIds.length; i += 100) {
    const batch = allTicketIds.slice(i, i + 100);
    try {
      const tResp = await hsPost('/crm/v3/objects/tickets/batch/read', {
        inputs: batch.map(id => ({ id })),
        properties: ['subject', 'hs_pipeline_stage', 'primary_issue_category', 'deficiency_category'],
      });
      for (const t of tResp.results || []) {
        ticketDetails[String(t.id)] = {
          subject: (t.properties.subject || '').replace(/'/g, "''"),
          status: t.properties.hs_pipeline_stage || '',
          category: (t.properties.primary_issue_category || t.properties.deficiency_category || '').replace(/'/g, "''"),
        };
      }
    } catch (e) {
      console.warn('Ticket detail fetch failed:', e.message);
    }
  }

  // 5. Fetch owner names
  const ownerMap = {};
  try {
    const ownersData = await hsGet('/crm/v3/owners?limit=100');
    for (const o of ownersData.results || []) {
      ownerMap[String(o.id)] = `${o.firstName || ''} ${o.lastName || ''}`.trim();
    }
  } catch (e) {
    console.warn('Owner fetch failed:', e.message);
  }

  // 6. Group invoices by deal
  const dealInvoices = {};
  for (const inv of invoiceRows) {
    if (!inv.deal_id) continue;
    if (!dealInvoices[inv.deal_id]) dealInvoices[inv.deal_id] = [];
    dealInvoices[inv.deal_id].push(inv);
  }

  // 7. Build SQL and write to D1
  const esc = v => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
  const escNum = v => v == null ? 'NULL' : Number(v);

  let sql = 'BEGIN TRANSACTION;\n';
  sql += 'DELETE FROM hs_invoices;\n';
  sql += 'DELETE FROM hs_ar_deals;\n';

  // Insert invoices
  for (const inv of invoiceRows) {
    sql += `INSERT OR REPLACE INTO hs_invoices (id,hs_number,hs_title,hs_status,hs_due_date,hs_amount_billed,hs_currency,deal_id,entity_id) VALUES (${esc(inv.id)},${esc(inv.hs_number)},${esc(inv.hs_title)},${esc(inv.hs_status)},${esc(inv.hs_due_date)},${escNum(inv.hs_amount_billed)},${esc(inv.hs_currency)},${esc(inv.deal_id)},${esc(inv.entity_id)});\n`;
  }

  // Insert deal rows
  for (const [dealId, invoices] of Object.entries(dealInvoices)) {
    const dp = dealMap[dealId] || {};
    const ownerId = dp.hubspot_owner_id || '';
    const ownerName = ownerMap[ownerId] || ownerId;
    const currency = (invoices[0]?.hs_currency || 'USD').toUpperCase();
    const entityId = CURRENCY_ENTITY[currency] || 'US';
    const invoicedTotal = invoices.reduce((s, i) => s + (i.hs_amount_billed || 0), 0);
    const invoiceNumbers = invoices.map(i => i.hs_number).filter(Boolean).join(', ');
    const installDate = dp.booths_installed_date || dp['scheduled_installation_date__dean_input_'] || null;
    const dealTicketIds = ticketMap[dealId] || [];
    const hasTicket = dealTicketIds.length > 0 ? 1 : 0;
    const firstTicket = dealTicketIds.length > 0 ? ticketDetails[dealTicketIds[0]] : null;
    const dealUrl = `https://app.hubspot.com/contacts/${ACCOUNT_ID}/record/0-3/${dealId}`;

    sql += `INSERT OR REPLACE INTO hs_ar_deals (deal_id,deal_name,owner_id,owner_name,entity_id,currency,close_date,payment_terms,payment_terms_other,install_date,deal_amount,invoiced_total,invoice_numbers,has_open_ticket,ticket_subject,ticket_status,ticket_category,hubspot_deal_url) VALUES (${esc(dealId)},${esc((dp.dealname || '').replace(/'/g, "''"))},${esc(ownerId)},${esc(ownerName)},${esc(entityId)},${esc(currency)},${esc(dp.closedate?.slice(0, 10))},${esc(dp.payment_terms || '')},${esc(dp['payment_terms_if_different_than_standard_payment_terms'] || '')},${esc(installDate?.slice(0, 10))},${escNum(dp.amount)},${escNum(invoicedTotal)},${esc(invoiceNumbers)},${hasTicket},${esc(firstTicket?.subject)},${esc(firstTicket?.status)},${esc(firstTicket?.category)},${esc(dealUrl)});\n`;
  }

  // Update owner cache
  for (const [id, name] of Object.entries(ownerMap)) {
    sql += `INSERT OR REPLACE INTO hs_owners (owner_id, name) VALUES (${esc(id)}, ${esc(name)});\n`;
  }

  sql += `INSERT OR REPLACE INTO settings (key,value) VALUES ('hubspot_ar_last_sync', datetime('now'));\n`;
  sql += 'COMMIT;\n';

  console.log(`Writing ${invoiceRows.length} invoices and ${Object.keys(dealInvoices).length} deal rows to D1...`);
  d1Execute(sql);

  const linked = invoiceRows.filter(r => r.deal_id).length;
  const unlinked = invoiceRows.filter(r => !r.deal_id).length;
  console.log(`Done. Linked: ${linked}, Unlinked (reconciliation queue): ${unlinked}`);
}

main().catch(e => { console.error('Sync failed:', e); process.exit(1); });
