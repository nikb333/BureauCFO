// Bureau CFO Dashboard — Worker v2 with Live Calculation Engine
// Bindings: DB (D1), CONFIG (KV)

import FRONTEND_HTML from './frontend.html';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

// ════════════════════════════════════════════════════════════════
// CALCULATION ENGINE
// ════════════════════════════════════════════════════════════════
async function loadAllInputs(DB) {
  const [entities, banks, arRates, apRates, newOrders, amex, config,
    arDeals, apVendors, stockPOs, tradeLoans, scheduled, syftRecon,
    scenarios, overrides, settings, arHubspotOverflow] = await Promise.all([
    DB.prepare('SELECT * FROM entities').all(),
    DB.prepare('SELECT * FROM bank_accounts').all(),
    DB.prepare('SELECT * FROM input_ar_collection ORDER BY entity_id, week_num').all(),
    DB.prepare('SELECT * FROM input_ap_spread ORDER BY entity_id, week_num').all(),
    DB.prepare('SELECT * FROM input_new_orders').all(),
    DB.prepare('SELECT * FROM input_amex_payoff').all(),
    DB.prepare('SELECT * FROM input_entity_config').all(),
    DB.prepare('SELECT * FROM ar_overrides').all(),
    DB.prepare('SELECT * FROM ap_overrides').all(),
    DB.prepare('SELECT * FROM stock_po_overrides').all(),
    DB.prepare('SELECT * FROM trade_loans').all(),
    DB.prepare('SELECT * FROM scheduled_payments').all(),
    DB.prepare('SELECT * FROM syft_reconciliation').all(),
    DB.prepare('SELECT * FROM scenarios WHERE is_active = 1').all(),
    DB.prepare('SELECT * FROM scenario_overrides').all(),
    DB.prepare('SELECT * FROM settings').all(),
    DB.prepare('SELECT * FROM input_ar_hubspot_overflow ORDER BY entity_id, week_num').all(),
  ]);
  const byEntity = (rows, f='entity_id') => { const m={}; rows.forEach(r=>{const k=r[f]; if(!m[k])m[k]=[]; m[k].push(r)}); return m; };
  return {
    entities: entities.results, banks: byEntity(banks.results),
    arRates: byEntity(arRates.results), apRates: byEntity(apRates.results),
    arHubspotOverflow: byEntity(arHubspotOverflow.results),
    newOrders: Object.fromEntries(newOrders.results.map(r=>[r.entity_id,r])),
    amex: Object.fromEntries(amex.results.map(r=>[r.entity_id,r])),
    config: Object.fromEntries(config.results.map(r=>[r.entity_id,r])),
    arDeals: byEntity(arDeals.results), apVendors: byEntity(apVendors.results),
    stockPOs: byEntity(stockPOs.results), tradeLoans: byEntity(tradeLoans.results),
    scheduled: byEntity(scheduled.results),
    syftRecon: Object.fromEntries(syftRecon.results.map(r=>[r.entity_id,r])),
    scenarios: scenarios.results,
    overrides: byEntity(overrides.results, 'scenario_id'),
    settings: Object.fromEntries(settings.results.map(r=>[r.key,r.value])),
  };
}

function getWeekDates(startDate, n) {
  const weeks=[], s=new Date(startDate);
  for(let i=0;i<n;i++){
    const ws=new Date(s.getTime()+i*7*864e5), we=new Date(ws.getTime()+6*864e5);
    weeks.push({start:ws,end:we,label:`${ws.getDate()} ${ws.toLocaleDateString('en-GB',{month:'short'})}`});
  }
  return weeks;
}

function dateInWeek(ds, ws, we) {
  if(!ds) return false;
  const d=new Date(ds+'T00:00:00Z');
  return d>=ws && d<=we;
}

function calcEntityWaterfall(eId, inputs, scenOv={}) {
  const N=11, startDate=inputs.settings.week_start_date||'2026-03-07';
  const weeks=getWeekDates(startDate,N);
  const cfg=inputs.config[eId]||{}, ent=inputs.entities.find(e=>e.id===eId)||{};
  const fxRate=ent.fx_rate||1;
  const arMode=inputs.settings.ar_collection_mode||'aggregate';

  // Opening balance
  const eBanks=inputs.banks[eId]||[];
  const openingCash=eBanks.filter(b=>b.account_type!=='credit').reduce((s,b)=>s+b.balance,0);

  // AR/AP totals from Syft
  const syft=inputs.syftRecon[eId]||{};
  const arTotal=syft.ar_total||0;
  const apTotal=syft.ap_total||(inputs.apVendors[eId]||[]).reduce((s,v)=>s+v.amount,0);
  const arRates=(inputs.arRates[eId]||[]).sort((a,b)=>a.week_num-b.week_num);
  const apRates=(inputs.apRates[eId]||[]).sort((a,b)=>a.week_num-b.week_num);

  // HubSpot mode: bucket deals by payment schedule (terms-aware with 10-day lag)
  let hsWkAmounts=null, hsOverdueTotal=0, hsArDealsByWeek=null;
  const PAY_DELAY=10; // days lag after milestone
  function addDaysW(ds,days){if(!ds)return null;const d=new Date(ds+'T00:00:00Z');d.setDate(d.getDate()+days);return d}
  function paySchedule(d){
    const t=d.payment_terms||'',amt=d.outstanding||0,prom=d.promised_date,inst=d.install_date;
    if(t.includes('50/50')) return [{pct:50,date:prom?addDaysW(prom,PAY_DELAY):null,label:'50% confirmation'},{pct:50,date:inst?addDaysW(inst,PAY_DELAY):null,label:'50% install'}];
    if(t.includes('Due on Confirmation')) return [{pct:100,date:prom?addDaysW(prom,PAY_DELAY):null,label:'Due on confirmation'}];
    if(t.includes('Net 30 from install')) return [{pct:100,date:inst?addDaysW(inst,30):null,label:'Net 30 install'}];
    if(t.includes('Net 30')) return [{pct:100,date:prom?addDaysW(prom,30):null,label:'Net 30'}];
    if(t.includes('Net 60')) return [{pct:100,date:prom?addDaysW(prom,60):null,label:'Net 60'}];
    return [{pct:100,date:prom?addDaysW(prom,PAY_DELAY):null,label:t||'Standard'}];
  }
  if(arMode==='hubspot'){
    const deals=(inputs.arDeals[eId]||[]).filter(d=>d.outstanding>0);
    const wk0Start=weeks[0].start;
    const wkAmts=Array(N).fill(0);
    const wkDeals=Array.from({length:N},()=>[]);
    const overdue=[];
    deals.forEach(d=>{
      const sched=paySchedule(d);
      let placed=false;
      sched.forEach(s=>{
        const payAmt=Math.round((d.outstanding||0)*s.pct/100);
        if(!s.date){overdue.push({deal_name:d.deal_name,amount:payAmt,label:s.label});return}
        const payDate=s.date;
        if(payDate<wk0Start){overdue.push({deal_name:d.deal_name,amount:payAmt,label:s.label});return}
        for(let i=0;i<N;i++){
          if(payDate>=weeks[i].start&&payDate<=weeks[i].end){
            wkAmts[i]+=payAmt;
            wkDeals[i].push({name:d.deal_name+(sched.length>1?' ('+s.label+')':''),amount:payAmt,ticket:d.has_open_ticket?1:0,ticketSubject:d.ticket_subject||''});
            placed=true;break;
          }
        }
      });
    });
    hsOverdueTotal=overdue.reduce((s,d)=>s+(d.amount||0),0);
    const overflowRates=(inputs.arHubspotOverflow[eId]||[]).sort((a,b)=>a.week_num-b.week_num);
    hsWkAmounts=wkAmts.map((dated,i)=>{
      const ofRate=overflowRates.find(r=>r.week_num===i+1)?.overflow_pct||0;
      return dated+hsOverdueTotal*ofRate;
    });
    hsArDealsByWeek=wkDeals;
  }

  // AP deal breakdown per week for tooltips
  const apVendorsByWeek=Array.from({length:N},()=>[]);
  const apVendorList=inputs.apVendors[eId]||[];

  // New orders
  const no=inputs.newOrders[eId]||{monthly_revenue_local:0,delay_weeks:4,ramp_weeks:2,cogs_rate:0.075,replacement_rate:0.2};
  const weeklyRev=no.monthly_revenue_local*12/52;
  const revReduction=parseFloat(scenOv.revenue_reduction||'0');
  const revUplift=parseFloat(scenOv.revenue_uplift||'0');
  const adjWeeklyRev=weeklyRev*(1-revReduction+revUplift);

  // Marketing: global monthly budget × entity % ÷ 4.33 weeks
  const mktBudget=parseFloat(inputs.settings.marketing_monthly_usd||'225000');
  const mktPct=cfg.marketing_pct||0;
  const mktFxRate=fxRate||1;
  const marketingWeekly=mktBudget*mktPct/4.33/mktFxRate; // convert USD to local

  // AR scenario
  const arDelayPct=parseFloat(scenOv.ar_delay_pct||'0');
  const arDelayWks=parseInt(scenOv.ar_delay_weeks||'0');

  // Amex
  const amx=inputs.amex[eId]||{balance:0,weeks_to_pay:3,start_week:1,payment_week:4};
  const stockPOs=inputs.stockPOs[eId]||[];
  const tradeLns=inputs.tradeLoans[eId]||[];
  const schedPmts=inputs.scheduled[eId]||[];

  const weekData=[];
  let bal=openingCash;

  for(let w=0;w<N;w++){
    const wk=weeks[w], open=bal;

    // INFLOWS
    let overdueAR;
    if(arMode==='hubspot'&&hsWkAmounts){
      overdueAR=hsWkAmounts[w]||0;
    } else {
      const arRate=arRates[w]?.rate||0;
      overdueAR=arTotal*arRate;
    }
    if(arDelayPct>0&&arDelayWks>0){ overdueAR-=overdueAR*arDelayPct; }
    if(arDelayPct>0&&arDelayWks>0&&w>=arDelayWks){
      const srcWkAR=arMode==='hubspot'&&hsWkAmounts?(hsWkAmounts[w-arDelayWks]||0):(arTotal*(arRates[w-arDelayWks]?.rate||0));
      overdueAR+=srcWkAR*arDelayPct;
    }

    let newOrdersCash=0;
    if(w>=no.delay_weeks){
      const active=w-no.delay_weeks;
      const ramp=Math.min(1,(active+1)/Math.max(no.ramp_weeks,1));
      newOrdersCash=adjWeeklyRev*ramp;
    }
    const totIn=overdueAR+newOrdersCash;

    // OUTFLOWS
    const apRate=apRates[w]?.rate||0;
    const vendorAP=apTotal*apRate;
    // Track AP vendor breakdown for this week's tooltip
    if(apRate>0){
      apVendorList.forEach(v=>{
        const vAmt=Math.round((v.amount||0)*apRate);
        if(vAmt>0) apVendorsByWeek[w].push({name:v.vendor_name,amount:vAmt});
      });
    }

    const freq=cfg.payroll_frequency||'bimonthly';
    let payroll=0;
    if(freq==='bimonthly') payroll=(w%2===1)?(cfg.payroll_amount||0)+(cfg.payroll_tax||0):0;
    else if(freq==='monthly') payroll=(w>0&&w%4===3)?(cfg.payroll_amount||0)+(cfg.payroll_tax||0):0;
    else if(freq==='fortnightly') payroll=(w%2===1)?(cfg.payroll_amount||0):0;

    const marketing=marketingWeekly;

    let amexPayoff=0;
    if(amx.balance>0&&amx.weeks_to_pay>0){
      if(amx.payment_week>0&&w+1===amx.payment_week) amexPayoff=amx.balance;
      else if(amx.payment_week===0&&w>=amx.start_week&&w<amx.start_week+amx.weeks_to_pay) amexPayoff=amx.balance/amx.weeks_to_pay;
    }

    let stockOut=0;
    for(const po of stockPOs){
      if(dateInWeek(po.deposit_due,wk.start,wk.end)) stockOut+=po.deposit_amount||0;
      if(dateInWeek(po.release_due,wk.start,wk.end)) stockOut+=po.release_amount||0;
    }

    let tradeOut=0;
    for(const l of tradeLns){ if(dateInWeek(l.maturity_date,wk.start,wk.end)) tradeOut+=l.settlement||Math.round((l.outstanding||0)*(1+(l.rate||0)/2)); }

    let scheduledOut=0;
    const scheduledDetails=[];
    for(const sp of schedPmts){
      let spAmt=0;
      if(sp.frequency==='monthly'){
        const dom=sp.day_of_month||1;
        for(let d=new Date(wk.start);d<=wk.end;d.setDate(d.getDate()+1)){
          if(d.getDate()===dom){
            const ss=sp.start_date?new Date(sp.start_date):new Date('2020-01-01');
            const se=sp.end_date?new Date(sp.end_date):new Date('2030-12-31');
            if(d>=ss&&d<=se) spAmt+=sp.amount_local||0;
          }
        }
      } else if(sp.frequency==='one-off'){
        if(dateInWeek(sp.start_date,wk.start,wk.end)) spAmt=sp.amount_local||0;
      }
      if(spAmt>0){scheduledOut+=spAmt;scheduledDetails.push({name:sp.description||'Scheduled',amount:Math.round(spAmt)})}
    }

    const rent=(cfg.rent_monthly||0)/4.33; // monthly to weekly
    const misc=cfg.misc_weekly||0;
    const installCosts=newOrdersCash*(cfg.install_cost_pct||0);
    const stockRepl=newOrdersCash*(cfg.stock_replacement_pct||0);
    const totOut=vendorAP+payroll+marketing+amexPayoff+stockOut+tradeOut+scheduledOut+rent+misc+installCosts+stockRepl;
    bal=open+totIn-totOut;

    // AR tooltip: deal breakdown for this week
    let arDetails=[];
    if(arMode==='hubspot'&&hsArDealsByWeek){
      const dated=hsArDealsByWeek[w]||[];
      if(dated.length) arDetails=arDetails.concat(dated.map(d=>({name:d.name,amount:Math.round(d.amount),ticket:d.ticket||0,ticketSubject:d.ticketSubject||''})));
      const ofRate=(inputs.arHubspotOverflow[eId]||[]).find(r=>r.week_num===w+1)?.overflow_pct||0;
      if(ofRate>0&&hsOverdueTotal>0) arDetails.push({name:'Overdue ('+Math.round(ofRate*100)+'%)',amount:Math.round(hsOverdueTotal*ofRate)});
    }

    weekData.push({
      week:wk.label, weekStart:wk.start.toISOString().slice(0,10), open:Math.round(open),
      arIn:Math.round(overdueAR), newOrders:Math.round(newOrdersCash), totIn:Math.round(totIn),
      vendorAP:Math.round(vendorAP), payroll:Math.round(payroll), marketing:Math.round(marketing),
      amexPayoff:Math.round(amexPayoff), stock:Math.round(stockOut), trade:Math.round(tradeOut),
      scheduled:Math.round(scheduledOut), rent:Math.round(rent), misc:Math.round(misc),
      diCogs:Math.round(installCosts), invRepl:Math.round(stockRepl), totOut:Math.round(totOut),
      close:Math.round(bal), closeExStock:Math.round(bal+stockOut),
      arDetails, apDetails:apVendorsByWeek[w]||[], scheduledDetails,
    });
  }
  return { entity:eId, currency:ent.currency||'USD', fxRate, openingCash, arTotal, apTotal, weeks:weekData };
}

function calcConsolidated(results) {
  const N=results[0]?.weeks?.length||11, out=[];
  for(let w=0;w<N;w++){
    let ws=0,es=0; const label=results[0]?.weeks[w]?.week||`Wk${w+1}`;
    for(const r of results){ const wk=r.weeks[w]; if(!wk)continue; ws+=wk.close*r.fxRate; es+=wk.closeExStock*r.fxRate; }
    out.push({week:label,withStock:Math.round(ws),exStock:Math.round(es)});
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    const url=new URL(request.url), path=url.pathname, method=request.method;
    if(method==='OPTIONS') return new Response(null,{status:204,headers:CORS});

    try {
      if(path==='/'||path==='/index.html') return new Response(FRONTEND_HTML,{headers:{'Content-Type':'text/html;charset=UTF-8',...CORS}});
      if(path==='/api/health') return json({status:'ok',timestamp:new Date().toISOString()});

      // Entities
      if(path==='/api/entities'&&method==='GET'){
        const ents=await env.DB.prepare(`SELECT e.*, json_group_array(json_object('id',ba.id,'name',ba.account_name,'balance',ba.balance,'type',ba.account_type)) as bank_accounts FROM entities e LEFT JOIN bank_accounts ba ON ba.entity_id=e.id GROUP BY e.id`).all();
        const cfgs=await env.DB.prepare('SELECT * FROM input_entity_config').all();
        const cfgMap=Object.fromEntries(cfgs.results.map(c=>[c.entity_id,c]));
        return json({entities:ents.results.map(e=>({...e,bank_accounts:JSON.parse(e.bank_accounts),payroll:cfgMap[e.id]?{entity_id:e.id,amount:cfgMap[e.id].payroll_amount,tax:cfgMap[e.id].payroll_tax,frequency:cfgMap[e.id].payroll_frequency}:null,opex:cfgMap[e.id]?{entity_id:e.id,marketing:cfgMap[e.id].marketing_weekly_local,rent:cfgMap[e.id].rent_weekly,misc:cfgMap[e.id].misc_weekly}:null}))});
      }

      // Bank update
      if(path.startsWith('/api/banks/')&&method==='PUT'){
        const id=path.split('/').pop(), body=await request.json();
        await env.DB.prepare('UPDATE bank_accounts SET balance=? WHERE id=?').bind(body.balance,id).run();
        return json({success:true});
      }

      // AR
      if(path==='/api/ar'&&method==='GET'){
        const e=url.searchParams.get('entity');
        let q='SELECT * FROM ar_overrides'; if(e) q+=` WHERE entity_id='${e}'`; q+=' ORDER BY outstanding DESC';
        return json({deals:(await env.DB.prepare(q).all()).results});
      }

      // AP
      if(path==='/api/ap'&&method==='GET'){
        const e=url.searchParams.get('entity');
        let q='SELECT * FROM ap_overrides'; if(e) q+=` WHERE entity_id='${e}'`; q+=' ORDER BY amount DESC';
        return json({vendors:(await env.DB.prepare(q).all()).results});
      }

      // AP update notes/status
      if(path.startsWith('/api/ap/')&&method==='PUT'){
        const id=path.split('/').pop();
        const body=await request.json();
        const sets=[];const vals=[];
        if(body.notes!==undefined){sets.push('notes=?');vals.push(body.notes)}
        if(body.ap_status!==undefined){sets.push('ap_status=?');vals.push(body.ap_status)}
        if(body.notes_updated_by!==undefined){sets.push('notes_updated_by=?');vals.push(body.notes_updated_by)}
        sets.push("notes_updated_at=datetime('now')");
        if(body.due_date!==undefined){sets.push('due_date=?');vals.push(body.due_date)}
        if(body.amount!==undefined){sets.push('amount=?');vals.push(body.amount)}
        vals.push(id);
        await env.DB.prepare('UPDATE ap_overrides SET '+sets.join(',')+' WHERE id=?').bind(...vals).run();
        return json({success:true});
      }

      // Stock POs
      if(path==='/api/stock-pos'&&method==='GET'){
        const e=url.searchParams.get('entity');
        let q='SELECT * FROM stock_po_overrides'; if(e) q+=` WHERE entity_id='${e}'`;
        return json({orders:(await env.DB.prepare(q).all()).results});
      }

      // Trade Loans
      if(path==='/api/trade-loans'&&method==='GET') return json({loans:(await env.DB.prepare('SELECT * FROM trade_loans ORDER BY maturity_date').all()).results});

      // All Inputs
      if(path==='/api/inputs'&&method==='GET'){
        const [a,b,c,d,e,f,g,hh,st]=await Promise.all([
          env.DB.prepare('SELECT * FROM input_ar_collection ORDER BY entity_id,week_num').all(),
          env.DB.prepare('SELECT * FROM input_ap_spread ORDER BY entity_id,week_num').all(),
          env.DB.prepare('SELECT * FROM input_new_orders').all(),
          env.DB.prepare('SELECT * FROM input_amex_payoff').all(),
          env.DB.prepare('SELECT * FROM input_entity_config').all(),
          env.DB.prepare('SELECT * FROM scheduled_payments ORDER BY entity_id').all(),
          env.DB.prepare('SELECT * FROM trade_loans ORDER BY maturity_date').all(),
          env.DB.prepare('SELECT * FROM input_ar_hubspot_overflow ORDER BY entity_id,week_num').all(),
          env.DB.prepare('SELECT * FROM settings').all(),
        ]);
        const settings={};st.results.forEach(r=>settings[r.key]=r.value);
        return json({ar_collection:a.results,ap_spread:b.results,new_orders:c.results,amex_payoff:d.results,entity_config:e.results,scheduled_payments:f.results,trade_loans:g.results,ar_hubspot_overflow:hh.results,settings});
      }

      // Update inputs
      if(path==='/api/inputs/ar-collection'&&method==='PUT'){
        const body=await request.json();
        for(const r of body.rates) await env.DB.prepare('INSERT OR REPLACE INTO input_ar_collection(entity_id,week_num,rate) VALUES(?,?,?)').bind(r.entity_id,r.week_num,r.rate).run();
        return json({success:true});
      }
      if(path==='/api/inputs/ap-spread'&&method==='PUT'){
        const body=await request.json();
        for(const r of body.rates) await env.DB.prepare('INSERT OR REPLACE INTO input_ap_spread(entity_id,week_num,rate) VALUES(?,?,?)').bind(r.entity_id,r.week_num,r.rate).run();
        return json({success:true});
      }
      if(path==='/api/inputs/new-orders'&&method==='PUT'){
        const body=await request.json();
        for(const r of body.entities) await env.DB.prepare('INSERT OR REPLACE INTO input_new_orders VALUES(?,?,?,?,?,?)').bind(r.entity_id,r.monthly_revenue_local,r.delay_weeks,r.ramp_weeks,r.cogs_rate,r.replacement_rate).run();
        return json({success:true});
      }
      if(path==='/api/inputs/entity-config'&&method==='PUT'){
        const body=await request.json();
        for(const r of body.entities) await env.DB.prepare('UPDATE input_entity_config SET rent_monthly=?,misc_weekly=?,marketing_pct=?,payroll_amount=?,payroll_tax=?,payroll_frequency=?,install_cost_pct=?,stock_replacement_pct=? WHERE entity_id=?').bind(r.rent_monthly||0,r.misc_weekly||0,r.marketing_pct||0,r.payroll_amount||0,r.payroll_tax||0,r.payroll_frequency||'bimonthly',r.install_cost_pct||0,r.stock_replacement_pct||0,r.entity_id).run();
        return json({success:true});
      }
      if(path==='/api/inputs/ar-hubspot-overflow'&&method==='PUT'){
        const body=await request.json();
        for(const r of body.rates) await env.DB.prepare('INSERT OR REPLACE INTO input_ar_hubspot_overflow(entity_id,week_num,overflow_pct) VALUES(?,?,?)').bind(r.entity_id,r.week_num,r.overflow_pct).run();
        return json({success:true});
      }
      if(path==='/api/inputs/amex-payoff'&&method==='PUT'){
        const body=await request.json();
        for(const r of body.entities) await env.DB.prepare('INSERT OR REPLACE INTO input_amex_payoff VALUES(?,?,?,?,?)').bind(r.entity_id,r.balance,r.weeks_to_pay,r.start_week,r.payment_week).run();
        return json({success:true});
      }
      if(path==='/api/inputs/scheduled-payments'&&method==='PUT'){
        const body=await request.json();
        if(body.replace_all) await env.DB.prepare('DELETE FROM scheduled_payments').run();
        for(const sp of body.payments){
          if(sp.id) await env.DB.prepare('UPDATE scheduled_payments SET description=?,entity_id=?,amount_local=?,frequency=?,day_of_month=?,start_date=?,end_date=? WHERE id=?').bind(sp.description,sp.entity_id,sp.amount_local,sp.frequency,sp.day_of_month,sp.start_date,sp.end_date,sp.id).run();
          else await env.DB.prepare('INSERT INTO scheduled_payments(entity_id,description,amount_local,currency,frequency,day_of_month,start_date,end_date) VALUES(?,?,?,?,?,?,?,?)').bind(sp.entity_id,sp.description,sp.amount_local,sp.currency||'USD',sp.frequency,sp.day_of_month,sp.start_date,sp.end_date).run();
        }
        return json({success:true});
      }
      if(path==='/api/inputs/trade-loans'&&method==='PUT'){
        const body=await request.json();
        if(body.replace_all) await env.DB.prepare('DELETE FROM trade_loans').run();
        for(const tl of body.loans){
          if(tl.id) await env.DB.prepare('UPDATE trade_loans SET reference=?,po_ref=?,outstanding=?,settlement=?,maturity_date=?,rate=? WHERE id=?').bind(tl.reference,tl.po_ref,tl.outstanding,tl.settlement,tl.maturity_date,tl.rate,tl.id).run();
          else await env.DB.prepare('INSERT INTO trade_loans(entity_id,reference,po_ref,outstanding,settlement,maturity_date,rate) VALUES(?,?,?,?,?,?,?)').bind(tl.entity_id,tl.reference,tl.po_ref,tl.outstanding,tl.settlement,tl.maturity_date,tl.rate).run();
        }
        return json({success:true});
      }

      // Scenarios
      if(path==='/api/scenarios'&&method==='GET'){
        const sc=await env.DB.prepare('SELECT * FROM scenarios').all();
        const ov=await env.DB.prepare('SELECT * FROM scenario_overrides').all();
        const ovMap={}; ov.results.forEach(o=>{if(!ovMap[o.scenario_id])ovMap[o.scenario_id]={};ovMap[o.scenario_id][o.parameter]=o.value});
        return json({scenarios:sc.results.map(s=>({...s,overrides:ovMap[s.id]||{}}))});
      }
      if(path==='/api/scenarios'&&method==='POST'){
        const body=await request.json();
        const r=await env.DB.prepare('INSERT INTO scenarios(name,description,is_active,color) VALUES(?,?,?,?)').bind(body.name,body.description||'',body.is_active?1:0,body.color||'#3171F1').run();
        if(body.overrides) for(const [p,v] of Object.entries(body.overrides)) await env.DB.prepare('INSERT INTO scenario_overrides(scenario_id,parameter,value) VALUES(?,?,?)').bind(r.meta.last_row_id,p,String(v)).run();
        return json({success:true,id:r.meta.last_row_id});
      }
      if(path.startsWith('/api/scenarios/')&&method==='PUT'){
        const id=parseInt(path.split('/').pop()), body=await request.json();
        if(body.name!==undefined) await env.DB.prepare('UPDATE scenarios SET name=?,description=?,is_active=?,color=? WHERE id=?').bind(body.name,body.description||'',body.is_active?1:0,body.color||'#3171F1',id).run();
        if(body.overrides){await env.DB.prepare('DELETE FROM scenario_overrides WHERE scenario_id=?').bind(id).run();for(const [p,v] of Object.entries(body.overrides)) await env.DB.prepare('INSERT INTO scenario_overrides(scenario_id,parameter,value) VALUES(?,?,?)').bind(id,p,String(v)).run();}
        return json({success:true});
      }

      // Syft AR Items
      if(path==='/api/syft-ar'&&method==='GET'){
        const e=url.searchParams.get('entity');
        let q='SELECT * FROM syft_ar_items'; if(e) q+=` WHERE entity_id='${e}'`; q+=' ORDER BY outstanding DESC';
        return json({items:(await env.DB.prepare(q).all()).results});
      }
      if(path==='/api/syft-ar'&&method==='PUT'){
        const body=await request.json();
        if(body.replace_all){
          const e=body.entity_id;
          if(e) await env.DB.prepare('DELETE FROM syft_ar_items WHERE entity_id=?').bind(e).run();
          else await env.DB.prepare('DELETE FROM syft_ar_items').run();
        }
        for(const item of (body.items||[])){
          await env.DB.prepare('INSERT INTO syft_ar_items(entity_id,customer_name,invoice_number,invoice_date,due_date,amount,outstanding,age_bucket) VALUES(?,?,?,?,?,?,?,?)')
            .bind(item.entity_id,item.customer_name||'',item.invoice_number||'',item.invoice_date||'',item.due_date||'',item.amount||0,item.outstanding||0,item.age_bucket||'').run();
        }
        return json({success:true,count:(body.items||[]).length});
      }
      if(path==='/api/syft-ar/match'&&method==='PUT'){
        const body=await request.json();
        for(const m of (body.matches||[])){
          await env.DB.prepare('UPDATE syft_ar_items SET matched_deal_id=? WHERE id=?').bind(m.deal_id,m.syft_id).run();
        }
        return json({success:true});
      }

      // ═══ LIVE WATERFALL CALCULATION ═══
      if(path==='/api/waterfall'&&method==='GET'){
        const ef=url.searchParams.get('entity');
        const sIds=(url.searchParams.get('scenarios')||'1').split(',').map(Number);
        const inputs=await loadAllInputs(env.DB);
        const EIDs=ef?[ef]:['US','CA','UK','AU'];
        const scenResults={};
        for(const sId of sIds){
          const sc=inputs.scenarios.find(s=>s.id===sId)||{id:sId,name:'Base',color:'#213640'};
          const ovs={}; (inputs.overrides[sId]||[]).forEach(o=>{ovs[o.parameter]=o.value});
          const entWF={}, entRes=[];
          for(const eId of EIDs){ const r=calcEntityWaterfall(eId,inputs,ovs); entWF[eId]=r; entRes.push(r); }
          scenResults[sId]={id:sId,name:sc.name,color:sc.color,entities:entWF,consolidated:calcConsolidated(entRes)};
        }
        const primary=scenResults[sIds[0]];
        return json({scenarios:scenResults,entities:primary?.entities||{},consolidated:primary?.consolidated||[]});
      }

      // Settings
      if(path==='/api/settings'&&method==='GET'){
        const r=await env.DB.prepare('SELECT * FROM settings').all();
        const s={}; r.results.forEach(r=>s[r.key]=r.value);
        return json({settings:s});
      }
      if(path==='/api/settings'&&method==='PUT'){
        const body=await request.json();
        for(const [k,v] of Object.entries(body)) await env.DB.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').bind(k,String(v)).run();
        return json({success:true});
      }
      if(path.startsWith('/api/fx/')&&method==='PUT'){
        const eId=path.split('/').pop(), body=await request.json();
        await env.DB.prepare('UPDATE entities SET fx_rate=? WHERE id=?').bind(body.fx_rate,eId).run();
        return json({success:true});
      }

      // Seed trade finance from Excel data
      if(path==='/api/seed-trade-finance'&&method==='POST'){
        await env.DB.prepare('DELETE FROM trade_loans').run();
        const loans=[
          {ref:'EFL20262388628',po:'BUR-AUS-250710-0',out:7285.62,mat:'2026-03-12',rate:0.0562},
          {ref:'EFL20262388629',po:'BUR2505-AU',out:20607.37,mat:'2026-03-12',rate:0.0562},
          {ref:'EFL20262388632',po:'HA138',out:28399.00,mat:'2026-03-13',rate:0.0562},
          {ref:'EFL20262388634',po:'HA147',out:26645.56,mat:'2026-03-27',rate:0.0562},
          {ref:'EFL20262388633',po:'AU108EB',out:27350.93,mat:'2026-03-27',rate:0.0562},
          {ref:'EFL20262388585',po:'AU099EB',out:43581.65,mat:'2026-03-27',rate:0.0562},
          {ref:'EFL20262388588',po:'HA159',out:47206.31,mat:'2026-04-10',rate:0.0575},
          {ref:'EFL20262388596',po:'HA138',out:66142.84,mat:'2026-04-10',rate:0.0575},
          {ref:'EFL20262388610',po:'AU108EB',out:56272.81,mat:'2026-04-24',rate:0.0575},
          {ref:'EFL20262388611',po:'HA140',out:41129.03,mat:'2026-04-24',rate:0.0575},
          {ref:'EFL20262388598',po:'HA164',out:51513.61,mat:'2026-04-24',rate:0.0575},
          {ref:'EFL20262388616',po:'AU123EB',out:28744.18,mat:'2026-05-07',rate:0.0588},
          {ref:'EFL20262388617',po:'CA092EB',out:131819.97,mat:'2026-05-08',rate:0.0588},
          {ref:'EFL20262388630',po:'HA147',out:63016.95,mat:'2026-05-08',rate:0.0588},
          {ref:'EFL20262388631',po:'GB038EB',out:95247.90,mat:'2026-05-15',rate:0.0588},
          {ref:'EFL20262388635',po:'HA148',out:58506.34,mat:'2026-05-21',rate:0.0588},
          {ref:'EFL20262388636',po:'20251010CA094EB',out:52361.70,mat:'2026-05-22',rate:0.0588},
          {ref:'EFL20262388641',po:'HA159',out:107603.73,mat:'2026-05-22',rate:0.0588},
          {ref:'EFL20262404093',po:'',out:283314.32,mat:'2026-07-03',rate:0.0603},
          {ref:'BUREAU20262242586',po:'',out:255631.69,mat:'2026-07-08',rate:0.0603},
          {ref:'BUREAU20262246109',po:'',out:21040.02,mat:'2026-07-15',rate:0.0591},
          {ref:'BUREAU20262049531',po:'AU139EB -PO188-',out:19445.02,mat:'2026-07-22',rate:0.0588},
          {ref:'BUREAU20262049542',po:'PO183 PO194',out:41066.81,mat:'2026-07-22',rate:0.0588},
          {ref:'BUREAU20262049541',po:'PI NO HA179',out:15996.44,mat:'2026-07-22',rate:0.0588},
          {ref:'BUREAU20262054430',po:'',out:395784.04,mat:'2026-07-31',rate:0.0599},
          {ref:'BUREAU20262056345',po:'',out:211437.73,mat:'2026-08-05',rate:0.0588},
        ];
        for(const l of loans){
          const settlement=Math.round(l.out*(1+l.rate/2));
          await env.DB.prepare('INSERT INTO trade_loans(entity_id,reference,po_ref,outstanding,settlement,maturity_date,rate) VALUES(?,?,?,?,?,?,?)')
            .bind('AU',l.ref,l.po,l.out,settlement,l.mat,l.rate).run();
        }
        return json({success:true,count:loans.length});
      }

      // Migrations
      if(path==='/api/migrate'&&method==='POST'){
        const migrations=[
          "ALTER TABLE ar_overrides ADD COLUMN has_open_ticket INTEGER DEFAULT 0",
          "ALTER TABLE ar_overrides ADD COLUMN ticket_subject TEXT",
          "ALTER TABLE ar_overrides ADD COLUMN ticket_status TEXT",
          "ALTER TABLE ar_overrides ADD COLUMN ticket_priority TEXT",
          "ALTER TABLE ar_overrides ADD COLUMN ticket_category TEXT",
          "ALTER TABLE ar_overrides ADD COLUMN invoice_number TEXT",
          `CREATE TABLE IF NOT EXISTS syft_ar_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id TEXT NOT NULL,
            customer_name TEXT,
            invoice_number TEXT,
            invoice_date TEXT,
            due_date TEXT,
            amount REAL DEFAULT 0,
            outstanding REAL DEFAULT 0,
            age_bucket TEXT,
            matched_deal_id INTEGER,
            updated_at TEXT DEFAULT (datetime('now'))
          )`,
        ];
        const results=[];
        for(const sql of migrations){
          try{await env.DB.prepare(sql).run();results.push({sql:sql.slice(0,60),status:'ok'})}
          catch(e){results.push({sql:sql.slice(0,60),status:'skipped',error:e.message})}
        }
        return json({results});
      }

      // Trade loan individual operations
      if(path.startsWith('/api/trade-loans/')&&method==='DELETE'){
        const id=parseInt(path.split('/').pop());
        await env.DB.prepare('DELETE FROM trade_loans WHERE id=?').bind(id).run();
        return json({success:true});
      }
      if(path.startsWith('/api/trade-loans/')&&method==='PUT'){
        const id=parseInt(path.split('/').pop()), body=await request.json();
        await env.DB.prepare('UPDATE trade_loans SET reference=?,po_ref=?,outstanding=?,settlement=?,maturity_date=?,rate=?,entity_id=? WHERE id=?')
          .bind(body.reference,body.po_ref,body.outstanding,body.settlement,body.maturity_date,body.rate,body.entity_id||'AU',id).run();
        return json({success:true});
      }
      if(path==='/api/trade-loans'&&method==='POST'){
        const body=await request.json();
        const r=await env.DB.prepare('INSERT INTO trade_loans(entity_id,reference,po_ref,outstanding,settlement,maturity_date,rate) VALUES(?,?,?,?,?,?,?)')
          .bind(body.entity_id||'AU',body.reference||'',body.po_ref||'',body.outstanding||0,body.settlement||0,body.maturity_date||'',body.rate||0).run();
        return json({success:true,id:r.meta.last_row_id});
      }

      return json({error:`Not found: ${path}`},404);
    } catch(e){ console.error('Worker error:',e); return json({error:e.message},500); }
  },
  async scheduled(event,env){ console.log('Cron:',event.cron); },
};
