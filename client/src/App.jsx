import { useState, useEffect, useRef } from "react";
import { apiFetch, streamAI, adaptData } from "./api";
import { useAuth } from "./main";

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

// ── UI Atoms ───────────────────────────────────────────────────────────────
function Pill({label,color}) {
  return <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",padding:"2px 8px",borderRadius:99,background:(color||"#6b7280")+"22",color:color||"#6b7280",whiteSpace:"nowrap"}}>{label}</span>;
}
function Card({children,selected,accent,onClick,style={}}) {
  return <div onClick={onClick} style={{background:"#111827",border:`1px solid ${selected?accent||"#10b981":"#1f2937"}`,borderRadius:14,padding:"16px 20px",cursor:onClick?"pointer":"default",transition:"border-color 0.15s",...style}}>{children}</div>;
}
function SectionLabel({children}) {
  return <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#6b7280",marginBottom:14}}>{children}</div>;
}
function AIBtn({onClick,loading,label="✦ AI Assist",small}) {
  return <button onClick={onClick} disabled={loading} style={{background:loading?"#1f2937":"linear-gradient(135deg,#7c3aed,#3b82f6)",border:"none",borderRadius:small?8:10,padding:small?"7px 12px":"9px 16px",color:"#fff",fontSize:small?12:13,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:loading?0.7:1,whiteSpace:"nowrap"}}>
    {loading?<><Spin/>Thinking…</>:label}
  </button>;
}
function Spin() {
  return <><style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style><span style={{display:"inline-block",width:11,height:11,border:"2px solid #fff4",borderTopColor:"#fff",borderRadius:"50%",animation:"sp 0.7s linear infinite"}}/></>;
}
function AIPanel({text,onClose}) {
  if(!text) return null;
  return <div style={{background:"linear-gradient(135deg,#1a0f3c,#0f172a)",border:"1px solid #7c3aed44",borderRadius:14,padding:20,position:"relative",marginTop:12}}>
    <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#8b5cf6",marginBottom:10}}>✦ AI Intelligence</div>
    <div style={{fontSize:13,color:"#e2e8f0",lineHeight:1.75,whiteSpace:"pre-wrap"}}>{text}</div>
    {onClose&&<button onClick={onClose} style={{position:"absolute",top:10,right:12,background:"transparent",border:"none",color:"#6b7280",cursor:"pointer",fontSize:18,lineHeight:1}}>×</button>}
  </div>;
}
function MetricCard({label,value,sub,color,trend}) {
  return <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:"18px 22px",display:"flex",flexDirection:"column",gap:6}}>
    <span style={{fontSize:11,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#6b7280"}}>{label}</span>
    <span style={{fontSize:26,fontWeight:800,color:color||"#f9fafb",fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{value}</span>
    {sub&&<span style={{fontSize:11,color:"#9ca3af"}}>{sub}</span>}
    {trend!==undefined&&<span style={{fontSize:11,color:trend>=0?"#10b981":"#ef4444"}}>{trend>=0?"↑":"↓"} {Math.abs(trend)}% vs last month</span>}
  </div>;
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
    <div style={{background:"#0a0f1e",border:"1px solid #7c3aed44",borderRadius:20,width:"100%",maxWidth:540,height:640,display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 25px 80px #7c3aed22"}}>
      <div style={{padding:"14px 18px",borderBottom:"1px solid #1f2937",display:"flex",alignItems:"center",justifyContent:"space-between",background:"linear-gradient(135deg,#1a0f3c,#0f172a)"}}>
        <div><div style={{fontSize:14,fontWeight:800,color:"#f3f4f6"}}>✦ Development Intelligence</div><div style={{fontSize:11,color:"#7c3aed"}}>Knows your full org in real time</div></div>
        <button onClick={onClose} style={{background:"#1f2937",border:"none",borderRadius:8,padding:"6px 12px",color:"#9ca3af",cursor:"pointer",fontSize:12}}>Close</button>
      </div>
      <div style={{display:"flex",gap:6,padding:"10px 14px",borderBottom:"1px solid #1f2937",overflowX:"auto",flexShrink:0}}>
        {QUICK.map(q=><button key={q} onClick={()=>send(q)} style={{background:"#1f2937",border:"1px solid #374151",borderRadius:20,padding:"5px 12px",color:"#9ca3af",fontSize:11,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{q}</button>)}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:14,display:"flex",flexDirection:"column",gap:10}}>
        {msgs.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
          <div style={{maxWidth:"88%",background:m.role==="user"?"#7c3aed":"#1e293b",borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",padding:"10px 14px",fontSize:13,color:"#f3f4f6",lineHeight:1.65,whiteSpace:"pre-wrap"}}>
            {m.content||(loading&&i===msgs.length-1?<span style={{color:"#7c3aed"}}>▋</span>:"")}
          </div>
        </div>)}
        <div ref={bottomRef}/>
      </div>
      <div style={{padding:12,borderTop:"1px solid #1f2937",display:"flex",gap:8}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ask anything about your org…" style={{flex:1,background:"#1e293b",border:"1px solid #374151",borderRadius:10,padding:"10px 14px",color:"#f3f4f6",fontSize:13,outline:"none"}}/>
        <button onClick={()=>send()} disabled={loading||!input.trim()} style={{background:"#7c3aed",border:"none",borderRadius:10,padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:loading||!input.trim()?0.5:1}}>↑</button>
      </div>
    </div>
  </div>;
}

// ── Daily Briefing ─────────────────────────────────────────────────────────
function DailyBriefing({data}) {
  const [brief,setBrief]=useState(""); const [loading,setLoading]=useState(false); const [open,setOpen]=useState(false);
  const generate = async () => {
    setLoading(true); setBrief(""); setOpen(true);
    const today = new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
    await askClaude(
      `You are a chief development officer. Write a crisp daily briefing. Use bullet points. Be specific with names and numbers. Max 250 words.`,
      `Generate today's development briefing for ${data.org.name}.\nToday: ${today}\n\n${buildContext(data)}\n\nFormat:\n**TODAY'S PRIORITY CALLS** (top 2-3 donors to contact with specific reason)\n**GRANT ALERTS** (anything urgent in next 30 days)\n**FINANCIAL PULSE** (1-2 sentences on cash/revenue)\n**ONE THING** (the single most important action today)\n\nBe sharp and specific.`,
      chunk=>setBrief(chunk)
    );
    setLoading(false);
  };
  return <div>
    <div style={{display:"flex",gap:10,alignItems:"center"}}>
      <AIBtn onClick={generate} loading={loading} label="✦ Generate Daily Briefing"/>
      {brief&&!loading&&<button onClick={()=>setOpen(!open)} style={{background:"transparent",border:"1px solid #374151",borderRadius:10,padding:"9px 14px",color:"#6b7280",fontSize:12,cursor:"pointer"}}>{open?"Hide":"Show"}</button>}
    </div>
    {open&&(loading||brief)&&<AIPanel text={brief} onClose={()=>{setBrief("");setOpen(false);}}/>}
  </div>;
}

// ── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({data}) {
  const rev=data.financials.revenue; const exp=data.financials.expenses;
  const monthlyRev=rev.map(r=>r.individual+r.grants+r.events+r.other);
  const monthlyExp=exp.map(e=>e.programs+e.admin+e.fundraising);
  const ytdRev=monthlyRev.reduce((a,b)=>a+b,0); const ytdExp=monthlyExp.reduce((a,b)=>a+b,0);
  const activeGrants=data.grants.filter(g=>g.status==="active").reduce((s,g)=>s+g.amount,0);
  const pipeline=data.grants.filter(g=>["pending","prospecting"].includes(g.status)).reduce((s,g)=>s+g.amount,0);
  const lapsed=data.donors.filter(d=>d.status==="lapsed").length;
  const urgentTasks=data.tasks.filter(t=>!t.done&&t.priority==="high");
  const maxBar=Math.max(...monthlyRev,...monthlyExp);
  const totalFunds=data.financials.funds.reduce((s,f)=>s+f.balance,0);
  const topDonors=[...data.donors].sort((a,b)=>b.total-a.total).slice(0,3);

  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <DailyBriefing data={data}/>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
      <MetricCard label="YTD Revenue" value={fmt(ytdRev)} sub={`${((ytdRev/ytdExp)*100).toFixed(0)}% expense ratio`} color="#10b981" trend={8}/>
      <MetricCard label="Cash on Hand" value={fmt(totalFunds)} sub={`${data.financials.funds.filter(f=>f.restricted).length} restricted funds`} color="#3b82f6"/>
      <MetricCard label="Active Grants" value={fmt(activeGrants)} sub="contracted" color="#8b5cf6"/>
      <MetricCard label="Grant Pipeline" value={fmt(pipeline)} sub="pending + prospecting" color="#f59e0b"/>
      <MetricCard label="Lapsed Donors" value={lapsed} sub="need re-engagement" color="#ef4444" trend={-5}/>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:14}}>
      <Card>
        <SectionLabel>Revenue vs. Expenses — YTD</SectionLabel>
        <div style={{display:"flex",gap:3,alignItems:"flex-end",height:90}}>
          {rev.map((r,i)=>{
            const rv=r.individual+r.grants+r.events+r.other;
            const ex=exp[i].programs+exp[i].admin+exp[i].fundraising;
            return <div key={r.month} style={{flex:1,display:"flex",gap:2,alignItems:"flex-end"}}>
              <div style={{flex:1,height:`${(rv/maxBar)*90}px`,background:"#10b981",borderRadius:"3px 3px 0 0",opacity:0.85}} title={fmtFull(rv)}/>
              <div style={{flex:1,height:`${(ex/maxBar)*90}px`,background:"#ef4444",borderRadius:"3px 3px 0 0",opacity:0.65}} title={fmtFull(ex)}/>
            </div>;
          })}
        </div>
        <div style={{display:"flex",gap:3,marginTop:6}}>
          {rev.map(r=><div key={r.month} style={{flex:1,textAlign:"center",fontSize:10,color:"#6b7280"}}>{r.month}</div>)}
        </div>
        <div style={{display:"flex",gap:14,marginTop:10}}>
          {[["#10b981","Revenue"],["#ef4444","Expenses"]].map(([c,l])=><div key={l} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:c}}/><span style={{fontSize:11,color:"#9ca3af"}}>{l}</span></div>)}
        </div>
      </Card>

      <Card>
        <SectionLabel>Top Donors by Lifetime</SectionLabel>
        {topDonors.map((d,i)=>{
          const sc=donorScore(d);
          return <div key={d.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:i<2?"1px solid #1f2937":""}}>
            <span style={{fontSize:18,color:"#374151",fontWeight:800,width:20}}>{i+1}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:"#f3f4f6"}}>{d.name}</div>
              <div style={{fontSize:11,color:"#6b7280"}}>{d.gifts} gifts · score {sc}</div>
            </div>
            <div style={{fontSize:15,fontWeight:800,color:SC[d.status]}}>{fmt(d.total)}</div>
          </div>;
        })}
      </Card>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <Card>
        <SectionLabel>Urgent Tasks</SectionLabel>
        {urgentTasks.length===0&&<div style={{fontSize:13,color:"#6b7280"}}>All clear 🎉</div>}
        {urgentTasks.map(t=><div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid #1f2937"}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:"#ef4444",flexShrink:0}}/>
          <div style={{flex:1}}><div style={{fontSize:13,color:"#f3f4f6",fontWeight:500}}>{t.title}</div><div style={{fontSize:11,color:"#6b7280",marginTop:1}}>Due {new Date(t.due).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div></div>
          <Pill label={t.type} color="#ef4444"/>
        </div>)}
      </Card>

      <Card>
        <SectionLabel>Grant Deadlines</SectionLabel>
        {data.grants.filter(g=>g.status!=="closed").sort((a,b)=>new Date(a.deadline)-new Date(b.deadline)).map(g=>{
          const d=daysUntil(g.deadline); const urg=d<30?"#ef4444":d<90?"#f59e0b":"#10b981";
          return <div key={g.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid #1f2937"}}>
            <div style={{width:34,height:34,borderRadius:8,background:urg+"22",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:10,fontWeight:800,color:urg}}>{d<0?"!":d+"d"}</span></div>
            <div style={{flex:1}}><div style={{fontSize:13,color:"#f3f4f6",fontWeight:500}}>{g.funder}</div><div style={{fontSize:11,color:"#6b7280"}}>{fmt(g.amount)}</div></div>
            <Pill label={g.status} color={SC[g.status]}/>
          </div>;
        })}
      </Card>
    </div>

    <Card>
      <SectionLabel>Fund Balances</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
        {data.financials.funds.map(f=><div key={f.name} style={{background:"#0f172a",borderRadius:10,padding:"12px 14px",border:`1px solid ${f.restricted?"#7c3aed44":"#1f2937"}`}}>
          <div style={{fontSize:12,color:f.restricted?"#8b5cf6":"#6b7280",fontWeight:600,marginBottom:4}}>{f.restricted?"🔒 Restricted":"Unrestricted"}</div>
          <div style={{fontSize:16,fontWeight:800,color:"#f3f4f6",fontFamily:"'DM Serif Display',serif"}}>{fmt(f.balance)}</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{f.name}</div>
        </div>)}
      </div>
    </Card>
  </div>;
}

// ── Moves Management ───────────────────────────────────────────────────────
const STAGES=[
  {id:"prospect",  label:"Prospect",  color:"#6b7280", hint:"Identified, not yet engaged"},
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
  return{days,level,urgencyColor};
}

function LogTouchpointModal({donor,onSave,onClose}){
  const[type,setType]=useState("call");const[note,setNote]=useState("");
  const[date,setDate]=useState(new Date().toISOString().split("T")[0]);
  const[loading,setLoading]=useState(false);
  const types=["call","email","meeting","event","gift","note"];
  const save=async()=>{
    if(!note.trim())return;setLoading(true);
    try{await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({type,note,date})});onSave({type,note,date});}
    catch(e){console.error(e);}setLoading(false);
  };
  const s={background:"#0a0f1e",border:"1px solid #1f2937",borderRadius:18,width:"100%",maxWidth:440,padding:24};
  const inp={width:"100%",background:"#111827",border:"1px solid #374151",borderRadius:8,padding:"9px 12px",color:"#f3f4f6",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  return(
    <div style={{position:"fixed",inset:0,background:"#000c",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={s}>
        <div style={{fontSize:16,fontWeight:800,color:"#f9fafb",marginBottom:2}}>Log Touchpoint</div>
        <div style={{fontSize:12,color:"#6b7280",marginBottom:16}}>{donor.name}</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
          {types.map(t=><button key={t} onClick={()=>setType(t)} style={{background:type===t?"#10b981":"#1f2937",border:`1px solid ${type===t?"#10b981":"#374151"}`,borderRadius:7,padding:"5px 11px",color:type===t?"#fff":"#9ca3af",fontSize:12,fontWeight:600,cursor:"pointer",textTransform:"capitalize"}}>{t}</button>)}
        </div>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{...inp,marginBottom:10}}/>
        <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="What happened? What was discussed?" rows={3} style={{...inp,resize:"vertical",lineHeight:1.5,marginBottom:14}}/>
        <div style={{display:"flex",gap:8}}>
          <button onClick={save} disabled={loading||!note.trim()} style={{flex:1,background:note.trim()?"#10b981":"#1f2937",border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:14,fontWeight:700,cursor:note.trim()?"pointer":"not-allowed"}}>{loading?"Saving…":"Save Touchpoint"}</button>
          <button onClick={onClose} style={{background:"#374151",border:"none",borderRadius:10,padding:"11px 14px",color:"#9ca3af",fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function TouchpointTimeline({interactions}){
  if(!interactions?.length)return<div style={{fontSize:13,color:"#6b7280",textAlign:"center",padding:"16px 0"}}>No touchpoints logged yet.</div>;
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
            {i<sorted.length-1&&<div style={{position:"absolute",left:11,top:24,width:2,bottom:0,background:"#1f2937"}}/>}
            <div style={{width:24,height:24,borderRadius:"50%",background:c+"22",border:`2px solid ${c}`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1,marginTop:2}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:c}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
                <span style={{fontSize:11,fontWeight:700,textTransform:"capitalize",color:c}}>{int.type}</span>
                <span style={{fontSize:11,color:"#4b5563"}}>{int.date}</span>
                <span style={{fontSize:11,color:"#374151"}}>({when})</span>
              </div>
              <div style={{fontSize:13,color:"#d1d5db",lineHeight:1.5}}>{int.note}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DonorDetailModal({donor,onClose,onStageChange,onLogTouchpoint,aiMap,loadingKey,getAI}){
  const stage=STAGES.find(s=>s.id===(donor.stage||"cultivate"))||STAGES[2];
  const sc=donorScore(donor);const scoreColor=sc>70?"#10b981":sc>45?"#f59e0b":"#ef4444";
  const urg=moveUrgency(donor);
  return(
    <div style={{position:"fixed",inset:0,background:"#000c",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0a0f1e",border:"1px solid #1f2937",borderRadius:20,width:"100%",maxWidth:580,maxHeight:"88vh",overflowY:"auto",padding:28,boxSizing:"border-box"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16}}>
          <div>
            <div style={{fontSize:22,fontWeight:800,color:"#f9fafb",letterSpacing:"-0.02em"}}>{donor.name}</div>
            <div style={{display:"flex",gap:8,alignItems:"center",marginTop:6,flexWrap:"wrap"}}>
              <span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:99,background:stage.color+"22",color:stage.color}}>{stage.label}</span>
              <span style={{fontSize:12,color:"#6b7280"}}>{fmtFull(donor.total)} lifetime · {donor.gifts} gifts</span>
              <span style={{fontSize:12,color:"#6b7280"}}>{donor.email}</span>
            </div>
          </div>
          <button onClick={onClose} style={{background:"#1f2937",border:"none",borderRadius:8,padding:"6px 12px",color:"#9ca3af",cursor:"pointer",fontSize:13,flexShrink:0}}>✕</button>
        </div>

        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Move Stage</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {STAGES.map(s=><button key={s.id} onClick={()=>onStageChange(donor.id,s.id)} style={{background:(donor.stage||"cultivate")===s.id?s.color+"22":"#111827",border:`1px solid ${(donor.stage||"cultivate")===s.id?s.color:"#374151"}`,borderRadius:8,padding:"6px 12px",color:(donor.stage||"cultivate")===s.id?s.color:"#6b7280",fontSize:12,fontWeight:600,cursor:"pointer"}}>{s.label}</button>)}
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
          {[["Last Gift",fmtFull(donor.lastAmount),donor.lastGift,"#f3f4f6"],["Last Contact",`${urg.days}d ago`,urg.level,urg.urgencyColor],["Engagement",`${sc}/99`,"score",scoreColor]].map(([l,v,s,c])=>(
            <div key={l} style={{background:"#111827",borderRadius:10,padding:"10px 12px"}}>
              <div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{l}</div>
              <div style={{fontSize:15,fontWeight:700,color:c}}>{v}</div>
              <div style={{fontSize:10,color:"#6b7280",marginTop:1,textTransform:"capitalize"}}>{s}</div>
            </div>
          ))}
        </div>

        {donor.notes&&<div style={{background:"#111827",borderRadius:10,padding:"12px 14px",fontSize:13,color:"#9ca3af",marginBottom:16,lineHeight:1.5}}>{donor.notes}</div>}

        <div style={{marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>Touchpoint Timeline</div>
            <button onClick={onLogTouchpoint} style={{background:"#10b981",border:"none",borderRadius:7,padding:"5px 12px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Log</button>
          </div>
          <TouchpointTimeline interactions={donor.interactions}/>
        </div>

        <div style={{borderTop:"1px solid #1f2937",paddingTop:14}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
            <AIBtn onClick={()=>getAI(donor,"nextmove")} loading={loadingKey===`${donor.id}_nextmove`} label="✦ Next Move" small/>
            <AIBtn onClick={()=>getAI(donor,"outreach")} loading={loadingKey===`${donor.id}_outreach`} label="✦ Outreach Strategy" small/>
            <AIBtn onClick={()=>getAI(donor,"email")} loading={loadingKey===`${donor.id}_email`} label="✦ Draft Email" small/>
            <AIBtn onClick={()=>getAI(donor,"callscript")} loading={loadingKey===`${donor.id}_callscript`} label="✦ Call Script" small/>
          </div>
          {["nextmove","outreach","email","callscript"].map(t=>aiMap[`${donor.id}_${t}`]?<AIPanel key={t} text={aiMap[`${donor.id}_${t}`]} onClose={()=>{}}/>:null)}
        </div>
      </div>
    </div>
  );
}

function DonorKanban({donors,onStageChange,onLogTouchpoint,onSelectDonor}){
  const[draggingId,setDraggingId]=useState(null);const[dragOver,setDragOver]=useState(null);
  const byStage=sid=>donors.filter(d=>(d.stage||"cultivate")===sid).sort((a,b)=>b.total-a.total);
  return(
    <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:16,minHeight:500,alignItems:"flex-start"}}>
      {STAGES.map(stage=>{
        const cols=byStage(stage.id);
        const total=cols.reduce((s,d)=>s+d.total,0);
        const isOver=dragOver===stage.id;
        return(
          <div key={stage.id} style={{flexShrink:0,width:218,display:"flex",flexDirection:"column",gap:8}}
            onDragOver={e=>{e.preventDefault();setDragOver(stage.id);}}
            onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragOver(null);}}
            onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData("donorId");if(id)onStageChange(id,stage.id);setDragOver(null);}}>
            <div style={{background:"#111827",border:`1px solid ${isOver?stage.color+"88":"#1f2937"}`,borderRadius:12,padding:"10px 12px",transition:"border-color 0.15s"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:stage.color,flexShrink:0}}/>
                <span style={{fontSize:12,fontWeight:800,color:stage.color,letterSpacing:"0.03em"}}>{stage.label}</span>
                <span style={{marginLeft:"auto",background:stage.color+"22",color:stage.color,fontSize:10,fontWeight:700,borderRadius:99,padding:"1px 6px"}}>{cols.length}</span>
              </div>
              <div style={{fontSize:11,color:"#4b5563"}}>{total>0?`${fmt(total)} lifetime`:stage.hint}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8,border:`2px dashed ${isOver?stage.color+"55":"transparent"}`,borderRadius:10,padding:isOver?4:0,transition:"all 0.15s",minHeight:60}}>
              {cols.map(d=>{
                const urg=moveUrgency(d);const sc=donorScore(d);
                const isDragging=draggingId===d.id;
                return(
                  <div key={d.id} draggable
                    onDragStart={e=>{e.dataTransfer.setData("donorId",d.id);setDraggingId(d.id);}}
                    onDragEnd={()=>{setDraggingId(null);setDragOver(null);}}
                    style={{background:"#111827",border:`1px solid ${urg.level==="critical"?"#ef444444":"#1f2937"}`,borderRadius:10,padding:"11px 12px",cursor:"grab",opacity:isDragging?0.35:1,transition:"opacity 0.15s",userSelect:"none"}}>
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:6,marginBottom:5}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#f3f4f6",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                        <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>{fmt(d.total)}</div>
                      </div>
                      <div style={{width:8,height:8,borderRadius:"50%",background:urg.urgencyColor,flexShrink:0,marginTop:3}} title={`${urg.level}: ${urg.days}d since contact`}/>
                    </div>
                    <div style={{fontSize:11,color:urg.urgencyColor,marginBottom:5}}>
                      {urg.level==="ok"?"✓ ":urg.level==="due"?"! ":"!! "}{urg.days}d since contact
                    </div>
                    <div style={{fontSize:11,color:"#6b7280",lineHeight:1.35,marginBottom:8}}>{STAGE_ACTION[stage.id]}</div>
                    <div style={{display:"flex",gap:5}}>
                      <button onClick={e=>{e.stopPropagation();onLogTouchpoint(d);}} style={{flex:1,background:"#1f2937",border:"1px solid #374151",borderRadius:6,padding:"5px 0",color:"#9ca3af",fontSize:11,fontWeight:600,cursor:"pointer"}}>+ Log</button>
                      <button onClick={e=>{e.stopPropagation();onSelectDonor(d);}} style={{flex:1,background:"#1f2937",border:"1px solid #374151",borderRadius:6,padding:"5px 0",color:"#9ca3af",fontSize:11,fontWeight:600,cursor:"pointer"}}>View →</button>
                    </div>
                  </div>
                );
              })}
              {cols.length===0&&!isOver&&<div style={{textAlign:"center",padding:"20px 8px",color:"#374151",fontSize:12,border:"1px dashed #1f2937",borderRadius:10}}>Drop here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Donors ─────────────────────────────────────────────────────────────────
function Donors({data,setData}){
  const[view,setView]=useState("kanban");
  const[search,setSearch]=useState("");
  const[selected,setSelected]=useState(null);
  const[logTarget,setLogTarget]=useState(null);
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
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {showImport&&<DonorImport onClose={()=>setShowImport(false)} onImported={()=>{reloadDonors();setShowImport(false);}}/>}
      {logTarget&&<LogTouchpointModal donor={logTarget} onSave={int=>handleLogged(logTarget,int)} onClose={()=>setLogTarget(null)}/>}
      {selected&&view==="kanban"&&<DonorDetailModal donor={selected} onClose={()=>setSelected(null)}
        onStageChange={moveToStage} onLogTouchpoint={()=>{setLogTarget(selected);}}
        aiMap={aiMap} loadingKey={loadingKey} getAI={getAI}/>}

      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search donors…" style={{flex:1,minWidth:160,background:"#111827",border:"1px solid #374151",borderRadius:10,padding:"10px 14px",color:"#f3f4f6",fontSize:13,outline:"none"}}/>
        <div style={{display:"flex",background:"#111827",border:"1px solid #1f2937",borderRadius:10,overflow:"hidden"}}>
          {[["kanban","Pipeline"],["list","List"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?"#1f2937":"transparent",border:"none",padding:"9px 14px",color:view===v?"#f3f4f6":"#6b7280",fontSize:13,fontWeight:view===v?700:400,cursor:"pointer"}}>{l}</button>
          ))}
        </div>
        <AIBtn onClick={generateCallList} loading={callLoading} label="✦ Call List"/>
        <button onClick={()=>setShowAdd(!showAdd)} style={{background:"#10b981",border:"none",borderRadius:10,padding:"10px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>+ Add</button>
        <button onClick={()=>setShowImport(true)} style={{background:"#1f2937",border:"1px solid #374151",borderRadius:10,padding:"10px 14px",color:"#9ca3af",fontSize:13,cursor:"pointer"}}>↑ Import</button>
      </div>

      {(callLoading||callList)&&<AIPanel text={callList} onClose={()=>setCallList("")}/>}

      {showAdd&&<Card style={{gap:10,display:"flex",flexDirection:"column"}}>
        <div style={{fontSize:14,fontWeight:700,color:"#f3f4f6"}}>New Donor</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {STAGES.map(s=><button key={s.id} onClick={()=>setNewDonor(p=>({...p,stage:s.id}))} style={{background:newDonor.stage===s.id?s.color+"22":"#0f172a",border:`1px solid ${newDonor.stage===s.id?s.color:"#374151"}`,borderRadius:7,padding:"5px 11px",color:newDonor.stage===s.id?s.color:"#6b7280",fontSize:12,fontWeight:600,cursor:"pointer"}}>{s.label}</button>)}
        </div>
        {[["name","Full Name"],["email","Email"],["phone","Phone"],["lastAmount","Gift Amount ($)"]].map(([k,pl])=>(
          <input key={k} value={newDonor[k]} onChange={e=>setNewDonor(p=>({...p,[k]:e.target.value}))} placeholder={pl} style={{background:"#0f172a",border:"1px solid #374151",borderRadius:8,padding:"9px 12px",color:"#f3f4f6",fontSize:13,outline:"none"}}/>
        ))}
        <div style={{display:"flex",gap:8}}>
          <button onClick={addDonor} style={{background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Save</button>
          <button onClick={()=>setShowAdd(false)} style={{background:"#374151",border:"none",borderRadius:8,padding:"9px 14px",color:"#9ca3af",fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </Card>}

      {view==="kanban"&&<DonorKanban donors={filtered} onStageChange={moveToStage} onLogTouchpoint={d=>setLogTarget(d)} onSelectDonor={d=>setSelected(d)}/>}

      {view==="list"&&filtered.map(d=>{
        const sc=donorScore(d);const scoreColor=sc>70?"#10b981":sc>45?"#f59e0b":"#ef4444";
        const urg=moveUrgency(d);const stage=STAGES.find(s=>s.id===(d.stage||"cultivate"))||STAGES[2];
        const isOpen=selected?.id===d.id;
        return(
          <Card key={d.id} selected={isOpen} accent={stage.color} onClick={()=>setSelected(isOpen?null:d)}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{position:"relative",flexShrink:0}}>
                <div style={{width:40,height:40,borderRadius:"50%",background:stage.color+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:stage.color}}>{d.name[0]}</div>
                <div style={{position:"absolute",bottom:-2,right:-2,width:14,height:14,borderRadius:"50%",background:urg.urgencyColor,border:"2px solid #111827"}}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                  <div style={{fontSize:14,fontWeight:700,color:"#f3f4f6"}}>{d.name}</div>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:99,background:stage.color+"22",color:stage.color}}>{stage.label}</span>
                </div>
                <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{urg.days}d since contact · {fmtFull(d.total)} · {d.gifts} gifts</div>
              </div>
              <button onClick={e=>{e.stopPropagation();setLogTarget(d);}} style={{background:"#1f2937",border:"1px solid #374151",borderRadius:8,padding:"7px 12px",color:"#9ca3af",fontSize:12,cursor:"pointer",flexShrink:0}}>+ Log</button>
            </div>

            {isOpen&&<div style={{marginTop:14,paddingTop:14,borderTop:"1px solid #1f2937"}}>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:10,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Move Stage</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {STAGES.map(s=><button key={s.id} onClick={e=>{e.stopPropagation();moveToStage(d.id,s.id);setSelected(prev=>({...prev,stage:s.id}));}} style={{background:(d.stage||"cultivate")===s.id?s.color+"22":"#0f172a",border:`1px solid ${(d.stage||"cultivate")===s.id?s.color:"#374151"}`,borderRadius:7,padding:"5px 11px",color:(d.stage||"cultivate")===s.id?s.color:"#6b7280",fontSize:12,fontWeight:600,cursor:"pointer"}}>{s.label}</button>)}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
                <div><div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>Last Gift</div><div style={{fontSize:13,color:"#f3f4f6",marginTop:3}}>{fmtFull(d.lastAmount)}</div></div>
                <div><div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>Contact</div><div style={{fontSize:13,color:urg.urgencyColor,marginTop:3,fontWeight:600,textTransform:"capitalize"}}>{urg.level} ({urg.days}d)</div></div>
                <div><div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>Engagement</div><div style={{fontSize:13,color:scoreColor,marginTop:3,fontWeight:700}}>{sc}/99</div></div>
              </div>
              {d.notes&&<div style={{background:"#0f172a",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#9ca3af",marginBottom:14,lineHeight:1.5}}>{d.notes}</div>}
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Touchpoint Timeline</div>
                <TouchpointTimeline interactions={d.interactions}/>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <AIBtn onClick={e=>{e.stopPropagation();getAI(d,"nextmove");}} loading={loadingKey===`${d.id}_nextmove`} label="✦ Next Move" small/>
                <AIBtn onClick={e=>{e.stopPropagation();getAI(d,"outreach");}} loading={loadingKey===`${d.id}_outreach`} label="✦ Outreach" small/>
                <AIBtn onClick={e=>{e.stopPropagation();getAI(d,"email");}} loading={loadingKey===`${d.id}_email`} label="✦ Draft Email" small/>
                <AIBtn onClick={e=>{e.stopPropagation();getAI(d,"callscript");}} loading={loadingKey===`${d.id}_callscript`} label="✦ Call Script" small/>
              </div>
              {["nextmove","outreach","email","callscript"].map(t=>aiMap[`${d.id}_${t}`]?<AIPanel key={t} text={aiMap[`${d.id}_${t}`]} onClose={()=>setAiMap(p=>({...p,[`${d.id}_${t}`]:""}))}/>:null)}
            </div>}
          </Card>
        );
      })}
    </div>
  );
}

// ── Grants ─────────────────────────────────────────────────────────────────
function Grants({data,setData}) {
  const [selected,setSelected]=useState(null); const [aiMap,setAiMap]=useState({}); const [loadingKey,setLoadingKey]=useState(null);
  const [prospectAI,setProspectAI]=useState(""); const [prospectLoading,setProspectLoading]=useState(false);
  const pipeline=["prospecting","pending","active","closed"];
  const totals=pipeline.reduce((a,s)=>{a[s]=data.grants.filter(g=>g.status===s).reduce((sum,g)=>sum+g.amount,0);return a;},{});

  const getAI=async(grant,type)=>{
    const key=`${grant.id}_${type}`; setLoadingKey(key); setAiMap(p=>({...p,[key]:""}));
    const sys=`You are an expert nonprofit grant writer and strategist. Specific, tactical. Max 200 words.`;
    const prompts={
      strategy:`Grant strategy for ${grant.funder} / ${grant.program}.\nAmount: ${fmtFull(grant.amount)} | Status: ${grant.status} | Deadline: ${grant.deadline}\nOfficer: ${grant.officer}\nNotes: ${grant.notes}\nHistory: ${grant.history?.join(", ")}\nOrg: ${data.org.name} — ${data.org.mission}\nPrograms: ${data.org.programs.join(", ")}\n\nProvide: key narrative angle, what funder cares about, red flags, 3 specific things to include.`,
      report:`Grant report outline for ${grant.funder}.\nProgram: ${grant.program} | Amount: ${fmtFull(grant.amount)} | Due: ${grant.reportDue}\nNotes: ${grant.notes}\nOrg mission: ${data.org.mission}\n\nProvide: section headers, 3 key metrics to feature, narrative arc, what to emphasize.`,
      loi:`Write a compelling Letter of Inquiry for ${grant.funder}.\nProgram: ${grant.program} | Ask: ${fmtFull(grant.amount)}\nOrg: ${data.org.name} — ${data.org.mission}\nPrograms: ${data.org.programs.join(", ")}\n\nWrite a 3-paragraph LOI: hook, program fit, ask.`,
    };
    await askClaude(sys,prompts[type],chunk=>setAiMap(p=>({...p,[key]:chunk})));
    setLoadingKey(null);
  };

  const findProspects=async()=>{
    setProspectLoading(true); setProspectAI("");
    await askClaude(
      `You are a nonprofit grant research expert. Be specific. Max 200 words.`,
      `Suggest 4 new grant prospects for this org.\nOrg: ${data.org.name}\nMission: ${data.org.mission}\nPrograms: ${data.org.programs.join(", ")}\nCurrent funders: ${data.grants.map(g=>g.funder).join(", ")}\nLocation: New York City\n\nFor each prospect give: funder name, program name, estimated range, why it fits, and one specific alignment point.`,
      chunk=>setProspectAI(chunk)
    );
    setProspectLoading(false);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <AIBtn onClick={findProspects} loading={prospectLoading} label="✦ Find New Grant Prospects"/>
    </div>
    {(prospectLoading||prospectAI)&&<AIPanel text={prospectAI} onClose={()=>setProspectAI("")}/>}

    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
      {pipeline.map(s=><div key={s} style={{background:"#111827",border:`1px solid ${SC[s]}44`,borderRadius:14,padding:14}}>
        <Pill label={s} color={SC[s]}/>
        <div style={{fontSize:20,fontWeight:800,color:SC[s],marginTop:10,fontFamily:"'DM Serif Display',serif"}}>{fmt(totals[s])}</div>
        <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>{data.grants.filter(g=>g.status===s).length} grants</div>
      </div>)}
    </div>

    {data.grants.map(g=>{
      const isOpen=selected?.id===g.id; const pct=g.amount>0?Math.round(g.received/g.amount*100):0; const days=daysUntil(g.deadline);
      return <Card key={g.id} selected={isOpen} accent={SC[g.status]} onClick={()=>setSelected(isOpen?null:g)}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:"#f3f4f6"}}>{g.funder}</div>
            <div style={{fontSize:12,color:"#9ca3af",marginTop:2}}>{g.program}</div>
            {g.history&&<div style={{fontSize:11,color:"#4b5563",marginTop:2}}>History: {g.history.join(" · ")}</div>}
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:16,fontWeight:800,color:"#f3f4f6"}}>{fmt(g.amount)}</div>
            {g.status==="active"&&<div style={{fontSize:11,color:"#6b7280"}}>{pct}% received</div>}
          </div>
          <Pill label={g.status} color={SC[g.status]}/>
        </div>
        {g.status==="active"&&<div style={{marginTop:10,height:4,background:"#1f2937",borderRadius:99}}><div style={{height:"100%",width:`${pct}%`,background:"#10b981",borderRadius:99}}/></div>}
        {isOpen&&<div style={{marginTop:14,paddingTop:14,borderTop:"1px solid #1f2937"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
            <div><div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>Deadline</div><div style={{fontSize:13,color:days<30?"#ef4444":"#f3f4f6",marginTop:3}}>{new Date(g.deadline).toLocaleDateString()} ({days}d)</div></div>
            <div><div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>Program Officer</div><div style={{fontSize:13,color:"#f3f4f6",marginTop:3}}>{g.officer}</div></div>
            {g.reportDue&&<div><div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>Report Due</div><div style={{fontSize:13,color:"#f3f4f6",marginTop:3}}>{new Date(g.reportDue).toLocaleDateString()}</div></div>}
            <div style={{gridColumn:"1/-1"}}><div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>Notes</div><div style={{fontSize:13,color:"#9ca3af",marginTop:3,lineHeight:1.5}}>{g.notes}</div></div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {g.status!=="closed"&&<AIBtn onClick={e=>{e.stopPropagation();getAI(g,"strategy");}} loading={loadingKey===`${g.id}_strategy`} label="✦ Grant Strategy" small/>}
            {["pending","prospecting"].includes(g.status)&&<AIBtn onClick={e=>{e.stopPropagation();getAI(g,"loi");}} loading={loadingKey===`${g.id}_loi`} label="✦ Draft LOI" small/>}
            {g.reportDue&&g.status==="active"&&<AIBtn onClick={e=>{e.stopPropagation();getAI(g,"report");}} loading={loadingKey===`${g.id}_report`} label="✦ Report Outline" small/>}
          </div>
          {["strategy","loi","report"].map(t=>aiMap[`${g.id}_${t}`]?<AIPanel key={t} text={aiMap[`${g.id}_${t}`]} onClose={()=>setAiMap(p=>({...p,[`${g.id}_${t}`]:""}))}/>:null)}
        </div>}
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
    {data.volunteers.map(v=>{
      const cc=v.convertPotential==="high"?"#f59e0b":v.convertPotential==="converted"?"#10b981":"#6b7280";
      return <Card key={v.id}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:42,height:42,borderRadius:"50%",background:cc+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:cc,flexShrink:0}}>{v.name[0]}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:"#f3f4f6"}}>{v.name}</div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:1}}>{v.employer} · {v.email}</div>
            <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>{v.skills.map(s=><Pill key={s} label={s} color="#8b5cf6"/>)}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:20,fontWeight:800,color:cc,fontFamily:"'DM Serif Display',serif"}}>{v.hours}h</div>
            <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>{daysDiff(v.lastActive)}d ago</div>
            <div style={{marginTop:4}}><Pill label={v.convertPotential==="converted"?"donor":`${v.convertPotential} potential`} color={cc}/></div>
          </div>
        </div>
        {v.notes&&<div style={{marginTop:12,background:"#0f172a",borderRadius:8,padding:"9px 12px",fontSize:12,color:"#9ca3af",lineHeight:1.5}}>{v.notes}</div>}
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
    {data.board.map(b=>{
      const attColor=b.attendance>=90?"#10b981":b.attendance>=75?"#f59e0b":"#ef4444";
      return <Card key={b.id}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:42,height:42,borderRadius:"50%",background:"#3b82f633",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:"#3b82f6",flexShrink:0}}>{b.name[0]}</div>
          <div style={{flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{fontSize:15,fontWeight:700,color:"#f3f4f6"}}>{b.name}</div>
              <Pill label={b.role} color="#3b82f6"/>
            </div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:1}}>{b.employer}</div>
            <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>{b.committees.map(c=><Pill key={c} label={c} color="#6b7280"/>)}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:15,fontWeight:800,color:"#10b981"}}>{b.givingLevel}</div>
            <div style={{fontSize:11,color:attColor,marginTop:3,fontWeight:600}}>{b.attendance}% attendance</div>
            <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>Term: {b.term}</div>
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
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",gap:8}}>
        <AIBtn onClick={prioritize} loading={prioLoading} label="✦ AI Prioritize"/>
        <button onClick={()=>setShowAdd(true)} style={{background:"#10b981",border:"none",borderRadius:10,padding:"9px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>+ Add</button>
      </div>
      <div style={{fontSize:12,color:"#6b7280"}}>{pending.length} open · {done.length} done</div>
    </div>
    {(prioLoading||prioAI)&&<AIPanel text={prioAI} onClose={()=>setPrioAI("")}/>}
    {showAdd&&<Card style={{flexDirection:"column",display:"flex",gap:10}}>
      <input value={newTask.title} onChange={e=>setNewTask(p=>({...p,title:e.target.value}))} placeholder="Task title" style={{background:"#0f172a",border:"1px solid #374151",borderRadius:8,padding:"9px 12px",color:"#f3f4f6",fontSize:13,outline:"none"}}/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <input type="date" value={newTask.due} onChange={e=>setNewTask(p=>({...p,due:e.target.value}))} style={{flex:1,background:"#0f172a",border:"1px solid #374151",borderRadius:8,padding:"9px 12px",color:"#9ca3af",fontSize:13,outline:"none"}}/>
        {[["priority",["high","medium","low"]],["type",["donor","grant","board","volunteer","finance"]]].map(([k,opts])=>
          <select key={k} value={newTask[k]} onChange={e=>setNewTask(p=>({...p,[k]:e.target.value}))} style={{background:"#0f172a",border:"1px solid #374151",borderRadius:8,padding:"9px 10px",color:"#9ca3af",fontSize:13,outline:"none"}}>
            {opts.map(o=><option key={o} value={o}>{o}</option>)}
          </select>)}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={addTask} style={{background:"#10b981",border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Save</button>
        <button onClick={()=>setShowAdd(false)} style={{background:"#374151",border:"none",borderRadius:8,padding:"8px 14px",color:"#9ca3af",fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
    </Card>}
    {pending.map(t=><div key={t.id} onClick={()=>toggle(t.id)} style={{background:"#111827",border:"1px solid #1f2937",borderRadius:12,padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
      <div style={{width:20,height:20,borderRadius:6,border:`2px solid ${SC[t.priority]}`,flexShrink:0}}/>
      <div style={{flex:1}}>
        <div style={{fontSize:14,color:"#f3f4f6",fontWeight:500}}>{t.title}</div>
        {t.due&&<div style={{fontSize:11,color:"#6b7280",marginTop:2}}>Due {new Date(t.due).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>}
      </div>
      <div style={{display:"flex",gap:6}}><Pill label={t.priority} color={SC[t.priority]}/><Pill label={t.type} color="#6b7280"/></div>
    </div>)}
    {done.length>0&&<>
      <div style={{fontSize:10,fontWeight:700,color:"#374151",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:4}}>Completed</div>
      {done.map(t=><div key={t.id} onClick={()=>toggle(t.id)} style={{background:"#0f172a",border:"1px solid #1f2937",borderRadius:12,padding:"11px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,opacity:0.45}}>
        <div style={{width:20,height:20,borderRadius:6,background:"#10b981",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:10,color:"#fff"}}>✓</span></div>
        <div style={{fontSize:13,color:"#6b7280",textDecoration:"line-through",flex:1}}>{t.title}</div>
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
      <SectionLabel>Monthly Revenue Breakdown</SectionLabel>
      {rev.map((r,i)=>{
        const rv=r.individual+r.grants+r.events+r.other;
        const ex=exp[i].programs+exp[i].admin+exp[i].fundraising;
        return <div key={r.month} style={{marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
            <span style={{fontSize:13,fontWeight:600,color:"#f3f4f6"}}>{r.month}</span>
            <div style={{display:"flex",gap:12}}>
              <span style={{fontSize:12,color:"#10b981"}}>Rev: {fmtFull(rv)}</span>
              <span style={{fontSize:12,color:"#ef4444"}}>Exp: {fmtFull(ex)}</span>
              <span style={{fontSize:12,color:rv>=ex?"#10b981":"#ef4444",fontWeight:700}}>{rv>=ex?"+":""}{fmtFull(rv-ex)}</span>
            </div>
          </div>
          <div style={{height:6,background:"#1f2937",borderRadius:99,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${(rv/maxBar)*100}%`,background:"linear-gradient(90deg,#10b981,#3b82f6)",borderRadius:99}}/>
          </div>
          <div style={{display:"flex",gap:3,marginTop:3}}>
            {[["individual",r.individual,"#10b981"],["grants",r.grants,"#3b82f6"],["events",r.events,"#8b5cf6"],["other",r.other,"#6b7280"]].filter(([,v])=>v>0).map(([k,v,c])=>
              <div key={k} style={{flex:v/rv,height:3,background:c,borderRadius:99}} title={`${k}: ${fmtFull(v)}`}/>
            )}
          </div>
        </div>;
      })}
      <div style={{display:"flex",gap:12,marginTop:8,flexWrap:"wrap"}}>
        {[["#10b981","Individual"],["#3b82f6","Grants"],["#8b5cf6","Events"],["#6b7280","Other"]].map(([c,l])=>
          <div key={l} style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:8,height:8,borderRadius:2,background:c}}/><span style={{fontSize:11,color:"#9ca3af"}}>{l}</span></div>
        )}
      </div>
    </Card>

    <Card>
      <SectionLabel>Restricted Fund Tracker</SectionLabel>
      {data.financials.funds.map(f=><div key={f.name} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid #1f2937"}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:f.restricted?"#8b5cf6":"#10b981",flexShrink:0}}/>
        <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:"#f3f4f6"}}>{f.name}</div><Pill label={f.restricted?"restricted":"unrestricted"} color={f.restricted?"#8b5cf6":"#10b981"}/></div>
        <div style={{fontSize:16,fontWeight:800,color:"#f3f4f6",fontFamily:"'DM Serif Display',serif"}}>{fmt(f.balance)}</div>
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

  const doImport = async () => {
    setLoading(true); setErr("");
    const donors = parsed.rows.map(row => {
      const d = {};
      Object.entries(mapping).forEach(([h, field]) => { if (field) d[field] = row[h]; });
      if (d.total) d.total = parseFloat(String(d.total).replace(/[$,]/g, "")) || 0;
      if (d.lastAmount) d.lastAmount = parseFloat(String(d.lastAmount).replace(/[$,]/g, "")) || 0;
      if (d.gifts) d.gifts = parseInt(d.gifts) || 1;
      return d;
    }).filter(d => d.name);
    try {
      const res = await apiFetch("/donors/import", { method: "POST", body: JSON.stringify({ donors }) });
      setResult(res.inserted);
      onImported();
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const overlay = { position:"fixed",inset:0,background:"#000c",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20 };
  const modal = { background:"#0a0f1e",border:"1px solid #1f2937",borderRadius:20,width:"100%",maxWidth:680,maxHeight:"85vh",overflowY:"auto",padding:28 };
  const inp = { width:"100%",background:"#111827",border:"1px solid #374151",borderRadius:8,padding:"9px 12px",color:"#f3f4f6",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" };

  if (result !== null) return (
    <div style={overlay}><div style={{...modal,textAlign:"center"}}>
      <div style={{fontSize:40,marginBottom:12}}>✓</div>
      <div style={{fontSize:22,fontWeight:800,color:"#f9fafb",marginBottom:8}}>{result} donor{result!==1?"s":""} imported</div>
      <div style={{fontSize:14,color:"#6b7280",marginBottom:24}}>Your donor list has been updated.</div>
      <button onClick={onClose} style={{background:"#10b981",border:"none",borderRadius:10,padding:"12px 28px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
    </div></div>
  );

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div><div style={{fontSize:18,fontWeight:800,color:"#f9fafb"}}>Import Donors</div>
            <div style={{fontSize:13,color:"#6b7280",marginTop:2}}>Paste CSV or upload a file</div></div>
          <button onClick={onClose} style={{background:"#1f2937",border:"none",borderRadius:8,padding:"6px 12px",color:"#9ca3af",cursor:"pointer",fontSize:13}}>✕ Close</button>
        </div>

        {!parsed && (<>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Upload CSV file</div>
            <input type="file" accept=".csv" onChange={handleFile} style={{fontSize:13,color:"#9ca3af"}}/>
          </div>
          <div style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Or paste CSV text</div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={8} placeholder={"Name,Email,Total Giving,Last Gift Date\nJane Smith,jane@example.com,5000,2024-11-01"} style={{...inp,resize:"vertical",lineHeight:1.5,marginBottom:12}}/>
          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <button onClick={doParse} disabled={!csvText.trim()} style={{background:csvText.trim()?"linear-gradient(135deg,#10b981,#3b82f6)":"#1f2937",border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:csvText.trim()?"pointer":"not-allowed",opacity:csvText.trim()?1:0.5}}>
            Parse CSV →
          </button>
        </>)}

        {parsed && (<>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,color:"#10b981",marginBottom:12}}>Map columns → donor fields</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {parsed.headers.map(h=>(
                <div key={h} style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:12,color:"#9ca3af",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h}</span>
                  <select value={mapping[h]||""} onChange={e=>setMapping(p=>({...p,[h]:e.target.value}))}
                    style={{background:"#111827",border:"1px solid #374151",borderRadius:6,padding:"5px 8px",color:"#f3f4f6",fontSize:12,outline:"none"}}>
                    <option value="">— skip —</option>
                    {CSV_FIELDS.map(f=><option key={f.key} value={f.key}>{f.key}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:600,color:"#6b7280",marginBottom:8}}>Preview ({parsed.rows.length} rows)</div>
            <div style={{overflowX:"auto",border:"1px solid #1f2937",borderRadius:8}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#111827"}}>
                  {parsed.headers.filter(h=>mapping[h]).map(h=><th key={h} style={{padding:"6px 10px",textAlign:"left",color:"#6b7280",fontWeight:600,borderBottom:"1px solid #1f2937"}}>{mapping[h]}</th>)}
                </tr></thead>
                <tbody>{parsed.rows.slice(0,5).map((row,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid #111827"}}>
                    {parsed.headers.filter(h=>mapping[h]).map(h=><td key={h} style={{padding:"6px 10px",color:"#f3f4f6"}}>{row[h]}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {parsed.rows.length>5&&<div style={{fontSize:11,color:"#6b7280",marginTop:6}}>…and {parsed.rows.length-5} more rows</div>}
          </div>

          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setParsed(null)} style={{background:"transparent",border:"1px solid #374151",borderRadius:10,padding:"11px 18px",color:"#6b7280",fontSize:13,cursor:"pointer"}}>← Back</button>
            <button onClick={doImport} disabled={loading} style={{flex:1,background:loading?"#1f2937":"linear-gradient(135deg,#10b981,#3b82f6)",border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1}}>
              {loading?"Importing…":`Import ${parsed.rows.filter(r=>r[parsed.headers.find(h=>mapping[h]==="name")||""]||true).length} Donors →`}
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
    <Card>
      <SectionLabel>Your Organization Profile</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        <div><div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Mission</div>
          <div style={{fontSize:13,color:"#f3f4f6",lineHeight:1.5}}>{data.org.mission||"—"}</div></div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div><div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Annual Budget</div>
            <div style={{fontSize:13,color:"#f3f4f6"}}>{budgetLabel}</div></div>
          <div><div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Current Funders</div>
            <div style={{fontSize:13,color:"#f3f4f6"}}>{activeGrants}</div></div>
        </div>
      </div>
      <button onClick={find} disabled={loading} style={{background:loading?"#1f2937":"linear-gradient(135deg,#8b5cf6,#3b82f6)",border:"none",borderRadius:12,padding:"13px 22px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:8,opacity:loading?0.7:1}}>
        {loading?<><Spin/>Scanning grant landscape…</>:"✦ Find Matching Grants"}
      </button>
    </Card>

    {(loading||results)&&<Card style={{background:"linear-gradient(135deg,#0f0c29,#0f172a)",border:"1px solid #7c3aed44"}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#8b5cf6",marginBottom:14}}>✦ Grant Matches — Ranked by Alignment</div>
      {loading&&!results&&<div style={{display:"flex",alignItems:"center",gap:10,color:"#6b7280",fontSize:13}}><Spin/>Analyzing your org and searching grant landscape…</div>}
      {results&&<div style={{fontSize:13,color:"#e2e8f0",lineHeight:1.85,whiteSpace:"pre-wrap"}}>{results}</div>}
    </Card>}

    {ran&&!loading&&!results&&<div style={{fontSize:13,color:"#6b7280",textAlign:"center",padding:20}}>No results yet — try again.</div>}
  </div>;
}

// ── App Shell ──────────────────────────────────────────────────────────────
const TABS=[
  {id:"dashboard",label:"Dashboard",icon:"◈"},
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"grants",label:"Grants",icon:"◉"},
  {id:"findgrants",label:"Find Grants",icon:"✦"},
  {id:"volunteers",label:"Volunteers",icon:"◎"},
  {id:"board",label:"Board",icon:"◆"},
  {id:"finance",label:"Finance",icon:"◇"},
  {id:"tasks",label:"Tasks",icon:"◻"},
];

export default function App() {
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

  if(loading) return <div style={{minHeight:"100vh",background:"#030712",display:"flex",alignItems:"center",justifyContent:"center",color:"#6b7280",fontFamily:"'DM Sans',system-ui,sans-serif",fontSize:14}}>Loading your workspace…</div>;
  if(loadErr||!data) return <div style={{minHeight:"100vh",background:"#030712",display:"flex",alignItems:"center",justifyContent:"center",color:"#f87171",fontFamily:"'DM Sans',system-ui,sans-serif",fontSize:14}}>Error: {loadErr||"Failed to load data"}</div>;

  const tasksDue=data.tasks.filter(t=>!t.done&&t.priority==="high").length;
  const orgName=auth?.org?.name||data.org?.name||"Steward";

  return <div style={{minHeight:"100vh",background:"#030712",color:"#f3f4f6",fontFamily:"'DM Sans',system-ui,sans-serif",display:"flex",flexDirection:"column"}}>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
    <div style={{borderBottom:"1px solid #111827",padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#030712",position:"sticky",top:0,zIndex:100}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:32,height:32,background:"linear-gradient(135deg,#10b981,#3b82f6)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:16,color:"#fff"}}>◈</span></div>
        <div>
          <div style={{fontSize:15,fontWeight:800,color:"#f9fafb",letterSpacing:"-0.02em"}}>{orgName}</div>
          <div style={{fontSize:10,color:"#6b7280",letterSpacing:"0.06em",textTransform:"uppercase"}}>Manage what matters.</div>
        </div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <button onClick={()=>setShowChat(true)} style={{background:"linear-gradient(135deg,#7c3aed,#3b82f6)",border:"none",borderRadius:12,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:8,boxShadow:"0 0 20px #7c3aed44"}}>
          <span>✦</span> Ask AI
        </button>
        <button onClick={logout} style={{background:"transparent",border:"1px solid #374151",borderRadius:10,padding:"9px 14px",color:"#6b7280",fontSize:12,cursor:"pointer"}}>
          Sign out
        </button>
      </div>
    </div>
    <div style={{display:"flex",gap:4,padding:"10px 24px",borderBottom:"1px solid #111827",overflowX:"auto",flexShrink:0}}>
      {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{background:tab===t.id?"#10b981":"transparent",border:tab===t.id?"none":"1px solid #1f2937",borderRadius:10,padding:"8px 14px",color:tab===t.id?"#fff":"#9ca3af",fontSize:13,fontWeight:tab===t.id?700:500,cursor:"pointer",display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap",transition:"all 0.15s"}}>
        <span style={{fontSize:11}}>{t.icon}</span>{t.label}
        {t.id==="tasks"&&tasksDue>0&&<span style={{background:"#ef4444",color:"#fff",fontSize:10,fontWeight:800,borderRadius:99,padding:"1px 5px",marginLeft:2}}>{tasksDue}</span>}
      </button>)}
    </div>
    <div style={{flex:1,padding:22,maxWidth:1020,width:"100%",margin:"0 auto",boxSizing:"border-box"}}>
      {tab==="dashboard"&&<Dashboard data={data}/>}
      {tab==="donors"&&<Donors data={data} setData={setData}/>}
      {tab==="grants"&&<Grants data={data} setData={setData}/>}
      {tab==="findgrants"&&<FindGrants data={data}/>}
      {tab==="volunteers"&&<Volunteers data={data}/>}
      {tab==="board"&&<Board data={data}/>}
      {tab==="finance"&&<Finance data={data}/>}
      {tab==="tasks"&&<Tasks data={data} setData={setData}/>}
    </div>
    {showChat&&<AIChat data={data} onClose={()=>setShowChat(false)}/>}
  </div>;
}
