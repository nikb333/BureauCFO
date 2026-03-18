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

  // ── 1. Fetch ALL Closed Won deals via search (paginate) ──
  // This is the source of truth — hs_is_closed_won works across all pipelines
  const dealProps = [
    'dealname', 'hubspot_owner_id', 'closedate', 'amount', 'deal_currency_code',
    'payment_terms', 'payment_terms_if_different_than_standard_payment_terms',
    'booths_installed_date', 'scheduled_installation_date__dean_input_',
    'current_promised_date__from_tickets_',
    'is_invoicenumbers', 'is_invoice_status', 'is_invoice_total',
    'is_paidtotal', 'is_invoice_total_inc_tax', 'hs_is_closed_won',
  ];

  const allDeals = [];
  let after = null;
  do {
    const page = await hsPost('/crm/v3/objects/deals/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'hs_is_closed_won', operator: 'EQ', value: 'true' },
          { propertyName: 'closedate', operator: 'GTE', value: '2025-06-01' },
        ]
      }],
      properties: dealProps,
      limit: 100,
      ...(after ? { after } : {}),
    });
    allDeals.push(...(page.results || []));
    after = page.paging?.next?.after;
  } while (after);
  console.log(`Fetched ${allDeals.length} Closed Won deals (since 2025-06-01)`);

  // ── 2. Fetch all open invoices (paginate) ──
  const allInvoices = [];
  after = null;
  while (true) {
    const url = `/crm/v3/objects/invoices?limit=100&properties=hs_number,hs_invoice_status,hs_due_date,hs_amount_billed,hs_balance_due,hs_amount_paid,hs_currency,hs_createdate,hs_title&associations=deals${after ? `&after=${after}` : ''}`;
    const data = await hsGet(url);
    for (const inv of data.results || []) {
      allInvoices.push(inv);
    }
    if (!data.paging?.next?.after) break;
    after = data.paging.next.after;
  }
  console.log(`Fetched ${allInvoices.length} invoices (all statuses)`);

  // ── 3. Map invoice -> deal, enrich with company ──
  const invoiceRows = [];
  const dealInvoices = {}; // dealId -> [invoiceRow]

  for (const inv of allInvoices) {
    const dealAssoc = inv.associations?.deals?.results?.[0];
    const dealId = dealAssoc ? String(dealAssoc.id) : null;
    const currency = (inv.properties.hs_currency || 'USD').toUpperCase();
    const row = {
      id: String(inv.id),
      hs_number: (inv.properties.hs_number || '').replace(/'/g, "''"),
      hs_title: (inv.properties.hs_title || '').replace(/'/g, "''"),
      hs_status: inv.properties.hs_invoice_status || 'open',
      hs_due_date: inv.properties.hs_due_date ? inv.properties.hs_due_date.slice(0, 10) : null,
      hs_amount_billed: parseFloat(inv.properties.hs_amount_billed || 0),
      hs_balance_due: parseFloat(inv.properties.hs_balance_due || 0),
      hs_amount_paid: parseFloat(inv.properties.hs_amount_paid || 0),
      hs_currency: currency,
      hs_createdate: inv.properties.hs_createdate ? inv.properties.hs_createdate.slice(0, 10) : null,
      deal_id: dealId,
      entity_id: CURRENCY_ENTITY[currency] || 'US',
    };
    invoiceRows.push(row);
    if (dealId) {
      if (!dealInvoices[dealId]) dealInvoices[dealId] = [];
      dealInvoices[dealId].push(row);
    }
  }

  // ── 4. Enrich invoices with company names (batches of 10) ──
  console.log('Enriching invoices with company names...');
  for (let i = 0; i < allInvoices.length; i += 10) {
    const batch = allInvoices.slice(i, i + 10);
    await Promise.all(batch.map(async (inv, idx) => {
      const row = invoiceRows[i + idx];
      try {
        const assoc = await hsGet(`/crm/v4/objects/invoices/${inv.id}/associations/companies`);
        const cId = assoc.results?.[0]?.toObjectId;
        if (cId) {
          const co = await hsGet(`/crm/v3/objects/companies/${cId}?properties=name`);
          row.company_name = (co.properties?.name || '').replace(/'/g, "''");
        }
      } catch {}
    }));
    if ((i + 10) % 50 === 0 || i + 10 >= allInvoices.length) {
      console.log(`  Enriched ${Math.min(i + 10, allInvoices.length)}/${allInvoices.length}`);
    }
  }

  // ── 5. Fetch ticket associations for all deals ──
  const dealIdList = allDeals.map(d => String(d.id));
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

  // Fetch ticket details (with pipeline info for ops vs defect classification)
  const allTicketIds = [...new Set(Object.values(ticketMap).flat())];
  const ticketDetails = {};
  for (let i = 0; i < allTicketIds.length; i += 100) {
    const batch = allTicketIds.slice(i, i + 100);
    try {
      const tResp = await hsPost('/crm/v3/objects/tickets/batch/read', {
        inputs: batch.map(id => ({ id })),
        properties: ['subject', 'hs_pipeline', 'hs_pipeline_stage', 'hs_lastmodifieddate', 'primary_issue_category', 'deficiency_category'],
      });
      for (const t of tResp.results || []) {
        ticketDetails[String(t.id)] = {
          subject: (t.properties.subject || '').replace(/'/g, "''"),
          pipeline: t.properties.hs_pipeline || '',
          stage: t.properties.hs_pipeline_stage || '',
          lastModified: t.properties.hs_lastmodifieddate || '',
          category: (t.properties.primary_issue_category || t.properties.deficiency_category || '').replace(/'/g, "''"),
        };
      }
    } catch (e) {
      console.warn('Ticket detail fetch failed:', e.message);
    }
  }

  // ── Pipeline and stage classification constants ──
  const OPS_PIPELINE = '749963562'; // Global Operations
  const OPS_STAGE_MAP = {
    '1105295898': 'New',
    '1105295899': 'Pending Sales Order',
    '1091283321': 'Pending Sales Order',
    '1091283320': 'Pending Sales Order',
    '1091283322': 'On Hold',
    '1091257712': 'Install Prep',
    '1091257713': 'Install Scheduled',
    '1091257714': 'Install Complete',
    '1096055447': 'Rectifications',
    '1108724088': 'Fully Complete',
    '1117806879': 'Cancelled',
  };
  const DEFECT_PIPELINES = new Set([
    '686268567',  // Canada + USA Rectifications
    '689864371',  // AUS Rectifications
    '689864372',  // UK Rectifications
    '768255583',  // Global Rectifications
    '875798280',  // Global Quality
  ]);
  const DEFECT_OPEN_STAGES = new Set([
    '1123458862', // Rectification Open
    '1123458863', // In Progress
    '1123458864', // Waiting for Parts
    '1123638120', // Waiting for Supplier Resolution
    '1123638122', // Scheduled
    '1314059152', // Waiting for Customer
  ]);

  // ── 6. Fetch owner names ──
  const ownerMap = {};
  try {
    const ownersData = await hsGet('/crm/v3/owners?limit=100');
    for (const o of ownersData.results || []) {
      ownerMap[String(o.id)] = `${o.firstName || ''} ${o.lastName || ''}`.trim();
    }
  } catch (e) {
    console.warn('Owner fetch failed:', e.message);
  }

  // ── 7. Build SQL and write to D1 ──
  const esc = v => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
  const escNum = v => v == null || isNaN(v) ? 'NULL' : Number(v);

  let sql = 'BEGIN TRANSACTION;\n';
  sql += 'DELETE FROM hs_invoices;\n';
  sql += 'DELETE FROM hs_ar_deals;\n';

  // Insert invoices (only open with balance > 0)
  const openInvoices = invoiceRows.filter(r => r.hs_status === 'open' && (r.hs_balance_due > 0 || r.hs_amount_billed > 0));
  for (const inv of openInvoices) {
    const invoiceUrl = `https://app.hubspot.com/contacts/${ACCOUNT_ID}/objects/0-53?filters=%5B%7B%22property%22%3A%22hs_object_id%22%2C%22operator%22%3A%22EQ%22%2C%22value%22%3A%22${inv.id}%22%7D%5D`;
    sql += `INSERT OR REPLACE INTO hs_invoices (id,hs_number,hs_title,hs_status,hs_due_date,hs_amount_billed,hs_balance_due,hs_amount_paid,hs_currency,hs_createdate,company_name,deal_id,entity_id,invoice_url) VALUES (${esc(inv.id)},${esc(inv.hs_number)},${esc(inv.hs_title)},${esc(inv.hs_status)},${esc(inv.hs_due_date)},${escNum(inv.hs_amount_billed)},${escNum(inv.hs_balance_due)},${escNum(inv.hs_amount_paid)},${esc(inv.hs_currency)},${esc(inv.hs_createdate)},${esc(inv.company_name || null)},${esc(inv.deal_id)},${esc(inv.entity_id)},${esc(invoiceUrl)});\n`;
  }

  // Insert deal rows — built from Closed Won deals, not from invoice associations
  let dealCount = 0;
  for (const deal of allDeals) {
    const dp = deal.properties;
    const dealId = String(deal.id);
    const ownerId = dp.hubspot_owner_id || '';
    const ownerName = ownerMap[ownerId] || ownerId;
    const currency = (dp.deal_currency_code || 'USD').toUpperCase();
    const entityId = CURRENCY_ENTITY[currency] || 'US';
    // install_date priority: current_promised_date (from ops ticket) > booths_installed_date > fallback
    const installDate = dp['current_promised_date__from_tickets_'] || dp.booths_installed_date || dp['scheduled_installation_date__dean_input_'] || null;

    // Invoice Stack fields
    const invoiceNumbers = dp.is_invoicenumbers || '';
    const invoiceStatus = dp.is_invoice_status || 'invoices_synced';
    const invoicedTotal = parseFloat(dp.is_invoice_total) || 0;
    const invoicedTotalIncTax = parseFloat(dp.is_invoice_total_inc_tax) || 0;
    const paidTotal = parseFloat(dp.is_paidtotal) || 0;
    const outstandingTotal = Math.max(0, invoicedTotal - paidTotal);
    const outstandingTotalIncTax = Math.max(0, invoicedTotalIncTax - paidTotal);
    const isClosedWon = dp.hs_is_closed_won === 'true' ? 1 : 0;

    // Compute invoice_coverage_flag for 50/50 deals
    const dealAmt = parseFloat(dp.amount) || 0;
    const terms = (dp.payment_terms || '').toLowerCase();
    const termsOther = (dp.payment_terms_if_different_than_standard_payment_terms || '').toLowerCase();
    const is5050 = terms.includes('50') || termsOther.includes('50');
    let invoiceCoverageFlag = null;
    if (is5050 && dealAmt > 0 && invoicedTotal > 0) {
      const ratio = invoicedTotal / dealAmt;
      if (ratio >= 0.99 && ratio <= 1.10) {
        invoiceCoverageFlag = null; // Full deal invoiced
      } else if (ratio >= 0.40 && ratio <= 0.60) {
        invoiceCoverageFlag = 'partial'; // Only first invoice raised
      } else if (ratio > 1.10) {
        invoiceCoverageFlag = 'over_invoiced';
      } else {
        invoiceCoverageFlag = 'discrepancy';
      }
    }

    // Skip deals with no invoice numbers (not yet invoiced)
    if (!invoiceNumbers.trim()) continue;

    // ── Classify tickets: ops (install_status) vs defect (has_open_ticket) ──
    const dealTicketIds = ticketMap[dealId] || [];
    let installStatus = 'Not Scheduled';
    let hasOpenTicket = 0;
    let defectSubject = null;
    let defectCategory = null;

    // Find primary ops ticket (most recently modified in Global Operations pipeline)
    let opsTickets = [];
    let defectTickets = [];
    for (const tId of dealTicketIds) {
      const t = ticketDetails[tId];
      if (!t) continue;
      if (t.pipeline === OPS_PIPELINE) {
        opsTickets.push(t);
      } else if (DEFECT_PIPELINES.has(t.pipeline) || DEFECT_OPEN_STAGES.has(t.stage)) {
        defectTickets.push(t);
      }
    }

    // Install status from ops ticket (most recently modified)
    if (opsTickets.length > 0) {
      opsTickets.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
      const primaryOps = opsTickets[0];
      installStatus = OPS_STAGE_MAP[primaryOps.stage] || 'Not Scheduled';
    }

    // Defect ticket (open ones only)
    const openDefects = defectTickets.filter(t => DEFECT_OPEN_STAGES.has(t.stage));
    if (openDefects.length > 0) {
      openDefects.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
      hasOpenTicket = 1;
      defectSubject = openDefects[0].subject;
      // Parse category from subject (often after last colon)
      const subj = openDefects[0].subject || '';
      const colonIdx = subj.lastIndexOf(':');
      defectCategory = openDefects[0].category || (colonIdx > 0 ? subj.slice(colonIdx + 1).trim() : null);
    }

    // has_draft_only: all invoice numbers start with INV- (auto-generated drafts)
    const invNums = invoiceNumbers.split(',').map(n => n.trim()).filter(Boolean);
    const hasDraftOnly = invNums.length > 0 && invNums.every(n => n.startsWith('INV-')) ? 1 : 0;

    const dealUrl = `https://app.hubspot.com/contacts/${ACCOUNT_ID}/record/0-3/${dealId}`;

    sql += `INSERT OR REPLACE INTO hs_ar_deals (deal_id,deal_name,owner_id,owner_name,entity_id,currency,close_date,payment_terms,payment_terms_other,install_date,install_status,deal_amount,invoiced_total,invoice_numbers,invoice_status,paid_total,outstanding_total,invoiced_total_inc_tax,outstanding_total_inc_tax,is_closed_won,has_open_ticket,ticket_subject,ticket_status,ticket_category,hubspot_deal_url,invoice_coverage_flag,has_draft_only) VALUES (${esc(dealId)},${esc((dp.dealname || '').replace(/'/g, "''"))},${esc(ownerId)},${esc(ownerName)},${esc(entityId)},${esc(currency)},${esc(dp.closedate?.slice(0, 10))},${esc(dp.payment_terms || '')},${esc(dp['payment_terms_if_different_than_standard_payment_terms'] || '')},${esc(installDate?.slice(0, 10))},${esc(installStatus)},${escNum(dp.amount)},${escNum(invoicedTotal)},${esc(invoiceNumbers.replace(/'/g, "''"))},${esc(invoiceStatus)},${escNum(paidTotal)},${escNum(outstandingTotal)},${escNum(invoicedTotalIncTax)},${escNum(outstandingTotalIncTax)},${isClosedWon},${hasOpenTicket},${esc(defectSubject)},${hasOpenTicket ? esc('open') : 'NULL'},${esc(defectCategory)},${esc(dealUrl)},${esc(invoiceCoverageFlag)},${hasDraftOnly});\n`;
    dealCount++;
  }

  // ── 8. Populate hs_deals_uninvoiced (no invoice or draft-only) ──
  sql += 'DELETE FROM hs_deals_uninvoiced;\n';
  let uninvoicedCount = 0;
  for (const deal of allDeals) {
    const dp = deal.properties;
    const dealId = String(deal.id);
    const invoiceNumbers = dp.is_invoicenumbers || '';
    const ownerId = dp.hubspot_owner_id || '';
    const ownerName = ownerMap[ownerId] || ownerId;
    const currency = (dp.deal_currency_code || 'USD').toUpperCase();
    const entityId = CURRENCY_ENTITY[currency] || 'US';
    const dealUrl = `https://app.hubspot.com/contacts/${ACCOUNT_ID}/record/0-3/${dealId}`;

    if (!invoiceNumbers.trim()) {
      // No invoice at all
      sql += `INSERT OR REPLACE INTO hs_deals_uninvoiced (deal_id,deal_name,owner_name,entity_id,currency,deal_amount,close_date,reason,draft_invoice_numbers,hubspot_deal_url) VALUES (${esc(dealId)},${esc((dp.dealname || '').replace(/'/g, "''"))},${esc(ownerName)},${esc(entityId)},${esc(currency)},${escNum(dp.amount)},${esc(dp.closedate?.slice(0, 10))},${esc('no_invoice')},NULL,${esc(dealUrl)});\n`;
      uninvoicedCount++;
    } else {
      // Draft-only detection: all invoice numbers start with INV- (auto-generated drafts)
      const invNums = invoiceNumbers.split(',').map(n => n.trim()).filter(Boolean);
      if (invNums.length > 0 && invNums.every(n => n.startsWith('INV-'))) {
        sql += `INSERT OR REPLACE INTO hs_deals_uninvoiced (deal_id,deal_name,owner_name,entity_id,currency,deal_amount,close_date,reason,draft_invoice_numbers,hubspot_deal_url) VALUES (${esc(dealId)},${esc((dp.dealname || '').replace(/'/g, "''"))},${esc(ownerName)},${esc(entityId)},${esc(currency)},${escNum(dp.amount)},${esc(dp.closedate?.slice(0, 10))},${esc('draft_only')},${esc(invoiceNumbers)},${esc(dealUrl)});\n`;
        uninvoicedCount++;
      }
    }
  }

  // Update owner cache
  for (const [id, name] of Object.entries(ownerMap)) {
    sql += `INSERT OR REPLACE INTO hs_owners (owner_id, name) VALUES (${esc(id)}, ${esc(name)});\n`;
  }

  sql += `INSERT OR REPLACE INTO settings (key,value) VALUES ('hubspot_ar_last_sync', datetime('now'));\n`;
  sql += 'COMMIT;\n';

  console.log(`Writing ${openInvoices.length} invoices, ${dealCount} deal rows, ${uninvoicedCount} uninvoiced deals to D1...`);
  d1Execute(sql);

  const linked = openInvoices.filter(r => r.deal_id).length;
  const unlinked = openInvoices.filter(r => !r.deal_id).length;
  console.log(`Done. Invoices: ${linked} linked, ${unlinked} unlinked`);
  console.log(`Deals: ${dealCount} Closed Won with invoices, ${uninvoicedCount} uninvoiced (of ${allDeals.length} total Closed Won)`);
}

main().catch(e => { console.error('Sync failed:', e); process.exit(1); });
