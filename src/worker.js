// bureau-cfo Worker — API + Frontend for CFO Dashboard
// Bindings: DB (D1), CONFIG (KV)
// Data sources: HubSpot CRM, Bureau Ops Worker, Syft (via D1 overrides)

import FRONTEND_HTML from './frontend.html';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 500) {
  return json({ error: msg }, status);
}

// ─── HubSpot API helper ────────────────────────────────────────────────────
async function hubspotSearch(env, { objectType, filters, properties, limit = 100 }) {
  const token = await env.CONFIG.get('HUBSPOT_TOKEN');
  if (!token) return { results: [], total: 0 };

  const body = { limit, properties };
  if (filters) body.filterGroups = filters;
  body.sorts = [{ propertyName: 'amount', direction: 'DESCENDING' }];

  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error('HubSpot error:', res.status, await res.text());
    return { results: [], total: 0 };
  }
  return res.json();
}

// Map deal currency to entity
function currencyToEntity(cur) {
  return { USD: 'US', CAD: 'CA', GBP: 'UK', AUD: 'AU' }[cur] || 'US';
}

// ─── ROUTES ────────────────────────────────────────────────────────────────

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    // ── Frontend Dashboard ─────────────────────────────
    if (path === '/' || path === '/index.html') {
      return new Response(FRONTEND_HTML, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8', ...CORS },
      });
    }

    // ── Health ──────────────────────────────────────────
    if (path === '/api/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // ── Entities & Config ──────────────────────────────
    if (path === '/api/entities' && method === 'GET') {
      const entities = await env.DB.prepare(`
        SELECT e.*,
          json_group_array(json_object(
            'id', ba.id, 'name', ba.account_name,
            'balance', ba.balance, 'type', ba.account_type
          )) as bank_accounts
        FROM entities e
        LEFT JOIN bank_accounts ba ON ba.entity_id = e.id
        GROUP BY e.id
      `).all();

      const payroll = await env.DB.prepare('SELECT * FROM payroll').all();
      const opex = await env.DB.prepare('SELECT * FROM opex').all();

      const result = entities.results.map(e => ({
        ...e,
        bank_accounts: JSON.parse(e.bank_accounts),
        payroll: payroll.results.find(p => p.entity_id === e.id),
        opex: opex.results.find(o => o.entity_id === e.id),
      }));

      return json({ entities: result });
    }

    // ── Update Bank Account ────────────────────────────
    if (path.startsWith('/api/banks/') && method === 'PUT') {
      const accountId = path.split('/').pop();
      const body = await request.json();
      await env.DB.prepare(
        `UPDATE bank_accounts SET balance = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(body.balance, accountId).run();
      return json({ success: true });
    }

    // ── Update FX Rate ─────────────────────────────────
    if (path.startsWith('/api/fx/') && method === 'PUT') {
      const entityId = path.split('/').pop();
      const body = await request.json();
      await env.DB.prepare(
        `UPDATE entities SET fx_rate = ? WHERE id = ?`
      ).bind(body.fx_rate, entityId).run();
      return json({ success: true });
    }

    // ── Update Payroll ─────────────────────────────────
    if (path.startsWith('/api/payroll/') && method === 'PUT') {
      const entityId = path.split('/').pop();
      const body = await request.json();
      await env.DB.prepare(
        `UPDATE payroll SET amount = ?, tax = ?, frequency = ?, updated_at = datetime('now') WHERE entity_id = ?`
      ).bind(body.amount, body.tax, body.frequency, entityId).run();
      return json({ success: true });
    }

    // ── Update Opex ────────────────────────────────────
    if (path.startsWith('/api/opex/') && method === 'PUT') {
      const entityId = path.split('/').pop();
      const body = await request.json();
      await env.DB.prepare(
        `UPDATE opex SET marketing = ?, rent = ?, misc = ?, updated_at = datetime('now') WHERE entity_id = ?`
      ).bind(body.marketing, body.rent, body.misc, entityId).run();
      return json({ success: true });
    }

    // ── AR: Get deals (HubSpot + overrides) ────────────
    if (path === '/api/ar' && method === 'GET') {
      const entity = url.searchParams.get('entity');

      // Get overrides from D1
      let query = 'SELECT * FROM ar_overrides';
      if (entity) query += ` WHERE entity_id = '${entity}'`;
      query += ' ORDER BY outstanding DESC';
      const overrides = await env.DB.prepare(query).all();

      return json({ deals: overrides.results });
    }

    // ── AR: Override promised date ──────────────────────
    if (path.match(/^\/api\/ar\/\d+\/override$/) && method === 'PUT') {
      const id = path.split('/')[3];
      const body = await request.json();
      const fields = [];
      const values = [];

      if (body.promised_date !== undefined) { fields.push('promised_date = ?'); values.push(body.promised_date); }
      if (body.collect_override_date !== undefined) { fields.push('collect_override_date = ?'); values.push(body.collect_override_date); }
      if (body.notes !== undefined) { fields.push('notes = ?'); values.push(body.notes); }
      if (body.status !== undefined) { fields.push('status = ?'); values.push(body.status); }

      fields.push("updated_at = datetime('now')");
      values.push(id);

      await env.DB.prepare(
        `UPDATE ar_overrides SET ${fields.join(', ')} WHERE id = ?`
      ).bind(...values).run();

      return json({ success: true });
    }

    // ── AP: Get ────────────────────────────────────────
    if (path === '/api/ap' && method === 'GET') {
      const entity = url.searchParams.get('entity');
      let query = 'SELECT * FROM ap_overrides';
      if (entity) query += ` WHERE entity_id = '${entity}'`;
      query += ' ORDER BY amount DESC';
      const result = await env.DB.prepare(query).all();
      return json({ vendors: result.results });
    }

    // ── AP: Update due date ────────────────────────────
    if (path.match(/^\/api\/ap\/\d+$/) && method === 'PUT') {
      const id = path.split('/').pop();
      const body = await request.json();
      await env.DB.prepare(
        `UPDATE ap_overrides SET due_date = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(body.due_date, id).run();
      return json({ success: true });
    }

    // ── Stock POs ──────────────────────────────────────
    if (path === '/api/stock-pos' && method === 'GET') {
      const entity = url.searchParams.get('entity');
      let query = 'SELECT * FROM stock_po_overrides';
      if (entity) query += ` WHERE entity_id = '${entity}'`;
      const result = await env.DB.prepare(query).all();
      return json({ orders: result.results });
    }

    // ── Stock PO: Update dates ─────────────────────────
    if (path.match(/^\/api\/stock-pos\/\d+$/) && method === 'PUT') {
      const id = path.split('/').pop();
      const body = await request.json();
      const fields = [];
      const values = [];
      if (body.deposit_due) { fields.push('deposit_due = ?'); values.push(body.deposit_due); }
      if (body.release_due) { fields.push('release_due = ?'); values.push(body.release_due); }
      fields.push("updated_at = datetime('now')");
      values.push(id);
      await env.DB.prepare(
        `UPDATE stock_po_overrides SET ${fields.join(', ')} WHERE id = ?`
      ).bind(...values).run();
      return json({ success: true });
    }

    // ── Trade Loans ────────────────────────────────────
    if (path === '/api/trade-loans' && method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM trade_loans ORDER BY maturity_date').all();
      return json({ loans: result.results });
    }

    if (path.match(/^\/api\/trade-loans\/\d+$/) && method === 'PUT') {
      const id = path.split('/').pop();
      const body = await request.json();
      await env.DB.prepare(
        `UPDATE trade_loans SET maturity_date = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(body.maturity_date, id).run();
      return json({ success: true });
    }

    // ── Waterfall Calculation ──────────────────────────
    if (path === '/api/waterfall' && method === 'GET') {
      const entityId = url.searchParams.get('entity');

      // Read pre-calculated waterfall from cache (matches Excel V12 exactly)
      const cache = await env.DB.prepare(
        'SELECT * FROM waterfall_cache ORDER BY scope, week_num'
      ).all();

      const byScope = {};
      for (const row of cache.results) {
        if (!byScope[row.scope]) byScope[row.scope] = [];
        byScope[row.scope].push({
          week: row.week_label,
          open: Math.round(row.opening),
          close: Math.round(row.closing_with_stock),
          arIn: Math.round(row.ar_in || 0),
          totIn: Math.round(row.total_in || 0),
          apOut: Math.round(row.vendor_ap || 0),
          payroll: Math.round(row.payroll || 0),
          amex: Math.round(row.amex || 0),
          opex: Math.round(row.marketing || 0),
          stock: Math.round(row.stock || 0),
          trade: Math.round(row.trade || 0),
          scheduled: Math.round(row.scheduled || 0),
          totOut: Math.round(row.total_out || 0),
        });
      }

      if (entityId) {
        const weeks = byScope[entityId] || [];
        return json({ entity: entityId, weeks });
      }

      // Consolidated chart data
      const consolWeeks = (byScope['CONSOLIDATED'] || []).map(w => ({
        week: w.week,
        withStock: w.close,
        exStock: Math.round((byScope['CONSOLIDATED'] || []).find(c => c.week === w.week)?.close || 0),
      }));

      // Rebuild from cache with both lines
      const consolData = [];
      const cRows = cache.results.filter(r => r.scope === 'CONSOLIDATED');
      for (const r of cRows) {
        consolData.push({
          week: r.week_label,
          withStock: Math.round(r.closing_with_stock),
          exStock: Math.round(r.closing_ex_stock),
        });
      }

      // Entity waterfalls
      const entityData = {};
      for (const eId of ['US', 'CA', 'UK', 'AU']) {
        entityData[eId] = { weeks: byScope[eId] || [] };
      }

      return json({ entities: entityData, consolidated: consolData });
    }

    // ── Sync HubSpot → D1 ──────────────────────────────
    if (path === '/api/sync/hubspot' && method === 'POST') {
      const result = await syncHubSpot(env);
      return json(result);
    }

    // ── Sync Bureau Ops → D1 ───────────────────────────
    if (path === '/api/sync/bureau-ops' && method === 'POST') {
      const result = await syncBureauOps(env);
      return json(result);
    }

    // ── Settings ───────────────────────────────────────
    if (path === '/api/settings' && method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM settings').all();
      const settings = {};
      result.results.forEach(r => settings[r.key] = r.value);
      return json({ settings });
    }

    if (path === '/api/settings' && method === 'PUT') {
      const body = await request.json();
      for (const [key, value] of Object.entries(body)) {
        await env.DB.prepare(
          `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).bind(key, String(value)).run();
      }
      return json({ success: true });
    }

    return err('Not found: ' + path, 404);

  } catch (e) {
    console.error('Worker error:', e);
    return err(e.message || 'Internal server error', 500);
  }
}

// ─── HubSpot Sync ──────────────────────────────────────────────────────────
async function syncHubSpot(env) {
  const CLOSED_WON_STAGES = ['1068897145', '1012019111', '1093196916'];
  const properties = [
    'dealname', 'amount', 'deal_currency_code', 'closedate', 'dealstage',
    'pipeline', 'expected_payment_date', 'payment_terms', 'invoice_number',
    'hubspot_owner_id', 'is_paidtotal', 'amount_in_home_currency',
  ];

  const data = await hubspotSearch(env, {
    objectType: 'deals',
    filters: [{
      filters: [
        { propertyName: 'dealstage', operator: 'IN', values: CLOSED_WON_STAGES },
        { propertyName: 'closedate', operator: 'GTE', value: '2025-06-01' },
      ],
    }],
    properties,
    limit: 100,
  });

  if (!data.results?.length) return { synced: 0, error: 'No deals found or token missing' };

  // Clear existing AR overrides from HubSpot source
  await env.DB.prepare("DELETE FROM ar_overrides WHERE hubspot_deal_id IS NOT NULL").run();

  let synced = 0;
  for (const deal of data.results) {
    const p = deal.properties;
    const cur = p.deal_currency_code || 'USD';
    const entity = currencyToEntity(cur);
    const amount = parseFloat(p.amount) || 0;
    const paid = parseFloat(p.is_paidtotal) || 0;
    const outstanding = amount - paid;
    const closeDate = p.closedate ? p.closedate.slice(0, 10) : null;
    const promisedDate = p.expected_payment_date || null;
    const terms = p.payment_terms || 'Unknown';
    const isOverdue = promisedDate && new Date(promisedDate) < new Date() ? 1 : 0;
    const status = isOverdue ? 'overdue' : outstanding > 0 ? 'current' : 'paid';

    await env.DB.prepare(`
      INSERT INTO ar_overrides (hubspot_deal_id, entity_id, deal_name, owner, amount, paid, outstanding, currency, payment_terms, close_date, promised_date, status, overdue)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      String(deal.id), entity, p.dealname || '', p.hubspot_owner_id || '',
      amount, paid, outstanding, cur, terms, closeDate, promisedDate, status, isOverdue
    ).run();
    synced++;
  }

  return { synced, total: data.total };
}

// ─── Bureau Ops Sync ───────────────────────────────────────────────────────
async function syncBureauOps(env) {
  try {
    const opsUrl = env.BUREAU_OPS_WORKER_URL || 'https://bureau.withbureau.com';
    const res = await fetch(`${opsUrl}/api/orders`);
    if (!res.ok) return { synced: 0, error: 'Bureau Ops unreachable' };

    const data = await res.json();
    if (!data.orders?.length) return { synced: 0 };

    await env.DB.prepare("DELETE FROM stock_po_overrides WHERE source = 'bureau_ops'").run();

    let synced = 0;
    for (const order of data.orders) {
      const entity = { AU: 'AU', UK: 'UK', US: 'US', CA: 'CA' }[order.region] || 'US';
      await env.DB.prepare(`
        INSERT INTO stock_po_overrides (entity_id, po_ref, supplier, deposit_amount, deposit_due, release_amount, release_due, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'bureau_ops')
      `).bind(
        entity, order.id || order.ref, order.supplier || '',
        order.depositAmt || 0, order.depositDue || '',
        order.releaseAmt || 0, order.releaseDue || ''
      ).run();
      synced++;
    }

    return { synced };
  } catch (e) {
    return { synced: 0, error: e.message };
  }
}

// ─── Scheduled handler (cron) ──────────────────────────────────────────────
async function handleScheduled(event, env, ctx) {
  ctx.waitUntil(Promise.all([
    syncHubSpot(env),
    syncBureauOps(env),
  ]));
}

export default {
  fetch: handleRequest,
  scheduled: handleScheduled,
};
