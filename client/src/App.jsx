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

// ── Donors ─────────────────────────────────────────────────────────────────
function Donors({data,setData}) {
  const [search,setSearch]=useState(""); const [filter,setFilter]=useState("all");
  const [selected,setSelected]=useState(null); const [showAdd,setShowAdd]=useState(false);
  const [newDonor,setNewDonor]=useState({name:"",email:"",phone:"",lastAmount:"",tags:""});
  const [aiMap,setAiMap]=useState({}); const [loadingKey,setLoadingKey]=useState(null);
  const [callList,setCallList]=useState(""); const [callLoading,setCallLoading]=useState(false);
  const [newInteraction,setNewInteraction]=useState({donorId:null,type:"call",note:""});

  const filtered=data.donors.filter(d=>{
    const ms=d.name.toLowerCase().includes(search.toLowerCase())||d.email.toLowerCase().includes(search.toLowerCase());
    return ms&&(filter==="all"||d.status===filter);
  }).sort((a,b)=>donorScore(b)-donorScore(a));

  const getAI = async (donor,type) => {
    const key=`${donor.id}_${type}`; setLoadingKey(key); setAiMap(p=>({...p,[key]:""}));
    const sys=`You are a nonprofit major gifts officer. Specific, strategic, warm. Max 180 words. Reference actual donor history.`;
    const prompts = {
      outreach:`Outreach strategy for ${donor.name}.\nTotal: ${fmtFull(donor.total)}, ${donor.gifts} gifts, last: ${fmtFull(donor.lastAmount)} ${daysDiff(donor.lastGift)}d ago\nStatus: ${donor.status} | Tags: ${donor.tags.join(",")}\nNotes: ${donor.notes}\nInteractions: ${donor.interactions?.map(i=>`${i.date}: ${i.note}`).join("; ")||"none"}\nOrg: ${data.org.mission}\n\nGive: best channel, key talking points, suggested ask amount, personal reference.`,
      upgrade:`Upgrade path for ${donor.name}.\nCurrent: ${donor.gifts} gifts, avg ${fmt(donor.total/donor.gifts)}, last ${fmtFull(donor.lastAmount)}\nNotes: ${donor.notes}\n\nSuggest: next ask amount, timing, framing strategy, what to say.`,
      email:`Write a personalized re-engagement email for lapsed donor ${donor.name}.\nLast gift: ${fmtFull(donor.lastAmount)} on ${donor.lastGift}\nNotes: ${donor.notes}\nOrg: ${data.org.name} — ${data.org.mission}\n\nWarm, specific, not desperate. Include a clear but soft ask.`,
      callscript:`Write a phone call script for ${donor.name}.\nContext: ${donor.notes}\nLast gift: ${fmtFull(donor.lastAmount)}\nGoal: cultivation / upgrade conversation\n\nInclude: opening, 2 listening questions, impact story hook, soft ask.`,
    };
    await askClaude(sys,prompts[type],chunk=>setAiMap(p=>({...p,[key]:chunk})));
    setLoadingKey(null);
  };

  const generateCallList = async () => {
    setCallLoading(true); setCallList("");
    await askClaude(
      `You are a chief development officer. Be tactical. Max 200 words.`,
      `Generate a prioritized call list for this week. For each donor, give: why call now, what to say, what to ask for.\n\n${data.donors.map(d=>`${d.name} [${d.status}]: score ${donorScore(d)}, last gift ${daysDiff(d.lastGift)}d ago ${fmtFull(d.lastAmount)}, notes: ${d.notes}`).join("\n")}`,
      chunk=>setCallList(chunk)
    );
    setCallLoading(false);
  };

  const addInteraction = (donorId) => {
    if(!newInteraction.note) return;
    const interaction = {date:new Date().toISOString().split("T")[0],type:newInteraction.type,note:newInteraction.note};
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donorId?{...d,interactions:[interaction,...(d.interactions||[])]}:d)}));
    setNewInteraction({donorId:null,type:"call",note:""});
  };

  const addDonor = () => {
    if(!newDonor.name) return;
    const d={id:Date.now(),name:newDonor.name,email:newDonor.email,phone:newDonor.phone,total:parseInt(newDonor.lastAmount)||0,lastGift:new Date().toISOString().split("T")[0],lastAmount:parseInt(newDonor.lastAmount)||0,gifts:1,status:"new",tags:newDonor.tags.split(",").map(t=>t.trim()).filter(Boolean),notes:"",interactions:[]};
    setData(prev=>({...prev,donors:[...prev.donors,d]}));
    setShowAdd(false); setNewDonor({name:"",email:"",phone:"",lastAmount:"",tags:""});
  };

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search donors…" style={{flex:1,minWidth:160,background:"#111827",border:"1px solid #374151",borderRadius:10,padding:"10px 14px",color:"#f3f4f6",fontSize:13,outline:"none"}}/>
      <select value={filter} onChange={e=>setFilter(e.target.value)} style={{background:"#111827",border:"1px solid #374151",borderRadius:10,padding:"10px 12px",color:"#9ca3af",fontSize:13,outline:"none"}}>
        <option value="all">All</option><option value="major">Major</option><option value="mid">Mid</option><option value="new">New</option><option value="lapsed">Lapsed</option>
      </select>
      <AIBtn onClick={generateCallList} loading={callLoading} label="✦ This Week's Call List"/>
      <button onClick={()=>setShowAdd(true)} style={{background:"#10b981",border:"none",borderRadius:10,padding:"10px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>+ Add</button>
    </div>

    {(callLoading||callList)&&<AIPanel text={callList} onClose={()=>setCallList("")}/>}

    {showAdd&&<Card style={{gap:10,display:"flex",flexDirection:"column"}}>
      <div style={{fontSize:14,fontWeight:700,color:"#f3f4f6"}}>New Donor</div>
      {[["name","Full Name"],["email","Email"],["phone","Phone"],["lastAmount","Gift Amount ($)"],["tags","Tags (comma-separated)"]].map(([k,pl])=>
        <input key={k} value={newDonor[k]} onChange={e=>setNewDonor(p=>({...p,[k]:e.target.value}))} placeholder={pl} style={{background:"#0f172a",border:"1px solid #374151",borderRadius:8,padding:"9px 12px",color:"#f3f4f6",fontSize:13,outline:"none"}}/>
      )}
      <div style={{display:"flex",gap:8}}>
        <button onClick={addDonor} style={{background:"#10b981",border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Save</button>
        <button onClick={()=>setShowAdd(false)} style={{background:"#374151",border:"none",borderRadius:8,padding:"8px 14px",color:"#9ca3af",fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
    </Card>}

    {filtered.map(d=>{
      const sc=donorScore(d); const isOpen=selected?.id===d.id;
      const scoreColor=sc>70?"#10b981":sc>45?"#f59e0b":"#ef4444";
      return <Card key={d.id} selected={isOpen} accent={SC[d.status]} onClick={()=>setSelected(isOpen?null:d)}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{position:"relative",flexShrink:0}}>
            <div style={{width:42,height:42,borderRadius:"50%",background:SC[d.status]+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:SC[d.status]}}>{d.name[0]}</div>
            <div style={{position:"absolute",bottom:-2,right:-2,width:18,height:18,borderRadius:"50%",background:scoreColor,border:"2px solid #111827",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:8,fontWeight:800,color:"#fff"}}>{sc}</span>
            </div>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:15,fontWeight:700,color:"#f3f4f6"}}>{d.name}</div>
            <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>{d.email} · {daysDiff(d.lastGift)}d since last gift</div>
            <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>{d.tags.map(t=><Pill key={t} label={t} color="#6b7280"/>)}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:17,fontWeight:800,color:"#f3f4f6"}}>{fmt(d.total)}</div>
            <div style={{fontSize:11,color:"#6b7280"}}>{d.gifts} gifts</div>
            <div style={{marginTop:4}}><Pill label={d.status} color={SC[d.status]}/></div>
          </div>
        </div>

        {isOpen&&<div style={{marginTop:14,paddingTop:14,borderTop:"1px solid #1f2937"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
            <div><div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>Last Gift</div><div style={{fontSize:13,color:"#f3f4f6",marginTop:3}}>{fmtFull(d.lastAmount)}</div></div>
            <div><div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>Phone</div><div style={{fontSize:13,color:"#f3f4f6",marginTop:3}}>{d.phone}</div></div>
            <div><div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>AI Score</div><div style={{fontSize:13,color:scoreColor,marginTop:3,fontWeight:700}}>{sc}/99</div></div>
          </div>
          {d.notes&&<div style={{background:"#0f172a",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#9ca3af",marginBottom:12,lineHeight:1.5}}>{d.notes}</div>}

          {d.interactions?.length>0&&<div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:"#374151",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Interaction Log</div>
            {d.interactions.slice(0,3).map((int,i)=><div key={i} style={{display:"flex",gap:10,padding:"7px 0",borderBottom:"1px solid #1f2937",alignItems:"flex-start"}}>
              <Pill label={int.type} color="#6b7280"/>
              <div style={{flex:1}}>
                <div style={{fontSize:12,color:"#9ca3af"}}>{int.note}</div>
                <div style={{fontSize:10,color:"#4b5563",marginTop:2}}>{int.date}</div>
              </div>
            </div>)}
          </div>}

          {newInteraction.donorId===d.id?<div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <select value={newInteraction.type} onChange={e=>setNewInteraction(p=>({...p,type:e.target.value}))} style={{background:"#0f172a",border:"1px solid #374151",borderRadius:8,padding:"7px 10px",color:"#9ca3af",fontSize:12,outline:"none"}}>
              <option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="gift">Gift</option><option value="event">Event</option>
            </select>
            <input value={newInteraction.note} onChange={e=>setNewInteraction(p=>({...p,note:e.target.value}))} placeholder="Note about interaction…" style={{flex:1,minWidth:150,background:"#0f172a",border:"1px solid #374151",borderRadius:8,padding:"7px 10px",color:"#f3f4f6",fontSize:12,outline:"none"}}/>
            <button onClick={e=>{e.stopPropagation();addInteraction(d.id);}} style={{background:"#10b981",border:"none",borderRadius:8,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>Log</button>
            <button onClick={e=>{e.stopPropagation();setNewInteraction({donorId:null,type:"call",note:""});}} style={{background:"#374151",border:"none",borderRadius:8,padding:"7px 10px",color:"#9ca3af",fontSize:12,cursor:"pointer"}}>×</button>
          </div>:<button onClick={e=>{e.stopPropagation();setNewInteraction({donorId:d.id,type:"call",note:""});}} style={{background:"#1f2937",border:"1px solid #374151",borderRadius:8,padding:"7px 12px",color:"#9ca3af",fontSize:12,cursor:"pointer",marginBottom:12}}>+ Log Interaction</button>}

          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <AIBtn onClick={e=>{e.stopPropagation();getAI(d,"outreach");}} loading={loadingKey===`${d.id}_outreach`} label="✦ Outreach Strategy" small/>
            <AIBtn onClick={e=>{e.stopPropagation();getAI(d,"upgrade");}} loading={loadingKey===`${d.id}_upgrade`} label="✦ Upgrade Path" small/>
            <AIBtn onClick={e=>{e.stopPropagation();getAI(d,"callscript");}} loading={loadingKey===`${d.id}_callscript`} label="✦ Call Script" small/>
            {d.status==="lapsed"&&<AIBtn onClick={e=>{e.stopPropagation();getAI(d,"email");}} loading={loadingKey===`${d.id}_email`} label="✦ Re-engagement Email" small/>}
          </div>
          {["outreach","upgrade","callscript","email"].map(t=>aiMap[`${d.id}_${t}`]?<AIPanel key={t} text={aiMap[`${d.id}_${t}`]} onClose={()=>setAiMap(p=>({...p,[`${d.id}_${t}`]:""}))}/>:null)}
        </div>}
      </Card>;
    })}
  </div>;
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

// ── App Shell ──────────────────────────────────────────────────────────────
const TABS=[
  {id:"dashboard",label:"Dashboard",icon:"◈"},
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"grants",label:"Grants",icon:"◉"},
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
      {tab==="volunteers"&&<Volunteers data={data}/>}
      {tab==="board"&&<Board data={data}/>}
      {tab==="finance"&&<Finance data={data}/>}
      {tab==="tasks"&&<Tasks data={data} setData={setData}/>}
    </div>
    {showChat&&<AIChat data={data} onClose={()=>setShowChat(false)}/>}
  </div>;
}
