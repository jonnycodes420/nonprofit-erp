import { useState, useRef } from "react";
import { streamAI } from "../api";

// ── Design tokens ──────────────────────────────────────────────────────────
export const T = {
  bg:     "#f0ede6",
  bg2:    "#e8e4db",
  bg3:    "#ddd9d0",
  white:  "#ffffff",
  ink:    "#0f0f0f",
  ink2:   "#2a2a2a",
  ink3:   "#6b6b6b",
  green:  "#10b981",
  greenDk:"#1a6b4a",
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
    *{box-sizing:border-box;-webkit-font-smoothing:antialiased;}
    ::-webkit-scrollbar{width:5px;height:5px;}
    ::-webkit-scrollbar-track{background:#f0ede6;}
    ::-webkit-scrollbar-thumb{background:#c8c4bb;border-radius:4px;}
    ::-webkit-scrollbar-thumb:hover{background:#b0aca3;}
    ::selection{background:#10b98133;color:#0f0f0f;}
    input,textarea,select{transition:border-color 0.15s,box-shadow 0.15s;}
    input:focus,textarea:focus,select:focus{border-color:#10b981!important;box-shadow:0 0 0 3px #10b98118;outline:none;}
    button{transition:opacity 0.12s,transform 0.1s,background 0.12s;}
    button:not(:disabled):active{transform:scale(0.96);}
    @keyframes sp{to{transform:rotate(360deg)}}
    @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slidein{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
    .fade-in{animation:fadein 0.22s ease both;}
    .slide-in{animation:slidein 0.22s ease both;}
    .card-click:hover{border-color:#1a6b4a!important;transform:translateY(-1px);}
    .card-click{transition:border-color 0.15s,transform 0.15s;}
    .dash-row:hover{background:#f7f4ef!important;box-shadow:inset 2px 0 0 #1a6b4a;}
    .dash-action:hover{background:#f0fdf4!important;border-color:#1a6b4a!important;}
  `}</style>;
}

// ── UI Atoms ───────────────────────────────────────────────────────────────
export function Spin() {
  return <span style={{display:"inline-block",width:11,height:11,border:"2px solid #ffffff30",borderTopColor:"#fff",borderRadius:"50%",animation:"sp 0.7s linear infinite",flexShrink:0}}/>;
}
export function Pill({label,color}) {
  return <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",padding:"3px 9px",borderRadius:99,background:(color||T.ink3)+"1a",color:color||T.ink3,whiteSpace:"nowrap",border:`1px solid ${(color||T.ink3)}22`}}>{label}</span>;
}
export function Card({children,selected,accent,onClick,style={}}) {
  return <div onClick={onClick} className={onClick?"card-click":""} style={{background:T.white,border:`1px solid ${selected?accent||T.green:T.bg3}`,borderRadius:14,padding:"16px 20px",cursor:onClick?"pointer":"default",...style}}>{children}</div>;
}
export function SectionLabel({children}) {
  return <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3,marginBottom:12}}>{children}</div>;
}
export function AIBtn({onClick,loading,label="✦ AI Assist",small}) {
  return <button onClick={onClick} disabled={loading} style={{background:loading?"#1a2235":"linear-gradient(135deg,#1a6b4a,#2563eb)",border:"none",borderRadius:small?8:10,padding:small?"6px 12px":"9px 16px",color:"#fff",fontSize:small?12:13,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:loading?0.65:1,whiteSpace:"nowrap",boxShadow:loading?"none":"0 1px 8px #1a6b4a33"}}>
    {loading?<><Spin/>Thinking…</>:label}
  </button>;
}
export function AIPanel({text,onClose}) {
  if(!text) return null;
  return <div className="fade-in" style={{background:"linear-gradient(135deg,#130c2e,#0d1117)",border:"1px solid #1a6b4a30",borderRadius:14,padding:"18px 20px",position:"relative",marginTop:12}}>
    <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:"#1a6b4a",marginBottom:10,display:"flex",alignItems:"center",gap:6}}><span>✦</span> AI Intelligence</div>
    <div style={{fontSize:13,color:"#e2e8f0",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{text}</div>
    {onClose&&<button onClick={onClose} style={{position:"absolute",top:12,right:14,background:"#1a2235",border:"1px solid #1f2937",borderRadius:6,color:"#6b7280",cursor:"pointer",fontSize:14,lineHeight:1,width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>×</button>}
  </div>;
}
export function MetricCard({label,value,sub,color,trend}) {
  return <div className="fade-in" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 20px",display:"flex",flexDirection:"column",gap:5,borderLeft:`3px solid ${color||T.bg3}`}}>
    <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3}}>{label}</span>
    <span style={{fontSize:28,fontWeight:800,color:color||T.ink,fontFamily:"'DM Serif Display',serif",lineHeight:1.05,letterSpacing:"-0.02em"}}>{value}</span>
    {sub&&<span style={{fontSize:11,color:T.ink3}}>{sub}</span>}
    {trend!==undefined&&<span style={{fontSize:11,color:trend>=0?"#1a6b4a":"#ef4444",fontWeight:600}}>{trend>=0?"↑":"↓"} {Math.abs(trend)}%</span>}
  </div>;
}
export function EmptyState({icon,title,message,action,onAction}) {
  return <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"52px 24px",gap:12,textAlign:"center"}}>
    <div style={{fontSize:36,marginBottom:4,opacity:0.3,color:T.ink}}>{icon||"◇"}</div>
    <div style={{fontSize:15,fontWeight:700,color:T.ink3}}>{title}</div>
    {message&&<div style={{fontSize:13,color:T.ink3,maxWidth:320,lineHeight:1.6}}>{message}</div>}
    {action&&<button onClick={onAction} style={{marginTop:8,background:T.green,border:"none",borderRadius:10,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>{action}</button>}
  </div>;
}
export function PageTitle({main,accent}) {
  return (
    <div style={{marginBottom:12}}>
      <h1 style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:"clamp(22px,2.4vw,32px)",fontWeight:400,color:T.ink,letterSpacing:"-0.02em",margin:0,lineHeight:1.2}}>
        {main}{" "}<span style={{borderBottom:`3px solid ${T.greenDk}`,paddingBottom:2}}>{accent}</span>
      </h1>
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
  const typeColor={call:"#3b82f6",email:"#8b5cf6",meeting:"#1a6b4a",gift:"#f59e0b",event:"#ec4899",note:"#6b7280"};
  const sorted=[...interactions].sort((a,b)=>new Date(b.date)-new Date(a.date));
  return(
    <div style={{display:"flex",flexDirection:"column",gap:0}}>
      {sorted.map((int,i)=>{
        const c=typeColor[int.type]||"#6b7280";
        const dAgo=daysDiff(int.date);
        const when=dAgo===0?"Today":dAgo===1?"Yesterday":`${dAgo}d ago`;
        return(
          <div key={i} style={{display:"flex",gap:12,paddingBottom:16,position:"relative"}}>
            {i<sorted.length-1&&<div style={{position:"absolute",left:11,top:24,width:2,bottom:0,background:T.bg3}}/>}
            <div style={{width:24,height:24,borderRadius:"50%",background:c+"22",border:`2px solid ${c}`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1,marginTop:2}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:c}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
                <span style={{fontSize:11,fontWeight:700,textTransform:"capitalize",color:c}}>{int.type}</span>
                <span style={{fontSize:11,color:T.ink3}}>{int.date}</span>
                <span style={{fontSize:11,color:T.bg3}}>({when})</span>
              </div>
              <div style={{fontSize:13,color:T.ink2,lineHeight:1.5}}>{int.note}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
