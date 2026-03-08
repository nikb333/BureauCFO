import { useState, useMemo, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

/* ═══════════════════════════════════════════════════════════════════════
   BUREAU CFO DASHBOARD
   Primary: Canary Yellow #FFFD6D · Steel Blue #213640 · Mid Grey #847D70 · Warm Grey #C4C3C1
   Secondary: Off White #F7F4E7 · Bright Blue #3171F1 · Lilac #C4CDFD · Red Orange #FF603B
   Font: NB International Pro
   ═══════════════════════════════════════════════════════════════════════ */

const C = {
  yellow: "#FFFD6D", steel: "#213640", midGrey: "#847D70", warmGrey: "#C4C3C1",
  offWhite: "#F7F4E7", blue: "#3171F1", lilac: "#C4CDFD", orange: "#FF603B",
  bg: "#FFFFFF", surface: "#F7F8F7", surfaceWarm: "#F7F4E7",
  border: "#E0DFDB", borderLight: "#EDECE8",
  text: "#213640", textBody: "#5A6660", textMuted: "#847D70", textDim: "#C4C3C1",
  success: "#2D7F5E", successBg: "#E6F3ED", danger: "#C0392B", dangerBg: "#FCEDED",
  warn: "#B8860B", warnBg: "#FDF6E3",
  entity: { US: "#3171F1", CA: "#B8860B", UK: "#7B6BB5", AU: "#2D7F5E" },
  entityBg: { US: "#EDF2FE", CA: "#FDF6E3", UK: "#F0EDF8", AU: "#E6F3ED" },
};
const F = "'NB International Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const LOGO = "https://withbureau.com/wp-content/uploads/2025/03/Bureau_Branding.svg";

// ─── DATA ─────────────────────────────────────────────────────────────────────
const initData = () => ({
  US: {
    cur: "USD", label: "United States", name: "Inbox US",
    banks: { chequing: 483000, amex: 91000 },
    payroll: { amount: 90000, tax: 2000, freq: "Bimonthly" },
    opex: { marketing: 20769, rent: 0, misc: 2000 },
    ar: [
      { id:1, name:"Huron Valley Schools", owner:"Connor Harper", amount:36010, paid:0, outstanding:36010, cur:"USD", terms:"Due on Confirmation", close:"2025-12-24", promised:"2026-03-02", install:null, status:"overdue", overdue:true },
      { id:2, name:"Pembroke Public Library", owner:"John Yienger", amount:28639, paid:0, outstanding:28639, cur:"USD", terms:"Due on Confirmation", close:"2026-01-02", promised:"2026-04-24", install:null, status:"overdue", overdue:true },
      { id:3, name:"ARB Interactive", owner:"John Yienger", amount:24606, paid:0, outstanding:24606, cur:"USD", terms:"Due on Confirmation", close:"2026-03-02", promised:"2026-04-22", install:null, status:"current", overdue:false },
      { id:4, name:"Trilogy - Alpha School", owner:"John Yienger", amount:21181, paid:0, outstanding:21181, cur:"USD", terms:"Due on Confirmation", close:"2026-02-13", promised:"2026-04-15", install:null, status:"overdue", overdue:true },
      { id:5, name:"Tandym Group", owner:"Tyler Givens", amount:20620, paid:0, outstanding:20620, cur:"USD", terms:"Due on Confirmation", close:"2026-02-25", promised:"2026-03-13", install:null, status:"overdue", overdue:true },
      { id:6, name:"KPRS Construction", owner:"Brett Robinson", amount:16232, paid:0, outstanding:16232, cur:"USD", terms:"Net 30 from invoice", close:"2026-01-15", promised:"2026-02-27", install:null, status:"overdue", overdue:true },
      { id:7, name:"eyconis.com", owner:"Jett Laws", amount:8749, paid:0, outstanding:8749, cur:"USD", terms:"Due on Confirmation", close:"2026-03-02", promised:"2026-04-08", install:null, status:"current", overdue:false },
      { id:8, name:"Elecnor545", owner:"Connor Harper", amount:7744, paid:0, outstanding:7744, cur:"USD", terms:"Due on Confirmation", close:"2026-02-27", promised:"2026-04-24", install:null, status:"current", overdue:false },
    ],
    ap: [
      { id:1, name:"Pursuit Sales Solutions", amount:62000, dueDate:"2026-03-15" },
      { id:2, name:"Kuehne + Nagel Services", amount:23674, dueDate:"2026-03-10" },
      { id:3, name:"Logistics Installation", amount:22220, dueDate:"2026-03-20" },
      { id:4, name:"Woods Distribution", amount:16877, dueDate:"2026-04-01" },
      { id:5, name:"WeSolve", amount:16450, dueDate:"2026-04-05" },
    ],
    stockPOs: [
      { id:"PO-213", supplier:"Hecor", deposit:9110, release:21256, depDue:"2026-02-25", relDue:"2026-03-13" },
      { id:"PO-220", supplier:"Hecor", deposit:7768, release:18126, depDue:"2026-03-04", relDue:"2026-03-20" },
      { id:"PO-229", supplier:"Soundbox", deposit:7768, release:18126, depDue:"2026-03-11", relDue:"2026-03-27" },
    ],
  },
  CA: {
    cur: "CAD", label: "Canada", name: "Inbox CA",
    banks: { chequing: 18000, savings: 0, chequingUSD: 3000, amex: 95000 },
    payroll: { amount: 100000, tax: 60000, freq: "Bimonthly" },
    opex: { marketing: 6600, rent: 0, misc: 0 },
    ar: [
      { id:1, name:"Fitness World #2 (Burnaby)", owner:"Jay Hudon", amount:48166, paid:0, outstanding:48166, cur:"CAD", terms:"50/50", close:"2026-01-25", promised:"2026-04-24", install:null, status:"current", overdue:false },
      { id:2, name:"Esprit (Pascal Archambault)", owner:"Jay Hudon", amount:39508, paid:0, outstanding:39508, cur:"CAD", terms:"Due on Confirmation", close:"2026-02-18", promised:"2026-04-03", install:null, status:"overdue", overdue:true },
      { id:3, name:"Chief Red Bear Lodge", owner:"Jay Hudon", amount:37129, paid:0, outstanding:37129, cur:"CAD", terms:"Due on Confirmation", close:"2026-03-02", promised:"2026-05-01", install:null, status:"current", overdue:false },
      { id:4, name:"University Health Network", owner:"Joshua Cherry", amount:34185, paid:0, outstanding:34185, cur:"CAD", terms:"Due on Confirmation", close:"2026-02-04", promised:"2026-04-17", install:null, status:"overdue", overdue:true },
      { id:5, name:"Fitness World #1 (South Surrey)", owner:"Jay Hudon", amount:32267, paid:0, outstanding:32267, cur:"CAD", terms:"50/50", close:"2026-01-25", promised:"2026-04-03", install:null, status:"current", overdue:false },
      { id:6, name:"Gov Canada Crown-Indigenous", owner:"Jay Hudon", amount:22358, paid:0, outstanding:22358, cur:"CAD", terms:"Due on Confirmation", close:"2026-02-27", promised:"2026-03-20", install:null, status:"current", overdue:false },
    ],
    ap: [
      { id:1, name:"Blancar Inc", amount:32006, dueDate:"2026-03-10" },
      { id:2, name:"Work2day Inc", amount:28127, dueDate:"2026-03-10" },
      { id:3, name:"Les Boites GoBac", amount:19110, dueDate:"2026-03-20" },
    ],
    stockPOs: [
      { id:"PO-201", supplier:"Hecor", deposit:32539, release:75924, depDue:"2026-02-25", relDue:"2026-03-25" },
      { id:"PO-214", supplier:"Soundbox", deposit:13041, release:30428, depDue:"2026-02-25", relDue:"2026-03-25" },
    ],
  },
  UK: {
    cur: "GBP", label: "United Kingdom", name: "Bureau UK",
    banks: { chequing: 27000 },
    payroll: { amount: 45000, tax: 10000, freq: "Monthly" },
    opex: { marketing: 0, rent: 0, misc: 0 },
    ar: [
      { id:1, name:"Vinted - Techspace", owner:"Lachie Topp", amount:38156, paid:0, outstanding:38156, cur:"GBP", terms:"50/50", close:"2026-02-19", promised:"2026-03-13", install:null, status:"current", overdue:false },
      { id:2, name:"Corinthian House (RWE)", owner:"Kathryn N-B", amount:31898, paid:0, outstanding:31898, cur:"GBP", terms:"50/50", close:"2025-12-22", promised:"2026-04-13", install:null, status:"current", overdue:false },
      { id:3, name:"Snapchat (Wave Optics)", owner:"Lachie Topp", amount:22458, paid:0, outstanding:22458, cur:"GBP", terms:"50/50", close:"2025-12-22", promised:"2026-03-27", install:null, status:"current", overdue:false },
      { id:4, name:"Craft Media London", owner:"Lachie Topp", amount:12859, paid:0, outstanding:12859, cur:"GBP", terms:"Due on Confirmation", close:"2026-02-25", promised:"2026-05-15", install:null, status:"overdue", overdue:true },
      { id:5, name:"Techspace St. Andrews", owner:"Nik Balashov", amount:8200, paid:0, outstanding:8200, cur:"GBP", terms:"Due on Confirmation", close:"2026-02-20", promised:"2026-03-06", install:null, status:"overdue", overdue:true },
    ],
    ap: [
      { id:1, name:"HMRC VAT Payment", amount:18600, dueDate:"2026-03-15" },
      { id:2, name:"HUB OFFICE LTD", amount:4428, dueDate:"2026-03-20" },
    ],
    stockPOs: [
      { id:"PO-212", supplier:"Soundbox", deposit:6549, release:15280, depDue:"2026-02-25", relDue:"2026-03-13" },
      { id:"PO-206", supplier:"Soundbox", deposit:6411, release:14958, depDue:"2026-02-25", relDue:"2026-03-13" },
    ],
  },
  AU: {
    cur: "AUD", label: "Australia", name: "Urban Rooms AU",
    banks: { cba: 50000, amex: 115000 },
    payroll: { amount: 45000, tax: 0, freq: "Fortnightly" },
    opex: { marketing: 0, rent: 0, misc: 0 },
    ar: [
      { id:1, name:"Bendigo Health", owner:"Harry Steele", amount:54570, paid:0, outstanding:54570, cur:"AUD", terms:"50/50", close:"2026-02-23", promised:"2026-05-01", install:null, status:"current", overdue:false },
      { id:2, name:"BHP - Pilbara", owner:"Harry Steele", amount:36650, paid:0, outstanding:36650, cur:"AUD", terms:"Due on Confirmation", close:"2026-02-13", promised:"2026-03-23", install:null, status:"overdue", overdue:true },
    ],
    ap: [
      { id:1, name:"Kuehne & Nagel Pty", amount:150763, dueDate:"2026-03-05" },
      { id:2, name:"Assembly Now", amount:43225, dueDate:"2026-03-15" },
    ],
    stockPOs: [],
    tradeLoans: [
      { ref:"FL238612", po:"PO-111", outstanding:46451, settlement:48363, maturity:"2026-02-13" },
      { ref:"FL238614", po:"6027633", outstanding:111868, settlement:116500, maturity:"2026-03-03" },
      { ref:"FL238620", po:"PO-136", outstanding:18545, settlement:19298, maturity:"2026-03-06" },
      { ref:"FL238632", po:"HA138", outstanding:28399, settlement:29552, maturity:"2026-03-13" },
      { ref:"FL238585", po:"AU099EB", outstanding:43582, settlement:45349, maturity:"2026-03-27" },
    ],
  },
});

// AR Chasing data from the Excel report
const AR_CHASING = {
  definite: [
    { name:"Huron Valley Schools", owner:"Connor Harper", cur:"USD", amount:36010, paid:0, outstanding:36010, usd:36010, terms:"Due on Confirmation", close:"2025-12-24", age:68, promised:"2026-03-02", overdue:true, region:"USA", channel:"Direct" },
    { name:"Pembroke Public Library", owner:"John Yienger", cur:"USD", amount:28639, paid:0, outstanding:28639, usd:28639, terms:"Due on Confirmation", close:"2026-01-02", age:59, promised:"2026-04-24", overdue:true, region:"USA", channel:"Direct" },
    { name:"Bendigo Health", owner:"Harry Steele", cur:"AUD", amount:54570, paid:0, outstanding:54570, usd:34477, terms:"50/50", close:"2026-02-23", age:7, promised:"2026-05-01", overdue:false, region:"AUS", channel:"Direct" },
    { name:"BHP - Pilbara Port Hedland", owner:"Harry Steele", cur:"AUD", amount:36650, paid:0, outstanding:36650, usd:23155, terms:"Due on Confirmation", close:"2026-02-13", age:17, promised:"2026-03-23", overdue:true, region:"AUS", channel:"Direct" },
    { name:"Vinted - Techspace", owner:"Lachie Topp", cur:"GBP", amount:38156, paid:0, outstanding:38156, usd:48581, terms:"50/50", close:"2026-02-19", age:11, promised:"2026-03-13", overdue:false, region:"UK", channel:"Direct" },
    { name:"Corinthian House (RWE)", owner:"Kathryn N-B", cur:"GBP", amount:31898, paid:0, outstanding:31898, usd:40613, terms:"50/50", close:"2025-12-22", age:70, promised:"2026-04-13", overdue:false, region:"UK", channel:"Channel" },
    { name:"Fitness World #2 Burnaby", owner:"Jay Hudon", cur:"CAD", amount:48166, paid:0, outstanding:48166, usd:33779, terms:"50/50", close:"2026-01-25", age:36, promised:"2026-04-24", overdue:false, region:"CAD", channel:"Direct" },
    { name:"Esprit (Pascal Archambault)", owner:"Jay Hudon", cur:"CAD", amount:39508, paid:0, outstanding:39508, usd:27707, terms:"Due on Confirmation", close:"2026-02-18", age:12, promised:"2026-04-03", overdue:true, region:"CAD", channel:"Direct" },
    { name:"Chief Red Bear Lodge", owner:"Jay Hudon", cur:"CAD", amount:37129, paid:0, outstanding:37129, usd:26039, terms:"Due on Confirmation", close:"2026-03-02", age:0, promised:"2026-05-01", overdue:false, region:"CAD", channel:"Direct" },
    { name:"University Health Network", owner:"Joshua Cherry", cur:"CAD", amount:34185, paid:0, outstanding:34185, usd:23974, terms:"Due on Confirmation", close:"2026-02-04", age:26, promised:"2026-04-17", overdue:true, region:"CAD", channel:"Direct" },
  ],
  postInstall: [
    { name:"HB Capital - Holidays NG", owner:"John Yienger", cur:"USD", amount:161731, paid:80866, outstanding:80865, usd:80865, terms:"Other", install:"2026-01-27", daysSince:34, region:"USA", channel:"Direct" },
    { name:"Rialto Capital #2", owner:"Brett Robinson", cur:"USD", amount:30818, paid:15409, outstanding:15409, usd:15409, terms:"50/50", install:"2026-02-27", daysSince:3, region:"USA", channel:"Direct" },
    { name:"Watchfinder", owner:"Lachie Topp", cur:"GBP", amount:14187, paid:0, outstanding:14187, usd:18063, terms:"Due on Confirmation", install:"2026-02-27", daysSince:3, region:"UK", channel:"Direct" },
    { name:"Cisco Melbourne (MPA)", owner:"Ella Horner", cur:"AUD", amount:55531, paid:30188, outstanding:25343, usd:16012, terms:"Other", install:"2026-02-22", daysSince:8, region:"AUS", channel:"Channel" },
    { name:"ecobee technologies", owner:"Joshua Cherry", cur:"CAD", amount:96321, paid:54422, outstanding:41900, usd:29384, terms:"Other", install:"2026-01-30", daysSince:31, region:"CAD", channel:"Channel" },
  ],
  missingInvoices: [
    { name:"Alo Yoga - 12 Tuesday V2", owner:"Ryan Lenz", cur:"USD", amount:88909, terms:"Net 30 from install", close:"2026-02-04", region:"USA" },
    { name:"WeWork Go - Order #2", owner:"Adam Morgan", cur:"USD", amount:229681, terms:"Other", close:"2026-02-26", region:"USA" },
    { name:"Sony - Basingstoke", owner:"Lachie Topp", cur:"GBP", amount:128791, terms:"Net 30 from install", close:"2026-01-31", region:"UK" },
    { name:"Sony - Milan", owner:"Lachie Topp", cur:"GBP", amount:46289, terms:"Net 30 from install", close:"2026-02-10", region:"UK" },
  ],
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt=n=>{if(n==null)return"—";const a=Math.abs(n);if(a>=1e6)return(n<0?"-":"")+"$"+(a/1e6).toFixed(2)+"M";if(a>=1e3)return(n<0?"-":"")+"$"+(a/1e3).toFixed(0)+"K";return(n<0?"-$":"$")+a.toFixed(0)};
const fmtF=n=>{if(n==null)return"—";return(n<0?"-$":"$")+Math.abs(n).toLocaleString("en-US",{maximumFractionDigits:0})};
const dateFmt=d=>d?new Date(d+"T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—";
const isPast=d=>d&&new Date(d)<new Date();

const Badge=({v,colors})=>{const m={overdue:{bg:C.dangerBg,c:C.danger},current:{bg:C.warnBg,c:C.warn},upcoming:{bg:C.successBg,c:C.success},true:{bg:C.dangerBg,c:C.danger},false:{bg:C.successBg,c:C.success}};const s=m[String(v)]||{bg:C.surfaceWarm,c:C.midGrey};return<span style={{padding:"2px 8px",borderRadius:3,fontSize:10,fontWeight:600,background:s.bg,color:s.c,textTransform:"capitalize",whiteSpace:"nowrap"}}>{String(v)}</span>};

const Pill=({active,color,onClick,children})=><button onClick={onClick} style={{padding:"6px 14px",borderRadius:20,border:`1.5px solid ${active?color:C.border}`,cursor:"pointer",fontFamily:F,fontSize:12,fontWeight:active?600:400,background:active?color+"14":"#fff",color:active?color:C.textMuted,transition:"all 0.15s"}}>{children}</button>;

const DateInput=({value,onChange})=><input type="date" value={value||""} onChange={e=>onChange(e.target.value)} style={{padding:"4px 8px",border:`1px solid ${C.border}`,borderRadius:4,fontSize:11,fontFamily:F,background:C.surface,color:C.text,cursor:"pointer"}}/>;

const SectionHeader=({color,children,right})=><div style={{padding:"10px 16px",borderBottom:`1px solid ${C.border}`,background:color+"12",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontWeight:600,fontSize:13,color}}>{children}</span>{right&&<span style={{fontSize:12,fontWeight:600,color}}>{right}</span>}</div>;

const TH=({children,w})=><th style={{textAlign:"left",padding:"8px 12px",fontSize:9,color:C.textMuted,fontWeight:600,letterSpacing:0.5,textTransform:"uppercase",width:w,whiteSpace:"nowrap"}}>{children}</th>;

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function Dashboard(){
  const [ent,setEnt]=useState(initData);
  const [tab,setTab]=useState("overview");
  const [eTab,setETab]=useState("US");
  const [fx,setFx]=useState({USD:1,CAD:0.7013,GBP:1.2732,AUD:0.6318});
  const [scenario,setScenario]=useState(2);
  const [arSub,setArSub]=useState("definite");
  const [arRegion,setArRegion]=useState("ALL");

  const upd=useCallback((k,path,v)=>{setEnt(p=>{const n=JSON.parse(JSON.stringify(p));let o=n[k];const ps=path.split(".");for(let i=0;i<ps.length-1;i++)o=o[ps[i]];o[ps[ps.length-1]]=v;return n})},[]);
  const updArr=useCallback((k,type,i,field,v)=>{setEnt(p=>{const n=JSON.parse(JSON.stringify(p));n[k][type][i][field]=v;return n})},[]);

  // Waterfall calc
  const WEEKS=["Wk1","Wk2","Wk3","Wk4","Wk5","Wk6","Wk7","Wk8","Wk9","Wk10","Wk11"];
  const calcE=useCallback(k=>{
    const e=ent[k];const cash=k==="CA"?(e.banks.chequing+(e.banks.savings||0)+(e.banks.chequingUSD||0)):k==="AU"?(e.banks.cba||0):(e.banks.chequing||0);
    const totalAR=e.ar.reduce((s,r)=>s+r.outstanding,0);const totalAP=e.ap.reduce((s,r)=>s+r.amount,0);
    const ws=[];let bal=cash;
    for(let w=0;w<11;w++){
      const arIn=totalAR*(w<7?0.08:0.04);const apOut=totalAP*(w<4?0.25:0.05);
      const stock=(e.stockPOs||[]).reduce((s,po)=>s+(w===0?po.deposit:0)+(w===3?po.release:0),0);
      const trade=(e.tradeLoans||[]).reduce((s,l)=>s+(w===1?l.settlement*0.2:0),0);
      const pay=(w%2===0&&e.payroll.freq==="Bimonthly")||(w%4===0&&e.payroll.freq==="Monthly")||(w%2===0&&e.payroll.freq==="Fortnightly")?e.payroll.amount+e.payroll.tax:0;
      const opx=e.opex.marketing+e.opex.rent+e.opex.misc;const amx=w===2?(e.banks.amex||0):0;
      const totIn=arIn;const totOut=apOut+stock+trade+pay+opx+amx;const op=bal;bal=bal+totIn-totOut;
      ws.push({week:WEEKS[w],open:Math.round(op),arIn:Math.round(arIn),apOut:Math.round(apOut),stock:Math.round(stock),trade:Math.round(trade),pay:Math.round(pay),opx:Math.round(opx),amx:Math.round(amx),totIn:Math.round(totIn),totOut:Math.round(totOut),close:Math.round(bal)});
    }
    return{totalAR,totalAP,cash,ws};
  },[ent]);

  const consol=useMemo(()=>{
    const all={};["US","CA","UK","AU"].forEach(k=>all[k]=calcE(k));
    const ws=[];for(let w=0;w<11;w++){let wS=0,eS=0;["US","CA","UK","AU"].forEach(k=>{const f=fx[ent[k].cur]||1;const wk=all[k].ws[w];wS+=wk.close*f;eS+=(wk.close+wk.stock)*f});ws.push({week:WEEKS[w],withStock:Math.round(wS),exStock:Math.round(eS)})}
    return{all,ws};
  },[ent,fx,calcE]);

  const totalCash=["US","CA","UK","AU"].reduce((s,k)=>s+consol.all[k].cash*(fx[ent[k].cur]||1),0);
  const totalAR=["US","CA","UK","AU"].reduce((s,k)=>s+consol.all[k].totalAR*(fx[ent[k].cur]||1),0);

  const TABS=[{id:"overview",l:"Overview"},{id:"ar_chase",l:"AR Chasing"},{id:"entity",l:"Entity Cashflow"},{id:"settings",l:"Settings"}];
  const scLbl={1:"Low",2:"Medium",3:"High"};

  // Styles
  const card={background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"};

  return(
    <div style={{fontFamily:F,background:C.bg,color:C.text,minHeight:"100vh"}}>

      {/* ═══ HEADER — Steel Blue with Canary Yellow accent ═══ */}
      <div style={{background:C.steel,padding:"0 28px",display:"flex",justifyContent:"space-between",alignItems:"center",height:56}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <img src={LOGO} alt="Bureau" style={{height:22,filter:"brightness(0) invert(1)"}} onError={e=>{e.target.style.display="none"}}/>
          <div style={{width:1,height:24,background:"rgba(255,255,255,0.2)",margin:"0 4px"}}/>
          <span style={{fontSize:12,color:"rgba(255,255,255,0.6)",fontWeight:500,letterSpacing:0.5}}>CFO Dashboard</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{display:"flex",gap:2,background:"rgba(255,255,255,0.08)",borderRadius:20,padding:2}}>
            {[1,2,3].map(s=><button key={s} onClick={()=>setScenario(s)} style={{padding:"4px 14px",borderRadius:18,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:F,background:scenario===s?C.yellow:"transparent",color:scenario===s?C.steel:"rgba(255,255,255,0.5)",transition:"all 0.2s"}}>{scLbl[s]}</button>)}
          </div>
        </div>
      </div>

      {/* ═══ NAV — Yellow underline ═══ */}
      <div style={{padding:"0 28px",borderBottom:`1px solid ${C.border}`,background:"#fff",display:"flex"}}>
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"12px 18px",border:"none",borderBottom:tab===t.id?`3px solid ${C.yellow}`:"3px solid transparent",cursor:"pointer",fontSize:13,fontWeight:tab===t.id?600:400,fontFamily:F,background:"transparent",color:tab===t.id?C.steel:C.textMuted,transition:"all 0.15s"}}>{t.l}</button>)}
      </div>

      <div style={{padding:"20px 28px",maxWidth:1340,margin:"0 auto"}}>

        {/* ═══ OVERVIEW ═══ */}
        {tab==="overview"&&<div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:20}}>
            {[
              {l:"Cash Position",v:fmtF(Math.round(totalCash)),s:"Consolidated USD",bc:C.steel},
              {l:"Total AR Outstanding",v:fmt(totalAR),s:"HubSpot Closed Won",bc:C.success},
              {l:"Total AP",v:fmt(699394),s:"Syft + Bureau Ops",bc:C.danger},
              {l:"Min Balance (Wk11)",v:fmt(Math.min(...consol.ws.map(w=>w.withStock))),s:"With stock payments",bc:C.orange},
            ].map((c,i)=><div key={i} style={{...card,padding:"16px 18px",borderLeft:`4px solid ${c.bc}`}}><div style={{fontSize:11,color:C.textMuted,marginBottom:6}}>{c.l}</div><div style={{fontSize:24,fontWeight:700,letterSpacing:-0.5}}>{c.v}</div><div style={{fontSize:11,color:C.textDim,marginTop:2}}>{c.s}</div></div>)}
          </div>

          {/* Waterfall */}
          <div style={{...card,padding:20,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <div><div style={{fontSize:15,fontWeight:600}}>13-Week Cash Position</div><div style={{fontSize:11,color:C.textMuted}}>Consolidated USD — solid = with stock · dashed = excl. stock (lever)</div></div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={consol.ws} margin={{top:5,right:10,left:10,bottom:5}}>
                <XAxis dataKey="week" tick={{fill:C.textMuted,fontSize:10,fontFamily:F}} axisLine={{stroke:C.border}} tickLine={false}/>
                <YAxis tick={{fill:C.textMuted,fontSize:10,fontFamily:F}} axisLine={false} tickLine={false} tickFormatter={v=>fmt(v)}/>
                <ReferenceLine y={200000} stroke={C.danger} strokeDasharray="4 4" strokeOpacity={0.4}/>
                <Tooltip content={({active,payload})=>{if(!active||!payload?.length)return null;const d=payload[0]?.payload;return<div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 12px",fontSize:11,fontFamily:F,boxShadow:"0 4px 12px rgba(0,0,0,0.08)"}}><div style={{fontWeight:600,marginBottom:4}}>{d?.week}</div><div style={{color:C.steel}}>With stock: {fmtF(d?.withStock)}</div><div style={{color:C.blue}}>Excl stock: {fmtF(d?.exStock)}</div><div style={{color:C.warn,marginTop:3,fontSize:10}}>Lever: +{fmtF((d?.exStock||0)-(d?.withStock||0))}</div></div>}}/>
                <Line type="monotone" dataKey="withStock" stroke={C.steel} strokeWidth={2.5} dot={{fill:C.steel,r:3,strokeWidth:0}}/>
                <Line type="monotone" dataKey="exStock" stroke={C.blue} strokeWidth={2} strokeDasharray="6 3" dot={{fill:C.blue,r:2,strokeWidth:0}}/>
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Entity cards */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
            {["US","CA","UK","AU"].map(k=>{const e=ent[k];const c=consol.all[k];return(
              <div key={k} onClick={()=>{setETab(k);setTab("entity")}} style={{...card,padding:16,cursor:"pointer",borderTop:`4px solid ${C.entity[k]}`,background:C.entityBg[k]}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                  <span style={{fontSize:14,fontWeight:700,color:C.entity[k]}}>{k}</span>
                  <span style={{fontSize:10,color:C.textMuted}}>{e.cur}</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:11}}>
                  <div><div style={{fontSize:9,color:C.textMuted}}>Cash</div><div style={{fontWeight:600}}>{fmtF(c.cash)}</div></div>
                  <div><div style={{fontSize:9,color:C.textMuted}}>AR</div><div style={{fontWeight:600,color:C.success}}>{fmt(c.totalAR)}</div></div>
                  <div><div style={{fontSize:9,color:C.textMuted}}>AP</div><div style={{fontWeight:600,color:C.danger}}>{fmt(c.totalAP)}</div></div>
                  <div><div style={{fontSize:9,color:C.textMuted}}>Deals</div><div style={{fontWeight:600}}>{e.ar.length}</div></div>
                </div>
              </div>
            )})}
          </div>
        </div>}

        {/* ═══ AR CHASING (mirrors Excel methodology) ═══ */}
        {tab==="ar_chase"&&<div>
          <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
            {[{id:"definite",l:"Definite Chases",c:C.danger},{id:"postInstall",l:"Post-Install Outstanding",c:C.orange},{id:"missingInvoices",l:"Missing Invoices",c:C.warn}].map(t=>
              <Pill key={t.id} active={arSub===t.id} color={t.c} onClick={()=>setArSub(t.id)}>{t.l} ({(AR_CHASING[t.id]||[]).length})</Pill>
            )}
            <div style={{marginLeft:"auto",display:"flex",gap:4}}>
              {["ALL","USA","CAD","UK","AUS"].map(r=><Pill key={r} active={arRegion===r} color={C.steel} onClick={()=>setArRegion(r)}>{r}</Pill>)}
            </div>
          </div>

          {arSub==="definite"&&<div style={card}>
            <SectionHeader color={C.danger} right={`${AR_CHASING.definite.length} deals · ${fmtF(AR_CHASING.definite.reduce((s,d)=>s+d.usd,0))} USD`}>Definite Chases — Payment Terms Confirmed</SectionHeader>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                <TH w="18%">Deal</TH><TH>Owner</TH><TH>Cur</TH><TH>Outstanding</TH><TH>USD</TH><TH>Terms</TH><TH>Close Date</TH><TH>Age</TH><TH>Promised Date</TH><TH>Overdue</TH>
              </tr></thead>
              <tbody>{(arRegion==="ALL"?AR_CHASING.definite:AR_CHASING.definite.filter(d=>d.region===arRegion)).map((d,i)=>(
                <tr key={i} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2?C.surface:"#fff"}}>
                  <td style={{padding:"8px 12px",fontWeight:500}}>{d.name}</td>
                  <td style={{padding:"8px 12px",color:C.textBody}}>{d.owner}</td>
                  <td style={{padding:"8px 12px",color:C.textMuted}}>{d.cur}</td>
                  <td style={{padding:"8px 12px"}}>{fmtF(d.outstanding)}</td>
                  <td style={{padding:"8px 12px",fontWeight:600}}>{fmtF(d.usd)}</td>
                  <td style={{padding:"8px 12px",color:C.textMuted,fontSize:10}}>{d.terms}</td>
                  <td style={{padding:"8px 12px",fontSize:10}}>{dateFmt(d.close)}</td>
                  <td style={{padding:"8px 12px",color:d.age>30?C.danger:C.textBody,fontWeight:d.age>30?600:400}}>{d.age}d</td>
                  <td style={{padding:"8px 12px",fontSize:10,color:isPast(d.promised)?C.danger:C.textBody}}>{dateFmt(d.promised)}</td>
                  <td style={{padding:"8px 12px"}}><Badge v={d.overdue}/></td>
                </tr>))}</tbody>
            </table></div>
          </div>}

          {arSub==="postInstall"&&<div style={card}>
            <SectionHeader color={C.orange} right={`${AR_CHASING.postInstall.length} deals`}>Post-Install Outstanding</SectionHeader>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                <TH w="18%">Deal</TH><TH>Owner</TH><TH>Cur</TH><TH>Amount</TH><TH>Paid</TH><TH>Outstanding</TH><TH>USD</TH><TH>Install Date</TH><TH>Days Since</TH>
              </tr></thead>
              <tbody>{AR_CHASING.postInstall.map((d,i)=>(
                <tr key={i} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2?C.surface:"#fff"}}>
                  <td style={{padding:"8px 12px",fontWeight:500}}>{d.name}</td>
                  <td style={{padding:"8px 12px",color:C.textBody}}>{d.owner}</td>
                  <td style={{padding:"8px 12px",color:C.textMuted}}>{d.cur}</td>
                  <td style={{padding:"8px 12px"}}>{fmtF(d.amount)}</td>
                  <td style={{padding:"8px 12px",color:C.success}}>{fmtF(d.paid)}</td>
                  <td style={{padding:"8px 12px",fontWeight:600,color:C.danger}}>{fmtF(d.outstanding)}</td>
                  <td style={{padding:"8px 12px",fontWeight:600}}>{fmtF(d.usd)}</td>
                  <td style={{padding:"8px 12px",fontSize:10}}>{dateFmt(d.install)}</td>
                  <td style={{padding:"8px 12px",color:d.daysSince>30?C.danger:C.textBody,fontWeight:600}}>{d.daysSince}d</td>
                </tr>))}</tbody>
            </table></div>
          </div>}

          {arSub==="missingInvoices"&&<div style={card}>
            <SectionHeader color={C.warn} right={`${AR_CHASING.missingInvoices.length} deals — action: raise invoice`}>Missing Invoices — No Invoice Raised</SectionHeader>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                <TH w="22%">Deal</TH><TH>Owner</TH><TH>Cur</TH><TH>Amount</TH><TH>Terms</TH><TH>Close Date</TH><TH>Region</TH>
              </tr></thead>
              <tbody>{AR_CHASING.missingInvoices.map((d,i)=>(
                <tr key={i} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2?C.surface:"#fff"}}>
                  <td style={{padding:"8px 12px",fontWeight:500}}>{d.name}</td>
                  <td style={{padding:"8px 12px",color:C.textBody}}>{d.owner}</td>
                  <td style={{padding:"8px 12px",color:C.textMuted}}>{d.cur}</td>
                  <td style={{padding:"8px 12px",fontWeight:600}}>{fmtF(d.amount)}</td>
                  <td style={{padding:"8px 12px",color:C.textMuted,fontSize:10}}>{d.terms}</td>
                  <td style={{padding:"8px 12px",fontSize:10}}>{dateFmt(d.close)}</td>
                  <td style={{padding:"8px 12px"}}>{d.region}</td>
                </tr>))}</tbody>
            </table></div>
          </div>}
        </div>}

        {/* ═══ ENTITY CASHFLOW ═══ */}
        {tab==="entity"&&(()=>{const k=eTab;const e=ent[k];const c=calcE(k);return<div>
          <div style={{display:"flex",gap:6,marginBottom:16}}>
            {["US","CA","UK","AU"].map(x=><Pill key={x} active={eTab===x} color={C.entity[x]} onClick={()=>setETab(x)}>{ent[x].label}</Pill>)}
          </div>

          {/* Entity header */}
          <div style={{...card,padding:18,marginBottom:16,borderTop:`4px solid ${C.entity[k]}`,background:C.entityBg[k]}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:18,fontWeight:700,color:C.entity[k]}}>{e.label}</div><div style={{fontSize:12,color:C.textMuted}}>{e.name} · {e.cur}</div></div>
              <div style={{display:"flex",gap:24,textAlign:"center"}}>
                <div><div style={{fontSize:10,color:C.textMuted}}>Cash</div><div style={{fontSize:20,fontWeight:700}}>{fmtF(c.cash)}</div></div>
                <div><div style={{fontSize:10,color:C.textMuted}}>AR</div><div style={{fontSize:20,fontWeight:700,color:C.success}}>{fmtF(c.totalAR)}</div></div>
                <div><div style={{fontSize:10,color:C.textMuted}}>AP</div><div style={{fontSize:20,fontWeight:700,color:C.danger}}>{fmtF(c.totalAP)}</div></div>
              </div>
            </div>
          </div>

          {/* Weekly Waterfall Table */}
          <div style={{...card,marginBottom:16}}>
            <SectionHeader color={C.steel}>Weekly Cash Waterfall — {e.name} ({e.cur})</SectionHeader>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                <th style={{textAlign:"left",padding:"8px 12px",fontSize:10,color:C.textMuted,fontWeight:600,minWidth:150}}>Line Item</th>
                {c.ws.slice(0,7).map((w,i)=><th key={i} style={{textAlign:"right",padding:"8px 8px",fontSize:10,color:C.textMuted,fontWeight:600,minWidth:75}}>{w.week}</th>)}
              </tr></thead>
              <tbody>
                <tr style={{background:C.surfaceWarm}}><td style={{padding:"7px 12px",fontWeight:700}}>Opening Balance</td>{c.ws.slice(0,7).map((w,i)=><td key={i} style={{textAlign:"right",padding:"7px 8px",fontWeight:700}}>{fmtF(w.open)}</td>)}</tr>
                <tr><td style={{padding:"6px 12px",color:C.success,fontWeight:600}} colSpan={8}>INFLOWS</td></tr>
                <tr><td style={{padding:"5px 12px 5px 24px",color:C.textBody}}>AR Collections</td>{c.ws.slice(0,7).map((w,i)=><td key={i} style={{textAlign:"right",padding:"5px 8px",color:w.arIn?C.success:C.textDim}}>{w.arIn?fmtF(w.arIn):"—"}</td>)}</tr>
                <tr style={{borderTop:`1px solid ${C.borderLight}`}}><td style={{padding:"6px 12px",fontWeight:600,color:C.success}}>Total Inflows</td>{c.ws.slice(0,7).map((w,i)=><td key={i} style={{textAlign:"right",padding:"6px 8px",fontWeight:600,color:C.success}}>{fmtF(w.totIn)}</td>)}</tr>
                <tr><td style={{padding:"6px 12px",color:C.danger,fontWeight:600}} colSpan={8}>OUTFLOWS</td></tr>
                {[{k:"apOut",l:"Vendor Payments"},{k:"pay",l:"Payroll"},{k:"amx",l:"Amex / Credit"},{k:"opx",l:"Marketing + Opex"},{k:"stock",l:"Stock POs"},{k:"trade",l:"Trade Finance"}].map(r=>
                  <tr key={r.k}><td style={{padding:"5px 12px 5px 24px",color:C.textBody}}>{r.l}</td>{c.ws.slice(0,7).map((w,i)=><td key={i} style={{textAlign:"right",padding:"5px 8px",color:w[r.k]?C.danger:C.textDim}}>{w[r.k]?"-"+fmtF(w[r.k]):"—"}</td>)}</tr>
                )}
                <tr style={{borderTop:`1px solid ${C.border}`}}><td style={{padding:"6px 12px",fontWeight:600,color:C.danger}}>Total Outflows</td>{c.ws.slice(0,7).map((w,i)=><td key={i} style={{textAlign:"right",padding:"6px 8px",fontWeight:600,color:C.danger}}>-{fmtF(w.totOut)}</td>)}</tr>
                <tr style={{background:C.surfaceWarm,borderTop:`2px solid ${C.border}`}}><td style={{padding:"8px 12px",fontWeight:700,fontSize:12}}>Closing Balance</td>{c.ws.slice(0,7).map((w,i)=><td key={i} style={{textAlign:"right",padding:"8px 8px",fontWeight:700,fontSize:12,color:w.close<0?C.danger:C.text}}>{fmtF(w.close)}</td>)}</tr>
              </tbody>
            </table></div>
          </div>

          {/* AR with date pickers */}
          <div style={{...card,marginBottom:16}}>
            <SectionHeader color={C.success} right={fmtF(c.totalAR)+" "+e.cur}>Accounts Receivable — Inflows</SectionHeader>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                <TH w="18%">Customer</TH><TH>Owner</TH><TH>Outstanding</TH><TH>Terms</TH><TH>Close Date</TH><TH>Promised Date</TH><TH>Overdue</TH>
              </tr></thead>
              <tbody>{e.ar.map((r,i)=>(
                <tr key={r.id} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2?C.surface:"#fff"}}>
                  <td style={{padding:"7px 12px",fontWeight:500}}>{r.name}</td>
                  <td style={{padding:"7px 12px",color:C.textBody,fontSize:10}}>{r.owner}</td>
                  <td style={{padding:"7px 12px",fontWeight:600,color:C.success}}>{fmtF(r.outstanding)}</td>
                  <td style={{padding:"7px 12px",color:C.textMuted,fontSize:10}}>{r.terms}</td>
                  <td style={{padding:"7px 12px",fontSize:10}}>{dateFmt(r.close)}</td>
                  <td style={{padding:"7px 12px"}}><DateInput value={r.promised} onChange={v=>updArr(k,"ar",i,"promised",v)}/></td>
                  <td style={{padding:"7px 12px"}}><Badge v={r.overdue}/></td>
                </tr>))}</tbody>
            </table></div>
          </div>

          {/* AP with date pickers */}
          <div style={{...card,marginBottom:16}}>
            <SectionHeader color={C.danger} right={fmtF(c.totalAP)+" "+e.cur}>Accounts Payable — Vendor Outflows</SectionHeader>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                <TH w="30%">Vendor</TH><TH>Amount</TH><TH>Payment Date</TH>
              </tr></thead>
              <tbody>{e.ap.map((r,i)=>(
                <tr key={r.id} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2?C.surface:"#fff"}}>
                  <td style={{padding:"7px 12px",fontWeight:500}}>{r.name}</td>
                  <td style={{padding:"7px 12px",fontWeight:600,color:C.danger}}>{fmtF(r.amount)}</td>
                  <td style={{padding:"7px 12px"}}><DateInput value={r.dueDate} onChange={v=>updArr(k,"ap",i,"dueDate",v)}/></td>
                </tr>))}</tbody>
            </table></div>
          </div>

          {/* Stock POs with date pickers */}
          {(e.stockPOs||[]).length>0&&<div style={{...card,marginBottom:16}}>
            <SectionHeader color={C.warn}>Inventory POs — Bureau Ops</SectionHeader>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                <TH>PO</TH><TH>Supplier</TH><TH>Deposit</TH><TH>Deposit Due</TH><TH>Release</TH><TH>Release Due</TH><TH>Total</TH>
              </tr></thead>
              <tbody>{e.stockPOs.map((po,i)=>(
                <tr key={po.id} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2?C.surface:"#fff"}}>
                  <td style={{padding:"7px 12px",fontWeight:600,color:C.warn}}>{po.id}</td>
                  <td style={{padding:"7px 12px",color:C.textBody}}>{po.supplier}</td>
                  <td style={{padding:"7px 12px"}}>{fmtF(po.deposit)}</td>
                  <td style={{padding:"7px 12px"}}><DateInput value={po.depDue} onChange={v=>updArr(k,"stockPOs",i,"depDue",v)}/></td>
                  <td style={{padding:"7px 12px"}}>{fmtF(po.release)}</td>
                  <td style={{padding:"7px 12px"}}><DateInput value={po.relDue} onChange={v=>updArr(k,"stockPOs",i,"relDue",v)}/></td>
                  <td style={{padding:"7px 12px",fontWeight:600}}>{fmtF(po.deposit+po.release)}</td>
                </tr>))}</tbody>
            </table></div>
          </div>}

          {/* Trade Finance (AU) */}
          {(e.tradeLoans||[]).length>0&&<div style={{...card}}>
            <SectionHeader color={C.danger}>Trade Finance Maturities (AUD)</SectionHeader>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
                <TH>Reference</TH><TH>PO</TH><TH>Outstanding</TH><TH>Settlement</TH><TH>Maturity</TH>
              </tr></thead>
              <tbody>{e.tradeLoans.map((l,i)=>(
                <tr key={l.ref} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2?C.surface:"#fff"}}>
                  <td style={{padding:"7px 12px",fontSize:10,fontWeight:500}}>{l.ref}</td>
                  <td style={{padding:"7px 12px",color:C.textMuted}}>{l.po}</td>
                  <td style={{padding:"7px 12px"}}>{fmtF(l.outstanding)}</td>
                  <td style={{padding:"7px 12px",fontWeight:600,color:C.danger}}>{fmtF(l.settlement)}</td>
                  <td style={{padding:"7px 12px"}}><DateInput value={l.maturity} onChange={v=>updArr(k,"tradeLoans",i,"maturity",v)}/></td>
                </tr>))}</tbody>
            </table>
          </div>}
        </div>})()}

        {/* ═══ SETTINGS ═══ */}
        {tab==="settings"&&<div>
          <div style={{fontSize:16,fontWeight:700,marginBottom:14}}>Bank Accounts — Opening Balances</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
            {["US","CA","UK","AU"].map(k=>{const e=ent[k];const bk=e.banks;
              const fields=k==="US"?[["chequing","Chequing"],["amex","Amex"]]:k==="CA"?[["chequing","Chequing (CAD)"],["savings","Savings (CAD)"],["chequingUSD","Chequing (USD)"],["amex","Amex"]]:k==="UK"?[["chequing","Chequing"]]:k==="AU"?[["cba","CBA"],["amex","Amex"]]:[];
              return<div key={k} style={{...card,padding:16,borderTop:`4px solid ${C.entity[k]}`,background:C.entityBg[k]}}>
                <div style={{fontSize:13,fontWeight:700,color:C.entity[k],marginBottom:10}}>{k} · {e.cur}</div>
                {fields.map(([f,l])=><div key={f} style={{marginBottom:8}}><div style={{fontSize:10,color:C.textMuted,marginBottom:2}}>{l}</div><input type="number" value={bk[f]||0} onChange={ev=>upd(k,`banks.${f}`,Number(ev.target.value)||0)} style={{width:"100%",padding:"6px 10px",border:`1px solid ${C.border}`,borderRadius:5,fontSize:13,fontFamily:F,background:"#fff",color:C.text,boxSizing:"border-box"}}/></div>)}
              </div>})}
          </div>

          <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>FX Rates</div>
          <div style={{display:"flex",gap:16,marginBottom:24}}>
            {["CAD","GBP","AUD"].map(c=><div key={c}><div style={{fontSize:10,color:C.textMuted,marginBottom:3}}>{c} → USD</div><input type="number" step="0.0001" value={fx[c]} onChange={ev=>setFx({...fx,[c]:parseFloat(ev.target.value)||0})} style={{width:90,padding:"6px 10px",border:`1px solid ${C.border}`,borderRadius:5,fontSize:13,fontFamily:F,color:C.text}}/></div>)}
          </div>

          <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>Payroll & Compensation</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
            {["US","CA","UK","AU"].map(k=>{const e=ent[k];return<div key={k} style={{...card,padding:16}}>
              <div style={{fontSize:12,fontWeight:600,color:C.entity[k],marginBottom:8}}>{k} · {e.payroll.freq}</div>
              {[["amount","Payroll & Benefits"],["tax","Payroll Tax"]].map(([f,l])=><div key={f} style={{marginBottom:6}}><div style={{fontSize:10,color:C.textMuted,marginBottom:2}}>{l}</div><input type="number" value={e.payroll[f]} onChange={ev=>upd(k,`payroll.${f}`,Number(ev.target.value)||0)} style={{width:"100%",padding:"5px 8px",border:`1px solid ${C.border}`,borderRadius:4,fontSize:12,fontFamily:F,background:C.surface,color:C.text,boxSizing:"border-box"}}/></div>)}
            </div>})}
          </div>

          <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>Operating Expenses (Weekly)</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
            {["US","CA","UK","AU"].map(k=>{const e=ent[k];return<div key={k} style={{...card,padding:16}}>
              <div style={{fontSize:12,fontWeight:600,color:C.entity[k],marginBottom:8}}>{k}</div>
              {[["marketing","Marketing"],["rent","Rent"],["misc","Misc"]].map(([f,l])=><div key={f} style={{marginBottom:6}}><div style={{fontSize:10,color:C.textMuted,marginBottom:2}}>{l}</div><input type="number" value={e.opex[f]} onChange={ev=>upd(k,`opex.${f}`,Number(ev.target.value)||0)} style={{width:"100%",padding:"5px 8px",border:`1px solid ${C.border}`,borderRadius:4,fontSize:12,fontFamily:F,background:C.surface,color:C.text,boxSizing:"border-box"}}/></div>)}
            </div>})}
          </div>
        </div>}
      </div>

      {/* FOOTER */}
      <div style={{borderTop:`1px solid ${C.border}`,padding:"10px 28px",display:"flex",justifyContent:"space-between",fontSize:10,color:C.textDim,background:C.surfaceWarm}}>
        <span>Bureau CFO Dashboard · HubSpot + Bureau Ops + Syft</span>
        <span>FX: CAD {fx.CAD} | GBP {fx.GBP} | AUD {fx.AUD}</span>
      </div>
    </div>
  );
}
