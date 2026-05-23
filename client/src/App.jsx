import { useState, useEffect, useRef } from "react";
import { apiFetch, streamAI, adaptData } from "./api";
import { useAuth } from "./main";
import Landing from "./pages/Landing";

// Design tokens — cream/green system
const T = {
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
const fmt = n => n>=1000?`$${(n/1000).toFixed(n%1000===0?0:1)}k`:`$${n.toLocaleString()}`;
const fmtFull = n => `$${n.toLocaleString()}`;
const daysDiff = d => Math.floor((new Date()-new Date(d))/86400000);
const daysUntil = d => Math.floor((new Date(d)-new Date())/86400000);
const SC = { major:"#10b981",mid:"#3b82f6",new:"#8b5cf6",lapsed:"#f59e0b",converted:"#10b981",active:"#10b981",pending:"#3b82f6",prospecting:"#8b5cf6",closed:"#6b7280",high:"#ef4444",medium:"#f59e0b",low:"#6b7280" };

const askClaude = (system, user, onChunk) => streamAI(system, user, onChunk);

// ── Org Context Builder ────────────────────────────────────────────────────
function buildContext(data) {
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

// ── Global styles ──────────────────────────────────────────────────────────
function GlobalStyles() {
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
    .card-click:hover{border-color:#10b981!important;transform:translateY(-1px);}
    .card-click{transition:border-color 0.15s,transform 0.15s;}
    .dash-row:hover{background:#f7f4ef!important;}
    .dash-action:hover{background:#f0fdf4!important;border-color:#10b981!important;}
  `}</style>;
}

// ── UI Atoms ───────────────────────────────────────────────────────────────
function Pill({label,color}) {
  return <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",padding:"3px 9px",borderRadius:99,background:(color||T.ink3)+"1a",color:color||T.ink3,whiteSpace:"nowrap",border:`1px solid ${(color||T.ink3)}22`}}>{label}</span>;
}
function Card({children,selected,accent,onClick,style={}}) {
  return <div onClick={onClick} className={onClick?"card-click":""} style={{background:T.white,border:`1px solid ${selected?accent||T.green:T.bg3}`,borderRadius:14,padding:"16px 20px",cursor:onClick?"pointer":"default",...style}}>{children}</div>;
}
function SectionLabel({children}) {
  return <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3,marginBottom:12}}>{children}</div>;
}
function AIBtn({onClick,loading,label="✦ AI Assist",small}) {
  return <button onClick={onClick} disabled={loading} style={{background:loading?"#1a2235":"linear-gradient(135deg,#1a6b4a,#2563eb)",border:"none",borderRadius:small?8:10,padding:small?"6px 12px":"9px 16px",color:"#fff",fontSize:small?12:13,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:loading?0.65:1,whiteSpace:"nowrap",boxShadow:loading?"none":"0 1px 8px #1a6b4a33"}}>
    {loading?<><Spin/>Thinking…</>:label}
  </button>;
}
function Spin() {
  return <span style={{display:"inline-block",width:11,height:11,border:"2px solid #ffffff30",borderTopColor:"#fff",borderRadius:"50%",animation:"sp 0.7s linear infinite",flexShrink:0}}/>;
}
function AIPanel({text,onClose}) {
  if(!text) return null;
  return <div className="fade-in" style={{background:"linear-gradient(135deg,#130c2e,#0d1117)",border:"1px solid #1a6b4a30",borderRadius:14,padding:"18px 20px",position:"relative",marginTop:12}}>
    <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:"#10b981",marginBottom:10,display:"flex",alignItems:"center",gap:6}}><span>✦</span> AI Intelligence</div>
    <div style={{fontSize:13,color:"#e2e8f0",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{text}</div>
    {onClose&&<button onClick={onClose} style={{position:"absolute",top:12,right:14,background:"#1a2235",border:"1px solid #1f2937",borderRadius:6,color:"#6b7280",cursor:"pointer",fontSize:14,lineHeight:1,width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>×</button>}
  </div>;
}
function MetricCard({label,value,sub,color,trend}) {
  return <div className="fade-in" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 20px",display:"flex",flexDirection:"column",gap:5,borderLeft:`3px solid ${color||T.bg3}`}}>
    <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3}}>{label}</span>
    <span style={{fontSize:28,fontWeight:800,color:color||T.ink,fontFamily:"'DM Serif Display',serif",lineHeight:1.05,letterSpacing:"-0.02em"}}>{value}</span>
    {sub&&<span style={{fontSize:11,color:T.ink3}}>{sub}</span>}
    {trend!==undefined&&<span style={{fontSize:11,color:trend>=0?"#10b981":"#ef4444",fontWeight:600}}>{trend>=0?"↑":"↓"} {Math.abs(trend)}%</span>}
  </div>;
}
function EmptyState({icon,title,message,action,onAction}) {
  return <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"52px 24px",gap:12,textAlign:"center"}}>
    <div style={{fontSize:36,marginBottom:4,opacity:0.3,color:T.ink}}>{icon||"◇"}</div>
    <div style={{fontSize:15,fontWeight:700,color:T.ink3}}>{title}</div>
    {message&&<div style={{fontSize:13,color:T.ink3,maxWidth:320,lineHeight:1.6}}>{message}</div>}
    {action&&<button onClick={onAction} style={{marginTop:8,background:T.green,border:"none",borderRadius:10,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>{action}</button>}
  </div>;
}

function PageTitle({main,accent}) {
  return (
    <div style={{marginBottom:12}}>
      <h1 style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:"clamp(22px,2.4vw,32px)",fontWeight:400,color:T.ink,letterSpacing:"-0.02em",margin:0,lineHeight:1.2}}>
        {main}{" "}<span style={{borderBottom:`3px solid ${T.green}`,paddingBottom:2}}>{accent}</span>
      </h1>
    </div>
  );
}

// ── Score ──────────────────────────────────────────────────────────────────
function donorScore(d) {
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

function retentionRisk(d) {
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
  const actions = {
    high: "Call this week — personal touch required",
    medium: "Send a targeted update in next 2 weeks",
    low: "Keep on regular cadence",
  };
  return { risk, level, reason: reasons.join(", ") || "steady engagement", action: actions[level] };
}

// ── Giving History Chart ──────────────────────────────────────────────────
function GivingHistoryChart({gifts}) {
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
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.22"/>
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.01"/>
        </linearGradient>
      </defs>
      {area&&<path d={area} fill="url(#giftGrad)"/>}
      {sorted.length>1&&<polyline points={pts} stroke="#10b981" strokeWidth="2" fill="none" strokeLinejoin="round"/>}
      {sorted.map((g,i)=>(
        <g key={i}>
          <circle cx={xs[i]} cy={ys[i]} r={4} fill="#10b981" stroke={T.white} strokeWidth={1.5}/>
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

// ── Global Chat ────────────────────────────────────────────────────────────
function AIChat({data,onClose}) {
  const [msgs,setMsgs]=useState([{role:"assistant",content:`Hi! I'm your development intelligence assistant for ${data.org.name}. I have full context on your donors, grants, financials, board, and tasks.\n\nTry asking:\n• "Who should I call this week?"\n• "How's our grant pipeline?"\n• "Draft a script for my Margaret Chen call"\n• "What's our biggest financial risk right now?"\n• "Which volunteers should we convert to donors?"`}]);
  const [input,setInput]=useState(""); const [loading,setLoading]=useState(false); const bottomRef=useRef(null);
  const QUICK = ["Who should I call today?","Biggest risks this month?","Draft board update email","Upgrade path for William Park","Which grants need attention?"];

  const send = async (text) => {
    const msg = text||input; if(!msg.trim()||loading) return;
    setInput("");
    const history = [...msgs,{role:"user",content:msg}];
    setMsgs([...history,{role:"assistant",content:""}]);
    setLoading(true);
    const sys = `You are an expert nonprofit development strategist and AI assistant for ${data.org.name}. You have deep expertise in major gifts, grant writing, volunteer management, and nonprofit finance. Be specific, strategic, and reference actual names/numbers from the org data. Never be generic.\n\n${buildContext(data)}`;
    const apiMsgs = history.filter(m=>m.content).map(m=>({role:m.role,content:m.content}));
    try {
      await askClaude(sys, apiMsgs.map(m=>`${m.role==="user"?"User":"Assistant"}: ${m.content}`).join("\n\n"), chunk=>{
        setMsgs(prev=>prev.map((m,i)=>i===prev.length-1?{...m,content:chunk}:m));
      });
    } catch { setMsgs(prev=>prev.map((m,i)=>i===prev.length-1?{...m,content:"Connection error. Try again."}:m)); }
    setLoading(false);
  };

  return <div style={{position:"fixed",inset:0,background:"#000c",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"flex-end",padding:20}}>
    <div style={{background:"#0a0f1e",border:"1px solid #10b98144",borderRadius:20,width:"100%",maxWidth:540,height:640,display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 25px 80px #10b98122"}}>
      <div style={{padding:"14px 18px",borderBottom:"1px solid #1f2937",display:"flex",alignItems:"center",justifyContent:"space-between",background:"linear-gradient(135deg,#1a0f3c,#0f172a)"}}>
        <div><div style={{fontSize:14,fontWeight:800,color:"#f3f4f6"}}>✦ Development Intelligence</div><div style={{fontSize:11,color:"#10b981"}}>Knows your full org in real time</div></div>
        <button onClick={onClose} style={{background:"#1f2937",border:"none",borderRadius:8,padding:"6px 12px",color:"#9ca3af",cursor:"pointer",fontSize:12}}>Close</button>
      </div>
      <div style={{display:"flex",gap:6,padding:"10px 14px",borderBottom:"1px solid #1f2937",overflowX:"auto",flexShrink:0}}>
        {QUICK.map(q=><button key={q} onClick={()=>send(q)} style={{background:"#1f2937",border:"1px solid #374151",borderRadius:20,padding:"5px 12px",color:"#9ca3af",fontSize:11,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{q}</button>)}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:14,display:"flex",flexDirection:"column",gap:10}}>
        {msgs.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
          <div style={{maxWidth:"88%",background:m.role==="user"?"#10b981":"#1e293b",borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",padding:"10px 14px",fontSize:13,color:"#f3f4f6",lineHeight:1.65,whiteSpace:"pre-wrap"}}>
            {m.content||(loading&&i===msgs.length-1?<span style={{color:"#10b981"}}>▋</span>:"")}
          </div>
        </div>)}
        <div ref={bottomRef}/>
      </div>
      <div style={{padding:12,borderTop:"1px solid #1f2937",display:"flex",gap:8}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ask anything about your org…" style={{flex:1,background:"#1e293b",border:"1px solid #374151",borderRadius:10,padding:"10px 14px",color:"#f3f4f6",fontSize:13,outline:"none"}}/>
        <button onClick={()=>send()} disabled={loading||!input.trim()} style={{background:"#10b981",border:"none",borderRadius:10,padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:loading||!input.trim()?0.5:1}}>↑</button>
      </div>
    </div>
  </div>;
}

// ── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({data,setData,onNavigate}) {
  const todayStr=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
  const currentYear=new Date().getFullYear();

  // AI briefing
  const [briefing,setBriefing]=useState("");
  const [briefLoading,setBriefLoading]=useState(false);
  const [briefOpen,setBriefOpen]=useState(false);
  // Quick-add donor
  const [showAddDonor,setShowAddDonor]=useState(false);
  const [newDonor,setNewDonor]=useState({name:"",email:"",phone:"",stage:"prospect"});

  // ── Stats
  const totalDonors=data.donors.length;
  const newDonorsThisYear=data.donors.filter(d=>d.lastGift&&new Date(d.lastGift).getFullYear()===currentYear).length;
  const activeGrantCount=data.grants.filter(g=>g.status==="active").length;
  const pipelineValue=data.grants.filter(g=>["active","pending","prospecting"].includes(g.status)).reduce((s,g)=>s+g.amount,0);
  const activeVolunteers=data.volunteers.filter(v=>v.lastActive&&daysDiff(v.lastActive)<=30).length;
  const openTasks=data.tasks.filter(t=>!t.done).length;
  const highPriorityTasks=data.tasks.filter(t=>!t.done&&t.priority==="high").length;
  const lapsedDonors=data.donors.filter(d=>d.stage==="lapsed");
  const lapsedValue=lapsedDonors.reduce((s,d)=>s+d.total,0);

  // ── Pipeline snapshot
  const stageSnap=STAGES.map(s=>({
    ...s,
    count:data.donors.filter(d=>(d.stage||"cultivate")===s.id).length,
    total:data.donors.filter(d=>(d.stage||"cultivate")===s.id).reduce((sum,d)=>sum+d.total,0),
  }));

  // ── Upcoming grant deadlines
  const upcomingGrants=[...data.grants]
    .filter(g=>g.status!=="closed"&&daysUntil(g.deadline)>=-7)
    .sort((a,b)=>new Date(a.deadline)-new Date(b.deadline))
    .slice(0,3);

  // ── Recent giving (last 5 donors sorted by lastGift)
  const recentGifts=[...data.donors]
    .filter(d=>d.lastGift&&d.lastAmount>0)
    .sort((a,b)=>new Date(b.lastGift)-new Date(a.lastGift))
    .slice(0,5);

  // ── Activity feed (flatten all donor interactions)
  const activityFeed=data.donors
    .flatMap(d=>(d.interactions||[]).map(i=>({...i,donorName:d.name,donorId:d.id})))
    .sort((a,b)=>new Date(b.date)-new Date(a.date))
    .slice(0,10);

  // ── Tasks this week
  const todayIso=new Date().toISOString().split("T")[0];
  const weekEndIso=new Date(Date.now()+7*86400000).toISOString().split("T")[0];
  const todayTasks=data.tasks.filter(t=>!t.done&&t.due===todayIso).sort((a,b)=>({high:0,medium:1,low:2}[a.priority]-{high:0,medium:1,low:2}[b.priority]));
  const weekTasks=data.tasks.filter(t=>!t.done&&t.due>todayIso&&t.due<=weekEndIso).sort((a,b)=>new Date(a.due)-new Date(b.due));

  // ── Generate briefing
  const generateBriefing=async()=>{
    setBriefLoading(true);setBriefing("");setBriefOpen(true);
    await askClaude(
      `You are a chief development officer. Write a crisp daily briefing. Use bullet points. Be specific with names and numbers. Max 250 words.`,
      `Generate today's development briefing for ${data.org.name}.\nToday: ${todayStr}\n\n${buildContext(data)}\n\nFormat:\n**TODAY'S PRIORITY CALLS** (top 2-3 donors to contact with specific reason)\n**GRANT ALERTS** (anything urgent in next 30 days)\n**FINANCIAL PULSE** (1-2 sentences on cash/revenue)\n**ONE THING** (the single most important action today)\n\nBe sharp and specific.`,
      chunk=>setBriefing(chunk)
    );
    setBriefLoading(false);
  };

  // ── Quick-add donor
  const addDonorQuick=async()=>{
    if(!newDonor.name.trim())return;
    try{
      await apiFetch("/donors",{method:"POST",body:JSON.stringify({...newDonor})});
      const donors=await apiFetch("/donors");
      setData(prev=>({...prev,donors:donors.map(d=>{
        const ints=(d.interactions||[]).map(i=>({date:i.date||i.created_at?.split("T")[0],type:i.type,note:i.note||""}));
        const lastTouchpoint=ints.length>0?ints.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0].date:null;
        return{id:d.id,name:d.name,email:d.email||"",phone:d.phone||"",total:d.total_giving||0,
          lastGift:d.last_gift_date||"",lastAmount:d.last_gift_amount||0,gifts:d.gift_count||0,
          status:d.status,stage:d.stage||"cultivate",lastTouchpoint,
          tags:Array.isArray(d.tags)?d.tags:JSON.parse(d.tags||"[]"),notes:d.notes||"",interactions:ints};
      })}));
    }catch(e){console.error(e);}
    setShowAddDonor(false);setNewDonor({name:"",email:"",phone:"",stage:"prospect"});
    onNavigate("donors");
  };

  // ── Task toggle (local — same as Tasks tab)
  const toggleTask=id=>setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===id?{...t,done:!t.done}:t)}));

  // ── Pull quote: first non-header bullet from briefing
  const bLines=briefing.split("\n").filter(l=>l.trim()&&!l.startsWith("**")&&l.trim().length>15);
  const pullQuote=bLines.length?bLines[0].replace(/^[•\-\*\s]+/,"").slice(0,160):"";
  const briefRest=pullQuote?briefing.slice(briefing.indexOf(pullQuote)+pullQuote.length).trim():"";

  const sHdr={display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:0};
  const sTitle={fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3};
  const sLink={background:"transparent",border:"none",padding:0,color:T.green,fontSize:12,fontWeight:700,cursor:"pointer"};
  const cardWrap={background:T.white,border:"1px solid "+T.bg3,borderRadius:14,overflow:"hidden"};
  const cPad={padding:"14px 20px"};
  const typeColor={call:"#3b82f6",email:"#8b5cf6",meeting:"#10b981",gift:"#f59e0b",event:"#ec4899",note:"#6b7280"};

  const QUICK=[
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><circle cx="10" cy="7" r="3.5"/><path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" strokeLinecap="round"/><line x1="14" y1="4" x2="18" y2="4" strokeLinecap="round"/><line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round"/></svg>,label:"Add Donor",action:()=>setShowAddDonor(true)},
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><rect x="3" y="5" width="14" height="11" rx="2"/><path d="M7 5V4a1 1 0 011-1h4a1 1 0 011 1v1" strokeLinecap="round"/><line x1="7" y1="10" x2="13" y2="10" strokeLinecap="round"/><line x1="10" y1="7.5" x2="10" y2="12.5" strokeLinecap="round"/></svg>,label:"Log Gift",action:()=>onNavigate("donors")},
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><path d="M10 3l1.8 5.4H17l-4.5 3.3 1.7 5.3L10 14l-4.2 3 1.7-5.3L3 8.4h5.2z" strokeLinejoin="round"/></svg>,label:"New Grant",action:()=>onNavigate("grants")},
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><circle cx="10" cy="7" r="3.5"/><path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" strokeLinecap="round"/></svg>,label:"Add Volunteer",action:()=>onNavigate("volunteers")},
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><rect x="3" y="3" width="14" height="14" rx="2"/><line x1="7" y1="9" x2="13" y2="9" strokeLinecap="round"/><line x1="7" y1="12" x2="11" y2="12" strokeLinecap="round"/><line x1="10" y1="5.5" x2="10" y2="3" strokeLinecap="round"/></svg>,label:"New Task",action:()=>onNavigate("tasks")},
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><rect x="2" y="5" width="16" height="11" rx="2"/><path d="M2 8l8 5 8-5" strokeLinecap="round"/></svg>,label:"Send Email",action:()=>onNavigate("communications")},
  ];

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}} className="fade-in">

      {/* ── Hero stat strip ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        {[
          {label:"Total Donors",value:totalDonors,sub:`${newDonorsThisYear} gave this year`,tab:"donors"},
          {label:"Active Grants",value:activeGrantCount,sub:fmt(pipelineValue)+" pipeline",tab:"grants"},
          {label:"Active Volunteers",value:activeVolunteers,sub:"in last 30 days",tab:"volunteers"},
          {label:"Open Tasks",value:openTasks,sub:highPriorityTasks>0?`${highPriorityTasks} high priority`:"all on track",tab:"tasks"},
        ].map(s=>(
          <div key={s.label} onClick={()=>onNavigate(s.tab)} className="card-click" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 20px",cursor:"pointer",borderLeft:"3px solid #10b981"}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3,marginBottom:4}}>{s.label}</div>
            <div style={{fontSize:28,fontWeight:800,color:"#10b981",fontFamily:"'DM Serif Display',serif",lineHeight:1.05,letterSpacing:"-0.02em"}}>{s.value}</div>
            <div style={{fontSize:11,color:T.ink3,marginTop:4}}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Two-column body ── */}
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 320px",gap:16,alignItems:"start"}}>

        {/* LEFT COLUMN */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>

          {/* AI Briefing — morning memo */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{background:"#10b981",color:"#fff",fontSize:9,fontWeight:800,padding:"3px 8px",borderRadius:99,letterSpacing:"0.1em",textTransform:"uppercase"}}>AI</span>
                <span style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600}}>{todayStr}</span>
              </div>
              {!briefing&&!briefLoading&&<AIBtn onClick={generateBriefing} label="✦ Generate briefing" small/>}
              {briefLoading&&<div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.ink3}}><Spin/>Thinking…</div>}
            </div>
            <div style={{padding:"18px 24px"}}>
              {!briefing&&!briefLoading&&(
                <div style={{fontSize:13,color:T.ink3,fontStyle:"italic",lineHeight:1.7}}>
                  Get your personalized daily development briefing — who to call, what's urgent, one priority action.
                </div>
              )}
              {briefLoading&&!briefing&&(
                <div style={{fontSize:13,color:T.ink3,fontStyle:"italic"}}>Reading your org context…</div>
              )}
              {(briefing||briefLoading)&&pullQuote&&(
                <>
                  <blockquote style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:17,fontStyle:"italic",color:T.ink,lineHeight:1.55,margin:"0 0 14px 0",paddingLeft:16,borderLeft:"3px solid #10b981"}}>
                    "{pullQuote}"
                  </blockquote>
                  {briefOpen&&briefRest&&(
                    <div style={{fontSize:13,color:T.ink2,lineHeight:1.85,whiteSpace:"pre-wrap",marginBottom:14}}>
                      {briefRest}
                    </div>
                  )}
                  {briefRest&&<button onClick={()=>setBriefOpen(!briefOpen)} style={{background:"transparent",border:"none",padding:0,color:T.green,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                    {briefOpen?"▲ Collapse":"▼ Read full briefing"}
                  </button>}
                </>
              )}
            </div>
          </div>

          {/* Donor pipeline snapshot */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={sTitle}>Donor Pipeline</span>
              <button onClick={()=>onNavigate("donors")} style={sLink}>View all →</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)"}}>
              {stageSnap.map((s,i)=>(
                <div key={s.id} onClick={()=>onNavigate("donors")} className="dash-row" style={{
                  padding:"14px 12px",borderRight:i<5?"1px solid "+T.bg3:"none",
                  cursor:"pointer",borderTop:`3px solid ${s.color}`,
                }}>
                  <div style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:s.color,marginBottom:6}}>{s.label}</div>
                  <div style={{fontSize:20,fontWeight:800,color:s.count>0?T.ink:T.ink3,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{s.count}</div>
                  <div style={{fontSize:11,color:T.ink3,marginTop:3}}>{s.total>0?fmt(s.total):"—"}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Lapsed alert */}
          {lapsedDonors.length>0&&(
            <div style={{background:"#fff8f0",border:"1px solid #f59e0b40",borderRadius:14,padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:"#ef4444",flexShrink:0,boxShadow:"0 0 6px #ef444460"}}/>
                  <span style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#dc2626"}}>Lapsed Donors</span>
                </div>
                <div style={{fontSize:26,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink,lineHeight:1}}>{lapsedDonors.length}</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:4}}>{fmtFull(lapsedValue)} lifetime value at risk</div>
              </div>
              <button onClick={()=>onNavigate("donors")} style={{background:"#ef4444",border:"none",borderRadius:10,padding:"10px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                Re-engage →
              </button>
            </div>
          )}

          {/* Upcoming grant deadlines */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={sTitle}>Grant Deadlines</span>
              <button onClick={()=>onNavigate("grants")} style={sLink}>All grants →</button>
            </div>
            {upcomingGrants.length===0&&<div style={{...cPad,fontSize:13,color:T.ink3,fontStyle:"italic"}}>No upcoming deadlines</div>}
            {upcomingGrants.map((g,i)=>{
              const d=daysUntil(g.deadline);
              const urgColor=d<14?"#ef4444":d<30?"#f59e0b":"#10b981";
              return(
                <div key={g.id} className="dash-row" onClick={()=>onNavigate("grants")} style={{
                  display:"flex",alignItems:"center",gap:12,padding:"12px 20px",
                  borderBottom:i<upcomingGrants.length-1?"1px solid "+T.bg3:"none",cursor:"pointer",
                }}>
                  <div style={{background:urgColor+"15",border:"1px solid "+urgColor+"30",borderRadius:8,padding:"6px 10px",minWidth:46,textAlign:"center",flexShrink:0}}>
                    <div style={{fontSize:12,fontWeight:800,color:urgColor,lineHeight:1}}>{d<0?"past":d+"d"}</div>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.funder}</div>
                    <div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.program}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{fmt(g.amount)}</div>
                    <div style={{marginTop:4}}><Pill label={g.status} color={SC[g.status]}/></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recent giving */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={sTitle}>Recent Giving</span>
              <button onClick={()=>onNavigate("donors")} style={sLink}>All donors →</button>
            </div>
            {recentGifts.length===0&&<div style={{...cPad,fontSize:13,color:T.ink3,fontStyle:"italic"}}>No gift history yet</div>}
            {recentGifts.map((d,i)=>{
              const dAgo=daysDiff(d.lastGift);
              const when=dAgo===0?"Today":dAgo===1?"Yesterday":`${dAgo}d ago`;
              const sc=donorScore(d);const scColor=sc>70?"#10b981":sc>45?"#f59e0b":"#ef4444";
              return(
                <div key={d.id} className="dash-row" onClick={()=>onNavigate("donors")} style={{
                  display:"flex",alignItems:"center",gap:12,padding:"11px 20px",
                  borderBottom:i<recentGifts.length-1?"1px solid "+T.bg3:"none",cursor:"pointer",
                }}>
                  <div style={{width:34,height:34,borderRadius:"50%",background:scColor+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:scColor,flexShrink:0}}>{d.name[0]}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                    <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{when}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:14,fontWeight:800,color:"#10b981"}}>{fmtFull(d.lastAmount)}</div>
                    <div style={{fontSize:10,color:T.ink3,marginTop:2}}>{fmtFull(d.total)} lifetime</div>
                  </div>
                </div>
              );
            })}
          </div>

        </div>{/* end left column */}

        {/* RIGHT COLUMN */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>

          {/* Quick actions */}
          <div style={{...cardWrap,...cPad}}>
            <div style={sTitle}>Quick Actions</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:12}}>
              {QUICK.map(a=>(
                <button key={a.label} onClick={a.action} className="dash-action" style={{
                  background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,
                  padding:"12px 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:6,cursor:"pointer",
                }}>
                  <div style={{width:32,height:32,borderRadius:8,background:"#10b98118",display:"flex",alignItems:"center",justifyContent:"center",color:"#10b981"}}>
                    {a.icon}
                  </div>
                  <span style={{fontSize:10,fontWeight:700,color:T.ink3,textAlign:"center",lineHeight:1.3,letterSpacing:"0.02em"}}>{a.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tasks this week */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={sTitle}>Tasks This Week</span>
              <button onClick={()=>onNavigate("tasks")} style={sLink}>All →</button>
            </div>
            {todayTasks.length===0&&weekTasks.length===0&&(
              <div style={{...cPad,fontSize:13,color:T.ink3,fontStyle:"italic"}}>No tasks due today or this week</div>
            )}
            {todayTasks.length>0&&(
              <>
                <div style={{padding:"6px 20px 4px",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,background:T.bg,borderBottom:"1px solid "+T.bg3}}>Today</div>
                {todayTasks.map((t,i)=>(
                  <div key={t.id} className="dash-row" onClick={()=>toggleTask(t.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 20px",borderBottom:"1px solid "+T.bg3,cursor:"pointer"}}>
                    <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${SC[t.priority]}`,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:T.ink,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                    </div>
                    <Pill label={t.priority} color={SC[t.priority]}/>
                  </div>
                ))}
              </>
            )}
            {weekTasks.length>0&&(
              <>
                <div style={{padding:"6px 20px 4px",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,background:T.bg,borderBottom:"1px solid "+T.bg3}}>This week</div>
                {weekTasks.map((t,i)=>(
                  <div key={t.id} className="dash-row" onClick={()=>toggleTask(t.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 20px",borderBottom:i<weekTasks.length-1?"1px solid "+T.bg3:"none",cursor:"pointer"}}>
                    <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${SC[t.priority]}`,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:T.ink,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                      {t.due&&<div style={{fontSize:10,color:T.ink3,marginTop:2}}>{new Date(t.due).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</div>}
                    </div>
                    <Pill label={t.priority} color={SC[t.priority]}/>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Activity feed */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3}}>
              <span style={sTitle}>Recent Activity</span>
            </div>
            {activityFeed.length===0&&<div style={{...cPad,fontSize:13,color:T.ink3,fontStyle:"italic"}}>No activity logged yet</div>}
            {activityFeed.map((item,i)=>{
              const tc=typeColor[item.type]||"#6b7280";
              const dAgo=daysDiff(item.date);
              const when=dAgo===0?"Today":dAgo===1?"Yesterday":`${dAgo}d ago`;
              return(
                <div key={i} className="dash-row" onClick={()=>onNavigate("donors")} style={{
                  display:"flex",alignItems:"flex-start",gap:10,padding:"10px 20px",
                  borderBottom:i<activityFeed.length-1?"1px solid "+T.bg3:"none",cursor:"pointer",
                }}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:tc,marginTop:4,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,color:T.ink,lineHeight:1.4}}>
                      <span style={{fontWeight:600}}>{item.donorName}</span>
                      {" · "}<span style={{color:tc,fontWeight:600,textTransform:"capitalize"}}>{item.type}</span>
                    </div>
                    {item.note&&<div style={{fontSize:11,color:T.ink3,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.note}</div>}
                  </div>
                  <div style={{fontSize:10,color:T.ink3,flexShrink:0,marginTop:2,whiteSpace:"nowrap"}}>{when}</div>
                </div>
              );
            })}
          </div>

        </div>{/* end right column */}
      </div>{/* end two-column */}

      {/* Quick-add donor modal */}
      {showAddDonor&&(
        <div style={{position:"fixed",inset:0,background:"#000000cc",backdropFilter:"blur(4px)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div className="fade-in" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:420,padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
            <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:16}}>Add Donor</div>
            {[["name","Full Name"],["email","Email"],["phone","Phone"]].map(([k,pl])=>(
              <input key={k} value={newDonor[k]||""} onChange={e=>setNewDonor(p=>({...p,[k]:e.target.value}))} placeholder={pl}
                style={{width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",marginBottom:10}}/>
            ))}
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:16}}>
              {STAGES.map(s=>(
                <button key={s.id} onClick={()=>setNewDonor(p=>({...p,stage:s.id}))}
                  style={{background:newDonor.stage===s.id?s.color+"22":T.bg,border:`1px solid ${newDonor.stage===s.id?s.color:T.bg3}`,borderRadius:7,padding:"5px 11px",color:newDonor.stage===s.id?s.color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={addDonorQuick} disabled={!newDonor.name.trim()} style={{flex:1,background:newDonor.name.trim()?"#10b981":T.bg2,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:14,fontWeight:700,cursor:newDonor.name.trim()?"pointer":"not-allowed"}}>
                Save Donor
              </button>
              <button onClick={()=>setShowAddDonor(false)} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Moves Management ───────────────────────────────────────────────────────
const STAGES=[
  {id:"prospect",  label:"Prospect",  color:T.ink3, hint:"Identified, not yet engaged"},
  {id:"qualify",   label:"Qualify",   color:"#3b82f6", hint:"Researching fit & capacity"},
  {id:"cultivate", label:"Cultivate", color:"#8b5cf6", hint:"Building relationship"},
  {id:"solicit",   label:"Solicit",   color:"#f59e0b", hint:"Ready for the ask"},
  {id:"steward",   label:"Steward",   color:"#10b981", hint:"Deepen post-gift relationship"},
  {id:"lapsed",    label:"Lapsed",    color:"#ef4444", hint:"Needs re-engagement"},
];
const STAGE_THRESH={prospect:[60,120],qualify:[14,30],cultivate:[30,60],solicit:[7,14],steward:[30,90],lapsed:[90,180]};
const STAGE_ACTION={
  prospect:"Research capacity — find a warm intro",
  qualify: "Schedule a discovery call or coffee",
  cultivate:"Share an impact story or invite to a program visit",
  solicit: "Book a gift conversation and make the ask",
  steward: "Send personalized impact update or thank you",
  lapsed:  "Personal outreach — acknowledge lapse, invite back",
};
function moveUrgency(d){
  const lastContact=d.lastTouchpoint||d.lastGift;
  const days=lastContact?daysDiff(lastContact):999;
  const [warn,crit]=STAGE_THRESH[d.stage||"cultivate"]||[30,60];
  const level=days>crit?"critical":days>warn?"due":"ok";
  const urgencyColor={critical:"#ef4444",due:"#f59e0b",ok:"#10b981"}[level];
  // Text label color uses absolute thresholds: red >365d, amber 180-365d, muted gray otherwise
  const contactTextColor=days>365?"#ef4444":days>180?"#f59e0b":T.ink3;
  return{days,level,urgencyColor,contactTextColor};
}

function TpField({label,children}){
  return <div style={{display:"flex",flexDirection:"column",gap:4}}>
    <span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5,display:"block"}}>{label}</span>
    {children}
  </div>;
}
function TpYesNo({val,set}){
  return <div style={{display:"flex",gap:6}}>
    {["yes","no"].map(v=><button key={v} onClick={()=>set(v)} style={{background:val===v?"#10b981":T.bg,border:`1px solid ${val===v?"#10b981":T.bg3}`,borderRadius:7,padding:"7px 20px",color:val===v?"#fff":T.ink3,fontSize:13,fontWeight:600,cursor:"pointer"}}>{v}</button>)}
  </div>;
}

function LogTouchpointModal({donor,onSave,onClose,onToast}){
  const[type,setType]=useState("call");
  const[date,setDate]=useState(new Date().toISOString().split("T")[0]);
  const[loading,setLoading]=useState(false);
  // Shared
  const[kt1,setKt1]=useState("");const[kt2,setKt2]=useState("");const[kt3,setKt3]=useState("");
  const[history,setHistory]=useState("");const[spouse,setSpouse]=useState("");const[nextStep,setNextStep]=useState("");
  // Call
  const[answered,setAnswered]=useState("yes");const[duration,setDuration]=useState("");const[objections,setObjections]=useState("");
  // Meeting
  const[attendees,setAttendees]=useState("");const[location,setLocation]=useState("");
  const[sentiment,setSentiment]=useState("Positive");const[asksMade,setAsksMade]=useState("");
  // Email
  const[subject,setSubject]=useState("");const[summary,setSummary]=useState("");const[responded,setResponded]=useState("no");
  // Event
  const[eventName,setEventName]=useState("");const[attended,setAttended]=useState("yes");const[observations,setObservations]=useState("");
  // Gift
  const[amount,setAmount]=useState("");const[designation,setDesignation]=useState("");
  const[payMethod,setPayMethod]=useState("");const[ackSent,setAckSent]=useState("no");
  // Other
  const[otherNotes,setOtherNotes]=useState("");

  const TYPES=[["call","Call"],["meeting","Meeting"],["email","Email"],["event","Event"],["gift","Gift/Pledge"],["other","Other"]];

  const buildNote=()=>{
    const L=[];
    const add=(k,v)=>{if(v&&String(v).trim())L.push(`${k}: ${v.trim()}`);};
    if(type==="call"){
      L.push(`Answered: ${answered}`);
      add("Duration",duration);add("Key Takeaway 1",kt1);add("Key Takeaway 2",kt2);add("Key Takeaway 3",kt3);
      add("Objections / Concerns",objections);add("Donor History",history);add("Spouse / Partner",spouse);add("Next Step",nextStep);
    }else if(type==="meeting"){
      add("Attendees",attendees);add("Location",location);
      add("Key Takeaway 1",kt1);add("Key Takeaway 2",kt2);add("Key Takeaway 3",kt3);
      L.push(`Donor Sentiment: ${sentiment}`);
      add("Spouse / Partner",spouse);add("Donor History",history);add("Asks Made",asksMade);add("Next Step",nextStep);
    }else if(type==="email"){
      add("Subject",subject);add("Summary",summary);
      L.push(`Response Received: ${responded}`);
      add("Donor History",history);add("Next Step",nextStep);
    }else if(type==="event"){
      add("Event",eventName);L.push(`Donor Attended: ${attended}`);
      add("Observations",observations);add("Donor History",history);add("Next Step",nextStep);
    }else if(type==="gift"){
      add("Amount",amount);add("Designation",designation);
      add("Payment Method",payMethod);L.push(`Acknowledgement Sent: ${ackSent}`);add("Next Step",nextStep);
    }else{
      add("Notes",otherNotes);add("Donor History",history);add("Spouse / Partner",spouse);add("Next Step",nextStep);
    }
    return L.join("\n");
  };

  const save=async()=>{
    const note=buildNote();if(!note.trim())return;setLoading(true);
    try{
      const saveType=type==="gift"?"gift":type==="meeting"?"meeting":type;
      await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({type:saveType,note,date})});
      const giftAmt=type==="gift"?(parseFloat(String(amount).replace(/[$,]/g,""))||0):0;
      if(type==="gift"&&giftAmt>0){
        await apiFetch(`/donors/${donor.id}/gifts`,{method:"POST",body:JSON.stringify({amount:giftAmt,date,notes:note})});
      }
      const due7=new Date();due7.setDate(due7.getDate()+7);
      apiFetch("/tasks",{method:"POST",body:JSON.stringify({title:`Follow up: ${donor.name}`,due:due7.toISOString().split("T")[0],priority:"medium",type:"donor",donorId:donor.id})}).catch(()=>{});
      onToast?.("Follow-up task created.");
      onSave({type:saveType,note,date,amount:giftAmt});
    }catch(e){console.error(e);}
    setLoading(false);
  };

  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const ta={...inp,resize:"vertical",lineHeight:1.55};

  const canSave=buildNote().trim().length>0;

  return(
    <div style={{position:"fixed",inset:0,background:"#000000cc",backdropFilter:"blur(4px)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="fade-in" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:520,maxHeight:"92vh",overflowY:"auto",padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:2}}>Log Touchpoint</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:16}}>{donor.name}</div>

        {/* Activity type tabs */}
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:16}}>
          {TYPES.map(([v,l])=><button key={v} onClick={()=>setType(v)} style={{background:type===v?"#10b981":T.bg2,border:`1px solid ${type===v?"#10b981":T.bg3}`,borderRadius:7,padding:"5px 13px",color:type===v?"#fff":T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>{l}</button>)}
        </div>

        <div style={{marginBottom:16}}><span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5,display:"block"}}>Date</span><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inp}/></div>

        {/* Dynamic template */}
        <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:20}}>
          {type==="call"&&<>
            <TpField label="Answered?"><TpYesNo val={answered} set={setAnswered}/></TpField>
            <TpField label="Duration"><input value={duration} onChange={e=>setDuration(e.target.value)} placeholder="e.g. 20 min" style={inp}/></TpField>
            <TpField label="Key Takeaway 1"><textarea value={kt1} onChange={e=>setKt1(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 2"><textarea value={kt2} onChange={e=>setKt2(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 3"><textarea value={kt3} onChange={e=>setKt3(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Objections / Concerns"><textarea value={objections} onChange={e=>setObjections(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, giving context, background…" rows={3} style={ta}/></TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="meeting"&&<>
            <TpField label="Attendees"><input value={attendees} onChange={e=>setAttendees(e.target.value)} placeholder="Names of everyone present" style={inp}/></TpField>
            <TpField label="Location"><input value={location} onChange={e=>setLocation(e.target.value)} style={inp}/></TpField>
            <TpField label="Key Takeaway 1"><textarea value={kt1} onChange={e=>setKt1(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 2"><textarea value={kt2} onChange={e=>setKt2(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 3"><textarea value={kt3} onChange={e=>setKt3(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Donor Sentiment">
              <select value={sentiment} onChange={e=>setSentiment(e.target.value)} style={{...inp,cursor:"pointer"}}>
                {["Enthusiastic","Positive","Neutral","Hesitant"].map(s=><option key={s}>{s}</option>)}
              </select>
            </TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, context…" rows={3} style={ta}/></TpField>
            <TpField label="Asks Made"><textarea value={asksMade} onChange={e=>setAsksMade(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="email"&&<>
            <TpField label="Subject"><input value={subject} onChange={e=>setSubject(e.target.value)} style={inp}/></TpField>
            <TpField label="Summary"><textarea value={summary} onChange={e=>setSummary(e.target.value)} rows={4} style={ta}/></TpField>
            <TpField label="Response Received?"><TpYesNo val={responded} set={setResponded}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Context for this outreach…" rows={3} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="event"&&<>
            <TpField label="Event Name"><input value={eventName} onChange={e=>setEventName(e.target.value)} style={inp}/></TpField>
            <TpField label="Donor Attended?"><TpYesNo val={attended} set={setAttended}/></TpField>
            <TpField label="Interactions & Observations"><textarea value={observations} onChange={e=>setObservations(e.target.value)} rows={4} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} rows={3} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="gift"&&<>
            <TpField label="Amount"><input type="text" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="e.g. 5,000" style={inp}/></TpField>
            <TpField label="Designation"><input value={designation} onChange={e=>setDesignation(e.target.value)} placeholder="e.g. General Operating, Arts Education…" style={inp}/></TpField>
            <TpField label="Payment Method"><input value={payMethod} onChange={e=>setPayMethod(e.target.value)} placeholder="Check, ACH, Credit Card, Stock…" style={inp}/></TpField>
            <TpField label="Acknowledgement Sent?"><TpYesNo val={ackSent} set={setAckSent}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="other"&&<>
            <TpField label="Notes"><textarea value={otherNotes} onChange={e=>setOtherNotes(e.target.value)} rows={5} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, context…" rows={3} style={ta}/></TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
        </div>

        <div style={{display:"flex",gap:8}}>
          <button onClick={save} disabled={loading||!canSave} style={{flex:1,background:canSave?"#10b981":T.bg2,border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:14,fontWeight:700,cursor:canSave?"pointer":"not-allowed"}}>{loading?"Saving…":"Save Touchpoint"}</button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function EditDonorModal({donor,onSave,onClose}){
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const[form,setForm]=useState({
    name:donor.name||"",email:donor.email||"",phone:donor.phone||"",
    notes:donor.notes||"",tags:(donor.tags||[]).join(", "),
    stage:donor.stage||"cultivate",status:donor.status||"new",
  });
  const[loading,setLoading]=useState(false);
  const[err,setErr]=useState("");
  const set=k=>e=>setForm(p=>({...p,[k]:e.target.value}));

  const save=async()=>{
    if(!form.name.trim()){setErr("Name is required");return;}
    setLoading(true);setErr("");
    try{
      const tags=form.tags.split(",").map(t=>t.trim()).filter(Boolean);
      const res=await apiFetch(`/donors/${donor.id}`,{method:"PUT",body:JSON.stringify({...form,tags})});
      onSave(res);
    }catch(e){setErr(e.message||"Failed to save");}
    setLoading(false);
  };

  return(
    <div style={{position:"fixed",inset:0,background:"#000c",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"#ffffff",border:"1px solid "+T.bg3,borderRadius:20,width:"100%",maxWidth:480,padding:28,boxSizing:"border-box"}}>
        <div style={{fontSize:18,fontWeight:800,color:T.ink,marginBottom:4}}>Edit Donor Profile</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:20}}>{donor.name}</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[["name","Full Name","text"],["email","Email","email"],["phone","Phone","tel"]].map(([k,pl,t])=>(
            <input key={k} type={t} value={form[k]} onChange={set(k)} placeholder={pl} style={inp}/>
          ))}
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {STAGES.map(s=>(
                <button key={s.id} onClick={()=>setForm(p=>({...p,stage:s.id}))}
                  style={{background:form.stage===s.id?s.color+"22":T.bg,border:`1px solid ${form.stage===s.id?s.color:T.bg3}`,borderRadius:7,padding:"5px 11px",color:form.stage===s.id?s.color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Tags <span style={{fontSize:10,fontWeight:400,textTransform:"none"}}>(comma-separated)</span></div>
            <input value={form.tags} onChange={set("tags")} placeholder="e.g. board-adjacent, recurring, arts" style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Notes</div>
            <textarea value={form.notes} onChange={set("notes")} rows={3} style={{...inp,resize:"vertical",lineHeight:1.5}}/>
          </div>
          {err&&<div style={{color:"#f87171",fontSize:12}}>{err}</div>}
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={save} disabled={loading} style={{flex:1,background:loading?T.bg2:"#10b981",border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>
              {loading?"Saving…":"Save Changes"}
            </button>
            <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TouchpointTimeline({interactions}){
  if(!interactions?.length)return<div style={{fontSize:13,color:T.ink3,textAlign:"center",padding:"16px 0"}}>No touchpoints logged yet.</div>;
  const typeColor={call:"#3b82f6",email:"#8b5cf6",meeting:"#10b981",gift:"#f59e0b",event:"#ec4899",note:"#6b7280"};
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

function DonorProfile({donor,onClose,onStageChange,onLogTouchpoint,aiMap,loadingKey,getAI,isAdmin,onEdit,onDelete}){
  const [gifts,setGifts]=useState([]);
  const [giftLoading,setGiftLoading]=useState(true);
  const stage=STAGES.find(s=>s.id===(donor.stage||"cultivate"))||STAGES[2];
  const sc=donorScore(donor);const scoreColor=sc>70?"#10b981":sc>45?"#f59e0b":"#ef4444";
  const urg=moveUrgency(donor);

  // Re-fetch gifts whenever a new interaction is logged (catches gift type interactions)
  const interactionCount=donor.interactions?.length||0;
  useEffect(()=>{
    setGiftLoading(true);
    apiFetch(`/donors/${donor.id}`).then(raw=>{
      setGifts((raw.gifts||[]).map(g=>({amount:g.amount||0,date:g.date||g.created_at?.split("T")[0]})));
    }).catch(()=>{}).finally(()=>setGiftLoading(false));
  },[donor.id,interactionCount]);

  useEffect(()=>{
    if(!aiMap[`${donor.id}_nextmove`])getAI(donor,"nextmove");
  },[donor.id]);

  // Derive last gift from actual gift records; falls back to donor.lastAmount only if no records
  const sortedGifts=[...gifts].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const lastGiftDisplay=giftLoading?"…":sortedGifts.length>0?fmtFull(sortedGifts[0].amount):fmtFull(donor.lastAmount);

  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:T.bg,zIndex:200,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Top bar */}
      <div style={{background:T.white,borderBottom:"1px solid "+T.bg3,padding:"10px 24px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onClose} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>← Back</button>
        <div style={{width:34,height:34,borderRadius:"50%",background:stage.color+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:stage.color,flexShrink:0}}>{donor.name[0]}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:16,fontWeight:800,color:T.ink,letterSpacing:"-0.01em"}}>{donor.name}</span>
            <span style={{fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:99,background:stage.color+"22",color:stage.color}}>{stage.label}</span>
            <span style={{fontSize:11,color:T.ink3}}>{donor.email}</span>
          </div>
          <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{fmtFull(donor.total)} lifetime · {donor.gifts} gifts</div>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0}}>
          <button onClick={onEdit} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Edit</button>
          {isAdmin&&<button onClick={()=>onDelete(donor.id)} style={{background:"transparent",border:"1px solid #ef444455",borderRadius:8,padding:"7px 14px",color:"#ef4444",fontSize:13,cursor:"pointer"}}>Delete</button>}
        </div>
      </div>

      {/* Two-panel body */}
      <div style={{flex:1,display:"grid",gridTemplateColumns:"minmax(0,1.25fr) minmax(0,0.75fr)",overflow:"hidden"}}>

        {/* LEFT — stats + chart + timeline */}
        <div style={{overflowY:"auto",padding:"22px 20px 24px 24px",borderRight:"1px solid "+T.bg3,display:"flex",flexDirection:"column",gap:18}}>

          {/* Stats row */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            {[["Lifetime",fmtFull(donor.total),T.ink],["Last Gift",lastGiftDisplay,"#10b981"],["Contact",`${urg.days}d ago`,urg.urgencyColor],["Score",`${sc}/99`,scoreColor]].map(([l,v,c])=>(
              <div key={l} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
                <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>{l}</div>
                <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:"'DM Serif Display',serif",lineHeight:1.1}}>{v}</div>
              </div>
            ))}
          </div>

          {/* Giving history chart */}
          <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 18px"}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:12}}>
              Giving History
            </div>
            {giftLoading?<div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",color:T.ink3,fontSize:12}}><Spin/></div>:<GivingHistoryChart gifts={gifts}/>}
          </div>

          {/* Tags */}
          {donor.tags?.length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{donor.tags.map(t=><Pill key={t} label={t}/>)}</div>}

          {/* Notes */}
          {donor.notes&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 14px",fontSize:13,color:T.ink3,lineHeight:1.6}}>{donor.notes}</div>}

          {/* Timeline */}
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Touchpoint Timeline</div>
              <button onClick={onLogTouchpoint} style={{background:"#10b981",border:"none",borderRadius:7,padding:"5px 12px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Log</button>
            </div>
            <TouchpointTimeline interactions={donor.interactions}/>
          </div>
        </div>

        {/* RIGHT — stage mover + always-on AI */}
        <div style={{overflowY:"auto",padding:"22px 24px 24px 20px",display:"flex",flexDirection:"column",gap:18}}>

          {/* Stage mover */}
          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Move Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {STAGES.map(s=>(
                <button key={s.id} onClick={()=>onStageChange(donor.id,s.id)}
                  style={{background:(donor.stage||"cultivate")===s.id?s.color+"22":T.bg,border:`1px solid ${(donor.stage||"cultivate")===s.id?s.color:T.bg3}`,borderRadius:8,padding:"6px 12px",color:(donor.stage||"cultivate")===s.id?s.color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{marginTop:8,fontSize:11,color:T.ink3,lineHeight:1.5,borderLeft:`2px solid ${stage.color}40`,paddingLeft:8}}>
              {STAGE_ACTION[donor.stage||"cultivate"]}
            </div>
          </div>

          {/* AI actions */}
          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>AI Intelligence</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
              <AIBtn onClick={()=>getAI(donor,"nextmove")} loading={loadingKey===`${donor.id}_nextmove`} label="✦ Next Move" small/>
              <AIBtn onClick={()=>getAI(donor,"outreach")} loading={loadingKey===`${donor.id}_outreach`} label="✦ Outreach" small/>
              <AIBtn onClick={()=>getAI(donor,"email")} loading={loadingKey===`${donor.id}_email`} label="✦ Draft Email" small/>
              <AIBtn onClick={()=>getAI(donor,"callscript")} loading={loadingKey===`${donor.id}_callscript`} label="✦ Call Script" small/>
            </div>
            {["nextmove","outreach","email","callscript"].map(t=>aiMap[`${donor.id}_${t}`]?<AIPanel key={t} text={aiMap[`${donor.id}_${t}`]} onClose={()=>{}}/>:null)}
          </div>
        </div>
      </div>
    </div>
  );
}

function DonorKanban({donors,onStageChange,onLogTouchpoint,onSelectDonor}){
  const[draggingId,setDraggingId]=useState(null);
  const[dragOver,setDragOver]=useState(null);
  const anyDragging=draggingId!==null;
  const byStage=sid=>donors.filter(d=>(d.stage||"cultivate")===sid).sort((a,b)=>b.total-a.total);
  return(
    <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,minHeight:"calc(100vh - 260px)",alignItems:"flex-start",width:"100%"}}>
      {STAGES.map(stage=>{
        const cols=byStage(stage.id);
        const total=cols.reduce((s,d)=>s+d.total,0);
        const isOver=dragOver===stage.id;
        return(
          <div key={stage.id} style={{display:"flex",flexDirection:"column",gap:6}}
            onDragOver={e=>{e.preventDefault();setDragOver(stage.id);}}
            onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragOver(null);}}
            onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData("donorId");if(id)onStageChange(id,stage.id);setDragOver(null);}}>

            {/* Column header */}
            <div style={{
              background:isOver?stage.color+"10":T.white,
              border:`1px solid ${isOver?stage.color+"50":T.bg2}`,
              borderTop:`3px solid ${stage.color}`,
              borderRadius:10,padding:"10px 12px 9px",
              transition:"background 0.12s,border-color 0.12s",
            }}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:9,fontWeight:800,color:T.ink3,letterSpacing:"0.1em",textTransform:"uppercase"}}>{stage.label}</span>
                <span style={{background:stage.color+"20",color:stage.color,fontSize:10,fontWeight:800,borderRadius:99,padding:"1px 7px",border:`1px solid ${stage.color}28`,lineHeight:"16px"}}>{cols.length}</span>
              </div>
              <div style={{fontSize:13,fontWeight:700,color:total>0?T.ink:T.ink3,fontFamily:"'DM Serif Display',serif",letterSpacing:"-0.01em"}}>
                {total>0?fmt(total):"$0"}
              </div>
            </div>

            {/* Drop zone + cards */}
            <div style={{
              display:"flex",flexDirection:"column",gap:6,flex:1,
              borderRadius:10,
              border:isOver?`2px dashed ${stage.color+"45"}`
                    :cols.length===0?`1px dashed ${T.bg3}`
                    :"1px dashed transparent",
              background:isOver?stage.color+"05":"transparent",
              padding:isOver?3:0,
              transition:"border-color 0.12s,background 0.12s",
              minHeight:cols.length===0?60:0,
            }}>
              {cols.map(d=>{
                const urg=moveUrgency(d);
                const sc=donorScore(d);
                const thisIsDragging=draggingId===d.id;
                const urgBg={critical:"#ef444407",due:"#f59e0b05",ok:"transparent"}[urg.level];
                const urgBorder={critical:"#ef444428",due:"#f59e0b28",ok:T.bg2}[urg.level];
                const scColor=sc>70?"#10b981":sc>45?"#f59e0b":"#ef4444";
                return(
                  <div key={d.id} draggable
                    onDragStart={e=>{e.dataTransfer.setData("donorId",d.id);setDraggingId(d.id);}}
                    onDragEnd={()=>{setDraggingId(null);setDragOver(null);}}
                    style={{
                      border:`1px solid ${thisIsDragging?"transparent":urgBorder}`,
                      borderRadius:10,padding:"13px 12px 10px",
                      cursor:"grab",opacity:thisIsDragging?0.2:1,
                      transition:"opacity 0.12s,box-shadow 0.12s",
                      userSelect:"none",
                      background:thisIsDragging?"transparent":urgBg||T.white,
                      boxShadow:thisIsDragging?"none":"0 1px 2px rgba(0,0,0,0.05)",
                    }}>
                    {/* Name row + score */}
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:6,marginBottom:5}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",letterSpacing:"-0.01em"}}>{d.name}</div>
                        <div style={{fontSize:12,color:T.green,marginTop:2,fontWeight:700}}>{fmt(d.total)}</div>
                      </div>
                      <div style={{background:scColor+"15",border:`1px solid ${scColor}30`,borderRadius:6,padding:"4px 7px",flexShrink:0,textAlign:"center",minWidth:30}}>
                        <div style={{fontSize:13,fontWeight:800,color:scColor,lineHeight:"1"}}>{sc}</div>
                      </div>
                    </div>
                    {/* Urgency */}
                    <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:8}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:urg.urgencyColor,flexShrink:0}}/>
                      <span style={{fontSize:10,color:urg.contactTextColor,fontWeight:600}}>{urg.days}d since contact</span>
                    </div>
                    {/* Buttons */}
                    <div style={{display:"flex",gap:4}}>
                      <button onClick={e=>{e.stopPropagation();onLogTouchpoint(d);}}
                        style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 0",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                        + Log
                      </button>
                      <button onClick={e=>{e.stopPropagation();onSelectDonor(d);}}
                        style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 0",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                        View →
                      </button>
                    </div>
                  </div>
                );
              })}
              {/* Only show drop hint when actively dragging over an empty column */}
              {isOver&&cols.length===0&&(
                <div style={{padding:"20px 8px",textAlign:"center",color:stage.color,fontSize:11,fontWeight:600,opacity:0.75}}>Drop here</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Re-engage View ─────────────────────────────────────────────────────────
function ReEngageView({donors,org,onLogTouchpoint,onSelectDonor}){
  const lapsed=[...donors].filter(d=>d.stage==="lapsed").sort((a,b)=>b.total-a.total);
  const totalValue=lapsed.reduce((s,d)=>s+d.total,0);
  const avgDays=lapsed.length
    ?Math.round(lapsed.reduce((s,d)=>s+daysDiff(d.lastGift||d.lastTouchpoint||new Date().toISOString()),0)/lapsed.length)
    :0;
  const[aiText,setAiText]=useState("");
  const[aiLoading,setAiLoading]=useState(false);

  const getStrategy=async()=>{
    setAiLoading(true);setAiText("");
    await askClaude(
      `You are a nonprofit major gifts officer. Be specific and tactical. Max 250 words.`,
      `Re-engagement strategy for ${org?.name||"this organization"}.\n\nLapsed donors: ${lapsed.length} total, ${fmtFull(totalValue)} combined lifetime value, avg ${avgDays} days lapsed.\n\nTop lapsed donors:\n${lapsed.slice(0,8).map(d=>`- ${d.name}: ${fmtFull(d.total)} lifetime, last gift ${d.lastGift||"unknown"} (${fmtFull(d.lastAmount)}), ${daysDiff(d.lastGift||d.lastTouchpoint||new Date().toISOString())}d lapsed`).join("\n")}\n\nProvide:\n1. Top 3 highest-priority donors to call this week and why\n2. Best re-engagement message angle for this portfolio\n3. One creative re-engagement tactic for the full group`,
      chunk=>setAiText(chunk)
    );
    setAiLoading(false);
  };

  if(!lapsed.length)return<EmptyState icon="♦" title="No lapsed donors" message="All your donors are active — great work!"/>;

  const fmtGiftDate=s=>{
    if(!s)return null;
    const dt=new Date(s);
    return isNaN(dt)?null:dt.toLocaleDateString("en-US",{month:"short",year:"numeric"});
  };

  const cols=["Donor","Lifetime Giving","Last Gift","Days Lapsed","Score",""];
  const colWidths="2fr 130px 130px 120px 80px 130px";

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* Summary header */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        {[
          ["Lapsed donors",lapsed.length,T.ink],
          ["Total lapsed value",fmtFull(totalValue),T.ink],
          ["Avg days lapsed",`${avgDays}d`,"#ef4444"],
        ].map(([label,val,color])=>(
          <div key={label} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"10px 18px",display:"flex",flexDirection:"column",gap:2}}>
            <div style={{fontSize:10,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            <div style={{fontSize:20,fontWeight:800,color,fontFamily:"'DM Serif Display',serif"}}>{val}</div>
          </div>
        ))}
        <div style={{marginLeft:"auto"}}>
          <AIBtn onClick={getStrategy} loading={aiLoading} label="✦ Re-engage Plan"/>
        </div>
      </div>
      {(aiLoading||aiText)&&<AIPanel text={aiText} onClose={()=>setAiText("")}/>}
      {/* Table */}
      <div style={{background:T.white,borderRadius:14,overflow:"hidden",border:"1px solid "+T.bg3}}>
        <div style={{display:"grid",gridTemplateColumns:colWidths,gap:0,padding:"10px 18px",background:T.bg2,borderBottom:"1px solid "+T.bg3}}>
          {cols.map((h,i)=>(
            <div key={i} style={{fontSize:10,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em",textAlign:i===0?"left":"right"}}>{h}</div>
          ))}
        </div>
        {lapsed.map((d,idx)=>{
          const days=daysDiff(d.lastGift||d.lastTouchpoint||new Date().toISOString());
          const sc=donorScore(d);
          const scColor=sc>70?"#10b981":sc>45?"#f59e0b":"#ef4444";
          const rowBg=days>730?"#ef444409":days>365?"#f59e0b09":"#eab30809";
          const rowBorderColor=days>730?"#ef444425":days>365?"#f59e0b25":"#eab30825";
          const daysColor=days>730?"#ef4444":days>365?"#f59e0b":"#ca8a04";
          const urgencyLabel=days>730?"Critical":days>365?"At Risk":"Watch";
          const giftDate=fmtGiftDate(d.lastGift);
          return(
            <div key={d.id} style={{display:"grid",gridTemplateColumns:colWidths,gap:0,padding:"13px 18px",background:rowBg,borderBottom:idx<lapsed.length-1?`1px solid ${rowBorderColor}`:"none",alignItems:"center"}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{d.name}</div>
                {d.email&&<div style={{fontSize:11,color:T.ink3,marginTop:1}}>{d.email}</div>}
              </div>
              <div style={{textAlign:"right",fontSize:13,fontWeight:700,color:T.ink}}>{fmtFull(d.total)}</div>
              <div style={{textAlign:"right"}}>
                {giftDate
                  ?<><div style={{fontSize:13,color:T.ink,fontWeight:600}}>{giftDate}</div><div style={{fontSize:11,color:T.ink3,marginTop:1}}>{d.lastAmount>0?fmtFull(d.lastAmount):""}</div></>
                  :<div style={{fontSize:13,color:T.ink3}}>—</div>
                }
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:13,fontWeight:700,color:daysColor}}>{days}d</div>
                <div style={{fontSize:10,color:daysColor,fontWeight:700,marginTop:2,textTransform:"uppercase",letterSpacing:".04em"}}>{urgencyLabel}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <span style={{fontSize:13,fontWeight:800,color:scColor,background:scColor+"18",borderRadius:7,padding:"3px 9px",display:"inline-block"}}>{sc}</span>
              </div>
              <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                <button onClick={e=>{e.stopPropagation();onLogTouchpoint(d);}} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 10px",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>+ Log</button>
                <button onClick={()=>onSelectDonor(d)} style={{background:"#10b98114",border:"1px solid #10b98140",borderRadius:7,padding:"4px 10px",color:"#10b981",fontSize:11,fontWeight:600,cursor:"pointer"}}>View →</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Donors ─────────────────────────────────────────────────────────────────
function Donors({data,setData}){
  const{auth}=useAuth();
  const isAdmin=auth?.user?.role==="admin";
  const lapsedCount=data.donors.filter(d=>d.stage==="lapsed").length;
  const[view,setView]=useState("kanban");
  const[search,setSearch]=useState("");
  const[selected,setSelected]=useState(null);
  const[logTarget,setLogTarget]=useState(null);
  const[editTarget,setEditTarget]=useState(null);
  const[toast,setToast]=useState("");
  const[aiMap,setAiMap]=useState({});const[loadingKey,setLoadingKey]=useState(null);
  const[callList,setCallList]=useState("");const[callLoading,setCallLoading]=useState(false);
  const[showAdd,setShowAdd]=useState(false);const[showImport,setShowImport]=useState(false);
  const[newDonor,setNewDonor]=useState({name:"",email:"",phone:"",lastAmount:"",stage:"prospect"});

  const filtered=data.donors.filter(d=>!search||(d.name+d.email).toLowerCase().includes(search.toLowerCase()));

  const moveToStage=async(donorId,stage)=>{
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donorId?{...d,stage}:d)}));
    if(selected?.id===donorId)setSelected(prev=>({...prev,stage}));
    try{await apiFetch(`/donors/${donorId}/stage`,{method:"PATCH",body:JSON.stringify({stage})});}
    catch(e){console.error(e);}
  };

  const handleLogged=(donor,interaction)=>{
    const updated={...donor,lastTouchpoint:interaction.date,interactions:[interaction,...(donor.interactions||[])]};
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donor.id?updated:d)}));
    if(selected?.id===donor.id)setSelected(updated);
    setLogTarget(null);
    if(interaction.type==="gift"&&interaction.amount>0)reloadDonors();
  };

  const getAI=async(donor,type)=>{
    const key=`${donor.id}_${type}`;setLoadingKey(key);setAiMap(p=>({...p,[key]:""}));
    const stage=STAGES.find(s=>s.id===(donor.stage||"cultivate"))||STAGES[2];
    const urg=moveUrgency(donor);
    const sys=`You are an expert major gifts officer. Be specific, strategic, brief. Max 200 words. Reference actual donor data.`;
    const prompts={
      nextmove:`Donor: ${donor.name} | Stage: ${stage.label} | Days since contact: ${urg.days} | Total: ${fmtFull(donor.total)} (${donor.gifts} gifts) | Last: ${fmtFull(donor.lastAmount)} on ${donor.lastGift}\nNotes: ${donor.notes||"none"}\nOrg: ${data.org.name} — ${data.org.mission}\nRecent touchpoints: ${donor.interactions?.slice(0,3).map(i=>`${i.date}: ${i.type} - ${i.note}`).join("; ")||"none"}\n\nProvide:\n**Urgency Score:** X/10\n**Recommended Move:** [exact action]\n**Timing:** [when]\n**What to say:** [2-3 sentences]\n**Goal:** [what you're trying to achieve]`,
      outreach:`Write an outreach strategy for ${donor.name} (${stage.label} stage).\nTotal: ${fmtFull(donor.total)}, last gift ${fmtFull(donor.lastAmount)} ${urg.days}d ago.\nNotes: ${donor.notes}\nOrg: ${data.org.mission}\n\nBest channel, talking points, suggested ask amount, personal hook.`,
      email:`Write a personalized email to ${donor.name} (${stage.label} stage).\nLast gift: ${fmtFull(donor.lastAmount)} on ${donor.lastGift}. Notes: ${donor.notes}\nOrg: ${data.org.name}.\n\nWarm, specific, 150 words max.`,
      callscript:`Phone call script for ${donor.name} (${stage.label}).\nContext: ${donor.notes}\nLast gift: ${fmtFull(donor.lastAmount)}\n\nOpening, 2 listening questions, impact hook, soft ask.`,
    };
    await askClaude(sys,prompts[type],chunk=>setAiMap(p=>({...p,[key]:chunk})));
    setLoadingKey(null);
  };

  const reloadDonors=async()=>{
    try{
      const donors=await apiFetch("/donors");
      const interactions_map=Object.fromEntries(donors.map(d=>[d.id,d.interactions||[]]));
      setData(prev=>({...prev,donors:donors.map(d=>{
        const ints=(d.interactions||[]).map(i=>({date:i.date||i.created_at?.split("T")[0],type:i.type,note:i.note||""}));
        const lastTouchpoint=ints.length>0?ints.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0].date:null;
        return{id:d.id,name:d.name,email:d.email||"",phone:d.phone||"",total:d.total_giving||0,
          lastGift:d.last_gift_date||"",lastAmount:d.last_gift_amount||0,gifts:d.gift_count||0,
          status:d.status,stage:d.stage||"cultivate",lastTouchpoint,
          tags:Array.isArray(d.tags)?d.tags:JSON.parse(d.tags||"[]"),notes:d.notes||"",interactions:ints};
      })}));
    }catch(e){console.error(e);}
  };

  const handleEditSaved=(raw)=>{
    const adapted={
      id:raw.id,name:raw.name,email:raw.email||"",phone:raw.phone||"",
      total:raw.total_giving||0,lastGift:raw.last_gift_date||"",
      lastAmount:raw.last_gift_amount||0,gifts:raw.gift_count||0,
      status:raw.status,stage:raw.stage||"cultivate",
      tags:Array.isArray(raw.tags)?raw.tags:JSON.parse(raw.tags||"[]"),
      notes:raw.notes||"",
      interactions:selected?.id===raw.id?(selected.interactions||[]):[],
      lastTouchpoint:selected?.id===raw.id?selected.lastTouchpoint:null,
    };
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===raw.id?adapted:d)}));
    if(selected?.id===raw.id)setSelected(adapted);
    setEditTarget(null);
  };

  const deleteDonor=async(id)=>{
    if(!window.confirm("Delete this donor? This cannot be undone."))return;
    try{
      await apiFetch(`/donors/${id}`,{method:"DELETE"});
      setData(prev=>({...prev,donors:prev.donors.filter(d=>d.id!==id)}));
      setSelected(null);
    }catch(e){console.error(e);}
  };

  const generateCallList=async()=>{
    setCallLoading(true);setCallList("");
    await askClaude(`You are a chief development officer. Be tactical. Max 200 words.`,
      `Prioritized call list for this week:\n${data.donors.map(d=>`${d.name} [${d.stage||"cultivate"}]: ${daysDiff(d.lastTouchpoint||d.lastGift)}d since contact, ${fmtFull(d.lastAmount)} last gift, score ${donorScore(d)}, notes: ${d.notes}`).join("\n")}`,
      chunk=>setCallList(chunk));
    setCallLoading(false);
  };

  const addDonor=async()=>{
    if(!newDonor.name)return;
    const temp={id:"tmp_"+Date.now(),name:newDonor.name,email:newDonor.email,phone:newDonor.phone,
      total:parseInt(newDonor.lastAmount)||0,lastGift:new Date().toISOString().split("T")[0],
      lastAmount:parseInt(newDonor.lastAmount)||0,gifts:newDonor.lastAmount?1:0,
      status:"new",stage:newDonor.stage,tags:[],notes:"",interactions:[],lastTouchpoint:null};
    setData(prev=>({...prev,donors:[...prev.donors,temp]}));
    setShowAdd(false);setNewDonor({name:"",email:"",phone:"",lastAmount:"",stage:"prospect"});
    try{await apiFetch("/donors",{method:"POST",body:JSON.stringify({...newDonor,stage:newDonor.stage})});await reloadDonors();}
    catch(e){console.error(e);}
  };

  return(
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <PageTitle main="Your" accent="donors."/>
      {showImport&&<DonorImport onClose={()=>setShowImport(false)} onImported={()=>{reloadDonors();setShowImport(false);}}/>}
      {logTarget&&<LogTouchpointModal donor={logTarget} onSave={int=>handleLogged(logTarget,int)} onClose={()=>setLogTarget(null)} onToast={msg=>{setToast(msg);setTimeout(()=>setToast(""),3500);}}/>}
      {toast&&<div style={{position:"fixed",bottom:28,left:"50%",transform:"translateX(-50%)",background:"#0f0f0f",color:"#fff",borderRadius:10,padding:"10px 22px",fontSize:13,fontWeight:600,zIndex:500,boxShadow:"0 4px 20px rgba(0,0,0,0.25)",display:"flex",alignItems:"center",gap:8,whiteSpace:"nowrap"}}>
        <span style={{color:"#10b981",fontSize:15}}>✓</span>{toast}
      </div>}
      {editTarget&&<EditDonorModal donor={editTarget} onSave={handleEditSaved} onClose={()=>setEditTarget(null)}/>}
      {selected&&<DonorProfile donor={selected} onClose={()=>setSelected(null)}
        onStageChange={moveToStage} onLogTouchpoint={()=>{setLogTarget(selected);}}
        aiMap={aiMap} loadingKey={loadingKey} getAI={getAI}
        isAdmin={isAdmin} onEdit={()=>setEditTarget(selected)} onDelete={deleteDonor}/>}

      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search donors…" style={{flex:1,minWidth:160,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink,fontSize:13,outline:"none"}}/>
        <div style={{display:"flex",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,overflow:"hidden"}}>
          {[["kanban","Pipeline"],["list","List"],["reengage","Re-engage"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?T.bg2:"transparent",border:"none",padding:"9px 14px",color:view===v?T.ink:"#6b7280",fontSize:13,fontWeight:view===v?700:400,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
              {l}
              {v==="reengage"&&lapsedCount>0&&<span style={{background:"#10b981",color:"#fff",borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:800,lineHeight:1.4}}>{lapsedCount}</span>}
            </button>
          ))}
        </div>
        <AIBtn onClick={generateCallList} loading={callLoading} label="✦ Call List"/>
        <button onClick={()=>setShowAdd(!showAdd)} style={{background:"#10b981",border:"none",borderRadius:10,padding:"10px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>+ Add</button>
        <button onClick={()=>setShowImport(true)} style={{background:T.bg3,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>↑ Import</button>
      </div>

      {(callLoading||callList)&&<AIPanel text={callList} onClose={()=>setCallList("")}/>}

      {showAdd&&<Card style={{gap:10,display:"flex",flexDirection:"column"}}>
        <div style={{fontSize:14,fontWeight:700,color:T.ink}}>New Donor</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {STAGES.map(s=><button key={s.id} onClick={()=>setNewDonor(p=>({...p,stage:s.id}))} style={{background:newDonor.stage===s.id?s.color+"22":T.bg,border:`1px solid ${newDonor.stage===s.id?s.color:T.bg3}`,borderRadius:7,padding:"5px 11px",color:newDonor.stage===s.id?s.color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>{s.label}</button>)}
        </div>
        {[["name","Full Name"],["email","Email"],["phone","Phone"],["lastAmount","Gift Amount ($)"]].map(([k,pl])=>(
          <input key={k} value={newDonor[k]} onChange={e=>setNewDonor(p=>({...p,[k]:e.target.value}))} placeholder={pl} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
        ))}
        <div style={{display:"flex",gap:8}}>
          <button onClick={addDonor} style={{background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Save</button>
          <button onClick={()=>setShowAdd(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </Card>}

      {view==="kanban"&&(filtered.length===0
        ?<EmptyState icon="♦" title="No donors match your search" message="Try a different name or email, or clear the search to see all donors."/>
        :<DonorKanban donors={filtered} onStageChange={moveToStage} onLogTouchpoint={d=>setLogTarget(d)} onSelectDonor={d=>setSelected(d)}/>
      )}

      {view==="reengage"&&<ReEngageView donors={filtered} org={data.org} onLogTouchpoint={d=>setLogTarget(d)} onSelectDonor={d=>setSelected(d)}/>}

      {view==="list"&&filtered.length===0&&<EmptyState icon="♦" title="No donors found" message="Try a different search term or add your first donor above."/>}
      {view==="list"&&filtered.map(d=>{
        const sc=donorScore(d);const scColor=sc>70?"#10b981":sc>45?"#f59e0b":"#ef4444";
        const urg=moveUrgency(d);const stage=STAGES.find(s=>s.id===(d.stage||"cultivate"))||STAGES[2];
        return(
          <Card key={d.id} onClick={()=>setSelected(d)} style={{cursor:"pointer"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{position:"relative",flexShrink:0}}>
                <div style={{width:40,height:40,borderRadius:"50%",background:stage.color+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:stage.color}}>{d.name[0]}</div>
                <div style={{position:"absolute",bottom:-2,right:-2,width:10,height:10,borderRadius:"50%",background:urg.urgencyColor,border:"2px solid "+T.bg}}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                  <div style={{fontSize:14,fontWeight:700,color:T.ink}}>{d.name}</div>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:99,background:stage.color+"22",color:stage.color}}>{stage.label}</span>
                </div>
                <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{urg.days}d since contact · {fmtFull(d.total)} lifetime · {d.gifts} gifts</div>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                <div style={{background:scColor+"18",border:`1px solid ${scColor}40`,borderRadius:7,padding:"4px 8px",textAlign:"center"}}>
                  <div style={{fontSize:13,fontWeight:800,color:scColor}}>{sc}</div>
                  <div style={{fontSize:8,color:scColor,lineHeight:1.1}}>score</div>
                </div>
                <button onClick={e=>{e.stopPropagation();setLogTarget(d);}} style={{background:T.bg3,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>+ Log</button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ── Grants ─────────────────────────────────────────────────────────────────
function GrantProfile({grant,onClose,onUpdate,onDelete,isAdmin,org}){
  const[aiMap,setAiMap]=useState({});const[loadingKey,setLoadingKey]=useState(null);
  const[notes,setNotes]=useState(grant.notes||"");const[savingNotes,setSavingNotes]=useState(false);
  const[editing,setEditing]=useState(false);
  const[ef,setEf]=useState({funder:grant.funder,program:grant.program,amount:grant.amount,received:grant.received||0,status:grant.status,deadline:grant.deadline||"",reportDue:grant.reportDue||"",officer:grant.officer||""});

  const pct=grant.amount>0?Math.round((grant.received||0)/grant.amount*100):0;
  const days=daysUntil(grant.deadline);
  const reportDays=grant.reportDue?daysUntil(grant.reportDue):null;
  const statuses=["prospecting","pending","active","closed"];

  const getAI=async(type)=>{
    const key=`${grant.id}_${type}`;setLoadingKey(key);setAiMap(p=>({...p,[key]:""}));
    const sys=`You are an expert nonprofit grant writer and strategist. Specific, tactical. Max 250 words.`;
    const prompts={
      strategy:`Grant strategy for ${grant.funder} / ${grant.program}.\nAmount: ${fmtFull(grant.amount)} | Status: ${grant.status} | Deadline: ${grant.deadline}\nOfficer: ${grant.officer}\nNotes: ${grant.notes}\nHistory: ${(grant.history||[]).join(", ")}\nOrg: ${org?.name} — ${org?.mission}\nPrograms: ${org?.programs?.join(", ")}\n\nProvide: key narrative angle, what funder cares about, red flags, 3 specific things to include.`,
      loi:`Write a compelling Letter of Inquiry for ${grant.funder}.\nProgram: ${grant.program} | Ask: ${fmtFull(grant.amount)}\nOrg: ${org?.name} — ${org?.mission}\nPrograms: ${org?.programs?.join(", ")}\n\nWrite a 3-paragraph LOI: hook, program fit, ask.`,
      report:`Grant report outline for ${grant.funder}.\nProgram: ${grant.program} | Amount: ${fmtFull(grant.amount)} | Due: ${grant.reportDue}\nNotes: ${grant.notes}\nOrg mission: ${org?.mission}\n\nProvide: section headers, 3 key metrics to feature, narrative arc, what to emphasize.`,
    };
    await askClaude(sys,prompts[type],chunk=>setAiMap(p=>({...p,[key]:chunk})));
    setLoadingKey(null);
  };

  const changeStatus=async(status)=>{
    const g=grant;
    await apiFetch(`/grants/${g.id}`,{method:"PUT",body:JSON.stringify({funder:g.funder,program:g.program,amount:g.amount,received:g.received||0,status,deadline:g.deadline||"",reportDue:g.reportDue||"",officer:g.officer,notes:g.notes})});
    onUpdate({...g,status});
  };

  const saveNotes=async()=>{
    setSavingNotes(true);const g=grant;
    await apiFetch(`/grants/${g.id}`,{method:"PUT",body:JSON.stringify({funder:g.funder,program:g.program,amount:g.amount,received:g.received||0,status:g.status,deadline:g.deadline||"",reportDue:g.reportDue||"",officer:g.officer,notes})});
    onUpdate({...g,notes});setSavingNotes(false);
  };

  const saveEdit=async()=>{
    const raw=await apiFetch(`/grants/${grant.id}`,{method:"PUT",body:JSON.stringify({funder:ef.funder,program:ef.program,amount:Number(ef.amount)||0,received:Number(ef.received)||0,status:ef.status,deadline:ef.deadline||"",reportDue:ef.reportDue||"",officer:ef.officer,notes:grant.notes})});
    const adapted={id:raw.id,funder:raw.funder,program:raw.program||"",amount:raw.amount||0,received:raw.received||0,status:raw.status,deadline:raw.deadline||"",reportDue:raw.report_due||null,officer:raw.officer||"",notes:raw.notes||"",history:Array.isArray(raw.history)?raw.history:JSON.parse(raw.history||"[]")};
    onUpdate(adapted);setEditing(false);
  };

  const inp={width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"};

  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:T.bg,zIndex:200,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Top bar */}
      <div style={{background:T.white,borderBottom:"1px solid "+T.bg3,padding:"10px 24px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onClose} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>← Back</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:16,fontWeight:800,color:T.ink,letterSpacing:"-0.01em"}}>{grant.funder}</span>
            <Pill label={grant.status} color={SC[grant.status]}/>
          </div>
          <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{grant.program} · {fmtFull(grant.amount)} ask</div>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0}}>
          <button onClick={()=>setEditing(true)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Edit</button>
          {isAdmin&&<button onClick={()=>onDelete(grant.id)} style={{background:"transparent",border:"1px solid #ef444455",borderRadius:8,padding:"7px 14px",color:"#ef4444",fontSize:13,cursor:"pointer"}}>Delete</button>}
        </div>
      </div>

      {/* Edit modal */}
      {editing&&<div style={{position:"absolute",inset:0,background:"rgba(15,15,15,0.45)",zIndex:10,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setEditing(false)}>
        <div onClick={e=>e.stopPropagation()} style={{background:T.white,borderRadius:16,padding:24,width:480,maxWidth:"92vw",display:"flex",flexDirection:"column",gap:12}}>
          <div style={{fontSize:15,fontWeight:700,color:T.ink}}>Edit Grant</div>
          {[["funder","Funder"],["program","Program"],["officer","Program Officer"]].map(([k,l])=>(
            <div key={k}>
              <div style={{fontSize:11,color:T.ink3,marginBottom:4}}>{l}</div>
              <input value={ef[k]} onChange={e=>setEf(p=>({...p,[k]:e.target.value}))} style={inp}/>
            </div>
          ))}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {[["amount","Ask Amount ($)"],["received","Received ($)"]].map(([k,l])=>(
              <div key={k}><div style={{fontSize:11,color:T.ink3,marginBottom:4}}>{l}</div>
              <input type="number" value={ef[k]} onChange={e=>setEf(p=>({...p,[k]:e.target.value}))} style={inp}/></div>
            ))}
            {[["deadline","Deadline"],["reportDue","Report Due"]].map(([k,l])=>(
              <div key={k}><div style={{fontSize:11,color:T.ink3,marginBottom:4}}>{l}</div>
              <input type="date" value={ef[k]||""} onChange={e=>setEf(p=>({...p,[k]:e.target.value}))} style={inp}/></div>
            ))}
          </div>
          <div>
            <div style={{fontSize:11,color:T.ink3,marginBottom:4}}>Status</div>
            <select value={ef.status} onChange={e=>setEf(p=>({...p,status:e.target.value}))} style={{...inp,cursor:"pointer"}}>
              {statuses.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={saveEdit} style={{background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Save Changes</button>
            <button onClick={()=>setEditing(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      </div>}

      {/* Two-panel body */}
      <div style={{flex:1,display:"grid",gridTemplateColumns:"minmax(0,1.25fr) minmax(0,0.75fr)",overflow:"hidden"}}>

        {/* LEFT — details + notes */}
        <div style={{overflowY:"auto",padding:"22px 20px 24px 24px",borderRight:"1px solid "+T.bg3,display:"flex",flexDirection:"column",gap:18}}>

          {/* Stats row */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            {[
              ["Ask",fmtFull(grant.amount),T.ink],
              ["Received",fmtFull(grant.received||0),"#10b981"],
              ["% Funded",pct+"%",pct>75?"#10b981":pct>40?"#f59e0b":"#6b7280"],
              ["Days Left",grant.deadline?(days<0?"Overdue":days+"d"):"—",days<0?"#ef4444":days<14?"#ef4444":days<30?"#f59e0b":T.ink],
            ].map(([l,v,c])=>(
              <div key={l} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
                <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>{l}</div>
                <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:"'DM Serif Display',serif",lineHeight:1.1}}>{v}</div>
              </div>
            ))}
          </div>

          {/* Funding progress */}
          {grant.amount>0&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Funding Progress</div>
              <div style={{fontSize:11,color:T.ink3}}>{fmtFull(grant.received||0)} of {fmtFull(grant.amount)}</div>
            </div>
            <div style={{height:8,background:T.bg3,borderRadius:99}}>
              <div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:"#10b981",borderRadius:99,transition:"width 0.4s"}}/>
            </div>
          </div>}

          {/* Details grid */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>Application Deadline</div>
              <div style={{fontSize:14,fontWeight:600,color:days<14?"#ef4444":days<30?"#f59e0b":T.ink}}>{grant.deadline?new Date(grant.deadline).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}):"—"}</div>
            </div>
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>Program Officer</div>
              <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{grant.officer||"—"}</div>
            </div>
            {grant.reportDue&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>Report Due</div>
              <div style={{fontSize:14,fontWeight:600,color:reportDays<14?"#ef4444":reportDays<30?"#f59e0b":T.ink}}>{new Date(grant.reportDue).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
            </div>}
          </div>

          {/* Grant history tags */}
          {grant.history&&grant.history.length>0&&<div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Prior Awards</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {grant.history.map((h,i)=><Pill key={i} label={h} color="#10b981"/>)}
            </div>
          </div>}

          {/* Notes */}
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Notes</div>
              {notes!==grant.notes&&<button onClick={saveNotes} disabled={savingNotes} style={{background:"#10b981",border:"none",borderRadius:7,padding:"4px 10px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>{savingNotes?"Saving…":"Save"}</button>}
            </div>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Add notes about this grant…" style={{width:"100%",boxSizing:"border-box",background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",color:T.ink,fontSize:13,lineHeight:1.6,outline:"none",resize:"vertical",minHeight:100}}/>
          </div>
        </div>

        {/* RIGHT — status + AI */}
        <div style={{overflowY:"auto",padding:"22px 24px 24px 20px",display:"flex",flexDirection:"column",gap:18}}>

          {/* Status mover */}
          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Move Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {statuses.map(s=>(
                <button key={s} onClick={()=>changeStatus(s)}
                  style={{background:grant.status===s?SC[s]+"22":T.bg,border:`1px solid ${grant.status===s?SC[s]:T.bg3}`,borderRadius:8,padding:"6px 12px",color:grant.status===s?SC[s]:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",textTransform:"capitalize"}}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* AI Intelligence */}
          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>AI Intelligence</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
              {grant.status!=="closed"&&<AIBtn onClick={()=>getAI("strategy")} loading={loadingKey===`${grant.id}_strategy`} label="✦ Grant Strategy" small/>}
              {["pending","prospecting"].includes(grant.status)&&<AIBtn onClick={()=>getAI("loi")} loading={loadingKey===`${grant.id}_loi`} label="✦ Draft LOI" small/>}
              {grant.reportDue&&grant.status==="active"&&<AIBtn onClick={()=>getAI("report")} loading={loadingKey===`${grant.id}_report`} label="✦ Report Outline" small/>}
            </div>
            {["strategy","loi","report"].map(t=>aiMap[`${grant.id}_${t}`]?<AIPanel key={t} text={aiMap[`${grant.id}_${t}`]} onClose={()=>setAiMap(p=>({...p,[`${grant.id}_${t}`]:""}))}/>:null)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Grants({data,setData}) {
  const {auth}=useAuth();
  const isAdmin=auth?.user?.role==="admin";
  const [selected,setSelected]=useState(null);
  const [prospectAI,setProspectAI]=useState(""); const [prospectLoading,setProspectLoading]=useState(false);
  const pipeline=["prospecting","pending","active","closed"];
  const totals=pipeline.reduce((a,s)=>{a[s]=data.grants.filter(g=>g.status===s).reduce((sum,g)=>sum+g.amount,0);return a;},{});

  const findProspects=async()=>{
    setProspectLoading(true); setProspectAI("");
    await askClaude(
      `You are a nonprofit grant research expert. Be specific. Max 200 words.`,
      `Suggest 4 new grant prospects for this org.\nOrg: ${data.org.name}\nMission: ${data.org.mission}\nPrograms: ${data.org.programs.join(", ")}\nCurrent funders: ${data.grants.map(g=>g.funder).join(", ")}\nLocation: New York City\n\nFor each prospect give: funder name, program name, estimated range, why it fits, and one specific alignment point.`,
      chunk=>setProspectAI(chunk)
    );
    setProspectLoading(false);
  };

  const onUpdate=(updated)=>{
    setData(prev=>({...prev,grants:prev.grants.map(g=>g.id===updated.id?updated:g)}));
    setSelected(updated);
  };
  const onDelete=async(id)=>{
    await apiFetch(`/grants/${id}`,{method:"DELETE"});
    setData(prev=>({...prev,grants:prev.grants.filter(g=>g.id!==id)}));
    setSelected(null);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    {selected&&<GrantProfile grant={selected} onClose={()=>setSelected(null)} onUpdate={onUpdate} onDelete={onDelete} isAdmin={isAdmin} org={data.org}/>}
    <PageTitle main="Grant" accent="pipeline."/>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <AIBtn onClick={findProspects} loading={prospectLoading} label="✦ Find New Grant Prospects"/>
    </div>
    {(prospectLoading||prospectAI)&&<AIPanel text={prospectAI} onClose={()=>setProspectAI("")}/>}

    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
      {pipeline.map(s=><div key={s} style={{background:T.white,border:`1px solid ${SC[s]}25`,borderRadius:12,padding:"14px 16px",borderTop:`3px solid ${SC[s]}`}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:SC[s],marginBottom:8}}>{s}</div>
        <div style={{fontSize:22,fontWeight:800,color:T.ink,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{fmt(totals[s])}</div>
        <div style={{fontSize:11,color:T.ink3,marginTop:4}}>{data.grants.filter(g=>g.status===s).length} grant{data.grants.filter(g=>g.status===s).length!==1?"s":""}</div>
      </div>)}
    </div>

    {data.grants.length===0&&<EmptyState icon="◉" title="No grants yet" message="Start tracking your grant portfolio — add grants by clicking Find Grants or creating one manually."/>}
    {data.grants.map(g=>{
      const pct=g.amount>0?Math.round((g.received||0)/g.amount*100):0;
      const days=daysUntil(g.deadline);
      return <Card key={g.id} accent={SC[g.status]} onClick={()=>setSelected(g)} style={{cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{g.funder}</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:2}}>{g.program}</div>
            {g.history&&g.history.length>0&&<div style={{fontSize:11,color:T.ink3,marginTop:2}}>History: {g.history.join(" · ")}</div>}
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:16,fontWeight:800,color:T.ink}}>{fmt(g.amount)}</div>
            {g.status==="active"&&<div style={{fontSize:11,color:T.ink3}}>{pct}% received</div>}
            {g.deadline&&days<=60&&<div style={{fontSize:11,color:days<14?"#ef4444":"#f59e0b",marginTop:2,fontWeight:600}}>{days<0?"Overdue":days+"d left"}</div>}
          </div>
          <Pill label={g.status} color={SC[g.status]}/>
        </div>
        {g.status==="active"&&<div style={{marginTop:10,height:4,background:T.bg3,borderRadius:99}}><div style={{height:"100%",width:`${pct}%`,background:"#10b981",borderRadius:99}}/></div>}
      </Card>;
    })}
  </div>;
}

// ── Volunteers ─────────────────────────────────────────────────────────────
function Volunteers({data}) {
  const [convPlan,setConvPlan]=useState(""); const [convLoading,setConvLoading]=useState(false);
  const [boardAI,setBoardAI]=useState(""); const [boardLoading,setBoardLoading]=useState(false);

  const getConvPlan=async()=>{
    setConvLoading(true); setConvPlan("");
    await askClaude(`You are a nonprofit development strategist. Specific, tactical. Max 200 words.`,
      `Donor conversion plan for high-potential volunteers.\n\n${data.volunteers.filter(v=>v.convertPotential==="high").map(v=>`${v.name}: ${v.hours}h, skills: ${v.skills.join(",")}, employer: ${v.employer}, notes: ${v.notes}`).join("\n")}\n\nOrg: ${data.org.name} — ${data.org.mission}\n\nFor each: first ask amount, best moment, personal connection point, suggested language.`,
      chunk=>setConvPlan(chunk));
    setConvLoading(false);
  };
  const getBoardCandidates=async()=>{
    setBoardLoading(true); setBoardAI("");
    await askClaude(`You are a nonprofit governance expert. Max 150 words.`,
      `Identify board candidates from these volunteers and explain why.\n\n${data.volunteers.map(v=>`${v.name}: ${v.hours}h, employer: ${v.employer}, skills: ${v.skills.join(",")}, potential: ${v.convertPotential}, notes: ${v.notes}`).join("\n")}\n\nCurrent board: ${data.board.map(b=>`${b.name} (${b.employer}, ${b.role})`).join(", ")}\n\nIdentify gaps in skills/diversity the board needs and which volunteers could fill them.`,
      chunk=>setBoardAI(chunk));
    setBoardLoading(false);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <PageTitle main="Your" accent="volunteers."/>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
      <MetricCard label="Total Volunteers" value={data.volunteers.length} sub={`${data.volunteers.reduce((s,v)=>s+v.hours,0)} total hours`} color="#8b5cf6"/>
      <MetricCard label="High Convert Potential" value={data.volunteers.filter(v=>v.convertPotential==="high").length} sub="ready to cultivate" color="#f59e0b"/>
      <MetricCard label="Converted" value={data.volunteers.filter(v=>v.convertPotential==="converted").length} sub="volunteer → donor" color="#10b981"/>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <AIBtn onClick={getConvPlan} loading={convLoading} label="✦ Volunteer-to-Donor Conversion Plan"/>
      <AIBtn onClick={getBoardCandidates} loading={boardLoading} label="✦ Identify Board Candidates"/>
    </div>
    {(convLoading||convPlan)&&<AIPanel text={convPlan} onClose={()=>setConvPlan("")}/>}
    {(boardLoading||boardAI)&&<AIPanel text={boardAI} onClose={()=>setBoardAI("")}/>}
    {data.volunteers.length===0&&<EmptyState icon="◎" title="No volunteers yet" message="Add volunteers to track hours, skills, and conversion potential."/>}
    {data.volunteers.map(v=>{
      const cc=v.convertPotential==="high"?"#f59e0b":v.convertPotential==="converted"?"#10b981":"#6b7280";
      return <Card key={v.id}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:42,height:42,borderRadius:"50%",background:cc+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:cc,flexShrink:0}}>{v.name[0]}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{v.name}</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:1}}>{v.employer} · {v.email}</div>
            <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>{v.skills.map(s=><Pill key={s} label={s} color="#8b5cf6"/>)}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:20,fontWeight:800,color:cc,fontFamily:"'DM Serif Display',serif"}}>{v.hours}h</div>
            <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{daysDiff(v.lastActive)}d ago</div>
            <div style={{marginTop:4}}><Pill label={v.convertPotential==="converted"?"donor":`${v.convertPotential} potential`} color={cc}/></div>
          </div>
        </div>
        {v.notes&&<div style={{marginTop:12,background:T.bg,borderRadius:8,padding:"9px 12px",fontSize:12,color:T.ink3,lineHeight:1.5}}>{v.notes}</div>}
      </Card>;
    })}
  </div>;
}

// ── Board ──────────────────────────────────────────────────────────────────
function Board({data}) {
  const [boardBrief,setBoardBrief]=useState(""); const [briefLoading,setBriefLoading]=useState(false);
  const [boardEmail,setBoardEmail]=useState(""); const [emailLoading,setEmailLoading]=useState(false);
  const totalGiving=data.board.reduce((s,b)=>s+parseInt(b.givingLevel.replace(/[$,]/g,"")),0);
  const avgAttendance=Math.round(data.board.reduce((s,b)=>s+b.attendance,0)/data.board.length);

  const generateBrief=async()=>{
    setBriefLoading(true); setBoardBrief("");
    const rev=data.financials.revenue; const exp=data.financials.expenses;
    const ytdRev=rev.reduce((s,r)=>s+r.individual+r.grants+r.events+r.other,0);
    const ytdExp=exp.reduce((s,e)=>s+e.programs+e.admin+e.fundraising,0);
    await askClaude(`You are a nonprofit ED writing a board report. Professional, concise, specific. Max 250 words.`,
      `Generate a Q2 board briefing for ${data.org.name}.\n\nFinancials: YTD Revenue ${fmtFull(ytdRev)}, Expenses ${fmtFull(ytdExp)}, Net ${fmtFull(ytdRev-ytdExp)}\nFund balances: ${data.financials.funds.map(f=>`${f.name}: ${fmtFull(f.balance)}`).join(", ")}\nActive grants: ${data.grants.filter(g=>g.status==="active").map(g=>`${g.funder} ${fmtFull(g.amount)}`).join(", ")}\nGrant pipeline: ${data.grants.filter(g=>["pending","prospecting"].includes(g.status)).map(g=>`${g.funder} ${fmtFull(g.amount)} [${g.status}]`).join(", ")}\nDonor highlights: ${data.donors.filter(d=>d.status==="major").map(d=>`${d.name} ${fmtFull(d.total)}`).join(", ")}\nOpen tasks: ${data.tasks.filter(t=>!t.done&&t.priority==="high").map(t=>t.title).join("; ")}\n\nFormat: Financial Snapshot, Development Highlights, Grant Update, Action Items for Board`,
      chunk=>setBoardBrief(chunk));
    setBriefLoading(false);
  };

  const draftEmail=async()=>{
    setEmailLoading(true); setBoardEmail("");
    await askClaude(`You are an executive director. Professional, warm, brief. Max 200 words.`,
      `Draft a board member engagement email asking for introductions to potential donors.\nOrg: ${data.org.name} — ${data.org.mission}\nBoard giving: ${fmtFull(totalGiving)} total\n\nAsk board members to make 2-3 introductions to people in their network who care about arts education and youth development in NYC. Include a specific example of program impact.`,
      chunk=>setBoardEmail(chunk));
    setEmailLoading(false);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Board" accent="management."/>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
      <MetricCard label="Board Members" value={data.board.length} sub={`${avgAttendance}% avg attendance`} color="#3b82f6"/>
      <MetricCard label="Board Giving" value={fmt(totalGiving)} sub="100% board participation" color="#10b981"/>
      <MetricCard label="Committees" value={[...new Set(data.board.flatMap(b=>b.committees))].length} sub="active committees" color="#8b5cf6"/>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <AIBtn onClick={generateBrief} loading={briefLoading} label="✦ Generate Q2 Board Report"/>
      <AIBtn onClick={draftEmail} loading={emailLoading} label="✦ Draft Board Ask Email"/>
    </div>
    {(briefLoading||boardBrief)&&<AIPanel text={boardBrief} onClose={()=>setBoardBrief("")}/>}
    {(emailLoading||boardEmail)&&<AIPanel text={boardEmail} onClose={()=>setBoardEmail("")}/>}
    {data.board.length===0&&<EmptyState icon="◆" title="No board members yet" message="Track your board's giving, attendance, committees, and terms."/>}
    {data.board.map(b=>{
      const attColor=b.attendance>=90?"#10b981":b.attendance>=75?"#f59e0b":"#ef4444";
      return <Card key={b.id}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:42,height:42,borderRadius:"50%",background:"#3b82f633",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:"#3b82f6",flexShrink:0}}>{b.name[0]}</div>
          <div style={{flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{b.name}</div>
              <Pill label={b.role} color="#3b82f6"/>
            </div>
            <div style={{fontSize:12,color:T.ink3,marginTop:1}}>{b.employer}</div>
            <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>{b.committees.map(c=><Pill key={c} label={c} color="#6b7280"/>)}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:15,fontWeight:800,color:"#10b981"}}>{b.givingLevel}</div>
            <div style={{fontSize:11,color:attColor,marginTop:3,fontWeight:600}}>{b.attendance}% attendance</div>
            <div style={{fontSize:11,color:T.ink3,marginTop:1}}>Term: {b.term}</div>
          </div>
        </div>
      </Card>;
    })}
  </div>;
}

// ── Tasks ──────────────────────────────────────────────────────────────────
function Tasks({data,setData}) {
  const [showAdd,setShowAdd]=useState(false);
  const [newTask,setNewTask]=useState({title:"",due:"",priority:"medium",type:"donor"});
  const [prioAI,setPrioAI]=useState(""); const [prioLoading,setPrioLoading]=useState(false);

  const toggle=id=>setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===id?{...t,done:!t.done}:t)}));
  const addTask=()=>{
    if(!newTask.title) return;
    setData(prev=>({...prev,tasks:[...prev.tasks,{...newTask,id:Date.now(),done:false}]}));
    setShowAdd(false); setNewTask({title:"",due:"",priority:"medium",type:"donor"});
  };
  const prioritize=async()=>{
    setPrioLoading(true); setPrioAI("");
    await askClaude(`You are a nonprofit development officer. Tactical. Max 180 words.`,
      `Prioritize these tasks for this week. For each, explain the specific reason and urgency.\n\n${data.tasks.filter(t=>!t.done).map(t=>`[${t.priority}] ${t.title} — due ${t.due}`).join("\n")}\n\nContext: ${data.org.name}, active grant deadlines, lapsed donors needing attention, Q2 board packet due soon.`,
      chunk=>setPrioAI(chunk));
    setPrioLoading(false);
  };

  const pending=data.tasks.filter(t=>!t.done).sort((a,b)=>({high:0,medium:1,low:2}[a.priority]-{high:0,medium:1,low:2}[b.priority]));
  const done=data.tasks.filter(t=>t.done);

  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    <PageTitle main="Open" accent="tasks."/>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",gap:8}}>
        <AIBtn onClick={prioritize} loading={prioLoading} label="✦ AI Prioritize"/>
        <button onClick={()=>setShowAdd(true)} style={{background:"#10b981",border:"none",borderRadius:10,padding:"9px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>+ Add</button>
      </div>
      <div style={{fontSize:12,color:T.ink3}}>{pending.length} open · {done.length} done</div>
    </div>
    {(prioLoading||prioAI)&&<AIPanel text={prioAI} onClose={()=>setPrioAI("")}/>}
    {showAdd&&<Card style={{flexDirection:"column",display:"flex",gap:10}}>
      <input value={newTask.title} onChange={e=>setNewTask(p=>({...p,title:e.target.value}))} placeholder="Task title" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <input type="date" value={newTask.due} onChange={e=>setNewTask(p=>({...p,due:e.target.value}))} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink3,fontSize:13,outline:"none"}}/>
        {[["priority",["high","medium","low"]],["type",["donor","grant","board","volunteer","finance"]]].map(([k,opts])=>
          <select key={k} value={newTask[k]} onChange={e=>setNewTask(p=>({...p,[k]:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 10px",color:T.ink3,fontSize:13,outline:"none"}}>
            {opts.map(o=><option key={o} value={o}>{o}</option>)}
          </select>)}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={addTask} style={{background:"#10b981",border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Save</button>
        <button onClick={()=>setShowAdd(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"8px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
    </Card>}
    {pending.length===0&&!prioAI&&<EmptyState icon="◻" title="All tasks complete" message="Nothing pending. Add a new task to stay organized."/>}
    {pending.map(t=>{
      const overdue=t.due&&daysUntil(t.due)<0;
      return <div key={t.id} onClick={()=>toggle(t.id)} style={{background:T.white,border:`1px solid ${overdue?"#ef444430":T.bg2}`,borderRadius:12,padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,transition:"border-color 0.15s"}}>
        <div style={{width:20,height:20,borderRadius:6,border:`2px solid ${SC[t.priority]}`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"background 0.12s"}}/>
        <div style={{flex:1}}>
          <div style={{fontSize:13,color:T.ink,fontWeight:500,lineHeight:1.35}}>{t.title}</div>
          {t.due&&<div style={{fontSize:11,color:overdue?"#ef4444":"#6b7280",marginTop:2,fontWeight:overdue?700:400}}>
            {overdue?`Overdue — was due `:"Due "}{new Date(t.due).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
          </div>}
        </div>
        <div style={{display:"flex",gap:5,flexShrink:0}}><Pill label={t.priority} color={SC[t.priority]}/><Pill label={t.type} color="#4b5563"/></div>
      </div>;
    })}
    {done.length>0&&<>
      <div style={{fontSize:10,fontWeight:700,color:T.bg2,textTransform:"uppercase",letterSpacing:"0.1em",marginTop:8,paddingTop:8,borderTop:"1px solid #0e1624"}}>Completed · {done.length}</div>
      {done.map(t=><div key={t.id} onClick={()=>toggle(t.id)} style={{background:T.white,border:"1px solid #0e1624",borderRadius:12,padding:"10px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,opacity:0.4}}>
        <div style={{width:20,height:20,borderRadius:6,background:"#10b981",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:10,color:"#fff",fontWeight:700}}>✓</span></div>
        <div style={{fontSize:13,color:T.ink3,textDecoration:"line-through",flex:1}}>{t.title}</div>
      </div>)}
    </>}
  </div>;
}

// ── Finance ────────────────────────────────────────────────────────────────
function Finance({data}) {
  const [forecastAI,setForecastAI]=useState(""); const [forecastLoading,setForecastLoading]=useState(false);
  const [riskAI,setRiskAI]=useState(""); const [riskLoading,setRiskLoading]=useState(false);
  const rev=data.financials.revenue; const exp=data.financials.expenses;
  const ytdRev=rev.reduce((s,r)=>s+r.individual+r.grants+r.events+r.other,0);
  const ytdExp=exp.reduce((s,e)=>s+e.programs+e.admin+e.fundraising,0);
  const programRatio=Math.round(exp.reduce((s,e)=>s+e.programs,0)/ytdExp*100);
  const maxBar=Math.max(...rev.map(r=>r.individual+r.grants+r.events+r.other),...exp.map(e=>e.programs+e.admin+e.fundraising));

  const getForecast=async()=>{
    setForecastLoading(true); setForecastAI("");
    await askClaude(`You are a nonprofit CFO. Specific, data-driven. Max 200 words.`,
      `Generate a 6-month revenue forecast and key financial risks.\n\nYTD Revenue: ${fmtFull(ytdRev)} | YTD Expenses: ${fmtFull(ytdExp)} | Net: ${fmtFull(ytdRev-ytdExp)}\nMonthly revenue trend: ${rev.map(r=>`${r.month}: ${fmtFull(r.individual+r.grants+r.events+r.other)}`).join(", ")}\nActive grants: ${data.grants.filter(g=>g.status==="active").map(g=>`${g.funder} ${fmtFull(g.amount)} ends ${g.deadline}`).join(", ")}\nPipeline: ${data.grants.filter(g=>["pending","prospecting"].includes(g.status)).map(g=>`${g.funder} ${fmtFull(g.amount)}`).join(", ")}\nFund balances: ${data.financials.funds.map(f=>`${f.name}: ${fmtFull(f.balance)}`).join(", ")}\nProgram ratio: ${programRatio}%\n\nProvide: Q3-Q4 revenue projection, 3 financial risks, 2 opportunities.`,
      chunk=>setForecastAI(chunk));
    setForecastLoading(false);
  };
  const getRisks=async()=>{
    setRiskLoading(true); setRiskAI("");
    await askClaude(`You are a nonprofit financial auditor. Direct, specific. Max 150 words.`,
      `Identify financial risks for this org.\nYTD Net: ${fmtFull(ytdRev-ytdExp)}\nRestricted funds: ${data.financials.funds.filter(f=>f.restricted).map(f=>`${f.name}: ${fmtFull(f.balance)}`).join(", ")}\nGrant concentration: ${data.grants.filter(g=>g.status==="active").map(g=>`${g.funder}: ${fmtFull(g.amount)}`).join(", ")}\nLapsed donors: ${data.donors.filter(d=>d.status==="lapsed").length}\nProgram expense ratio: ${programRatio}%\n\nList top 3 risks with severity and mitigation recommendation.`,
      chunk=>setRiskAI(chunk));
    setRiskLoading(false);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Financial" accent="overview."/>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
      <MetricCard label="YTD Revenue" value={fmt(ytdRev)} color="#10b981"/>
      <MetricCard label="YTD Expenses" value={fmt(ytdExp)} color="#ef4444"/>
      <MetricCard label="Net Position" value={fmt(ytdRev-ytdExp)} color={ytdRev>ytdExp?"#10b981":"#ef4444"}/>
      <MetricCard label="Program Ratio" value={`${programRatio}%`} sub="IRS recommends 65%+" color={programRatio>=65?"#10b981":"#f59e0b"}/>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <AIBtn onClick={getForecast} loading={forecastLoading} label="✦ 6-Month Forecast"/>
      <AIBtn onClick={getRisks} loading={riskLoading} label="✦ Risk Analysis"/>
    </div>
    {(forecastLoading||forecastAI)&&<AIPanel text={forecastAI} onClose={()=>setForecastAI("")}/>}
    {(riskLoading||riskAI)&&<AIPanel text={riskAI} onClose={()=>setRiskAI("")}/>}

    <Card>
      <SectionLabel>Monthly Breakdown</SectionLabel>
      {rev.length===0&&<EmptyState icon="◇" title="No financial data" message="Add monthly financial data to see trends."/>}
      {rev.map((r,i)=>{
        const rv=r.individual+r.grants+r.events+r.other;
        const ex=exp[i].programs+exp[i].admin+exp[i].fundraising;
        const net=rv-ex;
        return <div key={r.month} style={{marginBottom:14,paddingBottom:14,borderBottom:"1px solid #0e1624"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{r.month}</span>
            <div style={{display:"flex",gap:16,alignItems:"center"}}>
              <span style={{fontSize:11,color:"#10b981"}}>↑ {fmtFull(rv)}</span>
              <span style={{fontSize:11,color:"#ef4444"}}>↓ {fmtFull(ex)}</span>
              <span style={{fontSize:12,fontWeight:700,color:net>=0?"#10b981":"#ef4444"}}>{net>=0?"+":""}{fmtFull(net)}</span>
            </div>
          </div>
          <div style={{height:5,background:T.bg2,borderRadius:99,overflow:"hidden",marginBottom:3}}>
            <div style={{height:"100%",width:`${maxBar>0?(rv/maxBar)*100:0}%`,background:"linear-gradient(90deg,#10b981,#3b82f6)",borderRadius:99}}/>
          </div>
          <div style={{height:4,background:T.bg2,borderRadius:99,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${maxBar>0?(ex/maxBar)*100:0}%`,background:"linear-gradient(90deg,#ef444488,#dc2626)",borderRadius:99,opacity:0.7}}/>
          </div>
          {rv>0&&<div style={{display:"flex",gap:3,marginTop:4}}>
            {[["individual",r.individual,"#10b981"],["grants",r.grants,"#3b82f6"],["events",r.events,"#8b5cf6"],["other",r.other,"#6b7280"]].filter(([,v])=>v>0).map(([k,v,c])=>
              <div key={k} style={{flex:v/rv,height:3,background:c,borderRadius:99,opacity:0.6}} title={`${k}: ${fmtFull(v)}`}/>
            )}
          </div>}
        </div>;
      })}
      <div style={{display:"flex",gap:14,marginTop:4,flexWrap:"wrap"}}>
        {[["#10b981","Individual"],["#3b82f6","Grants"],["#8b5cf6","Events"],["#6b7280","Other"]].map(([c,l])=>
          <div key={l} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:c}}/><span style={{fontSize:11,color:T.ink3}}>{l}</span></div>
        )}
      </div>
    </Card>

    <Card>
      <SectionLabel>Fund Balances</SectionLabel>
      {data.financials.funds.map((f,i)=><div key={f.name} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:i<data.financials.funds.length-1?"1px solid #0e1624":""}}>
        <div style={{width:10,height:10,borderRadius:"50%",background:f.restricted?"#10b981":"#10b981",flexShrink:0,boxShadow:f.restricted?"0 0 8px #10b98160":"0 0 8px #10b98160"}}/>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{f.name}</div>
          <div style={{fontSize:10,color:f.restricted?"#10b981":"#6b7280",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:1}}>{f.restricted?"Restricted":"Unrestricted"}</div>
        </div>
        <div style={{fontSize:18,fontWeight:800,color:T.ink,fontFamily:"'DM Serif Display',serif"}}>{fmt(f.balance)}</div>
      </div>)}
    </Card>
  </div>;
}

// ── Donor Import ───────────────────────────────────────────────────────────
const CSV_FIELDS = [
  {key:"name",labels:["name","full name","donor name","contact"]},
  {key:"email",labels:["email","email address","e-mail"]},
  {key:"phone",labels:["phone","phone number","mobile","cell"]},
  {key:"total",labels:["total","total giving","lifetime","lifetime giving","total donated"]},
  {key:"lastAmount",labels:["last gift","last amount","last donation","recent gift"]},
  {key:"lastGift",labels:["last gift date","date","last donation date","most recent date"]},
  {key:"gifts",labels:["gifts","gift count","# gifts","number of gifts","donations"]},
  {key:"status",labels:["status","donor status","type"]},
  {key:"notes",labels:["notes","note","comments"]},
];

function guessField(header) {
  const h = header.toLowerCase().trim();
  for (const f of CSV_FIELDS) {
    if (f.labels.some(l => h === l || h.includes(l))) return f.key;
  }
  return "";
}

function inferStage(total, lastGiftStr) {
  const amount = parseFloat(String(total || "0").replace(/[$,]/g, "")) || 0;
  const d = lastGiftStr ? new Date(lastGiftStr) : null;
  const days = d && !isNaN(d) ? Math.floor((Date.now() - d) / 86400000) : Infinity;
  if (!amount && days === Infinity) return "prospect";
  if (days > 365) return "lapsed";
  if (days < 90 && amount > 0) return "steward";
  if (amount > 0) return "cultivate";
  return "prospect";
}

const STAGE_COLORS = {prospect:T.ink3,qualify:"#3b82f6",cultivate:"#8b5cf6",solicit:"#f59e0b",steward:"#10b981",lapsed:"#ef4444"};

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  const rows = lines.slice(1).map(line => {
    const vals = []; let cur = ""; let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] || ""]));
  });
  return { headers, rows };
}

function DonorImport({ onClose, onImported }) {
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const handleFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCsvText(ev.target.result);
    reader.readAsText(file);
  };

  const doParse = () => {
    const { headers, rows } = parseCSV(csvText);
    if (!rows.length) { setErr("No rows found. Check CSV format."); return; }
    const auto = {};
    headers.forEach(h => { const g = guessField(h); if (g) auto[h] = g; });
    setMapping(auto); setParsed({ headers, rows }); setErr("");
  };

  const doAiMap = async () => {
    if (!parsed) return;
    setAiLoading(true);
    try {
      const sample = parsed.rows[0] || {};
      const res = await apiFetch("/ai/column-map", { method:"POST", body:JSON.stringify({ headers:parsed.headers, sample }) });
      if (res.mapping) {
        const merged = { ...mapping };
        Object.entries(res.mapping).forEach(([h, f]) => {
          if (f && CSV_FIELDS.some(cf => cf.key === f)) merged[h] = f;
        });
        setMapping(merged);
      }
    } catch { /* keep existing mapping */ }
    setAiLoading(false);
  };

  const buildDonors = () => parsed.rows.map(row => {
    const d = {};
    Object.entries(mapping).forEach(([h, field]) => { if (field) d[field] = row[h]; });
    if (d.total) d.total = parseFloat(String(d.total).replace(/[$,]/g, "")) || 0;
    if (d.lastAmount) {
      const s = String(d.lastAmount);
      d.lastAmount = /^\d{4}[-\/]\d{2}/.test(s) ? 0 : parseFloat(s.replace(/[$,]/g,"")) || 0;
    }
    if (d.gifts) d.gifts = parseInt(d.gifts) || 1;
    if (!d.stage) d.stage = inferStage(d.total, d.lastGift);
    return d;
  }).filter(d => d.name);

  const doImport = async () => {
    setLoading(true); setErr("");
    try {
      const res = await apiFetch("/donors/import", { method:"POST", body:JSON.stringify({ donors:buildDonors() }) });
      setResult(res.inserted); onImported();
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const overlay = { position:"fixed",inset:0,background:"#000c",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20 };
  const modal = { background:T.white,border:"1px solid "+T.bg3,borderRadius:20,width:"100%",maxWidth:700,maxHeight:"88vh",overflowY:"auto",padding:28 };
  const inp = { width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" };

  if (result !== null) return (
    <div style={overlay}><div style={{...modal,textAlign:"center"}}>
      <div style={{fontSize:40,marginBottom:12}}>✓</div>
      <div style={{fontSize:22,fontWeight:800,color:T.ink,marginBottom:8}}>{result} donor{result!==1?"s":""} imported</div>
      <div style={{fontSize:14,color:T.ink3,marginBottom:24}}>Stages were auto-assigned based on gift history.</div>
      <button onClick={onClose} style={{background:"#10b981",border:"none",borderRadius:10,padding:"12px 28px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
    </div></div>
  );

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Import Donors</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>AI maps columns · stages auto-assigned from gift history</div>
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13}}>✕ Close</button>
        </div>

        {!parsed && (<>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Upload CSV file</div>
            <input type="file" accept=".csv" onChange={handleFile} style={{fontSize:13,color:T.ink3}}/>
          </div>
          <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Or paste CSV text</div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={7} placeholder={"Name,Email,Total Giving,Last Gift Date\nJane Smith,jane@example.com,5000,2024-11-01"} style={{...inp,resize:"vertical",lineHeight:1.5,marginBottom:12}}/>
          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <button onClick={doParse} disabled={!csvText.trim()} style={{background:csvText.trim()?"linear-gradient(135deg,#10b981,#3b82f6)":T.bg2,border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:csvText.trim()?"pointer":"not-allowed",opacity:csvText.trim()?1:0.5}}>
            Parse CSV →
          </button>
        </>)}

        {parsed && (<>
          {/* Column mapping */}
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink}}>Map Columns</div>
              <button onClick={doAiMap} disabled={aiLoading} style={{background:aiLoading?"#1a2235":"linear-gradient(135deg,#1a6b4a,#2563eb)",border:"none",borderRadius:8,padding:"6px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:aiLoading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:aiLoading?0.7:1}}>
                {aiLoading?<><Spin/>Mapping…</>:<>✦ AI Map</>}
              </button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {parsed.headers.map(h=>(
                <div key={h} style={{display:"flex",alignItems:"center",gap:8,background:mapping[h]?T.bg:"transparent",borderRadius:7,padding:"5px 8px",border:`1px solid ${mapping[h]?T.bg3:"transparent"}`}}>
                  <span style={{fontSize:12,color:mapping[h]?T.ink:T.ink3,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h}</span>
                  <select value={mapping[h]||""} onChange={e=>setMapping(p=>({...p,[h]:e.target.value}))}
                    style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 8px",color:T.ink,fontSize:11,outline:"none",flexShrink:0}}>
                    <option value="">— skip —</option>
                    {CSV_FIELDS.map(f=><option key={f.key} value={f.key}>{f.key}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Stage preview */}
          {(() => {
            const donors = buildDonors();
            const stageCounts = {};
            donors.forEach(d => { stageCounts[d.stage] = (stageCounts[d.stage]||0)+1; });
            return Object.keys(stageCounts).length > 0 && (
              <div style={{background:T.bg,borderRadius:10,padding:"12px 14px",marginBottom:16}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Smart Stage Assignment Preview</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {Object.entries(stageCounts).map(([s,n])=>(
                    <span key={s} style={{fontSize:12,fontWeight:600,padding:"3px 10px",borderRadius:99,background:(STAGE_COLORS[s]||T.ink3)+"22",color:STAGE_COLORS[s]||T.ink3,border:`1px solid ${(STAGE_COLORS[s]||T.ink3)}30`}}>
                      {s} × {n}
                    </span>
                  ))}
                </div>
                <div style={{fontSize:11,color:T.ink3,marginTop:8}}>Based on last gift date + amount. Override any stage after import by dragging in the Kanban.</div>
              </div>
            );
          })()}

          {/* Preview table */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:600,color:T.ink3,marginBottom:8}}>{parsed.rows.length} rows · showing first 5</div>
            <div style={{overflowX:"auto",border:"1px solid "+T.bg3,borderRadius:8}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:T.bg}}>
                  {parsed.headers.filter(h=>mapping[h]).map(h=><th key={h} style={{padding:"6px 10px",textAlign:"left",color:T.ink3,fontWeight:600,borderBottom:"1px solid "+T.bg3}}>{mapping[h]}</th>)}
                  <th style={{padding:"6px 10px",textAlign:"left",color:T.ink3,fontWeight:600,borderBottom:"1px solid "+T.bg3}}>stage</th>
                </tr></thead>
                <tbody>{parsed.rows.slice(0,5).map((row,i)=>{
                  const d={};Object.entries(mapping).forEach(([h,f])=>{if(f)d[f]=row[h];});
                  const st=inferStage(d.total,d.lastGift);
                  return(
                    <tr key={i} style={{borderBottom:"1px solid "+T.bg2}}>
                      {parsed.headers.filter(h=>mapping[h]).map(h=><td key={h} style={{padding:"6px 10px",color:T.ink}}>{row[h]}</td>)}
                      <td style={{padding:"6px 10px"}}>
                        <span style={{fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:99,background:(STAGE_COLORS[st]||T.ink3)+"22",color:STAGE_COLORS[st]||T.ink3}}>{st}</span>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>

          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setParsed(null)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
            <button onClick={doImport} disabled={loading} style={{flex:1,background:loading?T.bg2:"linear-gradient(135deg,#10b981,#3b82f6)",border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1}}>
              {loading?"Importing…":`Import ${buildDonors().length} Donors →`}
            </button>
          </div>
        </>)}
      </div>
    </div>
  );
}

// ── Find Grants ─────────────────────────────────────────────────────────────
function FindGrants({data}) {
  const [results,setResults]=useState(""); const [loading,setLoading]=useState(false);
  const [ran,setRan]=useState(false);

  const ytdRev=data.financials.revenue.reduce((s,r)=>s+r.individual+r.grants+r.events+r.other,0);
  const budgetLabel=ytdRev>1000000?"$1M+":ytdRev>500000?"$500K–$1M":ytdRev>100000?"$100K–$500K":"Under $100K";
  const activeGrants=data.grants.filter(g=>g.status==="active").map(g=>g.funder).join(", ")||"none yet";

  const find = async () => {
    setLoading(true); setResults(""); setRan(true);
    const sys=`You are a nonprofit grants strategist with deep knowledge of US foundations, government programs, and corporate giving. Be specific with real funder names and programs that actually exist.`;
    const msg=`Find 10 grants this nonprofit is likely eligible for, ranked by alignment.

Organization: ${data.org.name}
Mission: ${data.org.mission}
Annual budget: ${budgetLabel}
Current funders: ${activeGrants}
Board: ${data.board.map(b=>b.employer).filter(Boolean).join(", ")||"various"}

For each grant, provide:
**[Rank]. [Funder Name] — [Program Name]**
Typical award: $[X]–$[Y]
Alignment score: [X]/10
Why you qualify: [2 sentences specific to this org]
Next step: [concrete action]

Focus on grants under $200K that match this org's size and mission. Include a mix of: private foundations, corporate foundations, and government programs. Be specific — name real programs.`;

    await askClaude(sys, msg, chunk=>setResults(chunk));
    setLoading(false);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Find" accent="new grants."/>
    <Card>
      <SectionLabel>Your Organization Profile</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        <div><div style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Mission</div>
          <div style={{fontSize:13,color:T.ink,lineHeight:1.5}}>{data.org.mission||"—"}</div></div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div><div style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Annual Budget</div>
            <div style={{fontSize:13,color:T.ink}}>{budgetLabel}</div></div>
          <div><div style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Current Funders</div>
            <div style={{fontSize:13,color:T.ink}}>{activeGrants}</div></div>
        </div>
      </div>
      <button onClick={find} disabled={loading} style={{background:loading?T.bg2:"linear-gradient(135deg,#8b5cf6,#3b82f6)",border:"none",borderRadius:12,padding:"13px 22px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:8,opacity:loading?0.7:1}}>
        {loading?<><Spin/>Scanning grant landscape…</>:"✦ Find Matching Grants"}
      </button>
    </Card>

    {(loading||results)&&<Card style={{background:"linear-gradient(135deg,#0f0c29,#0f172a)",border:"1px solid #10b98144"}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#8b5cf6",marginBottom:14}}>✦ Grant Matches — Ranked by Alignment</div>
      {loading&&!results&&<div style={{display:"flex",alignItems:"center",gap:10,color:T.ink3,fontSize:13}}><Spin/>Analyzing your org and searching grant landscape…</div>}
      {results&&<div style={{fontSize:13,color:T.ink2,lineHeight:1.85,whiteSpace:"pre-wrap"}}>{results}</div>}
    </Card>}

    {ran&&!loading&&!results&&<div style={{fontSize:13,color:T.ink3,textAlign:"center",padding:20}}>No results yet — try again.</div>}
  </div>;
}

// ── Communications Hub ─────────────────────────────────────────────────────
function Communications({data}) {
  const {auth}=useAuth(); const isAdmin=auth?.user?.role==="admin";
  const [campaigns,setCampaigns]=useState([]); const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState(null); const [showBuilder,setShowBuilder]=useState(false);
  const [showSmtp,setShowSmtp]=useState(false); const [sending,setSending]=useState(false);
  const [aiDraft,setAiDraft]=useState(""); const [aiLoading,setAiLoading]=useState(false);
  const [form,setForm]=useState({name:"",type:"appeal",subject:"",body:"",stages:[],statuses:[]});
  const [smtp,setSmtp]=useState({smtpHost:"",smtpPort:587,smtpUser:"",smtpPass:"",smtpFrom:""});
  const [savingSmtp,setSavingSmtp]=useState(false); const [sendResult,setSendResult]=useState(null);
  const STAGES=["prospect","qualify","cultivate","solicit","steward","lapsed"];
  const STATUSES=["major","mid","new","lapsed"];
  const TYPES=["appeal","thank-you","grant-ack","tax-receipt","newsletter"];

  const load=async()=>{try{setCampaigns(await apiFetch("/campaigns"));}catch{}setLoading(false);};
  useEffect(()=>{load();},[]);

  const save=async()=>{
    const seg=JSON.stringify({stages:form.stages,statuses:form.statuses});
    try{await apiFetch("/campaigns",{method:"POST",body:JSON.stringify({name:form.name,type:form.type,subject:form.subject,body:form.body,segment:seg})});
      await load();setShowBuilder(false);setForm({name:"",type:"appeal",subject:"",body:"",stages:[],statuses:[]});}
    catch(e){alert(e.message);}
  };

  const send=async(cmp)=>{
    if(!window.confirm(`Send "${cmp.name}" to filtered donors? This sends real emails.`))return;
    setSending(true);setSendResult(null);
    try{const r=await apiFetch(`/campaigns/${cmp.id}/send`,{method:"POST"});setSendResult(r);await load();}
    catch(e){alert(e.message);}
    setSending(false);
  };

  const draftAI=async()=>{
    setAiLoading(true);setAiDraft("");
    const seg=form.stages.length?`Segments: ${form.stages.join(", ")}`:"";
    await askClaude(`You are an expert nonprofit development writer. Warm, authentic donor communications. Max 250 words.`,
      `Write a donor email for ${data.org.name}.\nType: ${form.type}\nMission: ${data.org.mission}\n${seg}\nSubject hint: ${form.subject||"(generate one)"}\n\nUse these variables where natural: {{donor_name}}, {{gift_amount}}, {{gift_date}}, {{total_giving}}, {{org_name}}, {{year}}\n\nReturn: "Subject: ..." then blank line then the email body. Be personal and mission-driven.`,
      chunk=>setAiDraft(chunk));
    setAiLoading(false);
  };

  const applyDraft=()=>{
    const lines=aiDraft.split("\n"); const subjLine=lines.find(l=>l.startsWith("Subject:"));
    const bodyText=lines.filter(l=>!l.startsWith("Subject:")).join("\n").trim();
    setForm(f=>({...f,subject:subjLine?subjLine.replace("Subject:","").trim():f.subject,body:bodyText||f.body}));
    setAiDraft("");
  };

  const saveSmtp=async()=>{
    setSavingSmtp(true);
    try{await apiFetch("/org/smtp",{method:"PUT",body:JSON.stringify(smtp)});alert("SMTP settings saved.");}
    catch(e){alert(e.message);}
    setSavingSmtp(false);
  };

  const toggleStage=s=>setForm(f=>({...f,stages:f.stages.includes(s)?f.stages.filter(x=>x!==s):[...f.stages,s]}));
  const toggleStatus=s=>setForm(f=>({...f,statuses:f.statuses.includes(s)?f.statuses.filter(x=>x!==s):[...f.statuses,s]}));

  const Inp=({label,k,state,set,type="text",ph=""})=>(
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</label>
      <input type={type} value={state[k]} onChange={e=>set(s=>({...s,[k]:e.target.value}))} placeholder={ph}
        style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
    </div>
  );

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Email" accent="campaigns."/>
    <div style={{display:"flex",gap:10,alignItems:"center"}}>
      <button onClick={()=>setShowBuilder(true)} style={{background:"#10b981",border:"none",borderRadius:10,padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>+ New Campaign</button>
      {isAdmin&&<button onClick={()=>setShowSmtp(!showSmtp)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink3,fontSize:12,cursor:"pointer"}}>⚙ SMTP Settings</button>}
    </div>

    {showSmtp&&isAdmin&&<Card>
      <SectionLabel>SMTP Settings</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Inp label="SMTP Host" k="smtpHost" state={smtp} set={setSmtp} ph="smtp.gmail.com"/>
        <Inp label="Port" k="smtpPort" state={smtp} set={setSmtp} type="number" ph="587"/>
        <Inp label="Username" k="smtpUser" state={smtp} set={setSmtp} ph="you@yourdomain.org"/>
        <Inp label="Password" k="smtpPass" state={smtp} set={setSmtp} type="password" ph="••••••••"/>
        <Inp label="From Address" k="smtpFrom" state={smtp} set={setSmtp} ph="CREO Arts <outreach@creoarts.org>"/>
      </div>
      <button onClick={saveSmtp} disabled={savingSmtp} style={{marginTop:12,background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save SMTP</button>
      <div style={{marginTop:8,fontSize:11,color:T.ink3}}>Gmail: use an App Password. Resend: smtp.resend.com / port 465.</div>
    </Card>}

    {showBuilder&&<Card style={{display:"flex",flexDirection:"column",gap:12}}>
      <SectionLabel>New Campaign</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Inp label="Campaign Name" k="name" state={form} set={setForm} ph="Spring Appeal 2025"/>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Type</label>
          <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13}}>
            {TYPES.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <Inp label="Subject Line" k="subject" state={form} set={setForm} ph="A message from {{org_name}}"/>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Email Body</label>
        <textarea value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={8} placeholder={"Dear {{donor_name}},\n\n..."}
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
        <div style={{fontSize:10,color:T.ink3}}>Variables: {"{{donor_name}} {{gift_amount}} {{gift_date}} {{total_giving}} {{org_name}} {{year}}"}</div>
      </div>
      <div>
        <SectionLabel>Segment — Stages</SectionLabel>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
          {STAGES.map(s=><button key={s} onClick={()=>toggleStage(s)} style={{background:form.stages.includes(s)?"#10b981":T.bg2,border:"none",borderRadius:99,padding:"5px 12px",color:form.stages.includes(s)?"#fff":T.ink3,fontSize:11,cursor:"pointer",fontWeight:form.stages.includes(s)?700:400}}>{s}</button>)}
        </div>
        <SectionLabel>Segment — Status</SectionLabel>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {STATUSES.map(s=><button key={s} onClick={()=>toggleStatus(s)} style={{background:form.statuses.includes(s)?"#8b5cf6":T.bg2,border:"none",borderRadius:99,padding:"5px 12px",color:form.statuses.includes(s)?"#fff":T.ink3,fontSize:11,cursor:"pointer",fontWeight:form.statuses.includes(s)?700:400}}>{s}</button>)}
        </div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <AIBtn onClick={draftAI} loading={aiLoading} label="✦ AI Draft" small/>
        <button onClick={save} style={{background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save Draft</button>
        <button onClick={()=>{setShowBuilder(false);setAiDraft("");}} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
      {aiDraft&&<div style={{background:T.bg,border:"1px solid #10b98144",borderRadius:12,padding:16}}>
        <div style={{fontSize:10,fontWeight:700,color:"#8b5cf6",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>✦ AI Draft</div>
        <div style={{fontSize:13,color:T.ink2,lineHeight:1.75,whiteSpace:"pre-wrap",marginBottom:12}}>{aiDraft}</div>
        <button onClick={applyDraft} style={{background:"#10b981",border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Apply to form</button>
      </div>}
    </Card>}

    {sendResult&&<div style={{background:"#052e16",border:"1px solid #10b981",borderRadius:12,padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <span style={{color:"#10b981",fontWeight:700,fontSize:14}}>✓ Sent to {sendResult.sent} donors{sendResult.failed>0?` (${sendResult.failed} failed)`:""}</span>
      <button onClick={()=>setSendResult(null)} style={{background:"transparent",border:"none",color:"#10b981",cursor:"pointer",fontSize:18}}>×</button>
    </div>}

    {loading?<div style={{color:T.ink3,fontSize:13,textAlign:"center",padding:40}}>Loading campaigns…</div>:
      campaigns.length===0?<Card><div style={{color:T.ink3,fontSize:13,textAlign:"center",padding:20}}>No campaigns yet. Create your first campaign above.</div></Card>:
      campaigns.map(c=>{
        const isOpen=selected?.id===c.id;
        const openRate=c.recipient_count>0?Math.round(c.open_count/c.recipient_count*100):0;
        const seg=typeof c.segment==="string"?JSON.parse(c.segment||"{}"):c.segment||{};
        return <Card key={c.id} selected={isOpen} accent={c.status==="sent"?"#10b981":"#8b5cf6"} onClick={()=>setSelected(isOpen?null:c)}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{flex:1}}>
              <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{c.name}</div>
              <div style={{fontSize:12,color:T.ink3,marginTop:2}}>{c.subject}</div>
            </div>
            <div style={{textAlign:"right"}}>
              {c.status==="sent"&&<div style={{fontSize:13,color:T.ink,fontWeight:600}}>{c.recipient_count} sent · {openRate}% opened</div>}
              {c.status==="draft"&&<div style={{fontSize:11,color:T.ink3}}>Draft</div>}
            </div>
            <Pill label={c.status} color={c.status==="sent"?"#10b981":"#8b5cf6"}/>
          </div>
          {c.status==="sent"&&<div style={{marginTop:8,height:3,background:T.bg3,borderRadius:99}}>
            <div style={{height:"100%",width:`${openRate}%`,background:"#10b981",borderRadius:99}}/>
          </div>}
          {isOpen&&<div style={{marginTop:14,paddingTop:14,borderTop:"1px solid "+T.bg3}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Type</div><div style={{fontSize:13,color:T.ink,marginTop:3}}>{c.type}</div></div>
              <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Segment</div><div style={{fontSize:12,color:T.ink3,marginTop:3}}>{[...(seg.stages||[]),...(seg.statuses||[])].join(", ")||"All donors with email"}</div></div>
              {c.status==="sent"&&<><div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Recipients</div><div style={{fontSize:13,color:T.ink,marginTop:3}}>{c.recipient_count}</div></div>
              <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Open Rate</div><div style={{fontSize:13,color:openRate>=25?"#10b981":"#f59e0b",marginTop:3}}>{openRate}%</div></div></>}
              <div style={{gridColumn:"1/-1"}}><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Preview</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:3,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{c.body?.slice(0,220)}{c.body?.length>220?"…":""}</div></div>
            </div>
            {c.status==="draft"&&isAdmin&&<button onClick={e=>{e.stopPropagation();send(c);}} disabled={sending}
              style={{background:sending?T.bg2:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:sending?"not-allowed":"pointer"}}>
              {sending?<><Spin/>Sending…</>:"↑ Send Campaign"}
            </button>}
            {c.recipients&&c.recipients.length>0&&<div style={{marginTop:14}}>
              <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Recipients</div>
              {c.recipients.slice(0,10).map(r=><div key={r.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid "+T.bg2,fontSize:12}}>
                <span style={{color:T.ink}}>{r.donor_name||r.email}</span>
                <span style={{color:r.opened_at?"#10b981":"#6b7280"}}>{r.opened_at?"✓ opened":r.sent_at?"delivered":"pending"}</span>
              </div>)}
              {c.recipients.length>10&&<div style={{fontSize:11,color:T.ink3,marginTop:6}}>+{c.recipients.length-10} more</div>}
            </div>}
          </div>}
        </Card>;
      })}
  </div>;
}

// ── Program Management ─────────────────────────────────────────────────────
function Programs({data}) {
  const {auth}=useAuth(); const isAdmin=auth?.user?.role==="admin";
  const [programs,setPrograms]=useState([]); const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState(null); const [showAdd,setShowAdd]=useState(false);
  const [aiMap,setAiMap]=useState({}); const [aiLoading,setAiLoading]=useState(null);
  const [form,setForm]=useState({name:"",description:"",budget:"",spent:"",staff:"",participantCount:"",startDate:"",endDate:"",status:"active",outcomes:""});
  const [linkGrant,setLinkGrant]=useState({programId:null,grantId:"",allocated:""});

  const load=async()=>{try{setPrograms(await apiFetch("/programs"));}catch{}setLoading(false);};
  useEffect(()=>{load();},[]);

  const save=async()=>{
    const body={name:form.name,description:form.description,budget:parseInt(form.budget)||0,spent:parseInt(form.spent)||0,
      staff:JSON.stringify(form.staff.split(",").map(s=>s.trim()).filter(Boolean)),participantCount:parseInt(form.participantCount)||0,
      startDate:form.startDate,endDate:form.endDate,status:form.status,outcomes:form.outcomes,metrics:{}};
    try{await apiFetch("/programs",{method:"POST",body:JSON.stringify(body)});await load();setShowAdd(false);
      setForm({name:"",description:"",budget:"",spent:"",staff:"",participantCount:"",startDate:"",endDate:"",status:"active",outcomes:""});}
    catch(e){alert(e.message);}
  };

  const addGrantLink=async(programId)=>{
    try{await apiFetch(`/programs/${programId}/grants`,{method:"POST",body:JSON.stringify({grantId:linkGrant.grantId,allocated:parseInt(linkGrant.allocated)||0})});
      await load();setLinkGrant({programId:null,grantId:"",allocated:""});}
    catch(e){alert(e.message);}
  };

  const removeGrantLink=async(programId,grantId)=>{
    try{await apiFetch(`/programs/${programId}/grants/${grantId}`,{method:"DELETE"});await load();}
    catch(e){alert(e.message);}
  };

  const getAI=async(p,type)=>{
    const key=`${p.id}_${type}`;setAiLoading(key);setAiMap(m=>({...m,[key]:""}));
    const staff=Array.isArray(p.staff)?p.staff:JSON.parse(p.staff||"[]");
    const metrics=typeof p.metrics==="string"?JSON.parse(p.metrics||"{}"):p.metrics||{};
    const sys=`You are a nonprofit program evaluation expert. Impact-focused, specific. Max 250 words.`;
    const prompt=type==="impact"
      ?`Write an impact narrative for a grant report.\n\nProgram: ${p.name}\nDesc: ${p.description}\nBudget: ${fmtFull(p.budget)} | Spent: ${fmtFull(p.spent)} | Participants: ${p.participant_count}\nStaff: ${staff.join(", ")}\nDates: ${p.start_date} — ${p.end_date}\nOutcomes: ${p.outcomes}\nMetrics: ${JSON.stringify(metrics)}\nOrg: ${data.org.name} — ${data.org.mission}\n\nLead with the most powerful outcome. Include specific numbers and connect to org mission.`
      :`Write a theory of change for this program.\n\nProgram: ${p.name}\nDesc: ${p.description}\nOutcomes: ${p.outcomes}\nOrg: ${data.org.name} — ${data.org.mission}\n\nFormat: Activities → Outputs → Outcomes → Long-term Impact. Be specific and measurable.`;
    await askClaude(sys,prompt,chunk=>setAiMap(m=>({...m,[key]:chunk})));
    setAiLoading(null);
  };

  const Inp=({label,k,type="text",ph=""})=>(
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</label>
      <input type={type} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} placeholder={ph}
        style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
    </div>
  );

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Your" accent="programs."/>
    <button onClick={()=>setShowAdd(!showAdd)} style={{alignSelf:"flex-start",background:"#10b981",border:"none",borderRadius:10,padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>+ New Program</button>

    {showAdd&&<Card style={{display:"flex",flexDirection:"column",gap:12}}>
      <SectionLabel>New Program</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Inp label="Program Name" k="name" ph="After-School Arts"/>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Status</label>
          <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13}}>
            {["active","planning","completed","paused"].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <Inp label="Budget ($)" k="budget" type="number" ph="85000"/>
        <Inp label="Spent ($)" k="spent" type="number" ph="52000"/>
        <Inp label="Participants" k="participantCount" type="number" ph="120"/>
        <Inp label="Staff (comma-separated)" k="staff" ph="Carlos Mendez, Sophie Laurent"/>
        <Inp label="Start Date" k="startDate" type="date"/>
        <Inp label="End Date" k="endDate" type="date"/>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Description</label>
        <textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} rows={2}
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Outcomes</label>
        <textarea value={form.outcomes} onChange={e=>setForm(f=>({...f,outcomes:e.target.value}))} rows={2}
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={save} style={{background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save Program</button>
        <button onClick={()=>setShowAdd(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
    </Card>}

    {loading?<div style={{color:T.ink3,fontSize:13,textAlign:"center",padding:40}}>Loading programs…</div>:
      programs.length===0?<Card><div style={{color:T.ink3,fontSize:13,textAlign:"center",padding:20}}>No programs yet. Add your first program above.</div></Card>:
      programs.map(p=>{
        const isOpen=selected?.id===p.id;
        const staff=Array.isArray(p.staff)?p.staff:JSON.parse(p.staff||"[]");
        const metrics=typeof p.metrics==="string"?JSON.parse(p.metrics||"{}"):p.metrics||{};
        const grants=p.grants||[];
        const pct=p.budget>0?Math.round(p.spent/p.budget*100):0;
        const totalAllocated=grants.reduce((s,g)=>s+g.allocated,0);
        const statusColor={active:"#10b981",planning:"#3b82f6",completed:"#6b7280",paused:"#f59e0b"}[p.status]||"#6b7280";
        return <Card key={p.id} selected={isOpen} accent={statusColor} onClick={()=>setSelected(isOpen?null:p)}>
          <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{p.name}</div>
                <Pill label={p.status} color={statusColor}/>
              </div>
              <div style={{fontSize:12,color:T.ink3,lineHeight:1.5}}>{p.description?.slice(0,100)}{p.description?.length>100?"…":""}</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:14,fontWeight:700,color:T.ink}}>{fmt(p.budget)}</div>
              <div style={{fontSize:11,color:pct>90?"#ef4444":"#6b7280"}}>{pct}% spent</div>
            </div>
          </div>
          <div style={{marginTop:10,height:4,background:T.bg3,borderRadius:99}}>
            <div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:pct>90?"#ef4444":pct>70?"#f59e0b":"#10b981",borderRadius:99}}/>
          </div>
          <div style={{display:"flex",gap:16,marginTop:10}}>
            <span style={{fontSize:11,color:T.ink3}}>{p.participant_count} participants</span>
            {staff.length>0&&<span style={{fontSize:11,color:T.ink3}}>Staff: {staff.join(", ")}</span>}
            {grants.length>0&&<span style={{fontSize:11,color:"#8b5cf6"}}>{fmt(totalAllocated)} grant-funded</span>}
          </div>
          {isOpen&&<div style={{marginTop:14,paddingTop:14,borderTop:"1px solid "+T.bg3}}>
            {p.outcomes&&<div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Outcomes</div>
              <div style={{fontSize:13,color:T.ink3,lineHeight:1.65}}>{p.outcomes}</div>
            </div>}
            {Object.keys(metrics).length>0&&<div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Metrics</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {Object.entries(metrics).map(([k,v])=><div key={k} style={{background:T.bg3,borderRadius:8,padding:"6px 10px"}}>
                  <div style={{fontSize:10,color:T.ink3}}>{k.replace(/_/g," ")}</div>
                  <div style={{fontSize:13,color:T.ink,fontWeight:600}}>{String(v)}</div>
                </div>)}
              </div>
            </div>}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Grant Funding</div>
              {grants.map(g=><div key={g.grant_id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid "+T.bg2,fontSize:12}}>
                <span style={{color:T.ink}}>{g.funder} — {g.program_name}</span>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{color:"#8b5cf6",fontWeight:600}}>{fmt(g.allocated)}</span>
                  {isAdmin&&<button onClick={e=>{e.stopPropagation();removeGrantLink(p.id,g.grant_id);}} style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14,lineHeight:1}}>×</button>}
                </div>
              </div>)}
              {isAdmin&&linkGrant.programId!==p.id&&<button onClick={e=>{e.stopPropagation();setLinkGrant({programId:p.id,grantId:"",allocated:""});}}
                style={{marginTop:8,background:"transparent",border:"1px dashed "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>+ Link Grant</button>}
              {isAdmin&&linkGrant.programId===p.id&&<div style={{display:"flex",gap:8,marginTop:8,alignItems:"flex-end"}} onClick={e=>e.stopPropagation()}>
                <select value={linkGrant.grantId} onChange={e=>setLinkGrant(l=>({...l,grantId:e.target.value}))}
                  style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:12}}>
                  <option value="">Select grant…</option>
                  {data.grants.map(g=><option key={g.id} value={g.id}>{g.funder} — {g.program}</option>)}
                </select>
                <input type="number" placeholder="Allocated $" value={linkGrant.allocated} onChange={e=>setLinkGrant(l=>({...l,allocated:e.target.value}))}
                  style={{width:110,background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                <button onClick={()=>addGrantLink(p.id)} style={{background:"#8b5cf6",border:"none",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Link</button>
                <button onClick={e=>{e.stopPropagation();setLinkGrant({programId:null,grantId:"",allocated:""});}} style={{background:T.bg,border:"none",borderRadius:8,padding:"8px 10px",color:T.ink3,fontSize:12,cursor:"pointer"}}>✕</button>
              </div>}
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <AIBtn onClick={e=>{e.stopPropagation();getAI(p,"impact");}} loading={aiLoading===`${p.id}_impact`} label="✦ Impact Report" small/>
              <AIBtn onClick={e=>{e.stopPropagation();getAI(p,"toc");}} loading={aiLoading===`${p.id}_toc`} label="✦ Theory of Change" small/>
            </div>
            {["impact","toc"].map(t=>aiMap[`${p.id}_${t}`]?<AIPanel key={t} text={aiMap[`${p.id}_${t}`]} onClose={()=>setAiMap(m=>({...m,[`${p.id}_${t}`]:""}))}/>:null)}
          </div>}
        </Card>;
      })}
  </div>;
}

// ── Annual Fund Dashboard ──────────────────────────────────────────────────
function AnnualFund({data}) {
  const {auth}=useAuth(); const isAdmin=auth?.user?.role==="admin";
  const currentYear=new Date().getFullYear();
  const [year,setYear]=useState(currentYear); const [fund,setFund]=useState(null); const [loading,setLoading]=useState(true);
  const [editGoal,setEditGoal]=useState(false); const [goalInput,setGoalInput]=useState("");
  const [aiText,setAiText]=useState(""); const [aiLoading,setAiLoading]=useState(false);

  const load=async(y=year)=>{setLoading(true);try{setFund(await apiFetch(`/annual-fund?year=${y}`));}catch{}setLoading(false);};
  useEffect(()=>{load();},[]);

  const saveGoal=async()=>{
    try{await apiFetch("/annual-fund/goal",{method:"POST",body:JSON.stringify({year,goal:parseInt(goalInput)||0})});
      await load();setEditGoal(false);}
    catch(e){alert(e.message);}
  };

  const getForecast=async()=>{
    setAiLoading(true);setAiText("");
    await askClaude(`You are a nonprofit development strategist. Data-driven, actionable. Max 250 words.`,
      `Annual fund forecast and strategy for ${data.org.name}.\n\nYear: ${year}\nGoal: ${fund?.goal?fmtFull(fund.goal):"not set"}\nRaised so far: ${fmtFull(fund?.totalRaised||0)}\nGoal progress: ${fund?.goalPct||0}%\nProjected year-end: ${fmtFull(fund?.projectedTotal||0)}\nDonors this year: ${fund?.donors?.total||0} (${fund?.donors?.acquired||0} new, ${fund?.donors?.retained||0} retained)\nRetention rate: ${fund?.donors?.retentionRate||0}%\nAvg gift: ${fmtFull(fund?.avgGift||0)}\nRecovered lapsed donors: ${fund?.recovered||0}\nMonthly: ${(fund?.monthly||[]).map(m=>`${m.month}: ${fmt(m.raised)}`).join(", ")}\n\nProvide:\n1. Forecast — will we hit goal? What's the gap?\n2. Top 2-3 strategies to close any gap before year-end\n3. What the retention rate signals\n4. One bold move to consider`,
      chunk=>setAiText(chunk));
    setAiLoading(false);
  };

  const maxMonth=Math.max(...(fund?.monthly||[{raised:1}]).map(m=>m.raised),1);

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Annual" accent="fund."/>
    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{display:"flex",gap:6}}>
        {[currentYear-1,currentYear].map(y2=><button key={y2} onClick={()=>{setYear(y2);load(y2);}}
          style={{background:year===y2?"#10b981":"transparent",border:year===y2?"none":"1px solid #374151",borderRadius:8,padding:"7px 14px",color:year===y2?"#fff":T.ink3,fontSize:12,fontWeight:year===y2?700:400,cursor:"pointer"}}>{y2}</button>)}
      </div>
      <AIBtn onClick={getForecast} loading={aiLoading} label="✦ AI Forecast" small/>
      {isAdmin&&<button onClick={()=>{setEditGoal(!editGoal);setGoalInput(fund?.goal?.toString()||"");}}
        style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>⚙ Set Goal</button>}
    </div>

    {editGoal&&isAdmin&&<Card style={{display:"flex",gap:10,alignItems:"flex-end"}}>
      <div style={{display:"flex",flexDirection:"column",gap:4,flex:1}}>
        <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Annual Fund Goal {year}</label>
        <input type="number" value={goalInput} onChange={e=>setGoalInput(e.target.value)} placeholder="250000"
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
      </div>
      <button onClick={saveGoal} style={{background:"#10b981",border:"none",borderRadius:8,padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save</button>
      <button onClick={()=>setEditGoal(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"10px 12px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
    </Card>}

    {(aiLoading||aiText)&&<AIPanel text={aiText} onClose={()=>setAiText("")}/>}

    {loading?<div style={{color:T.ink3,fontSize:13,textAlign:"center",padding:60}}>Loading annual fund data…</div>:!fund?null:<>
      <Card>
        <div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.ink3,marginBottom:8}}>{year} Annual Fund</div>
            <div style={{fontSize:38,fontWeight:800,color:T.ink,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{fmt(fund.totalRaised)}</div>
            {fund.goal>0&&<div style={{fontSize:13,color:T.ink3,marginTop:4}}>of {fmtFull(fund.goal)} goal · {fund.goalPct}% raised</div>}
            {fund.projectedTotal>0&&year===currentYear&&fund.projectedTotal!==fund.totalRaised&&
              <div style={{fontSize:12,color:"#8b5cf6",marginTop:4}}>Projected year-end: {fmt(fund.projectedTotal)}</div>}
          </div>
          {fund.goal>0&&<div style={{flexShrink:0}}>
            <svg width="88" height="88" viewBox="0 0 88 88">
              <circle cx="44" cy="44" r="36" fill="none" stroke="#e8e4db" strokeWidth="9"/>
              <circle cx="44" cy="44" r="36" fill="none" stroke="#10b981" strokeWidth="9"
                strokeDasharray={`${Math.min(fund.goalPct,100)*2.262} 226.2`}
                strokeDashoffset="56.6" strokeLinecap="round" transform="rotate(-90 44 44)"/>
              <text x="44" y="50" textAnchor="middle" fill={T.ink} fontSize="15" fontWeight="800" fontFamily="sans-serif">{fund.goalPct}%</text>
            </svg>
          </div>}
        </div>
        {fund.goal>0&&<div style={{marginTop:14,height:6,background:T.bg3,borderRadius:99}}>
          <div style={{height:"100%",width:`${Math.min(fund.goalPct,100)}%`,background:fund.goalPct>=100?"#10b981":fund.goalPct>=60?"#f59e0b":"#ef4444",borderRadius:99,transition:"width 0.5s"}}/>
        </div>}
      </Card>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10}}>
        <MetricCard label="Total Gifts" value={fund.giftCount} sub={`avg ${fmt(fund.avgGift)}`} color="#10b981"/>
        <MetricCard label="Total Donors" value={fund.donors.total} sub={`${fund.donors.acquired} new · ${fund.donors.retained} renewed`} color="#3b82f6"/>
        <MetricCard label="Retention Rate" value={`${fund.donors.retentionRate}%`} sub="vs prior year" color={fund.donors.retentionRate>=70?"#10b981":fund.donors.retentionRate>=50?"#f59e0b":"#ef4444"}/>
        <MetricCard label="Avg Gift" value={fmt(fund.avgGift)} color="#8b5cf6"/>
        {fund.recovered>0&&<MetricCard label="Lapsed Recovered" value={fund.recovered} sub="gave again this year" color="#f59e0b"/>}
        {fund.projectedTotal>0&&year===currentYear&&<MetricCard label="Year-End Proj." value={fmt(fund.projectedTotal)} sub="at current pace" color="#6b7280"/>}
      </div>

      <Card>
        <SectionLabel>Monthly Revenue — {year}</SectionLabel>
        <div style={{display:"flex",alignItems:"flex-end",gap:4,height:140}}>
          {fund.monthly.map(m=>{
            const h=maxMonth>0?Math.round(m.raised/maxMonth*120):0;
            return <div key={m.month} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <div style={{fontSize:9,color:T.ink3}}>{m.raised>0?fmt(m.raised):""}</div>
              <div style={{width:"100%",height:h,background:m.raised>0?"linear-gradient(180deg,#10b981,#059669)":T.bg2,borderRadius:"4px 4px 0 0",minHeight:3}}/>
              <div style={{fontSize:9,color:T.ink3}}>{m.month.slice(0,3)}</div>
            </div>;
          })}
        </div>
      </Card>

      <Card>
        <SectionLabel>Donor Acquisition vs Retention</SectionLabel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:14}}>
          <div>
            <div style={{fontSize:28,fontWeight:800,color:"#3b82f6",fontFamily:"'DM Serif Display',serif"}}>{fund.donors.acquired}</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:2}}>New donors</div>
            <div style={{fontSize:11,color:T.ink3,marginTop:6,lineHeight:1.5}}>First-time givers who didn't donate in {year-1}.</div>
          </div>
          <div>
            <div style={{fontSize:28,fontWeight:800,color:"#10b981",fontFamily:"'DM Serif Display',serif"}}>{fund.donors.retained}</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:2}}>Renewed donors</div>
            <div style={{fontSize:11,color:T.ink3,marginTop:6,lineHeight:1.5}}>Gave in both {year-1} and {year}. Rate: {fund.donors.retentionRate}%</div>
          </div>
        </div>
        <div style={{height:6,background:T.bg3,borderRadius:99,display:"flex",overflow:"hidden"}}>
          <div style={{width:`${fund.donors.total>0?Math.round(fund.donors.retained/fund.donors.total*100):0}%`,background:"#10b981"}}/>
          <div style={{flex:1,background:"#3b82f6"}}/>
        </div>
        <div style={{display:"flex",gap:12,marginTop:8}}>
          <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:T.ink3}}><div style={{width:10,height:10,background:"#10b981",borderRadius:2}}/>Retained</div>
          <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:T.ink3}}><div style={{width:10,height:10,background:"#3b82f6",borderRadius:2}}/>New</div>
        </div>
      </Card>
    </>}
  </div>;
}

// ── Settings ───────────────────────────────────────────────────────────────
function Settings({auth,logout}) {
  const orgName=auth?.org?.name||"Your Organization";
  const userName=auth?.user?.name||"User";
  const userEmail=auth?.user?.email||"";
  const userRole=auth?.user?.role||"staff";
  const isAdmin=userRole==="admin";
  const plan=auth?.org?.plan||"seed";
  const PLANS=[
    {id:"seed",label:"Seed",price:"Free",features:["Up to 50 donors","3 staff seats","AI features","Email campaigns"],current:plan==="seed"},
    {id:"growth",label:"Growth",price:"$99/mo",features:["Unlimited donors","10 staff seats","Priority AI","Advanced analytics","Phone support"],current:plan==="growth"},
    {id:"impact",label:"Impact",price:"$299/mo",features:["Unlimited everything","Unlimited seats","Dedicated success manager","Custom integrations","SLA support"],current:plan==="impact"},
  ];

  const [team,setTeam]=useState([]);
  const [showInvite,setShowInvite]=useState(false);
  const [invEmail,setInvEmail]=useState("");
  const [invRole,setInvRole]=useState("staff");
  const [inviting,setInviting]=useState(false);
  const [inviteResult,setInviteResult]=useState(null); // {link,emailSent} or null
  const [invErr,setInvErr]=useState("");
  const [copied,setCopied]=useState(false);

  useEffect(()=>{
    apiFetch("/org/team").then(setTeam).catch(()=>{});
  },[]);

  async function sendInvite(){
    if(!invEmail.trim()){setInvErr("Email required");return;}
    setInviting(true);setInvErr("");
    try{
      const r=await apiFetch("/auth/invite",{method:"POST",body:JSON.stringify({email:invEmail.trim(),role:invRole})});
      setInviteResult({link:r.inviteLink,emailSent:r.emailSent});
    }catch(e){
      setInvErr(e.message||"Failed to send invite");
    }finally{setInviting(false);}
  }

  function closeInvite(){
    setShowInvite(false);setInvEmail("");setInvRole("staff");
    setInviting(false);setInviteResult(null);setInvErr("");setCopied(false);
  }

  function copyLink(){
    if(!inviteResult?.link)return;
    navigator.clipboard.writeText(inviteResult.link).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <PageTitle main="Workspace" accent="settings."/>
      {/* Account */}
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Your Account</SectionLabel>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}>
          <div style={{width:52,height:52,borderRadius:"50%",background:T.green+"18",border:"2px solid "+T.green+"40",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:T.green,flexShrink:0}}>
            {(userName[0]||"U").toUpperCase()}
          </div>
          <div>
            <div style={{fontSize:18,fontWeight:700,color:T.ink,letterSpacing:"-0.01em"}}>{userName}</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>{userEmail}</div>
            <div style={{marginTop:6}}><Pill label={userRole} color={userRole==="admin"?T.greenDk:"#6b7280"}/></div>
          </div>
        </div>
        <div style={{background:T.bg,borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Organization</div>
          <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{orgName}</div>
          {auth?.org?.mission&&<div style={{fontSize:12,color:T.ink3,marginTop:4,lineHeight:1.5}}>{auth.org.mission}</div>}
        </div>
      </div>
      {/* Billing */}
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Billing & Plan</SectionLabel>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
          {PLANS.map(p=>(
            <div key={p.id} style={{border:`2px solid ${p.current?T.green:T.bg3}`,borderRadius:14,padding:"20px",background:p.current?T.green+"08":T.white,position:"relative"}}>
              {p.current&&<div style={{position:"absolute",top:-10,left:16,background:T.green,color:"#fff",fontSize:10,fontWeight:700,letterSpacing:"0.05em",padding:"2px 10px",borderRadius:99,textTransform:"uppercase"}}>Current</div>}
              <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:4}}>{p.label}</div>
              <div style={{fontSize:22,fontWeight:800,color:T.green,fontFamily:"'DM Serif Display',serif",marginBottom:14}}>{p.price}</div>
              {p.features.map(f=>(
                <div key={f} style={{fontSize:12,color:T.ink3,marginBottom:5,display:"flex",gap:6,alignItems:"flex-start"}}>
                  <span style={{color:T.green,flexShrink:0,marginTop:1}}>✓</span>{f}
                </div>
              ))}
              {!p.current&&<button style={{marginTop:14,width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px",color:T.ink2,fontSize:12,fontWeight:600,cursor:"pointer"}}>Upgrade →</button>}
            </div>
          ))}
        </div>
      </div>
      {/* Team */}
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <SectionLabel>Team Members</SectionLabel>
          {isAdmin&&<button onClick={()=>setShowInvite(true)} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Invite Staff</button>}
        </div>
        {team.map((m,i)=>(
          <div key={m.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:i<team.length-1?"1px solid "+T.bg3:"none"}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:T.green+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:T.green,flexShrink:0}}>
              {(m.name?.[0]||"U").toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{m.name}{m.id===auth?.user?.id&&<span style={{fontSize:11,color:T.ink3,marginLeft:6}}>(you)</span>}</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.email}</div>
            </div>
            <Pill label={m.role} color={m.role==="admin"?T.greenDk:"#6b7280"}/>
          </div>
        ))}
        {team.length===0&&<div style={{fontSize:13,color:T.ink3}}>Loading…</div>}
      </div>
      {/* Danger zone */}
      <div style={{background:T.white,border:"1px solid #fecaca",borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Account Actions</SectionLabel>
        <button onClick={logout} style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"9px 18px",color:"#dc2626",fontSize:13,fontWeight:600,cursor:"pointer"}}>
          Sign out of Steward
        </button>
      </div>

      {/* Invite modal */}
      {showInvite&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)closeInvite();}}>
          <div style={{background:T.white,borderRadius:20,padding:"32px 28px",width:420,maxWidth:"calc(100vw - 32px)",boxShadow:"0 8px 40px rgba(0,0,0,0.16)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:700,color:T.ink}}>Invite a team member</div>
              <button onClick={closeInvite} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3,lineHeight:1}}>×</button>
            </div>

            {!inviteResult?(
              <>
                <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Email address</div>
                <input value={invEmail} onChange={e=>setInvEmail(e.target.value)}
                  placeholder="staff@yourorg.org"
                  style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:12}}
                  onKeyDown={e=>e.key==="Enter"&&sendInvite()}
                />
                <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Role</div>
                <select value={invRole} onChange={e=>setInvRole(e.target.value)}
                  style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:16}}>
                  <option value="staff">Staff — can view and edit data</option>
                  <option value="admin">Admin — full access including settings</option>
                </select>
                {invErr&&<div style={{marginBottom:12,fontSize:13,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px"}}>{invErr}</div>}
                <div style={{display:"flex",gap:10}}>
                  <button onClick={closeInvite} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                  <button onClick={sendInvite} disabled={inviting} style={{flex:2,background:T.green,border:"none",borderRadius:10,padding:"10px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:inviting?0.7:1}}>
                    {inviting?"Generating invite…":"Generate invite link"}
                  </button>
                </div>
              </>
            ):(
              <>
                <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:12,padding:"14px 16px",marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#166534",marginBottom:4}}>
                    {inviteResult.emailSent?"Invite sent! You can also share the link below:":"Share this invite link:"}
                  </div>
                  <div style={{fontSize:12,color:"#15803d",wordBreak:"break-all",lineHeight:1.5}}>{inviteResult.link}</div>
                </div>
                {!inviteResult.emailSent&&<div style={{fontSize:12,color:T.ink3,marginBottom:14,lineHeight:1.5}}>
                  SMTP not configured — copy and share this link directly. It expires in 7 days.
                </div>}
                <div style={{display:"flex",gap:10}}>
                  <button onClick={copyLink} style={{flex:1,background:copied?T.green:T.bg,border:"1px solid "+(copied?T.green:T.bg3),borderRadius:10,padding:"10px",color:copied?"#fff":T.ink2,fontSize:13,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>
                    {copied?"Copied!":"Copy link"}
                  </button>
                  <button onClick={closeInvite} style={{flex:1,background:T.green,border:"none",borderRadius:10,padding:"10px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Root Router ────────────────────────────────────────────────────────────
export default function App() {
  if (typeof window !== 'undefined') {
    console.log('APP LOADED', localStorage.getItem('npe_token'));
  }
  return <AppShell />;
}

// ── App Shell ──────────────────────────────────────────────────────────────
const TABS=[
  {id:"dashboard",label:"Dashboard",icon:"◈"},
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"grants",label:"Grants",icon:"◉"},
  {id:"findgrants",label:"Find Grants",icon:"✦"},
  {id:"communications",label:"Communications",icon:"◑"},
  {id:"programs",label:"Programs",icon:"◐"},
  {id:"annualfund",label:"Annual Fund",icon:"◒"},
  {id:"volunteers",label:"Volunteers",icon:"◎"},
  {id:"board",label:"Board",icon:"◆"},
  {id:"finance",label:"Finance",icon:"◇"},
  {id:"tasks",label:"Tasks",icon:"◻"},
  {id:"settings",label:"Settings",icon:"⚙"},
];

function AppShell() {
  const { auth, logout } = useAuth();
  const [tab,setTab]=useState("dashboard");
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [loadErr,setLoadErr]=useState("");
  const [showChat,setShowChat]=useState(false);

  useEffect(()=>{
    (async()=>{
      try {
        const [org,donors,grants,volunteers,tasks,board,financials] = await Promise.all([
          apiFetch("/org"),
          apiFetch("/donors"),
          apiFetch("/grants"),
          apiFetch("/volunteers"),
          apiFetch("/tasks"),
          apiFetch("/board"),
          apiFetch("/financials"),
        ]);
        setData(adaptData({org,donors,grants,volunteers,tasks,board,financials}));
      } catch(e) { setLoadErr(e.message); }
      setLoading(false);
    })();
  },[]);

  const BASE = {minHeight:"100vh",background:T.bg,fontFamily:"'DM Sans',system-ui,sans-serif"};

  if(loading) return <div style={{...BASE,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
    <div style={{width:40,height:40,background:T.green,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#fff" strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2" fill="#fff"/></svg>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:10,color:T.ink3,fontSize:13}}><span style={{display:"inline-block",width:14,height:14,border:"2px solid "+T.bg3,borderTopColor:T.green,borderRadius:"50%",animation:"sp 0.7s linear infinite"}}/>Loading your workspace…</div>
  </div>;

  if(loadErr||!data) return <div style={{...BASE,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
    <div style={{fontSize:32,opacity:0.2,color:T.ink}}>◈</div>
    <div style={{fontSize:15,fontWeight:700,color:"#dc2626"}}>Failed to connect</div>
    <div style={{fontSize:13,color:T.ink3,maxWidth:300,textAlign:"center"}}>{loadErr||"Could not load your workspace. Check your connection and try again."}</div>
    <button onClick={()=>window.location.reload()} style={{marginTop:4,background:T.green,border:"none",borderRadius:10,padding:"9px 20px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Retry</button>
  </div>;

  const tasksDue=data.tasks.filter(t=>!t.done&&t.priority==="high").length;
  const orgName=auth?.org?.name||data.org?.name||"Steward";
  const orgInitial=(orgName[0]||"S").toUpperCase();

  return <div style={{...BASE,color:T.ink,display:"flex",flexDirection:"column"}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

    {/* Header */}
    <div style={{borderBottom:"1px solid "+T.bg3,padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",background:T.bg,position:"sticky",top:0,zIndex:100,height:56}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:32,height:32,background:T.green,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#fff" strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2" fill="#fff"/></svg>
        </div>
        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span style={{fontSize:15,fontWeight:700,color:T.ink,letterSpacing:"-0.02em"}}>{orgName}</span>
          <span style={{fontSize:10,color:T.ink3,letterSpacing:"0.06em",textTransform:"uppercase"}}>Steward</span>
        </div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <button onClick={()=>setShowChat(true)} style={{background:T.green,border:"none",borderRadius:10,padding:"7px 16px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:7}}>
          ✦ Ask AI
        </button>
        <div style={{width:30,height:30,borderRadius:8,background:auth?.user?.role==="admin"?T.green+"18":T.bg2,border:`1px solid ${auth?.user?.role==="admin"?T.green+"40":T.bg3}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <span style={{fontSize:12,fontWeight:700,color:auth?.user?.role==="admin"?T.greenDk:T.ink3}}>{(auth?.user?.name||"U")[0].toUpperCase()}</span>
        </div>
        <button onClick={logout} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>
          Sign out
        </button>
      </div>
    </div>

    {/* Tab bar */}
    <div style={{display:"flex",padding:"0 20px",borderBottom:"1px solid "+T.bg3,overflowX:"auto",flexShrink:0,background:T.bg}}>
      {TABS.map(t=>{
        const active=tab===t.id;
        return <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"transparent",border:"none",borderBottom:`2px solid ${active?T.green:"transparent"}`,padding:"12px 14px",color:active?T.green:T.ink3,fontSize:13,fontWeight:active?700:500,cursor:"pointer",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",transition:"color 0.15s,border-color 0.15s",flexShrink:0,marginBottom:-1}}>
          <span style={{fontSize:11,opacity:active?1:0.5}}>{t.icon}</span>
          {t.label}
          {t.id==="tasks"&&tasksDue>0&&<span style={{background:"#ef4444",color:"#fff",fontSize:9,fontWeight:800,borderRadius:99,padding:"1px 5px",lineHeight:"14px"}}>{tasksDue}</span>}
        </button>;
      })}
    </div>

    <div style={{flex:1,padding:"28px 24px",maxWidth:1400,width:"100%",margin:"0 auto",boxSizing:"border-box"}}>
      {tab==="dashboard"&&<Dashboard data={data} setData={setData} onNavigate={setTab}/>}
      {tab==="donors"&&<Donors data={data} setData={setData}/>}
      {tab==="grants"&&<Grants data={data} setData={setData}/>}
      {tab==="findgrants"&&<FindGrants data={data}/>}
      {tab==="communications"&&<Communications data={data}/>}
      {tab==="programs"&&<Programs data={data}/>}
      {tab==="annualfund"&&<AnnualFund data={data}/>}
      {tab==="volunteers"&&<Volunteers data={data}/>}
      {tab==="board"&&<Board data={data}/>}
      {tab==="finance"&&<Finance data={data}/>}
      {tab==="tasks"&&<Tasks data={data} setData={setData}/>}
      {tab==="settings"&&<Settings auth={auth} logout={logout}/>}
    </div>
    {showChat&&<AIChat data={data} onClose={()=>setShowChat(false)}/>}
  </div>;
}
