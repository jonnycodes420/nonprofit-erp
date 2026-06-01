import { useState, useRef } from "react";
import { streamAI } from "../api";

// ── Design tokens ──────────────────────────────────────────────────────────
export const T = {
  // Backgrounds
  bg:         "#f0ede6",
  bg2:        "#e8e4dc",
  bg3:        "#d4cfc6",
  bgDark:     "#0f1a12",
  bgCard:     "#ffffff",
  bgElevated: "#1a2e1f",
  // Ink
  ink:        "#0a0a0a",
  ink2:       "#2d2d2d",
  ink3:       "#6b6560",
  inkInverse: "#f0ede6",
  // Greens
  green:      "#10b981",
  greenDk:    "#0d5c3a",
  greenMid:   "#1a6b4a",
  greenPale:  "#d1fae5",
  // Accents
  gold:       "#c9a84c",
  red:        "#c0392b",
  amber:      "#d97706",
  blue:       "#2563eb",
  // Surfaces
  white:      "#ffffff",
  shadow:     "0 1px 3px rgba(10,10,10,0.08), 0 4px 16px rgba(10,10,10,0.06)",
  shadowMd:   "0 4px 24px rgba(10,10,10,0.12), 0 1px 4px rgba(10,10,10,0.08)",
  shadowLg:   "0 8px 48px rgba(10,10,10,0.18), 0 2px 8px rgba(10,10,10,0.10)",
  radius:     "12px",
  radiusSm:   "8px",
  radiusLg:   "16px",
};

// ── Helpers ────────────────────────────────────────────────────────────────
export const fmt = n => n>=1000?`$${(n/1000).toFixed(n%1000===0?0:1)}k`:`$${n.toLocaleString()}`;
export const fmtFull = n => `$${n.toLocaleString()}`;
export const daysDiff = d => Math.floor((new Date()-new Date(d))/86400000);
export const daysUntil = d => Math.floor((new Date(d)-new Date())/86400000);
export const SC = { major:"#1a6b4a",mid:"#3b82f6",new:"#8b5cf6",lapsed:"#f59e0b",converted:"#1a6b4a",active:"#1a6b4a",pending:"#3b82f6",prospecting:"#8b5cf6",closed:"#6b7280",high:"#ef4444",medium:"#f59e0b",low:"#6b7280" };
export const askClaude = (system, user, onChunk) => streamAI(system, user, onChunk);

// ── Org Context Builder ────────────────────────────────────────────────────
export function buildContext(data) {
  const rev = data.financials.revenue; const exp = data.financials.expenses;
  const ytdRev = rev.reduce((s,r)=>s+r.individual+r.grants+r.events+r.other,0);
  const ytdExp = exp.reduce((s,e)=>s+e.programs+e.admin+e.fundraising,0);
  return `ORGANIZATION: ${data.org.name}
MISSION: ${data.org.mission}
PROGRAMS: ${data.org.programs.join(", ")}

DONORS (${data.donors.length} total, ${data.donors.filter(d=>d.status==="lapsed").length} lapsed):
${data.donors.map(d=>`- ${d.name} [${d.status}]: ${fmtFull(d.total)} lifetime, last gift ${fmtFull(d.lastAmount)} ${daysDiff(d.lastGift)}d ago. ${d.notes}`).join("\n")}

GRANTS:
${data.grants.map(g=>`- ${g.funder} / ${g.program}: ${fmtFull(g.amount)} [${g.status}] deadline ${g.deadline}. ${g.notes}`).join("\n")}

FINANCIALS: YTD Revenue ${fmtFull(ytdRev)} | YTD Expenses ${fmtFull(ytdExp)} | Net ${fmtFull(ytdRev-ytdExp)}
FUND BALANCES: ${data.financials.funds.map(f=>`${f.name}: ${fmtFull(f.balance)}${f.restricted?" (restricted)":""}`).join(", ")}

BOARD (${data.board.length} members): ${data.board.map(b=>`${b.name} (${b.role}, ${b.givingLevel})`).join(", ")}

OPEN TASKS: ${data.tasks.filter(t=>!t.done).map(t=>`[${t.priority}] ${t.title} due ${t.due}`).join("; ")}`;
}

// ── Stage config ───────────────────────────────────────────────────────────
export const STAGES = [
  {id:"prospect",  label:"Prospect",  color:T.ink3, hint:"Identified, not yet engaged"},
  {id:"qualify",   label:"Qualify",   color:"#3b82f6", hint:"Researching fit & capacity"},
  {id:"cultivate", label:"Cultivate", color:"#8b5cf6", hint:"Building relationship"},
  {id:"solicit",   label:"Solicit",   color:"#f59e0b", hint:"Ready for the ask"},
  {id:"steward",   label:"Steward",   color:"#1a6b4a", hint:"Deepen post-gift relationship"},
  {id:"lapsed",    label:"Lapsed",    color:"#ef4444", hint:"Needs re-engagement"},
];
export const STAGE_THRESH = {prospect:[60,120],qualify:[14,30],cultivate:[30,60],solicit:[7,14],steward:[30,90],lapsed:[90,180]};
export const STAGE_ACTION = {
  prospect:"Research capacity — find a warm intro",
  qualify: "Schedule a discovery call or coffee",
  cultivate:"Share an impact story or invite to a program visit",
  solicit: "Book a gift conversation and make the ask",
  steward: "Send personalized impact update or thank you",
  lapsed:  "Personal outreach — acknowledge lapse, invite back",
};
export const TIER_COLOR = {Micro:"#6b7280",Small:"#3b82f6",Mid:"#1a6b4a",Major:"#8b5cf6",Principal:"#f59e0b"};

// ── Score helpers ──────────────────────────────────────────────────────────
export function donorScore(d) {
  let s=0;
  if(d.total>20000)s+=35; else if(d.total>5000)s+=22; else if(d.total>1000)s+=12; else s+=5;
  const days=daysDiff(d.lastGift);
  if(days<90)s+=30; else if(days<180)s+=22; else if(days<365)s+=12;
  s+=Math.min(d.gifts*4,20);
  if(d.status==="lapsed")s-=15;
  if(d.tags.includes("board-adjacent"))s+=10;
  if(d.tags.includes("recurring"))s+=5;
  return Math.max(5,Math.min(s,99));
}

export function retentionRisk(d) {
  const days = daysDiff(d.lastGift);
  let risk = 0;
  if (days > 365) risk += 40; else if (days > 270) risk += 25; else if (days > 180) risk += 12;
  if (d.gifts < 2) risk += 20; else if (d.gifts < 4) risk += 8;
  if (d.status === "lapsed") risk += 30;
  if (d.tags.includes("recurring")) risk -= 15;
  if (d.tags.includes("board-adjacent")) risk -= 10;
  risk = Math.max(0, Math.min(risk, 99));
  const level = risk >= 55 ? "high" : risk >= 30 ? "medium" : "low";
  const reasons = [];
  if (days > 270) reasons.push(`${days}d since last gift`);
  if (d.gifts < 2) reasons.push("one-time donor");
  if (d.status === "lapsed") reasons.push("marked lapsed");
  const actions = { high:"Call this week — personal touch required", medium:"Send a targeted update in next 2 weeks", low:"Keep on regular cadence" };
  return { risk, level, reason: reasons.join(", ") || "steady engagement", action: actions[level] };
}

export function moveUrgency(d) {
  const lastContact=d.lastTouchpoint||d.lastGift;
  const days=lastContact?daysDiff(lastContact):999;
  const [warn,crit]=STAGE_THRESH[d.stage||"cultivate"]||[30,60];
  const level=days>crit?"critical":days>warn?"due":"ok";
  const urgencyColor={critical:"#ef4444",due:"#f59e0b",ok:"#1a6b4a"}[level];
  const contactTextColor=days>365?"#ef4444":days>180?"#f59e0b":T.ink3;
  return{days,level,urgencyColor,contactTextColor};
}

// ── Global styles ──────────────────────────────────────────────────────────
export function GlobalStyles() {
  return <style>{`
    html,body{margin:0;padding:0;overflow-x:hidden;max-width:100vw;background:#f0ede6;-webkit-font-smoothing:antialiased;}
    *{box-sizing:border-box;}
    body{font-family:'DM Sans',system-ui,sans-serif;color:#0a0a0a;}
    h1,h2,h3{font-family:'DM Serif Display',Georgia,serif;letter-spacing:-0.02em;}
    ::-webkit-scrollbar{width:5px;height:5px;}
    ::-webkit-scrollbar-track{background:#e8e4dc;}
    ::-webkit-scrollbar-thumb{background:#c9a84c;border-radius:99px;}
    ::-webkit-scrollbar-thumb:hover{background:#b8933c;}
    ::selection{background:#0d5c3a22;color:#0a0a0a;}
    input,textarea,select{background:#f8f6f2;border:1.5px solid #d4cfc6;border-radius:8px;color:#0a0a0a;transition:border-color 0.15s,box-shadow 0.15s;}
    input:focus,textarea:focus,select:focus{border-color:#0d5c3a!important;box-shadow:0 0 0 3px rgba(13,92,58,0.12)!important;outline:none!important;}
    button{transition:all 0.15s ease;}
    button:not(:disabled):active{transform:scale(0.97);}
    @keyframes sp{to{transform:rotate(360deg)}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
    @keyframes slideup{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
    .fade-in{animation:fadeIn 0.2s ease-out both;}
    .slide-in{animation:slideIn 0.18s ease-out both;}
    .slide-up{animation:slideup 0.25s ease both;}
    .modal-anim{animation:slideUp 0.2s ease-out both;}
    .card-click{transition:transform 0.15s ease,box-shadow 0.15s ease,border-color 0.15s;}
    .card-click:hover{box-shadow:0 4px 24px rgba(10,10,10,0.12)!important;transform:translateY(-1px);border-color:#0d5c3a!important;}
    .dash-row:hover{background:#f0ede6!important;box-shadow:inset 2px 0 0 #0d5c3a;}
    .dash-action:hover{background:#f0ede6!important;border-color:#0d5c3a!important;transform:translateY(-1px);}

    /* ── Mobile bottom nav (hidden on desktop) ─────────────────────────── */
    .mobile-bottom-bar{display:none;position:fixed;bottom:0;left:0;right:0;z-index:150;background:#0f1a12;border-top:1px solid #1a2e1f;box-shadow:0 -1px 0 rgba(0,0,0,.2),0 -4px 20px rgba(0,0,0,.15);padding-bottom:env(safe-area-inset-bottom,0px);}
    .mobile-bottom-tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:transparent;border:none;cursor:pointer;padding:8px 4px;color:#8fa896;font-family:'DM Sans',system-ui,sans-serif;font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;min-height:60px;transition:color .15s;}
    .mobile-bottom-tab .mob-icon{font-size:18px;line-height:1.2;margin-bottom:1px;display:block;}
    .mobile-bottom-tab.active{color:#c9a84c;}
    .mobile-more-overlay{display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.6);align-items:flex-end;}
    .mobile-more-drawer{background:#0f1a12;border-radius:20px 20px 0 0;width:100%;padding-bottom:env(safe-area-inset-bottom,0px);overflow:hidden;}
    .mobile-more-handle{width:36px;height:4px;border-radius:2px;background:#1a2e1f;margin:12px auto 4px;}
    .mobile-more-row{display:flex;align-items:center;gap:16px;width:100%;background:transparent;border:none;border-bottom:1px solid #1a2e1f;padding:16px 24px;color:#f0ede6;font-family:'DM Sans',system-ui,sans-serif;font-size:16px;font-weight:500;cursor:pointer;text-align:left;}
    .mobile-more-row .mob-icon{font-size:20px;width:28px;text-align:center;flex-shrink:0;}
    .mobile-more-row.active{color:#c9a84c;font-weight:700;}
    .mobile-more-signout{display:flex;align-items:center;gap:16px;width:100%;background:transparent;border:none;padding:16px 24px;color:#8fa896;font-family:'DM Sans',system-ui,sans-serif;font-size:16px;font-weight:400;cursor:pointer;text-align:left;}

    @media(max-width:768px){
      /* Root overflow kill — nothing bleeds past viewport */
      .app-root{overflow-x:hidden!important;max-width:100vw!important;}
      .app-content{padding:20px 16px calc(68px + env(safe-area-inset-bottom,0px)) 16px!important;max-width:100%!important;overflow-x:hidden!important;}

      /* Navigation */
      .app-tabbar{display:none!important;}
      .app-signout{display:none!important;}
      .mobile-bottom-bar{display:flex!important;}
      .mobile-more-overlay{display:flex!important;}

      /* Dashboard stat cards: 2×2 */
      .dash-stat-grid{grid-template-columns:repeat(2,1fr)!important;}
      /* Dashboard two-col layout: stack */
      .dash-main-grid{grid-template-columns:1fr!important;}
      /* Dashboard mobile comprehensive */
      .dash-root{font-size:14px!important;}
      .dash-stat-num{font-size:24px!important;}
      .dash-cpad{padding:12px!important;}
      .dash-briefing-body{padding:12px 14px!important;}
      .dash-briefing-hdr{flex-wrap:wrap!important;align-items:flex-start!important;gap:8px!important;}
      .dash-briefing-hdr>div:last-child{align-self:flex-start!important;}
      /* Pipeline: outer card allows overflow, inner scroll wrapper contains it */
      .dash-pipeline-card{overflow:visible!important;}
      .dash-pipeline-scroll{overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;width:100%!important;}
      .dash-pipeline-grid{display:grid!important;grid-template-columns:repeat(6,82px)!important;}
      .dash-pipeline-grid>div>div:first-child{font-size:11px!important;}
      .dash-pipeline-grid>div>div:last-child{font-size:13px!important;}
      /* Lapsed alert: full width, contained */
      .dash-lapsed{flex-wrap:wrap!important;gap:12px!important;width:100%!important;box-sizing:border-box!important;}
      .dash-lapsed>div{flex:1!important;min-width:0!important;}
      .dash-lapsed>button{align-self:flex-start!important;}
      /* General column containment */
      .dash-main-grid>div{min-width:0!important;width:100%!important;}
      .dash-quick-btn{min-height:44px!important;padding:10px 6px!important;}
      .dash-quick-label{font-size:12px!important;}
      .dash-activity-note{overflow:hidden!important;display:-webkit-box!important;-webkit-line-clamp:2!important;-webkit-box-orient:vertical!important;white-space:normal!important;text-overflow:unset!important;}

      /* Donors toolbar */
      .donors-toolbar{flex-direction:column!important;align-items:stretch!important;gap:8px!important;}
      .donors-search{flex:none!important;min-width:unset!important;width:100%!important;}
      .donors-view-toggle{width:100%!important;}
      .donors-view-toggle button{flex:1!important;justify-content:center!important;}

      /* Kanban: contained horizontal scroll only — page never scrolls horiz */
      .donor-kanban-wrap{display:flex!important;flex-direction:row!important;overflow-x:auto!important;overflow-y:visible!important;-webkit-overflow-scrolling:touch!important;scroll-snap-type:x mandatory!important;align-items:flex-start!important;min-height:auto!important;padding-bottom:12px!important;gap:10px!important;width:100%!important;}
      .kanban-col{min-width:268px!important;width:268px!important;max-width:268px!important;flex-shrink:0!important;scroll-snap-align:start!important;}

      /* Donor profile: single column, 2×2 stat mini-cards */
      .donor-profile-body{grid-template-columns:1fr!important;overflow:auto!important;}
      .donor-profile-header{padding:10px 16px!important;}
      .donor-stat-grid{grid-template-columns:repeat(2,1fr)!important;}

      /* ReEngage table: hide non-essential columns, fix grid template */
      .reEngage-header{grid-template-columns:1fr 90px 100px!important;}
      .reEngage-row{grid-template-columns:1fr 90px 100px!important;}
      .re-col-lifetime,.re-col-lastgift,.re-col-score{display:none!important;}

      /* Filter bar */
      .filter-bar{flex-direction:column!important;gap:12px!important;}
      .filter-bar-row{flex-direction:column!important;align-items:flex-start!important;gap:8px!important;}

      /* Mobile modal sheets */
      .modal-sheet-overlay{align-items:flex-end!important;padding:0!important;}
      .modal-sheet-inner{border-radius:20px 20px 0 0!important;max-width:100%!important;width:100%!important;max-height:90vh!important;margin:0!important;}

      /* Ensure all cards and containers never exceed viewport */
      .fade-in,[class*="card"]{max-width:100%!important;}

      /* Finance sub-tab: horizontal scroll strip */
      .finance-subtab-bar{overflow-x:auto!important;flex-wrap:nowrap!important;-webkit-overflow-scrolling:touch!important;}
      .finance-subtab-bar button{flex-shrink:0!important;white-space:nowrap!important;}

      /* Grants pipeline + profile */
      .grants-pipeline-grid{grid-template-columns:repeat(2,1fr)!important;}
      .grant-profile-body{display:flex!important;flex-direction:column!important;overflow-y:auto!important;overflow-x:hidden!important;}
      .grant-profile-body>div{overflow-y:visible!important;border-right:none!important;padding:14px 16px!important;}
      .grant-stat-grid{grid-template-columns:repeat(2,1fr)!important;}
      .grant-2col{grid-template-columns:1fr!important;}
      .grant-add-form-grid{grid-template-columns:1fr!important;}

      /* Communications: sidebar → horizontal scroll nav bar */
      .comm-layout{flex-direction:column!important;min-height:0!important;}
      .comm-sidebar{width:100%!important;flex-direction:row!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;padding:6px 8px!important;border-right:none!important;border-bottom:1px solid #ddd9d0!important;flex-shrink:0!important;gap:0!important;}
      .comm-sidebar-label{display:none!important;}
      .comm-sidebar button{margin:2px 3px!important;padding:8px 12px!important;}
      .comm-main{min-height:0!important;overflow-y:auto!important;}

      /* Volunteers + Board: 3-col → 2-col */
      .vol-metric-grid,.board-metric-grid{grid-template-columns:repeat(2,1fr)!important;}
    }
  `}</style>;
}

// ── UI Atoms ───────────────────────────────────────────────────────────────
export function Spin() {
  return <span style={{display:"inline-block",width:11,height:11,border:"2px solid #ffffff30",borderTopColor:"#fff",borderRadius:"50%",animation:"sp 0.7s linear infinite",flexShrink:0}}/>;
}
export function Pill({label,color}) {
  return <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",padding:"4px 10px",borderRadius:99,background:(color||T.ink3)+"1a",color:color||T.ink3,whiteSpace:"nowrap",border:`1px solid ${(color||T.ink3)}28`}}>{label}</span>;
}
export function Card({children,selected,accent,onClick,style={},variant}) {
  const base = variant==="dark"
    ? {background:"#0f1a12",border:`1px solid ${selected?"#c9a84c":"#1a2e1f"}`,color:"#f0ede6"}
    : variant==="elevated"
    ? {background:T.white,border:`1px solid ${selected?accent||T.greenDk:T.bg3}`,boxShadow:T.shadowMd}
    : {background:T.white,border:`1px solid ${selected?accent||T.greenDk:T.bg3}`,boxShadow:T.shadow};
  return <div onClick={onClick} className={onClick?"card-click":""} style={{...base,borderRadius:14,padding:"20px 24px",cursor:onClick?"pointer":"default",...style}}>{children}</div>;
}
export function SectionLabel({children}) {
  return <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:T.ink3,marginBottom:12}}>{children}</div>;
}
export function AIBtn({onClick,loading,label="✦ AI Assist",small}) {
  return <button onClick={onClick} disabled={loading} style={{background:loading?"#1a2e1f":"linear-gradient(135deg,#0d5c3a,#1a6b4a)",border:"none",borderRadius:small?8:10,padding:small?"6px 12px":"9px 16px",color:"#f0ede6",fontSize:small?12:13,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:loading?0.65:1,whiteSpace:"nowrap",boxShadow:loading?"none":"0 2px 12px rgba(13,92,58,0.35)",letterSpacing:"0.01em"}}>
    {loading?<><Spin/>Thinking…</>:label}
  </button>;
}
export function AIPanel({text,onClose}) {
  if(!text) return null;
  return <div className="fade-in modal-anim" style={{background:"#0f1a12",border:"1px solid #1a2e1f",borderLeft:"3px solid #c9a84c",borderRadius:14,padding:"18px 20px",position:"relative",marginTop:12}}>
    <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:"#c9a84c",marginBottom:10,display:"flex",alignItems:"center",gap:6}}><span>✦</span> AI Intelligence</div>
    <div style={{fontSize:13,color:"#e8e4dc",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{text}</div>
    {onClose&&<button onClick={onClose} style={{position:"absolute",top:12,right:14,background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:6,color:"#8fa896",cursor:"pointer",fontSize:14,lineHeight:1,width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>×</button>}
  </div>;
}
export function MetricCard({label,value,sub,color,trend}) {
  return <div className="fade-in" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 20px",display:"flex",flexDirection:"column",gap:5,borderLeft:`3px solid ${color||T.bg3}`,boxShadow:T.shadow}}>
    <span style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:T.ink3}}>{label}</span>
    <span style={{fontSize:28,fontWeight:800,color:color||T.ink,fontFamily:"'DM Serif Display',serif",lineHeight:1.05,letterSpacing:"-0.02em"}}>{value}</span>
    {sub&&<span style={{fontSize:11,color:T.ink3}}>{sub}</span>}
    {trend!==undefined&&<span style={{fontSize:11,color:trend>=0?T.greenMid:T.red,fontWeight:600}}>{trend>=0?"↑":"↓"} {Math.abs(trend)}%</span>}
  </div>;
}
export function EmptyState({icon,title,message,action,onAction}) {
  return <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"52px 24px",gap:12,textAlign:"center"}}>
    <div style={{fontSize:36,marginBottom:4,opacity:0.25,color:T.greenDk}}>{icon||"◇"}</div>
    <div style={{fontSize:15,fontWeight:700,color:T.ink2}}>{title||"Nothing here yet"}</div>
    <div style={{fontSize:13,color:T.ink3,maxWidth:340,lineHeight:1.65}}>{message||"Nothing here yet — this is where the magic starts."}</div>
    {action&&<button onClick={onAction} style={{marginTop:8,background:T.greenDk,border:"none",borderRadius:10,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 2px 10px rgba(26,107,74,0.2)"}}>{action}</button>}
  </div>;
}
export function PageTitle({main,accent,sub}) {
  return (
    <div style={{marginBottom:16}}>
      <h1 style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:32,fontWeight:400,letterSpacing:"-0.02em",margin:0,lineHeight:1.15}}>
        <span style={{color:T.ink3}}>{main}{" "}</span><span style={{color:T.ink,borderBottom:"3px solid #c9a84c",paddingBottom:2}}>{accent}</span>
      </h1>
      {sub&&<div style={{fontSize:14,color:T.ink3,marginTop:6,fontFamily:"'DM Sans',sans-serif"}}>{sub}</div>}
    </div>
  );
}
export function GivingHistoryChart({gifts}) {
  if (!gifts?.length) return <div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",color:T.ink3,fontSize:12}}>No gift history recorded</div>;
  const sorted=[...gifts].sort((a,b)=>new Date(a.date)-new Date(b.date));
  const maxAmt=Math.max(...sorted.map(g=>g.amount),1);
  const W=500,H=110,pad={t:8,r:16,b:24,l:44};
  const pw=W-pad.l-pad.r, ph=H-pad.t-pad.b;
  const xs=sorted.map((_,i)=>pad.l+(sorted.length>1?(i/(sorted.length-1))*pw:pw/2));
  const ys=sorted.map(g=>pad.t+ph-(g.amount/maxAmt)*ph);
  const pts=xs.map((x,i)=>`${x},${ys[i]}`).join(" ");
  const area=sorted.length>1?`M ${xs[0]},${pad.t+ph} L ${xs.map((x,i)=>`${x} ${ys[i]}`).join(" L ")} L ${xs[xs.length-1]},${pad.t+ph} Z`:null;
  const yearOf=g=>new Date(g.date).getFullYear();
  return(
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",overflow:"visible"}}>
      <defs>
        <linearGradient id="giftGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a6b4a" stopOpacity="0.22"/>
          <stop offset="100%" stopColor="#1a6b4a" stopOpacity="0.01"/>
        </linearGradient>
      </defs>
      {area&&<path d={area} fill="url(#giftGrad)"/>}
      {sorted.length>1&&<polyline points={pts} stroke="#1a6b4a" strokeWidth="2" fill="none" strokeLinejoin="round"/>}
      {sorted.map((g,i)=>(
        <g key={i}>
          <circle cx={xs[i]} cy={ys[i]} r={4} fill="#1a6b4a" stroke={T.white} strokeWidth={1.5}/>
          <title>${g.amount.toLocaleString()} · {g.date}</title>
        </g>
      ))}
      <text x={pad.l-4} y={pad.t+7} textAnchor="end" fontSize={9} fill={T.ink3}>{fmt(maxAmt)}</text>
      <text x={pad.l-4} y={pad.t+ph+1} textAnchor="end" fontSize={9} fill={T.ink3}>$0</text>
      {sorted.map((g,i)=>(i===0||i===sorted.length-1||(sorted.length<=6))?(
        <text key={i} x={xs[i]} y={H-4} textAnchor="middle" fontSize={9} fill={T.ink3}>{yearOf(g)}</text>
      ):null)}
    </svg>
  );
}

// ── Touchpoint helpers (module-level to avoid focus-loss on re-render) ──────
export function TpField({label,children}){
  return <div style={{display:"flex",flexDirection:"column",gap:4}}>
    <span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5,display:"block"}}>{label}</span>
    {children}
  </div>;
}
export function TpYesNo({val,set}){
  return <div style={{display:"flex",gap:6}}>
    {["yes","no"].map(v=><button key={v} onClick={()=>set(v)} style={{background:val===v?"#10b981":T.bg,border:`1px solid ${val===v?"#10b981":T.bg3}`,borderRadius:7,padding:"7px 20px",color:val===v?"#fff":T.ink3,fontSize:13,fontWeight:600,cursor:"pointer"}}>{v}</button>)}
  </div>;
}
export function TouchpointTimeline({interactions}){
  if(!interactions?.length)return<div style={{fontSize:13,color:T.ink3,textAlign:"center",padding:"16px 0"}}>No touchpoints logged yet.</div>;
  const typeColor={call:"#3b82f6",email:"#8b5cf6",meeting:T.greenMid,gift:"#f59e0b",event:"#ec4899",note:"#6b7280"};
  const sorted=[...interactions].sort((a,b)=>new Date(b.date)-new Date(a.date));
  return(
    <div style={{display:"flex",flexDirection:"column",gap:0}}>
      {sorted.map((int,i)=>{
        const c=typeColor[int.type]||"#6b7280";
        const dAgo=daysDiff(int.date);
        const when=dAgo===0?"Today":dAgo===1?"Yesterday":`${dAgo}d ago`;
        return(
          <div key={i} style={{display:"flex",gap:12,paddingBottom:16,position:"relative"}}>
            {i<sorted.length-1&&<div style={{position:"absolute",left:12,top:26,width:2,bottom:0,background:T.bg3}}/>}
            <div style={{width:26,height:26,borderRadius:"50%",background:c+"28",border:`2px solid ${c}`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1,marginTop:2}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:c}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
                <span style={{fontSize:11,fontWeight:700,textTransform:"capitalize",color:c}}>{int.type}</span>
                <span style={{fontSize:11,color:T.ink3}}>{int.date}</span>
                <span style={{fontSize:11,color:T.ink3,opacity:0.6}}>({when})</span>
              </div>
              <div style={{fontSize:13,color:T.ink2,lineHeight:1.5}}>{int.note}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
